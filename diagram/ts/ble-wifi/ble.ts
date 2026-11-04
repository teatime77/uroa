import { Vec2 } from "@i18n";
import { DeviceType, FunctionBlock, registerFunctionBlock } from "../block";
import { Button, type Attr, type UI } from "../ui";
import { theCanvas } from "../diagram_util";
import { BLEWifiSetup, RobotWifi, type RobotEndpoint } from "./robot-wifi";
import { RobotWifiDialog } from "./robot-wifi-dialog";
import { setCameraProvider } from "../camera/camera-feed";
import { theEditor } from "../json-util";
import { DeviceInfoMaxLength, parseDeviceTelemetry } from "./device-telemetry";
import { bytecodeTransfer, checkBytecodeTransfer, uploadBytecode, type BytecodeReceipt } from "./bytecode-transfer";
import { parsePython } from "../python/parser.js";
import { analyzePython } from "../python/semantic.js";
import { generateBytecode } from "../python/bytecode.js";

const DeviceInfoWriteTimeoutMs = 2500;

// GATT service shared with esp32/app/diagram-control.
/**
 * @remarks
 * ## GATT
 *
 * Serviceは`f3641400-00b0-4240-ba50-05ca45bf8abc`。UUIDの残り部分はServiceと同じ。
 *
 * | Characteristic | UUID先頭 | Properties | サイズ |
 * |---|---|---|---|
 * | Bytecode | f3641407 | Write with response | 10〜20 bytes |
 * | Bytecode Result | f3641408 | Read | 20 bytes |
 *
 * Command・Status・Telemetry・DeviceInfoとは別の窓口。既定ATT MTU=23で扱える20バイト以内とし、Writeは必ずresponse付きにする。ただしGATTの受付だけではプログラムの受信完了とせず、各Writeの後に専用ResultをReadして、ESP32のloop()による受付結果を確認する。
 */
