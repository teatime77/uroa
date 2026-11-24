/**
 * カメラの単一フレームを使うAIブロックの接続・取消・結果表示を共通化する。画像の取得元はCameraBlock、送信内容と結果出力は派生型が担当する。
 */
import { Vec2 } from "@i18n";
import { CameraBlock, FunctionBlock } from "../block";
import { PortType, theCanvas } from "../diagram_util";
import { Port } from "../port";
import { getProcedureSignal, isRunning, stopDiagram, subscribeDiagramStop } from "../runtime";
import { Button, type Attr, type UI } from "../ui";
import { AIRequestError, checkAIConnection, waitAIRequest } from "./ai-client";

/**
 * 画像説明と物体検出のUIを共通化するタスク設定。
 */
export interface CameraAITask {
    /**
     * ブロック名・接続・結果表示に使う解析タスクの名前。
     */
    readonly title: string;
    /**
     * 説明・検出等の操作名。状態とエラーメッセージに使う。
     */
    readonly action: string;
    /**
     * 手動で一回だけ解析するボタンの表示文字列。
     */
    readonly buttonText: string;
    /**
     * 出力ポートの役割を画面に示すラベル。
     */
    readonly outputLabel: string;
    /**
     * 結果表示欄の高さ（pixel）。未指定時は共通の既定値を使う。
     */
    readonly resultHeight?: number;
}

/**
 * 固定画像をキャンバス上へ描く矩形。
 */
export interface SnapshotBounds { /** 固定画像を描画する矩形の左端（pixel）。 */ readonly left: number; /** 固定画像を描画する矩形の上端（pixel）。 */ readonly top: number; /** 固定画像の描画矩形の幅（pixel）。 */ readonly width: number; /** 固定画像の描画矩形の高さ（pixel）。 */ readonly height: number; }

