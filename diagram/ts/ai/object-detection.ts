import { Vec2 } from "@i18n";
import { CameraBlock, FunctionBlock, registerFunctionBlock } from "../block";
import { PortType, theCanvas } from "../diagram_util";
import { NumberPort, Port, StructPort, TextPort } from "../port";
import { getProcedureSignal, isRunning, stopDiagram, subscribeDiagramStop } from "../runtime";
import { Button, type Attr, type UI } from "../ui";
import { AIRequestError, checkAIConnection, waitAIRequest } from "./ai-client";
import { detectGeminiObjects, type DetectedObject } from "./gemini-vision-client";
import { Field, Struct, numberType, stringType } from "../data_type";

const detectionStruct = new Struct("ObjectDetection", [new Field("label", stringType),
    ...["x", "y", "width", "height"].map(name => new Field(name, numberType))]);

/** An explicit, single-frame cloud request; camera capture remains owned by CameraBlock. */
export class ObjectDetectionBlock extends FunctionBlock {
    override readonly runOnStart = true;
    readonly cameraPort = new Port(this, PortType.inputPort, "カメラ");
    readonly labelsPort = new TextPort(this, PortType.outputPort, "ラベル");
    readonly countPort = new NumberPort(this, PortType.outputPort, "個数");
    readonly objectPort = new StructPort(this, PortType.outputPort, detectionStruct, "先頭の物体");
    model = "gemini-3.8-flash";
    #apiKey = "";
    private message = "未接続";
    private request?: AbortController;
    private version = 0;
    private removed = false;
    private dialog?: HTMLDialogElement;
    private camera?: CameraBlock;
    private releaseCamera?: () => void;
    private readonly releaseConnection: () => void;
    private readonly releaseStop: () => void;
    private readonly events = new AbortController();
    private snapshot?: HTMLCanvasElement;
    private capturedRevision?: number;
    private capturedWidth = 0;
    private capturedHeight = 0;
    private objects: readonly DetectedObject[] = [];
    private readonly resultView: HTMLTextAreaElement;
    private readonly connectButton: Button;
    private readonly disconnectButton: Button;
    private readonly detectButton: Button;
    private readonly stopButton: Button;

