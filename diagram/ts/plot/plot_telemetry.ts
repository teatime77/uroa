import { balanceType, type BalanceValue } from "../data_type";

export interface BalanceSample { readonly sequence: number; readonly uptime: number; readonly value: BalanceValue; }

/** UroaPlot v2/schema 1: six signed hundredths in a single 20-byte BLE notification. */
export function parseBalanceSample(data: DataView): BalanceSample {
    if (data.byteLength !== 20 || data.getUint8(0) !== 2 || data.getUint8(1) !== 1) {
        throw new Error("倒立プロットデータの形式が正しくありません。");
    }
    const [angle, target, rate, error, left, right] = [8, 10, 12, 14, 16, 18].map(offset => data.getInt16(offset, true) / 100);
    return Object.freeze({
        sequence: data.getUint16(2, true), uptime: data.getUint32(4, true),
        value: balanceType.copyValue({ attitude: { angle, target, rate, error }, command: { left, right } }) as BalanceValue,
    });
}
