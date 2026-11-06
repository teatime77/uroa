/**
 * Python BLE／Wi-Fiデバッグ通信version=1の中心契約。
 * device-connection.tsが接続世代、control-connection.tsが通常指令と共有する待ち列を所有する。
 * 本ファイルが一覧転送と停止値の復号を行う。
 * ESP32のbytecode_debugger.cppがloop()で要求を処理し、bytecode_vm.cppが停止値を作る。
 *
 * 同じServiceのUUID末尾は既存と共通で、先頭はControl=f3641409(Write with response)、
 * Result=f364140a(Read)、Event=f364140b(Read/Notify)、Data=f364140c(Read)。全パケット20バイト以下。
 * ACKと非同期Eventは別Characteristicに保持し、通知でACKを上書きしない。
 *
 * 整数はlittle endian。Control共通8バイト: version:u8@0=1、op:u8@1、requestId:u16@2、
 * programRevision:u32@4。requestIdは接続内で1から単調増加し、周回前に再接続する。
 * 同じ直前要求の再送はACKを再公開する。GATT Write成功だけを処理完了とは扱わない。
 * op=1 BEGIN: 20バイト、個数:u32@8、一覧CRC32:u32@12、元イメージCRC32:u32@16。
 * op=2 DATA: 14〜20バイト、開始index:u32@8、PC:u16の昇順列@12（最大4個）。
 * op=3 COMMIT: 8バイト。全件・CRC・全PCの命令境界を検証してから全置換する。
 * op=4 STATUS: 8バイト、revision=0。保持イメージのrevision・元CRC・全体長を取得する。
 * op=5 CHUNK: 16バイト、stopId:u32@8、Snapshot内offset:u32@12。
 * op=6 ABORT: 8バイト。未完了一覧だけを破棄する。
 * BEGIN/DATA/COMMITはRunningでは拒否する。0個COMMITで全解除。最大4096個、受信無進捗期限5秒。
 * STATUS以外は現在revision一致を必須とし、同じ接続世代の要求だけを処理する。
 *
 * Resultは20バイト: version:u8@0、op:u8@1、requestId:u16@2、code:u8@4、VM state:u8@5、
 * 予約:u16@6=0、revision:u32@8、value:u32@12、extra:u32@16。
 * STATUSのvalue=元CRC、extra=全体長。DATA/COMMITのvalue=受信／確定個数。
 * CHUNKのvalue=選択offset、extra=Dataの長さ1〜20。Data設定後にACKを公開し、
 * ACK確認後にDataをReadする。論理要求は直列化し、別チャンク選択を途中へ挟まない。
 * code: 0成功、1形式、2順序、3範囲、4メモリ、5CRC、6不正PC等、7実行中／混雑、8世代／停止失効、9期限。
 *
 * Eventは20バイト: version:u8@0=1、state:u8@1、code:u8@2、予約:u8@3=0、stopId:u32@4、
 * revision:u32@8、Snapshot長:u32@12、Snapshot CRC32:u32@16。stateは既存0〜4、Paused=5。
 * Paused到達時に自動取得する。Notify欠落は1秒ごとのEvent Readで回復する。
 * 購読には停止値の全受信前にPausedのEventを渡し、PythonBlockが最大化と取得中の表示を行う。
 * Halted/Stopped/ErrorもEventとして渡す。Start/Stop時は前回のEvent比較をリセットする。
 * stopIdはデバイス稼働中に再利用しない。非PausedではstopId/長さ/CRCは0。
 * CRCは既存bytecode-transfer.tsのCRC-32/ISO-HDLCと同一。Snapshot上限は256KiB。
 *
 * Snapshotヘッダー24バイト: version:u8@0=2、reason:u8@1=1(ブレークポイント)、slotBytes:u16@2=8、
 * PC:u32@4、BP:u32@8、SP:u32@12、大域個数:u32@16、スタック個数:u32@20(=SP)。
 * 続いて大域[0,count)、スタック[0,SP)。各スロット8バイト: tag:u8@0、予約:u8@1=0、
 * classId:u16@2(Object以外0)、payload:u32@4。tagは0未初期化、1int32、2binary32、3None、
 * 4ReturnPc、5SavedBp、6String ID、7Object handle。未初期化/Noneのpayloadは0。
 * スロット列の後に文字列数:u32、続いて各文字列のID:u32、UTF-8バイト長:u32、本体（終端・パディングなし）。
 * 大域→スタック順で参照されるString IDの初出順に1回だけ送り、未参照ID・欠落・重複・不正UTF-8は拒否する。
 * 定数と動的文字列の両方を含む。メモリ不足では明示エラーとし、切り詰めない。
 * 旧Snapshot version=1の受信は維持し、文字列本体がない値は「取得不可」と表示する。
 * 専用フレーム表は送らず、BP+0(ReturnPc)、BP+1(SavedBp)と同一ビルドのCALL PC/関数範囲で復元する。
 * モジュールと最初の関数のBPがともに0でも、所属関数とCALL対応で区別する。
 * 名前・型・行・変数配置はpython/bytecode.tsが同一コンパイルで作り、python/debugger-view.tsが表示する。
 *
 * 一覧は命令列先頭=0のPCであり、ソース行番号ではない。検証済み命令のbit7だけをESP32で変更し、
 * 元イメージのCRC・programRevisionは維持する。切断・Wi-Fi切替でフラグを解除する。
 * SnapshotはPaused中だけ有効。Stop・Start・プログラム置換・接続世代変更で無効化し、
 * 全チャンク・CRC・構造を検証するまで公開しない。大域・スタック・PC/BP/SPは同じ停止の値。
 * ブレークポイント停止はVMだけを止め、機器出力・補間は維持する。StopとPINGは既存経路を維持する。
 * チャンクごとに共通待ち列を返し、長いSnapshotでPINGを塞がない。再開・ステップは未実装。
 */
