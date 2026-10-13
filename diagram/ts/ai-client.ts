const apiRoot = "https://generativelanguage.googleapis.com/v1beta";

/** Only fixed, credential-free messages may leave the transport layer. */
export class AIRequestError extends Error {}

/** Settle even when a transport ignores abort, including while parsing its body. */
export async function waitAIRequest<T>(controller: AbortController, ms: number, run: () => Promise<T>): Promise<T> {
    const signal = controller.signal;
    if (signal.aborted) throw new AIRequestError("通信を中断しました。");
    let rejectAbort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = () => reject(new AIRequestError("通信を中断しました。"));
        signal.addEventListener("abort", rejectAbort, { once: true });
    });
    const timer = setTimeout(() => controller.abort(), ms);
    try { return await Promise.race([run(), aborted]); }
    finally { clearTimeout(timer); signal.removeEventListener("abort", rejectAbort); }
}

export function checkAIResponse(response: Response): void {
    if (response.ok) return;
    const message = response.status === 401 || response.status === 403 ? "APIキーまたは利用権限を確認してください。"
        : response.status === 429 ? "利用上限に達しました。少し待ってから再実行してください。"
        : response.status === 404 ? "モデル名と利用可能なモデルを確認してください。"
        : "Googleからの応答を取得できませんでした。";
    throw new AIRequestError(message);
}

/** The REST response has steps; output_text is a convenience accessor of the SDK. */
export function interactionAnswer(body: unknown): string {
    if (!body || typeof body !== "object" || !("status" in body) || body.status !== "completed" ||
        !("steps" in body) || !Array.isArray(body.steps)) {
        throw new AIRequestError("AIから完了した回答が返りませんでした。");
    }
    const output = [...body.steps].reverse().find(step => step && step.type === "model_output");
    const answer = output && Array.isArray(output.content) ? output.content
        .filter((item: unknown): item is { type: "text"; text: string } => !!item && typeof item === "object" &&
            "type" in item && item.type === "text" && "text" in item && typeof item.text === "string")
        .map((item: { text: string }) => item.text).join("") : "";
    if (!answer.trim()) throw new AIRequestError("AIから有効な回答が返りませんでした。");
    return answer;
}

function requestOptions(apiKey: string, signal: AbortSignal): RequestInit {
    return {
        headers: { "x-goog-api-key": apiKey }, signal,
        cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
    };
}

export async function checkAIConnection(apiKey: string, model: string, signal: AbortSignal): Promise<void> {
    const response = await fetch(`${apiRoot}/models/${encodeURIComponent(model)}`, requestOptions(apiKey, signal));
    checkAIResponse(response);
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("name" in body) || body.name !== `models/${model}`) {
        throw new AIRequestError("Googleからモデル情報を取得できませんでした。");
    }
}

export async function askAI(apiKey: string, model: string, question: string, signal: AbortSignal): Promise<string> {
    const options = requestOptions(apiKey, signal);
    const response = await fetch(`${apiRoot}/interactions`, {
        ...options, method: "POST",
        headers: { ...options.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: question, store: false,
            system_instruction: "日本語で、優しく親しみやすく答えてください。原則1〜3文の短い返答にしてください。" }),
    });
    checkAIResponse(response);
    return interactionAnswer(await response.json());
}
