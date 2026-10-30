import { Vec2 } from "@i18n";
import { FunctionBlock, registerFunctionBlock } from "../block";
import { Button, type Attr, type UI } from "../ui";
import { theCanvas } from "../diagram_util";
import { imuType, type IMUValue } from "../data_type";
import { BLEWifiSetup, RobotWifi, type RobotEndpoint } from "./robot-wifi";
import { RobotWifiDialog } from "./robot-wifi-dialog";
import { setCameraProvider } from "../camera/camera-feed";
import { parseBalanceSample, type BalanceSample } from "../plot/plot_telemetry";

// Same GATT service and packet format as robot/esp32-ble-lab.
export const BLE_UUID = {
    service: "f3641400-00b0-4240-ba50-05ca45bf8abc",
    command: "f3641401-00b0-4240-ba50-05ca45bf8abc",
    telemetry: "f3641402-00b0-4240-ba50-05ca45bf8abc",
    status: "f3641403-00b0-4240-ba50-05ca45bf8abc",
    wifiConfig: "f3641404-00b0-4240-ba50-05ca45bf8abc",
    wifiResult: "f3641405-00b0-4240-ba50-05ca45bf8abc",
} as const;

// Structural types keep this browser-only module independent of the robot build.
interface BLECharacteristic extends EventTarget {
    value?: DataView;
    startNotifications(): Promise<BLECharacteristic>;
    readValue(): Promise<DataView>;
    writeValueWithResponse(value: Uint8Array): Promise<void>;
}
interface BLEService { getCharacteristic(uuid: string): Promise<BLECharacteristic>; }
interface BLEServer {
    connected: boolean;
    connect(): Promise<BLEServer>;
    disconnect(): void;
    getPrimaryService(uuid: string): Promise<BLEService>;
}
interface BLEDevice extends EventTarget { name?: string; gatt?: BLEServer; }
interface BLEAdapter {
    requestDevice(options: { acceptAllDevices: true; optionalServices: string[] }): Promise<BLEDevice>;
}
export type BLEPhase = "idle" | "selecting" | "connecting" | "connected" | "error" | "unavailable";
export interface BLEConnectionState { phase: BLEPhase; deviceName: string; message: string; pcaAvailable: boolean; imuAvailable: boolean; streaming: boolean; transport?: "ble" | "wifi"; }
export interface IMUSample { readonly sequence: number; readonly uptime: number; readonly value: IMUValue; }

/** Decode robot's 20-byte telemetry: gyro °/s, acceleration m/s². */
export function parseIMUSample(data: DataView): IMUSample {
    if (data.byteLength !== 20 || data.getUint8(0) !== 1) throw new Error("IMUデータの形式が正しくありません。");
    const acc = [8, 10, 12].map(offset => data.getInt16(offset, true) / 16384 * 9.80665);
    const gyro = [14, 16, 18].map(offset => data.getInt16(offset, true) / 131);
    return Object.freeze({
        sequence: data.getUint16(2, true), uptime: data.getUint32(4, true),
        value: imuType.copyValue({ gyro: { x: gyro[0], y: gyro[1], z: gyro[2] }, acc: { x: acc[0], y: acc[1], z: acc[2] } }) as IMUValue,
    });
}

const errors = ["成功", "指令形式が不正（速度制御には対応ファームウェアが必要です）", "範囲外の指令", "サーボが無効／応答タイムアウト", "デバイスが見つかりません", "指令が混雑しています", "I²C通信エラー", "角度／速度モードが異なります。無効化してから有効化してください。"];
type BLEOpcode = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type ServoMode = "angle" | "speed";
const servoOperations: Partial<Record<BLEOpcode, string>> = { 1: "ARM", 2: "MOVE", 3: "STOP", 7: "DISABLE", 8: "ARM_SPEED", 9: "SET_SPEED" };

