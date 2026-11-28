/** device.proto/options.protoから自動生成。編集せずdiagram/rpc/generate.mjsを実行する。 */

/** 通常Commandの要求作成・送信・Status結果を生成する。機器状態はサービスフック、ACK待ちは共通exchangeが所有する。 */

import { RpcCode, RpcError, type RpcCallOptions } from "./rpc-client";

import type { ControlConnection, ControlCallContext, ControlExchangePolicy } from "./control-connection";

import { encodeCommandPacket } from "./device-rpc-codec.generated";

import { CommandOpcode, StatusCode, rpcMethods, type CommandPacket, type StatusPacket, type DeviceRpcCalls, type InternalControlRpcCalls, type Empty, type ArmRequest, type MoveRequest, type SpeedRequest, type Channel, type ProgramRequest } from "./device-rpc.generated";

/** sequence 0を自発通知用に残し、最大値の次は1へ戻す。 */
export const controlMaxSequence = 65535;

export type ControlRpcCalls = Pick<DeviceRpcCalls, "device.info" | "device.ping" | "servo.arm" | "servo.move" | "servo.speed" | "servo.disable" | "servo.stop" | "program.start" | "program.stop">;

/** Deviceの機能状態を検査する値。opcode・配置・倍率を含めない。 */
export type DeviceControlInvocation =
    | { name: "device.info"; request: Empty }
    | { name: "device.ping"; request: Empty };

/** Servoの機能状態を検査する値。opcode・配置・倍率を含めない。 */
export type ServoControlInvocation =
    | { name: "servo.arm"; request: ArmRequest }
    | { name: "servo.move"; request: MoveRequest }
    | { name: "servo.speed"; request: SpeedRequest }
    | { name: "servo.disable"; request: Channel }
    | { name: "servo.stop"; request: Empty };

/** Programの機能状態を検査する値。opcode・配置・倍率を含めない。 */
export type ProgramControlInvocation =
    | { name: "program.start"; request: ProgramRequest }
    | { name: "program.stop"; request: Empty };

export interface ControlServiceHooks {
    Device?: (invocation: DeviceControlInvocation, options?: RpcCallOptions) => ControlCallContext;
    Servo?: (invocation: ServoControlInvocation, options?: RpcCallOptions) => ControlCallContext;
    Program?: (invocation: ProgramControlInvocation, options?: RpcCallOptions) => ControlCallContext;
}

const resultMessages: Readonly<Record<number, string>> = {
    "0": "成功",
    "1": "指令形式が不正（速度制御には対応ファームウェアが必要です）",
    "2": "範囲外の指令",
    "3": "サーボが無効／応答タイムアウト",
    "4": "デバイスが見つかりません",
    "5": "指令が混雑しています",
    "6": "I²C通信エラー",
    "7": "角度／速度モードが異なります。無効化してから有効化してください。"
};

const traceNames: Readonly<Partial<Record<CommandOpcode, string>>> = {
    "1": "ARM",
    "2": "MOVE",
    "3": "STOP",
    "7": "DISABLE",
    "8": "ARM_SPEED",
    "9": "SET_SPEED"
};

/** Statusは機器受付まで。VMの初期化成功もHALTや動作完了を表さない。未知の番号を保持する。 */
function commandResult(status: StatusPacket): void {
    if (status.code !== StatusCode.CODE_OK) {
        throw new RpcError(RpcCode.Device, resultMessages[status.code] ?? `機器エラー ${status.code}`, status.code);
    }
}

/** 宣言から作った要求を現在の経路へ送る。取消・世代の最終検査後に共通exchangeがACKフックを実行する。 */
async function invokeControl(transport: ControlConnection, packet: Omit<CommandPacket, "sequence">, signed: boolean,
    policy: ControlExchangePolicy, context: ControlCallContext, options?: RpcCallOptions): Promise<void> {
    if (context.skip) {
        return;
    }
    try {
        if (signed && (!Number.isInteger(packet.value) || packet.value < -32768
            || packet.value > 32767)) {
            throw new RpcError(RpcCode.InvalidArgument, "Commandの符号付き値が格納幅の範囲外です。");
        }
        const operation = traceNames[packet.opcode];
        const diagnostic = operation ? { operation, channel: packet.channel, value: packet.value, duration: packet.duration } : undefined;
        await transport.exchange(sequence => encodeCommandPacket({ ...packet, sequence,
            value: signed ? packet.value & 65535 : packet.value }),
            commandResult, policy, context, options, diagnostic);
    }
    catch (error) {
        context.failed?.(error);
        throw error;
    }
}

