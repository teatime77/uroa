/** device.proto/options.protoから自動生成。編集せずdiagram/rpc/generate.mjsを実行する。 */

import type { RpcCallOptions } from "./rpc-client";

import type { BytecodeReceipt as HostReceipt } from "./bytecode-transfer";

import type { BytecodeDeployment as HostDeployment } from "./bytecode-transfer";

import type { DebugSnapshot as HostSnapshot } from "./debug-protocol";

import type { DebugEvent as HostDebugState } from "./debug-protocol";

import type { DeviceConnectionState as HostConnectionState } from "./device-connection";

import type { FunctionBlock as HostSensorOwner } from "../block";

import type { DeviceTelemetry as HostSensorSample } from "./device-telemetry";

import type { RobotEndpoint as HostEndpoint } from "./robot-wifi";

import type { ProvisionInfo as HostWifiInfo } from "./robot-wifi";

import type { WifiNetwork as HostWifiNetwork } from "./robot-wifi";

import type { RpcClient as HostRemoteClient } from "./rpc-client";

import type { RpcRequest as HostRemoteRequest } from "./rpc-protocol";



export const rpcApiVersion = 1;

export const rpcMaxPending = 32;

export const rpcSchemaFingerprint = "99d8eab721a50d2deda1e415c268665dc3730d66c80a19104a87439d890d8730";



export enum CommandOpcode {
    COMMAND_UNSPECIFIED = 0,
    ARM = 1,
    MOVE = 2,
    STOP = 3,
    STREAM = 4,
    PING = 5,
    INFO = 6,
    DISABLE = 7,
    ARM_SPEED = 8,
    SET_SPEED = 9,
    VM_START = 10,
    VM_STOP = 11,
}

export enum StatusCode {
    CODE_OK = 0,
    CODE_FORMAT = 1,
    CODE_RANGE = 2,
    CODE_NOT_ARMED = 3,
    CODE_HARDWARE = 4,
    CODE_BUSY = 5,
    CODE_IO_ERROR = 6,
    CODE_MODE = 7,
}

/** device.protoのCommandPacketから生成した値型。 */
export interface CommandPacket {
    version: number;
    opcode: CommandOpcode;
    sequence: number;
    channel: number;
    reserved: number;
    value: number;
    duration: number;
}

/** device.protoのStatusPacketから生成した値型。 */
export interface StatusPacket {
    version: number;
    code: number;
    sequence: number;
    flags: number;
    channel: number;
    current: number;
    target: number;
    remaining: number;
}

/** device.protoのTelemetryHeaderから生成した値型。 */
export interface TelemetryHeader {
    version: number;
    flags: number;
    sequence: number;
    millis: number;
}

/** device.protoのImuRecordから生成した値型。 */
export interface ImuRecord {
    deviceType: number;
    accX: number;
    accY: number;
    accZ: number;
    gyroX: number;
    gyroY: number;
    gyroZ: number;
}

/** device.protoのDistanceRecordから生成した値型。 */
export interface DistanceRecord {
    deviceType: number;
    distanceMm: number;
}

export type Empty = void;

/** device.protoのReasonから生成した値型。 */
export interface Reason {
    reason?: string;
}

/** device.protoのChannelから生成した値型。 */
export interface Channel {
    channel: number;
}

/** device.protoのArmRequestから生成した値型。 */
export interface ArmRequest {
    channel: number;
    mode: string;
}

/** device.protoのMoveRequestから生成した値型。 */
export interface MoveRequest {
    channel: number;
    angle: number;
    duration: number;
}

/** device.protoのSpeedRequestから生成した値型。 */
export interface SpeedRequest {
    channel: number;
    percent: number;
}

/** 既存の復号済みホスト型。直列化と所有検査は既存アダプターへ委譲する。 */
export type Receipt = HostReceipt;

/** 既存の復号済みホスト型。直列化と所有検査は既存アダプターへ委譲する。 */
export type Deployment = HostDeployment;

/** device.protoのUploadRequestから生成した値型。 */
export interface UploadRequest {
    code: Uint8Array;
    deployment?: Deployment;
}

/** device.protoのProgramRequestから生成した値型。 */
export interface ProgramRequest {
    receipt: Receipt;
}

/** device.protoのBreakpointsRequestから生成した値型。 */
export interface BreakpointsRequest {
    receipt: Receipt;
    pcs: readonly number[];
    stepPcs?: readonly number[];
}

/** 既存の復号済みホスト型。直列化と所有検査は既存アダプターへ委譲する。 */
export type Snapshot = HostSnapshot;

/** 既存の復号済みホスト型。直列化と所有検査は既存アダプターへ委譲する。 */
export type DebugState = HostDebugState;

/** 既存の復号済みホスト型。直列化と所有検査は既存アダプターへ委譲する。 */
export type HostError = Error;

/** device.protoのDebugUpdateから生成した値型。 */
export interface DebugUpdate {
    snapshot?: Snapshot;
    error?: HostError;
    event?: DebugState;
}

/** device.protoのExecuteRequestから生成した値型。 */
export interface ExecuteRequest {
    receipt: Receipt;
    snapshot: Snapshot;
    action: string;
}

/** 既存の復号済みホスト型。直列化と所有検査は既存アダプターへ委譲する。 */
export type ConnectionState = HostConnectionState;

/** 既存の復号済みホスト型。直列化と所有検査は既存アダプターへ委譲する。 */
export type SensorOwner = HostSensorOwner;