import { bytecodeCrc32, type BytecodeReceipt } from "./bytecode-transfer";

export const debugProtocol = {
    version: 1, maxBreakpoints: 4096, maxSnapshotLength: 256 * 1024, paused: 5, timeoutMs: 2500,
    errors: ["成功", "形式不正", "順序不正", "範囲外", "メモリ不足", "CRC不一致", "不正なブレークポイント",
        "VM実行中または通信混雑", "プログラムまたは停止情報が失効", "受信期限切れ"]
} as const;

/**
 * 通信経路から独立した要求・ACK・停止Event・選択Dataの窓口。
 * BLEは従来の4 Characteristic、Wi-FiはPOST /debug-controlまたはWS op=debug-controlと、
 * GET /debug-result、/debug-event、/debug-dataを使う。各バイト形式は同じで20バイト以下。
 * Wi-FiのReadはWS利用時もHTTPを使い、1秒周期で停止Eventを確認する。センサー通知へ混在させない。
 * Readの応答と署名形式はbytecode-transfer.tsのResultと同じで、署名のresourceだけを各窓口名にする。
 * 要求はsession|counter|path|payload、応答はsession|resource|counter|dataをHMACで検証する。
 * ACK・Event・DataはESP32で別々に保持し、同一接続内でも通知によってACKを上書きしない。
 * BLE Notifyは読出しの契機に使い、どちらの経路もEvent Readで最新の停止状態を確定する。
 * 切断・切替では接続の経路と世代を組で照合し、旧要求・Snapshot・要求番号を失効させる。
 * プログラム世代・stopId・PC・CRC・Data選択とACK照合は共通のPythonDebugTransportが担当する。
 * 再開・ステップ・F9の行番号からPCへの変換を追加する変更ではない。
 */
export interface DebugChannel {
    writeControl(data: Uint8Array): Promise<void>;
    readResult(): Promise<DataView>;
    readEvent(): Promise<DataView>;
    readData(): Promise<DataView>;
    subscribeEvents?(listener: () => void): () => void;
    startEvents?(): Promise<unknown>;
}

export interface DebugEvent {
    state: number;
    code: number;
    stopId: number;
    revision: number;
    byteLength: number;
    crc32: number;
}

/** 数値は復号済み、文字列はID、Objectは不透明ハンドル。管理値も通常の変数表示とは区別する。 */
export interface DebugValue {
    tag: number;
    classId: number;
    value: number | null | undefined;
}

export interface DebugSnapshot {
    stopId: number;
    revision: number;
    pc: number;
    bp: number;
    sp: number;
    globals: readonly DebugValue[];
    stack: readonly DebugValue[];
    strings: ReadonlyMap<number, string>;
}

type RunTransport = <T>(operation: () => Promise<T>) => Promise<T>;

