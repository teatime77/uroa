/**
 * 通常指令・ACK・センサー通知の通信経路に依存しない共通層。
 * ble-control-transport.tsはGATT、robot-wifi.tsは認証済みHTTP/WebSocketを担当する。
 * device-connection.tsは接続UI・機器登録・ブロックへの状態反映を担当し、本層へ通信経路を渡す。
 * ESP32の対応する配送・接続照合はapp/diagram-control/src/control_transport.cpp。
 * Command/Status v1、Telemetry v3のバイト形式と既存UUID・HTTP形式は変更しない。
 * 機器一覧・Python転送・VM指令・デバッグを両経路へ配送する。カメラ画像は本層を通さない。
 * RPCはBLE専用の遅延窓口を用意する。各GATT操作は通常指令と同じ待ち列で直列化する。
 * 操作番号・Command符号化・Status復号/形式検査はdevice.protoから生成する。
 * 要求の単位・符号・優先度・期限・Status結果はdevice-control.generated.tsから渡す。
 * 本層は現在の経路、世代、ACKと待ち列を所有する。STOP/VM_STOPは進行中の1操作後に優先し、
 * 待ち列は32件まで。満杯時のSTOPは未開始の通常操作を1件取り消して場所を確保する。
 * 全件が優先操作なら混雑を返す。GATTを並行実行せず、切断時に未開始操作を失効させる。
 */
import { DeviceInfoMaxLength, parseDeviceTelemetry, type DeviceTelemetry } from "./device-telemetry";
import { bytecodeTransfer, checkBytecodeTransfer, uploadBytecode, type BytecodeChannel, type BytecodeReceipt, type BytecodeProgress, type BytecodeDeployment } from "./bytecode-transfer";
import type { DebugChannel } from "./debug-protocol";
import type { RpcChannel } from "./rpc-protocol";
import { packetLayouts, rpcMaxPending, type StatusPacket } from "./device-rpc.generated";
import { decodeStatusPacket } from "./device-rpc-codec.generated";
import { createInternalControlCalls, controlMaxSequence } from "./device-control.generated";
import { RpcCode, RpcError, type RpcCallOptions } from "./rpc-client";

/** 通常通信の通知先。BLEはCharacteristicから指定し、Wi-Fiは共通層で版・長さを検証する。 */
export type ControlPacketKind = "status" | "telemetry";

/** 接続済み通信経路。writeの完了は通信APIの受付であり、機器のACKや動作完了ではない。 */
export interface ControlTransport {
    /**
     * 共通通信層でBLEとWi-Fiの経路を区別する識別子。
     */
    readonly kind: "ble" | "wifi";
    /**
     * 通信経路が現在利用できる接続状態。
     */
    readonly connected: boolean;
    /**
     * 通常指令または転送フレームを、現在の通信経路へ書き込む。
     *
     * @param bytes 読み書きするバイト列。
     */
    write(bytes: Uint8Array): Promise<void>;
    /**
     * 機器一覧のバイト列を専用窓口へ渡す。機器側の内容検証完了は示さない。
     *
     * @param bytes 読み書きするバイト列。
     */
    writeDeviceInfo(bytes: Uint8Array): Promise<void>;
    /**
     * 現在の経路でコード転送と専用Result読出しの窓口を取得する。
     */
    openBytecode(): Promise<BytecodeChannel>;
    /**
     * 現在の経路でデバッグ要求・ACK・状態・停止値の窓口を取得する。
     */
    openDebug(): Promise<DebugChannel>;
    /** RPC専用窓口。第3段階ではBLEだけが対応する。 */
    openRpc?(): Promise<RpcChannel>;
    /**
     * 通信パケットの通知を購読し、解除関数を返す。
     *
     * @param listener 変更通知を受け取る処理。
     */
    subscribePackets(listener: (data: DataView | undefined, kind?: ControlPacketKind) => void): () => void;
}

/** 生成した操作から渡す配送条件。新しい経路やキューは作らない。 */
export interface ControlExchangePolicy {
    priority: boolean;
    ioTimeoutMs: number;
}

/** 機能側の状態管理。ACKと書込みが完了し、取消・世代を照合した後だけacceptedを呼ぶ。 */
export interface ControlCallContext {
    skip?: boolean;
    isCurrent?: () => boolean;
    accepted?: () => void;
    failed?: (error: unknown) => void;
}

