/**
 * Wi-Fi機器からの画像取得を購読者間で共有する。最初の購読で取得を始め、最後の購読解除で要求と共有画像を破棄する。
 */
import { setCameraImage } from "../diagram_util";

/**
 * 取消シグナルを受け取り、認証済みのカメラ画像Blobを返す処理。
 */
type Provider = (signal: AbortSignal) => Promise<Blob>;
let /** 現在のWi-Fi接続が提供する、認証済みJPEG取得の処理。 */ provider: Provider | undefined, /** 共有画像の定期取得を中断する制御元。 */ controller: AbortController | undefined;
/**
 * 画像の取得状態を表示する購読者の集合。
 */
const listeners = new Set<(message: string) => void>();
/**
 * 最後に通知したWi-Fiカメラの取得状態。
 */
let message = "Wi-Fi機器へ接続してください。";
/**
 * 現在の取得状態を保持し、全購読者へ通知する。
 *
 * @param value 検証または反映する値。
 */
function show(value: string): void { message = value; listeners.forEach(listener => listener(value)); }
/**
 * 共有の画像取得を中断し、現在のカメラ画像を消去する。
 */
function stop(): void { controller?.abort(); controller = undefined; setCameraImage(undefined); }
/**
 * Wi-Fi画像の取得先を差し替え、購読中なら新しい取得を開始する。
 *
 * @param value 検証または反映する値。
 */
export function setCameraProvider(value?: Provider): void {
    stop(); provider = value;
    show(value ? "画像取得中…" : "Wi-Fiカメラ未接続"); start();
}
/**
 * 状態の購読を登録し、最後の購読解除時に取得も止める解除関数を返す。
 *
 * @param listener 変更通知を受け取る処理。
 */
export function subscribeCamera(listener: (message: string) => void): () => void {
    listeners.add(listener); listener(message); start();
    return () => { listeners.delete(listener); if (!listeners.size) stop(); };
}
/**
 * 現在の取得先でJPEGを繰り返し読み、完了した画像だけを共有画像へ設定する。
 */
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
