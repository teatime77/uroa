/**
 * Python BLE／Wi-Fiデバッグ通信の中心契約。Control/Resultはversion=1、Eventはversion=2。
 * device-connection.tsが接続世代、control-connection.tsが通常指令と共有する待ち列を所有する。
 * 本ファイルが一覧転送と停止値の復号を行う。PythonのStart時の一覧はbytecode-transfer.tsの一括転送に含める。
 * ESP32のbytecode_debugger.cppがloop()で要求を処理し、bytecode_vm.cppが停止値を作る。
 */
import { bytecodeCrc32, type BytecodeReceipt } from "./bytecode-transfer";

/**
 * デバッグ通信の版・上限・結果名と状態番号を共有する定義。
 */
export const debugProtocol = {
    version: 1, eventVersion: 2, snapshotVersion: 6, maxBreakpoints: 4096, maxSnapshotLength: 256 * 1024, paused: 5, timeoutMs: 2500,
    errors: ["成功", "形式不正", "順序不正", "範囲外", "メモリ不足", "CRC不一致", "不正なブレークポイント",
        "VM実行中または通信混雑", "プログラムまたは停止情報が失効", "受信期限切れ"]
} as const;

/**
 * 一時停止からの継続実行・Step Over・Step In・Step Outの操作名。
 */
export type DebugAction = "continue" | "over" | "in" | "out";
/**
 * 再開・3種のステップ操作をControlの操作番号10〜13へ対応付ける表。
 */
const debugActions: Record<DebugAction, number> = { continue: 10, over: 11, in: 12, out: 13 };

/**
 * 通信経路から独立した要求・ACK・停止Event・選択Dataの窓口。
 * BLEは従来の4 Characteristic、Wi-FiはPOST /debug-controlまたはWS op=debug-controlと、
 * GET /debug-result、/debug-event、/debug-dataを使う。各バイト形式は同じで20バイト以下。
 * Wi-FiのReadはWS利用時もHTTPを使い、1秒周期で停止Eventを確認する。センサー通知へ混在させない。
 * Readの応答と署名形式はbytecode-transfer.tsのuploadBytecode()に記したResultと同じで、署名のresourceだけを各窓口名にする。
 * 要求はsession|counter|path|payload、応答はsession|resource|counter|dataをHMACで検証する。
 * ACK・Event・DataはESP32で別々に保持し、同一接続内でも通知によってACKを上書きしない。
 * BLE Notifyは読出しの契機に使い、どちらの経路もEvent Readで最新の停止状態を確定する。
 * 切断・切替では接続の経路と世代を組で照合し、旧要求・Snapshot・要求番号を失効させる。
 * プログラム世代・stopId・PC・CRC・Data選択とACK照合は共通のPythonDebugTransportが担当する。
 * F9の行からPCへの変換はpython/debug-info.tsが担当する。
 *
 * 同じServiceのUUID末尾は既存と共通で、先頭はControl=f3641409(Write with response)、
 * Result=f364140a(Read)、Event=f364140b(Read/Notify)、Data=f364140c(Read)。全パケット20バイト以下。
 * ACKと非同期Eventは別Characteristicに保持し、通知でACKを上書きしない。
 */
export interface DebugChannel {
    /**
     * 20バイト以下のデバッグ要求を専用窓口へ送る。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    writeControl(data: Uint8Array): Promise<void>;
    /**
     * 専用の受付結果を読み取る。書込みの成功とは別に照合する。
     */
    readResult(): Promise<DataView>;
    /**
     * 最新のVM状態を専用Event窓口から読む。
     */
    readEvent(): Promise<DataView>;
    /**
     * 直前のCHUNK要求で選択した停止データを読む。
     */
    readData(): Promise<DataView>;
    /**
     * Event変更の契機を購読し、解除関数を返す。
     *
     * @param listener 変更通知を受け取る処理。
     */
    subscribeEvents?(listener: () => void): () => void;
    /**
     * 利用する経路でEvent通知の受信を開始する。
     */
    startEvents?(): Promise<unknown>;
}

/**
 * 検証済みのVM状態イベント。停止時のSnapshot情報と非停止時の進捗を区別する。
 */