/** 通知は形式検証後に渡す。telemetryの登録件数・順序の照合とブロック反映は呼出元が行う。 */
interface ControlCallbacks {
    /**
     * 検証済みの通常指令受付結果を所有元へ通知する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    status(data: StatusPacket): void;
    /**
     * 全件検証済みのセンサー通知を所有元へ渡す。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    telemetry(data: DataView, telemetry: DeviceTelemetry): void;
    /**
     * 現在の通信経路の失敗を所有元へ通知する。
     */
    failed(error: Error): void;
}

/** 応答期限と取消に使う、現在の通常指令のACK待機。 */
interface PendingCommand {
    /**
     * 対応する指令の受付結果待ちを成功として完了する。
     */
    resolve(status: StatusPacket): void;
    /**
     * 対応する指令の受付結果待ちを失敗として完了する。
     */
    reject(error: Error): void;
    /**
     * 期限監視または定期監視に使うタイマーの予約。
     */
    timer: ReturnType<typeof setTimeout>;
}

/**
 * 通信経路を交換できる通常指令・通知の所有者。
 * bind/closeで世代を更新し、旧経路の通知・キュー待機・ACKを次の接続へ適用しない。
 * 機器登録・プログラム・デバッグ転送もenqueue()を使い、同じ待ち列で排他する。
 * 転送全体ではなく各フレームを並べ、PING・STOPを間に処理できるようにする。
 */
export class ControlConnection {
    /** 共有センサー通知の内部要求。公開の所有者購読APIとは分ける。 */
    readonly internalCalls = createInternalControlCalls(this);
    /**
     * 現在採用している経路別の通信窓口。
     */
    private transport?: ControlTransport;
    /**
     * 現在の通信状態またはパケット通知の購読を解除する関数。
     */
    private unsubscribe?: () => void;
    /**
     * 切断や経路変更の前に開始した非同期処理を失効させる接続世代。
     */
    private generation = 0;
    /**
     * 通常指令とACKを対応付ける連番。
     */
    private sequence = 0;
    /**
     * 通信要求を直列化する待ち列の末尾Promise。
     */
    private operations: { run: () => Promise<void>; reject: (error: Error) => void; priority: boolean }[] = [];
    /** 通信操作は経路によらず同時に1件だけ開始する。 */
    private operationRunning = false;
    /**
     * 受付結果を待つ指令をsequenceで管理する対応表。
     */
    private pending = new Map<number, PendingCommand>();
    /**
     * 接続を維持するPINGの周期タイマー。
     */
    private heartbeat?: ReturnType<typeof setInterval>;
    /**
     * 同じ接続内で再利用しないPython転送IDの採番状態。
     */
    private bytecodeTransferId = 0;

    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(/** 検証済みStatus・Telemetryと通信失敗を所有元へ通知する処理群。 */ private callbacks: ControlCallbacks) {
    }