export const BLE_UUID = {
    service: "f3641400-00b0-4240-ba50-05ca45bf8abc",
    command: "f3641401-00b0-4240-ba50-05ca45bf8abc",
    telemetry: "f3641402-00b0-4240-ba50-05ca45bf8abc",
    status: "f3641403-00b0-4240-ba50-05ca45bf8abc",
    wifiConfig: "f3641404-00b0-4240-ba50-05ca45bf8abc",
    wifiResult: "f3641405-00b0-4240-ba50-05ca45bf8abc",
    deviceInfo: "f3641406-00b0-4240-ba50-05ca45bf8abc",
    bytecode: "f3641407-00b0-4240-ba50-05ca45bf8abc",
    bytecodeResult: "f3641408-00b0-4240-ba50-05ca45bf8abc",
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
const errors = ["成功", "指令形式が不正（速度制御には対応ファームウェアが必要です）", "範囲外の指令", "サーボが無効／応答タイムアウト", "デバイスが見つかりません", "指令が混雑しています", "I²C通信エラー", "角度／速度モードが異なります。無効化してから有効化してください。"];
/** diagram-controlと共通の指令番号。 */
enum BLEOpcode {
    ARM = 1,
    MOVE = 2,
    STOP = 3,
    STREAM = 4,
    PING = 5,
    INFO = 6,
    DISABLE = 7,
    ARM_SPEED = 8,
    SET_SPEED = 9,
}

/** version 1のCommandパケットのサイズと各フィールドの位置。 */
const BLE_COMMAND = {
    byteLength: 10,
    version: 1,
    allChannels: 255,
    maxSequence: 65535,
    offset: {
        version: 0,
        opcode: 1,
        sequence: 2,
        channel: 4,
        value: 6,
        duration: 8,
    },
} as const;

export type ServoMode = "angle" | "speed";
const servoOperations: Partial<Record<BLEOpcode, string>> = {
    [BLEOpcode.ARM]: "ARM",
    [BLEOpcode.MOVE]: "MOVE",
    [BLEOpcode.STOP]: "STOP",
    [BLEOpcode.DISABLE]: "DISABLE",
    [BLEOpcode.ARM_SPEED]: "ARM_SPEED",
    [BLEOpcode.SET_SPEED]: "SET_SPEED",
};

/** One connection per diagram document. Blocks subscribe; GATT objects are never saved. */
export class BLEConnection {
    state: BLEConnectionState = { phase: "idle", deviceName: "", message: "", pcaAvailable: false, imuAvailable: false, streaming: false };
    private listeners = new Set<(state: BLEConnectionState) => void>();
    private sensorStreamUsers = new Set<FunctionBlock>();
    private requestedRate = 0;
    private device?: BLEDevice;
    private tx?: BLECharacteristic;
    private rx?: BLECharacteristic;
    private status?: BLECharacteristic;
    private deviceInfo?: BLECharacteristic;
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
    /** 更新はsendBytecode()だけが行う。別転送とWi-Fi設定の開始を抑止する。 */
    bytecodeSending = false;
    private bytecodeTransferId = 0;
    private sensors   : FunctionBlock[] = [];
    private actuators : FunctionBlock[] = [];

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
        await this.sendControl(mode === "speed" ? BLEOpcode.ARM_SPEED : BLEOpcode.ARM, mode === "speed" ? 0 : 9000, channel, 0,
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
        await this.sendControl(BLEOpcode.MOVE, Math.round(angle * 100), channel, duration,
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
        await this.sendControl(BLEOpcode.SET_SPEED, Math.round(percent * 100), channel, 0,
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
        try {
            await this.sendControl(BLEOpcode.DISABLE, 0, channel);
        }
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
        try {
            await this.sendControl(BLEOpcode.STOP);
        }
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

    /** 配置されたセンサーブロックの共有10Hz STREAM利用を登録し、解除関数を返す。 */
    retainSensorStream(sensor: FunctionBlock): () => void {
        this.sensorStreamUsers.add(sensor);
        this.updateStream();
        let released = false;
        return () => {
            if (released) {
                return;
            }
            released = true;
            this.sensorStreamUsers.delete(sensor);
            this.updateStream();
        };
    }

    /** 接続時に送ったDeviceInfoの受信先として登録されているか調べる。 */
    isSensorRegistered(sensor: FunctionBlock): boolean {
        return this.sensors.includes(sensor);
    }

    private updateStream(): void {
        if (this.state.phase !== "connected" || this.provisioning) return;
        const available = this.sensors.some(sensor => this.sensorStreamUsers.has(sensor) &&
            (sensor.deviceType === DeviceType.UltrasonicDistanceSensor ||
                (sensor.deviceType === DeviceType.IMU6Axis && this.state.imuAvailable)));
        const rate = available ? 10 : 0;
        if (rate === this.requestedRate) return;
        this.requestedRate = rate;
        const generation = this.generation;
        void this.sendControl(BLEOpcode.STREAM, rate).catch(error => {
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
        if (this.state.phase !== "connected" || !this.state.streaming || !this.requestedRate) {
            return;
        }
        try {
            const value = (event.target as BLECharacteristic).value;
            if (!value) {
                throw new Error("センサーデータがありません。");
            }
            const telemetry = parseDeviceTelemetry(value);
            const sensors = this.sensors;
            if (telemetry.records.length !== sensors.length) {
                throw new Error("機器別Telemetryと登録センサー数が一致しません。");
            }
            // 全レコードと登録順を検証してから、ブロックへ反映する。
            for (let index = 0; index < sensors.length; index++) {
                if (telemetry.records[index].deviceType !== sensors[index].deviceType) {
                    throw new Error("機器別Telemetryの種別と登録センサー順が一致しません。");
                }
            }
            for (let index = 0; index < sensors.length; index++) {
                sensors[index].readStatus(telemetry.time, value, telemetry.records[index].offset);
            }
        } catch (error) {
            this.close("error", error instanceof Error ? error.message : "センサーデータを受信できませんでした。");
            return;
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
        this.sensors = [];
        this.actuators = [];
        this.status?.removeEventListener("characteristicvaluechanged", this.statusChanged);
        this.rx?.removeEventListener("characteristicvaluechanged", this.sampleChanged);
        this.device?.removeEventListener("gattserverdisconnected", this.lost);
        const device = this.device;
        this.device = this.tx = this.rx = this.status = this.deviceInfo = undefined;
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
            stage = "センサーCharacteristic取得";
            const rx = await service.getCharacteristic(BLE_UUID.telemetry);
            check();
            stage = "機器情報Characteristic取得";
            const deviceInfo = await service.getCharacteristic(BLE_UUID.deviceInfo);
            check();
            this.tx = tx;
            this.status = status;
            this.rx = rx;
            this.deviceInfo = deviceInfo;
            status.addEventListener("characteristicvaluechanged", this.statusChanged);
            rx.addEventListener("characteristicvaluechanged", this.sampleChanged);
            stage = "状態通知登録";
            await status.startNotifications();
            check();
            stage = "センサー通知登録";
            await rx.startNotifications();
            check();
            stage = "初期状態取得";
            const initialStatus = await status.readValue();
            check();
            if (initialStatus.byteLength !== 12 || initialStatus.getUint8(0) !== 1) throw new Error("状態データの形式が正しくありません。");
            this.hardwareStatus(initialStatus);
            stage = "INFO応答確認";
            await this.sendControl(BLEOpcode.INFO); // INFO ACK confirms application readiness, not motion completion.
            check();
            stage = "機器情報登録";
            await this.sendDeviceInfo();
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
            void this.sendControl(BLEOpcode.PING).catch(error => {
                if (this.generation === generation) this.close("error", error instanceof Error ? error.message : "機器の応答がありません。");
            });
        }, 1500);
    }

    async openWifi(): Promise<void> {
        if (this.bytecodeSending) {
            return;
        }
        if (this.wifiDialog || ["selecting", "connecting"].includes(this.state.phase) || this.wifi?.connected) return;
        if (!this.service || !this.device?.gatt?.connected) {
            this.state = { ...this.state, message: "先に「接続」でESP32へBLE接続してから、Wi-Fi設定を開いてください。" }; this.notify();
            return;
        }
        const generation = this.generation;
        try {
            this.provisioning = true; clearInterval(this.heartbeat);
            await this.stopServos();
            await this.sendControl(BLEOpcode.STREAM, 0);
            this.requestedRate = 0;
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
            this.device?.gatt?.disconnect();
            this.device = this.tx = this.status = this.rx = this.deviceInfo = undefined;
            this.service = undefined;
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
            await this.sendControl(BLEOpcode.INFO);
            signal.throwIfAborted();
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

    private sendControl(opcode: BLEOpcode, value = 0, channel: number = BLE_COMMAND.allChannels, duration = 0,
        isCurrent = () => true, accepted = () => {}): Promise<void> {
        const generation = this.generation;
        const task = this.tail.catch(() => {}).then(async () => {
            if (generation !== this.generation || (!this.wifi?.connected && (!this.tx || !this.device?.gatt?.connected))) throw new Error("機器の接続が切れました。");
            if (!isCurrent()) throw new Error("サーボ操作を取り消しました。");
            const sequence = this.sequence = this.sequence % BLE_COMMAND.maxSequence + 1;
            const bytes = new Uint8Array(BLE_COMMAND.byteLength);
            const packet = new DataView(bytes.buffer);
            bytes[BLE_COMMAND.offset.version] = BLE_COMMAND.version;
            bytes[BLE_COMMAND.offset.opcode] = opcode;
            bytes[BLE_COMMAND.offset.channel] = channel;
            packet.setUint16(BLE_COMMAND.offset.sequence, sequence, true);
            if (opcode === BLEOpcode.SET_SPEED) {
                packet.setInt16(BLE_COMMAND.offset.value, value, true);
            }
            else {
                packet.setUint16(BLE_COMMAND.offset.value, value, true);
            }
            packet.setUint16(BLE_COMMAND.offset.duration, duration, true);
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

    /** 既存のGATTキューへ1操作を追加し、期限切れ・取消時は未完了の接続を閉じる。 */
    private bytecodeOperation<T>(operation: () => Promise<T>, check: () => void,
        generation: number, signal?: AbortSignal): Promise<T> {
        const task = this.tail.catch(() => {}).then(async () => {
            check();
            let timer: ReturnType<typeof setTimeout> | undefined;
            let abort: (() => void) | undefined;
            try {
                const timeout = new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error("バイトコード転送の応答がありません。再接続してください。")),
                        bytecodeTransfer.timeoutMs);
                    abort = () => reject(signal?.reason ?? new DOMException("転送を取り消しました。", "AbortError"));
                    signal?.addEventListener("abort", abort, { once: true });
                });
                const result = await Promise.race([operation(), timeout]);
                check();
                return result;
            }
            catch (error) {
                if (generation === this.generation) {
                    this.close("error", error instanceof Error ? error.message : "バイトコードを送信できませんでした。");
                }
                throw error;
            }
            finally {
                clearTimeout(timer);
                if (abort !== undefined) {
                    signal?.removeEventListener("abort", abort);
                }
            }
        });
        this.tail = task;
        return task;
    }

    /** バイナリ全体をBLEで分割転送し、ESP32の検証・RAM保持の完了を待つ。
     *
     * @remarks
     * ```typescript
     * import { diagramBLE } from "./ble-wifi/ble.js";
     * import { parsePython } from "./python/parser.js";
     * import { analyzePython } from "./python/semantic.js";
     * import { generateBytecode } from "./python/bytecode.js";
     *
     * const module = parsePython(source);
     * const analysis = await analyzePython(module, signal);
     * const bytes = generateBytecode(module, analysis);
     * const receipt = await diagramBLE.sendBytecode(bytes, signal);
     * // receipt.byteLengthとreceipt.crc32はESP32が保持完了を返した内容。
     * ```
     *
     * BLE接続済みでWi-Fi設定・切替中でない場合に利用できる。送信元の配列は最初にコピーし、呼出元の後続変更を転送へ反映させない。同時に複数の転送は行わない。切断・ページ離脱・非表示・ブロック削除では未完了転送を取り消す。APIのAbortSignalでも取り消せる。処理中のネイティブGATT操作は取消できないため、取消・応答期限超過・送受信エラーでは接続を閉じる。
     *
     * 旧ファームウェアとの通常接続は維持する。バイトコードの専用Characteristicは送信時に取得し、未対応なら送信エラーにする。Wi-Fi経由の転送は実装していない。
     */
    async sendBytecode(bytes: Uint8Array, signal?: AbortSignal): Promise<BytecodeReceipt> {
        if (this.bytecodeSending) {
            throw new Error("バイトコードを送信中です。");
        }
        checkBytecodeTransfer(bytes);
        const payload = bytes.slice();
        const generation = this.generation;
        const service = this.service;
        const check = () => {
            signal?.throwIfAborted();
            if (generation !== this.generation || service !== this.service || !service
                || this.state.phase !== "connected" || !this.device?.gatt?.connected
                || this.wifi?.connected || this.provisioning) {
                throw new Error("バイトコード送信には現在のESP32へのBLE接続が必要です。");
            }
        };
        check();
        this.bytecodeSending = true;
        this.state = { ...this.state, message: "バイトコードを送信しています…" };
        this.notify();
        try {
            const run = <T>(operation: () => Promise<T>) => this.bytecodeOperation(operation, check, generation, signal);
            const write = await run(() => service!.getCharacteristic(BLE_UUID.bytecode));
            const result = await run(() => service!.getCharacteristic(BLE_UUID.bytecodeResult));
            this.bytecodeTransferId = this.bytecodeTransferId % 65535 + 1;
            const receipt = await uploadBytecode(payload, this.bytecodeTransferId, write, result, run, check);
            check();
            this.state = { ...this.state, message: `${receipt.byteLength}バイトをESP32で受信しました。` };
            return receipt;
        }
        catch (error) {
            if (generation === this.generation) {
                this.close("error", error instanceof Error ? error.message : "バイトコード送信に失敗しました。");
            }
            throw error;
        }
        finally {
            this.bytecodeSending = false;
            this.notify();
        }
    }

    /** センサー、アクチュエータの順に機器情報を1回のBLE書き込みで送る。 */
    private async sendDeviceInfo(): Promise<void> {
        const sensors = theEditor.blocks.filter(x => x instanceof FunctionBlock && x.isSensor()) as FunctionBlock[];
        const actuators = theEditor.blocks.filter(x => x instanceof FunctionBlock && x.isActuator() && !sensors.includes(x)) as FunctionBlock[];
        const devices = sensors.concat(actuators);
        const bytes = new Uint8Array(DeviceInfoMaxLength);
        let offset = 0;
        for (const device of devices) {
            const nextOffset = device.writeDeviceInfo(bytes, offset);
            if (!Number.isInteger(nextOffset) || nextOffset <= offset || nextOffset > bytes.byteLength) {
                throw new Error(`機器情報の形式が不正か、上限の${DeviceInfoMaxLength}バイトを超えています。`);
            }
            offset = nextOffset;
        }
        // 種別0は6軸IMUなので、未使用領域を0で埋めたまま送らない。
        const payload = bytes.slice(0, offset);
        const characteristic = this.deviceInfo;
        const generation = this.generation;
        const task = this.tail.catch(() => {}).then(async () => {
            if (generation !== this.generation || characteristic !== this.deviceInfo || !characteristic ||
                !this.device?.gatt?.connected || this.wifi?.connected) {
                throw new Error("機器情報の送信には現在のESP32へのBLE接続が必要です。");
            }
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                const timeout = new Promise<never>((_, reject) => {
                    timer = setTimeout(() => {
                        reject(new Error("機器情報のBLE書き込みがタイムアウトしました。"));
                    }, DeviceInfoWriteTimeoutMs);
                });
                await Promise.race([characteristic.writeValueWithResponse(payload), timeout]);
            }
            catch (error) {
                if (generation === this.generation) {
                    this.close("error", error instanceof Error ? error.message : "機器情報を送信できませんでした。");
                }
                throw error;
            }
            finally {
                clearTimeout(timer);
            }
            if (generation !== this.generation || characteristic !== this.deviceInfo) {
                throw new Error("機器情報の送信を取り消しました。");
            }
            this.sensors = sensors;
            this.actuators = actuators;
        });
        this.tail = task;
        await task;
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
    readonly bytecodeButton: Button;
    private bytecodeAbort?: AbortController;
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
        this.bytecodeButton = new Button({ text: "a.pyを送信", click: () => this.sendPythonFile() });
        if (!this.inToolbox) this.unsubscribe = diagramBLE.subscribe(() => {
            if (diagramBLE.state.phase !== "connected" || diagramBLE.state.transport === "wifi") {
                this.bytecodeAbort?.abort();
            }
            this.updateButton();
            theCanvas?.requestUpdateCanvas();
        });
        this.setBoxSize();
        this.updateButton();
    }

    children(): UI[] { return [this.button, this.wifiButton, this.bytecodeButton]; }
    setBoxSize(): void { this.boxSize = new Vec2(280, this.inToolbox ? 60 : 302); }

    /** 開発用Pythonファイルを生成器へ渡し、現在のBLE接続へ手動送信する。
     *
     * @remarks
     * ## 操作とAPI
     *
     * ESP32へ対応ファームウェアを書き込み、diagramのBLE接続ブロックから接続する。「a.pyを送信」を押すと`/diagram/python/a.py`を読み、構文解析、semantic.tsによるdevice-api.jsonの読込み・名前解決・型推論、その結果を使うversion=3のバイナリ生成、BLE転送を行う。意味解析の仕様はsemantic.ts先頭を参照する。既存の接続ブロックにはボタン1個分の高さを追加した。送信時にファイルを読み直し、再接続で自動送信しない。a.pyは現在Git管理外の開発用素材で、配信先にも別途配置する必要がある。
     *
     * バイナリ化とBLE送受信まで実装し、構造体・ネイティブ呼出し・f文字列を含むversion=3をESP32で形式検証してRAMへ保持する。受信の共通仕様とVM・ABI照合の境界はbytecode-transfer.ts先頭を参照する。現行VMはversion=1のみ対応し、version=2・3の開始は形式エラーになる。新形式のVM実行と専用Pythonブロックの画面への組込みは後続の範囲とする。
     */
    private async sendPythonFile(): Promise<void> {
        if (this.removed || this.inToolbox || this.bytecodeAbort !== undefined || diagramBLE.bytecodeSending) {
            return;
        }
        const controller = new AbortController();
        this.bytecodeAbort = controller;
        this.updateButton();
        theCanvas?.requestUpdateCanvas();
        try {
            const response = await fetch("/diagram/python/a.py", { signal: controller.signal, cache: "no-store" });
            if (!response.ok) {
                throw new Error(`a.pyを読み込めません: HTTP ${response.status}`);
            }
            const source = await response.text();
            controller.signal.throwIfAborted();
            const module = parsePython(source);
            const analysis = await analyzePython(module, controller.signal);
            await diagramBLE.sendBytecode(generateBytecode(module, analysis), controller.signal);
        }
        catch (error) {
            if (!controller.signal.aborted && !this.removed) {
                diagramBLE.state = { ...diagramBLE.state,
                    message: error instanceof Error ? error.message : "Pythonを送信できませんでした。" };
            }
        }
        finally {
            this.bytecodeAbort = undefined;
            this.updateButton();
            theCanvas?.requestUpdateCanvas();
        }
    }

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
        this.bytecodeButton.setPosition(this.position.add(new Vec2(16, 238)));
        this.bytecodeButton.boxSize = new Vec2(248, 48);
    }

    private updateButton(): void {
        const phase = diagramBLE.state.phase;
        this.button.text = phase === "connected" ? "切断" : phase === "error" ? "再接続" : "接続";
        this.button.disabled = this.removed || this.inToolbox || (diagramBLE.state.transport !== "wifi" && !!diagramBLE.availabilityMessage()) || phase === "selecting" || phase === "connecting";
        this.wifiButton.disabled = this.removed || this.inToolbox || !window.isSecureContext || phase === "selecting" || phase === "connecting" || diagramBLE.state.transport === "wifi";
        this.wifiButton.disabled ||= diagramBLE.bytecodeSending || this.bytecodeAbort !== undefined;
        this.bytecodeButton.text = this.bytecodeAbort !== undefined || diagramBLE.bytecodeSending ? "送信中…" : "a.pyを送信";
        this.bytecodeButton.disabled = this.removed || this.inToolbox || phase !== "connected"
            || diagramBLE.state.transport === "wifi" || this.bytecodeAbort !== undefined || diagramBLE.bytecodeSending;
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
            this.bytecodeButton.draw();
        }
        ctx.restore();
    }

    clearBlock(): void {
        this.removed = true;
        this.bytecodeAbort?.abort();
        diagramBLE.cancelWifiSetup();
        this.button.disabled = true;
        this.button.pressed = false;
        this.wifiButton.disabled = true; this.wifiButton.pressed = false;
        this.bytecodeButton.disabled = true;
        this.bytecodeButton.pressed = false;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        super.clearBlock();
    }
}

registerFunctionBlock(BLEConnectionBlock.name, () => new BLEConnectionBlock({}));
