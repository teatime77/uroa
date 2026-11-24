/**
 * Python一括転送version=2の中心契約。バイナリversion=3だけを扱う。形式はpython/bytecode.tsを参照する。
 * control-connection.tsがキュー・期限・計測、device-connection.tsが所有権・表示・監視、
 * python-block.tsが同一生成のコードとPC一覧、ESP32のbytecode_receiver.cppが検証、main.cppが開始を担当する。
 */
import {
    bytecodeFunctionRecordLength, bytecodeHeaderLength, bytecodeMaxLength,
    bytecodeSignature, bytecodeStringRecordLength, bytecodeVersion
} from "../python/bytecode.js";

/** 一括転送の上限。BLEの実サイズはResultから決定する。 */
export const bytecodeTransfer = {
    version: 2, maxLength: bytecodeMaxLength, packetLength: 1024, headerLength: 10,
    resultLength: 20, timeoutMs: 2500, begin: 1, data: 2, commit: 3, abort: 4,
    receiving: 1, ready: 2, started: 4,
} as const;

/** 配送経路。packetLengthは現在の接続で利用できる上限。 */
export interface BytecodeChannel {
    /**
     * 現在の接続で一回に書き込める最大バイト数。
     */
    readonly packetLength: number;
    /**
     * 通常指令または転送フレームを、現在の通信経路へ書き込む。
     *
     * @param value 検証または反映する値。
     */
    write(value: Uint8Array): Promise<void>;
    /**
     * 専用の受付結果を読み取る。書込みの成功とは別に照合する。
     */
    readResult(): Promise<DataView>;
}

/** コードの保持結果。revisionはデバッグ監視の対象世代。 */
export interface BytecodeReceipt {
    /**
     * 保持コードまたは停止データ全体のバイト数。
     */
    byteLength: number;
    /**
     * 対応するコードまたは停止データ全体のCRC-32。
     */
    crc32: number;
    /**
     * ESP32が確定したプログラムを識別する世代番号。
     */
    revision?: number;
}

/** 同一生成のPC一覧と検証後の開始要求。省略時は保持だけを行う。 */
export interface BytecodeDeployment {
    /**
     * 同一生成のコードに対応する行ブレークポイントの命令PC列。
     */
    breakpoints: readonly number[];
    /**
     * 同一生成の文開始・関数入口・暗黙returnに対応するステップ停止PC列。
     */
    stepPcs: readonly number[];
    /**
     * 全体検証と停止点設定の成功後にVMを開始する要求。
     */
    start: boolean;
}

/** 書込みAPI完了量。completeは最終結果確認済み、速度はB/s。 */
export interface BytecodeProgress {
    /**
     * ヘッダー・PC一覧を除いた元のバイトコード全体のバイト数。
     */
    readonly totalBytes: number;
    /**
     * 書込みAPIが完了したコード部分のバイト数。機器側の検証済み量とは区別する。
     */
    readonly sentBytes: number;
    /**
     * 転送開始から現在までのコード送信量を時間で割った速度（B/s）。
     */
    readonly bytesPerSecond: number;
    /**
     * 接続または転送の進行段階。
     */
    readonly phase: "sending" | "validating" | "complete";
}

/** CRC-32/ISO-HDLC。初期値と最終XORは0xFFFFFFFF。
 *
 * @remarks
 * CRCはヘッダー・関数表・命令列・文字列表・UTF-8データを含む全体のCRC-32/ISO-HDLC（反転多項式0xEDB88320、初期値・最終XOR=0xFFFFFFFF）。
 */