    /** 旧経路を解除してACKを失効させ、新しい経路の通知を購読する。機器操作は行わない。 */
    bind(transport: ControlTransport): void {
        this.close("通信経路を切り替えました。");
        this.bytecodeTransferId = 0;
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
        for (const operation of this.operations) {
            operation.reject(new RpcError(RpcCode.Unavailable, message));
        }
        this.operations = [];
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new RpcError(RpcCode.Unavailable, message));
        }
        this.pending.clear();
    }

    /** 通常指令と各転送の共通待ち列。各処理が開始時と完了時に所有元を照合する。 */
    enqueue<T>(operation: () => Promise<T>, priority = false): Promise<T> {
        if (this.operations.length >= rpcMaxPending) {
            const replace = priority ? this.operations.findIndex(entry => !entry.priority) : -1;
            if (replace < 0) {
                return Promise.reject(new RpcError(RpcCode.Busy, "機器の送信待ちが混雑しています。"));
            }
            const [cancelled] = this.operations.splice(replace, 1);
            cancelled.reject(new DOMException("STOPを優先するため送信待ちを取り消しました。", "AbortError"));
        }
        return new Promise<T>((resolve, reject) => {
            this.operations.push({ priority, reject, run: async () => {
                try {
                    resolve(await operation());
                }
                catch (error) {
                    reject(error);
                }
                finally {
                    this.operationRunning = false;
                    this.runNextOperation();
                }
            } });
            this.runNextOperation();
        });
    }

    /** 優先操作同士はFIFO。進行中のネイティブ通信は重ねず、次の境界でSTOPを先行させる。 */
    private runNextOperation(): void {
        if (this.operationRunning || this.operations.length === 0) {
            return;
        }
        const priority = this.operations.findIndex(operation => operation.priority);
        const [operation] = this.operations.splice(priority < 0 ? 0 : priority, 1);
        this.operationRunning = true;
        void operation.run();
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
                throw new RpcError(RpcCode.Unavailable, "機器の接続が切れました。");
            }
            check();
        };
        return this.enqueue(async () => {
            current();
            let timer: ReturnType<typeof setTimeout> | undefined;
            let abort: (() => void) | undefined;
            try {
                const timeout = new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new RpcError(RpcCode.DeadlineExceeded, "機器の通信応答がありません。再接続してください。")),
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

    /**
     * RAM保持までを待ち、進捗を呼出元へ中継する。転送・進捗の契約はbytecode-transfer.tsを参照。
     *
     * performance.now()でこの呼出しだけの書込み・Result読出し・キュー待ち・窓口取得を集計する。
     * 書込みと読出しはBytecodeChannelの各Promiseを待つ時間で、BEGIN・DATA・COMMITを含む。
     * Wi-Fiでは署名・HTTP/WS・JSON処理も含み、電波上の送受信時間やESP32だけの処理時間ではない。
     * Result読出し回数は古い結果・失敗した読出しも数える。キュー待ちはrunOperation()の呼出しから
     * 操作開始までとし、窓口取得の待ちも含む。開始前の接続・取消検査で拒否された場合は拒否までを計る。
     * 窓口取得はopenBytecode()のPromiseだけを計り、そのキュー待ちとは重複させない。
     * BLEの転送サイズ取得用Readは窓口取得へ含め、Result読出しの行はCOMMIT後の確認だけを数える。
     * 完了・失敗時に経路・転送ID・本体サイズ・総所要時間とconsole.tableの集計を1回出力する。
     * 総所要時間は窓口取得を含むため、BEGIN直前から計る画面の平均速度とは計測開始点が異なる。
     * 表の合計は出力時に未完了の操作の経過時間も含み、平均・最大は完了した操作だけを対象とする。
     * 未完了時間は別列にも表示する。タイムアウト後のネイティブ操作の完了で出力済みの値を更新しない。
     * 総所要時間との差には再読出し前の待機・照合・進捗通知等が含まれる。毎フレームのログは出さず、
     * キー・パケット本体・Resultの内容は出力しない。計測のために転送順序・待機・期限を変更しない。
     * 切断の診断用に転送段階・最後の送信op/sequence・サイズ・例外メッセージも出力する。
     *
     * バイトコード転送の通信・キュー時間の計測とコンソール出力はsendBytecode()が担当する。
     */
    async sendBytecode(input: Uint8Array, signal?: AbortSignal,
        onProgress?: (progress: BytecodeProgress) => void, deployment?: BytecodeDeployment): Promise<BytecodeReceipt> {
        checkBytecodeTransfer(input);
        const bytes = input.slice();
        const staged = deployment ? { ...deployment, breakpoints: [...deployment.breakpoints], stepPcs: [...deployment.stepPcs] } : undefined;
        const generation = this.generation;
        const transport = this.transport;
        const check = () => {
            signal?.throwIfAborted();
            if (!transport || generation !== this.generation || transport !== this.transport || !transport.connected) {
                throw new RpcError(RpcCode.Unavailable, "プログラム転送中に接続が変わりました。");
            }
        };
        if (this.bytecodeTransferId === 65535) {
            throw new RpcError(RpcCode.Busy, "転送IDの上限です。再接続してください。");
        }
        this.bytecodeTransferId++;
        const transferId = this.bytecodeTransferId;
        const createTiming = () => ({
            count: 0,
            completed: 0,
            totalMs: 0,
            maxMs: 0,
            pendingAt: undefined as number | undefined,
        });
        const timings = {
            write: createTiming(),
            read: createTiming(),
            queue: createTiming(),
            open: createTiming(),
        };
        const finishTiming = (timing: ReturnType<typeof createTiming>): void => {
            const now = performance.now();
            const elapsedMs = now - (timing.pendingAt ?? now);
            timing.completed++;
            timing.totalMs += elapsedMs;
            timing.maxMs = Math.max(timing.maxMs, elapsedMs);
            timing.pendingAt = undefined;
        };
        const measure = async <T>(timing: ReturnType<typeof createTiming>, operation: () => Promise<T>): Promise<T> => {
            timing.count++;
            timing.pendingAt = performance.now();
            try {
                return await operation();
            }
            finally {
                finishTiming(timing);
            }
        };
        const run = <T>(operation: () => Promise<T>): Promise<T> => {
            timings.queue.count++;
            timings.queue.pendingAt = performance.now();
            let started = false;
            return this.runOperation(() => {
                started = true;
                finishTiming(timings.queue);
                return operation();
            }, check, signal).finally(() => {
                if (!started) {
                    finishTiming(timings.queue);
                }
            });
        };
        const startedAt = performance.now();
        let completed = false;
        let stage = "転送窓口取得";
        let packetLength = 0;
        let lastOperation = 0;
        let lastSequence = 0;
        let lastWriteBytes = 0;
        let failure: string | undefined;
        try {
            const channel = await run(() => measure(timings.open, () => transport!.openBytecode()));
            packetLength = channel.packetLength;
            const measuredChannel: BytecodeChannel = {
                packetLength: channel.packetLength,
                write: packet => {
                    lastOperation = packet[1];
                    lastSequence = new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint16(4, true);
                    lastWriteBytes = packet.byteLength;
                    stage = "書込み";
                    return measure(timings.write, () => channel.write(packet));
                },
                readResult: () => {
                    stage = "最終Result読出し";
                    return measure(timings.read, () => channel.readResult());
                },
            };
            const receipt = await uploadBytecode(bytes, transferId, measuredChannel, run, check, onProgress, staged);
            check();
            completed = true;
            return receipt;
        }
        catch (error) {
            failure = error instanceof Error ? error.message : String(error);
            throw error;
        }
        finally {
            const finishedAt = performance.now();
            const round = (value: number): number => Math.round(value * 100) / 100;
            const row = (timing: ReturnType<typeof createTiming>) => {
                const pendingMs = timing.pendingAt === undefined ? 0 : finishedAt - timing.pendingAt;
                return {
                    "回数": timing.count,
                    "完了回数": timing.completed,
                    "合計ms": round(timing.totalMs + pendingMs),
                    "完了平均ms": round(timing.completed > 0 ? timing.totalMs / timing.completed : 0),
                    "完了最大ms": round(timing.maxMs),
                    "未完了ms": round(pendingMs),
                };
            };
            console.info(`[Bytecode transfer] ${transport?.kind ?? "unknown"} id=${transferId} ${completed ? "完了" : "失敗"}`, {
                totalBytes: bytes.byteLength,
                packetLength, stage, lastOperation, lastSequence, lastWriteBytes, failure,
                elapsedMs: round(finishedAt - startedAt),
                resultReadsPerWrite: round(timings.write.count > 0 ? timings.read.count / timings.write.count : 0),
            });
            console.table({
                "書込み": row(timings.write),
                "Result読出し": row(timings.read),
                "キュー待ち（窓口取得を含む）": row(timings.queue),
                "窓口取得": row(timings.open),
            });
        }
    }

    /** デバッグ窓口を現経路から取得する。接続とReceiptの照合は呼出元のcheckが担当する。 */
    openDebug(check: () => void): Promise<DebugChannel> {
        const transport = this.transport;
        return this.runOperation(() => transport!.openDebug(), check);
    }

    /** RPC窓口も通常指令と同じ待ち列・接続照合を使う。非対応経路へフォールバックしない。 */
    openRpc(check: () => void): Promise<RpcChannel> {
        const transport = this.transport;
        return this.runOperation(() => {
            if (!transport?.openRpc) {
                throw new RpcError(RpcCode.Unsupported, "現在の通信経路はRPCに対応していません");
            }
            return transport.openRpc();
        }, check);
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
            throw new RpcError(RpcCode.InvalidArgument, `機器情報は${DeviceInfoMaxLength}バイト以内で送信してください。`);
        }
        const bytes = input.slice();
        const transport = this.transport;
        const generation = this.generation;
        const check = () => {
            if (!transport || transport !== this.transport || generation !== this.generation || !transport.connected) {
                throw new RpcError(RpcCode.Unavailable, "機器情報の送信を取り消しました。接続を確認してください。");
            }
        };
        return this.enqueue(async () => {
            check();
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                const timeout = new Promise<never>((_, reject) => {
                    timer = setTimeout(() => {
                        reject(new RpcError(RpcCode.DeadlineExceeded, "機器情報の書き込みがタイムアウトしました。"));
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
            const packetKind = kind ?? (data.getUint8(0) === packetLayouts.StatusPacket.fixed.version ? "status" : "telemetry");
            if (packetKind === "telemetry") {
                const telemetry = parseDeviceTelemetry(data);
                this.callbacks.telemetry(data, telemetry);
                return;
            }
            const status = decodeStatusPacket(data);
            this.callbacks.status(status);
            if (generation !== this.generation) {
                return;
            }
            const sequence = status.sequence;
            const pending = this.pending.get(sequence);
            if (pending) {
                clearTimeout(pending.timer);
                this.pending.delete(sequence);
                pending.resolve(status);
            }
        }
        catch (error) {
            this.callbacks.failed(error instanceof Error ? error : new Error("機器の通知を受信できませんでした。"));
        }
    }

    /**
     * 生成した要求を現在の経路へ送り、sequence一致のStatusを生成した結果処理へ渡す。
     * 書込み完了と機器ACKは独立して待ち、ACKエラーなら未完了Writeを待たず拒否できる。
     * signal・呼出元/機能/接続の世代は開始前、書込み直前、完了後に共通検査する。
     * 開始済みのネイティブWriteや機器の処理は取り消せず、ACK待ちは応答または期限まで待つ。
     * 期限超過は現接続の終了を要求する。STOP優先とキュー上限はenqueue()だけが管理する。
     */
    exchange<Result>(encode: (sequence: number) => Uint8Array, result: (status: StatusPacket) => Result,
        policy: ControlExchangePolicy, context: ControlCallContext, options?: RpcCallOptions,
        diagnostic?: { operation: string; channel: number; value: number; duration: number }): Promise<Result> {
        const generation = this.generation;
        const transport = this.transport;
        const check = () => {
            options?.signal?.throwIfAborted();
            if (generation !== this.generation || !transport || transport !== this.transport || !transport.connected) {
                throw new RpcError(RpcCode.Unavailable, "機器の接続が切れました。");
            }
            if (options?.isCurrent?.() === false || context.isCurrent?.() === false) {
                throw new DOMException("機器操作を取り消しました。", "AbortError");
            }
        };
        return this.enqueue(async () => {
            check();
            const sequence = this.sequence = this.sequence % controlMaxSequence + 1;
            const bytes = encode(sequence);
            const details = diagnostic ? { ...diagnostic, sequence, transport: transport!.kind } : undefined;
            const ack = new Promise<Result>((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.pending.delete(sequence);
                    const error = new RpcError(RpcCode.DeadlineExceeded, "ESP32の応答がありません。再接続してください。");
                    reject(error);
                    if (generation === this.generation) {
                        this.callbacks.failed(error);
                    }
                }, policy.ioTimeoutMs);
                this.pending.set(sequence, { resolve: status => {
                    try {
                        resolve(result(status));
                    }
                    catch (error) {
                        reject(error);
                    }
                }, reject, timer });
            });
            void ack.catch(() => {
            });
            if (details) {
                console.log("Device servo send", details);
            }
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
            let response: Result;
            try {
                [response] = await Promise.all([ack, write]);
            }
            catch (error) {
                if (details) {
                    console.error("Device servo error", details, error);
                }
                throw error;
            }
            check();
            if (details) {
                console.log("Device servo ACK", details);
            }
            context.accepted?.();
            return response;
        }, policy.priority);
    }

    /** 所有者が渡す生成PINGを1.5秒周期で共通待ち列へ送る。経路交換・切断ではタイマーを解除する。 */
    startHeartbeat(ping: () => Promise<void>): void {
        this.stopHeartbeat();
        const generation = this.generation;
        this.heartbeat = setInterval(() => {
            void ping().catch(error => {
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
