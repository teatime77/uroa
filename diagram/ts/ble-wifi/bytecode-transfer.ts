/**
 * @remarks
 * # PythonバイトコードのBLE転送
 *
 * 2026-11-03。[バイナリversion=1](../../../docs/diagram/python/bytecode.md)をdiagramから現行ESP32のdiagram-controlへ送り、形式を検証してRAMへ保持する。正常COMMIT後に[VM](../../../../esp32/app/diagram-control/src/bytecode_vm.cpp)を開始する。Flash保存は実装しない。
 *
 * ## 確認範囲
 *
 * 模擬・単体・ブラウザーテストはユーザーの従来の指定により作成・実行しない。型ビルド・公開ビルド、PlatformIOの各ボードのビルド結果は[検証記録](../../../docs/build-and-test.md)を参照する。実BLE転送、タイムアウト・切断時の実動作、空きRAM、Uploadと実機での保持はビルドとは別の確認とする。
 */
import { bytecodeHeaderLength, bytecodeSignature, bytecodeVersion } from "../python/bytecode.js";

/** 既定ATT MTU=23の20バイト書き込みで使う転送形式。
 *
 * @remarks
 * ## 転送パケット（version=1）
 *
 * 全てlittle endian。共通ヘッダーは10バイト。
 *
 * | バイト位置 | 型 | 内容 |
 * |---|---|---|
 * | 0 | uint8 | 転送version=1 |
 * | 1 | uint8 | 操作（1=BEGIN、2=DATA、3=COMMIT、4=ABORT） |
 * | 2 | uint16 | 転送ID。0を使わず、Web側は転送ごとに更新する |
 * | 4 | uint16 | フレームsequence。BEGINは1、以後1ずつ増加する |
 * | 6 | uint32 | BEGINでは全体長、DATAでは書込位置、COMMITでは全体長、ABORTでは0 |
 * | 10以降 | バイト列 | BEGINは全体CRC32の4バイト、DATAは本体1〜10バイト、COMMIT／ABORTはなし |
 *
 * BEGINは14バイト、DATAは11〜20バイト、COMMIT／ABORTは10バイト。
 */
export const bytecodeTransfer = {
    version: 1,
    maxLength: 128 * 1024,
    packetLength: 20,
    headerLength: 10,
    resultLength: 20,
    timeoutMs: 2500,
    begin: 1,
    data: 2,
    commit: 3,
    abort: 4,
    receiving: 1,
    ready: 2
} as const;

export interface BytecodeWriteCharacteristic {
    writeValueWithResponse(value: Uint8Array): Promise<void>;
}

export interface BytecodeReadCharacteristic {
    readValue(): Promise<DataView>;
}

/** 受信完了はRAMへの保持を表し、VMでの実行やFlash保存を意味しない。 */
export interface BytecodeReceipt {
    byteLength: number;
    crc32: number;
}