    constructor(data: Attr) {
        super(data);
        this.ports = [this.cameraPort, this.labelsPort, this.countPort, this.objectPort];
        this.resultView = document.createElement("textarea");
        this.resultView.readOnly = true;
        this.resultView.setAttribute("aria-label", "Gemini物体検出の結果・エラー");
        this.resultView.style.cssText = "position:absolute;box-sizing:border-box;width:328px;height:56px;resize:none;z-index:100;font:14px sans-serif";
        this.resultView.hidden = this.inToolbox;
        if (!this.inToolbox) (document.getElementById("layer-diagram") || document.body).appendChild(this.resultView);
        this.connectButton = new Button({ text: "接続", click: () => this.openConnectionDialog() });
        this.disconnectButton = new Button({ text: "切断", click: () => this.disconnect() });
        this.detectButton = new Button({ text: "1回検出", click: () => this.detect() });
        this.stopButton = new Button({ text: "検出停止", click: () => this.cancel("中断しました") });
        this.releaseConnection = this.cameraPort.subscribeConnections(() => {
            this.cancel("カメラの接続を変更しました"); this.bindCamera();
        });
        this.releaseStop = subscribeDiagramStop(() => { this.closeDialog(); this.cancel("中断しました"); });
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) { this.closeDialog(); this.cancel("中断しました"); }
        }, { signal: this.events.signal });
        window.addEventListener("pagehide", () => this.disconnect(), { signal: this.events.signal });
        this.setBoxSize(); this.refresh();
    }

    children(): UI[] { return this.inToolbox ? [] : [this.connectButton, this.disconnectButton, this.detectButton, this.stopButton]; }
    setBoxSize(): void { this.boxSize = new Vec2(360, this.inToolbox ? 60 : 530); }
    setPosition(position: Vec2): void {
        super.setPosition(position); this.positionControls();
        this.resultView.style.left = `${position.x + 16}px`;
        this.resultView.style.top = `${position.y + 440}px`;
    }
    setPortPositions(): void { super.setPortPositions(); this.positionControls(); }
    private positionControls(): void {
        if (!this.connectButton) return;
        for (const [i, button] of [this.connectButton, this.disconnectButton, this.detectButton, this.stopButton].entries()) {
            button.setPosition(this.position.add(new Vec2(16 + (i % 2) * 172, 80 + Math.floor(i / 2) * 48)));
            button.boxSize = new Vec2(156, 44);
        }
    }
    private refresh(): void {
        const disabled = this.removed || this.inToolbox;
        this.connectButton.text = this.#apiKey ? "キー変更" : "接続";
        this.connectButton.disabled = disabled || !!this.request;
        this.disconnectButton.disabled = disabled || (!this.#apiKey && !this.request);
        this.detectButton.disabled = disabled || !this.#apiKey || !!this.request;
        this.stopButton.disabled = disabled || !this.request;
        this.positionControls(); theCanvas?.requestUpdateCanvas();
    }
    private show(message: string, detail = ""): void {
        this.message = message; this.resultView.value = detail; this.refresh();
    }
    private cameraSource(): CameraBlock | undefined {
        const sources = this.cameraPort.sources;
        return sources.length === 1 && sources[0].parent instanceof CameraBlock ? sources[0].parent : undefined;
    }
    private bindCamera(): void {
        this.releaseCamera?.(); this.camera = this.cameraSource();
        this.releaseCamera = this.camera?.subscribeFrameState(() => {
            if (this.capturedRevision === undefined) return;
            const frame = this.camera?.getFrame();
            if (!frame || frame.revision !== this.capturedRevision || frame.width !== this.capturedWidth || frame.height !== this.capturedHeight) {
                this.cancel("カメラの状態が変わりました。再度検出してください。");
                if (isRunning) stopDiagram();
            }
        });
    }
    private cancel(message = "待機中"): void {
        this.version++; this.request?.abort(); this.request = undefined;
        this.snapshot = undefined; this.capturedRevision = undefined; this.objects = [];
        this.labelsPort.setPortValue(undefined); this.countPort.setPortValue(undefined); this.objectPort.setPortValue(undefined);
        this.show(message);
    }
    resetForRun(): void { this.closeDialog(); this.cancel(); }
    async valueChanged(): Promise<void> {}
    calc(): void {}

    async detect(outerSignal?: AbortSignal): Promise<void> {
        if (this.removed || this.inToolbox || (isRunning && !outerSignal)) return;
        this.cancel(); this.bindCamera();
        const version = ++this.version, request = this.request = new AbortController();
        const current = () => !this.removed && version === this.version;
        const abort = () => { if (current()) this.cancel("中断しました"); };
        outerSignal?.addEventListener("abort", abort, { once: true });
        try {
            if (outerSignal?.aborted) { abort(); return; }
            if (document.hidden) throw new AIRequestError("画面を表示してから検出してください。");
            if (!this.#apiKey) throw new AIRequestError("接続ボタンからGemini APIキーを入力してください。");
            const frame = this.camera?.getFrame();
            if (!frame || frame.width <= 0 || frame.height <= 0) throw new AIRequestError("CameraBlockを1つ接続し、先にカメラ画像を表示してください。");
            const snapshot = document.createElement("canvas"), scale = Math.min(1, 1024 / Math.max(frame.width, frame.height));
            snapshot.width = Math.max(1, Math.round(frame.width * scale));
            snapshot.height = Math.max(1, Math.round(frame.height * scale));
            const ctx = snapshot.getContext("2d");
            if (!ctx) throw new AIRequestError("カメラ画像を取得できませんでした。");
            let jpeg: string;
            try {
                ctx.drawImage(frame.image, 0, 0, snapshot.width, snapshot.height);
                jpeg = snapshot.toDataURL("image/jpeg", 0.8).split(",")[1];
                if (!jpeg) throw new Error();
            } catch { throw new AIRequestError("画像を取り込めません。カメラ画像とCORS設定を確認してください。"); }
            this.snapshot = snapshot; this.capturedRevision = frame.revision;
            this.capturedWidth = frame.width; this.capturedHeight = frame.height;
            this.show(`画像をGoogleへ送信中…:${frame.width}x${frame.height}`);
            const objects = await waitAIRequest(request, 60_000,
                () => detectGeminiObjects(this.#apiKey, this.model, jpeg, request.signal));
            if (!current() || request.signal.aborted || outerSignal?.aborted) return;
            const latest = this.camera?.getFrame();
            if (!latest || latest.revision !== frame.revision || latest.width !== frame.width || latest.height !== frame.height) {
                throw new AIRequestError("カメラの状態が変わりました。再度検出してください。");
            }
            this.objects = objects;
            const labels = [...new Set(objects.map(object => object.label))].join("、");
            this.labelsPort.setPortValue(labels); this.countPort.setPortValue(objects.length);
            this.objectPort.setPortValue(objects[0]);
            this.show(`${objects.length}個検出`, labels || "検出した物体はありません。");
        } catch (error) {
            if (!current() || outerSignal?.aborted) return;
            const message = request.signal.aborted ? "物体検出が時間切れになりました。再度検出してください。"
                : error instanceof AIRequestError ? error.message : "物体検出に失敗しました。通信状態を確認してください。";
            this.cancel("検出エラー"); this.show("検出エラー", message);
            if (outerSignal) throw new Error(message);
        } finally {
            outerSignal?.removeEventListener("abort", abort);
            if (this.request === request) this.request = undefined;
            this.refresh();
        }
    }
    async run(): Promise<void> {
        const signal = getProcedureSignal();
        await this.detect(signal);
        if (!signal.aborted && this.labelsPort.value === undefined) throw new Error("物体検出を完了できませんでした。");
    }

    private closeDialog(): void {
        if (!this.dialog) return;
        this.dialog.querySelectorAll("input").forEach(input => { input.value = ""; });
        this.dialog.close(); this.dialog.remove(); this.dialog = undefined;
    }
    private openConnectionDialog(): void {
        if (this.removed || this.inToolbox || this.request || this.dialog || isRunning) return;
        const dialog = this.dialog = document.createElement("dialog");
        dialog.setAttribute("aria-label", "Gemini物体検出に接続");
        dialog.style.cssText = "box-sizing:border-box;width:min(420px,calc(100vw - 32px));padding:20px;font:16px sans-serif";
        const form = document.createElement("form");
        const title = document.createElement("h3"); title.textContent = "Gemini物体検出の接続";
        const keyLabel = document.createElement("label"); keyLabel.textContent = "APIキー";
        const key = document.createElement("input"); key.type = "password"; key.name = "api-key"; key.autocomplete = "current-password"; key.required = true;
        const modelLabel = document.createElement("label"); modelLabel.textContent = "画像入力対応のモデル名";
        const model = document.createElement("input"); model.value = this.model; model.required = true; model.autocomplete = "off";
        for (const [label, input] of [[keyLabel, key], [modelLabel, model]] as const) {
            label.style.cssText = "display:block;margin:12px 0";
            input.style.cssText = "display:block;width:100%;box-sizing:border-box;font:16px sans-serif"; label.appendChild(input);
        }
        const note = document.createElement("p"); note.textContent = "キーはこのブロックで一時保持します。検出時にカメラ画像をGoogleへ送ります。図にキーや画像を保存しません。";
        const submit = document.createElement("button"); submit.type = "submit"; submit.textContent = "接続確認";
        const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "キャンセル";
        cancel.onclick = () => this.closeDialog();
        form.append(title, keyLabel, modelLabel, note, submit, cancel); dialog.appendChild(form);
        form.onsubmit = event => {
            event.preventDefault();
            const apiKey = key.value.trim(), modelName = model.value.trim();
            this.closeDialog(); void this.connect(apiKey, modelName);
        };
        dialog.addEventListener("cancel", event => { event.preventDefault(); this.closeDialog(); });
        document.body.appendChild(dialog); dialog.showModal(); key.focus();
    }
    async connect(apiKey: string, model = this.model): Promise<void> {
        if (this.removed || this.inToolbox || this.request || isRunning) return;
        this.disconnect();
        if (!apiKey.trim() || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(model)) {
            this.show("接続エラー", "APIキーとモデル名を確認してください。"); return;
        }
        const version = ++this.version, request = this.request = new AbortController();
        const current = () => !this.removed && version === this.version;
        this.show("接続確認中…");
        try {
            await waitAIRequest(request, 10_000, () => checkAIConnection(apiKey.trim(), model, request.signal));
            if (!current() || request.signal.aborted) return;
            this.#apiKey = apiKey.trim(); this.model = model;
            this.show("接続確認済み", "画像は「1回検出」またはStartで送信します。");
        } catch (error) {
            if (current()) this.show("接続エラー", request.signal.aborted ? "接続確認が時間切れになりました。"
                : error instanceof AIRequestError ? error.message : "Googleへ接続できませんでした。");
        } finally {
            apiKey = "";
            if (this.request === request) this.request = undefined;
            this.refresh();
        }
    }
    disconnect(): void {
        if (isRunning) stopDiagram();
        this.#apiKey = ""; this.closeDialog(); this.cancel("未接続");
    }
    makeObj(): any { return { ...super.makeObj(), model: this.model }; }
    loadObj(obj: any): void {
        this.disconnect();
        if (typeof obj.model === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(obj.model)) this.model = obj.model;
    }
    copy(): ObjectDetectionBlock {
        const block = new ObjectDetectionBlock({}); block.model = this.model;
        this.copyUI(block); block.setBoxSize(); block.setBlockPortPosition(this.position.copy()); return block;
    }
    draw(): void {
        super.draw();
        const ctx = this.ctx, { x, y } = this.position;
        ctx.save(); ctx.textBaseline = "top"; ctx.fillStyle = "#17384f"; ctx.font = "18px sans-serif";
        ctx.fillText("Gemini物体検出", x + 16, y + 26);
        if (!this.inToolbox) {
            ctx.font = "14px sans-serif"; ctx.fillText(this.message, x + 16, y + 52, 328);
            this.children().forEach(button => button.draw());
            if (this.snapshot) {
                const scale = Math.min(328 / this.snapshot.width, 246 / this.snapshot.height);
                const width = this.snapshot.width * scale, height = this.snapshot.height * scale;
                const left = x + 16 + (328 - width) / 2, top = y + 184 + (246 - height) / 2;
                ctx.drawImage(this.snapshot, left, top, width, height);
                ctx.strokeStyle = "#dc2626"; ctx.lineWidth = 2;
                for (const object of this.objects) {
                    const bx = left + object.x * width, by = top + object.y * height;
                    ctx.strokeRect(bx, by, object.width * width, object.height * height);
                    const textWidth = Math.min(width, ctx.measureText(object.label).width + 8);
                    const tx = Math.max(left, Math.min(bx, left + width - textWidth));
                    const ty = Math.max(top, by - 18);
                    ctx.fillStyle = "#b91c1c"; ctx.fillRect(tx, ty, textWidth, 18);
                    ctx.fillStyle = "white"; ctx.fillText(object.label, tx + 4, ty + 1, textWidth - 8);
                }
            }
            ctx.fillStyle = "#17384f"; ctx.fillText("出力：ラベル／個数／先頭の物体", x + 16, y + 505);
        }
        ctx.restore();
    }
    clearBlock(): void {
        if (this.removed) return;
        this.disconnect(); this.removed = true;
        this.releaseCamera?.(); this.releaseConnection(); this.releaseStop(); this.events.abort();
        this.resultView.remove(); super.clearBlock();
    }
}

registerFunctionBlock(ObjectDetectionBlock.name, () => new ObjectDetectionBlock({}));