/** 既存の復号済みホスト型。直列化と所有検査は既存アダプターへ委譲する。 */
export type SensorSample = HostSensorSample;

/** 既存の復号済みホスト型。直列化と所有検査は既存アダプターへ委譲する。 */
export type Endpoint = HostEndpoint;

/** 既存の復号済みホスト型。直列化と所有検査は既存アダプターへ委譲する。 */
export type WifiInfo = HostWifiInfo;

/** 既存の復号済みホスト型。直列化と所有検査は既存アダプターへ委譲する。 */
export type WifiNetwork = HostWifiNetwork;

/** device.protoのWifiNetworksから生成した値型。 */
export interface WifiNetworks {
    networks: readonly WifiNetwork[];
}

/** device.protoのWifiConfigureRequestから生成した値型。 */
export interface WifiConfigureRequest {
    ssid: string;
    password: string;
}

/** 既存の復号済みホスト型。直列化と所有検査は既存アダプターへ委譲する。 */
export type Image = Blob;

/** device.protoのNonceから生成した値型。 */
export interface Nonce {
    nonce: number;
}

/** 既存の復号済みホスト型。直列化と所有検査は既存アダプターへ委譲する。 */
export type RemoteClient = HostRemoteClient<RemoteRpcCalls>;

/** device.protoのRegistryRequestから生成した値型。 */
export interface RegistryRequest {
    config: Uint8Array;
}

/** 既存の復号済みホスト型。直列化と所有検査は既存アダプターへ委譲する。 */
export type RemoteRequest = HostRemoteRequest | undefined;

/** device.protoのRequestIdから生成した値型。 */
export interface RequestId {
    id: number;
}

/** device.protoのStreamRateから生成した値型。 */
export interface StreamRate {
    rate: number;
}

export interface DeviceRpcCalls {
    /** Connection.Connect: connectedまで。 */
    "connection.connect": (options?: RpcCallOptions) => Promise<Empty>;
    /** Connection.Disconnect: invalidatedまで。 */
    "connection.disconnect": (request: Reason, options?: RpcCallOptions) => Empty;
    /** Device.Register: writeまで。 */
    "device.register": (options?: RpcCallOptions) => Promise<Empty>;
    /** Device.Info: ackまで。 */
    "device.info": (options?: RpcCallOptions) => Promise<Empty>;
    /** Device.Ping: ackまで。 */
    "device.ping": (options?: RpcCallOptions) => Promise<Empty>;
    /** Servo.Arm: ackまで。 */
    "servo.arm": (request: ArmRequest, options?: RpcCallOptions) => Promise<Empty>;
    /** Servo.Move: ackまで。 */
    "servo.move": (request: MoveRequest, options?: RpcCallOptions) => Promise<Empty>;
    /** Servo.Speed: ackまで。 */
    "servo.speed": (request: SpeedRequest, options?: RpcCallOptions) => Promise<Empty>;
    /** Servo.Disable: ackまで。 */
    "servo.disable": (request: Channel, options?: RpcCallOptions) => Promise<Empty>;
    /** Servo.Stop: ackまで。 */
    "servo.stop": (options?: RpcCallOptions) => Promise<Empty>;
    /** Program.Upload: verified-or-startedまで。 */
    "program.upload": (request: UploadRequest, options?: RpcCallOptions) => Promise<Receipt>;
    /** Program.Start: initializedまで。 */
    "program.start": (request: ProgramRequest, options?: RpcCallOptions) => Promise<Empty>;
    /** Program.Stop: ackまで。 */
    "program.stop": (options?: RpcCallOptions) => Promise<Empty>;
    /** Debug.Breakpoints: verifiedまで。 */
    "debug.breakpoints": (request: BreakpointsRequest, options?: RpcCallOptions) => Promise<Empty>;
    /** Debug.Observe: observingまで。 */
    "debug.observe": (request: ProgramRequest, options?: RpcCallOptions) => Promise<Empty>;
    /** Debug.Execute: ackまで。 */
    "debug.execute": (request: ExecuteRequest, options?: RpcCallOptions) => Promise<Empty>;
    /** Wifi.Open: dialogまで。 */
    "wifi.open": (options?: RpcCallOptions) => Promise<Empty>;
    /** Wifi.Close: invalidatedまで。 */
    "wifi.close": (options?: RpcCallOptions) => Empty;
    /** Wifi.Info: replyまで。 */
    "wifi.info": (options?: RpcCallOptions) => Promise<WifiInfo>;
    /** Wifi.Scan: scan-completeまで。 */
    "wifi.scan": (options?: RpcCallOptions) => Promise<WifiNetworks>;
    /** Wifi.Configure: configuredまで。 */
    "wifi.configure": (request: WifiConfigureRequest, options?: RpcCallOptions) => Promise<WifiInfo>;
    /** Wifi.Forget: replyまで。 */
    "wifi.forget": (options?: RpcCallOptions) => Promise<WifiInfo>;
    /** Wifi.Connect: authenticated-controlまで。 */
    "wifi.connect": (request: Endpoint, options?: RpcCallOptions) => Promise<Empty>;
    /** Camera.Capture: jpegまで。 */
    "camera.capture": (options?: RpcCallOptions) => Promise<Image>;
    /** Remote.Open: channelまで。 */
    "remote.open": (request: Nonce, options?: RpcCallOptions) => Promise<RemoteClient>;
}