export interface DebugEvent {
    /**
     * 機器またはVMが報告した状態番号・状態値。
     */
    state: number;
    /**
     * 専用の受付結果または停止データ取得の結果コード。
     */
    code: number;
    /**
     * ESP32稼働中に再利用しない停止ID。同じ停止の要求とデータを照合する。
     */
    stopId: number;
    /**
     * ESP32が確定したプログラムを識別する世代番号。
     */
    revision: number;
    /**
     * 保持コードまたは停止データ全体のバイト数。
     */
    byteLength: number;
    /**
     * 対応するコードまたは停止データ全体のCRC-32。
     */
    crc32: number;
    /**
     * 非Paused時に受け取る実行命令数。native呼出しの再試行も含む。
     */
    instructions?: number;
    /**
     * 命令列先頭を0とする、VMの現在の命令位置。
     */
    pc?: number;
    /**
     * Error状態のVM実行エラー番号。取得側の結果コードとは区別する。
     */
    vmError?: number;
    /**
     * Error状態で失敗した命令の位置。
     */
    errorPc?: number;
}

/** 数値は復号済み、文字列はID、Objectは不透明ハンドル。管理値も通常の変数表示とは区別する。 */
export interface DebugValue {
    /**
     * 停止スロットの値種別。管理値・String ID・機器ハンドルを区別する。
     */
    tag: number;
    /**
     * tag=7の機器またはtag=8のGC本体の型ID。それ以外では0。
     */
    classId: number;
    /**
     * 復号済み数値、文字列ID、機器ハンドル。未初期化はundefined、Noneはnull、GC参照は0。
     */
    value: number | null | undefined;
}

/**
 * 同一停止に属するPC・フレーム・全値スロットと文字列本体。
 */
export interface DebugSnapshot {
    /**
     * ESP32稼働中に再利用しない停止ID。同じ停止の要求とデータを照合する。
     */
    stopId: number;
    /**
     * ESP32が確定したプログラムを識別する世代番号。
     */
    revision: number;
    /**
     * 停止理由。1は行ブレークポイント、2はステップ。
     */
    reason: 1 | 2;
    /**
     * 命令列先頭を0とする、VMの現在の命令位置。
     */
    pc: number;
    /**
     * 停止時のフレーム先頭を指す値スタックの添字。
     */
    bp: number;
    /**
     * 停止時の値スタック使用末尾の直後。
     */
    sp: number;
    /**
     * 停止時の大域スロットを宣言配置の順で保持した値列。
     */
    globals: readonly DebugValue[];
    /**
     * 停止時の使用スタック全体。管理値と一時値も含む。
     */
    stack: readonly DebugValue[];
    /**
     * 停止スロットから参照されるString IDと検証済みUTF-8文字列の対応。
     */
    strings: ReadonlyMap<number, string>;
}

/**
 * 共通待ち列・期限・接続照合を通して一つの通信操作を実行する入口。
 */
type RunTransport = <T>(operation: () => Promise<T>) => Promise<T>;

/**
 * Event version=2の長さ・状態別フィールドを検証し、非Pausedの進捗をSnapshotと区別する。
 *
 * Eventは20バイト: version:u8@0=2、state:u8@1、code:u8@2、VM error:u8@3、stopId/errorPc:u32@4、
 * revision:u32@8、Snapshot長:u32@12、Snapshot CRC32:u32@16。stateは既存0〜4、Paused=5。
 * Paused到達時に自動取得する。Notify欠落は1秒ごとのEvent Readで回復する。
 * 購読には停止値の全受信前にPausedのEventを渡し、PythonBlockが最大化と取得中の表示を行う。
 * Halted/Stopped/ErrorもEventとして渡す。Start/Stop時は前回のEvent比較をリセットする。
 * Pausedでは@3=0、@4=stopId、@12=Snapshot長、@16=Snapshot CRC32として扱う。
 * 非Pausedでは@12=実行命令数（native再試行を含む）、@16=現在PC。Errorだけ@3=VMエラー番号、@4=失敗PC。
 * 非Error・非Pausedの@3/@4は0。SnapshotのcodeとVMエラー番号は別の名前空間。
 * VMエラーは0～23。20=配列添字・uint8範囲、21=shape・サイズ、22=未対応の配列オプション、23=Noneへのアクセス。
 * RunningのPC・命令数は最大1秒に1回、状態・世代変更は即時公開する。実行中のSnapshot取得は行わない。
 * PythonBlockが実行状態とPC・命令数を表示し、DeviceConnectionが[Python VM]へ同じ情報を出力する。
 * Eventはversion=2だけを受理し、旧版は形式エラーとする。Control/Resultのversion=1は現行のまま。
 * stopIdはデバイス稼働中に再利用しない。開始成功Resultを実行状態・進捗として扱わない。
 * CRCは既存bytecode-transfer.tsのCRC-32/ISO-HDLCと同一。Snapshot上限は256KiB。
 * @param view Event全20バイト。同一接続のReadから取得する。
 * @returns 検証済みの実行状態または停止通知。
 * @throws {Error} 版・値・予約領域・停止情報の範囲が不正な場合。
 */