/** One connection per diagram document. Blocks subscribe; GATT objects are never saved. */
export class BLEConnection {
    state: BLEConnectionState = { phase: "idle", deviceName: "", message: "", pcaAvailable: false, imuAvailable: false, streaming: false };
    private listeners = new Set<(state: BLEConnectionState) => void>();
    private sampleListeners = new Set<(sample: IMUSample) => void>();
    private balanceListeners = new Set<(sample: BalanceSample) => void>();
    private requestedRate = 0;
    private device?: BLEDevice;
    private tx?: BLECharacteristic;
    private rx?: BLECharacteristic;
    private status?: BLECharacteristic;
    private generation = 0;
    private sequence = 0;
    private heartbeat?: ReturnType<typeof setInterval>;
    private connectTimer?: ReturnType<typeof setTimeout>;
    private tail: Promise<unknown> = Promise.resolve();
    private pending = new Map<number, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    private armedChannels = new Map<number, ServoMode>();
    private servoVersions = Array<number>(16).fill(0);
    private service?: BLEService;
    private wifi?: RobotWifi;
    private wifiDialog?: RobotWifiDialog;
    private provisioning = false;
    private closing = false;

    isServoArmed(channel: number, mode?: ServoMode): boolean {
        return this.armedChannels.has(channel) && (mode === undefined || this.armedChannels.get(channel) === mode);
    }

    private notify(): void { this.listeners.forEach(listener => listener(this.state)); }

    private resetServos(): void {
        this.armedChannels.clear();
        this.servoVersions = this.servoVersions.map(version => version + 1);
    }

    private checkChannel(channel: number): void {
        if (!Number.isInteger(channel) || channel < 0 || channel > 15) throw new Error("チャンネルは0～15の整数で指定してください。");
    }

    private checkServoConnection(): void {
        if (this.state.phase !== "connected") throw new Error("BLE接続ブロックでESP32へ接続してください。");
        if (!this.state.pcaAvailable) throw new Error("PCA9685が見つかりません。");
    }

    async armServo(channel: number, isCurrent = () => true, mode: ServoMode = "angle"): Promise<void> {
        this.checkChannel(channel);
        this.checkServoConnection();
        const version = ++this.servoVersions[channel];
        await this.sendControl(mode === "speed" ? 8 : 1, mode === "speed" ? 0 : 9000, channel, 0,
            () => version === this.servoVersions[channel] && isCurrent(),
            () => { this.armedChannels.set(channel, mode); this.notify(); });
    }

    async moveAngle(channel: number, angle: number, duration: number, isCurrent = () => true): Promise<void> {
        this.checkChannel(channel);
        this.checkServoConnection();
        if (!Number.isFinite(angle) || angle < 60 || angle > 120) throw new Error("角度は60～120°で指定してください。");
        if (!Number.isInteger(duration) || duration < 0 || duration > 10000) throw new Error("移動時間は0～10000msの整数で指定してください。");
        if (!this.isServoArmed(channel, "angle")) throw new Error("先に角度モードで90°の有効化を行ってください。");
        const version = this.servoVersions[channel];
        await this.sendControl(2, Math.round(angle * 100), channel, duration,
            () => version === this.servoVersions[channel] && this.isServoArmed(channel, "angle") && isCurrent());
    }

    /** 旧呼出元の互換窓口。新しい呼出元はmoveAngle()を使う。 */
    async moveServo(channel: number, angle: number, duration: number, isCurrent = () => true): Promise<void> {
        await this.moveAngle(channel, angle, duration, isCurrent);
    }

    /** 速度は方向付きの指令%。0%はPWMを維持して中立パルスを送る。 */
    async setSpeed(channel: number, percent: number, isCurrent = () => true): Promise<void> {
        this.checkChannel(channel);
        this.checkServoConnection();
        if (!Number.isFinite(percent) || percent < -100 || percent > 100) {
            throw new Error("速度は−100～100%で指定してください。");
        }
        if (!this.isServoArmed(channel, "speed")) {
            throw new Error("先に速度モードで0%の有効化を行ってください。");
        }
        const version = this.servoVersions[channel];
        await this.sendControl(9, Math.round(percent * 100), channel, 0,
            () => version === this.servoVersions[channel] && this.isServoArmed(channel, "speed") && isCurrent());
    }

    async disableServo(channel: number): Promise<void> {
        this.checkChannel(channel);
        // Cancel queued ARM/MOVE before placing DISABLE behind any in-flight write.
        this.servoVersions[channel]++;
        this.armedChannels.delete(channel);
        this.notify();
        if (this.state.phase !== "connected") return;
        const generation = this.generation;
        try { await this.sendControl(7, 0, channel); }
        catch (error) {
            if (generation === this.generation) this.close("error", "サーボの停止を確認できません。再接続してください。");
            throw error;
        }
    }

