/** wire.proto/device.protoから自動生成。手動編集せずgenerate.mjsを実行する。 */

import { RpcCode, RpcError } from "./rpc-client";

/** byteOffsetを持つビューも扱う。読み出したbytesは元バッファーを借用する。 */

export const wireLayouts = {
    "TransferHeader": {
        "byteLength": 10,
        "offset": {
            "version": 0,
            "op": 1,
            "transfer": 2,
            "sequence": 4,
            "position": 6
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "op",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "transfer",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "sequence",
                "offset": 4,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "position",
                "offset": 6,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "TransferBegin": {
        "byteLength": 14,
        "offset": {
            "version": 0,
            "op": 1,
            "transfer": 2,
            "sequence": 4,
            "position": 6,
            "crc": 10
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "op",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "transfer",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "sequence",
                "offset": 4,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "position",
                "offset": 6,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "crc",
                "offset": 10,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "TransferResult": {
        "byteLength": 20,
        "offset": {
            "version": 0,
            "code": 1,
            "transfer": 2,
            "frame": 4,
            "op": 6,
            "state": 7,
            "received": 8,
            "revision": 12,
            "crc": 16
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "code",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "transfer",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "frame",
                "offset": 4,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "op",
                "offset": 6,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "state",
                "offset": 7,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "received",
                "offset": 8,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "revision",
                "offset": 12,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "crc",
                "offset": 16,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "BundleHeader": {
        "byteLength": 24,
        "offset": {
            "signature": 0,
            "version": 4,
            "flags": 6,
            "length": 8,
            "breakpoints": 12,
            "points": 16,
            "crc": 20
        },
        "fields": [
            {
                "name": "signature",
                "offset": 0,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "version",
                "offset": 4,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "flags",
                "offset": 6,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "length",
                "offset": 8,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "breakpoints",
                "offset": 12,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "points",
                "offset": 16,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "crc",
                "offset": 20,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "DebugHeader": {
        "byteLength": 8,
        "offset": {
            "version": 0,
            "op": 1,
            "request": 2,
            "revision": 4
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "op",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "request",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "revision",
                "offset": 4,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "DebugBegin": {
        "byteLength": 20,
        "offset": {
            "version": 0,
            "op": 1,
            "request": 2,
            "revision": 4,
            "count": 8,
            "crc": 12,
            "imageCrc": 16
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "op",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "request",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "revision",
                "offset": 4,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "count",
                "offset": 8,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "crc",
                "offset": 12,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "imageCrc",
                "offset": 16,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "DebugData": {
        "byteLength": 12,
        "offset": {
            "version": 0,
            "op": 1,
            "request": 2,
            "revision": 4,
            "index": 8
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "op",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "request",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "revision",
                "offset": 4,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "index",
                "offset": 8,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "DebugChunk": {
        "byteLength": 16,
        "offset": {
            "version": 0,
            "op": 1,
            "request": 2,
            "revision": 4,
            "stopId": 8,
            "offset": 12
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "op",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "request",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "revision",
                "offset": 4,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "stopId",
                "offset": 8,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "offset",
                "offset": 12,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "DebugExecute": {
        "byteLength": 12,
        "offset": {
            "version": 0,
            "op": 1,
            "request": 2,
            "revision": 4,
            "stopId": 8
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "op",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "request",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "revision",
                "offset": 4,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "stopId",
                "offset": 8,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "DebugResult": {
        "byteLength": 20,
        "offset": {
            "version": 0,
            "op": 1,
            "request": 2,
            "code": 4,
            "state": 5,
            "reserved": 6,
            "revision": 8,
            "value": 12,
            "extra": 16
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "op",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "request",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "code",
                "offset": 4,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "state",
                "offset": 5,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "reserved",
                "offset": 6,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "revision",
                "offset": 8,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "value",
                "offset": 12,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "extra",
                "offset": 16,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "DebugEvent": {
        "byteLength": 20,
        "offset": {
            "version": 0,
            "state": 1,
            "code": 2,
            "error": 3,
            "stopId": 4,
            "revision": 8,
            "size": 12,
            "crc": 16
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "state",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "code",
                "offset": 2,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "error",
                "offset": 3,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "stopId",
                "offset": 4,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "revision",
                "offset": 8,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "size",
                "offset": 12,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "crc",
                "offset": 16,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "SnapshotHeader": {
        "byteLength": 24,
        "offset": {
            "version": 0,
            "reason": 1,
            "slotBytes": 2,
            "pc": 4,
            "bp": 8,
            "sp": 12,
            "globals": 16,
            "stack": 20
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "reason",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "slotBytes",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "pc",
                "offset": 4,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "bp",
                "offset": 8,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "sp",
                "offset": 12,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "globals",
                "offset": 16,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "stack",
                "offset": 20,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "SnapshotValue": {
        "byteLength": 8,
        "offset": {
            "tag": 0,
            "reserved": 1,
            "classId": 2,
            "payload": 4
        },
        "fields": [
            {
                "name": "tag",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "reserved",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "classId",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "payload",
                "offset": 4,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "StringHeader": {
        "byteLength": 8,
        "offset": {
            "id": 0,
            "length": 4
        },
        "fields": [
            {
                "name": "id",
                "offset": 0,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "length",
                "offset": 4,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "Word32": {
        "byteLength": 4,
        "offset": {
            "value": 0
        },
        "fields": [
            {
                "name": "value",
                "offset": 0,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "Pc": {
        "byteLength": 2,
        "offset": {
            "value": 0
        },
        "fields": [
            {
                "name": "value",
                "offset": 0,
                "length": 2,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "RemoteHeader": {
        "byteLength": 8,
        "offset": {
            "version": 0,
            "op": 1,
            "sequence": 2,
            "nonce": 4
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "op",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "sequence",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "nonce",
                "offset": 4,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "RemoteBegin": {
        "byteLength": 14,
        "offset": {
            "version": 0,
            "op": 1,
            "sequence": 2,
            "nonce": 4,
            "total": 8,
            "crc": 10
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "op",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "sequence",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "nonce",
                "offset": 4,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "total",
                "offset": 8,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "crc",
                "offset": 10,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "RemoteData": {
        "byteLength": 10,
        "offset": {
            "version": 0,
            "op": 1,
            "sequence": 2,
            "nonce": 4,
            "offset": 8
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "op",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "sequence",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "nonce",
                "offset": 4,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "offset",
                "offset": 8,
                "length": 2,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "RemoteAck": {
        "byteLength": 12,
        "offset": {
            "version": 0,
            "op": 1,
            "sequence": 2,
            "nonce": 4,
            "id": 8
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "op",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "sequence",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "nonce",
                "offset": 4,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "id",
                "offset": 8,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "RemoteResult": {
        "byteLength": 20,
        "offset": {
            "version": 0,
            "op": 1,
            "sequence": 2,
            "nonce": 4,
            "code": 8,
            "state": 9,
            "received": 10,
            "reserved": 12,
            "extra": 16
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "op",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "sequence",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "nonce",
                "offset": 4,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "code",
                "offset": 8,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "state",
                "offset": 9,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "received",
                "offset": 10,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "reserved",
                "offset": 12,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "extra",
                "offset": 16,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "RemoteEvent": {
        "byteLength": 20,
        "offset": {
            "version": 0,
            "kind": 1,
            "nonce": 2,
            "id": 6,
            "object": 10,
            "method": 12,
            "argc": 14,
            "error": 15,
            "value": 16
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "kind",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "nonce",
                "offset": 2,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "id",
                "offset": 6,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "object",
                "offset": 10,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "method",
                "offset": 12,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "argc",
                "offset": 14,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "error",
                "offset": 15,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "value",
                "offset": 16,
                "length": 4,
                "bytes": false,
                "signed": true
            }
        ]
    },
    "RegistryHeader": {
        "byteLength": 100,
        "offset": {
            "version": 0,
            "count": 1,
            "reserved": 2,
            "baseHash": 4,
            "rpcHash": 36,
            "registryHash": 68
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "count",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "reserved",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "baseHash",
                "offset": 4,
                "length": 32,
                "bytes": true,
                "signed": false
            },
            {
                "name": "rpcHash",
                "offset": 36,
                "length": 32,
                "bytes": true,
                "signed": false
            },
            {
                "name": "registryHash",
                "offset": 68,
                "length": 32,
                "bytes": true,
                "signed": false
            }
        ]
    },
    "RegistryRecord": {
        "byteLength": 10,
        "offset": {
            "native": 0,
            "object": 2,
            "method": 4,
            "classId": 6,
            "argc": 8,
            "reserved": 9
        },
        "fields": [
            {
                "name": "native",
                "offset": 0,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "object",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "method",
                "offset": 4,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "classId",
                "offset": 6,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "argc",
                "offset": 8,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "reserved",
                "offset": 9,
                "length": 1,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "ProvisionFrame": {
        "byteLength": 1,
        "offset": {
            "op": 0
        },
        "fields": [
            {
                "name": "op",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "DeviceTag": {
        "byteLength": 1,
        "offset": {
            "deviceType": 0
        },
        "fields": [
            {
                "name": "deviceType",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "DeviceServo": {
        "byteLength": 3,
        "offset": {
            "deviceType": 0,
            "channel": 1,
            "mode": 2
        },
        "fields": [
            {
                "name": "deviceType",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "channel",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "mode",
                "offset": 2,
                "length": 1,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "RemoteBeginBody": {
        "byteLength": 6,
        "offset": {
            "total": 0,
            "crc": 2
        },
        "fields": [
            {
                "name": "total",
                "offset": 0,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "crc",
                "offset": 2,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "Offset16": {
        "byteLength": 2,
        "offset": {
            "value": 0
        },
        "fields": [
            {
                "name": "value",
                "offset": 0,
                "length": 2,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "DebugListBody": {
        "byteLength": 12,
        "offset": {
            "count": 0,
            "crc": 4,
            "imageCrc": 8
        },
        "fields": [
            {
                "name": "count",
                "offset": 0,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "crc",
                "offset": 4,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "imageCrc",
                "offset": 8,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "DebugChunkBody": {
        "byteLength": 8,
        "offset": {
            "stopId": 0,
            "offset": 4
        },
        "fields": [
            {
                "name": "stopId",
                "offset": 0,
                "length": 4,
                "bytes": false,
                "signed": false
            },
            {
                "name": "offset",
                "offset": 4,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
    },
    "TelemetryHeader": {
        "byteLength": 8,
        "offset": {
            "version": 0,
            "flags": 1,
            "sequence": 2,
            "millis": 4
        },
        "fields": [
            {
                "name": "version",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "flags",
                "offset": 1,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "sequence",
                "offset": 2,
                "length": 2,
                "bytes": false,
                "signed": false
            },
            {
                "name": "millis",
                "offset": 4,
                "length": 4,
                "bytes": false,
                "signed": false
            }
        ]
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
        "fields": [
            {
                "name": "deviceType",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "accX",
                "offset": 1,
                "length": 2,
                "bytes": false,
                "signed": true
            },
            {
                "name": "accY",
                "offset": 3,
                "length": 2,
                "bytes": false,
                "signed": true
            },
            {
                "name": "accZ",
                "offset": 5,
                "length": 2,
                "bytes": false,
                "signed": true
            },
            {
                "name": "gyroX",
                "offset": 7,
                "length": 2,
                "bytes": false,
                "signed": true
            },
            {
                "name": "gyroY",
                "offset": 9,
                "length": 2,
                "bytes": false,
                "signed": true
            },
            {
                "name": "gyroZ",
                "offset": 11,
                "length": 2,
                "bytes": false,
                "signed": true
            }
        ]
    },
    "DistanceRecord": {
        "byteLength": 3,
        "offset": {
            "deviceType": 0,
            "distanceMm": 1
        },
        "fields": [
            {
                "name": "deviceType",
                "offset": 0,
                "length": 1,
                "bytes": false,
                "signed": false
            },
            {
                "name": "distanceMm",
                "offset": 1,
                "length": 2,
                "bytes": false,
                "signed": false
            }
        ]
    }
} as const;

export const wireDefaults = {
    "TransferHeader": {
        "version": 2
    },
    "TransferBegin": {
        "version": 2
    },
    "TransferResult": {
        "version": 2
    },
    "BundleHeader": {
        "version": 1
    },
    "DebugHeader": {
        "version": 1
    },
    "DebugBegin": {
        "version": 1
    },
    "DebugData": {
        "version": 1
    },
    "DebugChunk": {
        "version": 1
    },
    "DebugExecute": {
        "version": 1
    },
    "DebugResult": {
        "version": 1
    },
    "DebugEvent": {
        "version": 2
    },
    "SnapshotHeader": {
        "version": 6
    },
    "SnapshotValue": {},
    "StringHeader": {},
    "Word32": {},
    "Pc": {},
    "RemoteHeader": {
        "version": 1
    },
    "RemoteBegin": {
        "version": 1
    },
    "RemoteData": {
        "version": 1
    },
    "RemoteAck": {
        "version": 1
    },
    "RemoteResult": {
        "version": 1
    },
    "RemoteEvent": {
        "version": 1
    },
    "RegistryHeader": {
        "version": 1
    },
    "RegistryRecord": {},
    "ProvisionFrame": {},
    "DeviceTag": {},
    "DeviceServo": {},
    "RemoteBeginBody": {},
    "Offset16": {},
    "DebugListBody": {},
    "DebugChunkBody": {},
    "TelemetryHeader": {
        "version": 3
    },
    "ImuRecord": {},
    "DistanceRecord": {}
} as const;

export const wireBounds = {
    "TransferHeader": {
        "version": {},
        "op": {},
        "transfer": {},
        "sequence": {},
        "position": {}
    },
    "TransferBegin": {
        "version": {},
        "op": {},
        "transfer": {},
        "sequence": {},
        "position": {},
        "crc": {}
    },
    "TransferResult": {
        "version": {},
        "code": {},
        "transfer": {},
        "frame": {},
        "op": {},
        "state": {},
        "received": {},
        "revision": {},
        "crc": {}
    },
    "BundleHeader": {
        "signature": {},
        "version": {},
        "flags": {},
        "length": {},
        "breakpoints": {},
        "points": {},
        "crc": {}
    },
    "DebugHeader": {
        "version": {},
        "op": {},
        "request": {},
        "revision": {}
    },
    "DebugBegin": {
        "version": {},
        "op": {},
        "request": {},
        "revision": {},
        "count": {},
        "crc": {},
        "imageCrc": {}
    },
    "DebugData": {
        "version": {},
        "op": {},
        "request": {},
        "revision": {},
        "index": {}
    },
    "DebugChunk": {
        "version": {},
        "op": {},
        "request": {},
        "revision": {},
        "stopId": {},
        "offset": {}
    },
    "DebugExecute": {
        "version": {},
        "op": {},
        "request": {},
        "revision": {},
        "stopId": {}
    },
    "DebugResult": {
        "version": {},
        "op": {},
        "request": {},
        "code": {},
        "state": {},
        "reserved": {},
        "revision": {},
        "value": {},
        "extra": {}
    },
    "DebugEvent": {
        "version": {},
        "state": {},
        "code": {},
        "error": {},
        "stopId": {},
        "revision": {},
        "size": {},
        "crc": {}
    },
    "SnapshotHeader": {
        "version": {},
        "reason": {},
        "slotBytes": {},
        "pc": {},
        "bp": {},
        "sp": {},
        "globals": {},
        "stack": {}
    },
    "SnapshotValue": {
        "tag": {},
        "reserved": {},
        "classId": {},
        "payload": {}
    },
    "StringHeader": {
        "id": {},
        "length": {}
    },
    "Word32": {
        "value": {}
    },
    "Pc": {
        "value": {}
    },
    "RemoteHeader": {
        "version": {},
        "op": {},
        "sequence": {},
        "nonce": {}
    },
    "RemoteBegin": {
        "version": {},
        "op": {},
        "sequence": {},
        "nonce": {},
        "total": {},
        "crc": {}
    },
    "RemoteData": {
        "version": {},
        "op": {},
        "sequence": {},
        "nonce": {},
        "offset": {}
    },
    "RemoteAck": {
        "version": {},
        "op": {},
        "sequence": {},
        "nonce": {},
        "id": {}
    },
    "RemoteResult": {
        "version": {},
        "op": {},
        "sequence": {},
        "nonce": {},
        "code": {},
        "state": {},
        "received": {},
        "reserved": {},
        "extra": {}
    },
    "RemoteEvent": {
        "version": {},
        "kind": {},
        "nonce": {},
        "id": {},
        "object": {},
        "method": {},
        "argc": {},
        "error": {},
        "value": {}
    },
    "RegistryHeader": {
        "version": {},
        "count": {},
        "reserved": {},
        "baseHash": {},
        "rpcHash": {},
        "registryHash": {}
    },
    "RegistryRecord": {
        "native": {},
        "object": {},
        "method": {},
        "classId": {},
        "argc": {},
        "reserved": {}
    },
    "ProvisionFrame": {
        "op": {}
    },
    "DeviceTag": {
        "deviceType": {}
    },
    "DeviceServo": {
        "deviceType": {},
        "channel": {
            "max_value": 15
        },
        "mode": {
            "max_value": 1
        }
    },
    "RemoteBeginBody": {
        "total": {},
        "crc": {}
    },
    "Offset16": {
        "value": {}
    },
    "DebugListBody": {
        "count": {},
        "crc": {},
        "imageCrc": {}
    },
    "DebugChunkBody": {
        "stopId": {},
        "offset": {}
    },
    "TelemetryHeader": {
        "version": {},
        "flags": {},
        "sequence": {},
        "millis": {}
    },
    "ImuRecord": {
        "deviceType": {},
        "accX": {},
        "accY": {},
        "accZ": {},
        "gyroX": {},
        "gyroY": {},
        "gyroZ": {}
    },
    "DistanceRecord": {
        "deviceType": {},
        "distanceMm": {
            "min_value": 20,
            "max_value": 4000,
            "sentinel": 65535
        }
    }
} as const;

export const gattUuids = {
    "service": "f3641400-00b0-4240-ba50-05ca45bf8abc",
    "command": "f3641401-00b0-4240-ba50-05ca45bf8abc",
    "telemetry": "f3641402-00b0-4240-ba50-05ca45bf8abc",
    "status": "f3641403-00b0-4240-ba50-05ca45bf8abc",
    "wifiConfig": "f3641404-00b0-4240-ba50-05ca45bf8abc",
    "wifiResult": "f3641405-00b0-4240-ba50-05ca45bf8abc",
    "deviceInfo": "f3641406-00b0-4240-ba50-05ca45bf8abc",
    "bytecode": "f3641407-00b0-4240-ba50-05ca45bf8abc",
    "bytecodeResult": "f3641408-00b0-4240-ba50-05ca45bf8abc",
    "debugControl": "f3641409-00b0-4240-ba50-05ca45bf8abc",
    "debugResult": "f364140a-00b0-4240-ba50-05ca45bf8abc",
    "debugEvent": "f364140b-00b0-4240-ba50-05ca45bf8abc",
    "debugData": "f364140c-00b0-4240-ba50-05ca45bf8abc",
    "rpcControl": "f364140d-00b0-4240-ba50-05ca45bf8abc",
    "rpcResult": "f364140e-00b0-4240-ba50-05ca45bf8abc",
    "rpcEvent": "f364140f-00b0-4240-ba50-05ca45bf8abc"
} as const;

/** 値の意味・タグ別制約は所有者が検査する。生ビットの解釈だけを共通化する。 */
export function wireInt32(bits: number): number {
    return bits | 0;
}
export function wireFloat32(bits: number): number {
    const view = new DataView(new ArrayBuffer(4));
    view.setUint32(0, bits, true);
    return view.getFloat32(0, true);
}
/** 生成したフィールドだけを読み書きする。可変長本体は呼出元が保持・検証する。 */
function region(view: DataView, offset: number, length: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset + length > view.byteLength) {
        throw new RpcError(RpcCode.InvalidArgument, "wire領域の長さが不正です。");
    }
}

export interface WireTransferHeader {
    version: number;
    op: number;
    transfer: number;
    sequence: number;
    position: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readTransferHeader(view: DataView, offset = 0): WireTransferHeader {
    region(view, offset, 10);
    return {
        version: view.getUint8(offset + 0),
        op: view.getUint8(offset + 1),
        transfer: view.getUint16(offset + 2, true),
        sequence: view.getUint16(offset + 4, true),
        position: view.getUint32(offset + 6, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeTransferHeader(view: DataView, offset: number, packet: WireTransferHeader): void {
    region(view, offset, 10);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferHeader.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.op) || packet.op < 0 || packet.op > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferHeader.opが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.op);
    if (!Number.isInteger(packet.transfer) || packet.transfer < 0 || packet.transfer > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferHeader.transferが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.transfer, true);
    if (!Number.isInteger(packet.sequence) || packet.sequence < 0 || packet.sequence > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferHeader.sequenceが整数幅の範囲外です。");
    }
    view.setUint16(offset + 4, packet.sequence, true);
    if (!Number.isInteger(packet.position) || packet.position < 0 || packet.position > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferHeader.positionが整数幅の範囲外です。");
    }
    view.setUint32(offset + 6, packet.position, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeTransferHeader(packet: WireTransferHeader, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(10 + (tail?.byteLength ?? 0));
    writeTransferHeader(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 10);
    }
    return bytes;
}

export interface WireTransferBegin {
    version: number;
    op: number;
    transfer: number;
    sequence: number;
    position: number;
    crc: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readTransferBegin(view: DataView, offset = 0): WireTransferBegin {
    region(view, offset, 14);
    return {
        version: view.getUint8(offset + 0),
        op: view.getUint8(offset + 1),
        transfer: view.getUint16(offset + 2, true),
        sequence: view.getUint16(offset + 4, true),
        position: view.getUint32(offset + 6, true),
        crc: view.getUint32(offset + 10, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeTransferBegin(view: DataView, offset: number, packet: WireTransferBegin): void {
    region(view, offset, 14);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferBegin.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.op) || packet.op < 0 || packet.op > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferBegin.opが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.op);
    if (!Number.isInteger(packet.transfer) || packet.transfer < 0 || packet.transfer > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferBegin.transferが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.transfer, true);
    if (!Number.isInteger(packet.sequence) || packet.sequence < 0 || packet.sequence > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferBegin.sequenceが整数幅の範囲外です。");
    }
    view.setUint16(offset + 4, packet.sequence, true);
    if (!Number.isInteger(packet.position) || packet.position < 0 || packet.position > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferBegin.positionが整数幅の範囲外です。");
    }
    view.setUint32(offset + 6, packet.position, true);
    if (!Number.isInteger(packet.crc) || packet.crc < 0 || packet.crc > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferBegin.crcが整数幅の範囲外です。");
    }
    view.setUint32(offset + 10, packet.crc, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeTransferBegin(packet: WireTransferBegin, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(14 + (tail?.byteLength ?? 0));
    writeTransferBegin(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 14);
    }
    return bytes;
}

export interface WireTransferResult {
    version: number;
    code: number;
    transfer: number;
    frame: number;
    op: number;
    state: number;
    received: number;
    revision: number;
    crc: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readTransferResult(view: DataView, offset = 0): WireTransferResult {
    region(view, offset, 20);
    return {
        version: view.getUint8(offset + 0),
        code: view.getUint8(offset + 1),
        transfer: view.getUint16(offset + 2, true),
        frame: view.getUint16(offset + 4, true),
        op: view.getUint8(offset + 6),
        state: view.getUint8(offset + 7),
        received: view.getUint32(offset + 8, true),
        revision: view.getUint32(offset + 12, true),
        crc: view.getUint32(offset + 16, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeTransferResult(view: DataView, offset: number, packet: WireTransferResult): void {
    region(view, offset, 20);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferResult.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.code) || packet.code < 0 || packet.code > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferResult.codeが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.code);
    if (!Number.isInteger(packet.transfer) || packet.transfer < 0 || packet.transfer > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferResult.transferが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.transfer, true);
    if (!Number.isInteger(packet.frame) || packet.frame < 0 || packet.frame > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferResult.frameが整数幅の範囲外です。");
    }
    view.setUint16(offset + 4, packet.frame, true);
    if (!Number.isInteger(packet.op) || packet.op < 0 || packet.op > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferResult.opが整数幅の範囲外です。");
    }
    view.setUint8(offset + 6, packet.op);
    if (!Number.isInteger(packet.state) || packet.state < 0 || packet.state > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferResult.stateが整数幅の範囲外です。");
    }
    view.setUint8(offset + 7, packet.state);
    if (!Number.isInteger(packet.received) || packet.received < 0 || packet.received > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferResult.receivedが整数幅の範囲外です。");
    }
    view.setUint32(offset + 8, packet.received, true);
    if (!Number.isInteger(packet.revision) || packet.revision < 0 || packet.revision > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferResult.revisionが整数幅の範囲外です。");
    }
    view.setUint32(offset + 12, packet.revision, true);
    if (!Number.isInteger(packet.crc) || packet.crc < 0 || packet.crc > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "TransferResult.crcが整数幅の範囲外です。");
    }
    view.setUint32(offset + 16, packet.crc, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeTransferResult(packet: WireTransferResult, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(20 + (tail?.byteLength ?? 0));
    writeTransferResult(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 20);
    }
    return bytes;
}

export interface WireBundleHeader {
    signature: number;
    version: number;
    flags: number;
    length: number;
    breakpoints: number;
    points: number;
    crc: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readBundleHeader(view: DataView, offset = 0): WireBundleHeader {
    region(view, offset, 24);
    return {
        signature: view.getUint32(offset + 0, true),
        version: view.getUint16(offset + 4, true),
        flags: view.getUint16(offset + 6, true),
        length: view.getUint32(offset + 8, true),
        breakpoints: view.getUint32(offset + 12, true),
        points: view.getUint32(offset + 16, true),
        crc: view.getUint32(offset + 20, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeBundleHeader(view: DataView, offset: number, packet: WireBundleHeader): void {
    region(view, offset, 24);
    if (!Number.isInteger(packet.signature) || packet.signature < 0 || packet.signature > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "BundleHeader.signatureが整数幅の範囲外です。");
    }
    view.setUint32(offset + 0, packet.signature, true);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "BundleHeader.versionが整数幅の範囲外です。");
    }
    view.setUint16(offset + 4, packet.version, true);
    if (!Number.isInteger(packet.flags) || packet.flags < 0 || packet.flags > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "BundleHeader.flagsが整数幅の範囲外です。");
    }
    view.setUint16(offset + 6, packet.flags, true);
    if (!Number.isInteger(packet.length) || packet.length < 0 || packet.length > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "BundleHeader.lengthが整数幅の範囲外です。");
    }
    view.setUint32(offset + 8, packet.length, true);
    if (!Number.isInteger(packet.breakpoints) || packet.breakpoints < 0 || packet.breakpoints > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "BundleHeader.breakpointsが整数幅の範囲外です。");
    }
    view.setUint32(offset + 12, packet.breakpoints, true);
    if (!Number.isInteger(packet.points) || packet.points < 0 || packet.points > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "BundleHeader.pointsが整数幅の範囲外です。");
    }
    view.setUint32(offset + 16, packet.points, true);
    if (!Number.isInteger(packet.crc) || packet.crc < 0 || packet.crc > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "BundleHeader.crcが整数幅の範囲外です。");
    }
    view.setUint32(offset + 20, packet.crc, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeBundleHeader(packet: WireBundleHeader, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(24 + (tail?.byteLength ?? 0));
    writeBundleHeader(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 24);
    }
    return bytes;
}

export interface WireDebugHeader {
    version: number;
    op: number;
    request: number;
    revision: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readDebugHeader(view: DataView, offset = 0): WireDebugHeader {
    region(view, offset, 8);
    return {
        version: view.getUint8(offset + 0),
        op: view.getUint8(offset + 1),
        request: view.getUint16(offset + 2, true),
        revision: view.getUint32(offset + 4, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeDebugHeader(view: DataView, offset: number, packet: WireDebugHeader): void {
    region(view, offset, 8);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugHeader.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.op) || packet.op < 0 || packet.op > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugHeader.opが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.op);
    if (!Number.isInteger(packet.request) || packet.request < 0 || packet.request > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugHeader.requestが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.request, true);
    if (!Number.isInteger(packet.revision) || packet.revision < 0 || packet.revision > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugHeader.revisionが整数幅の範囲外です。");
    }
    view.setUint32(offset + 4, packet.revision, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeDebugHeader(packet: WireDebugHeader, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(8 + (tail?.byteLength ?? 0));
    writeDebugHeader(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 8);
    }
    return bytes;
}

export interface WireDebugBegin {
    version: number;
    op: number;
    request: number;
    revision: number;
    count: number;
    crc: number;
    imageCrc: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readDebugBegin(view: DataView, offset = 0): WireDebugBegin {
    region(view, offset, 20);
    return {
        version: view.getUint8(offset + 0),
        op: view.getUint8(offset + 1),
        request: view.getUint16(offset + 2, true),
        revision: view.getUint32(offset + 4, true),
        count: view.getUint32(offset + 8, true),
        crc: view.getUint32(offset + 12, true),
        imageCrc: view.getUint32(offset + 16, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeDebugBegin(view: DataView, offset: number, packet: WireDebugBegin): void {
    region(view, offset, 20);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugBegin.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.op) || packet.op < 0 || packet.op > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugBegin.opが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.op);
    if (!Number.isInteger(packet.request) || packet.request < 0 || packet.request > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugBegin.requestが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.request, true);
    if (!Number.isInteger(packet.revision) || packet.revision < 0 || packet.revision > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugBegin.revisionが整数幅の範囲外です。");
    }
    view.setUint32(offset + 4, packet.revision, true);
    if (!Number.isInteger(packet.count) || packet.count < 0 || packet.count > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugBegin.countが整数幅の範囲外です。");
    }
    view.setUint32(offset + 8, packet.count, true);
    if (!Number.isInteger(packet.crc) || packet.crc < 0 || packet.crc > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugBegin.crcが整数幅の範囲外です。");
    }
    view.setUint32(offset + 12, packet.crc, true);
    if (!Number.isInteger(packet.imageCrc) || packet.imageCrc < 0 || packet.imageCrc > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugBegin.imageCrcが整数幅の範囲外です。");
    }
    view.setUint32(offset + 16, packet.imageCrc, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeDebugBegin(packet: WireDebugBegin, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(20 + (tail?.byteLength ?? 0));
    writeDebugBegin(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 20);
    }
    return bytes;
}

export interface WireDebugData {
    version: number;
    op: number;
    request: number;
    revision: number;
    index: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readDebugData(view: DataView, offset = 0): WireDebugData {
    region(view, offset, 12);
    return {
        version: view.getUint8(offset + 0),
        op: view.getUint8(offset + 1),
        request: view.getUint16(offset + 2, true),
        revision: view.getUint32(offset + 4, true),
        index: view.getUint32(offset + 8, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeDebugData(view: DataView, offset: number, packet: WireDebugData): void {
    region(view, offset, 12);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugData.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.op) || packet.op < 0 || packet.op > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugData.opが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.op);
    if (!Number.isInteger(packet.request) || packet.request < 0 || packet.request > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugData.requestが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.request, true);
    if (!Number.isInteger(packet.revision) || packet.revision < 0 || packet.revision > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugData.revisionが整数幅の範囲外です。");
    }
    view.setUint32(offset + 4, packet.revision, true);
    if (!Number.isInteger(packet.index) || packet.index < 0 || packet.index > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugData.indexが整数幅の範囲外です。");
    }
    view.setUint32(offset + 8, packet.index, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeDebugData(packet: WireDebugData, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(12 + (tail?.byteLength ?? 0));
    writeDebugData(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 12);
    }
    return bytes;
}

export interface WireDebugChunk {
    version: number;
    op: number;
    request: number;
    revision: number;
    stopId: number;
    offset: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readDebugChunk(view: DataView, offset = 0): WireDebugChunk {
    region(view, offset, 16);
    return {
        version: view.getUint8(offset + 0),
        op: view.getUint8(offset + 1),
        request: view.getUint16(offset + 2, true),
        revision: view.getUint32(offset + 4, true),
        stopId: view.getUint32(offset + 8, true),
        offset: view.getUint32(offset + 12, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeDebugChunk(view: DataView, offset: number, packet: WireDebugChunk): void {
    region(view, offset, 16);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugChunk.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.op) || packet.op < 0 || packet.op > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugChunk.opが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.op);
    if (!Number.isInteger(packet.request) || packet.request < 0 || packet.request > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugChunk.requestが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.request, true);
    if (!Number.isInteger(packet.revision) || packet.revision < 0 || packet.revision > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugChunk.revisionが整数幅の範囲外です。");
    }
    view.setUint32(offset + 4, packet.revision, true);
    if (!Number.isInteger(packet.stopId) || packet.stopId < 0 || packet.stopId > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugChunk.stopIdが整数幅の範囲外です。");
    }
    view.setUint32(offset + 8, packet.stopId, true);
    if (!Number.isInteger(packet.offset) || packet.offset < 0 || packet.offset > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugChunk.offsetが整数幅の範囲外です。");
    }
    view.setUint32(offset + 12, packet.offset, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeDebugChunk(packet: WireDebugChunk, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(16 + (tail?.byteLength ?? 0));
    writeDebugChunk(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 16);
    }
    return bytes;
}

export interface WireDebugExecute {
    version: number;
    op: number;
    request: number;
    revision: number;
    stopId: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readDebugExecute(view: DataView, offset = 0): WireDebugExecute {
    region(view, offset, 12);
    return {
        version: view.getUint8(offset + 0),
        op: view.getUint8(offset + 1),
        request: view.getUint16(offset + 2, true),
        revision: view.getUint32(offset + 4, true),
        stopId: view.getUint32(offset + 8, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeDebugExecute(view: DataView, offset: number, packet: WireDebugExecute): void {
    region(view, offset, 12);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugExecute.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.op) || packet.op < 0 || packet.op > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugExecute.opが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.op);
    if (!Number.isInteger(packet.request) || packet.request < 0 || packet.request > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugExecute.requestが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.request, true);
    if (!Number.isInteger(packet.revision) || packet.revision < 0 || packet.revision > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugExecute.revisionが整数幅の範囲外です。");
    }
    view.setUint32(offset + 4, packet.revision, true);
    if (!Number.isInteger(packet.stopId) || packet.stopId < 0 || packet.stopId > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugExecute.stopIdが整数幅の範囲外です。");
    }
    view.setUint32(offset + 8, packet.stopId, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeDebugExecute(packet: WireDebugExecute, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(12 + (tail?.byteLength ?? 0));
    writeDebugExecute(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 12);
    }
    return bytes;
}

export interface WireDebugResult {
    version: number;
    op: number;
    request: number;
    code: number;
    state: number;
    reserved: number;
    revision: number;
    value: number;
    extra: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readDebugResult(view: DataView, offset = 0): WireDebugResult {
    region(view, offset, 20);
    return {
        version: view.getUint8(offset + 0),
        op: view.getUint8(offset + 1),
        request: view.getUint16(offset + 2, true),
        code: view.getUint8(offset + 4),
        state: view.getUint8(offset + 5),
        reserved: view.getUint16(offset + 6, true),
        revision: view.getUint32(offset + 8, true),
        value: view.getUint32(offset + 12, true),
        extra: view.getUint32(offset + 16, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeDebugResult(view: DataView, offset: number, packet: WireDebugResult): void {
    region(view, offset, 20);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugResult.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.op) || packet.op < 0 || packet.op > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugResult.opが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.op);
    if (!Number.isInteger(packet.request) || packet.request < 0 || packet.request > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugResult.requestが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.request, true);
    if (!Number.isInteger(packet.code) || packet.code < 0 || packet.code > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugResult.codeが整数幅の範囲外です。");
    }
    view.setUint8(offset + 4, packet.code);
    if (!Number.isInteger(packet.state) || packet.state < 0 || packet.state > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugResult.stateが整数幅の範囲外です。");
    }
    view.setUint8(offset + 5, packet.state);
    if (!Number.isInteger(packet.reserved) || packet.reserved < 0 || packet.reserved > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugResult.reservedが整数幅の範囲外です。");
    }
    view.setUint16(offset + 6, packet.reserved, true);
    if (!Number.isInteger(packet.revision) || packet.revision < 0 || packet.revision > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugResult.revisionが整数幅の範囲外です。");
    }
    view.setUint32(offset + 8, packet.revision, true);
    if (!Number.isInteger(packet.value) || packet.value < 0 || packet.value > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugResult.valueが整数幅の範囲外です。");
    }
    view.setUint32(offset + 12, packet.value, true);
    if (!Number.isInteger(packet.extra) || packet.extra < 0 || packet.extra > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugResult.extraが整数幅の範囲外です。");
    }
    view.setUint32(offset + 16, packet.extra, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeDebugResult(packet: WireDebugResult, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(20 + (tail?.byteLength ?? 0));
    writeDebugResult(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 20);
    }
    return bytes;
}

export interface WireDebugEvent {
    version: number;
    state: number;
    code: number;
    error: number;
    stopId: number;
    revision: number;
    size: number;
    crc: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readDebugEvent(view: DataView, offset = 0): WireDebugEvent {
    region(view, offset, 20);
    return {
        version: view.getUint8(offset + 0),
        state: view.getUint8(offset + 1),
        code: view.getUint8(offset + 2),
        error: view.getUint8(offset + 3),
        stopId: view.getUint32(offset + 4, true),
        revision: view.getUint32(offset + 8, true),
        size: view.getUint32(offset + 12, true),
        crc: view.getUint32(offset + 16, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeDebugEvent(view: DataView, offset: number, packet: WireDebugEvent): void {
    region(view, offset, 20);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugEvent.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.state) || packet.state < 0 || packet.state > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugEvent.stateが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.state);
    if (!Number.isInteger(packet.code) || packet.code < 0 || packet.code > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugEvent.codeが整数幅の範囲外です。");
    }
    view.setUint8(offset + 2, packet.code);
    if (!Number.isInteger(packet.error) || packet.error < 0 || packet.error > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugEvent.errorが整数幅の範囲外です。");
    }
    view.setUint8(offset + 3, packet.error);
    if (!Number.isInteger(packet.stopId) || packet.stopId < 0 || packet.stopId > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugEvent.stopIdが整数幅の範囲外です。");
    }
    view.setUint32(offset + 4, packet.stopId, true);
    if (!Number.isInteger(packet.revision) || packet.revision < 0 || packet.revision > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugEvent.revisionが整数幅の範囲外です。");
    }
    view.setUint32(offset + 8, packet.revision, true);
    if (!Number.isInteger(packet.size) || packet.size < 0 || packet.size > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugEvent.sizeが整数幅の範囲外です。");
    }
    view.setUint32(offset + 12, packet.size, true);
    if (!Number.isInteger(packet.crc) || packet.crc < 0 || packet.crc > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugEvent.crcが整数幅の範囲外です。");
    }
    view.setUint32(offset + 16, packet.crc, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeDebugEvent(packet: WireDebugEvent, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(20 + (tail?.byteLength ?? 0));
    writeDebugEvent(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 20);
    }
    return bytes;
}

export interface WireSnapshotHeader {
    version: number;
    reason: number;
    slotBytes: number;
    pc: number;
    bp: number;
    sp: number;
    globals: number;
    stack: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readSnapshotHeader(view: DataView, offset = 0): WireSnapshotHeader {
    region(view, offset, 24);
    return {
        version: view.getUint8(offset + 0),
        reason: view.getUint8(offset + 1),
        slotBytes: view.getUint16(offset + 2, true),
        pc: view.getUint32(offset + 4, true),
        bp: view.getUint32(offset + 8, true),
        sp: view.getUint32(offset + 12, true),
        globals: view.getUint32(offset + 16, true),
        stack: view.getUint32(offset + 20, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeSnapshotHeader(view: DataView, offset: number, packet: WireSnapshotHeader): void {
    region(view, offset, 24);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "SnapshotHeader.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.reason) || packet.reason < 0 || packet.reason > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "SnapshotHeader.reasonが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.reason);
    if (!Number.isInteger(packet.slotBytes) || packet.slotBytes < 0 || packet.slotBytes > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "SnapshotHeader.slotBytesが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.slotBytes, true);
    if (!Number.isInteger(packet.pc) || packet.pc < 0 || packet.pc > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "SnapshotHeader.pcが整数幅の範囲外です。");
    }
    view.setUint32(offset + 4, packet.pc, true);
    if (!Number.isInteger(packet.bp) || packet.bp < 0 || packet.bp > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "SnapshotHeader.bpが整数幅の範囲外です。");
    }
    view.setUint32(offset + 8, packet.bp, true);
    if (!Number.isInteger(packet.sp) || packet.sp < 0 || packet.sp > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "SnapshotHeader.spが整数幅の範囲外です。");
    }
    view.setUint32(offset + 12, packet.sp, true);
    if (!Number.isInteger(packet.globals) || packet.globals < 0 || packet.globals > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "SnapshotHeader.globalsが整数幅の範囲外です。");
    }
    view.setUint32(offset + 16, packet.globals, true);
    if (!Number.isInteger(packet.stack) || packet.stack < 0 || packet.stack > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "SnapshotHeader.stackが整数幅の範囲外です。");
    }
    view.setUint32(offset + 20, packet.stack, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeSnapshotHeader(packet: WireSnapshotHeader, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(24 + (tail?.byteLength ?? 0));
    writeSnapshotHeader(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 24);
    }
    return bytes;
}

export interface WireSnapshotValue {
    tag: number;
    reserved: number;
    classId: number;
    payload: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readSnapshotValue(view: DataView, offset = 0): WireSnapshotValue {
    region(view, offset, 8);
    return {
        tag: view.getUint8(offset + 0),
        reserved: view.getUint8(offset + 1),
        classId: view.getUint16(offset + 2, true),
        payload: view.getUint32(offset + 4, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeSnapshotValue(view: DataView, offset: number, packet: WireSnapshotValue): void {
    region(view, offset, 8);
    if (!Number.isInteger(packet.tag) || packet.tag < 0 || packet.tag > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "SnapshotValue.tagが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.tag);
    if (!Number.isInteger(packet.reserved) || packet.reserved < 0 || packet.reserved > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "SnapshotValue.reservedが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.reserved);
    if (!Number.isInteger(packet.classId) || packet.classId < 0 || packet.classId > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "SnapshotValue.classIdが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.classId, true);
    if (!Number.isInteger(packet.payload) || packet.payload < 0 || packet.payload > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "SnapshotValue.payloadが整数幅の範囲外です。");
    }
    view.setUint32(offset + 4, packet.payload, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeSnapshotValue(packet: WireSnapshotValue, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(8 + (tail?.byteLength ?? 0));
    writeSnapshotValue(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 8);
    }
    return bytes;
}

export interface WireStringHeader {
    id: number;
    length: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readStringHeader(view: DataView, offset = 0): WireStringHeader {
    region(view, offset, 8);
    return {
        id: view.getUint32(offset + 0, true),
        length: view.getUint32(offset + 4, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeStringHeader(view: DataView, offset: number, packet: WireStringHeader): void {
    region(view, offset, 8);
    if (!Number.isInteger(packet.id) || packet.id < 0 || packet.id > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "StringHeader.idが整数幅の範囲外です。");
    }
    view.setUint32(offset + 0, packet.id, true);
    if (!Number.isInteger(packet.length) || packet.length < 0 || packet.length > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "StringHeader.lengthが整数幅の範囲外です。");
    }
    view.setUint32(offset + 4, packet.length, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeStringHeader(packet: WireStringHeader, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(8 + (tail?.byteLength ?? 0));
    writeStringHeader(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 8);
    }
    return bytes;
}

export interface WireWord32 {
    value: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readWord32(view: DataView, offset = 0): WireWord32 {
    region(view, offset, 4);
    return {
        value: view.getUint32(offset + 0, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeWord32(view: DataView, offset: number, packet: WireWord32): void {
    region(view, offset, 4);
    if (!Number.isInteger(packet.value) || packet.value < 0 || packet.value > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "Word32.valueが整数幅の範囲外です。");
    }
    view.setUint32(offset + 0, packet.value, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeWord32(packet: WireWord32, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(4 + (tail?.byteLength ?? 0));
    writeWord32(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 4);
    }
    return bytes;
}

export interface WirePc {
    value: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readPc(view: DataView, offset = 0): WirePc {
    region(view, offset, 2);
    return {
        value: view.getUint16(offset + 0, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writePc(view: DataView, offset: number, packet: WirePc): void {
    region(view, offset, 2);
    if (!Number.isInteger(packet.value) || packet.value < 0 || packet.value > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "Pc.valueが整数幅の範囲外です。");
    }
    view.setUint16(offset + 0, packet.value, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodePc(packet: WirePc, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(2 + (tail?.byteLength ?? 0));
    writePc(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 2);
    }
    return bytes;
}

export interface WireRemoteHeader {
    version: number;
    op: number;
    sequence: number;
    nonce: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readRemoteHeader(view: DataView, offset = 0): WireRemoteHeader {
    region(view, offset, 8);
    return {
        version: view.getUint8(offset + 0),
        op: view.getUint8(offset + 1),
        sequence: view.getUint16(offset + 2, true),
        nonce: view.getUint32(offset + 4, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeRemoteHeader(view: DataView, offset: number, packet: WireRemoteHeader): void {
    region(view, offset, 8);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteHeader.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.op) || packet.op < 0 || packet.op > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteHeader.opが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.op);
    if (!Number.isInteger(packet.sequence) || packet.sequence < 0 || packet.sequence > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteHeader.sequenceが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.sequence, true);
    if (!Number.isInteger(packet.nonce) || packet.nonce < 0 || packet.nonce > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteHeader.nonceが整数幅の範囲外です。");
    }
    view.setUint32(offset + 4, packet.nonce, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeRemoteHeader(packet: WireRemoteHeader, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(8 + (tail?.byteLength ?? 0));
    writeRemoteHeader(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 8);
    }
    return bytes;
}

export interface WireRemoteBegin {
    version: number;
    op: number;
    sequence: number;
    nonce: number;
    total: number;
    crc: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readRemoteBegin(view: DataView, offset = 0): WireRemoteBegin {
    region(view, offset, 14);
    return {
        version: view.getUint8(offset + 0),
        op: view.getUint8(offset + 1),
        sequence: view.getUint16(offset + 2, true),
        nonce: view.getUint32(offset + 4, true),
        total: view.getUint16(offset + 8, true),
        crc: view.getUint32(offset + 10, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeRemoteBegin(view: DataView, offset: number, packet: WireRemoteBegin): void {
    region(view, offset, 14);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteBegin.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.op) || packet.op < 0 || packet.op > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteBegin.opが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.op);
    if (!Number.isInteger(packet.sequence) || packet.sequence < 0 || packet.sequence > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteBegin.sequenceが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.sequence, true);
    if (!Number.isInteger(packet.nonce) || packet.nonce < 0 || packet.nonce > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteBegin.nonceが整数幅の範囲外です。");
    }
    view.setUint32(offset + 4, packet.nonce, true);
    if (!Number.isInteger(packet.total) || packet.total < 0 || packet.total > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteBegin.totalが整数幅の範囲外です。");
    }
    view.setUint16(offset + 8, packet.total, true);
    if (!Number.isInteger(packet.crc) || packet.crc < 0 || packet.crc > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteBegin.crcが整数幅の範囲外です。");
    }
    view.setUint32(offset + 10, packet.crc, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeRemoteBegin(packet: WireRemoteBegin, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(14 + (tail?.byteLength ?? 0));
    writeRemoteBegin(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 14);
    }
    return bytes;
}

export interface WireRemoteData {
    version: number;
    op: number;
    sequence: number;
    nonce: number;
    offset: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readRemoteData(view: DataView, offset = 0): WireRemoteData {
    region(view, offset, 10);
    return {
        version: view.getUint8(offset + 0),
        op: view.getUint8(offset + 1),
        sequence: view.getUint16(offset + 2, true),
        nonce: view.getUint32(offset + 4, true),
        offset: view.getUint16(offset + 8, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeRemoteData(view: DataView, offset: number, packet: WireRemoteData): void {
    region(view, offset, 10);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteData.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.op) || packet.op < 0 || packet.op > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteData.opが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.op);
    if (!Number.isInteger(packet.sequence) || packet.sequence < 0 || packet.sequence > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteData.sequenceが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.sequence, true);
    if (!Number.isInteger(packet.nonce) || packet.nonce < 0 || packet.nonce > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteData.nonceが整数幅の範囲外です。");
    }
    view.setUint32(offset + 4, packet.nonce, true);
    if (!Number.isInteger(packet.offset) || packet.offset < 0 || packet.offset > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteData.offsetが整数幅の範囲外です。");
    }
    view.setUint16(offset + 8, packet.offset, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeRemoteData(packet: WireRemoteData, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(10 + (tail?.byteLength ?? 0));
    writeRemoteData(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 10);
    }
    return bytes;
}

export interface WireRemoteAck {
    version: number;
    op: number;
    sequence: number;
    nonce: number;
    id: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readRemoteAck(view: DataView, offset = 0): WireRemoteAck {
    region(view, offset, 12);
    return {
        version: view.getUint8(offset + 0),
        op: view.getUint8(offset + 1),
        sequence: view.getUint16(offset + 2, true),
        nonce: view.getUint32(offset + 4, true),
        id: view.getUint32(offset + 8, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeRemoteAck(view: DataView, offset: number, packet: WireRemoteAck): void {
    region(view, offset, 12);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteAck.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.op) || packet.op < 0 || packet.op > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteAck.opが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.op);
    if (!Number.isInteger(packet.sequence) || packet.sequence < 0 || packet.sequence > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteAck.sequenceが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.sequence, true);
    if (!Number.isInteger(packet.nonce) || packet.nonce < 0 || packet.nonce > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteAck.nonceが整数幅の範囲外です。");
    }
    view.setUint32(offset + 4, packet.nonce, true);
    if (!Number.isInteger(packet.id) || packet.id < 0 || packet.id > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteAck.idが整数幅の範囲外です。");
    }
    view.setUint32(offset + 8, packet.id, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeRemoteAck(packet: WireRemoteAck, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(12 + (tail?.byteLength ?? 0));
    writeRemoteAck(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 12);
    }
    return bytes;
}

export interface WireRemoteResult {
    version: number;
    op: number;
    sequence: number;
    nonce: number;
    code: number;
    state: number;
    received: number;
    reserved: number;
    extra: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readRemoteResult(view: DataView, offset = 0): WireRemoteResult {
    region(view, offset, 20);
    return {
        version: view.getUint8(offset + 0),
        op: view.getUint8(offset + 1),
        sequence: view.getUint16(offset + 2, true),
        nonce: view.getUint32(offset + 4, true),
        code: view.getUint8(offset + 8),
        state: view.getUint8(offset + 9),
        received: view.getUint16(offset + 10, true),
        reserved: view.getUint32(offset + 12, true),
        extra: view.getUint32(offset + 16, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeRemoteResult(view: DataView, offset: number, packet: WireRemoteResult): void {
    region(view, offset, 20);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteResult.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.op) || packet.op < 0 || packet.op > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteResult.opが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.op);
    if (!Number.isInteger(packet.sequence) || packet.sequence < 0 || packet.sequence > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteResult.sequenceが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.sequence, true);
    if (!Number.isInteger(packet.nonce) || packet.nonce < 0 || packet.nonce > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteResult.nonceが整数幅の範囲外です。");
    }
    view.setUint32(offset + 4, packet.nonce, true);
    if (!Number.isInteger(packet.code) || packet.code < 0 || packet.code > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteResult.codeが整数幅の範囲外です。");
    }
    view.setUint8(offset + 8, packet.code);
    if (!Number.isInteger(packet.state) || packet.state < 0 || packet.state > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteResult.stateが整数幅の範囲外です。");
    }
    view.setUint8(offset + 9, packet.state);
    if (!Number.isInteger(packet.received) || packet.received < 0 || packet.received > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteResult.receivedが整数幅の範囲外です。");
    }
    view.setUint16(offset + 10, packet.received, true);
    if (!Number.isInteger(packet.reserved) || packet.reserved < 0 || packet.reserved > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteResult.reservedが整数幅の範囲外です。");
    }
    view.setUint32(offset + 12, packet.reserved, true);
    if (!Number.isInteger(packet.extra) || packet.extra < 0 || packet.extra > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteResult.extraが整数幅の範囲外です。");
    }
    view.setUint32(offset + 16, packet.extra, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeRemoteResult(packet: WireRemoteResult, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(20 + (tail?.byteLength ?? 0));
    writeRemoteResult(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 20);
    }
    return bytes;
}

export interface WireRemoteEvent {
    version: number;
    kind: number;
    nonce: number;
    id: number;
    object: number;
    method: number;
    argc: number;
    error: number;
    value: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readRemoteEvent(view: DataView, offset = 0): WireRemoteEvent {
    region(view, offset, 20);
    return {
        version: view.getUint8(offset + 0),
        kind: view.getUint8(offset + 1),
        nonce: view.getUint32(offset + 2, true),
        id: view.getUint32(offset + 6, true),
        object: view.getUint16(offset + 10, true),
        method: view.getUint16(offset + 12, true),
        argc: view.getUint8(offset + 14),
        error: view.getUint8(offset + 15),
        value: view.getInt32(offset + 16, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeRemoteEvent(view: DataView, offset: number, packet: WireRemoteEvent): void {
    region(view, offset, 20);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteEvent.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.kind) || packet.kind < 0 || packet.kind > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteEvent.kindが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.kind);
    if (!Number.isInteger(packet.nonce) || packet.nonce < 0 || packet.nonce > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteEvent.nonceが整数幅の範囲外です。");
    }
    view.setUint32(offset + 2, packet.nonce, true);
    if (!Number.isInteger(packet.id) || packet.id < 0 || packet.id > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteEvent.idが整数幅の範囲外です。");
    }
    view.setUint32(offset + 6, packet.id, true);
    if (!Number.isInteger(packet.object) || packet.object < 0 || packet.object > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteEvent.objectが整数幅の範囲外です。");
    }
    view.setUint16(offset + 10, packet.object, true);
    if (!Number.isInteger(packet.method) || packet.method < 0 || packet.method > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteEvent.methodが整数幅の範囲外です。");
    }
    view.setUint16(offset + 12, packet.method, true);
    if (!Number.isInteger(packet.argc) || packet.argc < 0 || packet.argc > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteEvent.argcが整数幅の範囲外です。");
    }
    view.setUint8(offset + 14, packet.argc);
    if (!Number.isInteger(packet.error) || packet.error < 0 || packet.error > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteEvent.errorが整数幅の範囲外です。");
    }
    view.setUint8(offset + 15, packet.error);
    if (!Number.isInteger(packet.value) || packet.value < -2147483648 || packet.value > 2147483647) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteEvent.valueが整数幅の範囲外です。");
    }
    view.setInt32(offset + 16, packet.value, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeRemoteEvent(packet: WireRemoteEvent, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(20 + (tail?.byteLength ?? 0));
    writeRemoteEvent(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 20);
    }
    return bytes;
}

export interface WireRegistryHeader {
    version: number;
    count: number;
    reserved: number;
    baseHash: Uint8Array;
    rpcHash: Uint8Array;
    registryHash: Uint8Array;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readRegistryHeader(view: DataView, offset = 0): WireRegistryHeader {
    region(view, offset, 100);
    return {
        version: view.getUint8(offset + 0),
        count: view.getUint8(offset + 1),
        reserved: view.getUint16(offset + 2, true),
        baseHash: new Uint8Array(view.buffer, view.byteOffset + offset + 4, 32),
        rpcHash: new Uint8Array(view.buffer, view.byteOffset + offset + 36, 32),
        registryHash: new Uint8Array(view.buffer, view.byteOffset + offset + 68, 32),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeRegistryHeader(view: DataView, offset: number, packet: WireRegistryHeader): void {
    region(view, offset, 100);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RegistryHeader.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.count) || packet.count < 0 || packet.count > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RegistryHeader.countが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.count);
    if (!Number.isInteger(packet.reserved) || packet.reserved < 0 || packet.reserved > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "RegistryHeader.reservedが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.reserved, true);
    if (packet.baseHash.byteLength !== 32) {
        throw new RpcError(RpcCode.InvalidArgument, "RegistryHeader.baseHashの長さが不正です。");
    }
    new Uint8Array(view.buffer, view.byteOffset + offset + 4, 32).set(packet.baseHash);
    if (packet.rpcHash.byteLength !== 32) {
        throw new RpcError(RpcCode.InvalidArgument, "RegistryHeader.rpcHashの長さが不正です。");
    }
    new Uint8Array(view.buffer, view.byteOffset + offset + 36, 32).set(packet.rpcHash);
    if (packet.registryHash.byteLength !== 32) {
        throw new RpcError(RpcCode.InvalidArgument, "RegistryHeader.registryHashの長さが不正です。");
    }
    new Uint8Array(view.buffer, view.byteOffset + offset + 68, 32).set(packet.registryHash);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeRegistryHeader(packet: WireRegistryHeader, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(100 + (tail?.byteLength ?? 0));
    writeRegistryHeader(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 100);
    }
    return bytes;
}

export interface WireRegistryRecord {
    native: number;
    object: number;
    method: number;
    classId: number;
    argc: number;
    reserved: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readRegistryRecord(view: DataView, offset = 0): WireRegistryRecord {
    region(view, offset, 10);
    return {
        native: view.getUint16(offset + 0, true),
        object: view.getUint16(offset + 2, true),
        method: view.getUint16(offset + 4, true),
        classId: view.getUint16(offset + 6, true),
        argc: view.getUint8(offset + 8),
        reserved: view.getUint8(offset + 9),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeRegistryRecord(view: DataView, offset: number, packet: WireRegistryRecord): void {
    region(view, offset, 10);
    if (!Number.isInteger(packet.native) || packet.native < 0 || packet.native > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "RegistryRecord.nativeが整数幅の範囲外です。");
    }
    view.setUint16(offset + 0, packet.native, true);
    if (!Number.isInteger(packet.object) || packet.object < 0 || packet.object > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "RegistryRecord.objectが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.object, true);
    if (!Number.isInteger(packet.method) || packet.method < 0 || packet.method > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "RegistryRecord.methodが整数幅の範囲外です。");
    }
    view.setUint16(offset + 4, packet.method, true);
    if (!Number.isInteger(packet.classId) || packet.classId < 0 || packet.classId > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "RegistryRecord.classIdが整数幅の範囲外です。");
    }
    view.setUint16(offset + 6, packet.classId, true);
    if (!Number.isInteger(packet.argc) || packet.argc < 0 || packet.argc > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RegistryRecord.argcが整数幅の範囲外です。");
    }
    view.setUint8(offset + 8, packet.argc);
    if (!Number.isInteger(packet.reserved) || packet.reserved < 0 || packet.reserved > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "RegistryRecord.reservedが整数幅の範囲外です。");
    }
    view.setUint8(offset + 9, packet.reserved);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeRegistryRecord(packet: WireRegistryRecord, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(10 + (tail?.byteLength ?? 0));
    writeRegistryRecord(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 10);
    }
    return bytes;
}

export interface WireProvisionFrame {
    op: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readProvisionFrame(view: DataView, offset = 0): WireProvisionFrame {
    region(view, offset, 1);
    return {
        op: view.getUint8(offset + 0),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeProvisionFrame(view: DataView, offset: number, packet: WireProvisionFrame): void {
    region(view, offset, 1);
    if (!Number.isInteger(packet.op) || packet.op < 0 || packet.op > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "ProvisionFrame.opが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.op);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeProvisionFrame(packet: WireProvisionFrame, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(1 + (tail?.byteLength ?? 0));
    writeProvisionFrame(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 1);
    }
    return bytes;
}

export interface WireDeviceTag {
    deviceType: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readDeviceTag(view: DataView, offset = 0): WireDeviceTag {
    region(view, offset, 1);
    return {
        deviceType: view.getUint8(offset + 0),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeDeviceTag(view: DataView, offset: number, packet: WireDeviceTag): void {
    region(view, offset, 1);
    if (!Number.isInteger(packet.deviceType) || packet.deviceType < 0 || packet.deviceType > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DeviceTag.deviceTypeが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.deviceType);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeDeviceTag(packet: WireDeviceTag, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(1 + (tail?.byteLength ?? 0));
    writeDeviceTag(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 1);
    }
    return bytes;
}

export interface WireDeviceServo {
    deviceType: number;
    channel: number;
    mode: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readDeviceServo(view: DataView, offset = 0): WireDeviceServo {
    region(view, offset, 3);
    return {
        deviceType: view.getUint8(offset + 0),
        channel: view.getUint8(offset + 1),
        mode: view.getUint8(offset + 2),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeDeviceServo(view: DataView, offset: number, packet: WireDeviceServo): void {
    region(view, offset, 3);
    if (!Number.isInteger(packet.deviceType) || packet.deviceType < 0 || packet.deviceType > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DeviceServo.deviceTypeが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.deviceType);
    if (!Number.isInteger(packet.channel) || packet.channel < 0 || packet.channel > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DeviceServo.channelが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.channel);
    if (!Number.isInteger(packet.mode) || packet.mode < 0 || packet.mode > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DeviceServo.modeが整数幅の範囲外です。");
    }
    view.setUint8(offset + 2, packet.mode);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeDeviceServo(packet: WireDeviceServo, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(3 + (tail?.byteLength ?? 0));
    writeDeviceServo(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 3);
    }
    return bytes;
}

export interface WireRemoteBeginBody {
    total: number;
    crc: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readRemoteBeginBody(view: DataView, offset = 0): WireRemoteBeginBody {
    region(view, offset, 6);
    return {
        total: view.getUint16(offset + 0, true),
        crc: view.getUint32(offset + 2, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeRemoteBeginBody(view: DataView, offset: number, packet: WireRemoteBeginBody): void {
    region(view, offset, 6);
    if (!Number.isInteger(packet.total) || packet.total < 0 || packet.total > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteBeginBody.totalが整数幅の範囲外です。");
    }
    view.setUint16(offset + 0, packet.total, true);
    if (!Number.isInteger(packet.crc) || packet.crc < 0 || packet.crc > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "RemoteBeginBody.crcが整数幅の範囲外です。");
    }
    view.setUint32(offset + 2, packet.crc, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeRemoteBeginBody(packet: WireRemoteBeginBody, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(6 + (tail?.byteLength ?? 0));
    writeRemoteBeginBody(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 6);
    }
    return bytes;
}

export interface WireOffset16 {
    value: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readOffset16(view: DataView, offset = 0): WireOffset16 {
    region(view, offset, 2);
    return {
        value: view.getUint16(offset + 0, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeOffset16(view: DataView, offset: number, packet: WireOffset16): void {
    region(view, offset, 2);
    if (!Number.isInteger(packet.value) || packet.value < 0 || packet.value > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "Offset16.valueが整数幅の範囲外です。");
    }
    view.setUint16(offset + 0, packet.value, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeOffset16(packet: WireOffset16, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(2 + (tail?.byteLength ?? 0));
    writeOffset16(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 2);
    }
    return bytes;
}

export interface WireDebugListBody {
    count: number;
    crc: number;
    imageCrc: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readDebugListBody(view: DataView, offset = 0): WireDebugListBody {
    region(view, offset, 12);
    return {
        count: view.getUint32(offset + 0, true),
        crc: view.getUint32(offset + 4, true),
        imageCrc: view.getUint32(offset + 8, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeDebugListBody(view: DataView, offset: number, packet: WireDebugListBody): void {
    region(view, offset, 12);
    if (!Number.isInteger(packet.count) || packet.count < 0 || packet.count > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugListBody.countが整数幅の範囲外です。");
    }
    view.setUint32(offset + 0, packet.count, true);
    if (!Number.isInteger(packet.crc) || packet.crc < 0 || packet.crc > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugListBody.crcが整数幅の範囲外です。");
    }
    view.setUint32(offset + 4, packet.crc, true);
    if (!Number.isInteger(packet.imageCrc) || packet.imageCrc < 0 || packet.imageCrc > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugListBody.imageCrcが整数幅の範囲外です。");
    }
    view.setUint32(offset + 8, packet.imageCrc, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeDebugListBody(packet: WireDebugListBody, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(12 + (tail?.byteLength ?? 0));
    writeDebugListBody(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 12);
    }
    return bytes;
}

export interface WireDebugChunkBody {
    stopId: number;
    offset: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readDebugChunkBody(view: DataView, offset = 0): WireDebugChunkBody {
    region(view, offset, 8);
    return {
        stopId: view.getUint32(offset + 0, true),
        offset: view.getUint32(offset + 4, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeDebugChunkBody(view: DataView, offset: number, packet: WireDebugChunkBody): void {
    region(view, offset, 8);
    if (!Number.isInteger(packet.stopId) || packet.stopId < 0 || packet.stopId > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugChunkBody.stopIdが整数幅の範囲外です。");
    }
    view.setUint32(offset + 0, packet.stopId, true);
    if (!Number.isInteger(packet.offset) || packet.offset < 0 || packet.offset > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "DebugChunkBody.offsetが整数幅の範囲外です。");
    }
    view.setUint32(offset + 4, packet.offset, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeDebugChunkBody(packet: WireDebugChunkBody, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(8 + (tail?.byteLength ?? 0));
    writeDebugChunkBody(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 8);
    }
    return bytes;
}

export interface WireTelemetryHeader {
    version: number;
    flags: number;
    sequence: number;
    millis: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readTelemetryHeader(view: DataView, offset = 0): WireTelemetryHeader {
    region(view, offset, 8);
    return {
        version: view.getUint8(offset + 0),
        flags: view.getUint8(offset + 1),
        sequence: view.getUint16(offset + 2, true),
        millis: view.getUint32(offset + 4, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeTelemetryHeader(view: DataView, offset: number, packet: WireTelemetryHeader): void {
    region(view, offset, 8);
    if (!Number.isInteger(packet.version) || packet.version < 0 || packet.version > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "TelemetryHeader.versionが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.version);
    if (!Number.isInteger(packet.flags) || packet.flags < 0 || packet.flags > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "TelemetryHeader.flagsが整数幅の範囲外です。");
    }
    view.setUint8(offset + 1, packet.flags);
    if (!Number.isInteger(packet.sequence) || packet.sequence < 0 || packet.sequence > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "TelemetryHeader.sequenceが整数幅の範囲外です。");
    }
    view.setUint16(offset + 2, packet.sequence, true);
    if (!Number.isInteger(packet.millis) || packet.millis < 0 || packet.millis > 4294967295) {
        throw new RpcError(RpcCode.InvalidArgument, "TelemetryHeader.millisが整数幅の範囲外です。");
    }
    view.setUint32(offset + 4, packet.millis, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeTelemetryHeader(packet: WireTelemetryHeader, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(8 + (tail?.byteLength ?? 0));
    writeTelemetryHeader(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 8);
    }
    return bytes;
}

export interface WireImuRecord {
    deviceType: number;
    accX: number;
    accY: number;
    accZ: number;
    gyroX: number;
    gyroY: number;
    gyroZ: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readImuRecord(view: DataView, offset = 0): WireImuRecord {
    region(view, offset, 13);
    return {
        deviceType: view.getUint8(offset + 0),
        accX: view.getInt16(offset + 1, true),
        accY: view.getInt16(offset + 3, true),
        accZ: view.getInt16(offset + 5, true),
        gyroX: view.getInt16(offset + 7, true),
        gyroY: view.getInt16(offset + 9, true),
        gyroZ: view.getInt16(offset + 11, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeImuRecord(view: DataView, offset: number, packet: WireImuRecord): void {
    region(view, offset, 13);
    if (!Number.isInteger(packet.deviceType) || packet.deviceType < 0 || packet.deviceType > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "ImuRecord.deviceTypeが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.deviceType);
    if (!Number.isInteger(packet.accX) || packet.accX < -32768 || packet.accX > 32767) {
        throw new RpcError(RpcCode.InvalidArgument, "ImuRecord.accXが整数幅の範囲外です。");
    }
    view.setInt16(offset + 1, packet.accX, true);
    if (!Number.isInteger(packet.accY) || packet.accY < -32768 || packet.accY > 32767) {
        throw new RpcError(RpcCode.InvalidArgument, "ImuRecord.accYが整数幅の範囲外です。");
    }
    view.setInt16(offset + 3, packet.accY, true);
    if (!Number.isInteger(packet.accZ) || packet.accZ < -32768 || packet.accZ > 32767) {
        throw new RpcError(RpcCode.InvalidArgument, "ImuRecord.accZが整数幅の範囲外です。");
    }
    view.setInt16(offset + 5, packet.accZ, true);
    if (!Number.isInteger(packet.gyroX) || packet.gyroX < -32768 || packet.gyroX > 32767) {
        throw new RpcError(RpcCode.InvalidArgument, "ImuRecord.gyroXが整数幅の範囲外です。");
    }
    view.setInt16(offset + 7, packet.gyroX, true);
    if (!Number.isInteger(packet.gyroY) || packet.gyroY < -32768 || packet.gyroY > 32767) {
        throw new RpcError(RpcCode.InvalidArgument, "ImuRecord.gyroYが整数幅の範囲外です。");
    }
    view.setInt16(offset + 9, packet.gyroY, true);
    if (!Number.isInteger(packet.gyroZ) || packet.gyroZ < -32768 || packet.gyroZ > 32767) {
        throw new RpcError(RpcCode.InvalidArgument, "ImuRecord.gyroZが整数幅の範囲外です。");
    }
    view.setInt16(offset + 11, packet.gyroZ, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeImuRecord(packet: WireImuRecord, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(13 + (tail?.byteLength ?? 0));
    writeImuRecord(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 13);
    }
    return bytes;
}

export interface WireDistanceRecord {
    deviceType: number;
    distanceMm: number;
}

/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function readDistanceRecord(view: DataView, offset = 0): WireDistanceRecord {
    region(view, offset, 3);
    return {
        deviceType: view.getUint8(offset + 0),
        distanceMm: view.getUint16(offset + 1, true),
    };
}

/** 必要な整数幅を検査して既存領域へ書く。 */
export function writeDistanceRecord(view: DataView, offset: number, packet: WireDistanceRecord): void {
    region(view, offset, 3);
    if (!Number.isInteger(packet.deviceType) || packet.deviceType < 0 || packet.deviceType > 255) {
        throw new RpcError(RpcCode.InvalidArgument, "DistanceRecord.deviceTypeが整数幅の範囲外です。");
    }
    view.setUint8(offset + 0, packet.deviceType);
    if (!Number.isInteger(packet.distanceMm) || packet.distanceMm < 0 || packet.distanceMm > 65535) {
        throw new RpcError(RpcCode.InvalidArgument, "DistanceRecord.distanceMmが整数幅の範囲外です。");
    }
    view.setUint16(offset + 1, packet.distanceMm, true);
}

/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encodeDistanceRecord(packet: WireDistanceRecord, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(3 + (tail?.byteLength ?? 0));
    writeDistanceRecord(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, 3);
    }
    return bytes;
}

export function validTransferHeader(packet: WireTransferHeader): boolean {
    return true;
}

export function validTransferBegin(packet: WireTransferBegin): boolean {
    return true;
}

export function validTransferResult(packet: WireTransferResult): boolean {
    return true;
}

export function validBundleHeader(packet: WireBundleHeader): boolean {
    return true;
}

export function validDebugHeader(packet: WireDebugHeader): boolean {
    return true;
}

export function validDebugBegin(packet: WireDebugBegin): boolean {
    return true;
}

export function validDebugData(packet: WireDebugData): boolean {
    return true;
}

export function validDebugChunk(packet: WireDebugChunk): boolean {
    return true;
}

export function validDebugExecute(packet: WireDebugExecute): boolean {
    return true;
}

export function validDebugResult(packet: WireDebugResult): boolean {
    return true;
}

export function validDebugEvent(packet: WireDebugEvent): boolean {
    return true;
}

export function validSnapshotHeader(packet: WireSnapshotHeader): boolean {
    return true;
}

export function validSnapshotValue(packet: WireSnapshotValue): boolean {
    return true;
}

export function validStringHeader(packet: WireStringHeader): boolean {
    return true;
}

export function validWord32(packet: WireWord32): boolean {
    return true;
}

export function validPc(packet: WirePc): boolean {
    return true;
}

export function validRemoteHeader(packet: WireRemoteHeader): boolean {
    return true;
}

export function validRemoteBegin(packet: WireRemoteBegin): boolean {
    return true;
}

export function validRemoteData(packet: WireRemoteData): boolean {
    return true;
}

export function validRemoteAck(packet: WireRemoteAck): boolean {
    return true;
}

export function validRemoteResult(packet: WireRemoteResult): boolean {
    return true;
}

export function validRemoteEvent(packet: WireRemoteEvent): boolean {
    return true;
}

export function validRegistryHeader(packet: WireRegistryHeader): boolean {
    return true;
}

export function validRegistryRecord(packet: WireRegistryRecord): boolean {
    return true;
}

export function validProvisionFrame(packet: WireProvisionFrame): boolean {
    return true;
}

export function validDeviceTag(packet: WireDeviceTag): boolean {
    return true;
}

export function validDeviceServo(packet: WireDeviceServo): boolean {
    return (packet.channel <= 15) && (packet.mode <= 1);
}

export function validRemoteBeginBody(packet: WireRemoteBeginBody): boolean {
    return true;
}

export function validOffset16(packet: WireOffset16): boolean {
    return true;
}

export function validDebugListBody(packet: WireDebugListBody): boolean {
    return true;
}

export function validDebugChunkBody(packet: WireDebugChunkBody): boolean {
    return true;
}

export function validTelemetryHeader(packet: WireTelemetryHeader): boolean {
    return (packet.version === 3);
}

export function validImuRecord(packet: WireImuRecord): boolean {
    return true;
}

export function validDistanceRecord(packet: WireDistanceRecord): boolean {
    return (packet.distanceMm === 65535 || (packet.distanceMm >= 20 && packet.distanceMm <= 4000));
}

export const DeviceInfoRecordsLimits = { maxRecords: 20, maxBytes: 20 } as const;

export function DeviceInfoRecordsRecordLength(kind: number): number {
    switch (kind) {
        case 0:
            return 1;
        case 1:
            return 1;
        case 2:
            return 1;
        case 3:
            return 1;
        case 128:
            return 3;
        default:
            return 0;
    }
}

/** 全件を検査し終えてから位置を返す。元データ・登録順は所有者が保持する。 */
export function readDeviceInfoRecords(view: DataView): { records: readonly { deviceType: number; offset: number }[] } {
    if (view.byteLength < 0 || view.byteLength > 20) {
        throw new RpcError(RpcCode.InvalidArgument, "DeviceInfoRecordsの長さが不正です。");
    }

    const records: { deviceType: number; offset: number }[] = [];
    let offset = 0;
    while (offset < view.byteLength) {
        const kind = view.getUint8(offset);
        const length = DeviceInfoRecordsRecordLength(kind);
        if (records.length >= 20 || !length || offset + length > view.byteLength) {
            throw new RpcError(RpcCode.InvalidArgument, "レコード列の種別・長さ・件数が不正です。");
        }
        let valid = false;
        switch (kind) {
            case 0:
                valid = validDeviceTag(readDeviceTag(view, offset));
                break;
            case 1:
                valid = validDeviceTag(readDeviceTag(view, offset));
                break;
            case 2:
                valid = validDeviceTag(readDeviceTag(view, offset));
                break;
            case 3:
                valid = validDeviceTag(readDeviceTag(view, offset));
                break;
            case 128:
                valid = validDeviceServo(readDeviceServo(view, offset));
                break;
        }
        if (!valid) {
            throw new RpcError(RpcCode.InvalidArgument, "レコードの値が範囲外です。");
        }
        records.push({ deviceType: kind, offset });
        offset += length;
    }
    return { records };
}

/** 所有者の機器情報を1レコード書く。サイズを含む構造体の直接送信は行わない。 */
export function writeDeviceInfoRecordsRecord(view: DataView, offset: number, packet: WireDeviceTag | WireDeviceServo): number {
    switch (packet.deviceType) {
        case 0: {
            const record = packet as WireDeviceTag;
            if (!validDeviceTag(record)) {
                throw new RpcError(RpcCode.InvalidArgument, "機器情報が範囲外です。");
            }
            writeDeviceTag(view, offset, record);
            return offset + 1;
        }
        case 1: {
            const record = packet as WireDeviceTag;
            if (!validDeviceTag(record)) {
                throw new RpcError(RpcCode.InvalidArgument, "機器情報が範囲外です。");
            }
            writeDeviceTag(view, offset, record);
            return offset + 1;
        }
        case 2: {
            const record = packet as WireDeviceTag;
            if (!validDeviceTag(record)) {
                throw new RpcError(RpcCode.InvalidArgument, "機器情報が範囲外です。");
            }
            writeDeviceTag(view, offset, record);
            return offset + 1;
        }
        case 3: {
            const record = packet as WireDeviceTag;
            if (!validDeviceTag(record)) {
                throw new RpcError(RpcCode.InvalidArgument, "機器情報が範囲外です。");
            }
            writeDeviceTag(view, offset, record);
            return offset + 1;
        }
        case 128: {
            const record = packet as WireDeviceServo;
            if (!validDeviceServo(record)) {
                throw new RpcError(RpcCode.InvalidArgument, "機器情報が範囲外です。");
            }
            writeDeviceServo(view, offset, record);
            return offset + 3;
        }
        default:
            throw new RpcError(RpcCode.InvalidArgument, "機器種別が不正です。");
    }
}

export const TelemetryRecordsLimits = { maxRecords: 20, maxBytes: 268 } as const;

export function TelemetryRecordsRecordLength(kind: number): number {
    switch (kind) {
        case 0:
            return 13;
        case 2:
            return 3;
        default:
            return 0;
    }
}

/** 全件を検査し終えてから位置を返す。元データ・登録順は所有者が保持する。 */
export function readTelemetryRecords(view: DataView): { header: WireTelemetryHeader; records: readonly { deviceType: number; offset: number }[] } {
    if (view.byteLength < 8 || view.byteLength > 268) {
        throw new RpcError(RpcCode.InvalidArgument, "TelemetryRecordsの長さが不正です。");
    }
    const header = readTelemetryHeader(view);
    if (!validTelemetryHeader(header)) {
        throw new RpcError(RpcCode.InvalidArgument, "レコード列の版が不正です。");
    }
    const records: { deviceType: number; offset: number }[] = [];
    let offset = 8;
    while (offset < view.byteLength) {
        const kind = view.getUint8(offset);
        const length = TelemetryRecordsRecordLength(kind);
        if (records.length >= 20 || !length || offset + length > view.byteLength) {
            throw new RpcError(RpcCode.InvalidArgument, "レコード列の種別・長さ・件数が不正です。");
        }
        let valid = false;
        switch (kind) {
            case 0:
                valid = validImuRecord(readImuRecord(view, offset));
                break;
            case 2:
                valid = validDistanceRecord(readDistanceRecord(view, offset));
                break;
        }
        if (!valid) {
            throw new RpcError(RpcCode.InvalidArgument, "レコードの値が範囲外です。");
        }
        records.push({ deviceType: kind, offset });
        offset += length;
    }
    return { header, records };
}
