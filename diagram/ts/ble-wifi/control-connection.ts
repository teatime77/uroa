/**
 * 通常指令・ACK・センサー通知の通信経路に依存しない共通層。
 * ble-control-transport.tsはGATT、robot-wifi.tsは認証済みHTTP/WebSocketを担当する。
 * device-connection.tsは接続UI・機器登録・ブロックへの状態反映を担当し、本層へ通信経路を渡す。
 * ESP32の対応する配送・接続照合はapp/diagram-control/src/control_transport.cpp。
 * Command/Status v1、Telemetry v3のバイト形式と既存UUID・HTTP形式は変更しない。
 * 機器一覧・Python転送・VM指令・デバッグを両経路へ配送する。カメラ画像は本層を通さない。
 */
import { DeviceInfoMaxLength, parseDeviceTelemetry, type DeviceTelemetry } from "./device-telemetry";
import { bytecodeTransfer, checkBytecodeTransfer, uploadBytecode, type BytecodeChannel, type BytecodeReceipt } from "./bytecode-transfer";
import type { DebugChannel } from "./debug-protocol";

/** 通常通信の通知先。BLEはCharacteristicから指定し、Wi-Fiは共通層で版・長さを検証する。 */
export type ControlPacketKind = "status" | "telemetry";

/** 接続済み通信経路。writeの完了は通信APIの受付であり、機器のACKや動作完了ではない。 */
export interface ControlTransport {
    readonly kind: "ble" | "wifi";
    readonly connected: boolean;
    write(bytes: Uint8Array): Promise<void>;
    writeDeviceInfo(bytes: Uint8Array): Promise<void>;
    openBytecode(): Promise<BytecodeChannel>;
    openDebug(): Promise<DebugChannel>;
    subscribePackets(listener: (data: DataView | undefined, kind?: ControlPacketKind) => void): () => void;
}

/** diagram-controlのProtocol::Opと共有する番号。VM操作の利用条件はdevice-connection.tsが検査する。 */
export enum ControlOpcode {
    ARM = 1,
    MOVE = 2,
    STOP = 3,
    STREAM = 4,
    PING = 5,
    INFO = 6,
    DISABLE = 7,
    ARM_SPEED = 8,
    SET_SPEED = 9,
    VM_START = 10,
    VM_STOP = 11,
}

