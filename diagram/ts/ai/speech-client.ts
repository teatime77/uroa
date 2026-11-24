/**
 * ブラウザーの音声認識APIの最小型と、確定結果をセッション終了後に返す単発認識を提供する。
 */
/** Minimal types for browsers exposing the prefixed recognition API. */
export interface SpeechResultEvent {
    /**
     * 認識サービスから届く、その時点の認識結果の一覧。
     */
    results: ArrayLike<{ /** この候補の文字列が確定済みかを示すフラグ。 */ isFinal: boolean; /** この認識結果の第一候補。 */ 0: { /** 音声認識サービスが返した候補の文字列。 */ transcript: string } }>;
}

/**
 * 単発の音声認識で利用するブラウザーAPIの最小インターフェース。
 */
export interface SpeechRecognizer {
    /**
     * 単発認識に使用する言語タグ。
     */
    lang: string;
    /**
     * 一回の認識を超えて連続取得するかを指定する状態。
     */
    continuous: boolean;
    /**
     * 途中結果を通知するかを指定する状態。
     */
    interimResults: boolean;
    /**
     * 一つの結果で要求する候補数。
     */
    maxAlternatives: number;
    /**
     * マイクの認識セッションが始まったときの通知先。
     */
    onstart: (() => void) | null;
    /**
     * 確定・途中結果の一覧を受け取る通知先。
     */
    onresult: ((event: SpeechResultEvent) => void) | null;
    /**
     * ブラウザーの認識エラーを受け取る通知先。
     */
    onerror: ((event: { /** ブラウザーが通知した音声認識のエラー種別。 */ error: string }) => void) | null;
    /**
     * 認識セッションが終了したときの通知先。
     */
    onend: (() => void) | null;
    /**
     * ブラウザーの音声認識セッションを開始する。
     */
    start(): void;
    /**
     * 認識を終了し、確定結果とセッション終了の通知を待つ。
     */
    stop(): void;
    /**
     * 認識セッションを結果不要として中断する。
     */
    abort(): void;
}

/**
 * 標準名またはWebKit接頭辞の音声認識APIを探す。非対応ならundefined。
 */
export function speechRecognitionConstructor(): (new () => SpeechRecognizer) | undefined {
    const browser = window as unknown as {
        /**
         * 標準名で公開された音声認識コンストラクター。
         */
        SpeechRecognition?: new () => SpeechRecognizer;
        /**
         * 接頭辞付きで公開された音声認識コンストラクター。
         */
        webkitSpeechRecognition?: new () => SpeechRecognizer;
    };
    return browser.SpeechRecognition || browser.webkitSpeechRecognition;
}

/**
 * 画面へ表示可能な音声認識の失敗を表す例外。
 */
export class SpeechRecognitionError extends Error {}

/**
 * ブラウザーの認識エラー番号を画面用の固定メッセージへ変換する表。
 */
const messages: Record<string, string> = {
    "not-allowed": "マイクの使用が許可されていません。ブラウザーの権限を確認してください。",
    "service-not-allowed": "このブラウザーでは音声認識サービスを利用できません。",
    "audio-capture": "マイクから音声を取得できませんでした。",
    "no-speech": "音声を検出できませんでした。Startでやり直してください。",
    "network": "音声認識の通信に失敗しました。インターネット接続を確認してください。",
    "language-not-supported": "指定した言語の音声認識に対応していません。",
    "aborted": "音声認識を中断しました。",
};

/** Resolve only after the microphone session ends, never on an interim result. */
export function recognizeSpeech(recognition: SpeechRecognizer, options: {
    /**
     * 単発認識に使用する言語タグ。
     */
    lang: string;
    /**
     * 認識セッション全体を中断する取消シグナル。
     */
    signal: AbortSignal;
    /**
     * 認識を待つ最大時間（ms）。未指定時は30秒。
     */
    timeoutMs?: number;
    /**
     * 認識開始をブロックの表示へ知らせる処理。
     */
    onStart?: () => void;
}): Promise<string> {
    return new Promise((resolve, reject) => {
        let settled = false, text = "";
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (error?: SpeechRecognitionError) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            options.signal.removeEventListener("abort", cancel);
            recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
            if (error) {
                // Settle even if abort throws or never dispatches an end event.
                try { recognition.abort(); } catch { /* The session may already have ended. */ }
                reject(error);
            } else resolve(text);
        };
        const cancel = () => finish(new SpeechRecognitionError(messages.aborted));
        recognition.lang = options.lang;
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognition.onstart = () => { if (!settled) options.onStart?.(); };
        recognition.onresult = event => {
            if (settled) return;
            // The result list is a snapshot; repeated events must not duplicate text.
            text = Array.from(event.results).filter(result => result.isFinal)
                .map(result => result[0].transcript).join("").trim();
        };
        recognition.onerror = event => finish(new SpeechRecognitionError(
            messages[event.error] || "音声認識に失敗しました。Startでやり直してください。"));
        recognition.onend = () => finish(text ? undefined
            : new SpeechRecognitionError("認識結果が空です。Startでやり直してください。"));
        options.signal.addEventListener("abort", cancel, { once: true });
        if (options.signal.aborted) { cancel(); return; }
        timer = setTimeout(() => finish(new SpeechRecognitionError("音声認識が時間切れになりました。Startでやり直してください。")),
            options.timeoutMs ?? 30_000);
        try { recognition.start(); }
        catch { finish(new SpeechRecognitionError("音声認識を開始できませんでした。マイクとブラウザーの設定を確認してください。")); }
    });
}