    async stopServos(): Promise<void> {
        this.resetServos();
        this.notify();
        if (this.state.phase !== "connected") return;
        const generation = this.generation;
        try { await this.sendControl(3); }
        catch (error) {
            if (generation === this.generation) this.close("error", "サーボの停止を確認できません。再接続してください。");
            throw error;
        }
    }

    availabilityMessage(): string {
        if (!window.isSecureContext) return "HTTPS、またはこのPCのlocalhostで開いてください。";
        if (!(navigator as Navigator & { bluetooth?: BLEAdapter }).bluetooth) return "このブラウザーではBLEを利用できません。";
        return "";
    }

    subscribe(listener: (state: BLEConnectionState) => void): () => void {
        this.listeners.add(listener);
        listener(this.state);
        return () => {
            this.listeners.delete(listener);
            if (!this.listeners.size) this.disconnect();
        };
    }

    subscribeSamples(listener: (sample: IMUSample) => void): () => void {
        this.sampleListeners.add(listener);
        this.updateStream();
        return () => {
            this.sampleListeners.delete(listener);
            this.updateStream();
        };
    }

    subscribeBalanceSamples(listener: (sample: BalanceSample) => void): () => void {
        this.balanceListeners.add(listener);
        this.updateStream();
        return () => { this.balanceListeners.delete(listener); this.updateStream(); };
    }

    private updateStream(): void {
        if (this.state.phase !== "connected" || this.provisioning) return;
        const rate = (this.sampleListeners.size || this.balanceListeners.size) && this.state.imuAvailable ? 10 : 0;
        if (rate === this.requestedRate) return;
        this.requestedRate = rate;
        const generation = this.generation;
        void this.sendControl(4, rate).catch(error => {
            if (generation === this.generation) this.close("error", error.message);
        });
    }

    private publish(phase: BLEPhase, deviceName = "", message = ""): void {
        const active = phase === "connected" || phase === "connecting";
        this.state = { phase, deviceName, message, pcaAvailable: active && this.state.pcaAvailable, imuAvailable: active && this.state.imuAvailable, streaming: active && this.state.streaming,
            transport: this.wifi?.connected ? "wifi" : "ble" };
        this.notify();
    }

    private hardwareStatus(data: DataView): void {
        const flags = data.getUint8(4);
        const pcaAvailable = !!(flags & 1), imuAvailable = !!(flags & 2), streaming = !!(flags & 8);
        const stopped = !pcaAvailable || (!(flags & 4) && (this.armedChannels.size > 0 || data.getUint16(2, true) === 0));
        if (stopped) this.resetServos();
        const channel = data.getUint8(5);
        const mode: ServoMode = flags & 0x10 ? "speed" : "angle";
        if (channel < 16 && this.armedChannels.has(channel) && this.armedChannels.get(channel) !== mode) {
            this.armedChannels.delete(channel);
            this.servoVersions[channel]++;
            this.notify();
        }
        const channelStopped = data.getUint8(1) === 3 && channel < 16 && this.armedChannels.delete(channel);
        if (channelStopped) this.servoVersions[channel]++;
        if (stopped || channelStopped || this.state.pcaAvailable !== pcaAvailable || this.state.imuAvailable !== imuAvailable || this.state.streaming !== streaming) {
            this.state = { ...this.state, pcaAvailable, imuAvailable, streaming };
            this.notify();
            this.updateStream();
        }
    }

    private sampleChanged = (event: Event): void => {
        if (this.state.phase !== "connected" || !this.state.imuAvailable || !this.requestedRate) return;
        let sample: IMUSample;
        try {
            const value = (event.target as BLECharacteristic).value;
            if (!value) throw new Error("IMUデータがありません。");
            if (value.byteLength === 20 && value.getUint8(0) === 2) {
                if (value.getUint8(1) !== 1) return; // 未対応のプロットschemaはIMUとして解釈しない。
                const balance = parseBalanceSample(value);
                for (const listener of this.balanceListeners) {
                    try { listener(balance); }
                    catch (error) { console.error("Balance sample handler failed", error); }
                }
                return;
            }
            sample = parseIMUSample(value);
        } catch (error) {
            this.close("error", error instanceof Error ? error.message : "IMUデータを受信できませんでした。");
            return;
        }
        for (const listener of this.sampleListeners) {
            try { listener(sample); }
            catch (error) { console.error("IMU sample handler failed", error); }
        }
    };

