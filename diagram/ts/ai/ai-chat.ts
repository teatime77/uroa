/**
 * 明示的なStartで質問を送り、回答を文字列ポートへ渡すAIチャットブロック。通信はai-client.ts、停止と依存順実行はruntime.tsへ委譲する。
 */
import { Vec2 } from "@i18n";
import { FunctionBlock, registerFunctionBlock } from "../block";
import { PortType, theCanvas } from "../diagram_util";
import { TextPort } from "../port";
import { getProcedureSignal, isRunning, stopDiagram, subscribeDiagramStop } from "../runtime";
import { Button, type Attr, type UI } from "../ui";
import { AIRequestError, askAI, checkAIConnection, waitAIRequest } from "./ai-client";

/** Application-held credentials live in private memory; optional persistence is browser-managed. */
export class AIChatBlock extends FunctionBlock {
    /**
     * Start時の依存順実行の対象に含める指定。
     */
    override readonly runOnStart = true;
    /**
     * ブロックの処理に渡す値の入力ポート。
     */
    readonly inputPort = new TextPort(this, PortType.inputPort);
    /**
     * 完了した結果を後続ブロックへ渡す出力ポート。中断・再実行時は消去する。
     */
    readonly outputPort = new TextPort(this, PortType.outputPort);
    /**
     * 回答またはエラーの全文を表示する読取り専用テキスト欄。
     */
    readonly answerView: HTMLTextAreaElement;
    /**
     * キーとモデルの接続確認を開始するボタン。
     */
    readonly connectButton: Button;
    /**
     * キーの保持と進行中の要求を終了するボタン。
     */
    readonly disconnectButton: Button;
    /**
     * 接続確認と明示的なAI要求で使用するモデル名。図の保存対象。
     */
    model = "gemini-3.5-flash-lite";
    /**
     * 接続・処理中・完了・エラーを画面へ示す状態メッセージ。
     */
    message = "待機中";
    /**
     * このブロックだけが一時保持するAPIキー。図の保存・コピーへ含めない。
     */
    #apiKey = "";
    /**
     * キーとモデルの接続確認中であることを示す状態。
     */
    private connecting = false;
    /**
     * 現在開いているキー・モデルの入力ダイアログ。閉じると入力値も消去する。
     */
    private dialog?: HTMLDialogElement;
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
     * 入力ポートの接続変更通知を解除する関数。
     */
    private releaseConnection: () => void;
    /**
     * diagram停止通知の購読を解除する関数。
     */
    private releaseStop: () => void;
    /**
     * この部品で登録したDOMイベントをまとめて解除するための取消元。
     */
    private events = new AbortController();

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
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

