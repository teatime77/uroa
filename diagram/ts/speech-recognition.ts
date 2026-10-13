import { Vec2 } from "@i18n";
import { FunctionBlock, registerFunctionBlock } from "./block";
import { PortType, theCanvas } from "./diagram_util";
import { TextPort } from "./port";
import { getProcedureSignal, isRunning, stopDiagram, subscribeDiagramStop } from "./runtime";
import { recognizeSpeech, SpeechRecognitionError, speechRecognitionConstructor, type SpeechRecognizer } from "./speech-client";
import { Button, type Attr, type UI } from "./ui";

export class SpeechRecognitionBlock extends FunctionBlock {
    override readonly runOnStart = true;
    readonly outputPort = new TextPort(this, PortType.outputPort);
    readonly resultView: HTMLTextAreaElement;
    readonly finishButton: Button;
    lang = "ja-JP";
    message = "Startで音声入力";
    private recognition?: SpeechRecognizer;
    private request?: AbortController;
    private finishing = false;
    private removed = false;
    private version = 0;
    private events = new AbortController();
    private releaseStop: () => void;

    constructor(data: Attr) {
        super(data);
        this.ports = [this.outputPort];
        this.resultView = document.createElement("textarea");
        this.resultView.readOnly = true;
        this.resultView.setAttribute("aria-label", "音声認識結果・エラー");
        this.resultView.style.cssText = "position:absolute;box-sizing:border-box;width:288px;height:80px;resize:none;z-index:100;font:14px sans-serif";
        this.resultView.hidden = this.inToolbox;
        if (!this.inToolbox) (document.getElementById("layer-diagram") || document.body).appendChild(this.resultView);
        this.finishButton = new Button({ text: "認識終了", click: () => this.finishRecognition() });
        this.releaseStop = subscribeDiagramStop(() => this.cancelRecognition());
        window.addEventListener("pagehide", () => this.cancelRecognition(), { signal: this.events.signal });
        this.setBoxSize();
        this.refreshButton();
    }

    children(): UI[] { return [this.finishButton]; }
    setBoxSize(): void { this.boxSize = new Vec2(320, this.inToolbox ? 60 : 260); }
    setPosition(position: Vec2): void {
        super.setPosition(position);
        this.resultView.style.left = `${position.x + 16}px`;
        this.resultView.style.top = `${position.y + 134}px`;
        this.positionButton();
    }
    setPortPositions(): void { super.setPortPositions(); this.positionButton(); }
    private positionButton(): void {
        if (!this.finishButton) return;
        this.finishButton.setPosition(this.position.add(new Vec2(16, 78)));
        this.finishButton.boxSize = new Vec2(288, 44);
    }
    private refreshButton(): void {
        this.finishButton.disabled = this.removed || this.inToolbox || !this.recognition || this.finishing;
        theCanvas?.requestUpdateCanvas();
    }
    private show(message: string, text = ""): void {
        this.message = message;
        this.resultView.value = text;
        this.refreshButton();
    }
    private cancelRecognition(): void {
        this.version++;
        this.request?.abort();
        this.recognition = undefined;
        this.request = undefined;
        this.finishing = false;
        this.outputPort.setPortValue(undefined);
        this.show("中断しました");
    }
    finishRecognition(): void {
        if (!this.recognition || this.finishing || this.removed) return;
        this.finishing = true;
        this.show("認識結果を待っています…");
        try { this.recognition.stop(); }
        catch { stopDiagram(); }
    }
    resetForRun(): void {
        this.cancelRecognition();
        this.show("Startで音声入力");
    }
    async valueChanged(): Promise<void> {}
    calc(): void {}
    async run(): Promise<void> {
        if (this.removed || this.inToolbox) return;
        this.resetForRun();
        const version = ++this.version;
        const request = this.request = new AbortController();
        const signal = getProcedureSignal();
        const current = () => !this.removed && version === this.version;
        const cancel = () => request.abort();
        signal.addEventListener("abort", cancel, { once: true });
        try {
            if (signal.aborted) { cancel(); return; }
            const Recognition = speechRecognitionConstructor();
            if (!Recognition) throw new SpeechRecognitionError("このブラウザーは音声認識に対応していません。");
            const recognition = this.recognition = new Recognition();
            this.show("マイクを準備しています…");
            const text = await recognizeSpeech(recognition, { lang: this.lang, signal: request.signal,
                onStart: () => { if (current()) this.show("聞き取り中… 話してください"); } });
            if (!current() || signal.aborted || request.signal.aborted) return;
            this.outputPort.setPortValue(text);
            this.show("認識しました", text);
        } catch (error) {
            if (!current() || signal.aborted) return;
            this.outputPort.setPortValue(undefined);
            const message = error instanceof SpeechRecognitionError ? error.message : "音声認識を開始できませんでした。";
            this.show("エラー", message);
            throw new Error(message);
        } finally {
            signal.removeEventListener("abort", cancel);
            if (this.request === request) {
                this.request = undefined;
                this.recognition = undefined;
                this.finishing = false;
            }
            this.refreshButton();
        }
    }
    makeObj(): any { return { ...super.makeObj(), lang: this.lang }; }
    loadObj(obj: any): void {
        this.resetForRun();
        this.lang = "ja-JP";
        if (typeof obj.lang === "string") {
            try { this.lang = Intl.getCanonicalLocales(obj.lang)[0] || "ja-JP"; } catch { /* Keep the default. */ }
        }
    }
    copy(): SpeechRecognitionBlock {
        const block = new SpeechRecognitionBlock({});
        block.lang = this.lang;
        this.copyUI(block);
        block.setBoxSize();
        block.setBlockPortPosition(this.position.copy());
        return block;
    }
    draw(): void {
        super.draw();
        const ctx = this.ctx, { x, y } = this.position;
        ctx.save();
        ctx.font = "18px sans-serif"; ctx.textBaseline = "top"; ctx.fillStyle = "#17384f";
        ctx.fillText("音声認識", x + 16, y + 26);
        if (!this.inToolbox) {
            ctx.font = "14px sans-serif";
            ctx.fillText(this.message, x + 16, y + 52, 288);
            ctx.fillText("中断は全体Stop", x + 16, y + 224);
            this.finishButton.draw();
        }
        ctx.restore();
    }
    clearBlock(): void {
        if (this.removed) return;
        if (isRunning) stopDiagram();
        this.removed = true;
        this.cancelRecognition();
        this.releaseStop();
        this.events.abort();
        this.resultView.remove();
        super.clearBlock();
    }
}

registerFunctionBlock(SpeechRecognitionBlock.name, () => new SpeechRecognitionBlock({}));
