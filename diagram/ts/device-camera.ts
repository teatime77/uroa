import { theCanvas } from "./diagram_util";

/** One CameraBlock's device camera. Permission requests may finish after stop(). */
export class DeviceCameraFeed {
    image?: HTMLVideoElement;
    active = false;
    private version = 0;
    private stream?: MediaStream;
    private video?: HTMLVideoElement;
    private frame?: number;
    private timer?: ReturnType<typeof setTimeout>;
    private events?: AbortController;

    constructor(private readonly show: (message: string) => void) {}

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
            let lastTime = -1;
            const drawFrame = () => {
                if (!current()) return;
                if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
                    if (!this.image) {
                        clearTimeout(this.timer); this.timer = undefined;
                        this.image = video;
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