/** 既存Commandへ接続した型付き呼出し表。接続選択やドメイン状態を所有しない。 */
export function createControlCalls(transport: ControlConnection, hooks: ControlServiceHooks = {}): ControlRpcCalls {
    return {
        "device.info": async (options) => {
            const packet = { version: 1, reserved: 0, opcode: CommandOpcode.INFO, channel: 255, value: 0, duration: 0 };
            const signed = false;
            const context = hooks.Device?.({ name: "device.info", request: undefined }, options) ?? {};
            return invokeControl(transport, packet, signed, rpcMethods["device.info"], context, options);
        },
        "device.ping": async (options) => {
            const packet = { version: 1, reserved: 0, opcode: CommandOpcode.PING, channel: 255, value: 0, duration: 0 };
            const signed = false;
            const context = hooks.Device?.({ name: "device.ping", request: undefined }, options) ?? {};
            return invokeControl(transport, packet, signed, rpcMethods["device.ping"], context, options);
        },
        "servo.arm": async (request, options) => {
            let packet: Omit<CommandPacket, "sequence">;
            let signed: boolean;
            if (request.mode === "angle") {
                packet = { version: 1, reserved: 0, opcode: CommandOpcode.ARM, channel: request.channel, value: 9000, duration: 0 };
                signed = false;
            }
            else if (request.mode === "speed") {
                packet = { version: 1, reserved: 0, opcode: CommandOpcode.ARM_SPEED, channel: request.channel, value: 0, duration: 0 };
                signed = false;
            }
            else {
                throw new RpcError(RpcCode.InvalidArgument, "ArmRequest.modeが不正です。");
            }
            const context = hooks.Servo?.({ name: "servo.arm", request: request }, options) ?? {};
            return invokeControl(transport, packet, signed, rpcMethods["servo.arm"], context, options);
        },
        "servo.move": async (request, options) => {
            const packet = { version: 1, reserved: 0, opcode: CommandOpcode.MOVE, channel: request.channel, value: Math.round(request.angle * 100), duration: request.duration };
            const signed = false;
            const context = hooks.Servo?.({ name: "servo.move", request: request }, options) ?? {};
            return invokeControl(transport, packet, signed, rpcMethods["servo.move"], context, options);
        },
        "servo.speed": async (request, options) => {
            const packet = { version: 1, reserved: 0, opcode: CommandOpcode.SET_SPEED, channel: request.channel, value: Math.round(request.percent * 100), duration: 0 };
            const signed = true;
            const context = hooks.Servo?.({ name: "servo.speed", request: request }, options) ?? {};
            return invokeControl(transport, packet, signed, rpcMethods["servo.speed"], context, options);
        },
        "servo.disable": async (request, options) => {
            const packet = { version: 1, reserved: 0, opcode: CommandOpcode.DISABLE, channel: request.channel, value: 0, duration: 0 };
            const signed = false;
            const context = hooks.Servo?.({ name: "servo.disable", request: request }, options) ?? {};
            return invokeControl(transport, packet, signed, rpcMethods["servo.disable"], context, options);
        },
        "servo.stop": async (options) => {
            const packet = { version: 1, reserved: 0, opcode: CommandOpcode.STOP, channel: 255, value: 0, duration: 0 };
            const signed = false;
            const context = hooks.Servo?.({ name: "servo.stop", request: undefined }, options) ?? {};
            return invokeControl(transport, packet, signed, rpcMethods["servo.stop"], context, options);
        },
        "program.start": async (request, options) => {
            const packet = { version: 1, reserved: 0, opcode: CommandOpcode.VM_START, channel: 255, value: 0, duration: 0 };
            const signed = false;
            const context = hooks.Program?.({ name: "program.start", request: request }, options) ?? {};
            return invokeControl(transport, packet, signed, rpcMethods["program.start"], context, options);
        },
        "program.stop": async (options) => {
            const packet = { version: 1, reserved: 0, opcode: CommandOpcode.VM_STOP, channel: 255, value: 0, duration: 0 };
            const signed = false;
            const context = hooks.Program?.({ name: "program.stop", request: undefined }, options) ?? {};
            return invokeControl(transport, packet, signed, rpcMethods["program.stop"], context, options);
        },
    };
}

/** 既存Commandへ接続した型付き呼出し表。接続選択やドメイン状態を所有しない。 */
export function createInternalControlCalls(transport: ControlConnection): InternalControlRpcCalls {
    return {
        "control.stream": async (request, options) => {
            const packet = { version: 1, reserved: 0, opcode: CommandOpcode.STREAM, channel: 255, value: request.rate, duration: 0 };
            const signed = false;
            const context: ControlCallContext = {};
            return invokeControl(transport, packet, signed, rpcMethods["control.stream"], context, options);
        },
    };
}

