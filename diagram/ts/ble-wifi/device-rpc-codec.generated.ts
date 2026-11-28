/** device.proto/options.protoから自動生成。編集せずdiagram/rpc/generate.mjsを実行する。 */

import { RpcCode, RpcError } from "./rpc-client";

import type { CommandPacket, StatusPacket } from "./device-rpc.generated";

/** 整数幅と形式を検査し、既存の固定長パケットを書く。 */
export function encodeCommandPacket(packet: CommandPacket): Uint8Array {
    if (!(Number.isInteger(packet.version) && packet.version >= 0 && packet.version <= 255 && packet.version === 1)) {
        throw new RpcError(RpcCode.InvalidArgument, "CommandPacket.versionが格納幅または形式の範囲外です。");
    }
    if (!(Number.isInteger(packet.opcode) && packet.opcode >= 0 && packet.opcode <= 255 && (packet.opcode >= 1 && packet.opcode <= 11))) {
        throw new RpcError(RpcCode.InvalidArgument, "CommandPacket.opcodeが格納幅または形式の範囲外です。");
    }
    if (!(Number.isInteger(packet.sequence) && packet.sequence >= 0 && packet.sequence <= 65535)) {
        throw new RpcError(RpcCode.InvalidArgument, "CommandPacket.sequenceが格納幅または形式の範囲外です。");
    }
    if (!(Number.isInteger(packet.channel) && packet.channel >= 0 && packet.channel <= 255)) {
        throw new RpcError(RpcCode.InvalidArgument, "CommandPacket.channelが格納幅または形式の範囲外です。");
    }
    if (!(Number.isInteger(packet.reserved) && packet.reserved >= 0 && packet.reserved <= 255 && packet.reserved === 0)) {
        throw new RpcError(RpcCode.InvalidArgument, "CommandPacket.reservedが格納幅または形式の範囲外です。");
    }
    if (!(Number.isInteger(packet.value) && packet.value >= 0 && packet.value <= 65535)) {
        throw new RpcError(RpcCode.InvalidArgument, "CommandPacket.valueが格納幅または形式の範囲外です。");
    }
    if (!(Number.isInteger(packet.duration) && packet.duration >= 0 && packet.duration <= 65535)) {
        throw new RpcError(RpcCode.InvalidArgument, "CommandPacket.durationが格納幅または形式の範囲外です。");
    }
    const bytes = new Uint8Array(10);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, packet.version);
    view.setUint8(1, packet.opcode);
    view.setUint16(2, packet.sequence, true);
    view.setUint8(4, packet.channel);
    view.setUint8(5, packet.reserved);
    view.setUint16(6, packet.value, true);
    view.setUint16(8, packet.duration, true);
    return bytes;
}

/** byteOffset付きDataViewを全長・形式検査して読む。未知のStatus結果コードも保持する。 */
export function decodeStatusPacket(view: DataView): StatusPacket {
    if (view.byteLength !== 12) {
        throw new RpcError(RpcCode.InvalidArgument, "StatusPacketの長さが不正です。");
    }
    const packet: StatusPacket = {
        version: view.getUint8(0),
        code: view.getUint8(1),
        sequence: view.getUint16(2, true),
        flags: view.getUint8(4),
        channel: view.getUint8(5),
        current: view.getUint16(6, true),
        target: view.getUint16(8, true),
        remaining: view.getUint16(10, true),
    };
    if (!(packet.version === 1)) {
        throw new RpcError(RpcCode.InvalidArgument, "StatusPacketの形式が不正です。");
    }
    return packet;
}

