/** Wi-Fi transport and authenticated BLE provisioning. No live credentials are serialized. */
export interface RobotEndpoint {
    id: string; name: string; host: string; ip: string;
    port: number; wsPort: number; cameraPort: number; camera: boolean;
}
export interface ProvisionInfo extends RobotEndpoint { key?: string; state: string; error?: string; }
export interface WifiNetwork { ssid: string; rssi: number; open: boolean; }
export interface ConfigCharacteristic { readValue(): Promise<DataView>; writeValueWithResponse(value: Uint8Array): Promise<void>; }
const encoder = new TextEncoder(), decoder = new TextDecoder();
const ssidHistoryKey = "uroa-wifi-ssids-v1";
const DeviceTelemetryVersion = 3;
const DeviceTelemetryHeaderLength = 8;
const IMU6AxisRecordLength = 13;
const DeviceInfoMaxLength = 20;
const DeviceTelemetryMaxLength = DeviceTelemetryHeaderLength + DeviceInfoMaxLength * IMU6AxisRecordLength;
export function savedWifiSSIDs(): string[] {
    try {
        const data: unknown = JSON.parse(localStorage.getItem(ssidHistoryKey) || "[]");
        if (!Array.isArray(data)) return [];
        return [...new Set(data.filter((ssid): ssid is string =>
            typeof ssid === "string" && ssid.length > 0 && encoder.encode(ssid).length <= 32))].slice(0, 20);
    } catch { return []; }
}
export function rememberWifiSSID(ssid: string): void {
    if (!ssid.length || encoder.encode(ssid).length > 32) return;
    try {
        localStorage.setItem(ssidHistoryKey, JSON.stringify([ssid, ...savedWifiSSIDs().filter(value => value !== ssid)].slice(0, 20)));
    } catch { /* History is optional; manual entry and scanning remain available. */ }
}
// Public teaching key; keep in sync with deviceKey in firmware/src/network.cpp.
const teachingConnectionKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
export function packetHex(data: Uint8Array): string { return [...data].map(b => b.toString(16).padStart(2, "0")).join(""); }
function decodeHex(value: unknown): Uint8Array<ArrayBuffer> {
    if (typeof value !== "string" || !/^(?:[0-9a-f]{2})+$/.test(value)) throw new Error("機器の応答形式が正しくありません。");
    return Uint8Array.from(value.match(/../g)!, x => parseInt(x, 16));
}
function validHost(value: unknown): value is string {
    if (typeof value !== "string") return false;
    if (/^[a-z0-9][a-z0-9-]{0,62}\.local$/.test(value)) return true;
    const octets = value.split(".").map(Number);
    return /^\d+\.\d+\.\d+\.\d+$/.test(value) && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255) &&
        (octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
}
export function endpoint(value: unknown): RobotEndpoint {
    const data = value as Partial<RobotEndpoint> | undefined;
    if (!data || typeof data.id !== "string" || !/^uroa-[a-f0-9]{12}$/.test(data.id) ||
        typeof data.name !== "string" || !validHost(data.host) || (data.ip !== "" && !validHost(data.ip)) ||
        ![data.port, data.wsPort, data.cameraPort].every(p => Number.isInteger(p) && p! > 0 && p! <= 65535))
        throw new Error("機器の接続情報が正しくありません。");
    return { id: data.id, name: data.name.slice(0, 64), host: data.host, ip: data.ip!,
        port: data.port!, wsPort: data.wsPort!, cameraPort: data.cameraPort!, camera: data.camera === true };
}
export function savePassword(id: string, password: string): void {
    const Constructor = (window as Window & { PasswordCredential?: new (data: { id: string; password: string }) => Credential }).PasswordCredential;
    if (!window.isSecureContext || !Constructor || !navigator.credentials?.store || !password) return;
    try { void navigator.credentials.store(new Constructor({ id, password })).catch(() => {}); } catch { /* Browser owns save approval. */ }
}
export function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const cancel = () => { clearTimeout(timer); reject(new DOMException("中断しました。", "AbortError")); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, ms);
        signal.addEventListener("abort", cancel, { once: true });
    });
}
async function deadline<T>(promise: Promise<T>, signal: AbortSignal, ms = 15000): Promise<T> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
        const abort = () => { finish(); reject(new DOMException("中断しました。", "AbortError")); };
        const timer = setTimeout(() => { finish(); reject(new Error("機器の応答が時間切れです。BLEのペアリング要求と接続先を確認してください。")); }, ms);
        signal.addEventListener("abort", abort, { once: true });
        promise.then(value => { finish(); if (signal.aborted) abort(); else resolve(value); }, error => { finish(); reject(error); });
    });
}
export class BLEWifiSetup {
    private tail: Promise<unknown> = Promise.resolve();
    constructor(private tx: ConfigCharacteristic, private rx: ConfigCharacteristic) {}
    request(data: object, signal: AbortSignal): Promise<ProvisionInfo & { pages?: number; networks?: WifiNetwork[] }> {
        const task = this.tail.catch(() => {}).then(async () => {
            let bytes = encoder.encode(JSON.stringify(data));
            if (bytes.length > 380) throw new Error("Wi-Fi設定が長すぎます。");
            try {
                await deadline(this.tx.writeValueWithResponse(Uint8Array.of(0)), signal, 90000);
                for (let offset = 0; offset < bytes.length; offset += 19) {
                    signal.throwIfAborted();
                    await deadline(this.tx.writeValueWithResponse(Uint8Array.of(1, ...bytes.slice(offset, offset + 19))), signal);
                }
                await deadline(this.tx.writeValueWithResponse(Uint8Array.of(2)), signal);
                const value = await deadline(this.rx.readValue(), signal);
                const reply = JSON.parse(decoder.decode(value));
                if (typeof reply.error === "string" && reply.error) throw new Error("Wi-Fi設定に失敗しました。入力または機器の接続状態を確認してください。");
                return reply;
            } finally { bytes.fill(0); bytes = new Uint8Array(); }
        });
        this.tail = task; return task;
    }
    async info(signal: AbortSignal): Promise<ProvisionInfo> {
        const data = await this.request({ op: "info" }, signal); endpoint(data);
        if (data.key !== teachingConnectionKey) throw new Error("教材用の固定接続キーに対応したファームウェアを書き込んでください。");
        return data;
    }
    async scan(signal: AbortSignal): Promise<WifiNetwork[]> {
        await this.request({ op: "scan" }, signal); await wait(500, signal);
        const until = Date.now() + 20000;
        while ((await this.info(signal)).state === "scanning") {
            if (Date.now() > until) throw new Error("Wi-Fi検索が時間切れです。"); await wait(500, signal);
        }
        const networks = new Map<string, WifiNetwork>();
        for (let page = 0; page < 65; ++page) {
            const result = await this.request({ op: "list", page }, signal);
            for (const item of result.networks || []) if (typeof item.ssid === "string" && item.ssid && encoder.encode(item.ssid).length <= 32)
                if (!networks.has(item.ssid) || item.rssi > networks.get(item.ssid)!.rssi) networks.set(item.ssid, item);
            if (page + 1 >= (result.pages || 0)) break;
        }
        return [...networks.values()].sort((a, b) => b.rssi - a.rssi);
    }
    async configure(ssid: string, password: string, signal: AbortSignal): Promise<ProvisionInfo> {
        const n = encoder.encode(ssid).length, p = encoder.encode(password).length;
        if (!n || n > 32 || (p && p < 8) || p > 63) throw new Error("SSIDは1～32バイト、パスワードは8～63バイトで指定してください。");
        await this.request({ op: "configure", ssid, password }, signal); await wait(500, signal);
        const until = Date.now() + 30000;
        while (Date.now() < until) {
            const result = await this.info(signal);
            if (result.state === "connected" && result.ip) return result;
            await wait(500, signal);
        }
        throw new Error("Wi-Fi接続が時間切れです。SSID・パスワードと2.4GHz接続を確認してください。");
    }
}

