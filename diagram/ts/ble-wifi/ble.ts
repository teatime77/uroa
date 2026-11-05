import { Vec2 } from "@i18n";
import { DeviceType, FunctionBlock, registerFunctionBlock } from "../block";
import { Button, type Attr, type UI } from "../ui";
import { theCanvas } from "../diagram_util";
import { BLEWifiSetup, RobotWifi, type RobotEndpoint } from "./robot-wifi";
import { RobotWifiDialog } from "./robot-wifi-dialog";
import { setCameraProvider } from "../camera/camera-feed";
import { theEditor } from "../json-util";
import { DeviceInfoMaxLength, type DeviceTelemetry } from "./device-telemetry";
import { ControlConnection, ControlOpcode, ControlCommand } from "./control-connection";
import { BLEControlTransport, type ControlCharacteristic } from "./ble-control-transport";
import { checkBytecodeTransfer, type BytecodeReceipt } from "./bytecode-transfer";
import { parsePython } from "../python/parser.js";
import { analyzePython } from "../python/semantic.js";
import { generateBytecode } from "../python/bytecode.js";
import { PythonDebugTransport, type DebugSnapshot } from "./debug-protocol";

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
 * | Debug Control / Result / Event / Data | f3641409 / 140a / 140b / 140c | Write / Read / Read+Notify / Read | 最大20 bytes |
 *
 * Command・Status・Telemetry・DeviceInfoとは別の窓口。既定ATT MTU=23で扱える20バイト以内とし、Writeは必ずresponse付きにする。ただしGATTの受付だけではプログラムの受信完了とせず、各Writeの後に専用ResultをReadして、ESP32のloop()による受付結果を確認する。
 * デバッグ通信の完全な形式・停止値・一覧確定の仕様はdebug-protocol.tsを参照する。
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
    debugControl: "f3641409-00b0-4240-ba50-05ca45bf8abc",
    debugResult: "f364140a-00b0-4240-ba50-05ca45bf8abc",
    debugEvent: "f364140b-00b0-4240-ba50-05ca45bf8abc",
    debugData: "f364140c-00b0-4240-ba50-05ca45bf8abc",
} as const;

// Structural types keep this browser-only module independent of the robot build.
type BLECharacteristic = ControlCharacteristic;
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
export type ServoMode = "angle" | "speed";

/**
 * 図の接続UI・機器登録・機器状態・BLE専用転送の窓口。GATT参照は保存しない。
 * 通常指令・ACK・通知検証・PING・共通待ち列はcontrol-connection.tsへ委譲する。
 * BLE/Wi-Fiの切替とブロックへの反映を担当する。デバッグ通信は引き続きBLE専用。
 */