/** An explicit, single-frame cloud request; camera capture remains owned by CameraBlock. */
export abstract class CameraAIBlock<Result> extends FunctionBlock {
    /**
     * Start時の依存順実行の対象に含める指定。
     */
    override readonly runOnStart = true;
    /**
     * 画像供給元のCameraBlockを一つ接続する入力ポート。
     */
    readonly cameraPort = new Port(this, PortType.inputPort, "カメラ");
    /**
     * 接続確認と明示的なAI要求で使用するモデル名。図の保存対象。
     */
    model = "gemini-3.8-flash";
    /**
     * このブロックだけが一時保持するAPIキー。図の保存・コピーへ含めない。
     */
    #apiKey = "";
    /**
     * 接続・処理中・完了・エラーを画面へ示す状態メッセージ。
     */
    private message = "未接続";
    /**
     * 現在の接続確認または解析要求を取り消す制御元。
     */
    private request?: AbortController;
    /**
     * 削除・取消・新しい要求の後に古い非同期結果を反映しないための世代。
     */
    private version = 0;
    /**
     * 削除済みの部品に非同期結果を反映しないための状態。
     */
    private removed = false;
    /**
     * 現在開いているキー・モデルの入力ダイアログ。閉じると入力値も消去する。
     */
    private dialog?: HTMLDialogElement;
    /**
     * 現在接続されている画像供給元のブロック。
     */
    private camera?: CameraBlock;
    /**
     * 画像供給元のフレーム変更通知を解除する関数。
     */
    private releaseCamera?: () => void;
    /**
     * 入力ポートの接続変更通知を解除する関数。
     */
    private readonly releaseConnection: () => void;
    /**
     * diagram停止通知の購読を解除する関数。
     */
    private readonly releaseStop: () => void;
    /**
     * この部品で登録したDOMイベントをまとめて解除するための取消元。
     */
    private readonly events = new AbortController();
    /**
     * 解析開始時に固定し、結果と一緒に表示する縮小画像。
     */
    private snapshot?: HTMLCanvasElement;
    /**
     * 送信時のフレーム世代。応答時の入力変更検査に使う。
     */
    private capturedRevision?: number;
    /**
     * 送信時の元画像の幅。入力状態の変化を検査する。
     */
    private capturedWidth = 0;
    /**
     * 送信時の元画像の高さ。入力状態の変化を検査する。
     */
    private capturedHeight = 0;
    /**
     * 現世代で解析が完了した結果。取消時は消去する。
     */
    protected result?: Result;
    /**
     * 結果またはエラーを表示する読取り専用のテキスト欄。
     */
    private readonly resultView: HTMLTextAreaElement;
    /**
     * キーとモデルの接続確認を開始するボタン。
     */
    private readonly connectButton: Button;
    /**
     * キーの保持と進行中の要求を終了するボタン。
     */
    private readonly disconnectButton: Button;
    /**
     * 現在の画像で一回だけ解析を行うボタン。
     */
    private readonly analyzeButton: Button;
    /**
     * 進行中の解析を中断して結果を消去するボタン。
     */
    private readonly stopButton: Button;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data: Attr, /** 派生ブロックが指定する表示名・操作名・結果欄の設定。 */ private readonly task: CameraAITask) {
        super(data);
        this.ports = [this.cameraPort];
        this.resultView = document.createElement("textarea");
        this.resultView.readOnly = true;
        this.resultView.setAttribute("aria-label", `${task.title}の結果・エラー`);
        this.resultView.style.cssText = `position:absolute;box-sizing:border-box;width:328px;height:${task.resultHeight ?? 56}px;resize:none;z-index:100;font:14px sans-serif`;
        this.resultView.hidden = this.inToolbox;
        if (!this.inToolbox) (document.getElementById("layer-diagram") || document.body).appendChild(this.resultView);
        this.connectButton = new Button({ text: "接続", click: () => this.openConnectionDialog() });
        this.disconnectButton = new Button({ text: "切断", click: () => this.disconnect() });
        this.analyzeButton = new Button({ text: task.buttonText, click: () => this.analyze() });
        this.stopButton = new Button({ text: `${task.action}停止`, click: () => this.cancel("中断しました") });
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

    /**
     * 固定したJPEG画像を送信し、派生ブロックが必要とする解析結果を返す。
     *
     * @param apiKey 要求中だけ使用するAPIキー。
     * @param model 利用するモデル名。
     * @param jpeg Base64化したJPEG画像データ。
     * @param signal 処理を取り消すシグナル。
     */
    protected abstract sendImage(apiKey: string, model: string, jpeg: string, signal: AbortSignal): Promise<Result>;
    /**
     * 解析結果を出力ポートへ反映し、状態表示と結果欄の文字列を返す。
     */
    protected abstract publishResult(result: Result): { /** 接続・処理中・完了・エラーを画面へ示す状態メッセージ。 */ message: string; /** 処理結果として表示する文字列。 */ text: string };
    /**
     * 固定画像の表示矩形へ解析結果を重ねるための描画入口。
     */
    protected drawResult(_ctx: CanvasRenderingContext2D, _bounds: SnapshotBounds, _result: Result): void {}

    /**
     * この部品が所有する、描画や操作の対象となる子UIを返す。
     */
    children(): UI[] { return this.inToolbox ? [] : [this.connectButton, this.disconnectButton, this.analyzeButton, this.stopButton]; }
    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize(): void { this.boxSize = new Vec2(360, this.inToolbox ? 60 : 530 + (this.task.resultHeight ?? 56) - 56); }
    /**
     * 部品の基準座標を更新する。
     *
     * @param position 基準となる座標またはソース内の位置。
     */
    setPosition(position: Vec2): void {
        super.setPosition(position); this.positionControls();
        this.resultView.style.left = `${position.x + 16}px`;
        this.resultView.style.top = `${position.y + 440}px`;
    }
    /**
     * ブロックの現在位置と大きさに合わせてポートを配置する。
     */
    setPortPositions(): void { super.setPortPositions(); this.positionControls(); }
    /**
     * ブロックの位置に合わせて操作ボタンを配置する。
     */
    private positionControls(): void {
        if (!this.connectButton) return;
        for (const [i, button] of [this.connectButton, this.disconnectButton, this.analyzeButton, this.stopButton].entries()) {
            button.setPosition(this.position.add(new Vec2(16 + (i % 2) * 172, 80 + Math.floor(i / 2) * 48)));
            button.boxSize = new Vec2(156, 44);
        }
    }
    /**
     * 接続・解析・入力と実行状態に合わせて各操作ボタンを更新する。
     */
    private refresh(): void {
        const disabled = this.removed || this.inToolbox;
        this.connectButton.text = this.#apiKey ? "キー変更" : "接続";
        this.connectButton.disabled = disabled || !!this.request;
        this.disconnectButton.disabled = disabled || (!this.#apiKey && !this.request);
        this.analyzeButton.disabled = disabled || !this.#apiKey || !!this.request;
        this.stopButton.disabled = disabled || !this.request;
        this.positionControls(); theCanvas?.requestUpdateCanvas();
    }
    /**
     * 状態メッセージと結果欄を更新し、操作状態とキャンバスを再描画する。
     *
     * @param message 画面または診断に表示する説明。
     */
    private show(message: string, detail = ""): void {
        this.message = message; this.resultView.value = detail; this.refresh();
    }
    /**
     * 入力がCameraBlock一つから供給されている場合にそのブロックを返す。
     */
    private cameraSource(): CameraBlock | undefined {
        const sources = this.cameraPort.sources;
        return sources.length === 1 && sources[0].parent instanceof CameraBlock ? sources[0].parent : undefined;
    }
    /**
     * 画像供給元の変更を購読し、取得後に画像が変われば解析結果を失効させる。
     */
    private bindCamera(): void {
        this.releaseCamera?.(); this.camera = this.cameraSource();
        this.releaseCamera = this.camera?.subscribeFrameState(() => {
            if (this.capturedRevision === undefined) return;
            const frame = this.camera?.getFrame();
            if (!frame || frame.revision !== this.capturedRevision || frame.width !== this.capturedWidth || frame.height !== this.capturedHeight) {
                this.cancel(`カメラの状態が変わりました。再度${this.task.action}してください。`);
                if (isRunning) stopDiagram();
            }
        });
    }
    /**
     * 現要求の世代を失効させ、通信・固定画像・結果と全出力を消去する。
     *
     * @param message 画面または診断に表示する説明。
     */
    private cancel(message = "待機中"): void {
        this.version++; this.request?.abort(); this.request = undefined;
        this.snapshot = undefined; this.capturedRevision = undefined; this.result = undefined;
        this.outputPorts().forEach(port => port.setPortValue(undefined));
        this.show(message);
    }
    /**
     * 前回の要求を取り消して出力を消去し、次の明示実行を待つ。
     */
    resetForRun(): void { this.closeDialog(); this.cancel(); }
    /**
     * 入力の変更だけでは送信や認識を始めず、明示実行を待つ。
     */
    async valueChanged(): Promise<void> {}
    /**
     * 入力の変更だけでは外部要求を開始しないため、計算時には処理を行わない。
     */
    calc(): void {}

    /**
     * 現在の画像を一枚固定して期限付きで解析し、同じ画像世代の応答だけを反映する。
     *
     * @param outerSignal 呼出し元の実行を取り消すシグナル。
     */
    async analyze(outerSignal?: AbortSignal): Promise<void> {
        if (this.removed || this.inToolbox || (isRunning && !outerSignal)) return;
        this.cancel(); this.bindCamera();
        const version = ++this.version, request = this.request = new AbortController();
        const current = () => !this.removed && version === this.version;
        const abort = () => { if (current()) this.cancel("中断しました"); };
        outerSignal?.addEventListener("abort", abort, { once: true });
        try {
            if (outerSignal?.aborted) { abort(); return; }
            if (document.hidden) throw new AIRequestError(`画面を表示してから${this.task.action}してください。`);
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
            const result = await waitAIRequest(request, 60_000,
                () => this.sendImage(this.#apiKey, this.model, jpeg, request.signal));
            if (!current() || request.signal.aborted || outerSignal?.aborted) return;
            const latest = this.camera?.getFrame();
            if (!latest || latest.revision !== frame.revision || latest.width !== frame.width || latest.height !== frame.height) {
                throw new AIRequestError(`カメラの状態が変わりました。再度${this.task.action}してください。`);
            }
            this.result = result;
            const output = this.publishResult(result);
            this.show(output.message, output.text);
        } catch (error) {
            if (!current() || outerSignal?.aborted) return;
            const message = request.signal.aborted ? `${this.task.title}が時間切れになりました。再度${this.task.action}してください。`
                : error instanceof AIRequestError ? error.message : `${this.task.title}に失敗しました。通信状態を確認してください。`;
            this.cancel(`${this.task.action}エラー`); this.show(`${this.task.action}エラー`, message);
            if (outerSignal) throw new Error(message);
        } finally {
            outerSignal?.removeEventListener("abort", abort);
            if (this.request === request) this.request = undefined;
            this.refresh();
        }
    }
    /**
     * Startの取消シグナルで一回解析し、未完了なら後続アクションを開始させない。
     */
    async run(): Promise<void> {
        const signal = getProcedureSignal();
        await this.analyze(signal);
        if (!signal.aborted && this.result === undefined) throw new Error(`${this.task.title}を完了できませんでした。`);
    }

    /**
     * 入力値を消去し、接続ダイアログを閉じてDOMから除く。
     */
    private closeDialog(): void {
        if (!this.dialog) return;
        this.dialog.querySelectorAll("input").forEach(input => { input.value = ""; });
        this.dialog.close(); this.dialog.remove(); this.dialog = undefined;
    }
    /**
     * キーとモデルを入力するダイアログを開く。表示だけでは画像や質問を送信しない。
     */
    private openConnectionDialog(): void {
        if (this.removed || this.inToolbox || this.request || this.dialog || isRunning) return;
        const dialog = this.dialog = document.createElement("dialog");
        dialog.setAttribute("aria-label", `${this.task.title}に接続`);
        dialog.style.cssText = "box-sizing:border-box;width:min(420px,calc(100vw - 32px));padding:20px;font:16px sans-serif";
        const form = document.createElement("form");
        const title = document.createElement("h3"); title.textContent = `${this.task.title}の接続`;
        const keyLabel = document.createElement("label"); keyLabel.textContent = "APIキー";
        const key = document.createElement("input"); key.type = "password"; key.name = "api-key"; key.autocomplete = "current-password"; key.required = true;
        const modelLabel = document.createElement("label"); modelLabel.textContent = "画像入力対応のモデル名";
        const model = document.createElement("input"); model.value = this.model; model.required = true; model.autocomplete = "off";
        for (const [label, input] of [[keyLabel, key], [modelLabel, model]] as const) {
            label.style.cssText = "display:block;margin:12px 0";
            input.style.cssText = "display:block;width:100%;box-sizing:border-box;font:16px sans-serif"; label.appendChild(input);
        }
        const note = document.createElement("p"); note.textContent = `キーはこのブロックで一時保持します。${this.task.action}時にカメラ画像をGoogleへ送ります。図にキーや画像を保存しません。`;
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
    /**
     * 指定キーとモデルの利用可否を期限付きで確認し、現世代で成功した場合だけ保持する。
     *
     * @param apiKey 要求中だけ使用するAPIキー。
     * @param model 利用するモデル名。
     */
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
            this.show("接続確認済み", `画像は「${this.task.buttonText}」またはStartで送信します。`);
        } catch (error) {
            if (current()) this.show("接続エラー", request.signal.aborted ? "接続確認が時間切れになりました。"
                : error instanceof AIRequestError ? error.message : "Googleへ接続できませんでした。");
        } finally {
            apiKey = "";
            if (this.request === request) this.request = undefined;
            this.refresh();
        }
    }
    /**
     * 進行中の実行を停止し、要求・キー・出力と入力ダイアログを消去する。
     */
    disconnect(): void {
        if (isRunning) stopDiagram();
        this.#apiKey = ""; this.closeDialog(); this.cancel("未接続");
    }
    /**
     * 図の保存に必要な設定をJSON化可能なオブジェクトへ変換する。
     */
    makeObj(): any { return { ...super.makeObj(), model: this.model }; }
    /**
     * 保存オブジェクトからこの要素の設定を復元する。
     *
     * @param obj 復元する保存オブジェクト。
     */
    loadObj(obj: any): void {
        this.disconnect();
        if (typeof obj.model === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(obj.model)) this.model = obj.model;
    }
    /**
     * この部品の枠・内容・操作状態をキャンバスへ描く。
     */
    draw(): void {
        super.draw();
        const ctx = this.ctx, { x, y } = this.position;
        ctx.save(); ctx.textBaseline = "top"; ctx.fillStyle = "#17384f"; ctx.font = "18px sans-serif";
        ctx.fillText(this.task.title, x + 16, y + 26);
        if (!this.inToolbox) {
            ctx.font = "14px sans-serif"; ctx.fillText(this.message, x + 16, y + 52, 328);
            this.children().forEach(button => button.draw());
            if (this.snapshot) {
                const scale = Math.min(328 / this.snapshot.width, 246 / this.snapshot.height);
                const width = this.snapshot.width * scale, height = this.snapshot.height * scale;
                const left = x + 16 + (328 - width) / 2, top = y + 184 + (246 - height) / 2;
                ctx.drawImage(this.snapshot, left, top, width, height);
                if (this.result !== undefined) this.drawResult(ctx, { left, top, width, height }, this.result);
            }
            ctx.fillStyle = "#17384f"; ctx.fillText(this.task.outputLabel, x + 16, y + this.boxSize.y - 25);
        }
        ctx.restore();
    }
    /**
     * 接続・イベント・所有資源を解放してブロックを削除可能にする。
     */
    clearBlock(): void {
        if (this.removed) return;
        this.disconnect(); this.removed = true;
        this.releaseCamera?.(); this.releaseConnection(); this.releaseStop(); this.events.abort();
        this.resultView.remove(); super.clearBlock();
    }
}