/** One authenticated control session. HTTP fallback supports secure-page local-network access. */
export class RobotWifi {
    private controller = new AbortController();
    private socket?: WebSocket;
    private cryptoKey?: CryptoKey;
    private session = "";
    private counter = 0;
    private outputCounter = 0;
    private base = "";
    private cameraBase = "";
    private inbound: Promise<void> = Promise.resolve();
    private polling = false;
    private closed = false;
    private latestImageController?: AbortController;
    endpoint?: RobotEndpoint;
    onPacket: (data: DataView) => void = () => {};
    onLost: (message: string) => void = () => {};
    get connected(): boolean { return !this.closed && !!this.session; }
    private async mac(message: string): Promise<string> {
        if (!this.cryptoKey) throw new Error("接続キーがありません。");
        return packetHex(new Uint8Array(await crypto.subtle.sign("HMAC", this.cryptoKey, encoder.encode(message))));
    }
    private async verify(message: string, proof: unknown): Promise<void> {
        if (!this.cryptoKey || !await crypto.subtle.verify("HMAC", this.cryptoKey, decodeHex(proof), encoder.encode(message)))
            throw new Error("機器の認証に失敗しました。");
    }
    private async json(path: string, body?: string, authenticated = false): Promise<any> {
        const headers: Record<string, string> = {};
        let requestCount = 0;
        if (body !== undefined) headers["Content-Type"] = "text/plain";
        if (authenticated) {
            const count = requestCount = ++this.counter;
            headers["X-Uroa-Session"] = this.session; headers["X-Uroa-Counter"] = String(count);
            headers["X-Uroa-Mac"] = await this.mac(`${this.session}|${count}|${path}|${body || ""}`);
        }
        const request = new AbortController();
        const abort = () => request.abort(); this.controller.signal.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(abort, 4000);
        try {
            const response = await fetch(this.base + path, { method: body === undefined ? "GET" : "POST", headers, body,
                signal: request.signal, credentials: "omit", redirect: "error", cache: "no-store" });
            if (!response.ok) throw new Error("Wi-Fi機器から応答を得られません。接続先・ファームウェア・ネットワークのアクセス許可を確認してください。");
            const reply = await response.json();
            if (path === "/events" && reply.counter !== String(requestCount)) throw new Error("応答の番号が一致しません。");
            return reply;
        } finally { clearTimeout(timer); this.controller.signal.removeEventListener("abort", abort); }
    }
    async connect(target: RobotEndpoint, outerSignal: AbortSignal): Promise<RobotEndpoint> {
        outerSignal.throwIfAborted();
        this.cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(teachingConnectionKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
        const cancel = () => this.close(); outerSignal.addEventListener("abort", cancel, { once: true });
        try {
            // Try the stable hostname, then the last known DHCP address. Identity is checked in both cases.
            const hosts = [...new Set([target.host, target.ip].filter(Boolean))]; let information: any;
            for (const host of hosts) {
                if (this.closed) throw new DOMException("中断しました。", "AbortError");
                this.base = `http://${host}:${target.port}`; this.cameraBase = `http://${host}:${target.cameraPort}`;
                try {
                    information = await this.json("/info");
                    const actual = endpoint(information); if (actual.id !== target.id) throw new Error("別の基板が応答しました。BLEで接続先を取得し直してください。");
                    this.endpoint = actual; break;
                } catch (error) { if (host === hosts.at(-1)) throw error; }
            }
            if (!information || !this.endpoint) throw new Error("接続先がありません。");
            // Browsers may block ws:// from HTTPS. HTTP uses Chrome's local-network permission path.
            if (location.protocol !== "https:") {
                try { await this.connectSocket(information, target, outerSignal); }
                catch { this.socket?.close(); this.socket = undefined; this.session = ""; }
            }
            if (!this.session) {
                information = await this.json("/info");
                const proof = await this.mac(`claim|${target.id}|${information.challenge}|${location.origin}`);
                const reply = await this.json("/claim", JSON.stringify({ challenge: information.challenge, proof }));
                await this.acceptSession(reply, information.challenge, target.id); this.polling = true;
                void this.poll();
            }
            return this.endpoint!;
        } catch (error) { this.close(); throw error; }
        finally { outerSignal.removeEventListener("abort", cancel); }
    }
    private async acceptSession(reply: any, nonce: string, id: string): Promise<void> {
        if (endpoint(reply).id !== id || typeof reply.session !== "string" || !/^[a-f0-9]{32}$/.test(reply.session)) throw new Error("機器の接続情報が正しくありません。");
        await this.verify(`ready|${id}|${nonce}|${reply.session}|${reply.host}|${reply.ip}`, reply.proof);
        if (this.closed) throw new DOMException("中断しました。", "AbortError");
        this.session = reply.session; this.endpoint = endpoint(reply);
    }
    private async connectSocket(info: any, target: RobotEndpoint, signal: AbortSignal): Promise<void> {
        const host = new URL(this.base).hostname;
        const ws = this.socket = new WebSocket(`ws://${host}:${target.wsPort}`);
        await deadline(new Promise<void>((resolve, reject) => {
            let nonce = "";
            ws.onerror = () => reject(new Error("WebSocketへ接続できません。"));
            ws.onclose = () => { if (!this.session) reject(new Error("WebSocketが切断されました。")); else if (!this.closed) this.fail("Wi-Fi接続が切断されました。"); };
            ws.onmessage = event => {
                this.inbound = this.inbound.then(async () => {
                    if (this.closed || ws !== this.socket) return;
                    const reply = JSON.parse(String(event.data));
                    if (!nonce) {
                        if (endpoint(reply).id !== target.id || typeof reply.challenge !== "string") throw new Error("別の機器が応答しました。");
                        nonce = reply.challenge;
                        const proof = await this.mac(`claim|${target.id}|${nonce}|${location.origin}`);
                        ws.send(JSON.stringify({ op: "claim", challenge: nonce, proof, origin: location.origin }));
                    } else if (!this.session) { await this.acceptSession(reply, nonce, target.id); resolve(); }
                    else {
                        if (!Number.isSafeInteger(reply.counter) || reply.counter <= this.outputCounter) throw new Error("古い通知を受信しました。");
                        await this.verify(`${this.session}|packet|${reply.counter}|${reply.data}`, reply.proof);
                        this.outputCounter = reply.counter;
                        this.receive(reply.data);
                    }
                }).catch(error => { if (!this.session) reject(error); else this.fail("Wi-Fi応答を確認できません。"); });
            };
        }), signal, 5000);
        void info;
    }
    private receive(value: unknown): void {
        if (this.closed) return;
        const bytes = decodeHex(value);
        const status = bytes.length === 12 && bytes[0] === 1;
        const balance = bytes.length === 20 && bytes[0] === 2;
        const telemetry = bytes[0] === DeviceTelemetryVersion && bytes.length >= DeviceTelemetryHeaderLength &&
            bytes.length <= DeviceTelemetryMaxLength &&
            (bytes.length - DeviceTelemetryHeaderLength) % IMU6AxisRecordLength === 0;
        if (!status && !balance && !telemetry) {
            throw new Error("機器の通知形式が正しくありません。");
        }
        this.onPacket(new DataView(bytes.buffer));
    }
    private async poll(): Promise<void> {
        try {
            while (!this.closed && this.polling) {
                const reply = await this.json("/events", undefined, true);
                if (reply.session !== this.session || !Array.isArray(reply.packets)) throw new Error("接続世代が変わりました。");
                await this.verify(`${this.session}|events|${reply.counter}|${JSON.stringify(reply.packets)}`, reply.proof);
                reply.packets.forEach((data: unknown) => this.receive(data));
                await wait(100, this.controller.signal);
            }
        } catch { if (!this.closed) this.fail("Wi-Fiの応答が途切れました。再接続してください。"); }
    }
    async write(bytes: Uint8Array): Promise<void> {
        if (!this.connected) throw new Error("Wi-Fi接続が切れました。");
        const data = packetHex(bytes);
        if (this.socket?.readyState === WebSocket.OPEN) {
            const count = ++this.counter, mac = await this.mac(`${this.session}|${count}|/command|${data}`);
            if (!this.connected) throw new Error("Wi-Fi接続が切れました。");
            this.socket.send(JSON.stringify({ op: "command", session: this.session, counter: count, data, mac }));
        } else await this.json("/command", data, true);
    }
    async image(signal: AbortSignal): Promise<Blob> {
        if (!this.connected || !this.endpoint?.camera) throw new Error("カメラを利用できません。");
        const count = ++this.counter, mac = await this.mac(`${this.session}|${count}|/capture|`);
        const controller = this.latestImageController = new AbortController();
        const cancel = () => controller.abort(); signal.addEventListener("abort", cancel, { once: true });
        const timer = setTimeout(cancel, 4000);
        try {
            signal.throwIfAborted();
            const response = await fetch(this.cameraBase + "/capture", { headers: {
                "X-Uroa-Session": this.session, "X-Uroa-Counter": String(count), "X-Uroa-Mac": mac },
                signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-store" });
            if (!response.ok || !response.headers.get("content-type")?.startsWith("image/jpeg")) throw new Error("カメラ画像を取得できません。");
            const image = await response.blob(); if (image.size > 1024 * 1024) throw new Error("カメラ画像が大きすぎます。");
            return image;
        } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); this.latestImageController = undefined; }
    }
    private fail(message: string): void { this.close(); this.onLost(message); }
    close(): void {
        if (this.closed) return;
        if (this.session && this.polling && this.cryptoKey) {
            const session = this.session, count = ++this.counter, base = this.base, key = this.cryptoKey;
            void crypto.subtle.sign("HMAC", key, encoder.encode(`${session}|${count}|/release|`)).then(signature =>
                fetch(base + "/release", { method: "POST", headers: { "X-Uroa-Session": session,
                    "X-Uroa-Counter": String(count), "X-Uroa-Mac": packetHex(new Uint8Array(signature)) },
                    body: "", credentials: "omit", redirect: "error", keepalive: true, signal: AbortSignal.timeout(1000) })
            ).catch(() => {});
        }
        this.closed = true; this.polling = false; this.latestImageController?.abort();
        this.controller.abort(); this.socket?.close(); this.socket = undefined; this.session = ""; this.cryptoKey = undefined;
    }
}
