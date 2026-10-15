/** Minimal types for browsers exposing the prefixed recognition API. */
export interface SpeechResultEvent {
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

export interface SpeechRecognizer {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    onstart: (() => void) | null;
    onresult: ((event: SpeechResultEvent) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
}

export function speechRecognitionConstructor(): (new () => SpeechRecognizer) | undefined {
    const browser = window as unknown as {
        SpeechRecognition?: new () => SpeechRecognizer;
        webkitSpeechRecognition?: new () => SpeechRecognizer;
    };
    return browser.SpeechRecognition || browser.webkitSpeechRecognition;
}

export class SpeechRecognitionError extends Error {}

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
    lang: string;
    signal: AbortSignal;
    timeoutMs?: number;
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
