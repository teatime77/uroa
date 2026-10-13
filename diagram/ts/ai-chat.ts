import { Vec2 } from "@i18n";
import { FunctionBlock, registerFunctionBlock } from "./block";
import { PortType, theCanvas } from "./diagram_util";
import { TextPort } from "./port";
import { getProcedureSignal, isRunning, stopDiagram, subscribeDiagramStop } from "./runtime";
import { Button, type Attr, type UI } from "./ui";
import { AIRequestError, askAI, checkAIConnection, waitAIRequest } from "./ai-client";

/** Learner-provided credentials live only in this block's private memory. */
export class AIChatBlock extends FunctionBlock {
    override readonly runOnStart = true;
    readonly inputPort = new TextPort(this, PortType.inputPort);
    readonly outputPort = new TextPort(this, PortType.outputPort);
    readonly answerView: HTMLTextAreaElement;
    readonly connectButton: Button;
    readonly disconnectButton: Button;
    model = "gemini-3.5-flash-lite";
    message = "待機中";
    #apiKey = "";
    private connecting = false;
    private dialog?: HTMLDialogElement;
    private request?: AbortController;
    private version = 0;
    private removed = false;
    private releaseConnection: () => void;
    private releaseStop: () => void;
    private events = new AbortController();

    constructor(data: Attr) {
        super(data);
        this.ports = [this.inputPort, this.outputPort];
        this.releaseConnection = this.inputPort.subscribeConnections(() => {
            this.inputPort.setPortValue(this.inputPort.sources.length === 1
                ? this.inputPort.sources[0].value : undefined);
        });
        this.answerView = document.createElement("textarea");
        this.answerView.readOnly = true;
        this.answerView.setAttribute("aria-label", "AI回答・エラー");
        this.answerView.style.cssText = "position:absolute;box-sizing:border-box;width:288px;height:140px;resize:none;z-index:100;font:14px sans-serif;white-space:pre-wrap";
        this.answerView.hidden = this.inToolbox;
        if (!this.inToolbox) (document.getElementById("layer-diagram") || document.body).appendChild(this.answerView);
        this.connectButton = new Button({ text: "接続", click: () => this.openConnectionDialog() });
        this.disconnectButton = new Button({ text: "切断", click: () => this.disconnect() });
        this.releaseStop = subscribeDiagramStop(() => {
            this.closeDialog();
            if (this.connecting) {
                this.version++; this.request?.abort(); this.connecting = false;
                this.show("接続を中断しました");
            }
        });
        window.addEventListener("pagehide", () => this.disconnect(), { signal: this.events.signal });
        this.setBoxSize();
        this.refreshButtons();
    }