export interface RemoteRpcCalls {
    /** RemoteSession.Configure: registeredまで。 */
    "registry.configure": (request: RegistryRequest, options?: RpcCallOptions) => Promise<Empty>;
    /** RemoteSession.Read: headまで。 */
    "request.read": (options?: RpcCallOptions) => Promise<RemoteRequest>;
    /** RemoteSession.Acknowledge: worker-acceptedまで。 */
    "request.acknowledge": (request: RequestId, options?: RpcCallOptions) => Promise<Empty>;
    /** RemoteSession.End: unregisteredまで。 */
    "registry.end": (options?: RpcCallOptions) => Promise<Empty>;
}

export interface InternalControlRpcCalls {
    /** Control.Stream: ackまで。 */
    "control.stream": (request: StreamRate, options?: RpcCallOptions) => Promise<Empty>;
}

export interface DeviceRpcSubscriptions {
    /** Device.Watch: subscriptionまで。 */
    "device.state": (listener: (value: ConnectionState) => void) => () => void;
    /** Debug.Watch: subscriptionまで。 */
    "debug.state": (listener: (value: DebugUpdate) => void) => () => void;
    /** Sensors.Subscribe: subscriptionまで。 */
    "sensors.stream": (owner: SensorOwner) => () => void;
}

export const packetLayouts = {
    "CommandPacket": {
        "byteLength": 10,
        "offset": {
            "version": 0,
            "opcode": 1,
            "sequence": 2,
            "channel": 4,
            "reserved": 5,
            "value": 6,
            "duration": 8
        },
        "fixed": {
            "version": 1,
            "reserved": 0
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "bits": 8,
                "signed": false,
                "minimum": 0,
                "maximum": 255,
                "fixed": 1,
                "min": 0
            },
            {
                "name": "opcode",
                "offset": 1,
                "bits": 8,
                "signed": false,
                "minimum": 0,
                "maximum": 255,
                "min": 1,
                "values": [
                    1,
                    2,
                    3,
                    4,
                    5,
                    6,
                    7,
                    8,
                    9,
                    10,
                    11
                ]
            },
            {
                "name": "sequence",
                "offset": 2,
                "bits": 16,
                "signed": false,
                "minimum": 0,
                "maximum": 65535,
                "min": 0
            },
            {
                "name": "channel",
                "offset": 4,
                "bits": 8,
                "signed": false,
                "minimum": 0,
                "maximum": 255,
                "default": 255,
                "min": 0
            },
            {
                "name": "reserved",
                "offset": 5,
                "bits": 8,
                "signed": false,
                "minimum": 0,
                "maximum": 255,
                "fixed": 0,
                "min": 0
            },
            {
                "name": "value",
                "offset": 6,
                "bits": 16,
                "signed": false,
                "minimum": 0,
                "maximum": 65535,
                "default": 0,
                "min": 0
            },
            {
                "name": "duration",
                "offset": 8,
                "bits": 16,
                "signed": false,
                "minimum": 0,
                "maximum": 65535,
                "default": 0,
                "min": 0
            }
        ],
        "directions": {
            "ts": "encode",
            "cpp": "decode"
        }
    },
    "StatusPacket": {
        "byteLength": 12,
        "offset": {
            "version": 0,
            "code": 1,
            "sequence": 2,
            "flags": 4,
            "channel": 5,
            "current": 6,
            "target": 8,
            "remaining": 10
        },
        "fixed": {
            "version": 1
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "bits": 8,
                "signed": false,
                "minimum": 0,
                "maximum": 255,
                "fixed": 1,
                "min": 0
            },
            {
                "name": "code",
                "offset": 1,
                "bits": 8,
                "signed": false,
                "minimum": 0,
                "maximum": 255,
                "min": 0
            },
            {
                "name": "sequence",
                "offset": 2,
                "bits": 16,
                "signed": false,
                "minimum": 0,
                "maximum": 65535,
                "min": 0
            },
            {
                "name": "flags",
                "offset": 4,
                "bits": 8,
                "signed": false,
                "minimum": 0,
                "maximum": 255,
                "min": 0
            },
            {
                "name": "channel",
                "offset": 5,
                "bits": 8,
                "signed": false,
                "minimum": 0,
                "maximum": 255,
                "min": 0
            },
            {
                "name": "current",
                "offset": 6,
                "bits": 16,
                "signed": false,
                "minimum": 0,
                "maximum": 65535,
                "min": 0
            },
            {
                "name": "target",
                "offset": 8,
                "bits": 16,
                "signed": false,
                "minimum": 0,
                "maximum": 65535,
                "min": 0
            },
            {
                "name": "remaining",
                "offset": 10,
                "bits": 16,
                "signed": false,
                "minimum": 0,
                "maximum": 65535,
                "min": 0
            }
        ],
        "directions": {
            "ts": "decode",
            "cpp": "encode"
        }
    },
    "TelemetryHeader": {
        "byteLength": 8,
        "offset": {
            "version": 0,
            "flags": 1,
            "sequence": 2,
            "millis": 4
        },
        "fixed": {
            "version": 3
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "bits": 8,
                "signed": false,
                "minimum": 0,
                "maximum": 255,
                "fixed": 3,
                "min": 0
            },
            {
                "name": "flags",
                "offset": 1,
                "bits": 8,
                "signed": false,
                "minimum": 0,
                "maximum": 255,
                "min": 0
            },
            {
                "name": "sequence",
                "offset": 2,
                "bits": 16,
                "signed": false,
                "minimum": 0,
                "maximum": 65535,
                "min": 0
            },
            {
                "name": "millis",
                "offset": 4,
                "bits": 32,
                "signed": false,
                "minimum": 0,
                "maximum": 4294967295,
                "min": 0
            }
        ],
        "directions": {
            "ts": "",
            "cpp": ""
        }
    },
    "ImuRecord": {
        "byteLength": 13,
        "offset": {
            "deviceType": 0,
            "accX": 1,
            "accY": 3,
            "accZ": 5,
            "gyroX": 7,
            "gyroY": 9,
            "gyroZ": 11
        },
        "fixed": {},
        "fields": [
            {
                "name": "deviceType",
                "offset": 0,
                "bits": 8,
                "signed": false,
                "minimum": 0,
                "maximum": 255,
                "min": 0
            },
            {
                "name": "accX",
                "offset": 1,
                "bits": 16,
                "signed": true,
                "minimum": -32768,
                "maximum": 32767,
                "min": -32768
            },
            {
                "name": "accY",
                "offset": 3,
                "bits": 16,
                "signed": true,
                "minimum": -32768,
                "maximum": 32767,
                "min": -32768
            },
            {
                "name": "accZ",
                "offset": 5,
                "bits": 16,
                "signed": true,
                "minimum": -32768,
                "maximum": 32767,
                "min": -32768
            },
            {
                "name": "gyroX",
                "offset": 7,
                "bits": 16,
                "signed": true,
                "minimum": -32768,
                "maximum": 32767,
                "min": -32768
            },
            {
                "name": "gyroY",
                "offset": 9,
                "bits": 16,
                "signed": true,
                "minimum": -32768,
                "maximum": 32767,
                "min": -32768
            },
            {
                "name": "gyroZ",
                "offset": 11,
                "bits": 16,
                "signed": true,
                "minimum": -32768,
                "maximum": 32767,
                "min": -32768
            }
        ],
        "directions": {
            "ts": "",
            "cpp": ""
        }
    },
    "DistanceRecord": {
        "byteLength": 3,
        "offset": {
            "deviceType": 0,
            "distanceMm": 1
        },
        "fixed": {},
        "fields": [
            {
                "name": "deviceType",
                "offset": 0,
                "bits": 8,
                "signed": false,
                "minimum": 0,
                "maximum": 255,
                "min": 0
            },
            {
                "name": "distanceMm",
                "offset": 1,
                "bits": 16,
                "signed": false,
                "minimum": 0,
                "maximum": 65535,
                "min": 20
            }
        ],
        "directions": {
            "ts": "",
            "cpp": ""
        }
    }
} as const;