function parseEvent(view: DataView): DebugEvent {
    if (view.byteLength !== 20 || view.getUint8(0) !== debugProtocol.eventVersion || view.getUint8(1) > 5 || view.getUint8(2) > 9) {
        throw new Error("デバッグ停止通知の形式が不正です。");
    }
    const state = view.getUint8(1);
    const paused = state === 5;
    const progress = !paused;
    const vmError = view.getUint8(3);
    if ((!progress && vmError !== 0) || (progress && (vmError > 23 || state !== 4 && vmError !== 0))
        || (progress && state !== 4 && view.getUint32(4, true) !== 0)) {
        throw new Error("デバッグ通知のVMエラー情報が不正です。");
    }
    const event: DebugEvent = {
        state, code: view.getUint8(2), revision: view.getUint32(8, true),
        stopId: progress ? 0 : view.getUint32(4, true),
        byteLength: progress ? 0 : view.getUint32(12, true),
        crc32: progress ? 0 : view.getUint32(16, true),
        instructions: progress ? view.getUint32(12, true) : undefined,
        pc: progress ? view.getUint32(16, true) : undefined,
        vmError: progress ? vmError : undefined,
        errorPc: progress && state === 4 ? view.getUint32(4, true) : undefined,
    };
    if (paused && event.code === 0 && (event.stopId === 0 || event.revision === 0
        || event.byteLength < 28 || event.byteLength > debugProtocol.maxSnapshotLength)
        || !paused && (event.stopId !== 0 || event.byteLength !== 0 || event.crc32 !== 0)) {
        throw new Error("デバッグ停止通知の範囲が不正です。");
    }
    return event;
}

/**
 * Snapshot version=6の値スロットと直接参照する文字列だけを復号する。
 * ヘッダー24バイトはversion:u8@0=6、reason:u8@1、slotBytes:u16@2=8、
 * PC:u32@4、BP:u32@8、SP:u32@12、大域数:u32@16、スタック数:u32@20(=SP)。reasonは1=行停止、2=ステップ。
 * 続いて大域・スタックの8バイトValue、文字列数:u32、各ID:u32・長さ:u32・UTF-8を置く。
 * Valueはtag:u8@0、予約0:u8@1、classId:u16@2、payload:u32@4。tagは0=未初期化、1=int32、
 * 2=float32、3=None、4=ReturnPc、5=SavedBp、6=String ID、7=機器ハンドル、8=GC参照。
 * classIdはtag7/8だけ非0。tag0/3のpayloadは0。大域に管理値を含めず、浮動小数は有限値だけを許す。
 * 直接参照する定数・動的文字列の各IDを1回だけ送り、欠落・重複・未参照ID・不正UTF-8は拒否する。
 * tag=8はGC本体への不透明な参照でclassIdだけを送り、payload=0。本体ID・フィールド・配列要素は送らない。
 * 既存の数値・文字列・フレーム表示は維持し、GC用のデバッグデータを保持しない。
 * BPチェーンと同一ビルドのCALL・関数範囲からフレームを復元する。最小長28バイト、上限256KiB。
 * @param bytes 同一停止の全データ。
 * @param event 長さとCRCを照合する停止通知。
 * @returns 検証済みの値スロットと文字列。
 * @throws {Error} 版・タグ・型・範囲・CRCが不正な場合。
 */
