/**
 * CameraBlockごとの端末カメラの権限要求・映像・イベントと描画予約の寿命を管理する。
 */
import { theCanvas } from "../diagram_util";

/** One CameraBlock's device camera. Permission requests may finish after stop(). */
export class DeviceCameraFeed {
    /**
     * 描画に利用できる準備済みの端末カメラ映像。
     */
    image?: HTMLVideoElement;
    /**
     * 現在のカメラ取得世代が開始・再生中であることを示す状態。
     */
    active = false;
    /**
     * 停止後に返る権限要求や映像の結果を無効にする世代。
     */
    private version = 0;
    /**
     * 取得済みのMediaStream。stop()で全トラックを停止する。
     */
    private stream?: MediaStream;
    /**
     * MediaStreamを再生する所有video要素。
     */
    private video?: HTMLVideoElement;
    /**
     * 映像更新に合わせた再描画の予約ID。
     */
    private frame?: number;
    /**
     * 端末カメラ開始の30秒タイムアウト。
     */
    private timer?: ReturnType<typeof setTimeout>;
    /**
     * この部品で登録したDOMイベントをまとめて解除するための取消元。
     */
    private events?: AbortController;

    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(/** カメラの権限・再生・失敗の状態を所有ブロックへ通知する処理。 */ private readonly show: (message: string) => void) {}

    /**
     * 権限とAPIの利用条件を確認し、端末の背面カメラ取得と映像再生を開始する。
     */
    start(): void {
        this.stop();
        if (document.hidden) return;
        if (!window.isSecureContext) {
            this.show("端末カメラにはHTTPSまたはlocalhostが必要です。");
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
            this.show("このブラウザーは端末カメラに対応していません。");
            return;
        }
        const version = ++this.version;
        const current = () => version === this.version && this.active;
        this.active = true;
        this.show("端末カメラの使用を許可してください。");
        this.timer = setTimeout(() => {
            if (current()) this.stop("カメラの開始がタイムアウトしました。再度開始してください。");
        }, 30000);

        void navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } },
        }).then(async stream => {
            if (!current()) {
                stream.getTracks().forEach(track => track.stop());
                return;
            }
            this.stream = stream;
            if (document.hidden) { this.stop(); return; }
            const video = this.video = document.createElement("video");
            video.muted = true;
            video.playsInline = true;
            video.autoplay = true;
            video.srcObject = stream;
            const events = this.events = new AbortController();
            stream.getVideoTracks().forEach(track => track.addEventListener("ended", () => {
                if (current()) this.stop("端末カメラが終了しました。再度開始してください。");
            }, { signal: events.signal }));
            video.addEventListener("error", () => {
                if (current()) this.stop("端末カメラの映像を再生できませんでした。");
            }, { signal: events.signal });
            this.show("端末カメラの映像を準備しています…");
            await video.play();
            if (!current()) return;
            let lastTime = -1, lastWidth = 0, lastHeight = 0;
            const drawFrame = () => {
                if (!current()) return;
                if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
                    if (!this.image || lastWidth !== video.videoWidth || lastHeight !== video.videoHeight) {
                        clearTimeout(this.timer); this.timer = undefined;
                        this.image = video;
                        lastWidth = video.videoWidth; lastHeight = video.videoHeight;
                        this.show("端末カメラを表示中");
                    }
                    if (video.currentTime !== lastTime) {
                        lastTime = video.currentTime;
                        theCanvas?.requestUpdateCanvas();
                    }
                }
                this.frame = requestAnimationFrame(drawFrame);
            };
            drawFrame();
        }).catch(error => {
            if (!current()) return;
            const name = error instanceof DOMException ? error.name : "";
            const message = name === "NotAllowedError" || name === "SecurityError"
                ? "カメラの使用が拒否されました。ブラウザーの権限を確認してください。"
                : name === "NotFoundError" ? "端末のカメラが見つかりません。"
                : name === "NotReadableError" ? "カメラを使用できません。他のアプリの使用状況を確認してください。"
                : "端末カメラを開始できませんでした。再度開始してください。";
            this.stop(message);
        });
    }

    /**
     * 取得世代を失効させ、映像・全トラック・タイマー・イベントと描画予約を解放する。
     *
     * @param message 画面または診断に表示する説明。
     */
    stop(message = "「開始」で端末カメラを使います。"): void {
        this.version++;
        this.active = false;
        this.events?.abort(); this.events = undefined;
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        this.frame = undefined;
        clearTimeout(this.timer); this.timer = undefined;
        this.image = undefined;
        if (this.video) {
            this.video.pause(); this.video.srcObject = null;
            this.video.remove(); this.video = undefined;
        }
        this.stream?.getTracks().forEach(track => track.stop());
        this.stream = undefined;
        this.show(message);
    }
}