/** フィールドの検査と操作の対応に使う生成済み定義。 */
export const rpcMessages = {
    "CommandPacket": [
        {
            "name": "version",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 8,
            "maxLength": 0
        },
        {
            "name": "opcode",
            "type": "CommandOpcode",
            "repeated": false,
            "optional": false,
            "bits": 8,
            "maxLength": 0
        },
        {
            "name": "sequence",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 16,
            "maxLength": 0
        },
        {
            "name": "channel",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 8,
            "maxLength": 0
        },
        {
            "name": "reserved",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 8,
            "maxLength": 0
        },
        {
            "name": "value",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 16,
            "maxLength": 0
        },
        {
            "name": "duration",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 16,
            "maxLength": 0
        }
    ],
    "StatusPacket": [
        {
            "name": "version",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 8,
            "maxLength": 0
        },
        {
            "name": "code",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 8,
            "maxLength": 0
        },
        {
            "name": "sequence",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 16,
            "maxLength": 0
        },
        {
            "name": "flags",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 8,
            "maxLength": 0
        },
        {
            "name": "channel",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 8,
            "maxLength": 0
        },
        {
            "name": "current",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 16,
            "maxLength": 0
        },
        {
            "name": "target",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 16,
            "maxLength": 0
        },
        {
            "name": "remaining",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 16,
            "maxLength": 0
        }
    ],
    "TelemetryHeader": [
        {
            "name": "version",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 8,
            "maxLength": 0
        },
        {
            "name": "flags",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 8,
            "maxLength": 0
        },
        {
            "name": "sequence",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 16,
            "maxLength": 0
        },
        {
            "name": "millis",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 32,
            "maxLength": 0
        }
    ],
    "ImuRecord": [
        {
            "name": "deviceType",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 8,
            "maxLength": 0
        },
        {
            "name": "accX",
            "type": "sint32",
            "repeated": false,
            "optional": false,
            "bits": 16,
            "maxLength": 0
        },
        {
            "name": "accY",
            "type": "sint32",
            "repeated": false,
            "optional": false,
            "bits": 16,
            "maxLength": 0
        },
        {
            "name": "accZ",
            "type": "sint32",
            "repeated": false,
            "optional": false,
            "bits": 16,
            "maxLength": 0
        },
        {
            "name": "gyroX",
            "type": "sint32",
            "repeated": false,
            "optional": false,
            "bits": 16,
            "maxLength": 0
        },
        {
            "name": "gyroY",
            "type": "sint32",
            "repeated": false,
            "optional": false,
            "bits": 16,
            "maxLength": 0
        },
        {
            "name": "gyroZ",
            "type": "sint32",
            "repeated": false,
            "optional": false,
            "bits": 16,
            "maxLength": 0
        }
    ],
    "DistanceRecord": [
        {
            "name": "deviceType",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 8,
            "maxLength": 0
        },
        {
            "name": "distanceMm",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 16,
            "maxLength": 0
        }
    ],
    "Empty": [],
    "Reason": [
        {
            "name": "reason",
            "type": "string",
            "repeated": false,
            "optional": true,
            "bits": 32,
            "maxLength": 256
        }
    ],
    "Channel": [
        {
            "name": "channel",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 8,
            "maxLength": 0
        }
    ],
    "ArmRequest": [
        {
            "name": "channel",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 8,
            "maxLength": 0
        },
        {
            "name": "mode",
            "type": "string",
            "repeated": false,
            "optional": false,
            "bits": 32,
            "maxLength": 5
        }
    ],
    "MoveRequest": [
        {
            "name": "channel",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 8,
            "maxLength": 0
        },
        {
            "name": "angle",
            "type": "double",
            "repeated": false,
            "optional": false,
            "bits": 32,
            "maxLength": 0
        },
        {
            "name": "duration",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 16,
            "maxLength": 0
        }
    ],
    "SpeedRequest": [
        {
            "name": "channel",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 8,
            "maxLength": 0
        },
        {
            "name": "percent",
            "type": "double",
            "repeated": false,
            "optional": false,
            "bits": 32,
            "maxLength": 0
        }
    ],
    "UploadRequest": [
        {
            "name": "code",
            "type": "bytes",
            "repeated": false,
            "optional": false,
            "bits": 32,
            "maxLength": 131072
        },
        {
            "name": "deployment",
            "type": "Deployment",
            "repeated": false,
            "optional": true,
            "bits": 32,
            "maxLength": 0
        }
    ],
    "ProgramRequest": [
        {
            "name": "receipt",
            "type": "Receipt",
            "repeated": false,
            "optional": false,
            "bits": 32,
            "maxLength": 0
        }
    ],
    "BreakpointsRequest": [
        {
            "name": "receipt",
            "type": "Receipt",
            "repeated": false,
            "optional": false,
            "bits": 32,
            "maxLength": 0
        },
        {
            "name": "pcs",
            "type": "uint32",
            "repeated": true,
            "optional": false,
            "bits": 16,
            "maxLength": 4096
        },
        {
            "name": "stepPcs",
            "type": "uint32",
            "repeated": true,
            "optional": true,
            "bits": 16,
            "maxLength": 65536
        }
    ],
    "DebugUpdate": [
        {
            "name": "snapshot",
            "type": "Snapshot",
            "repeated": false,
            "optional": true,
            "bits": 32,
            "maxLength": 0
        },
        {
            "name": "error",
            "type": "HostError",
            "repeated": false,
            "optional": true,
            "bits": 32,
            "maxLength": 0
        },
        {
            "name": "event",
            "type": "DebugState",
            "repeated": false,
            "optional": true,
            "bits": 32,
            "maxLength": 0
        }
    ],
    "ExecuteRequest": [
        {
            "name": "receipt",
            "type": "Receipt",
            "repeated": false,
            "optional": false,
            "bits": 32,
            "maxLength": 0
        },
        {
            "name": "snapshot",
            "type": "Snapshot",
            "repeated": false,
            "optional": false,
            "bits": 32,
            "maxLength": 0
        },
        {
            "name": "action",
            "type": "string",
            "repeated": false,
            "optional": false,
            "bits": 32,
            "maxLength": 8
        }
    ],
    "WifiNetworks": [
        {
            "name": "networks",
            "type": "WifiNetwork",
            "repeated": true,
            "optional": false,
            "bits": 32,
            "maxLength": 256
        }
    ],
    "WifiConfigureRequest": [
        {
            "name": "ssid",
            "type": "string",
            "repeated": false,
            "optional": false,
            "bits": 32,
            "maxLength": 32
        },
        {
            "name": "password",
            "type": "string",
            "repeated": false,
            "optional": false,
            "bits": 32,
            "maxLength": 63
        }
    ],
    "Nonce": [
        {
            "name": "nonce",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 32,
            "maxLength": 0
        }
    ],
    "RegistryRequest": [
        {
            "name": "config",
            "type": "bytes",
            "repeated": false,
            "optional": false,
            "bits": 32,
            "maxLength": 420
        }
    ],
    "RequestId": [
        {
            "name": "id",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 32,
            "maxLength": 0
        }
    ],
    "StreamRate": [
        {
            "name": "rate",
            "type": "uint32",
            "repeated": false,
            "optional": false,
            "bits": 16,
            "maxLength": 0
        }
    ]
} as const;

