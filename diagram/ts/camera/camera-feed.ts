import { setCameraImage } from "../diagram_util";

type Provider = (signal: AbortSignal) => Promise<Blob>;
let provider: Provider | undefined, controller: AbortController | undefined;
const listeners = new Set<(message: string) => void>();
let message = "Wi-Fi機器へ接続してください。";
function show(value: string): void { message = value; listeners.forEach(listener => listener(value)); }
function stop(): void { controller?.abort(); controller = undefined; setCameraImage(undefined); }
export function setCameraProvider(value?: Provider): void {
    stop(); provider = value;
    show(value ? "画像取得中…" : "Wi-Fiカメラ未接続"); start();
}
export function subscribeCamera(listener: (message: string) => void): () => void {
    listeners.add(listener); listener(message); start();
    return () => { listeners.delete(listener); if (!listeners.size) stop(); };
}
function start(): void {
    if (!provider || !listeners.size || controller) return;
    const session = controller = new AbortController(), fetchImage = provider;
    void (async () => {
        while (!session.signal.aborted && listeners.size) {
            let url: string | undefined;
            try {
                const blob = await fetchImage(session.signal); session.signal.throwIfAborted();
                url = URL.createObjectURL(blob); const img = new Image(); img.src = url;
                await img.decode(); session.signal.throwIfAborted();
                setCameraImage(img); show("XIAOカメラ：320×240");
            } catch { if (!session.signal.aborted) { setCameraImage(undefined); show("画像取得に失敗しました。接続・カメラ・ネットワーク権限を確認してください。"); } }
            finally { if (url) URL.revokeObjectURL(url); }
            if (!session.signal.aborted) await new Promise<void>(resolve => {
                const finish = () => { clearTimeout(timer); session.signal.removeEventListener("abort", finish); resolve(); };
                const timer = setTimeout(finish, 0); session.signal.addEventListener("abort", finish, { once: true });
            });
        }
    })();
}