    private lost = (): void => {
        if (this.wifi?.connected) return;
        this.close("idle", "BLE接続が切れました。");
    };
    private statusChanged = (event: Event): void => {
        try {
            const value = (event.target as BLECharacteristic).value;
            if (!value || value.byteLength !== 12 || value.getUint8(0) !== 1) throw new Error("状態データの形式が正しくありません。");
            this.hardwareStatus(value);
            const pending = this.pending.get(value.getUint16(2, true));
            if (pending) {
                clearTimeout(pending.timer);
                this.pending.delete(value.getUint16(2, true));
                const code = value.getUint8(1);
                if (code) pending.reject(new Error(errors[code] ?? `機器エラー ${code}`));
                else pending.resolve();
            }
        } catch (error) {
            this.close("error", error instanceof Error ? error.message : "状態を受信できませんでした。");
        }
    };

    private close(phase: BLEPhase, message = ""): void {
        this.closing = true;
        this.generation++;
        this.wifiDialog?.close(); this.wifiDialog = undefined;
        this.provisioning = false;
        this.wifi?.close(); this.wifi = undefined; this.service = undefined;
        setCameraProvider();
        this.state.transport = "ble";
        this.resetServos();
        clearInterval(this.heartbeat);
        clearTimeout(this.connectTimer);
        this.heartbeat = this.connectTimer = undefined;
        this.requestedRate = 0;
        this.status?.removeEventListener("characteristicvaluechanged", this.statusChanged);
        this.rx?.removeEventListener("characteristicvaluechanged", this.sampleChanged);
        this.device?.removeEventListener("gattserverdisconnected", this.lost);
        const device = this.device;
        this.device = this.tx = this.rx = this.status = undefined;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error("BLE接続が切れました。"));
        }
        this.pending.clear();
        try { device?.gatt?.disconnect(); } catch { /* Already disconnected. */ }
        this.publish(phase, "", message);
        this.closing = false;
    }

    disconnect(): void { this.close("idle"); }
    cancelWifiSetup(): void { this.wifiDialog?.close(); }

    async connect(): Promise<void> {
        if (["selecting", "connecting", "connected"].includes(this.state.phase)) return;
        const unavailable = this.availabilityMessage();
        if (unavailable) { this.publish("unavailable", "", unavailable); return; }
        const generation = ++this.generation;
        let selected: BLEDevice | undefined;
        let stage = "機器選択";
        const reportFailure = (name: string, message: string) => {
            console.error("[BLE] 接続失敗", { stage, name, message });
        };
        const check = () => {
            if (this.generation !== generation) {
                // A cancelled native connect can resolve after Clear or pagehide.
                if (selected !== this.device) selected?.gatt?.disconnect();
                throw new Error("接続を取り消しました。");
            }
        };
        this.publish("selecting");
        try {
            const bluetooth = (navigator as Navigator & { bluetooth: BLEAdapter }).bluetooth;
            // Called synchronously from the canvas button's pointerup user gesture.
            selected = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [BLE_UUID.service] });
            check();
            if (!selected.gatt) throw new Error("この機器はBLE接続に対応していません。");
            this.device = selected;
            selected.addEventListener("gattserverdisconnected", this.lost);
            this.publish("connecting", selected.name || "名前のない機器");
            // The chooser has no deadline; only GATT initialization is timed out.
            this.connectTimer = setTimeout(() => {
                if (this.generation === generation) {
                    reportFailure("TimeoutError", "接続がタイムアウトしました。");
                    this.close("error", `${stage}でタイムアウトしました。再接続してください。`);
                }
            }, 15_000);
            stage = "GATT接続";
            const server = await selected.gatt.connect();
            check();
            stage = "サービス取得";
            const service = await server.getPrimaryService(BLE_UUID.service);
            this.service = service;
            check();
            stage = "指令Characteristic取得";
            const tx = await service.getCharacteristic(BLE_UUID.command);
            check();
            stage = "状態Characteristic取得";
            const status = await service.getCharacteristic(BLE_UUID.status);
            check();
            stage = "IMU Characteristic取得";
            const rx = await service.getCharacteristic(BLE_UUID.telemetry);
            check();
            this.tx = tx; this.status = status; this.rx = rx;
            status.addEventListener("characteristicvaluechanged", this.statusChanged);
            rx.addEventListener("characteristicvaluechanged", this.sampleChanged);
            stage = "状態通知登録";
            await status.startNotifications();
            check();
            stage = "IMU通知登録";
            await rx.startNotifications();
            check();
            stage = "初期状態取得";
            const initialStatus = await status.readValue();
            check();
            if (initialStatus.byteLength !== 12 || initialStatus.getUint8(0) !== 1) throw new Error("状態データの形式が正しくありません。");
            this.hardwareStatus(initialStatus);
            stage = "INFO応答確認";
            await this.sendControl(6); // INFO ACK confirms application readiness, not motion completion.
            check();
            clearTimeout(this.connectTimer); this.connectTimer = undefined;
            this.publish("connected", selected.name || "名前のない機器");
            this.updateStream();
            this.startHeartbeat(generation);
        } catch (error) {
            if (this.generation !== generation) return;
            const name = error instanceof Error ? error.name : "";
            if (!selected && name === "NotFoundError") this.close("idle");
            else {
                const message = error instanceof Error ? error.message : "BLE接続に失敗しました。";
                reportFailure(name, message);
                this.close("error", `${stage}: ${name === "NotFoundError" ? "このデモに対応した機器ではありません。" : message}`);
            }
        }
    }

    private startHeartbeat(generation: number): void {
        clearInterval(this.heartbeat);
        this.heartbeat = setInterval(() => {
            void this.sendControl(5).catch(error => {
                if (this.generation === generation) this.close("error", error instanceof Error ? error.message : "機器の応答がありません。");
            });
        }, 1500);
    }

    async openWifi(): Promise<void> {
        if (this.wifiDialog || ["selecting", "connecting"].includes(this.state.phase) || this.wifi?.connected) return;
        if (!this.service || !this.device?.gatt?.connected) {
            this.state = { ...this.state, message: "先に「接続」でESP32へBLE接続してから、Wi-Fi設定を開いてください。" }; this.notify();
            return;
        }
        const generation = this.generation;
        try {
            this.provisioning = true; clearInterval(this.heartbeat);
            await this.stopServos();
            await this.sendControl(4, 0); this.requestedRate = 0;
            const tx = await this.service.getCharacteristic(BLE_UUID.wifiConfig);
            const rx = await this.service.getCharacteristic(BLE_UUID.wifiResult);
            if (generation !== this.generation) return;
            const setup = new BLEWifiSetup(tx as BLECharacteristic & { readValue(): Promise<DataView> }, rx as BLECharacteristic & { readValue(): Promise<DataView> });
            const dialog = this.wifiDialog = new RobotWifiDialog(
                (target, signal) => this.connectWifi(target, signal),
                () => {
                    if (this.wifiDialog === dialog) this.wifiDialog = undefined;
                    this.provisioning = false;
                    if (!this.closing && this.device?.gatt?.connected && this.state.phase === "connected") { this.updateStream(); this.startHeartbeat(this.generation); }
                }, setup);
            dialog.open();
        } catch {
            this.provisioning = false;
            if (this.device?.gatt?.connected && this.state.phase === "connected") { this.updateStream(); this.startHeartbeat(this.generation); }
            if (generation === this.generation) { this.state = { ...this.state, message: "Wi-Fi設定を開けません。対応するファームウェアとBLE接続を確認してください。" }; this.notify(); }
        }
    }

    private async connectWifi(target: RobotEndpoint, signal: AbortSignal): Promise<void> {
        const oldGeneration = this.generation, wifi = new RobotWifi();
        const originalMessage = this.state.message;
        this.state = { ...this.state, message: "Wi-Fi接続を確認しています…" }; this.notify();
        try {
            const actual = await wifi.connect(target, signal);
            signal.throwIfAborted();
            if (this.generation !== oldGeneration) throw new Error("接続を取り消しました。");
            // Remove native disconnection listener before the deliberate BLE handover.
            clearInterval(this.heartbeat); this.resetServos();
            this.device?.removeEventListener("gattserverdisconnected", this.lost);
            this.status?.removeEventListener("characteristicvaluechanged", this.statusChanged);
            this.rx?.removeEventListener("characteristicvaluechanged", this.sampleChanged);
            this.device?.gatt?.disconnect(); this.device = this.tx = this.status = this.rx = undefined; this.service = undefined;
            this.wifi = wifi; const generation = ++this.generation;
            this.requestedRate = 0;
            for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("Wi-Fiへ切り替えました。")); }
            this.pending.clear();
            wifi.onPacket = data => {
                if (this.generation !== generation) return;
                if (data.byteLength === 12) this.statusChanged({ target: { value: data } } as unknown as Event);
                else this.sampleChanged({ target: { value: data } } as unknown as Event);
            };
            wifi.onLost = message => { if (this.generation === generation) this.close("error", message); };
            this.state = { phase: "connecting", deviceName: actual.name, transport: "wifi", message: "", pcaAvailable: false, imuAvailable: false, streaming: false };
            await this.sendControl(6); signal.throwIfAborted();
            if (generation !== this.generation) throw new Error("接続を取り消しました。");
            this.publish("connected", actual.name);
            this.provisioning = false;
            if (actual.camera) setCameraProvider(cameraSignal => wifi.image(cameraSignal));
            this.updateStream(); this.startHeartbeat(generation);
        } catch (error) {
            wifi.close();
            if (this.wifi === wifi) this.close("error", "Wi-Fiの制御接続を確認できません。再接続してください。");
            else { this.state = { ...this.state, message: originalMessage }; this.notify(); }
            throw error;
        }
    }

    private sendControl(opcode: BLEOpcode, value = 0, channel = 255, duration = 0,
        isCurrent = () => true, accepted = () => {}): Promise<void> {
        const generation = this.generation;
        const task = this.tail.catch(() => {}).then(async () => {
            if (generation !== this.generation || (!this.wifi?.connected && (!this.tx || !this.device?.gatt?.connected))) throw new Error("機器の接続が切れました。");
            if (!isCurrent()) throw new Error("サーボ操作を取り消しました。");
            const sequence = this.sequence = this.sequence % 65535 + 1;
            const bytes = new Uint8Array(10);
            const packet = new DataView(bytes.buffer);
            bytes[0] = 1; bytes[1] = opcode; bytes[4] = channel;
            packet.setUint16(2, sequence, true);
            if (opcode === 9) {
                packet.setInt16(6, value, true);
            }
            else {
                packet.setUint16(6, value, true);
            }
            packet.setUint16(8, duration, true);
            const operation = servoOperations[opcode];
            const details = { operation, sequence, channel, value, duration };
            const ack = new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.pending.delete(sequence);
                    reject(new Error("ESP32の応答がありません。再接続してください。"));
                    if (generation === this.generation) this.close("error", "ESP32の応答がありません。再接続してください。");
                }, 2500);
                this.pending.set(sequence, { resolve, reject, timer });
            });
            void ack.catch(() => {});
            if (operation) console.log("BLE servo send", details);
            const write = (this.wifi?.connected ? this.wifi.write(bytes) : this.tx!.writeValueWithResponse(bytes)).catch(error => {
                const pending = this.pending.get(sequence);
                if (pending) { clearTimeout(pending.timer); this.pending.delete(sequence); pending.reject(error as Error); }
                throw error;
            });
            // A missing ACK must unblock the queue even if the native write hangs.
            try { await Promise.all([write, ack]); }
            catch (error) {
                if (operation) console.error("BLE servo error", details, error);
                throw error;
            }
            if (operation) console.log("BLE servo ACK", details);
            if (generation !== this.generation || !isCurrent()) throw new Error("サーボ操作を取り消しました。");
            accepted();
        });
        this.tail = task;
        return task;
    }
}