/** Command v1は10バイト、little endian。Status v1は12バイトでsequenceをACKへ使う。 */
export const ControlCommand = {
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

const errors = ["成功", "指令形式が不正（速度制御には対応ファームウェアが必要です）", "範囲外の指令", "サーボが無効／応答タイムアウト", "デバイスが見つかりません", "指令が混雑しています", "I²C通信エラー", "角度／速度モードが異なります。無効化してから有効化してください。"];

const servoOperations: Partial<Record<ControlOpcode, string>> = {
    [ControlOpcode.ARM]: "ARM",
    [ControlOpcode.MOVE]: "MOVE",
    [ControlOpcode.STOP]: "STOP",
    [ControlOpcode.DISABLE]: "DISABLE",
    [ControlOpcode.ARM_SPEED]: "ARM_SPEED",
    [ControlOpcode.SET_SPEED]: "SET_SPEED",
};

/** 通知は形式検証後に渡す。telemetryの登録件数・順序の照合とブロック反映は呼出元が行う。 */
interface ControlCallbacks {
    status(data: DataView): void;
    telemetry(data: DataView, telemetry: DeviceTelemetry): void;
    failed(error: Error): void;
}

/** 応答期限と取消に使う、現在の通常指令のACK待機。 */
interface PendingCommand {
    resolve(): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * 通信経路を交換できる通常指令・通知の所有者。
 * bind/closeで世代を更新し、旧経路の通知・キュー待機・ACKを次の接続へ適用しない。
 * 機器登録・プログラム・デバッグ転送もenqueue()を使い、同じ待ち列で排他する。
 * 転送全体ではなく各フレームを並べ、PING・STOPを間に処理できるようにする。
 */
export class ControlConnection {
    private transport?: ControlTransport;
    private unsubscribe?: () => void;
    private generation = 0;
    private sequence = 0;
    private tail: Promise<unknown> = Promise.resolve();
    private pending = new Map<number, PendingCommand>();
    private heartbeat?: ReturnType<typeof setInterval>;
    private bytecodeTransferId = 0;

    constructor(private callbacks: ControlCallbacks) {
    }

    /** 旧経路を解除してACKを失効させ、新しい経路の通知を購読する。機器操作は行わない。 */
    bind(transport: ControlTransport): void {
        this.close("通信経路を切り替えました。");
        this.transport = transport;
        const generation = this.generation;
        this.unsubscribe = transport.subscribePackets((data, kind) => {
            if (generation === this.generation && transport === this.transport) {
                this.receive(data, kind);
            }
        });
    }

    /** 接続解除・経路交換で未完了ACKを拒否する。通信経路そのものの終了は呼出元が担当する。 */
    close(message = "機器の接続が切れました。"): void {
        this.generation++;
        this.stopHeartbeat();
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.transport = undefined;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error(message));
        }
        this.pending.clear();
    }

    /** 通常指令と各転送の共通待ち列。各処理が開始時と完了時に所有元を照合する。 */
    enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const task = this.tail.catch(() => {
        }).then(operation);
        this.tail = task;
        return task;
    }

    /**
     * 共通待ち列の1操作に2.5秒の期限と取消を付ける。ネイティブ操作自体の取消可否に依存せず、
     * 失敗時は現接続を終了し、古い処理が新しい通信経路へ進まないよう前後で世代を照合する。
     * デバッグも同じ待ち列を使い、要求・結果・停止値の途中へ別操作を挟まない。
     */
    runOperation<T>(operation: () => Promise<T>, check: () => void, signal?: AbortSignal): Promise<T> {
        const generation = this.generation;
        const transport = this.transport;
        const current = () => {
            signal?.throwIfAborted();
            if (!transport || transport !== this.transport || generation !== this.generation || !transport.connected) {
                throw new Error("機器の接続が切れました。");
            }
            check();
        };
        return this.enqueue(async () => {
            current();
            let timer: ReturnType<typeof setTimeout> | undefined;
            let abort: (() => void) | undefined;
            try {
                const timeout = new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error("機器の通信応答がありません。再接続してください。")),
                        bytecodeTransfer.timeoutMs);
                    abort = () => reject(signal?.reason ?? new DOMException("転送を取り消しました。", "AbortError"));
                    signal?.addEventListener("abort", abort, { once: true });
                });
                const result = await Promise.race([operation(), timeout]);
                current();
                return result;
            }
            catch (error) {
                if (generation === this.generation) {
                    this.callbacks.failed(error instanceof Error ? error : new Error("機器の通信に失敗しました。"));
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
    }

    /** 同一のフレーム・CRC・Result照合でRAM保持までを待つ。完全な契約はbytecode-transfer.tsを参照。 */
    async sendBytecode(input: Uint8Array, signal?: AbortSignal): Promise<BytecodeReceipt> {
        checkBytecodeTransfer(input);
        const bytes = input.slice();
        const generation = this.generation;
        const transport = this.transport;
        const check = () => {
            signal?.throwIfAborted();
            if (!transport || generation !== this.generation || transport !== this.transport || !transport.connected) {
                throw new Error("プログラム転送中に接続が変わりました。");
            }
        };
        const run = <T>(operation: () => Promise<T>) => this.runOperation(operation, check, signal);
        const channel = await run(() => transport!.openBytecode());
        this.bytecodeTransferId = this.bytecodeTransferId % 65535 + 1;
        const receipt = await uploadBytecode(bytes, this.bytecodeTransferId, channel, run, check);
        check();
        return receipt;
    }

    /** デバッグ窓口を現経路から取得する。接続とReceiptの照合は呼出元のcheckが担当する。 */
    openDebug(check: () => void): Promise<DebugChannel> {
        const transport = this.transport;
        return this.runOperation(() => transport!.openDebug(), check);
    }

    /**
     * 機器一覧を現在の通信経路へ送り、書込みを最大2.5秒待つ。
     * device-connection.tsがセンサー→アクチュエータの順で作った0〜20バイトをコピーする。
     * レコード形式はdevice-telemetry.ts、ESP32の内容検証はmain.cppのhandleDeviceInfo()を参照する。
     * BLEは既存DeviceInfo Characteristicへresponse付きWriteを行う。
     * Wi-Fiはrobot-wifi.tsの認証済み/device-info（HTTP）またはdevice-info（WebSocket）へ送る。
     * HTTPのaccepted:trueとGATT書込み完了は受付までを表す。専用の内容検証ACKは追加しない。
     * WebSocketはブラウザーの送信キューへの追加までで、ESP32の受付完了を待たない。
     * 呼出元は書込み後に受信先を更新し、同じ待ち列へ新しいSTREAMを追加する。
     * 取消・期限超過・接続変更では未完了の登録を失効させ、新接続へ適用しない。
     */
    sendDeviceInfo(input: Uint8Array): Promise<void> {
        if (input.byteLength > DeviceInfoMaxLength) {
            throw new Error(`機器情報は${DeviceInfoMaxLength}バイト以内で送信してください。`);
        }
        const bytes = input.slice();
        const transport = this.transport;
        const generation = this.generation;
        const check = () => {
            if (!transport || transport !== this.transport || generation !== this.generation || !transport.connected) {
                throw new Error("機器情報の送信を取り消しました。接続を確認してください。");
            }
        };
        return this.enqueue(async () => {
            check();
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                const timeout = new Promise<never>((_, reject) => {
                    timer = setTimeout(() => {
                        reject(new Error("機器情報の書き込みがタイムアウトしました。"));
                    }, 2500);
                });
                await Promise.race([transport!.writeDeviceInfo(bytes), timeout]);
                check();
            }
            catch (error) {
                if (generation === this.generation) {
                    this.callbacks.failed(error instanceof Error ? error : new Error("機器情報を送信できませんでした。"));
                }
                throw error;
            }
            finally {
                clearTimeout(timer);
            }
        });
    }

    /**
     * 通知・初期Status読出しを同じ形式検証へ通す。
     * Wi-Fiの既存形式には通知先がないため、Status v1とTelemetry v3を版と長さで区別する。
     * 不正データは部分反映せず接続を終了する。ACKの成功は指令の受付までを表す。
     */
    receive(data: DataView | undefined, kind?: ControlPacketKind): void {
        const generation = this.generation;
        try {
            if (!data || !data.byteLength) {
                throw new Error("機器の通知データがありません。");
            }
            const packetKind = kind ?? (data.getUint8(0) === 1 ? "status" : "telemetry");
            if (packetKind === "telemetry") {
                const telemetry = parseDeviceTelemetry(data);
                this.callbacks.telemetry(data, telemetry);
                return;
            }
            if (data.byteLength !== 12 || data.getUint8(0) !== 1) {
                throw new Error("状態データの形式が正しくありません。");
            }
            this.callbacks.status(data);
            if (generation !== this.generation) {
                return;
            }
            const sequence = data.getUint16(2, true);
            const pending = this.pending.get(sequence);
            if (pending) {
                clearTimeout(pending.timer);
                this.pending.delete(sequence);
                const code = data.getUint8(1);
                if (code) {
                    pending.reject(new Error(errors[code] ?? `機器エラー ${code}`));
                }
                else {
                    pending.resolve();
                }
            }
        }
        catch (error) {
            this.callbacks.failed(error instanceof Error ? error : new Error("機器の通知を受信できませんでした。"));
        }
    }

    /**
     * 1指令ずつ書込みと最大2.5秒のACKを待つ。SET_SPEEDのvalueだけ符号付き0.01%。
     * 書込み前後で接続世代と操作の有効性を照合する。ACK期限超過では接続終了を要求する。
     * ネイティブ書込みが未完了でも、ACK拒否によって共通待ち列の待機を終了する。
     */
    send(opcode: ControlOpcode, value = 0, channel: number = ControlCommand.allChannels, duration = 0,
        isCurrent = () => true, accepted?: () => void): Promise<void> {
        const generation = this.generation;
        const transport = this.transport;
        const check = () => {
            if (generation !== this.generation || !transport || transport !== this.transport || !transport.connected) {
                throw new Error("機器の接続が切れました。");
            }
            if (!isCurrent()) {
                throw new Error("機器操作を取り消しました。");
            }
        };
        return this.enqueue(async () => {
            check();
            const sequence = this.sequence = this.sequence % ControlCommand.maxSequence + 1;
            const bytes = new Uint8Array(ControlCommand.byteLength);
            const packet = new DataView(bytes.buffer);
            bytes[ControlCommand.offset.version] = ControlCommand.version;
            bytes[ControlCommand.offset.opcode] = opcode;
            bytes[ControlCommand.offset.channel] = channel;
            packet.setUint16(ControlCommand.offset.sequence, sequence, true);
            if (opcode === ControlOpcode.SET_SPEED) {
                packet.setInt16(ControlCommand.offset.value, value, true);
            }
            else {
                packet.setUint16(ControlCommand.offset.value, value, true);
            }
            packet.setUint16(ControlCommand.offset.duration, duration, true);
            const operation = servoOperations[opcode];
            const details = { operation, sequence, channel, value, duration, transport: transport!.kind };
            const ack = new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.pending.delete(sequence);
                    const error = new Error("ESP32の応答がありません。再接続してください。");
                    reject(error);
                    if (generation === this.generation) {
                        this.callbacks.failed(error);
                    }
                }, 2500);
                this.pending.set(sequence, { resolve, reject, timer });
            });
            void ack.catch(() => {
            });
            if (operation) {
                console.log("Device servo send", details);
            }
            // 同期例外もACK待機を解除する。通信API完了と機器ACKは独立して待つ。
            const write = Promise.resolve().then(() => {
                check();
                return transport!.write(bytes);
            }).catch(error => {
                const pending = this.pending.get(sequence);
                if (pending) {
                    clearTimeout(pending.timer);
                    this.pending.delete(sequence);
                    pending.reject(error);
                }
                throw error;
            });
            try {
                await Promise.all([write, ack]);
            }
            catch (error) {
                if (operation) {
                    console.error("Device servo error", details, error);
                }
                throw error;
            }
            check();
            if (operation) {
                console.log("Device servo ACK", details);
            }
            accepted?.();
        });
    }

    /** 1.5秒周期で共通待ち列へPINGを追加する。経路交換・切断ではタイマーを解除する。 */
    startHeartbeat(): void {
        this.stopHeartbeat();
        const generation = this.generation;
        this.heartbeat = setInterval(() => {
            void this.send(ControlOpcode.PING).catch(error => {
                if (generation === this.generation) {
                    this.callbacks.failed(error instanceof Error ? error : new Error("機器の応答がありません。"));
                }
            });
        }, 1500);
    }

    /** Wi-Fi設定中も通常指令は利用できるようにし、定期PINGだけを止める。 */
    stopHeartbeat(): void {
        clearInterval(this.heartbeat);
        this.heartbeat = undefined;
    }
}