/** CRC-32/ISO-HDLC。初期値と最終XORは0xFFFFFFFF。
 *
 * @remarks
 * CRCはバイナリヘッダー・関数表・命令列を含む全体のCRC-32/ISO-HDLC（反転多項式0xEDB88320、初期値・最終XOR=0xFFFFFFFF）。
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

/** 転送上限とヘッダーを検査する。全命令の検証は受信側でも行う。 */
export function checkBytecodeTransfer(bytes: Uint8Array): void {
    if (bytes.byteLength < bytecodeHeaderLength || bytes.byteLength > bytecodeTransfer.maxLength) {
        throw new RangeError(`バイトコード全体は${bytecodeHeaderLength}〜${bytecodeTransfer.maxLength}バイトにしてください。`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const codeLength = view.getUint32(8, true);
    if (view.getUint16(0, true) !== bytecodeSignature || view.getUint16(2, true) !== bytecodeVersion
        || view.getUint16(12, true) !== 0 || view.getUint16(14, true) !== 0
        || codeLength < 1 || codeLength > 65536
        || bytes.byteLength !== bytecodeHeaderLength + view.getUint16(6, true) * 8 + codeLength) {
        throw new Error("バイトコードのヘッダーまたは長さが不正です。");
    }
}

/**
 * 現接続のGATTキューで各パケットを書き、loop()が返す専用の受付結果を待つ。
 * runはパケット単位で直列化・タイムアウトを行い、PING等が間に入れるようにする。
 *
 * @remarks
 * WebはBEGIN→DATA列→COMMITの順で1フレームずつ結果を待つ。パケット単位で既存のGATT待ち列へ入り、間にPING・STOP等を処理できるようにする。1操作の上限は2.5秒。古い結果は転送ID・sequence・操作の一致で除外し、成功時には状態・受信済み長・全体長・CRCも照合する。Readの結果がまだ更新されていなければ10ms待って再読出しする。自動再送・転送の途中再開は行わない。Webの取消は接続を閉じて行い、ABORTは将来の明示取消にも使える受信操作として実装する。
 */
export async function uploadBytecode(
    input: Uint8Array,
    transferId: number,
    write: BytecodeWriteCharacteristic,
    result: BytecodeReadCharacteristic,
    run: <T>(operation: () => Promise<T>) => Promise<T>,
    check: () => void
): Promise<BytecodeReceipt> {
    checkBytecodeTransfer(input);
    const bytes = input.slice();
    const crc32 = bytecodeCrc32(bytes);
    let sequence = 0;
    const exchange = async (operation: number, position: number, payload: Uint8Array,
        received: number, state: number): Promise<void> => {
        const packet = new Uint8Array(bytecodeTransfer.headerLength + payload.length);
        const view = new DataView(packet.buffer);
        const request = ++sequence;
        packet[0] = bytecodeTransfer.version;
        packet[1] = operation;
        view.setUint16(2, transferId, true);
        view.setUint16(4, request, true);
        view.setUint32(6, position, true);
        packet.set(payload, bytecodeTransfer.headerLength);
        await run(async () => {
            check();
            await write.writeValueWithResponse(packet);
            while (true) {
                check();
                /**
                 * @remarks
                 * ## 受付結果（20バイト）
                 *
                 * | バイト位置 | 型 | 内容 |
                 * |---|---|---|
                 * | 0 | uint8 | 転送version=1 |
                 * | 1 | uint8 | 結果コード |
                 * | 2 | uint16 | 対象の転送ID |
                 * | 4 | uint16 | 対象フレームのsequence |
                 * | 6 | uint8 | 対象操作 |
                 * | 7 | uint8 | 状態（0=idle、1=receiving、2=ready、3=error） |
                 * | 8 | uint32 | 連続して受信できたバイト数 |
                 * | 12 | uint32 | BEGINで指定した全体長 |
                 * | 16 | uint32 | BEGINで指定した全体CRC32。COMMIT成功時は実際のCRCと一致する |
                 */
                const reply = await result.readValue();
                check();
                if (reply.byteLength !== bytecodeTransfer.resultLength || reply.getUint8(0) !== bytecodeTransfer.version) {
                    throw new Error("バイトコード受付結果の形式が不正です。");
                }
                if (reply.getUint16(2, true) === transferId && reply.getUint16(4, true) === request
                    && reply.getUint8(6) === operation) {
                    const code = reply.getUint8(1);
                    if (code !== 0) {
                        const errors = ["成功", "形式不正", "順序・位置不正", "長さの上限超過", "メモリ不足",
                            "CRC不一致", "バイトコード不正", "受信期限切れ", "受信キューの混雑"];
                        throw new Error(`ESP32がバイトコードを拒否しました: ${errors[code] ?? `code=${code}`}`);
                    }
                    if (reply.getUint8(7) !== state || reply.getUint32(8, true) !== received
                        || reply.getUint32(12, true) !== bytes.length || reply.getUint32(16, true) !== crc32) {
                        throw new Error("ESP32のバイトコード受信位置・サイズ・CRCが一致しません。");
                    }
                    return;
                }
                await new Promise<void>(resolve => setTimeout(resolve, 10));
            }
        });
    };
    const crc = new Uint8Array(4);
    new DataView(crc.buffer).setUint32(0, crc32, true);
    await exchange(bytecodeTransfer.begin, bytes.length, crc, 0, bytecodeTransfer.receiving);
    const chunkLength = bytecodeTransfer.packetLength - bytecodeTransfer.headerLength;
    for (let offset = 0; offset < bytes.length; offset += chunkLength) {
        const chunk = bytes.subarray(offset, offset + chunkLength);
        await exchange(bytecodeTransfer.data, offset, chunk, offset + chunk.length, bytecodeTransfer.receiving);
    }
    await exchange(bytecodeTransfer.commit, bytes.length, new Uint8Array(), bytes.length, bytecodeTransfer.ready);
    return { byteLength: bytes.length, crc32 };
}