function decodeSnapshot(bytes: Uint8Array, event: DebugEvent): DebugSnapshot {
    if (bytes.length < 28 || bytes.length !== event.byteLength || bytecodeCrc32(bytes) !== event.crc32) {
        throw new Error("デバッグ停止データのCRCが一致しません。");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const pc = view.getUint32(4, true);
    const bp = view.getUint32(8, true);
    const sp = view.getUint32(12, true);
    const globals = view.getUint32(16, true);
    const stack = view.getUint32(20, true);
    const valuesEnd = 24 + 8 * (globals + stack);
    const reason = view.getUint8(1);
    if (view.getUint8(0) !== debugProtocol.snapshotVersion || (reason !== 1 && reason !== 2) || view.getUint16(2, true) !== 8
        || pc > 65535 || globals > 1024 || sp > 1024 || stack !== sp || bp > sp
        || bytes.length < valuesEnd + 4) {
        throw new Error("デバッグ停止データのヘッダーが不正です。");
    }
    /**
     * 値スロットの8バイトを検証する。
     * @param offset レコード先頭。
     * @param management スタック管理値を許可するか。
     * @returns 検証済みの値。
     * @throws {Error} タグ・予約値・型ID・数値が不正な場合。
     */
    const readValue = (offset: number, management: boolean): DebugValue => {
        const tag = view.getUint8(offset);
        const classId = view.getUint16(offset + 2, true);
        const payload = view.getUint32(offset + 4, true);
        if (tag > 8 || view.getUint8(offset + 1) !== 0 || (tag === 7 || tag === 8 ? classId === 0 : classId !== 0)
            || tag === 8 && payload !== 0
            || (tag === 0 || tag === 3) && payload !== 0 || !management && (tag === 4 || tag === 5)
            || tag === 4 && payload > 65535 || tag === 5 && payload > sp) {
            throw new Error("デバッグ停止データの値が不正です。");
        }
        const value = tag === 0 ? undefined : tag === 3 ? null : tag === 1 ? view.getInt32(offset + 4, true)
            : tag === 2 ? view.getFloat32(offset + 4, true) : payload;
        if (typeof value === "number" && !Number.isFinite(value)) {
            throw new Error("デバッグ停止データの数値が不正です。");
        }
        return { tag, classId, value };
    };
    const values: DebugValue[] = [];
    for (let index = 0; index < globals + stack; index++) {
        values.push(readValue(24 + index * 8, index >= globals));
    }
    const strings = new Map<number, string>();
    const count = view.getUint32(valuesEnd, true);
    if (count > Math.floor((bytes.length - valuesEnd - 4) / 8)) {
        throw new Error("停止データの文字列数が不正です。");
    }
    let offset = valuesEnd + 4;
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    for (let index = 0; index < count; index++) {
        if (offset + 8 > bytes.length) {
            throw new Error("停止データの文字列IDが不正です。");
        }
        const id = view.getUint32(offset, true);
        if (strings.has(id)) {
            throw new Error("停止データの文字列IDが重複しています。");
        }
        const length = view.getUint32(offset + 4, true);
        offset += 8;
        if (length > bytes.length - offset) {
            throw new Error("停止データの文字列長が不正です。");
        }
        strings.set(id, decoder.decode(bytes.subarray(offset, offset + length)));
        offset += length;
    }
    const ids = new Set(values.filter(value => value.tag === 6).map(value => Number(value.value)));
    if (strings.size !== ids.size || [...ids].some(id => !strings.has(id))) {
        throw new Error("停止データの文字列が一致しません。");
    }
    if (offset !== bytes.length) {
        throw new Error("停止データの末尾に余分なデータがあります。");
    }

    return { stopId: event.stopId, revision: event.revision, reason, pc, bp, sp,
        globals: values.slice(0, globals), stack: values.slice(globals), strings };
}

/** 接続単位の通信。GATTオブジェクト・Snapshotは保存せず、dispose()後の結果は破棄する。 */
export class PythonDebugTransport {
    /**
     * ESP32が確定したプログラムを識別する世代番号。
     */
    private revision = 0;
    /**
     * 切断・破棄後の要求や結果反映を拒否する状態。
     */
    private disposed = false;
    /**
     * 停止情報を失効させる受信世代。古いReadや取得中の結果を破棄する。
     */
    private epoch = 0;
    /**
     * 通信要求を直列化する待ち列の末尾Promise。
     */
    private tail: Promise<unknown> = Promise.resolve();
    /**
     * 期限監視または定期監視に使うタイマーの予約。
     */
    private timer?: ReturnType<typeof setInterval>;
    /**
     * 状態EventのReadが進行中かを示す重複取得防止フラグ。
     */
    private polling = false;
    /**
     * 最後に受理した検証済みのVM状態イベント。
     */
    private event?: DebugEvent;
    /**
     * 現在全チャンクを取得している停止ID。
     */
    private downloading?: number;
    /**
     * 全件・CRC・構造を検証済みの停止ID。
     */
    private completed?: number;
    /**
     * 再開操作等で失効させ、遅延通知で再取得しない停止ID。
     */
    private ignored?: number;
    /**
     * BLE等のEvent変更通知の購読を解除する関数。
     */
    private releaseEvents?: () => void;
    /**
     * 再開・ステップ操作のACKを待っている状態。
     */
    private executing = false;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param channel 操作対象のサーボCH番号。
     */
    constructor(/** 現在の経路別のデバッグ通信窓口。 */ private readonly channel: DebugChannel,
        /**
         * 通常指令と共有する待ち列で一つの通信処理を実行する関数。
         */
        private readonly run: RunTransport, /** 所有元の接続とプログラムの有効性を照合する処理。 */ private readonly current: () => void,
        /**
         * 現在の接続で非再利用の要求IDを割り当てる処理。
         */
        private readonly nextRequestId: () => number,
        /**
         * 停止値・取得エラー・VM状態を所有元へ通知する処理。
         */
        private readonly publish: (snapshot?: DebugSnapshot, error?: Error, event?: DebugEvent) => void) {
    }

    /**
     * 取消・破棄と所有元の世代を照合し、無効なら通信を続行しない。
     *
     * @param signal 処理を取り消すシグナル。
     */
    private check(signal?: AbortSignal): void {
        signal?.throwIfAborted();
        this.current();
        if (this.disposed) {
            throw new DOMException("デバッグ通信を取り消しました。", "AbortError");
        }
    }

    /**
     * 同じControl/Result/Dataを使う要求を直列化する。PING用の共通待ち列は操作ごとに返す。
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
     * op=7/8/9 POINTS_BEGIN/DATA/COMMIT: 1/2/3と同じ形式で、ステップ用PC表を別に全置換する。
     * ステップ用は最大65536点。Pythonの文開始・条件評価・関数入口・暗黙return前を同一生成から送る。
     * VMは1PC=1bitで保持する。CALL継続は表へ含めず、In/Overで文の途中に停止しない。
     * op=10 CONTINUE、11 OVER、12 IN、13 OUT: 12バイト、現在のstopId:u32@8。
     * PausedかつSnapshot/世代/stopId一致、一覧受信中でない場合だけ受け付け、Result.valueで消費したstopIdを返す。
     * 成功後は旧Snapshotを破棄する。同じ直前requestId・内容の再送は再実行せず同じACKを返す。
     * 古いstopIdの操作は再開後や別の停止へ適用しない。モジュールのOUTは拒否する。
     * 両一覧のBEGIN/DATA/COMMITはRunningでは拒否する。0個COMMITでその表を全解除。
     * ブレークポイントは最大4096個、ステップ用は最大65536個、受信無進捗期限5秒。
     * STATUS以外は現在revision一致を必須とし、同じ接続世代の要求だけを処理する。
     *
     * Resultは20バイト: version:u8@0、op:u8@1、requestId:u16@2、code:u8@4、VM state:u8@5、
     * 予約:u16@6=0、revision:u32@8、value:u32@12、extra:u32@16。
     * STATUSのvalue=元CRC、extra=全体長。DATA/COMMITのvalue=受信／確定個数。
     * CHUNKのvalue=選択offset、extra=Dataの長さ1〜20。Data設定後にACKを公開し、
     * ACK確認後にDataをReadする。論理要求は直列化し、別チャンク選択を途中へ挟まない。
     * code: 0成功、1形式、2順序、3範囲、4メモリ、5CRC、6不正PC等、7実行中／混雑、8世代／停止失効、9期限。
     */
    private request(op: number, revision: number, body = new Uint8Array(), signal?: AbortSignal,
        readData = false): Promise<{ /** ESP32が確定したプログラムを識別する世代番号。 */ revision: number; /** 通信応答の操作別の値。 */ value: number; /** 通信応答の操作別の補助値。 */ extra: number; /** コピー済みの通信データ。 */ data?: Uint8Array }> {
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
            const write = () => {
                this.check(signal);
                return this.channel.writeControl(packet);
            };
            await this.run(write);
            const deadline = performance.now() + debugProtocol.timeoutMs;
            let retryAt = performance.now() + 400;
            while (performance.now() < deadline) {
                this.check(signal);
                const reply = await this.run(() => this.channel.readResult());
                this.check(signal);
                if (reply.byteLength !== 20 || reply.getUint8(0) !== 1 || reply.getUint8(5) > 5
                    || reply.getUint16(6, true) !== 0) {
                    throw new Error("デバッグ受付結果の形式が不正です。");
                }
                if (performance.now() >= retryAt) {
                    // 同じ要求番号・内容を再送する。VM操作もデバイスの直前ACK再公開で二重実行しない。
                    await this.run(write);
                    retryAt = performance.now() + 400;
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

    /**
     * 1/2/3と7/8/9の共通段階転送。どちらも確定まで部分一覧を実行へ使わない。
     *
     * 一覧は命令列先頭=0のPCであり、ソース行番号ではない。検証済み命令のbit7だけをESP32で変更し、
     * 元イメージのCRC・programRevisionは維持する。切断・Wi-Fi切替でフラグを解除する。
     */
    private async sendPcList(receipt: BytecodeReceipt, pcs: readonly number[], points: boolean, signal?: AbortSignal): Promise<void> {
        const sorted = [...new Set(pcs)].sort((a, b) => a - b);
        if (sorted.length > (points ? 65536 : debugProtocol.maxBreakpoints)
            || sorted.some(pc => !Number.isInteger(pc) || pc < 0 || pc > 65535)) {
            throw new RangeError("デバッグ用PC一覧の範囲または個数が不正です。");
        }
        const base = points ? 6 : 0;
        const bytes = new Uint8Array(sorted.length * 2);
        const values = new DataView(bytes.buffer);
        sorted.forEach((pc, index) => values.setUint16(index * 2, pc, true));
        const begin = new Uint8Array(12);
        const header = new DataView(begin.buffer);
        header.setUint32(0, sorted.length, true);
        header.setUint32(4, bytecodeCrc32(bytes), true);
        header.setUint32(8, receipt.crc32, true);
        await this.request(base + 1, this.revision, begin, signal);
        try {
            for (let index = 0; index < sorted.length; index += 4) {
                const part = bytes.slice(index * 2, Math.min(index + 4, sorted.length) * 2);
                const body = new Uint8Array(4 + part.length);
                new DataView(body.buffer).setUint32(0, index, true);
                body.set(part, 4);
                const ack = await this.request(base + 2, this.revision, body, signal);
                if (ack.value !== index + part.length / 2) {
                    throw new Error("ブレークポイントの受付件数が不正です。");
                }
            }
            const ack = await this.request(base + 3, this.revision, undefined, signal);
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
    }

    /** 元イメージと照合し、ブレークポイントと任意のステップ表を確定してから自動受信を開始する。 */
    async sendBreakpoints(receipt: BytecodeReceipt, pcs: readonly number[], signal?: AbortSignal,
        stepPcs?: readonly number[]): Promise<void> {
        const status = await this.request(4, 0, undefined, signal);
        if (status.revision === 0 || status.value !== receipt.crc32 || status.extra !== receipt.byteLength) {
            throw new Error("保持中のバイトコードとデバッグ対象が一致しません。");
        }
        this.revision = status.revision;
        await this.sendPcList(receipt, pcs, false, signal);
        if (stepPcs !== undefined) {
            await this.sendPcList(receipt, stepPcs, true, signal);
        }
        await this.monitor(signal);
    }

    /** 一括転送Resultの世代を採用し、PC一覧を再送せず終了・停止・実行時エラーを監視する。 */
    async observeDeployment(receipt: BytecodeReceipt, signal?: AbortSignal): Promise<void> {
        this.check(signal);
        if (!receipt.revision) {
            throw new Error("一括転送のプログラム世代がありません。");
        }
        this.revision = receipt.revision;
        await this.monitor(signal);
    }

    /** 接続後の状態Read/Notifyを開始する。開始直後に終了・Pausedとなった場合も最新状態を読む。 */
    private async monitor(signal?: AbortSignal): Promise<void> {
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

    /**
     * 全受信済みの現在停止だけを操作する。送信開始時に旧値を失効させ、ACK後も新しいEventを取得する。
     *
     * チャンクごとに共通待ち列を返し、長いSnapshotでPINGを塞がない。
     * Inは次の停止点または現在フレームの復帰直後、Overは同じフレームの次の停止点または復帰直後、
     * Outは現在フレームの復帰直後に止める。フレームIDと深さで再帰を区別し、閲覧中のフレームには依存しない。
     * 有効ブレークポイントを優先し、停止で保留ステップを完了とする。HALTは終了、ネイティブは内部へ入らず完了を待つ。
     */
    async execute(action: DebugAction, snapshot: DebugSnapshot, signal?: AbortSignal): Promise<void> {
        this.check(signal);
        if (this.executing || snapshot.revision !== this.revision || snapshot.stopId !== this.completed
            || snapshot.stopId !== this.event?.stopId || this.event.state !== 5 || this.event.code !== 0) {
            throw new Error("最新の停止データを取得してから操作してください。");
        }
        this.executing = true;
        this.invalidateSnapshot();
        const body = new Uint8Array(4);
        new DataView(body.buffer).setUint32(0, snapshot.stopId, true);
        try {
            const ack = await this.request(debugActions[action], this.revision, body, signal);
            if (ack.value !== snapshot.stopId) {
                throw new Error("デバッグ操作の停止IDが一致しません。");
            }
        }
        catch (error) {
            // ACKだけが失われた場合も、現在のEventから実際の停止・実行状態を復旧する。
            this.ignored = undefined;
            throw error;
        }
        finally {
            this.executing = false;
            this.event = undefined;
            if (!signal?.aborted) {
                await this.poll().catch(error => this.fail(error));
            }
        }
    }

    /**
     * 有効な接続の取得エラーを通知し、次回の成功で停止値を再取得できるようにする。
     */
    private fail(error: unknown): void {
        if (!this.disposed && !(error instanceof DOMException && error.name === "AbortError")) {
            // 取得済み停止のEvent Read失敗でも、次回の成功時に全データを再取得して表示を復旧する。
            this.completed = undefined;
            this.publish(undefined, error instanceof Error ? error : new Error("デバッグ停止データを取得できませんでした。"), this.event);
        }
    }

    /**
     * 通知内容を直接採用せず、最新EventのReadを要求するイベントハンドラー。
     */
    private changed = (): void => {
        // 遅延Notifyは読取りの契機にだけ使い、古いRunning通知で新しい停止値を消さない。
        void this.poll().catch(error => this.fail(error));
    };

    /**
     * 重複と再開操作中のReadを避け、現世代のEventだけを受理する。
     */
    private async poll(): Promise<void> {
        if (this.polling || this.disposed || this.executing) {
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

    /**
     * Eventの状態・世代・停止IDから表示と停止値取得の開始・失効を決める。
     *
     * @param event ブラウザーまたは通信元のイベント。
     */
    private accept(event: DebugEvent): void {
        if (event.revision !== this.revision || event.state !== debugProtocol.paused) {
            const changed = this.event?.state !== event.state || this.event?.revision !== event.revision
                || this.event?.code !== event.code || this.event?.pc !== event.pc
                || this.event?.instructions !== event.instructions || this.event?.vmError !== event.vmError
                || this.event?.errorPc !== event.errorPc;
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

    /**
     * SnapshotはPaused中だけ有効。Stop・Start・プログラム置換・接続世代変更で無効化し、
     * 全チャンク・CRC・構造を検証するまで公開しない。大域・スタック・PC/BP/SPは同じ停止の値。
     * ブレークポイント停止はVMだけを止め、機器出力・補間は維持する。StopとPINGは既存経路を維持する。
     * 再開は現在の到達だけを消費し、ループの次周は同じPCでも停止する。NativePendingの再試行は到達に数えない。
     */
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