export const diagramBLE = new BLEConnection();

export function initBLE(signal: AbortSignal): void {
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) diagramBLE.disconnect();
    }, { signal });
    window.addEventListener("pagehide", () => diagramBLE.disconnect(), { signal });
}

export class BLEConnectionBlock extends FunctionBlock {
    readonly button: Button;
    readonly wifiButton: Button;
    private unsubscribe?: () => void;
    private removed = false;

    constructor(data: Attr) {
        super(data);
        this.button = new Button({ text: "接続", click: () => {
            if (this.removed || this.inToolbox) return;
            if (diagramBLE.state.phase === "connected") diagramBLE.disconnect();
            else return diagramBLE.connect();
        } });
        this.wifiButton = new Button({ text: "Wi-Fi設定／接続", click: () => {
            if (!this.removed && !this.inToolbox) return diagramBLE.openWifi();
        } });
        if (!this.inToolbox) this.unsubscribe = diagramBLE.subscribe(() => {
            this.updateButton();
            theCanvas?.requestUpdateCanvas();
        });
        this.setBoxSize();
        this.updateButton();
    }

    children(): UI[] { return [this.button, this.wifiButton]; }
    setBoxSize(): void { this.boxSize = new Vec2(280, this.inToolbox ? 60 : 246); }

    copy(): BLEConnectionBlock {
        const block = new BLEConnectionBlock({});
        this.copyUI(block);
        block.setBoxSize();
        block.setPosition(this.position.copy());
        return block;
    }

