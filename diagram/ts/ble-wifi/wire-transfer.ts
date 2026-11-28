/**
 * 生成した固定ヘッダーと可変長本体を既存の転送手順へ接続する共有の分割処理。
 * CRC・連番・最終ACK・再送や進捗の意味は各プロトコルの所有者が扱う。
 * 本体は借用し、送信用の最終フレームだけを生成codecが確保する。
 */
export async function forWireChunks(bytes: Uint8Array, length: number, check: () => void,
    send: (part: Uint8Array, offset: number) => Promise<void>): Promise<void> {
    if (!Number.isInteger(length) || length <= 0) {
        throw new RangeError("分割長が不正です。");
    }
    for (let offset = 0; offset < bytes.byteLength; offset += length) {
        check();
        await send(bytes.subarray(offset, offset + length), offset);
    }
}