    /**
     * このブロックが接続確認済みのAPIキーを保持しているかを返す。
     */
    get connected(): boolean { return !!this.#apiKey; }
    /**
     * この部品が所有する、描画や操作の対象となる子UIを返す。
     */
    children(): UI[] { return [this.connectButton, this.disconnectButton]; }
    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize(): void { this.boxSize = new Vec2(320, this.inToolbox ? 60 : 310); }
    /**
     * 部品の基準座標を更新する。
     *
     * @param position 基準となる座標またはソース内の位置。
     */
    setPosition(position: Vec2): void {
        super.setPosition(position);
        this.answerView.style.left = `${position.x + 16}px`;
        this.answerView.style.top = `${position.y + 136}px`;
        this.positionButtons();
    }

    /**
     * ブロックの現在位置と大きさに合わせてポートを配置する。
     */
    setPortPositions(): void { super.setPortPositions(); this.positionButtons(); }

    /**
     * ブロックの位置と表示幅に合わせて接続・切断ボタンを配置する。
     */
    private positionButtons(): void {
        if (!this.connectButton) return;
        this.connectButton.setPosition(this.position.add(new Vec2(16, 80)));
        this.disconnectButton.setPosition(this.position.add(new Vec2(166, 80)));
        for (const button of this.children() as Button[]) button.boxSize = new Vec2(138, 44);
    }

    /**
     * 接続・要求中・削除状態から操作ボタンの表示と有効性を更新する。
     */
    private refreshButtons(): void {
        if (!this.connectButton) return;
        this.connectButton.text = this.connected ? "キー変更" : "接続";
        this.connectButton.disabled = this.removed || this.inToolbox || !!this.request;
        this.disconnectButton.disabled = this.removed || this.inToolbox || (!this.connected && !this.connecting);
        this.positionButtons();
        theCanvas?.requestUpdateCanvas();
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
    openConnectionDialog(): void {
        if (this.removed || this.inToolbox || this.request || this.dialog) return;
        const dialog = this.dialog = document.createElement("dialog");
        dialog.setAttribute("aria-label", "Googleに接続");
        dialog.style.cssText = "box-sizing:border-box;width:min(420px,calc(100vw - 32px));border:2px solid #35658a;border-radius:8px;padding:20px;font:16px sans-serif";
        const form = document.createElement("form");
        form.method = "post";
        form.name = "gemini-credentials";
        const title = document.createElement("h3"); title.textContent = "Gemini APIキー設定";
        const makeInput = (text: string, type: string, name: string, autocomplete: HTMLInputElement["autocomplete"], value = "") => {
            const label = document.createElement("label"); label.textContent = text;
            label.style.cssText = "display:block;margin:12px 0";
            const input = document.createElement("input"); input.type = type; input.value = value;
            input.name = name; input.autocomplete = autocomplete; input.required = true;
            input.setAttribute("aria-label", text); input.spellcheck = false; input.autocapitalize = "none";
            input.style.cssText = "display:block;box-sizing:border-box;width:100%;font:inherit;margin-top:4px";
            label.appendChild(input); form.appendChild(label); return input;
        };
        form.appendChild(title);
        const username = makeInput("ユーザー名", "text", "username", "username");
        username.placeholder = "例：gemini";
        username.pattern = ".*\\S.*";
        username.title = "空白以外の文字を含むユーザー名を入力してください。";
        const key = makeInput("APIキー", "password", "api-key", "current-password");
        const model = makeInput("モデル名", "text", "model", "off", this.model);
        const note = document.createElement("p"); note.textContent = "ユーザー名は保存したキーの識別用で、Googleへは送りません。接続成功後にChromeのパスワードマネージャーで保存できます。図の保存・コピーには含めません。";
        const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "キャンセル";
        const connect = document.createElement("button"); connect.type = "submit"; connect.textContent = "接続";
        cancel.addEventListener("click", () => this.closeDialog());
        dialog.addEventListener("cancel", event => { event.preventDefault(); this.closeDialog(); });
        form.addEventListener("submit", event => {
            event.preventDefault();
            let apiKey = key.value.trim();
            const credentialId = username.value.trim();
            if (!credentialId) { username.reportValidity(); return; }
            const modelName = model.value.trim().replace(/^models\//, "");
            this.closeDialog();
            void this.connect(apiKey, modelName, credentialId);
            apiKey = "";
        });
        form.append(note, cancel, connect); dialog.appendChild(form);
        (document.getElementById("layer-diagram") || document.body).appendChild(dialog);
        dialog.showModal(); username.focus();
    }

    /**
     * 接続成功後に、対応ブラウザーの資格情報保存UIへキーの保存候補を渡す。
     */
    private requestPasswordSave(username: string): void {
        // PasswordCredential is not included in TypeScript's DOM declarations.
        const PasswordCredential = (window as Window & {
            /**
             * 対応ブラウザーだけが提供するパスワード保存用コンストラクター。
             */
            PasswordCredential?: new (data: { /** ブラウザーの保存候補を識別するユーザー名。Googleへは送信しない。 */ id: string; /** ブラウザーのパスワード保存APIへ渡す一時的なキー文字列。 */ password: string }) => Credential;
        }).PasswordCredential;
        if (!username || !window.isSecureContext || typeof PasswordCredential !== "function" ||
            typeof navigator.credentials?.store !== "function") return;
        try {
            const credential = new PasswordCredential({ id: username, password: this.#apiKey });
            // Browser refusal or storage failure must neither break connection nor expose credentials.
            void navigator.credentials.store(credential).catch(() => {});
        } catch { /* Unsupported or blocked password storage; manual input still works. */ }
    }

    /**
     * 指定キーとモデルの利用可否を期限付きで確認し、現世代で成功した場合だけ保持する。
     *
     * @param apiKey 要求中だけ使用するAPIキー。
     * @param model 利用するモデル名。
     */
    async connect(apiKey: string, model = this.model, credentialId = ""): Promise<void> {
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
            this.requestPasswordSave(credentialId);
        } catch (error) {
            if (current()) this.show("接続エラー", request.signal.aborted ? "接続確認が時間切れになりました。"
                : error instanceof AIRequestError ? error.message : "Googleへ接続できませんでした。通信状態を確認してください。");
        } finally {
            apiKey = "";
            credentialId = "";
            if (this.request === request) this.request = undefined;
            if (current()) this.connecting = false;
            this.refreshButtons();
        }
    }

    /**
     * 進行中の実行を停止し、要求・キー・出力と入力ダイアログを消去する。
     */
    disconnect(): void {
        if (isRunning) stopDiagram();
        this.version++; this.#apiKey = ""; this.connecting = false;
        this.request?.abort(); this.closeDialog();
        this.outputPort.setPortValue(undefined);
        this.show("未接続"); this.refreshButtons();
    }

    /**
     * 同じ種類のブロックを作成し、複製対象の設定をコピーする。
     */
    copy(): AIChatBlock {
        const block = new AIChatBlock({});
        block.model = this.model;
        this.copyUI(block);
        block.setBoxSize();
        block.setBlockPortPosition(this.position.copy());
        return block;
    }

    /**
     * 状態メッセージと結果欄を更新し、操作状態とキャンバスを再描画する。
     *
     * @param message 画面または診断に表示する説明。
     * @param text 処理する文字列。
     */
    private show(message: string, text = ""): void {
        this.message = message;
        this.answerView.value = text;
        this.refreshButtons();
        theCanvas?.requestUpdateCanvas();
    }

    /**
     * 前回の要求を取り消して出力を消去し、次の明示実行を待つ。
     */
    resetForRun(): void {
        this.version++;
        this.request?.abort();
        this.connecting = false;
        this.outputPort.setPortValue(undefined);
        this.show(this.connected ? "待機中" : "未接続");
    }

    // Editing or connecting input never sends a question automatically.
    async valueChanged(): Promise<void> {}
    /**
     * 入力の変更だけでは外部要求を開始しないため、計算時には処理を行わない。
     */
    calc(): void {}

    /**
     * 接続された質問を一度送信し、完了した回答だけを出力する。失敗時はStart処理も拒否する。
     */
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

    /**
     * この部品の枠・内容・操作状態をキャンバスへ描く。
     */
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

    /**
     * 接続・イベント・所有資源を解放してブロックを削除可能にする。
     */
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
