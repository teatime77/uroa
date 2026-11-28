/** transport.protoから自動生成。手動編集しない。 */

import type { BytecodeChannel } from "./bytecode-transfer";

import type { DebugChannel } from "./debug-protocol";

export interface JsonEndpointFields {
    id: string;
    name: string;
    host: string;
    ip: string;
    port: number;
    wsPort: number;
    cameraPort: number;
    camera: boolean;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readEndpointFields(input: unknown): JsonEndpointFields {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        id: value.id as string,
        name: value.name as string,
        host: value.host as string,
        ip: value.ip as string,
        port: value.port as number,
        wsPort: value.wsPort as number,
        cameraPort: value.cameraPort as number,
        camera: value.camera as boolean,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeEndpointFields(value: JsonEndpointFields): JsonEndpointFields {
    return {
        id: value.id,
        name: value.name,
        host: value.host,
        ip: value.ip,
        port: value.port,
        wsPort: value.wsPort,
        cameraPort: value.cameraPort,
        camera: value.camera,
    };
}

export interface JsonProvisionStatus {
    state: string;
    error: string;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readProvisionStatus(input: unknown): JsonProvisionStatus {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        state: value.state as string,
        error: value.error as string,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeProvisionStatus(value: JsonProvisionStatus): JsonProvisionStatus {
    return {
        state: value.state,
        error: value.error,
    };
}

export interface JsonSecretField {
    key: string;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readSecretField(input: unknown): JsonSecretField {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        key: value.key as string,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeSecretField(value: JsonSecretField): JsonSecretField {
    return {
        key: value.key,
    };
}

export interface JsonProvisionQuery {
    op: string;
    page?: number;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readProvisionQuery(input: unknown): JsonProvisionQuery {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        op: value.op as string,
        page: value.page as number,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeProvisionQuery(value: JsonProvisionQuery): JsonProvisionQuery {
    return {
        op: value.op,
        page: value.page,
    };
}

export interface JsonProvisionList {
    op: "list";
    page: number;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readProvisionList(input: unknown): JsonProvisionList {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        op: value.op as "list",
        page: value.page as number,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeProvisionList(value: Omit<JsonProvisionList, "op">): JsonProvisionList {
    return {
        op: "list",
        page: value.page,
    };
}

export interface JsonProvisionConfigure {
    op: "configure";
    ssid: string;
    password: string;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readProvisionConfigure(input: unknown): JsonProvisionConfigure {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        op: value.op as "configure",
        ssid: value.ssid as string,
        password: value.password as string,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeProvisionConfigure(value: Omit<JsonProvisionConfigure, "op">): JsonProvisionConfigure {
    return {
        op: "configure",
        ssid: value.ssid,
        password: value.password,
    };
}

export interface JsonWifiNetworkRow {
    ssid: string;
    rssi: number;
    open: boolean;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readWifiNetworkRow(input: unknown): JsonWifiNetworkRow {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        ssid: value.ssid as string,
        rssi: value.rssi as number,
        open: value.open as boolean,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeWifiNetworkRow(value: JsonWifiNetworkRow): JsonWifiNetworkRow {
    return {
        ssid: value.ssid,
        rssi: value.rssi,
        open: value.open,
    };
}

export interface JsonHttpClaim {
    challenge: string;
    proof: string;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readHttpClaim(input: unknown): JsonHttpClaim {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        challenge: value.challenge as string,
        proof: value.proof as string,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeHttpClaim(value: JsonHttpClaim): JsonHttpClaim {
    return {
        challenge: value.challenge,
        proof: value.proof,
    };
}

export interface JsonSocketClaim {
    op: "claim";
    challenge: string;
    proof: string;
    origin: string;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readSocketClaim(input: unknown): JsonSocketClaim {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        op: value.op as "claim",
        challenge: value.challenge as string,
        proof: value.proof as string,
        origin: value.origin as string,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeSocketClaim(value: Omit<JsonSocketClaim, "op">): JsonSocketClaim {
    return {
        op: "claim",
        challenge: value.challenge,
        proof: value.proof,
        origin: value.origin,
    };
}

export interface JsonReadyFields {
    session: string;
    proof: string;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readReadyFields(input: unknown): JsonReadyFields {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        session: value.session as string,
        proof: value.proof as string,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeReadyFields(value: JsonReadyFields): JsonReadyFields {
    return {
        session: value.session,
        proof: value.proof,
    };
}

export interface JsonSocketCommand {
    op: string;
    session: string;
    counter: number;
    data: string;
    mac: string;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readSocketCommand(input: unknown): JsonSocketCommand {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        op: value.op as string,
        session: value.session as string,
        counter: value.counter as number,
        data: value.data as string,
        mac: value.mac as string,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeSocketCommand(value: JsonSocketCommand): JsonSocketCommand {
    return {
        op: value.op,
        session: value.session,
        counter: value.counter,
        data: value.data,
        mac: value.mac,
    };
}

export interface JsonReadReply {
    session: string;
    counter: string;
    data: string;
    proof: string;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readReadReply(input: unknown): JsonReadReply {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        session: value.session as string,
        counter: value.counter as string,
        data: value.data as string,
        proof: value.proof as string,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeReadReply(value: JsonReadReply): JsonReadReply {
    return {
        session: value.session,
        counter: value.counter,
        data: value.data,
        proof: value.proof,
    };
}

export interface JsonSignedFields {
    session: string;
    counter: string;
    proof: string;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readSignedFields(input: unknown): JsonSignedFields {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        session: value.session as string,
        counter: value.counter as string,
        proof: value.proof as string,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeSignedFields(value: JsonSignedFields): JsonSignedFields {
    return {
        session: value.session,
        counter: value.counter,
        proof: value.proof,
    };
}

export interface JsonSocketPacket {
    data: string;
    counter: number;
    proof: string;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readSocketPacket(input: unknown): JsonSocketPacket {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        data: value.data as string,
        counter: value.counter as number,
        proof: value.proof as string,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeSocketPacket(value: JsonSocketPacket): JsonSocketPacket {
    return {
        data: value.data,
        counter: value.counter,
        proof: value.proof,
    };
}

export interface JsonEventsReply {
    packets: readonly string[];
    session: string;
    counter: string;
    proof: string;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readEventsReply(input: unknown): JsonEventsReply {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        packets: value.packets as readonly string[],
        session: value.session as string,
        counter: value.counter as string,
        proof: value.proof as string,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeEventsReply(value: JsonEventsReply): JsonEventsReply {
    return {
        packets: value.packets,
        session: value.session,
        counter: value.counter,
        proof: value.proof,
    };
}

export interface JsonAccepted {
    accepted: true;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readAccepted(input: unknown): JsonAccepted {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        accepted: value.accepted as true,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeAccepted(value: Omit<JsonAccepted, "accepted">): JsonAccepted {
    return {
        accepted: true,
    };
}

export interface JsonRawBytes {
    data: string;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readRawBytes(input: unknown): JsonRawBytes {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        data: value.data as string,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeRawBytes(value: JsonRawBytes): JsonRawBytes {
    return {
        data: value.data,
    };
}

export interface JsonChallengeFields {
    challenge: string;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readChallengeFields(input: unknown): JsonChallengeFields {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        challenge: value.challenge as string,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeChallengeFields(value: JsonChallengeFields): JsonChallengeFields {
    return {
        challenge: value.challenge,
    };
}

export interface JsonListPaging {
    pages: number;
}

/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function readListPaging(input: unknown): JsonListPaging {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
        pages: value.pages as number,
    };
}

/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function makeListPaging(value: JsonListPaging): JsonListPaging {
    return {
        pages: value.pages,
    };
}

export const provisionOps = {
    "info": "info",
    "scan": "scan",
    "list": "list",
    "configure": "configure",
    "forget": "forget"
} as const;

export const transportRoutes = {
    "Info": {
        "name": "Info",
        "op": "",
        "min_bytes": 0,
        "max_bytes": 0,
        "path": "/info",
        "verb": "GET",
        "server_method": "info"
    },
    "Claim": {
        "name": "Claim",
        "op": "",
        "min_bytes": 0,
        "max_bytes": 0,
        "path": "/claim",
        "verb": "POST",
        "server_method": "claimHTTP"
    },
    "Command": {
        "name": "Command",
        "op": "command",
        "min_bytes": 10,
        "max_bytes": 10,
        "path": "/command",
        "verb": "POST",
        "authenticated": true,
        "callback": "command",
        "required": true,
        "stack_buffer": true,
        "server_method": "controlHTTP"
    },
    "DeviceInfo": {
        "name": "DeviceInfo",
        "op": "device-info",
        "min_bytes": 0,
        "max_bytes": 20,
        "path": "/device-info",
        "verb": "POST",
        "authenticated": true,
        "callback": "deviceInfo",
        "server_method": "controlHTTP"
    },
    "Bytecode": {
        "name": "Bytecode",
        "op": "bytecode",
        "min_bytes": 10,
        "max_bytes": 1024,
        "path": "/bytecode",
        "verb": "POST",
        "authenticated": true,
        "callback": "bytecode",
        "channel": "Bytecode",
        "client_method": "write",
        "server_method": "controlHTTP"
    },
    "BytecodeResult": {
        "name": "BytecodeResult",
        "op": "",
        "min_bytes": 20,
        "max_bytes": 20,
        "path": "/bytecode-result",
        "verb": "GET",
        "authenticated": true,
        "storage": "bytecodeResult_",
        "channel": "Bytecode",
        "client_method": "readResult",
        "server_method": "controlValueHTTP"
    },
    "DebugControl": {
        "name": "DebugControl",
        "op": "debug-control",
        "min_bytes": 8,
        "max_bytes": 20,
        "path": "/debug-control",
        "verb": "POST",
        "authenticated": true,
        "callback": "debug",
        "channel": "Debug",
        "client_method": "writeControl",
        "server_method": "controlHTTP"
    },
    "DebugResult": {
        "name": "DebugResult",
        "op": "",
        "min_bytes": 20,
        "max_bytes": 20,
        "path": "/debug-result",
        "verb": "GET",
        "authenticated": true,
        "storage": "debugResult_",
        "channel": "Debug",
        "client_method": "readResult",
        "server_method": "controlValueHTTP"
    },
    "DebugEvent": {
        "name": "DebugEvent",
        "op": "",
        "min_bytes": 20,
        "max_bytes": 20,
        "path": "/debug-event",
        "verb": "GET",
        "authenticated": true,
        "storage": "debugEvent_",
        "channel": "Debug",
        "client_method": "readEvent",
        "server_method": "controlValueHTTP"
    },
    "DebugData": {
        "name": "DebugData",
        "op": "",
        "min_bytes": 1,
        "max_bytes": 20,
        "path": "/debug-data",
        "verb": "GET",
        "authenticated": true,
        "storage": "debugData_",
        "channel": "Debug",
        "client_method": "readData",
        "server_method": "controlValueHTTP"
    },
    "Events": {
        "name": "Events",
        "op": "",
        "min_bytes": 0,
        "max_bytes": 0,
        "path": "/events",
        "verb": "GET",
        "authenticated": true,
        "server_method": "eventsHTTP"
    },
    "Release": {
        "name": "Release",
        "op": "",
        "min_bytes": 0,
        "max_bytes": 0,
        "path": "/release",
        "verb": "POST",
        "authenticated": true,
        "server_method": "releaseHTTP"
    },
    "Capture": {
        "name": "Capture",
        "op": "",
        "min_bytes": 0,
        "max_bytes": 1048576,
        "path": "/capture",
        "verb": "GET",
        "authenticated": true,
        "mime": "image/jpeg",
        "camera": true,
        "server_method": "imageHTTP"
    }
} as const;

export type TransportResource = typeof transportRoutes[keyof typeof transportRoutes];

export const signedReadPaths: readonly string[] = ["/bytecode-result","/debug-result","/debug-event","/debug-data","/events"];

/** 接続世代のcheckと既存の署名付きI/Oへ生成した窓口を接続する。 */
export function createBytecodeChannel(check: () => void, write: (route: TransportResource, bytes: Uint8Array) => Promise<void>,
    read: (route: TransportResource) => Promise<DataView>): BytecodeChannel {
    return {
        packetLength: 1024,
        write: async bytes => {
            check();
            if (bytes.byteLength < 10 || bytes.byteLength > 1024) {
                throw new Error("送信サイズが窓口の範囲外です。");
            }
            await write(transportRoutes.Bytecode, bytes);
        },
        readResult: () => {
            check();
            return read(transportRoutes.BytecodeResult);
        },
    };
}

/** 接続世代のcheckと既存の署名付きI/Oへ生成した窓口を接続する。 */
export function createDebugChannel(check: () => void, write: (route: TransportResource, bytes: Uint8Array) => Promise<void>,
    read: (route: TransportResource) => Promise<DataView>): DebugChannel {
    return {

        writeControl: async bytes => {
            check();
            if (bytes.byteLength < 8 || bytes.byteLength > 20) {
                throw new Error("送信サイズが窓口の範囲外です。");
            }
            await write(transportRoutes.DebugControl, bytes);
        },
        readResult: () => {
            check();
            return read(transportRoutes.DebugResult);
        },
        readEvent: () => {
            check();
            return read(transportRoutes.DebugEvent);
        },
        readData: () => {
            check();
            return read(transportRoutes.DebugData);
        },
    };
}