export const rpcMethods = {
    "connection.connect": {
        "name": "connection.connect",
        "service": "Connection",
        "method": "Connect",
        "serviceId": 1,
        "methodId": 1,
        "transport": "local",
        "scope": "device",
        "subscription": "",
        "hasRequest": false,
        "synchronous": false,
        "priority": false,
        "completion": "connected",
        "ioTimeoutMs": 0,
        "request": "Empty",
        "response": "Empty"
    },
    "connection.disconnect": {
        "name": "connection.disconnect",
        "service": "Connection",
        "method": "Disconnect",
        "serviceId": 1,
        "methodId": 2,
        "transport": "local",
        "scope": "device",
        "subscription": "",
        "hasRequest": true,
        "synchronous": true,
        "priority": true,
        "completion": "invalidated",
        "ioTimeoutMs": 0,
        "request": "Reason",
        "response": "Empty"
    },
    "device.register": {
        "name": "device.register",
        "service": "Device",
        "method": "Register",
        "serviceId": 2,
        "methodId": 1,
        "transport": "both",
        "scope": "device",
        "subscription": "",
        "hasRequest": false,
        "synchronous": false,
        "priority": false,
        "completion": "write",
        "ioTimeoutMs": 2500,
        "request": "Empty",
        "response": "Empty"
    },
    "device.info": {
        "name": "device.info",
        "service": "Device",
        "method": "Info",
        "serviceId": 2,
        "methodId": 2,
        "transport": "both",
        "scope": "device",
        "subscription": "",
        "hasRequest": false,
        "synchronous": false,
        "priority": false,
        "completion": "ack",
        "ioTimeoutMs": 2500,
        "request": "Empty",
        "response": "Empty",
        "command": {
            "cases": [
                {
                    "opcode": "INFO",
                    "server": {
                        "status_only": true,
                        "echo_channel": true
                    }
                }
            ]
        }
    },
    "device.ping": {
        "name": "device.ping",
        "service": "Device",
        "method": "Ping",
        "serviceId": 2,
        "methodId": 3,
        "transport": "both",
        "scope": "device",
        "subscription": "",
        "hasRequest": false,
        "synchronous": false,
        "priority": false,
        "completion": "ack",
        "ioTimeoutMs": 2500,
        "request": "Empty",
        "response": "Empty",
        "command": {
            "cases": [
                {
                    "opcode": "PING",
                    "server": {
                        "status_only": true,
                        "echo_channel": true
                    }
                }
            ]
        }
    },
    "device.state": {
        "name": "device.state",
        "service": "Device",
        "method": "Watch",
        "serviceId": 2,
        "methodId": 4,
        "transport": "local",
        "scope": "device",
        "subscription": "listener",
        "hasRequest": false,
        "synchronous": false,
        "priority": false,
        "completion": "subscription",
        "ioTimeoutMs": 0,
        "request": "Empty",
        "response": "ConnectionState"
    },
    "servo.arm": {
        "name": "servo.arm",
        "service": "Servo",
        "method": "Arm",
        "serviceId": 3,
        "methodId": 1,
        "transport": "both",
        "scope": "device",
        "subscription": "",
        "hasRequest": true,
        "synchronous": false,
        "priority": false,
        "completion": "ack",
        "ioTimeoutMs": 2500,
        "request": "ArmRequest",
        "response": "Empty",
        "command": {
            "selector": "mode",
            "cases": [
                {
                    "equals": "angle",
                    "opcode": "ARM",
                    "channel": "channel",
                    "constant_value": 9000,
                    "server": {
                        "handler": "armAngle",
                        "value_name": "angle",
                        "value_scale": 100,
                        "echo_channel": true,
                        "checks": {
                            "field": "duration",
                            "max": 10000
                        },
                        "notify_io_error": true
                    }
                },
                {
                    "equals": "speed",
                    "opcode": "ARM_SPEED",
                    "channel": "channel",
                    "server": {
                        "handler": "armSpeed",
                        "echo_channel": true,
                        "checks": [
                            {
                                "field": "value",
                                "equals": 0
                            },
                            {
                                "field": "duration",
                                "equals": 0
                            }
                        ],
                        "notify_io_error": true
                    }
                }
            ]
        }
    },
    "servo.move": {
        "name": "servo.move",
        "service": "Servo",
        "method": "Move",
        "serviceId": 3,
        "methodId": 2,
        "transport": "both",
        "scope": "device",
        "subscription": "",
        "hasRequest": true,
        "synchronous": false,
        "priority": false,
        "completion": "ack",
        "ioTimeoutMs": 2500,
        "request": "MoveRequest",
        "response": "Empty",
        "command": {
            "cases": [
                {
                    "opcode": "MOVE",
                    "channel": "channel",
                    "value": "angle",
                    "scale": 100,
                    "duration": "duration",
                    "server": {
                        "handler": "move",
                        "echo_channel": true,
                        "notify_io_error": true
                    }
                }
            ]
        }
    },
    "servo.speed": {
        "name": "servo.speed",
        "service": "Servo",
        "method": "Speed",
        "serviceId": 3,
        "methodId": 3,
        "transport": "both",
        "scope": "device",
        "subscription": "",
        "hasRequest": true,
        "synchronous": false,
        "priority": false,
        "completion": "ack",
        "ioTimeoutMs": 2500,
        "request": "SpeedRequest",
        "response": "Empty",
        "command": {
            "cases": [
                {
                    "opcode": "SET_SPEED",
                    "channel": "channel",
                    "value": "percent",
                    "scale": 100,
                    "signed_value": true,
                    "server": {
                        "handler": "speed",
                        "echo_channel": true,
                        "notify_io_error": true,
                        "checks": {
                            "field": "duration",
                            "equals": 0
                        }
                    }
                }
            ]
        }
    },
    "servo.disable": {
        "name": "servo.disable",
        "service": "Servo",
        "method": "Disable",
        "serviceId": 3,
        "methodId": 4,
        "transport": "both",
        "scope": "device",
        "subscription": "",
        "hasRequest": true,
        "synchronous": false,
        "priority": false,
        "completion": "ack",
        "ioTimeoutMs": 2500,
        "request": "Channel",
        "response": "Empty",
        "command": {
            "cases": [
                {
                    "opcode": "DISABLE",
                    "channel": "channel",
                    "server": {
                        "handler": "disable",
                        "echo_channel": true
                    }
                }
            ]
        }
    },
    "servo.stop": {
        "name": "servo.stop",
        "service": "Servo",
        "method": "Stop",
        "serviceId": 3,
        "methodId": 5,
        "transport": "both",
        "scope": "device",
        "subscription": "",
        "hasRequest": false,
        "synchronous": false,
        "priority": true,
        "completion": "ack",
        "ioTimeoutMs": 2500,
        "request": "Empty",
        "response": "Empty",
        "command": {
            "cases": [
                {
                    "opcode": "STOP",
                    "server": {
                        "handler": "stop"
                    }
                }
            ]
        }
    },
    "program.upload": {
        "name": "program.upload",
        "service": "Program",
        "method": "Upload",
        "serviceId": 4,
        "methodId": 1,
        "transport": "both",
        "scope": "device",
        "subscription": "",
        "hasRequest": true,
        "synchronous": false,
        "priority": false,
        "completion": "verified-or-started",
        "ioTimeoutMs": 2500,
        "request": "UploadRequest",
        "response": "Receipt"
    },
    "program.start": {
        "name": "program.start",
        "service": "Program",
        "method": "Start",
        "serviceId": 4,
        "methodId": 2,
        "transport": "both",
        "scope": "device",
        "subscription": "",
        "hasRequest": true,
        "synchronous": false,
        "priority": false,
        "completion": "initialized",
        "ioTimeoutMs": 2500,
        "request": "ProgramRequest",
        "response": "Empty",
        "command": {
            "cases": [
                {
                    "opcode": "VM_START",
                    "server": {
                        "handler": "start",
                        "context": true,
                        "checks": [
                            {
                                "field": "channel",
                                "equals": 255
                            },
                            {
                                "field": "value",
                                "equals": 0
                            },
                            {
                                "field": "duration",
                                "equals": 0
                            }
                        ]
                    }
                }
            ]
        }
    },
    "program.stop": {
        "name": "program.stop",
        "service": "Program",
        "method": "Stop",
        "serviceId": 4,
        "methodId": 3,
        "transport": "both",
        "scope": "device",
        "subscription": "",
        "hasRequest": false,
        "synchronous": false,
        "priority": true,
        "completion": "ack",
        "ioTimeoutMs": 2500,
        "request": "Empty",
        "response": "Empty",
        "command": {
            "cases": [
                {
                    "opcode": "VM_STOP",
                    "server": {
                        "handler": "stop",
                        "context": true,
                        "checks": [
                            {
                                "field": "channel",
                                "equals": 255
                            },
                            {
                                "field": "value",
                                "equals": 0
                            },
                            {
                                "field": "duration",
                                "equals": 0
                            }
                        ]
                    }
                }
            ]
        }
    },
    "debug.breakpoints": {
        "name": "debug.breakpoints",
        "service": "Debug",
        "method": "Breakpoints",
        "serviceId": 5,
        "methodId": 1,
        "transport": "both",
        "scope": "device",
        "subscription": "",
        "hasRequest": true,
        "synchronous": false,
        "priority": false,
        "completion": "verified",
        "ioTimeoutMs": 2500,
        "request": "BreakpointsRequest",
        "response": "Empty"
    },
    "debug.observe": {
        "name": "debug.observe",
        "service": "Debug",
        "method": "Observe",
        "serviceId": 5,
        "methodId": 2,
        "transport": "both",
        "scope": "device",
        "subscription": "",
        "hasRequest": true,
        "synchronous": false,
        "priority": false,
        "completion": "observing",
        "ioTimeoutMs": 2500,
        "request": "ProgramRequest",
        "response": "Empty"
    },
    "debug.execute": {
        "name": "debug.execute",
        "service": "Debug",
        "method": "Execute",
        "serviceId": 5,
        "methodId": 3,
        "transport": "both",
        "scope": "device",
        "subscription": "",
        "hasRequest": true,
        "synchronous": false,
        "priority": false,
        "completion": "ack",
        "ioTimeoutMs": 2500,
        "request": "ExecuteRequest",
        "response": "Empty"
    },
    "debug.state": {
        "name": "debug.state",
        "service": "Debug",
        "method": "Watch",
        "serviceId": 5,
        "methodId": 4,
        "transport": "local",
        "scope": "device",
        "subscription": "listener",
        "hasRequest": false,
        "synchronous": false,
        "priority": false,
        "completion": "subscription",
        "ioTimeoutMs": 0,
        "request": "Empty",
        "response": "DebugUpdate"
    },
    "wifi.open": {
        "name": "wifi.open",
        "service": "Wifi",
        "method": "Open",
        "serviceId": 6,
        "methodId": 1,
        "transport": "local",
        "scope": "device",
        "subscription": "",
        "hasRequest": false,
        "synchronous": false,
        "priority": false,
        "completion": "dialog",
        "ioTimeoutMs": 0,
        "request": "Empty",
        "response": "Empty"
    },
    "wifi.close": {
        "name": "wifi.close",
        "service": "Wifi",
        "method": "Close",
        "serviceId": 6,
        "methodId": 2,
        "transport": "local",
        "scope": "device",
        "subscription": "",
        "hasRequest": false,
        "synchronous": true,
        "priority": true,
        "completion": "invalidated",
        "ioTimeoutMs": 0,
        "request": "Empty",
        "response": "Empty"
    },
    "wifi.info": {
        "name": "wifi.info",
        "service": "Wifi",
        "method": "Info",
        "serviceId": 6,
        "methodId": 3,
        "transport": "ble",
        "scope": "device",
        "subscription": "",
        "hasRequest": false,
        "synchronous": false,
        "priority": false,
        "completion": "reply",
        "ioTimeoutMs": 2500,
        "request": "Empty",
        "response": "WifiInfo"
    },
    "wifi.scan": {
        "name": "wifi.scan",
        "service": "Wifi",
        "method": "Scan",
        "serviceId": 6,
        "methodId": 4,
        "transport": "ble",
        "scope": "device",
        "subscription": "",
        "hasRequest": false,
        "synchronous": false,
        "priority": false,
        "completion": "scan-complete",
        "ioTimeoutMs": 2500,
        "request": "Empty",
        "response": "WifiNetworks"
    },
    "wifi.configure": {
        "name": "wifi.configure",
        "service": "Wifi",
        "method": "Configure",
        "serviceId": 6,
        "methodId": 5,
        "transport": "ble",
        "scope": "device",
        "subscription": "",
        "hasRequest": true,
        "synchronous": false,
        "priority": false,
        "completion": "configured",
        "ioTimeoutMs": 2500,
        "request": "WifiConfigureRequest",
        "response": "WifiInfo"
    },
    "wifi.forget": {
        "name": "wifi.forget",
        "service": "Wifi",
        "method": "Forget",
        "serviceId": 6,
        "methodId": 6,
        "transport": "ble",
        "scope": "device",
        "subscription": "",
        "hasRequest": false,
        "synchronous": false,
        "priority": false,
        "completion": "reply",
        "ioTimeoutMs": 2500,
        "request": "Empty",
        "response": "WifiInfo"
    },
    "wifi.connect": {
        "name": "wifi.connect",
        "service": "Wifi",
        "method": "Connect",
        "serviceId": 6,
        "methodId": 7,
        "transport": "local",
        "scope": "device",
        "subscription": "",
        "hasRequest": true,
        "synchronous": false,
        "priority": false,
        "completion": "authenticated-control",
        "ioTimeoutMs": 0,
        "request": "Endpoint",
        "response": "Empty"
    },
    "camera.capture": {
        "name": "camera.capture",
        "service": "Camera",
        "method": "Capture",
        "serviceId": 7,
        "methodId": 1,
        "transport": "wifi",
        "scope": "device",
        "subscription": "",
        "hasRequest": false,
        "synchronous": false,
        "priority": false,
        "completion": "jpeg",
        "ioTimeoutMs": 4000,
        "request": "Empty",
        "response": "Image"
    },
    "remote.open": {
        "name": "remote.open",
        "service": "Remote",
        "method": "Open",
        "serviceId": 8,
        "methodId": 1,
        "transport": "ble",
        "scope": "device",
        "subscription": "",
        "hasRequest": true,
        "synchronous": false,
        "priority": false,
        "completion": "channel",
        "ioTimeoutMs": 2500,
        "request": "Nonce",
        "response": "RemoteClient"
    },
    "registry.configure": {
        "name": "registry.configure",
        "service": "RemoteSession",
        "method": "Configure",
        "serviceId": 9,
        "methodId": 1,
        "transport": "ble",
        "scope": "remote",
        "subscription": "",
        "hasRequest": true,
        "synchronous": false,
        "priority": false,
        "completion": "registered",
        "ioTimeoutMs": 2500,
        "request": "RegistryRequest",
        "response": "Empty"
    },
    "request.read": {
        "name": "request.read",
        "service": "RemoteSession",
        "method": "Read",
        "serviceId": 9,
        "methodId": 2,
        "transport": "ble",
        "scope": "remote",
        "subscription": "",
        "hasRequest": false,
        "synchronous": false,
        "priority": false,
        "completion": "head",
        "ioTimeoutMs": 2500,
        "request": "Empty",
        "response": "RemoteRequest"
    },
    "request.acknowledge": {
        "name": "request.acknowledge",
        "service": "RemoteSession",
        "method": "Acknowledge",
        "serviceId": 9,
        "methodId": 3,
        "transport": "ble",
        "scope": "remote",
        "subscription": "",
        "hasRequest": true,
        "synchronous": false,
        "priority": false,
        "completion": "worker-accepted",
        "ioTimeoutMs": 2500,
        "request": "RequestId",
        "response": "Empty"
    },
    "registry.end": {
        "name": "registry.end",
        "service": "RemoteSession",
        "method": "End",
        "serviceId": 9,
        "methodId": 4,
        "transport": "ble",
        "scope": "remote",
        "subscription": "",
        "hasRequest": false,
        "synchronous": false,
        "priority": false,
        "completion": "unregistered",
        "ioTimeoutMs": 2500,
        "request": "Empty",
        "response": "Empty"
    },
    "sensors.stream": {
        "name": "sensors.stream",
        "service": "Sensors",
        "method": "Subscribe",
        "serviceId": 10,
        "methodId": 1,
        "transport": "local",
        "scope": "device",
        "subscription": "owner",
        "hasRequest": true,
        "synchronous": false,
        "priority": false,
        "completion": "subscription",
        "ioTimeoutMs": 0,
        "request": "SensorOwner",
        "response": "SensorSample"
    },
    "control.stream": {
        "name": "control.stream",
        "service": "Control",
        "method": "Stream",
        "serviceId": 11,
        "methodId": 1,
        "transport": "both",
        "scope": "internal",
        "subscription": "",
        "hasRequest": true,
        "synchronous": false,
        "priority": false,
        "completion": "ack",
        "ioTimeoutMs": 2500,
        "request": "StreamRate",
        "response": "Empty",
        "command": {
            "cases": [
                {
                    "opcode": "STREAM",
                    "value": "rate",
                    "server": {
                        "handler": "stream",
                        "checks": {
                            "field": "value",
                            "one_of": [
                                0,
                                5,
                                10,
                                20
                            ]
                        }
                    }
                }
            ]
        }
    }
} as const;

