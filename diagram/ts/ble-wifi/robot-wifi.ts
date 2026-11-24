/**
 * BLEによるWi-Fi設定と、LAN内機器とのHMAC認証付きHTTP/WebSocket通信を担当する。カメラ画像の取得は通常の制御パケットから分離する。
 */
import type { ControlPacketKind, ControlTransport } from "./control-connection";
import { DeviceInfoMaxLength } from "./device-telemetry";
import { bytecodeTransfer, type BytecodeChannel } from "./bytecode-transfer";
import type { DebugChannel } from "./debug-protocol";

/** Wi-Fi transport and authenticated BLE provisioning. No live credentials are serialized. */
export interface RobotEndpoint {
    /**
     * 機器固有番号またはブラウザーの保存候補を識別する名前。
     */
    id: string; /** 機器の利用者向け表示名。 */ name: string; /** 接続先機器のmDNSホスト名。 */ host: string; /** 接続先機器の最後に確認したLAN内IPv4アドレス。 */ ip: string;
    /**
     * 機器の認証付きHTTP制御窓口のポート番号。
     */
    port: number; /** 機器のWebSocket制御窓口のポート番号。 */ wsPort: number; /** 機器のJPEG取得用HTTP窓口のポート番号。 */ cameraPort: number; /** 接続先がカメラ画像の取得に対応しているか。 */ camera: boolean;
}
/**
 * BLE設定窓口が返す機器接続先とWi-Fi設定の進行状態。
 */
export interface ProvisionInfo extends RobotEndpoint { /** 設定窓口から取得する公開教材用の接続キー。図には保存しない。 */ key?: string; /** 機器またはVMが報告した状態番号・状態値。 */ state: string; /** 設定・通信・処理が返した失敗の説明。 */ error?: string; }
/**
 * Wi-Fi検索で得たSSID・受信強度・パスワードの要否。
 */
export interface WifiNetwork { /** アクセスポイントのネットワーク名。 */ ssid: string; /** アクセスポイントの受信強度（dBm）。 */ rssi: number; /** パスワードなしで接続するアクセスポイントか。 */ open: boolean; }
/**
 * BLEのWi-Fi設定に必要なReadとresponse付きWriteの最小型。
 */
export interface ConfigCharacteristic { /** 現在のGATT特性値を読み取る。 */ readValue(): Promise<DataView>; /** GATTの受付応答を待ってバイト列を書き込む。 */ writeValueWithResponse(value: Uint8Array): Promise<void>; }
const /** 要求文字列と署名対象をUTF-8へ変換する共通エンコーダー。 */ encoder = new TextEncoder(), /** BLE設定応答のUTF-8 JSONを読む共通デコーダー。 */ decoder = new TextDecoder();
/**
 * 成功したSSIDの一覧だけを保存するlocalStorageのキー。
 */
const ssidHistoryKey = "uroa-wifi-ssids-v1";
/**
 * 保存済みのSSID履歴を型・UTF-8長で検証し、重複なしの最大20件で返す。
 */
export function savedWifiSSIDs(): string[] {
    try {
        const data: unknown = JSON.parse(localStorage.getItem(ssidHistoryKey) || "[]");
        if (!Array.isArray(data)) return [];
        return [...new Set(data.filter((ssid): ssid is string =>
            typeof ssid === "string" && ssid.length > 0 && encoder.encode(ssid).length <= 32))].slice(0, 20);
    } catch { return []; }
}
/**
 * 成功したSSIDを先頭へ追加し、パスワードを含めず履歴を最大20件に保つ。
 */
export function rememberWifiSSID(ssid: string): void {
    if (!ssid.length || encoder.encode(ssid).length > 32) return;
    try {
        localStorage.setItem(ssidHistoryKey, JSON.stringify([ssid, ...savedWifiSSIDs().filter(value => value !== ssid)].slice(0, 20)));
    } catch { /* History is optional; manual entry and scanning remain available. */ }
}
// Public teaching key; keep in sync with deviceKey in firmware/src/network.cpp.
const teachingConnectionKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
/**
 * 通信バイト列を小文字の16進文字列へ変換する。
 *
 * @param data 初期属性または処理対象のデータ。
 */