export function bytecodeCrc32(bytes: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    for (const value of bytes) {
        crc ^= value;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xEDB88320);
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** 転送上限・version=3ヘッダー・文字列領域を検査する。全命令の検証は受信側で行う。 */
export function checkBytecodeTransfer(bytes: Uint8Array): void {
    if (bytes.byteLength < bytecodeHeaderLength || bytes.byteLength > bytecodeTransfer.maxLength) {
        throw new RangeError(`バイトコード全体は${bytecodeHeaderLength}〜${bytecodeTransfer.maxLength}バイトにしてください。`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(2, true) !== bytecodeVersion) {
        throw new Error("バイトコードはversion=3だけに対応しています。");
    }
    const headerLength = bytecodeHeaderLength;
    const functionRecordLength = bytecodeFunctionRecordLength;
    const codeLength = view.getUint32(8, true);
    const stringCount = view.getUint16(16, true);
    const dataLength = view.getUint32(20, true);
    const functionCount = view.getUint16(6, true);
    const codeOffset = headerLength + functionCount * functionRecordLength;
    const tableOffset = codeOffset + codeLength;
    const dataOffset = tableOffset + stringCount * bytecodeStringRecordLength;
    if (view.getUint16(0, true) !== bytecodeSignature
        || view.getUint16(12, true) !== 0 || view.getUint16(14, true) !== 2
        || view.getUint16(18, true) !== 2
        || codeLength < 1 || codeLength > 65536
        || bytes.byteLength !== dataOffset + dataLength) {
        throw new Error("バイトコードのヘッダーまたは長さが不正です。");
    }
    for (let index = 0; index < functionCount; index++) {
        const recordOffset = headerLength + index * functionRecordLength;
        if (view.getUint16(recordOffset + 8, true) === 0 || view.getUint16(recordOffset + 10, true) !== 0) {
            throw new Error("バイトコードの関数表の戻り値スロット数または予約領域が不正です。");
        }
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let expectedOffset = 0;
    for (let id = 0; id < stringCount; id++) {
        const recordOffset = tableOffset + id * bytecodeStringRecordLength;
        const offset = view.getUint32(recordOffset, true);
        const length = view.getUint32(recordOffset + 4, true);
        if (offset !== expectedOffset || offset > dataLength || length > dataLength - offset) {
            throw new Error("バイトコードの文字列表の範囲または連続性が不正です。");
        }
        try {
            decoder.decode(bytes.subarray(dataOffset + offset, dataOffset + offset + length));
        }
        catch {
            throw new Error("バイトコードの文字列データがUTF-8として不正です。");
        }
        expectedOffset += length;
    }
    if (expectedOffset !== dataLength) {
        throw new Error("バイトコードの文字列データ長が文字列表と一致しません。");
    }
}

/**
 * この関数の契約に従いコード→PC一覧を連続送信し、COMMIT後だけResultを読む。
 *
 * 全整数little endian。専用Bytecode/Result UUIDは維持し、旧転送version=1は非対応。
 * 共通10バイト: version:u8@0=2、op:u8@1（1 BEGIN/2 DATA/3 COMMIT/4 ABORT）、
 * transferId:u16@2（接続内非0・再利用禁止）、sequence:u16@4（BEGIN=1、以後+1）、position:u32@6。
 * BEGIN14バイト: position=本体長、@10=本体CRC32。DATAはposition=連続offset、@10以降=本体。
 * COMMIT10バイト: position=本体長。ABORT10バイト: position=0。
 * 本体=24バイトヘッダー+コード+偶数長にする0パディング+行PC:u16列+ステップPC:u16列。
 * ヘッダー: magic:u32@0=0x32525055、版:u16@4=1、flags:u16@6（bit0=検証後開始）、
 * byteLength:u32@8、行PC数:u32@12（最大4096）、ステップPC数:u32@16（最大65536）、コードCRC:u32@20。
 * コード最大128KiB。両PC列は重複のない昇順・同一生成の命令先頭。0個も明示する。
 * 本体上限24+128KiB+4096*2+65536*2。CRC-32/ISO-HDLC。
 * BLEは開始前のResult Readで得たmin(合意MTU-3,244)を使い、Write with responseを直列に待つ。
 * Wi-Fiは最大1024バイトを署名付きPOST /bytecodeまたはWS op=bytecodeで送る。
 * 16進化・HMACはrobot-wifi.ts/lib/wifiを参照。カメラは別経路。
 * 要求HMACはsession|counter|path|payload（Readのpayloadは空文字列）。Resultは署名付きHTTP GET
 * /bytecode-resultで読み、session/counter/data（20バイトの16進列）/proofを受け取る。
 * proofはsession|bytecode-result|counter|dataのHMAC。セッション・要求番号・署名を照合して復号する。
 * DATAごとのReadは行わずESP32のmutex付き受信領域へ蓄積し、COMMIT後にloop()が検証する。
 * 各API期限2.5秒、最終Read期限10秒、受信無進捗期限15秒。接続・取消を各操作の前後で検査する。
 * Result20バイト: version:u8@0=2、code:u8@1、transferId:u16@2、maxFrame:u16@4、op:u8@6、
 * state:u8@7（0 idle/1 受信・検証中/2 保持完了/3 error/4 開始成功）、受信長:u32@8、
 * programRevision:u32@12、コードCRC:u32@16。BLEのmaxFrameはRead時に合意MTUから設定する。
 * BLEのResultはloop()が専用コピーへ保持し、onReadだけがGATT値へ設定する。応答コピーとの同時更新を避ける。
 * code=0成功/1形式/2順序/3範囲/4メモリ/5CRC/6コード・PC不正/7期限/8混雑/9開始・取消。
 * 同一転送のエラーを保持し、COMMITの重複で二重開始しない。開始成功も次の転送まで保持する。
 * VMの終了・実行時エラー・Pausedはdebug-protocol.tsのEventで読む。保持はAPI互換性を保証しない。
 * 転送ではABI指紋とnativeId・引数型は照合しない。VM・登録スタブが検査する。Flash保存は行わない。
 * 切断・切替・Stop・取消で未完了転送と開始待ちを破棄し、再接続で自動開始しない。
 * 進捗sentBytesは書込みAPI完了済みコード量（ESP32確認量ではない）。BEGIN直前から計測しコード量/秒をB/sで表示する。
 * PC・ヘッダーの量を除き時間には全送信・最終Read・キュー待ちを含む。250ms間隔、開始・検証待ち・完了は即時通知。
 * 完了速度は固定。切断・失敗・次回転送・切替で初期化し、保存・コピーしない。模擬テストは従来の指定で実行しない。
 */
export async function uploadBytecode(
    input: Uint8Array, transferId: number, channel: BytecodeChannel,
    run: <T>(operation: () => Promise<T>) => Promise<T>, check: () => void,
    onProgress?: (progress: BytecodeProgress) => void, deployment?: BytecodeDeployment
): Promise<BytecodeReceipt> {
    checkBytecodeTransfer(input);
    const bytes = input.slice();
    const crc32 = bytecodeCrc32(bytes);
    const list = (pcs: readonly number[], max: number): number[] => {
        const sorted = [...new Set(pcs)].sort((a, b) => a - b);
        if (sorted.length > max || sorted.some(pc => !Number.isInteger(pc) || pc < 0 || pc > 65535)) {
            throw new RangeError("デバッグ用PC一覧が範囲外です。");
        }
        return sorted;
    };
    const breakpoints = list(deployment?.breakpoints ?? [], 4096);
    const stepPcs = list(deployment?.stepPcs ?? [], 65536);
    const pcOffset = 24 + bytes.byteLength + bytes.byteLength % 2;
    const bundle = new Uint8Array(pcOffset + (breakpoints.length + stepPcs.length) * 2);
    const header = new DataView(bundle.buffer);
    header.setUint32(0, 0x32525055, true);
    header.setUint16(4, 1, true);
    header.setUint16(6, deployment?.start ? 1 : 0, true);
    header.setUint32(8, bytes.byteLength, true);
    header.setUint32(12, breakpoints.length, true);
    header.setUint32(16, stepPcs.length, true);
    header.setUint32(20, crc32, true);
    bundle.set(bytes, 24);
    [...breakpoints, ...stepPcs].forEach((pc, index) => header.setUint16(pcOffset + index * 2, pc, true));
    const frameLength = channel.packetLength;
    if (!Number.isInteger(frameLength) || frameLength < 20 || frameLength > bytecodeTransfer.packetLength) {
        throw new Error("転送サイズが不正です。ファームウェアを更新して再接続してください。");
    }
    let sequence = 0;
    const send = async (operation: number, position: number, payload = new Uint8Array()): Promise<void> => {
        const packet = new Uint8Array(10 + payload.length);
        const view = new DataView(packet.buffer);
        packet[0] = 2;
        packet[1] = operation;
        view.setUint16(2, transferId, true);
        view.setUint16(4, ++sequence, true);
        view.setUint32(6, position, true);
        packet.set(payload, 10);
        await run(async () => {
            check();
            await channel.write(packet);
            check();
        });
    };
    const startedAt = performance.now();
    let lastReportedAt = startedAt;
    const report = (sentBytes: number, phase: BytecodeProgress["phase"], force = false): void => {
        check();
        const now = performance.now();
        if (!force && now - lastReportedAt < 250) {
            return;
        }
        lastReportedAt = now;
        const elapsedMs = now - startedAt;
        onProgress?.({ totalBytes: bytes.byteLength, sentBytes,
            bytesPerSecond: elapsedMs > 0 ? sentBytes * 1000 / elapsedMs : 0, phase });
    };
    report(0, "sending", true);
    const crc = new Uint8Array(4);
    new DataView(crc.buffer).setUint32(0, bytecodeCrc32(bundle), true);
    await send(bytecodeTransfer.begin, bundle.length, crc);
    const chunkLength = frameLength - 10;
    for (let offset = 0; offset < bundle.length; offset += chunkLength) {
        const chunk = bundle.subarray(offset, offset + chunkLength);
        await send(bytecodeTransfer.data, offset, chunk);
        report(Math.max(0, Math.min(bytes.byteLength, offset + chunk.length - 24)), "sending");
    }
    report(bytes.byteLength, "validating", true);
    await send(bytecodeTransfer.commit, bundle.length);
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
        check();
        const reply = await run(() => channel.readResult());
        check();
        if (reply.byteLength !== 20 || reply.getUint8(0) !== 2) {
            throw new Error("一括転送Resultが不正です。ファームウェアを更新してください。");
        }
        if (reply.getUint16(2, true) === transferId) {
            const code = reply.getUint8(1);
            if (code !== 0) {
                const errors = ["成功", "形式不正", "順序・位置不正", "範囲外", "メモリ不足", "CRC不一致",
                    "コード・PC不正", "受信期限切れ", "混雑", "開始失敗・取消"];
                throw new Error(`ESP32のPython転送: ${errors[code] ?? `code=${code}`}`);
            }
            const expected = deployment?.start ? bytecodeTransfer.started : bytecodeTransfer.ready;
            if (reply.getUint8(7) === expected && reply.getUint8(6) === bytecodeTransfer.commit) {
                if (reply.getUint32(8, true) !== bundle.length || reply.getUint32(12, true) === 0
                    || reply.getUint32(16, true) !== crc32) {
                    throw new Error("ESP32のPython保持結果が一致しません。");
                }
                report(bytes.byteLength, "complete", true);
                return { byteLength: bytes.byteLength, crc32, revision: reply.getUint32(12, true) };
            }
        }
        await new Promise<void>(resolve => setTimeout(resolve, 20));
    }
    throw new Error("ESP32のPython検証・開始結果がタイムアウトしました。");
}
