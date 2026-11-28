/**
 * device.protoから生成した固定長配置をlittle endian・パディングなしで読み書きする。
 * 版・予約値・機器固有の範囲は既存処理が検査し、本層は長さと整数幅だけを検査する。
 */
import { packetLayouts, type PacketTypes } from "./device-rpc.generated";
import { RpcCode, RpcError } from "./rpc-client";

/** 生成済みリテラルを共通の整数読み書きへ渡すための配置型。 */
interface FieldLayout {
    name: string;
    offset: number;
    bits: number;
    signed: boolean;
}

/** 宣言順に書き込む。符号付き指令のビット列化は呼出元が行う。 */
export function encodeRpcPacket<Name extends keyof PacketTypes>(name: Name, input: PacketTypes[Name]): Uint8Array {
    const layout = packetLayouts[name];
    const bytes = new Uint8Array(layout.byteLength);
    const view = new DataView(bytes.buffer);
    const values = input as unknown as Readonly<Record<string, number>>;
    const fields: readonly FieldLayout[] = layout.fields;
    for (const field of fields) {
        const value = values[field.name];
        const min = field.signed ? -(2 ** (field.bits - 1)) : 0;
        const max = 2 ** (field.bits - (field.signed ? 1 : 0)) - 1;
        if (!Number.isInteger(value) || value < min || value > max) {
            throw new RpcError(RpcCode.InvalidArgument, `${name}.${field.name}が格納幅の範囲外です。`);
        }
        if (field.bits === 8) {
            if (field.signed) {
                view.setInt8(field.offset, value);
            }
            else {
                view.setUint8(field.offset, value);
            }
        }
        else if (field.bits === 16) {
            if (field.signed) {
                view.setInt16(field.offset, value, true);
            }
            else {
                view.setUint16(field.offset, value, true);
            }
        }
        else if (field.signed) {
            view.setInt32(field.offset, value, true);
        }
        else {
            view.setUint32(field.offset, value, true);
        }
    }
    return bytes;
}

/** byteOffsetを持つDataViewも使える。全長が一致するパケットだけを復号する。 */
export function decodeRpcPacket<Name extends keyof PacketTypes>(name: Name, view: DataView): PacketTypes[Name] {
    const layout = packetLayouts[name];
    if (view.byteLength !== layout.byteLength) {
        throw new RpcError(RpcCode.InvalidArgument, `${name}の長さが不正です。`);
    }
    const result: Record<string, number> = {};
    const fields: readonly FieldLayout[] = layout.fields;
    for (const field of fields) {
        if (field.bits === 8) {
            result[field.name] = field.signed ? view.getInt8(field.offset) : view.getUint8(field.offset);
        }
        else if (field.bits === 16) {
            result[field.name] = field.signed ? view.getInt16(field.offset, true) : view.getUint16(field.offset, true);
        }
        else {
            result[field.name] = field.signed ? view.getInt32(field.offset, true) : view.getUint32(field.offset, true);
        }
    }
    return result as unknown as PacketTypes[Name];
}