export function packetHex(data: Uint8Array): string { return [...data].map(b => b.toString(16).padStart(2, "0")).join(""); }
/**
 * 偶数桁の小文字16進表現を検証し、バイト列へ復号する。
 *
 * @param value 検証または反映する値。
 */
function decodeHex(value: unknown): Uint8Array<ArrayBuffer> {
    if (typeof value !== "string" || !/^(?:[0-9a-f]{2})+$/.test(value)) throw new Error("機器の応答形式が正しくありません。");
    return Uint8Array.from(value.match(/../g)!, x => parseInt(x, 16));
}
/**
 * mDNS名またはプライベートIPv4アドレスとして接続可能な形式かを検査する。
 *
 * @param value 検証または反映する値。
 */
function validHost(value: unknown): value is string {
    if (typeof value !== "string") return false;
    if (/^[a-z0-9][a-z0-9-]{0,62}\.local$/.test(value)) return true;
    const octets = value.split(".").map(Number);
    return /^\d+\.\d+\.\d+\.\d+$/.test(value) && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255) &&
        (octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
}
/**
 * 機器ID・LAN内アドレス・ポート範囲を検証し、接続情報を取り出す。
 *
 * @param value 検証または反映する値。
 */
export function endpoint(value: unknown): RobotEndpoint {
    const data = value as Partial<RobotEndpoint> | undefined;
    if (!data || typeof data.id !== "string" || !/^uroa-[a-f0-9]{12}$/.test(data.id) ||
        typeof data.name !== "string" || !validHost(data.host) || (data.ip !== "" && !validHost(data.ip)) ||
        ![data.port, data.wsPort, data.cameraPort].every(p => Number.isInteger(p) && p! > 0 && p! <= 65535))
        throw new Error("機器の接続情報が正しくありません。");
    return { id: data.id, name: data.name.slice(0, 64), host: data.host, ip: data.ip!,
        port: data.port!, wsPort: data.wsPort!, cameraPort: data.cameraPort!, camera: data.camera === true };
}
/**
 * 対応する安全なブラウザー環境で、資格情報保存の候補をパスワード管理へ渡す。
 */
export function savePassword(id: string, password: string): void {
    const Constructor = (window as Window & { /** 対応ブラウザーが提供する資格情報保存用コンストラクター。 */ PasswordCredential?: new (data: { /** 機器固有番号またはブラウザーの保存候補を識別する名前。 */ id: string; /** ブラウザーの保存候補として渡す一時的なパスワード。 */ password: string }) => Credential }).PasswordCredential;
    if (!window.isSecureContext || !Constructor || !navigator.credentials?.store || !password) return;
    try { void navigator.credentials.store(new Constructor({ id, password })).catch(() => {}); } catch { /* Browser owns save approval. */ }
}
/**
 * 取消シグナルで中断できるミリ秒単位の待機を行う。
 *
 * @param ms 待機または期限の時間（ms）。
 * @param signal 処理を取り消すシグナル。
 */
export function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const cancel = () => { clearTimeout(timer); reject(new DOMException("中断しました。", "AbortError")); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, ms);
        signal.addEventListener("abort", cancel, { once: true });
    });
}
/**
 * 既存の非同期処理へ期限と取消を付け、タイマーと購読を完了時に解除する。
 *
 * @param signal 処理を取り消すシグナル。
 * @param ms 待機または期限の時間（ms）。
 */
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
/**
 * BLE接続成立とWi-Fi設定に必要なペアリング認証は別の状態。
 * ESP32のuroa_ble.cppが接続時に認証を開始し、設定窓口で暗号化・MITM認証を検査する。
 * Not pairedは操作案内へ変換する。資格情報や設定要求をログへ出さず、自動再送しない。
 */