/** パケットの共通版・長さ・予約領域を先に検査する。 */
function parseEvent(view: DataView): DebugEvent {
    if (view.byteLength !== 20 || view.getUint8(0) !== 1 || view.getUint8(1) > 5 || view.getUint8(2) > 9
        || view.getUint8(3) !== 0) {
        throw new Error("デバッグ停止通知の形式が不正です。");
    }
    const event = { state: view.getUint8(1), code: view.getUint8(2), stopId: view.getUint32(4, true),
        revision: view.getUint32(8, true), byteLength: view.getUint32(12, true), crc32: view.getUint32(16, true) };
    if (event.state === 5 && event.code === 0 && (event.stopId === 0 || event.revision === 0
        || event.byteLength < 24 || event.byteLength > debugProtocol.maxSnapshotLength)
        || event.state !== 5 && (event.stopId !== 0 || event.byteLength !== 0 || event.crc32 !== 0)) {
        throw new Error("デバッグ停止通知の範囲が不正です。");
    }
    return event;
}

/** 全体CRCとスロットのタグ・範囲を検証してから利用者へ返す。 */
function decodeSnapshot(bytes: Uint8Array, event: DebugEvent): DebugSnapshot {
    if (bytes.length !== event.byteLength || bytecodeCrc32(bytes) !== event.crc32) {
        throw new Error("デバッグ停止データのCRCが一致しません。");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const pc = view.getUint32(4, true);
    const bp = view.getUint32(8, true);
    const sp = view.getUint32(12, true);
    const globals = view.getUint32(16, true);
    const stack = view.getUint32(20, true);
    const version = view.getUint8(0);
    const valuesEnd = 24 + 8 * (globals + stack);
    if ((version !== 1 && version !== 2) || view.getUint8(1) !== 1 || view.getUint16(2, true) !== 8
        || pc > 65535 || globals > 1024 || sp > 1024 || stack !== sp || bp > sp
        || (version === 1 ? bytes.length !== valuesEnd : bytes.length < valuesEnd + 4)) {
        throw new Error("デバッグ停止データのヘッダーが不正です。");
    }
    const values: DebugValue[] = [];
    for (let index = 0; index < globals + stack; index++) {
        const offset = 24 + index * 8;
        const tag = view.getUint8(offset);
        const classId = view.getUint16(offset + 2, true);
        const payload = view.getUint32(offset + 4, true);
        if (tag > 7 || view.getUint8(offset + 1) !== 0 || (tag === 7 ? classId === 0 : classId !== 0)
            || (tag === 0 || tag === 3) && payload !== 0 || index < globals && (tag === 4 || tag === 5)
            || tag === 4 && payload > 65535 || tag === 5 && payload > sp) {
            throw new Error("デバッグ停止データの値が不正です。");
        }
        const value = tag === 0 ? undefined : tag === 3 ? null : tag === 1 ? view.getInt32(offset + 4, true)
            : tag === 2 ? view.getFloat32(offset + 4, true) : payload;
        if (typeof value === "number" && !Number.isFinite(value)) {
            throw new Error("デバッグ停止データの数値が不正です。");
        }
        values.push({ tag, classId, value });
    }
    const strings = new Map<number, string>();
    if (version === 2) {
        const ids = [...new Set(values.filter(value => value.tag === 6).map(value => value.value as number))];
        const count = view.getUint32(valuesEnd, true);
        if (count !== ids.length) {
            throw new Error("停止データの文字列数が不正です。");
        }
        let offset = valuesEnd + 4;
        const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
        for (const id of ids) {
            if (offset + 8 > bytes.length || view.getUint32(offset, true) !== id) {
                throw new Error("停止データの文字列IDが不正です。");
            }
            const length = view.getUint32(offset + 4, true);
            offset += 8;
            if (length > bytes.length - offset) {
                throw new Error("停止データの文字列長が不正です。");
            }
            strings.set(id, decoder.decode(bytes.subarray(offset, offset + length)));
            offset += length;
        }
        if (offset !== bytes.length) {
            throw new Error("停止データの末尾に余分なデータがあります。");
        }
    }
    return { stopId: event.stopId, revision: event.revision, pc, bp, sp,
        globals: values.slice(0, globals), stack: values.slice(globals), strings };
}

/** 接続単位の通信。GATTオブジェクト・Snapshotは保存せず、dispose()後の結果は破棄する。 */
export class PythonDebugTransport {
    private revision = 0;
    private disposed = false;
    private epoch = 0;
    private tail: Promise<unknown> = Promise.resolve();
    private timer?: ReturnType<typeof setInterval>;
    private polling = false;
    private event?: DebugEvent;
    private downloading?: number;
    private completed?: number;
    private ignored?: number;
    private releaseEvents?: () => void;

    constructor(private readonly channel: DebugChannel,
        private readonly run: RunTransport, private readonly current: () => void,
        private readonly nextRequestId: () => number,
        private readonly publish: (snapshot?: DebugSnapshot, error?: Error, event?: DebugEvent) => void) {
    }

    private check(signal?: AbortSignal): void {
        signal?.throwIfAborted();
        this.current();
        if (this.disposed) {
            throw new DOMException("デバッグ通信を取り消しました。", "AbortError");
        }
    }

    /** 同じControl/Result/Dataを使う要求を直列化する。PING用の共通待ち列は操作ごとに返す。 */
    private request(op: number, revision: number, body = new Uint8Array(), signal?: AbortSignal,
        readData = false): Promise<{ revision: number; value: number; extra: number; data?: Uint8Array }> {
        const task = this.tail.catch(() => {}).then(async () => {
            this.check(signal);
            const id = this.nextRequestId();
            const packet = new Uint8Array(8 + body.length);
            const view = new DataView(packet.buffer);
            view.setUint8(0, 1);
            view.setUint8(1, op);
            view.setUint16(2, id, true);
            view.setUint32(4, revision, true);
            packet.set(body, 8);
            await this.run(() => this.channel.writeControl(packet));
            const deadline = performance.now() + debugProtocol.timeoutMs;
            while (performance.now() < deadline) {
                this.check(signal);
                const reply = await this.run(() => this.channel.readResult());
                this.check(signal);
                if (reply.byteLength !== 20 || reply.getUint8(0) !== 1 || reply.getUint8(5) > 5
                    || reply.getUint16(6, true) !== 0) {
                    throw new Error("デバッグ受付結果の形式が不正です。");
                }
                if (reply.getUint16(2, true) === id && reply.getUint8(1) === op) {
                    const code = reply.getUint8(4);
                    if (code !== 0) {
                        throw new Error(`デバッグ通信: ${debugProtocol.errors[code] ?? `不明な結果 ${code}`}`);
                    }
                    const response = { revision: reply.getUint32(8, true), value: reply.getUint32(12, true),
                        extra: reply.getUint32(16, true), data: undefined as Uint8Array | undefined };
                    if (op !== 4 && response.revision !== revision) {
                        throw new Error("デバッグ対象のプログラムが変わりました。");
                    }
                    if (readData) {
                        const chunk = await this.run(() => this.channel.readData());
                        response.data = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength).slice();
                    }
                    this.check(signal);
                    return response;
                }
                await new Promise<void>(resolve => setTimeout(resolve, 8));
            }
            throw new Error("デバッグ受付結果がタイムアウトしました。");
        });
        this.tail = task;
        return task;
    }

    /** 元イメージの保持結果と照合し、PC一覧を全置換してから自動受信を開始する。 */
    async sendBreakpoints(receipt: BytecodeReceipt, pcs: readonly number[], signal?: AbortSignal): Promise<void> {
        const sorted = [...new Set(pcs)].sort((a, b) => a - b);
        if (sorted.length > debugProtocol.maxBreakpoints || sorted.some(pc => !Number.isInteger(pc) || pc < 0 || pc > 65535)) {
            throw new RangeError("ブレークポイントは0〜65535の命令PCを最大4096個指定してください。");
        }
        const status = await this.request(4, 0, undefined, signal);
        if (status.revision === 0 || status.value !== receipt.crc32 || status.extra !== receipt.byteLength) {
            throw new Error("保持中のバイトコードとブレークポイントの対象が一致しません。");
        }
        this.revision = status.revision;
        const bytes = new Uint8Array(sorted.length * 2);
        const values = new DataView(bytes.buffer);
        sorted.forEach((pc, index) => values.setUint16(index * 2, pc, true));
        const begin = new Uint8Array(12);
        const header = new DataView(begin.buffer);
        header.setUint32(0, sorted.length, true);
        header.setUint32(4, bytecodeCrc32(bytes), true);
        header.setUint32(8, receipt.crc32, true);
        await this.request(1, this.revision, begin, signal);
        try {
            for (let index = 0; index < sorted.length; index += 4) {
                const part = bytes.slice(index * 2, Math.min(index + 4, sorted.length) * 2);
                const body = new Uint8Array(4 + part.length);
                new DataView(body.buffer).setUint32(0, index, true);
                body.set(part, 4);
                const ack = await this.request(2, this.revision, body, signal);
                if (ack.value !== index + part.length / 2) {
                    throw new Error("ブレークポイントの受付件数が不正です。");
                }
            }
            const ack = await this.request(3, this.revision, undefined, signal);
            if (ack.value !== sorted.length) {
                throw new Error("ブレークポイントの確定件数が不正です。");
            }
        }
        catch (error) {
            // 実行前の部分一覧を残さない。切断時はデバイスの世代変更で破棄される。
            if (!this.disposed) {
                await this.request(6, this.revision).catch(() => undefined);
            }
            throw error;
        }
        if (this.timer === undefined) {
            this.releaseEvents = this.channel.subscribeEvents?.(this.changed);
            if (this.channel.startEvents) {
                await this.run(() => this.channel.startEvents!());
            }
            this.check(signal);
            this.timer = setInterval(() => {
                void this.poll().catch(error => this.fail(error));
            }, 1000);
        }
        await this.poll();
    }

    private fail(error: unknown): void {
        if (!this.disposed && !(error instanceof DOMException && error.name === "AbortError")) {
            this.publish(undefined, error instanceof Error ? error : new Error("デバッグ停止データを取得できませんでした。"), this.event);
        }
    }

    private changed = (): void => {
        // 遅延Notifyは読取りの契機にだけ使い、古いRunning通知で新しい停止値を消さない。
        void this.poll().catch(error => this.fail(error));
    };

    private async poll(): Promise<void> {
        if (this.polling || this.disposed) {
            return;
        }
        this.polling = true;
        const epoch = this.epoch;
        try {
            const value = await this.run(() => this.channel.readEvent());
            this.check();
            if (epoch !== this.epoch) {
                return;
            }
            this.accept(parseEvent(value));
        }
        finally {
            this.polling = false;
        }
    }

    private accept(event: DebugEvent): void {
        if (event.revision !== this.revision || event.state !== debugProtocol.paused) {
            const changed = this.event?.state !== event.state || this.event?.revision !== event.revision
                || this.event?.code !== event.code;
            if (this.event?.state === debugProtocol.paused) {
                this.invalidateSnapshot();
            }
            this.event = event;
            if (changed && event.revision === this.revision) {
                this.publish(undefined, undefined, event);
            }
            return;
        }
        this.event = event;
        if (event.code !== 0) {
            throw new Error(`停止データ取得: ${debugProtocol.errors[event.code]}`);
        }
        if (event.stopId === this.completed || event.stopId === this.downloading || event.stopId === this.ignored) {
            return;
        }
        const epoch = ++this.epoch;
        this.downloading = event.stopId;
        // 最大化と「取得中」の表示は全チャンク受信より先に通知する。部分的な値は公開しない。
        this.publish(undefined, undefined, event);
        void this.download(event, epoch).catch(error => {
            if (this.epoch === epoch) {
                this.fail(error);
            }
        }).finally(() => {
            if (this.epoch === epoch) {
                this.downloading = undefined;
            }
        });
    }

    private async download(event: DebugEvent, epoch: number): Promise<void> {
        const bytes = new Uint8Array(event.byteLength);
        for (let offset = 0; offset < bytes.length;) {
            this.check();
            if (epoch !== this.epoch) {
                return;
            }
            const body = new Uint8Array(8);
            const view = new DataView(body.buffer);
            view.setUint32(0, event.stopId, true);
            view.setUint32(4, offset, true);
            const reply = await this.request(5, event.revision, body, undefined, true);
            const expected = Math.min(20, bytes.length - offset);
            if (reply.value !== offset || reply.extra !== expected || reply.data?.length !== expected) {
                throw new Error("停止データのチャンク位置または長さが不正です。");
            }
            bytes.set(reply.data, offset);
            offset += expected;
        }
        // 最終チャンク後にもデバイスの停止ID・版を照合し、Stop/再開始との競合を検出する。
        const latest = parseEvent(await this.run(() => this.channel.readEvent()));
        this.check();
        if (epoch !== this.epoch) {
            return;
        }
        if (latest.state !== 5 || latest.code !== 0 || latest.stopId !== event.stopId || latest.revision !== event.revision
            || latest.byteLength !== event.byteLength || latest.crc32 !== event.crc32) {
            throw new Error("取得中に停止情報が変わりました。");
        }
        const snapshot = decodeSnapshot(bytes, event);
        this.completed = event.stopId;
        this.publish(snapshot, undefined, event);
    }

    /** Start/Stopで古い値を直ちに消し、同じ停止通知を再取得しない。 */
    invalidateSnapshot(): void {
        this.epoch++;
        this.ignored = this.event?.stopId ?? this.ignored;
        this.event = undefined;
        this.downloading = undefined;
        this.completed = undefined;
        this.publish();
    }

    /** 接続終了時に通知とポーリングを解除する。実行中の通信結果はcheck()で破棄する。 */
    dispose(): void {
        this.disposed = true;
        this.epoch++;
        clearInterval(this.timer);
        this.releaseEvents?.();
        this.releaseEvents = undefined;
    }
}
