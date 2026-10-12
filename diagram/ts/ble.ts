import { Vec2 } from "@i18n";
import { FunctionBlock, registerFunctionBlock } from "./block";
import { Button, type Attr, type UI } from "./ui";
import { theCanvas } from "./diagram_util";
import { imuType, type IMUValue } from "./data_type";

// Same GATT service and packet format as robot/esp32-ble-lab.
export const BLE_UUID = {
    service: "f3641400-00b0-4240-ba50-05ca45bf8abc",
    command: "f3641401-00b0-4240-ba50-05ca45bf8abc",
    telemetry: "f3641402-00b0-4240-ba50-05ca45bf8abc",
    status: "f3641403-00b0-4240-ba50-05ca45bf8abc",
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
export interface BLEConnectionState { phase: BLEPhase; deviceName: string; message: string; imuAvailable: boolean; streaming: boolean; }
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

const errors = ["成功", "指令形式が不正", "範囲外の指令", "応答タイムアウト", "デバイスが見つかりません", "指令が混雑しています", "I²C通信エラー"];

/** One connection per diagram document. Blocks subscribe; GATT objects are never saved. */
export class BLEConnection {
    state: BLEConnectionState = { phase: "idle", deviceName: "", message: "", imuAvailable: false, streaming: false };
    private listeners = new Set<(state: BLEConnectionState) => void>();
    private sampleListeners = new Set<(sample: IMUSample) => void>();
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

    private updateStream(): void {
        if (this.state.phase !== "connected") return;
        const rate = this.sampleListeners.size && this.state.imuAvailable ? 10 : 0;
        if (rate === this.requestedRate) return;
        this.requestedRate = rate;
        const generation = this.generation;
        void this.sendControl(4, rate).catch(error => {
            if (generation === this.generation) this.close("error", error.message);
        });
    }

    private publish(phase: BLEPhase, deviceName = "", message = ""): void {
        const active = phase === "connected" || phase === "connecting";
        this.state = { phase, deviceName, message, imuAvailable: active && this.state.imuAvailable, streaming: active && this.state.streaming };
        this.listeners.forEach(listener => listener(this.state));
    }

    private hardwareStatus(data: DataView): void {
        const flags = data.getUint8(4);
        const imuAvailable = !!(flags & 2), streaming = !!(flags & 8);
        if (this.state.imuAvailable !== imuAvailable || this.state.streaming !== streaming) {
            this.state = { ...this.state, imuAvailable, streaming };
            this.listeners.forEach(listener => listener(this.state));
            this.updateStream();
        }
    }

    private sampleChanged = (event: Event): void => {
        if (this.state.phase !== "connected" || !this.state.imuAvailable || !this.requestedRate) return;
        let sample: IMUSample;
        try {
            const value = (event.target as BLECharacteristic).value;
            if (!value) throw new Error("IMUデータがありません。");
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

    private lost = (): void => this.close("idle", "BLE接続が切れました。");
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
        this.generation++;
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
    }

    disconnect(): void { this.close("idle"); }

    async connect(): Promise<void> {
        if (["selecting", "connecting", "connected"].includes(this.state.phase)) return;
        const unavailable = this.availabilityMessage();
        if (unavailable) { this.publish("unavailable", "", unavailable); return; }
        const generation = ++this.generation;
        let selected: BLEDevice | undefined;
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
                if (this.generation === generation) this.close("error", "接続がタイムアウトしました。再接続してください。");
            }, 15_000);
            const server = await selected.gatt.connect();
            check();
            const service = await server.getPrimaryService(BLE_UUID.service);
            check();
            const tx = await service.getCharacteristic(BLE_UUID.command);
            check();
            const status = await service.getCharacteristic(BLE_UUID.status);
            check();
            const rx = await service.getCharacteristic(BLE_UUID.telemetry);
            check();
            this.tx = tx; this.status = status; this.rx = rx;
            status.addEventListener("characteristicvaluechanged", this.statusChanged);
            rx.addEventListener("characteristicvaluechanged", this.sampleChanged);
            await status.startNotifications();
            check();
            await rx.startNotifications();
            check();
            const initialStatus = await status.readValue();
            check();
            if (initialStatus.byteLength !== 12 || initialStatus.getUint8(0) !== 1) throw new Error("状態データの形式が正しくありません。");
            this.hardwareStatus(initialStatus);
            await this.sendControl(6); // INFO ACK confirms application readiness, not motion completion.
            check();
            clearTimeout(this.connectTimer); this.connectTimer = undefined;
            this.publish("connected", selected.name || "名前のない機器");
            this.updateStream();
            this.heartbeat = setInterval(() => {
                void this.sendControl(5).catch(error => {
                    if (this.generation === generation) this.close("error", error.message);
                });
            }, 1500);
        } catch (error) {
            if (this.generation !== generation) return;
            const name = error instanceof Error ? error.name : "";
            if (!selected && name === "NotFoundError") this.close("idle");
            else this.close("error", name === "NotFoundError"
                ? "このデモに対応した機器ではありません。"
                : error instanceof Error ? error.message : "BLE接続に失敗しました。");
        }
    }

    private sendControl(opcode: 4 | 5 | 6, value = 0): Promise<void> {
        const generation = this.generation;
        const task = this.tail.catch(() => {}).then(async () => {
            if (generation !== this.generation || !this.tx || !this.device?.gatt?.connected) throw new Error("BLE接続が切れました。");
            const sequence = this.sequence = this.sequence % 65535 + 1;
            const bytes = new Uint8Array(10);
            const packet = new DataView(bytes.buffer);
            bytes[0] = 1; bytes[1] = opcode; bytes[4] = 255;
            packet.setUint16(2, sequence, true);
            packet.setUint16(6, value, true);
            const ack = new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.pending.delete(sequence);
                    reject(new Error("ESP32の応答がありません。再接続してください。"));
                    if (generation === this.generation) this.close("error", "ESP32の応答がありません。再接続してください。");
                }, 2500);
                this.pending.set(sequence, { resolve, reject, timer });
            });
            void ack.catch(() => {});
            const write = this.tx.writeValueWithResponse(bytes).catch(error => {
                const pending = this.pending.get(sequence);
                if (pending) { clearTimeout(pending.timer); this.pending.delete(sequence); pending.reject(error as Error); }
                throw error;
            });
            // A missing ACK must unblock the queue even if the native write hangs.
            await Promise.all([write, ack]);
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
    private unsubscribe?: () => void;
    private removed = false;

    constructor(data: Attr) {
        super(data);
        this.button = new Button({ text: "接続", click: () => {
            if (this.removed || this.inToolbox) return;
            if (diagramBLE.state.phase === "connected") diagramBLE.disconnect();
            else return diagramBLE.connect();
        } });
        if (!this.inToolbox) this.unsubscribe = diagramBLE.subscribe(() => {
            this.updateButton();
            theCanvas?.requestUpdateCanvas();
        });
        this.setBoxSize();
        this.updateButton();
    }

    children(): UI[] { return [this.button]; }
    setBoxSize(): void { this.boxSize = new Vec2(280, this.inToolbox ? 60 : 190); }

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
    }

    private updateButton(): void {
        const phase = diagramBLE.state.phase;
        this.button.text = phase === "connected" ? "切断" : phase === "error" ? "再接続" : "接続";
        this.button.disabled = this.removed || this.inToolbox || !!diagramBLE.availabilityMessage() || phase === "selecting" || phase === "connecting";
    }

    draw(): void {
        super.draw();
        const ctx = this.ctx;
        ctx.save();
        ctx.font = "18px sans-serif";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#17384f";
        ctx.fillText("BLE接続", this.position.x + 16, this.position.y + 16);
        if (!this.inToolbox) {
            const state = diagramBLE.state;
            const unavailable = diagramBLE.availabilityMessage();
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
        }
        ctx.restore();
    }

    clearBlock(): void {
        this.removed = true;
        this.button.disabled = true;
        this.button.pressed = false;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        super.clearBlock();
    }
}

registerFunctionBlock(BLEConnectionBlock.name, () => new BLEConnectionBlock({}));