export class BLEConnection {
    state: BLEConnectionState = { phase: "idle", deviceName: "", message: "", pcaAvailable: false, imuAvailable: false, streaming: false };
    private listeners = new Set<(state: BLEConnectionState) => void>();
    private sensorStreamUsers = new Set<FunctionBlock>();
    private requestedRate = 0;
    private device?: BLEDevice;
    private generation = 0;
    private connectTimer?: ReturnType<typeof setTimeout>;
    private armedChannels = new Map<number, ServoMode>();
    private servoVersions = Array<number>(16).fill(0);
    private service?: BLEService;
    private wifi?: RobotWifi;
    private wifiDialog?: RobotWifiDialog;
    private provisioning = false;
    private closing = false;
    private control = new ControlConnection({
        status: data => this.hardwareStatus(data),
        telemetry: (data, telemetry) => this.sampleChanged(data, telemetry),
        failed: error => this.close("error", error.message),
    });
    /** 更新はsendBytecode()だけが行う。別転送とWi-Fi設定の開始を抑止する。 */
    bytecodeSending = false;
    /** 現接続で最後に保持完了した転送。同一オブジェクトの間だけ再送を省略できる。切替で失効する。 */
    bytecodeReceipt?: BytecodeReceipt;
    private debugger?: PythonDebugTransport;
    private debuggerSending = false;
    private debugRequestId = 0;
    private debugListeners = new Set<(snapshot?: DebugSnapshot, error?: Error) => void>();
    /** 最新の検証済み停止値。更新はデバッグ受信とStart/Stop/切断だけが行い、呼出元は参照する。 */
    debugSnapshot?: DebugSnapshot;
    debugError?: Error;
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
        await this.sendControl(mode === "speed" ? ControlOpcode.ARM_SPEED : ControlOpcode.ARM, mode === "speed" ? 0 : 9000, channel, 0,
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
        await this.sendControl(ControlOpcode.MOVE, Math.round(angle * 100), channel, duration,
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
        await this.sendControl(ControlOpcode.SET_SPEED, Math.round(percent * 100), channel, 0,
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
            await this.sendControl(ControlOpcode.DISABLE, 0, channel);
        }
        catch (error) {
            if (generation === this.generation) this.close("error", "サーボの停止を確認できません。再接続してください。");
            throw error;
        }
    }

    async stopServos(): Promise<void> {
        this.debugger?.invalidateSnapshot();
        this.resetServos();
        this.notify();
        if (this.state.phase !== "connected") return;
        const generation = this.generation;
        try {
            await this.sendControl(ControlOpcode.STOP);
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
        void this.sendControl(ControlOpcode.STREAM, rate).catch(error => {
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

    /** 共通層で検証した通知を、登録センサーの全件・順序を照合してから反映する。 */
    private sampleChanged(value: DataView, telemetry: DeviceTelemetry): void {
        if (this.state.phase !== "connected" || !this.state.streaming || !this.requestedRate) {
            return;
        }
        const sensors = this.sensors;
        if (telemetry.records.length !== sensors.length) {
            throw new Error("機器別Telemetryと登録センサー数が一致しません。");
        }
        for (let index = 0; index < sensors.length; index++) {
            if (telemetry.records[index].deviceType !== sensors[index].deviceType) {
                throw new Error("機器別Telemetryの種別と登録センサー順が一致しません。");
            }
        }
        for (let index = 0; index < sensors.length; index++) {
            sensors[index].readStatus(telemetry.time, value, telemetry.records[index].offset);
        }
    }

    private lost = (): void => {
        if (this.wifi?.connected) return;
        this.close("idle", "BLE接続が切れました。");
    };
    private close(phase: BLEPhase, message = ""): void {
        this.closing = true;
        this.resetDebugger();
        this.debugRequestId = 0;
        this.bytecodeReceipt = undefined;
        this.generation++;
        this.control.close();
        this.wifiDialog?.close(); this.wifiDialog = undefined;
        this.provisioning = false;
        this.wifi?.close(); this.wifi = undefined; this.service = undefined;
        setCameraProvider();
        this.state.transport = "ble";
        this.resetServos();
        clearTimeout(this.connectTimer);
        this.connectTimer = undefined;
        this.requestedRate = 0;
        this.sensors = [];
        this.actuators = [];
        this.device?.removeEventListener("gattserverdisconnected", this.lost);
        const device = this.device;
        this.device = undefined;
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
            this.control.bind(new BLEControlTransport(tx, status, rx, deviceInfo, () =>
                this.generation === generation && !!selected?.gatt?.connected, async () => {
                    check();
                    const write = await service.getCharacteristic(BLE_UUID.bytecode);
                    check();
                    const result = await service.getCharacteristic(BLE_UUID.bytecodeResult);
                    check();
                    return {
                        write: bytes => write.writeValueWithResponse(bytes),
                        readResult: () => result.readValue(),
                    };
                }));
            stage = "状態通知登録";
            await status.startNotifications();
            check();
            stage = "センサー通知登録";
            await rx.startNotifications();
            check();
            stage = "初期状態取得";
            const initialStatus = await status.readValue();
            check();
            this.control.receive(initialStatus, "status");
            check();
            stage = "INFO応答確認";
            await this.sendControl(ControlOpcode.INFO); // INFO ACK confirms application readiness, not motion completion.
            check();
            stage = "機器情報登録";
            await this.sendDeviceInfo();
            check();
            clearTimeout(this.connectTimer); this.connectTimer = undefined;
            this.publish("connected", selected.name || "名前のない機器");
            this.updateStream();
            this.control.startHeartbeat();
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

    async openWifi(): Promise<void> {
        if (this.bytecodeSending || this.debuggerSending) {
            return;
        }
        if (this.wifiDialog || ["selecting", "connecting"].includes(this.state.phase) || this.wifi?.connected) return;
        if (!this.service || !this.device?.gatt?.connected) {
            this.state = { ...this.state, message: "先に「接続」でESP32へBLE接続してから、Wi-Fi設定を開いてください。" }; this.notify();
            return;
        }
        const generation = this.generation;
        try {
            this.resetDebugger();
            this.provisioning = true;
            this.control.stopHeartbeat();
            await this.stopServos();
            await this.sendControl(ControlOpcode.STREAM, 0);
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
                    if (!this.closing && this.device?.gatt?.connected && this.state.phase === "connected") {
                        this.updateStream();
                        this.control.startHeartbeat();
                    }
                }, setup);
            dialog.open();
        } catch {
            this.provisioning = false;
            if (this.device?.gatt?.connected && this.state.phase === "connected") {
                this.updateStream();
                this.control.startHeartbeat();
            }
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
            this.control.stopHeartbeat();
            this.resetServos();
            this.device?.removeEventListener("gattserverdisconnected", this.lost);
            this.device?.gatt?.disconnect();
            this.device = undefined;
            this.service = undefined;
            this.wifi = wifi;
            const generation = ++this.generation;
            this.bytecodeReceipt = undefined;
            this.requestedRate = 0;
            this.control.bind(wifi);
            wifi.onLost = message => { if (this.generation === generation) this.close("error", message); };
            this.state = { phase: "connecting", deviceName: actual.name, transport: "wifi", message: "", pcaAvailable: false, imuAvailable: false, streaming: false };
            await this.sendControl(ControlOpcode.INFO);
            signal.throwIfAborted();
            if (generation !== this.generation) throw new Error("接続を取り消しました。");
            // Wi-Fiでも現在の図を登録し、BLE接続時点の一覧だけに依存しない。
            await this.sendDeviceInfo();
            signal.throwIfAborted();
            if (generation !== this.generation) {
                throw new Error("接続を取り消しました。");
            }
            this.publish("connected", actual.name);
            this.provisioning = false;
            if (actual.camera) setCameraProvider(cameraSignal => wifi.image(cameraSignal));
            this.updateStream();
            this.control.startHeartbeat();
        } catch (error) {
            wifi.close();
            if (this.wifi === wifi) this.close("error", "Wi-Fiの制御接続を確認できません。再接続してください。");
            else { this.state = { ...this.state, message: originalMessage }; this.notify(); }
            throw error;
        }
    }

    /** 通常指令は通信経路を選別せず、ACK照合と共通待ち列を持つ層へ渡す。 */
    private sendControl(opcode: ControlOpcode, value = 0, channel: number = ControlCommand.allChannels, duration = 0,
        isCurrent = () => true, accepted?: () => void): Promise<void> {
        return this.control.send(opcode, value, channel, duration, isCurrent, accepted);
    }

    /** バイナリ全体を現在のBLE／Wi-Fiで分割転送し、ESP32の検証・RAM保持の完了を待つ。
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
     * 接続済みでWi-Fi設定・切替中でない場合に利用できる。送信元はコピーし、同時に複数の転送は行わない。
     * 切断・ページ離脱・非表示・ブロック削除・APIのAbortSignalで取り消す。期限超過・取消・送受信エラーでは接続を閉じる。
     *
     * BLEの専用Characteristicは送信時に取得する。両経路の形式・Result照合・制約はbytecode-transfer.tsを参照する。
     */
    async sendBytecode(bytes: Uint8Array, signal?: AbortSignal): Promise<BytecodeReceipt> {
        if (this.bytecodeSending || this.debuggerSending) {
            throw new Error("バイトコードまたはブレークポイントを送信中です。");
        }
        checkBytecodeTransfer(bytes);
        const payload = bytes.slice();
        const generation = this.generation;
        const check = () => {
            signal?.throwIfAborted();
            if (generation !== this.generation || this.state.phase !== "connected" || this.provisioning) {
                throw new Error("バイトコード送信には現在のESP32への接続が必要です。");
            }
        };
        check();
        this.resetDebugger();
        this.bytecodeReceipt = undefined;
        this.bytecodeSending = true;
        this.state = { ...this.state, message: "バイトコードを送信しています…" };
        this.notify();
        try {
            const receipt = await this.control.sendBytecode(payload, signal);
            check();
            this.bytecodeReceipt = receipt;
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

    /** 停止値の購読。未取得・失効ではundefined、取得失敗ではerrorを渡す。図の保存には含めない。 */
    subscribeDebugSnapshots(listener: (snapshot?: DebugSnapshot, error?: Error) => void): () => void {
        this.debugListeners.add(listener);
        listener(this.debugSnapshot, this.debugError);
        return () => this.debugListeners.delete(listener);
    }

    private publishDebug(snapshot?: DebugSnapshot, error?: Error): void {
        this.debugSnapshot = snapshot;
        this.debugError = error;
        for (const listener of this.debugListeners) {
            listener(snapshot, error);
        }
    }

    private resetDebugger(): void {
        this.debugger?.dispose();
        this.debugger = undefined;
        this.publishDebug();
    }

    /**
     * 最後に保持したコードへ命令PCの一覧を送る。行番号からPCへの変換とF9からの呼出しは後続実装。
     * 完了後、同じ接続・同じ保持コードのPaused通知から停止値を自動取得し、購読者へ公開する。
     * 通信・フラグ・停止値の共通仕様はdebug-protocol.ts。旧ファームウェアの通常接続には影響しない。
     * ```typescript
     * const receipt = await diagramBLE.sendBytecode(bytes, signal);
     * const release = diagramBLE.subscribeDebugSnapshots((snapshot, error) => {
     *     // snapshot?.globals / stack / pc / bp / spを後続の変数表示で使う。
     * });
     * await diagramBLE.sendBreakpoints(receipt, instructionPcs, signal);
     * await diagramBLE.startBytecode(receipt);
     * // 利用終了時はrelease()で購読を解除する。
     * ```
     */
    async sendBreakpoints(receipt: BytecodeReceipt, pcs: readonly number[], signal?: AbortSignal): Promise<void> {
        if (this.bytecodeSending || this.debuggerSending) {
            throw new Error("バイトコードまたはブレークポイントを送信中です。");
        }
        const generation = this.generation;
        const service = this.service;
        const check = () => {
            if (generation !== this.generation || !service || service !== this.service
                || this.bytecodeReceipt !== receipt || this.state.phase !== "connected" || !this.device?.gatt?.connected
                || this.state.transport === "wifi" || this.provisioning) {
                throw new Error("現在のESP32へ送信済みのコードだけをデバッグできます。");
            }
        };
        check();
        signal?.throwIfAborted();
        const list = [...pcs];
        this.debuggerSending = true;
        try {
            if (!this.debugger) {
                // コード置換・Wi-Fi準備で受信を解除しても、進行中のGATT完了を通信障害にしない。
                // receipt/所有者の照合は通信の前後にPythonDebugTransport.check()が行う。
                const checkGatt = () => {
                    if (generation !== this.generation || service !== this.service || !this.device?.gatt?.connected) {
                        throw new Error("デバッグ用のBLE接続が切れました。");
                    }
                };
                const run = <T>(operation: () => Promise<T>) => this.control.runOperation(operation, checkGatt);
                const control = await run(() => service!.getCharacteristic(BLE_UUID.debugControl));
                const result = await run(() => service!.getCharacteristic(BLE_UUID.debugResult));
                const event = await run(() => service!.getCharacteristic(BLE_UUID.debugEvent));
                const data = await run(() => service!.getCharacteristic(BLE_UUID.debugData));
                // プログラム再送・通信オブジェクト再作成でも、同じ接続内の要求番号を再利用しない。
                const nextRequestId = () => {
                    if (this.debugRequestId === 65535) {
                        throw new Error("デバッグ要求番号の上限です。BLEを再接続してください。");
                    }
                    return ++this.debugRequestId;
                };
                const client = new PythonDebugTransport(control, result, event, data, run, check, nextRequestId, (snapshot, error) => {
                    if (this.debugger === client && generation === this.generation) {
                        this.publishDebug(snapshot, error);
                    }
                });
                this.debugger = client;
            }
            await this.debugger.sendBreakpoints(receipt, list, signal);
        }
        finally {
            this.debuggerSending = false;
        }
    }

    /** 保持済みコードを先頭から実行する。通信形式とPythonBlockとの分担はpython-block.tsを参照。
     * 同じ接続・最後の転送だけを許し、キュー待機中の上書き・取消も書込み直前に検査する。
     * ACKはVM初期化の成否までを表し、HALT・実行時エラーはシリアルで確認する。
     */
    async startBytecode(receipt: BytecodeReceipt, isCurrent = () => true): Promise<void> {
        const current = () => isCurrent() && this.bytecodeReceipt === receipt && !this.bytecodeSending && !this.debuggerSending
            && !this.provisioning && this.state.phase === "connected";
        if (!current()) {
            throw new Error("現在のESP32へPythonを送信してから開始してください。");
        }
        this.debugger?.invalidateSnapshot();
        await this.sendControl(ControlOpcode.VM_START, 0, ControlCommand.allChannels, 0, current);
    }

    /** VMとその所有する機器を停止する。保持コードは残す。全体STOPは既存のstopServos()も使う。 */
    async stopBytecode(): Promise<void> {
        this.debugger?.invalidateSnapshot();
        this.resetServos();
        this.notify();
        if (this.state.phase !== "connected") {
            return;
        }
        const generation = this.generation;
        try {
            await this.sendControl(ControlOpcode.VM_STOP);
        }
        catch (error) {
            if (generation === this.generation) {
                this.close("error", "VMの停止を確認できません。再接続してください。");
            }
            throw error;
        }
    }

    /** 両経路で現在の図の一覧を送り、同じ接続の書込み完了後に通知の受信先を更新する。 */
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
        const generation = this.generation;
        await this.control.sendDeviceInfo(payload);
        if (generation !== this.generation) {
            throw new Error("機器情報の送信を取り消しました。");
        }
        this.sensors = sensors;
        this.actuators = actuators;
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
            if (diagramBLE.state.phase !== "connected") {
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
     * version=3をESP32へ転送して保持完了を待ち、VM_STARTを明示的に送る。受信の共通仕様とVM・ABI照合の境界はbytecode-transfer.ts先頭を参照する。PythonBlockとの開始・停止の契約はpython/python-block.tsを参照する。
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
            const receipt = await diagramBLE.sendBytecode(generateBytecode(module, analysis), controller.signal);
            await diagramBLE.startBytecode(receipt, () => !controller.signal.aborted && !this.removed);
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
            || this.bytecodeAbort !== undefined || diagramBLE.bytecodeSending;
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
