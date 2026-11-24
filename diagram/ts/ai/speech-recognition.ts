/**
 * Startで単発の音声認識を開始し、セッション終了後に確定文字列を出力する。認識終了のstopと、全体停止のabortを区別する。
 */
import { Vec2 } from "@i18n";
import { FunctionBlock, registerFunctionBlock } from "../block";
import { PortType, theCanvas } from "../diagram_util";
import { TextPort } from "../port";
import { getProcedureSignal, isRunning, stopDiagram, subscribeDiagramStop } from "../runtime";
import { recognizeSpeech, SpeechRecognitionError, speechRecognitionConstructor, type SpeechRecognizer } from "./speech-client";
import { Button, type Attr, type UI } from "../ui";

/**
 * Startによる単発認識と終了ボタンを持つ文字列出力ブロック。
 */
export class SpeechRecognitionBlock extends FunctionBlock {
    /**
     * Start時の依存順実行の対象に含める指定。
     */
    override readonly runOnStart = true;
    /**
     * 完了した結果を後続ブロックへ渡す出力ポート。中断・再実行時は消去する。
     */
    readonly outputPort = new TextPort(this, PortType.outputPort);
    /**
     * 結果またはエラーを表示する読取り専用のテキスト欄。
     */
    readonly resultView: HTMLTextAreaElement;
    /**
     * 結果を破棄せず認識を終了し、確定通知を待つためのボタン。
     */
    readonly finishButton: Button;
    /**
     * 保存・復元する認識言語のタグ。既定は日本語。
     */
    lang = "ja-JP";
    /**
     * 接続・処理中・完了・エラーを画面へ示す状態メッセージ。
     */
    message = "Startで音声入力";
    /**
     * 現在進行中のブラウザー音声認識セッション。
     */
    private recognition?: SpeechRecognizer;
    /**
     * 現在の接続確認または解析要求を取り消す制御元。
     */
    private request?: AbortController;
    /**
     * 終了操作後に確定結果とセッション終了を待っている状態。
     */
    private finishing = false;
    /**
     * 削除済みの部品に非同期結果を反映しないための状態。
     */
    private removed = false;
    /**
     * 削除・取消・新しい要求の後に古い非同期結果を反映しないための世代。
     */
    private version = 0;
    /**
     * この部品で登録したDOMイベントをまとめて解除するための取消元。
     */
    private events = new AbortController();
    /**
     * diagram停止通知の購読を解除する関数。
     */
    private releaseStop: () => void;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
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

    /**
     * この部品が所有する、描画や操作の対象となる子UIを返す。
     */
    children(): UI[] { return [this.finishButton]; }
    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize(): void { this.boxSize = new Vec2(320, this.inToolbox ? 60 : 260); }
    /**
     * 部品の基準座標を更新する。
     *
     * @param position 基準となる座標またはソース内の位置。
     */
    setPosition(position: Vec2): void {
        super.setPosition(position);
        this.resultView.style.left = `${position.x + 16}px`;
        this.resultView.style.top = `${position.y + 134}px`;
        this.positionButton();
    }
    /**
     * ブロックの現在位置と大きさに合わせてポートを配置する。
     */
    setPortPositions(): void { super.setPortPositions(); this.positionButton(); }
    /**
     * ブロック内の認識終了ボタンを配置する。
     */
    private positionButton(): void {
        if (!this.finishButton) return;
        this.finishButton.setPosition(this.position.add(new Vec2(16, 78)));
        this.finishButton.boxSize = new Vec2(288, 44);
    }
    /**
     * 進行中の認識がある場合だけ認識終了ボタンを有効にする。
     */
    private refreshButton(): void {
        this.finishButton.disabled = this.removed || this.inToolbox || !this.recognition || this.finishing;
        theCanvas?.requestUpdateCanvas();
    }
    /**
     * 状態メッセージと結果欄を更新し、操作状態とキャンバスを再描画する。
     *
     * @param message 画面または診断に表示する説明。
     * @param text 処理する文字列。
     */
    private show(message: string, text = ""): void {
        this.message = message;
        this.resultView.value = text;
        this.refreshButton();
    }
    /**
     * 認識を中断し、世代・保持セッション・出力を失効させる。
     */
    private cancelRecognition(): void {
        this.version++;
        this.request?.abort();
        this.recognition = undefined;
        this.request = undefined;
        this.finishing = false;
        this.outputPort.setPortValue(undefined);
        this.show("中断しました");
    }
    /**
     * ブラウザーへstopを要求し、確定結果を待つ。全体Stopとは区別する。
     */
    finishRecognition(): void {
        if (!this.recognition || this.finishing || this.removed) return;
        this.finishing = true;
        this.show("認識結果を待っています…");
        try { this.recognition.stop(); }
        catch { stopDiagram(); }
    }
    /**
     * 前回の要求を取り消して出力を消去し、次の明示実行を待つ。
     */
    resetForRun(): void {
        this.cancelRecognition();
        this.show("Startで音声入力");
    }
    /**
     * 入力の変更だけでは送信や認識を始めず、明示実行を待つ。
     */
    async valueChanged(): Promise<void> {}
    /**
     * 入力の変更だけでは外部要求を開始しないため、計算時には処理を行わない。
     */
    calc(): void {}
    /**
     * 単発認識を開始し、終了後の確定文字列だけを出力する。中断・失敗は後続実行を止める。
     */
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
    /**
     * 図の保存に必要な設定をJSON化可能なオブジェクトへ変換する。
     */
    makeObj(): any { return { ...super.makeObj(), lang: this.lang }; }
    /**
     * 保存オブジェクトからこの要素の設定を復元する。
     *
     * @param obj 復元する保存オブジェクト。
     */
    loadObj(obj: any): void {
        this.resetForRun();
        this.lang = "ja-JP";
        if (typeof obj.lang === "string") {
            try { this.lang = Intl.getCanonicalLocales(obj.lang)[0] || "ja-JP"; } catch { /* Keep the default. */ }
        }
    }
    /**
     * 同じ種類のブロックを作成し、複製対象の設定をコピーする。
     */
    copy(): SpeechRecognitionBlock {
        const block = new SpeechRecognitionBlock({});
        block.lang = this.lang;
        this.copyUI(block);
        block.setBoxSize();
        block.setBlockPortPosition(this.position.copy());
        return block;
    }
    /**
     * この部品の枠・内容・操作状態をキャンバスへ描く。
     */
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
    /**
     * 接続・イベント・所有資源を解放してブロックを削除可能にする。
     */
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