    get connected(): boolean { return !!this.#apiKey; }
    children(): UI[] { return [this.connectButton, this.disconnectButton]; }
    setBoxSize(): void { this.boxSize = new Vec2(320, this.inToolbox ? 60 : 310); }
    setPosition(position: Vec2): void {
        super.setPosition(position);
        this.answerView.style.left = `${position.x + 16}px`;
        this.answerView.style.top = `${position.y + 136}px`;
        this.positionButtons();
    }

    setPortPositions(): void { super.setPortPositions(); this.positionButtons(); }

    private positionButtons(): void {
        if (!this.connectButton) return;
        this.connectButton.setPosition(this.position.add(new Vec2(16, 80)));
        this.disconnectButton.setPosition(this.position.add(new Vec2(166, 80)));
        for (const button of this.children() as Button[]) button.boxSize = new Vec2(138, 44);
    }

    private refreshButtons(): void {
        if (!this.connectButton) return;
        this.connectButton.text = this.connected ? "キー変更" : "接続";
        this.connectButton.disabled = this.removed || this.inToolbox || !!this.request;
        this.disconnectButton.disabled = this.removed || this.inToolbox || (!this.connected && !this.connecting);
        this.positionButtons();
        theCanvas?.requestUpdateCanvas();
    }

    makeObj(): any { return { ...super.makeObj(), model: this.model }; }
    loadObj(obj: any): void {
        this.disconnect();
        if (typeof obj.model === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(obj.model)) this.model = obj.model;
    }

    private closeDialog(): void {
        if (!this.dialog) return;
        this.dialog.querySelectorAll("input").forEach(input => { input.value = ""; });
        this.dialog.close(); this.dialog.remove(); this.dialog = undefined;
    }

    openConnectionDialog(): void {
        if (this.removed || this.inToolbox || this.request || this.dialog) return;
        const dialog = this.dialog = document.createElement("dialog");
        dialog.setAttribute("aria-label", "Googleに接続");
        dialog.style.cssText = "box-sizing:border-box;width:min(420px,calc(100vw - 32px));border:2px solid #35658a;border-radius:8px;padding:20px;font:16px sans-serif";
        const form = document.createElement("form");
        const title = document.createElement("h3"); title.textContent = "Googleに接続";
        const makeInput = (text: string, type: string, value = "") => {
            const label = document.createElement("label"); label.textContent = text;
            label.style.cssText = "display:block;margin:12px 0";
            const input = document.createElement("input"); input.type = type; input.value = value;
            input.setAttribute("aria-label", text); input.autocomplete = "off"; input.spellcheck = false;
            input.style.cssText = "display:block;box-sizing:border-box;width:100%;font:inherit;margin-top:4px";
            label.appendChild(input); form.appendChild(label); return input;
        };
        form.appendChild(title);
        const key = makeInput("APIキー", "password");
        const model = makeInput("モデル名", "text", this.model);
        const note = document.createElement("p"); note.textContent = "キーはこのブロックで一時保持し、保存・コピーには含めません。";
        const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "キャンセル";
        const connect = document.createElement("button"); connect.type = "submit"; connect.textContent = "接続";
        cancel.addEventListener("click", () => this.closeDialog());
        dialog.addEventListener("cancel", event => { event.preventDefault(); this.closeDialog(); });
        form.addEventListener("submit", event => {
            event.preventDefault();
            let apiKey = key.value.trim();
            const modelName = model.value.trim().replace(/^models\//, "");
            this.closeDialog();
            void this.connect(apiKey, modelName);
            apiKey = "";
        });
        form.append(note, cancel, connect); dialog.appendChild(form);
        (document.getElementById("layer-diagram") || document.body).appendChild(dialog);
        dialog.showModal(); key.focus();
    }

    async connect(apiKey: string, model = this.model): Promise<void> {
        if (this.removed || this.inToolbox || this.request) return;
        this.disconnect();
        if (!apiKey.trim() || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(model)) {
            this.show("接続エラー", "APIキーとモデル名を入力してください。"); return;
        }
        const version = ++this.version, request = this.request = new AbortController();
        const current = () => !this.removed && version === this.version;
        this.connecting = true; this.show("接続確認中…"); this.refreshButtons();
        try {
            await waitAIRequest(request, 10_000, () => checkAIConnection(apiKey.trim(), model, request.signal));
            if (!current() || request.signal.aborted) return;
            this.#apiKey = apiKey.trim(); this.model = model;
            this.show("接続確認済み：Startで質問");
        } catch (error) {
            if (current()) this.show("接続エラー", request.signal.aborted ? "接続確認が時間切れになりました。"
                : error instanceof AIRequestError ? error.message : "Googleへ接続できませんでした。通信状態を確認してください。");
        } finally {
            apiKey = "";
            if (this.request === request) this.request = undefined;
            if (current()) this.connecting = false;
            this.refreshButtons();
        }
    }

    disconnect(): void {
        if (isRunning) stopDiagram();
        this.version++; this.#apiKey = ""; this.connecting = false;
        this.request?.abort(); this.closeDialog();
        this.outputPort.setPortValue(undefined);
        this.show("未接続"); this.refreshButtons();
    }

    copy(): AIChatBlock {
        const block = new AIChatBlock({});
        block.model = this.model;
        this.copyUI(block);
        block.setBoxSize();
        block.setBlockPortPosition(this.position.copy());
        return block;
    }

    private show(message: string, text = ""): void {
        this.message = message;
        this.answerView.value = text;
        this.refreshButtons();
        theCanvas?.requestUpdateCanvas();
    }

    resetForRun(): void {
        this.version++;
        this.request?.abort();
        this.connecting = false;
        this.outputPort.setPortValue(undefined);
        this.show(this.connected ? "待機中" : "未接続");
    }

    // Editing or connecting input never sends a question automatically.
    async valueChanged(): Promise<void> {}
    calc(): void {}

    async run(): Promise<void> {
        if (this.removed || this.inToolbox) return;
        this.resetForRun();
        const version = ++this.version;
        const request = this.request = new AbortController();
        const signal = getProcedureSignal();
        const current = () => !this.removed && version === this.version;
        const cancel = () => {
            if (current()) {
                this.outputPort.setPortValue(undefined);
                this.show("中断しました");
            }
            request.abort();
        };
        signal.addEventListener("abort", cancel, { once: true });
        try {
            if (signal.aborted) { cancel(); return; }
            const value = this.inputPort.sources.length === 1 ? this.inputPort.sources[0].value : undefined;
            const question = typeof value === "string" ? value.trim() : "";
            if (!question) throw new AIRequestError("質問を入力し、文字列ポートを接続してください。");
            if (question.length > 2000) throw new AIRequestError("質問は2,000文字以内で入力してください。");
            if (!this.connected) throw new AIRequestError("接続ボタンからAPIキーを入力してください。");
            this.show("送信中…");
            // Also settle immediately if an underlying transport ignores abort.
            const answer = await waitAIRequest(request, 35_000,
                () => askAI(this.#apiKey, this.model, question, request.signal));
            if (!current() || signal.aborted || request.signal.aborted) return;
            this.outputPort.setPortValue(answer);
            this.show("回答を取得しました", answer);
        } catch (error) {
            if (!current() || signal.aborted) return;
            this.outputPort.setPortValue(undefined);
            const message = request.signal.aborted ? "回答待ちが時間切れになりました。"
                : error instanceof AIRequestError ? error.message
                : "通信に失敗しました。Googleへの接続を確認してください。";
            this.show("エラー", message);
            // Reject the Start phase so no TTS or other action executes.
            throw new Error(message);
        } finally {
            signal.removeEventListener("abort", cancel);
            if (this.request === request) this.request = undefined;
            this.refreshButtons();
        }
    }

    draw(): void {
        super.draw();
        const ctx = this.ctx, { x, y } = this.position;
        ctx.save();
        ctx.font = "18px sans-serif"; ctx.textBaseline = "top"; ctx.fillStyle = "#17384f";
        ctx.fillText("AIチャット", x + 16, y + 26);
        if (!this.inToolbox) {
            ctx.font = "14px sans-serif";
            ctx.fillText(this.message, x + 16, y + 52, 288);
            ctx.fillText(this.connected ? "キー保持中" : "キー未設定", x + 186, y + 28);
            this.children().forEach(button => button.draw());
        }
        ctx.restore();
    }

    clearBlock(): void {
        if (this.removed) return;
        if (isRunning) stopDiagram();
        this.disconnect();
        this.removed = true;
        this.version++;
        this.request?.abort();
        this.outputPort.setPortValue(undefined);
        this.releaseConnection();
        this.releaseStop(); this.events.abort();
        this.answerView.remove();
        super.clearBlock();
    }
}

registerFunctionBlock(AIChatBlock.name, () => new AIChatBlock({}));