export class BLEWifiSetup {
    /**
     * 通信要求を直列化する待ち列の末尾Promise。
     */
    private tail: Promise<unknown> = Promise.resolve();
    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(/** Wi-Fi設定の分割要求を書き込むGATT特性。 */ private tx: ConfigCharacteristic, /** Wi-Fi設定の処理結果を読み取るGATT特性。 */ private rx: ConfigCharacteristic) {}
    /**
     * 設定JSONをBLEへ分割送信し、期限付きで処理結果を読む。送信バッファーは使用後に消去する。
     *
     * @param data 初期属性または処理対象のデータ。
     * @param signal 処理を取り消すシグナル。
     */
    request(data: object, signal: AbortSignal): Promise<ProvisionInfo & { /** Wi-Fi検索結果の一覧が持つページ数。 */ pages?: number; /** 一ページ分または検索全体のアクセスポイント一覧。 */ networks?: WifiNetwork[] }> {
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
            } catch (error) {
                if (error instanceof Error && /GATT Error: Not paired/i.test(error.message)) {
                    throw new Error("BLEのペアリング認証が完了していません。Windowsのペアリング要求で123456を入力し、もう一度操作してください。要求が出ない場合はWindowsのBluetooth設定でこの基板の登録を削除し、diagramからBLE接続し直してください。");
                }
                throw error;
            } finally { bytes.fill(0); bytes = new Uint8Array(); }
        });
        this.tail = task; return task;
    }
    /**
     * 現在のBLE機器のWi-Fi情報を読み、機器形式と教材用キーを検証する。
     *
     * @param signal 処理を取り消すシグナル。
     */
    async info(signal: AbortSignal): Promise<ProvisionInfo> {
        const data = await this.request({ op: "info" }, signal); endpoint(data);
        if (data.key !== teachingConnectionKey) throw new Error("教材用の固定接続キーに対応したファームウェアを書き込んでください。");
        return data;
    }
    /**
     * アクセスポイント検索を要求し、全ページを重複なし・受信強度順にまとめる。
     *
     * @param signal 処理を取り消すシグナル。
     */
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
    /**
     * SSIDとパスワードのUTF-8長を検査し、現在のBLE機器へ接続設定を送る。
     *
     * @param signal 処理を取り消すシグナル。
     */
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
export class RobotWifi implements ControlTransport {
    /**
     * 共通通信層でBLEとWi-Fiの経路を区別する識別子。
     */
    readonly kind = "wifi";
    /**
     * この通信経路の要求を切断時にまとめて取り消す制御元。
     */
    private controller = new AbortController();
    /**
     * 認証済み制御に利用するWebSocket。HTTP利用時は未設定。
     */
    private socket?: WebSocket;
    /**
     * 要求署名と応答検証に使う、エクスポート不可のHMAC鍵。
     */
    private cryptoKey?: CryptoKey;
    /**
     * 現在の認証済み接続を識別するセッション文字列。
     */
    private session = "";
    /**
     * 現在セッション内で単調増加させる送信要求番号。
     */
    private counter = 0;
    /**
     * WebSocketで受理済みの最新通知番号。古い通知を拒否する。
     */
    private outputCounter = 0;
    /**
     * 現在接続先の制御HTTP URLの基点。
     */
    private base = "";
    /**
     * 通常制御とは別ポートのカメラ画像HTTP URLの基点。
     */
    private cameraBase = "";
    /**
     * WebSocketの認証・通知処理を受信順に行うための待ち列。
     */
    private inbound: Promise<void> = Promise.resolve();
    /**
     * HTTPによるイベント取得を継続している状態。
     */
    private polling = false;
    /**
     * この通信インスタンスの終了状態。終了後の結果は採用しない。
     */
    private closed = false;
    /**
     * 最新のカメラ画像取得を期限・切断で中断する制御元。
     */
    private latestImageController?: AbortController;
    /**
     * 本人確認済みの機器名・アドレス・各通信ポート。
     */
    endpoint?: RobotEndpoint;
    /**
     * 認証済みの通常パケットを受け取る購読者の集合。
     */
    private packetListeners = new Set<(data: DataView | undefined, kind?: ControlPacketKind) => void>();
    /**
     * 通信終了と利用者向けの失敗メッセージを所有元へ通知する処理。
     */
    onLost: (message: string) => void = () => {};
    /** 認証済みバイト列を共通層へ渡す。形式検証・ACK照合はcontrol-connection.tsが行う。 */
    subscribePackets(listener: (data: DataView | undefined, kind?: ControlPacketKind) => void): () => void {
        this.packetListeners.add(listener);
        return () => {
            this.packetListeners.delete(listener);
        };
    }
    /**
     * 切断済みでなく、認証済みセッションを保持しているかを返す。
     */
    get connected(): boolean { return !this.closed && !!this.session; }
    /**
     * 現在のHMAC鍵で署名対象のUTF-8文字列へSHA-256の署名を付ける。
     *
     * @param message 画面または診断に表示する説明。
     */
    private async mac(message: string): Promise<string> {
        if (!this.cryptoKey) throw new Error("接続キーがありません。");
        return packetHex(new Uint8Array(await crypto.subtle.sign("HMAC", this.cryptoKey, encoder.encode(message))));
    }
    /**
     * 受け取った16進署名を現在のHMAC鍵で検証し、不一致を例外にする。
     *
     * @param message 画面または診断に表示する説明。
     */
    private async verify(message: string, proof: unknown): Promise<void> {
        if (!this.cryptoKey || !await crypto.subtle.verify("HMAC", this.cryptoKey, decodeHex(proof), encoder.encode(message)))
            throw new Error("機器の認証に失敗しました。");
    }
    /**
     * HTTP要求へ任意の認証ヘッダーと期限を付け、応答番号を照合してJSONを返す。
     */
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
            if (["/events", "/bytecode-result", "/debug-result", "/debug-event", "/debug-data"].includes(path) &&
                reply.counter !== String(requestCount)) {
                throw new Error("応答の番号が一致しません。");
            }
            return reply;
        } finally { clearTimeout(timer); this.controller.signal.removeEventListener("abort", abort); }
    }
    /**
     * 機器IDを照合し、WebSocketまたはHTTPで制御権の認証を完了する。
     *
     * @param outerSignal 呼出し元の実行を取り消すシグナル。
     */
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
    /**
     * 機器ID・nonce・接続情報をHMACで照合してセッションを採用する。
     */
    private async acceptSession(reply: any, nonce: string, id: string): Promise<void> {
        if (endpoint(reply).id !== id || typeof reply.session !== "string" || !/^[a-f0-9]{32}$/.test(reply.session)) throw new Error("機器の接続情報が正しくありません。");
        await this.verify(`ready|${id}|${nonce}|${reply.session}|${reply.host}|${reply.ip}`, reply.proof);
        if (this.closed) throw new DOMException("中断しました。", "AbortError");
        this.session = reply.session; this.endpoint = endpoint(reply);
    }
    /**
     * WebSocketのチャレンジ認証を行い、以後の通知を番号と署名で検証する。
     *
     * @param signal 処理を取り消すシグナル。
     */
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
    /**
     * 認証済みの16進パケットをDataViewへ変換し、通常通信の購読者へ渡す。
     *
     * @param value 検証または反映する値。
     */
    private receive(value: unknown): void {
        if (this.closed) return;
        const bytes = decodeHex(value);
        const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (const listener of this.packetListeners) {
            listener(data);
        }
    }
    /**
     * HTTPイベントを署名とセッションで照合しながら継続取得する。
     */
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
    /** 通常指令と機器一覧を同じ認証・要求番号の窓で送る。受付と内容検証の区別は共通層を参照。 */
    private async writeControl(op: "command" | "device-info" | "bytecode" | "debug-control", bytes: Uint8Array): Promise<void> {
        if (!this.connected) {
            throw new Error("Wi-Fi接続が切れました。");
        }
        const data = packetHex(bytes);
        const path = `/${op}`;
        if (this.socket?.readyState === WebSocket.OPEN) {
            const count = ++this.counter;
            const mac = await this.mac(`${this.session}|${count}|${path}|${data}`);
            if (!this.connected) {
                throw new Error("Wi-Fi接続が切れました。");
            }
            this.socket.send(JSON.stringify({ op, session: this.session, counter: count, data, mac }));
        }
        else {
            const reply = await this.json(path, data, true);
            if (reply.accepted !== true) {
                throw new Error("Wi-Fi機器が書き込みを受け付けませんでした。");
            }
        }
    }

    /** Command v1を認証付きで送る。機器のStatus ACKは共通層が照合する。 */
    async write(bytes: Uint8Array): Promise<void> {
        await this.writeControl("command", bytes);
    }

    /**
     * 機器一覧の生バイト列を16進文字列で送る。空の一覧は空文字列のPOST／dataとして送る。
     * HMAC対象はsession|counter|/device-info|data。Commandの署名を別窓口へ流用しない。
     * HTTPはコールバックへの配送応答、WebSocketはブラウザーの送信キューへの追加までを待つ。
     * ESP32の内容検証ACKは待たない。
     */
    async writeDeviceInfo(bytes: Uint8Array): Promise<void> {
        if (bytes.byteLength > DeviceInfoMaxLength) {
            throw new Error("機器情報の送信サイズが上限を超えています。");
        }
        await this.writeControl("device-info", bytes);
    }

    /**
     * 最大1024バイトの一括転送を認証済みWi-Fiへ接続する。最終Resultだけを別Readで確認する。
     * Resultはセンサー通知から独立した署名付きHTTP Readを使う。共通契約はbytecode-transfer.ts。
     */
    async openBytecode(): Promise<BytecodeChannel> {
        if (!this.connected) {
            throw new Error("Wi-Fi接続が切れました。");
        }
        const session = this.session;
        return {
            packetLength: bytecodeTransfer.packetLength,
            write: async bytes => {
                if (!this.connected || session !== this.session || bytes.length < bytecodeTransfer.headerLength ||
                    bytes.length > bytecodeTransfer.packetLength) {
                    throw new Error("プログラム転送の接続またはフレーム長が不正です。");
                }
                await this.writeControl("bytecode", bytes);
            },
            readResult: () => this.readControlValue("bytecode-result", 20, 20, session),
        };
    }

    /** 同じ接続・要求番号・窓口の署名付きRead値だけを復号する。契約はbytecode-transfer.ts/debug-protocol.ts。 */
    private async readControlValue(resource: "bytecode-result" | "debug-result" | "debug-event" | "debug-data",
        minLength: number, maxLength: number, session: string): Promise<DataView> {
        if (!this.connected || session !== this.session) {
            throw new Error("機器の接続が変わりました。");
        }
        const reply = await this.json(`/${resource}`, undefined, true);
        if (!this.connected || session !== this.session || reply.session !== session || typeof reply.data !== "string") {
            throw new Error("機器の応答の接続が一致しません。");
        }
        await this.verify(`${session}|${resource}|${reply.counter}|${reply.data}`, reply.proof);
        const bytes = decodeHex(reply.data);
        if (bytes.length < minLength || bytes.length > maxLength) {
            throw new Error("機器の応答の長さが不正です。");
        }
        return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    /** ACK・停止Event・選択Dataを独立したHTTP Readで取得し、停止検出は共通の1秒ポーリングを使う。 */
    async openDebug(): Promise<DebugChannel> {
        if (!this.connected) {
            throw new Error("Wi-Fi接続が切れました。");
        }
        const session = this.session;
        return {
            writeControl: async bytes => {
                if (!this.connected || session !== this.session || bytes.length < 8 || bytes.length > 20) {
                    throw new Error("デバッグ要求の接続または長さが不正です。");
                }
                await this.writeControl("debug-control", bytes);
            },
            readResult: () => this.readControlValue("debug-result", 20, 20, session),
            readEvent: () => this.readControlValue("debug-event", 20, 20, session),
            readData: () => this.readControlValue("debug-data", 1, 20, session),
        };
    }
    /**
     * 現在セッションでJPEGを認証付き取得し、通常制御とは別のBlobとして返す。
     *
     * @param signal 処理を取り消すシグナル。
     */
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
    /**
     * 通信資源を終了し、所有元へ接続喪失の説明を通知する。
     *
     * @param message 画面または診断に表示する説明。
     */
    private fail(message: string): void { this.close(); this.onLost(message); }
    /**
     * 全要求・ソケット・画像取得・認証状態を終了する。
     */
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
        this.packetListeners.clear();
        this.closed = true; this.polling = false; this.latestImageController?.abort();
        this.controller.abort(); this.socket?.close(); this.socket = undefined; this.session = ""; this.cryptoKey = undefined;
    }
}