    setPosition(position: Vec2): void {
        super.setPosition(position);
        this.positionButton();
    }

    setPortPositions(): void {
        super.setPortPositions();
        this.positionButton();
    }

    private positionButton(): void {
        this.button.setPosition(this.position.add(new Vec2(16, 126)));
        this.button.boxSize = new Vec2(248, 48);
        this.wifiButton.setPosition(this.position.add(new Vec2(16, 182)));
        this.wifiButton.boxSize = new Vec2(248, 48);
    }

    private updateButton(): void {
        const phase = diagramBLE.state.phase;
        this.button.text = phase === "connected" ? "切断" : phase === "error" ? "再接続" : "接続";
        this.button.disabled = this.removed || this.inToolbox || (diagramBLE.state.transport !== "wifi" && !!diagramBLE.availabilityMessage()) || phase === "selecting" || phase === "connecting";
        this.wifiButton.disabled = this.removed || this.inToolbox || !window.isSecureContext || phase === "selecting" || phase === "connecting" || diagramBLE.state.transport === "wifi";
    }

    draw(): void {
        super.draw();
        const ctx = this.ctx;
        ctx.save();
        ctx.font = "18px sans-serif";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#17384f";
        ctx.fillText(diagramBLE.state.transport === "wifi" ? "Wi-Fi接続" : "BLE接続", this.position.x + 16, this.position.y + 16);
        if (!this.inToolbox) {
            const state = diagramBLE.state;
            const unavailable = state.transport === "wifi" ? "" : diagramBLE.availabilityMessage();
            const phase = unavailable ? "unavailable" : state.phase;
            const labels: Record<BLEPhase, string> = {
                idle: "未接続", selecting: "機器を選択してください", connecting: "接続中", connected: "接続済み", error: "接続失敗", unavailable: "利用不可",
            };
            ctx.fillStyle = phase === "connected" ? "#176b3a" : phase === "error" || phase === "unavailable" ? "#a32121" : "#555555";
            ctx.fillText(`状態：${labels[phase]}`, this.position.x + 16, this.position.y + 46, 248);
            ctx.fillStyle = "#17384f";
            ctx.fillText(`端末：${state.deviceName || "—"}`, this.position.x + 16, this.position.y + 72, 248);
            ctx.font = "14px sans-serif";
            const message = unavailable || state.message;
            // Two readable lines; never compress a long error into a tiny font.
            const chars = [...message];
            let line = "", y = this.position.y + 98;
            for (const char of chars) {
                if (ctx.measureText(line + char).width > 248) {
                    ctx.fillText(line, this.position.x + 16, y);
                    line = ""; y += 16;
                    if (y > this.position.y + 114) break;
                }
                line += char;
            }
            if (line) ctx.fillText(line, this.position.x + 16, y);
            this.positionButton();
            this.updateButton();
            this.button.draw();
            this.wifiButton.draw();
        }
        ctx.restore();
    }

    clearBlock(): void {
        this.removed = true;
        diagramBLE.cancelWifiSetup();
        this.button.disabled = true;
        this.button.pressed = false;
        this.wifiButton.disabled = true; this.wifiButton.pressed = false;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        super.clearBlock();
    }
}

registerFunctionBlock(BLEConnectionBlock.name, () => new BLEConnectionBlock({}));
