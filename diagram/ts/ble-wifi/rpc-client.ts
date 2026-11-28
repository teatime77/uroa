/**
 * 既存の通信処理を名前付き・型付きのRPC APIへ接続するローカル窓口。
 * device.protoが契約、device-rpc.generated.tsが型と操作表、device-connection.tsが配送先を担当する。
 * ローカルID・同時数・経路・引数を検査する。新しいパケット・待ち列・自動再送は導入しない。
 * 期限は既存アダプターの各通信操作へ適用する。取消は動作の巻戻しを意味しない。
 * 要求本体・資格情報・呼出し履歴は保存しない。
 * BLE/Wi-Fiの認証、ACK、期限、直列化、通信形式は既存のアダプターが担当する。
 */
import { rpcMaxPending, rpcMessages, rpcMethods } from "./device-rpc.generated";

/** 通信へ含めない取消と操作世代。isCurrentは送信待ち中にも既存アダプターが照合する。 */
export interface RpcCallOptions {
    signal?: AbortSignal;
    isCurrent?: () => boolean;
}

/** 通信失敗と機器側の拒否を区別する結果分類。 */
export enum RpcCode {
    Cancelled = "cancelled",
    DeadlineExceeded = "deadline-exceeded",
    Unavailable = "unavailable",
    Unsupported = "unsupported",
    InvalidArgument = "invalid-argument",
    Busy = "busy",
    Device = "device",
    Internal = "internal",
}

/** 機器結果番号を必要な場合だけ残す。要求本体や認証情報は保持しない。 */
export class RpcError extends Error {
    constructor(readonly code: RpcCode, message: string, readonly deviceCode?: number) {
        super(message);
        this.name = "RpcError";
    }
}

/** AbortSignalの既存AbortErrorも共通の取消分類として参照できる。例外自体は置き換えない。 */
export function rpcErrorCode(error: unknown): RpcCode {
    if (error instanceof RpcError) {
        return error.code;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
        return RpcCode.Cancelled;
    }
    return RpcCode.Internal;
}

/** signal省略時に既存アダプターへ渡す取消されない共有Signal。 */
const defaultSignal = new AbortController().signal;
/** ユーザー指定の取消を優先し、未指定時は追加のタイマーを作らない。 */
export function rpcSignal(options?: RpcCallOptions): AbortSignal {
    return options?.signal ?? defaultSignal;
}

/** 送信待ちに入った後も取消と呼出し元の操作世代を同時に検査する。 */
export function rpcCurrent(options?: RpcCallOptions): () => boolean {
    return () => !options?.signal?.aborted && (options?.isCurrent?.() ?? true);
}

/** 生成済みメタデータのうち実行時に必要な項目。 */
interface MethodPolicy {
    hasRequest: boolean;
    synchronous: boolean;
    priority: boolean;
    transport: string;
    request: string;
}
/** 通常フィールドの幅・上限。ホスト参照の所有検査は各既存アダプターが担当する。 */
interface FieldPolicy {
    name: string;
    type: string;
    repeated: boolean;
    optional: boolean;
    bits: number;
    maxLength: number;
}
/** 長さは文字数でなくUTF-8バイト数で検査する。 */
const encoder = new TextEncoder();
const messages: Readonly<Record<string, readonly FieldPolicy[]>> = rpcMessages;

/** .protoで定義した通常の要求値を検査する。Receipt/Snapshot等の参照はコピーしない。 */
function validateRequest(type: string, value: unknown): void {
    const fields = messages[type];
    if (!fields) {
        return;
    }
    if (typeof value !== "object" || value === null) {
        throw new RpcError(RpcCode.InvalidArgument, `${type}の引数が不正です。`);
    }
    const request = value as Record<string, unknown>;
    for (const field of fields) {
        const item = request[field.name];
        if (item === undefined && field.optional) {
            continue;
        }
        if (field.repeated) {
            if (!Array.isArray(item) || item.length > field.maxLength) {
                throw new RpcError(RpcCode.InvalidArgument, `${type}.${field.name}の配列長が不正です。`);
            }
            for (const element of item) {
                validateScalar(field, element);
            }
        }
        else {
            validateScalar(field, item);
        }
    }
}

/** 型・整数幅・最大長を検査する。角度等の機器固有の範囲はアダプター側で検査する。 */
function validateScalar(field: FieldPolicy, value: unknown): void {
    let valid = true;
    if (field.type === "uint32" || field.type === "sint32") {
        const signed = field.type === "sint32";
        const min = signed ? -(2 ** (field.bits - 1)) : 0;
        const max = 2 ** (field.bits - (signed ? 1 : 0)) - 1;
        valid = typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
    }
    else if (field.type === "float" || field.type === "double") {
        valid = typeof value === "number" && Number.isFinite(value);
    }
    else if (field.type === "bool") {
        valid = typeof value === "boolean";
    }
    else if (field.type === "string") {
        valid = typeof value === "string" && encoder.encode(value).byteLength <= field.maxLength;
    }
    else if (field.type === "bytes") {
        valid = value instanceof Uint8Array && value.byteLength <= field.maxLength;
    }
    else {
        validateRequest(field.type, value);
    }
    if (!valid) {
        throw new RpcError(RpcCode.InvalidArgument, `${field.name}の型または範囲が不正です。`);
    }
}

/** AbortErrorと既存の分類を保持し、未分類の例外をInternalへ対応付ける。 */
function failure(error: unknown): Error {
    if (error instanceof RpcError || error instanceof DOMException && error.name === "AbortError") {
        return error;
    }
    if (error instanceof RangeError) {
        return new RpcError(RpcCode.InvalidArgument, error.message);
    }
    return new RpcError(RpcCode.Internal, error instanceof Error ? error.message : "RPCの処理に失敗しました。");
}

/** 各キーに引数と戻り値の型を持つ呼出し表。実行時の型変換やシリアライズは行わない。 */
type RpcMethods<Methods> = {
    [Name in keyof Methods]: (...args: never[]) => unknown;
};

/** 操作と継続購読を同じ名前付きAPIから利用する。購読の解除方法は登録先が返す。 */
export class RpcClient<Calls extends RpcMethods<Calls>, Subscriptions extends RpcMethods<Subscriptions> = Record<never, never>> {
    /** クライアント内で再利用しないローカルの呼出し番号。 */
    private nextId = 0;
    /** 未完了Promiseの数。新しい待ち列や要求本体の履歴は持たない。 */
    private pending = 0;
    /** 接続所有者が束縛した操作と、同期的に解除関数を返す購読を保持する。 */
    constructor(private readonly calls: Calls, private readonly subscriptions: Subscriptions,
        /** 所有者が現在有効な通信経路だけを返す。 */
        private readonly transport: () => "ble" | "wifi" | undefined) {
    }

    /**
     * 名前に対応する操作を元の引数で呼ぶ。同期の切断とユーザー操作の接続開始を維持し、再送しない。
     * 通信の受付・機器の受付・処理完了のどこまで待つかは各操作の契約に従う。
     */
    call<Name extends keyof Calls>(name: Name, ...args: Parameters<Calls[Name]>): ReturnType<Calls[Name]> {
        const policy = (rpcMethods as Readonly<Record<string, MethodPolicy>>)[String(name)];
        try {
            if (!policy || typeof this.calls[name] !== "function") {
                throw new RpcError(RpcCode.Unsupported, "未対応のRPCです。");
            }
            const options = args[policy.hasRequest ? 1 : 0] as RpcCallOptions | undefined;
            options?.signal?.throwIfAborted();
            if (options?.isCurrent && !options.isCurrent()) {
                throw new DOMException("機器操作を取り消しました。", "AbortError");
            }
            const transport = this.transport();
            if (policy.transport !== "local" && !policy.priority) {
                if (!transport) {
                    throw new RpcError(RpcCode.Unavailable, "ESP32へ接続してください。");
                }
                if (policy.transport !== "both" && transport !== policy.transport) {
                    throw new RpcError(RpcCode.Unsupported, "現在の通信経路では利用できません。");
                }
            }
            if (this.pending >= rpcMaxPending && !policy.priority || this.nextId === 0xFFFFFFFF) {
                throw new RpcError(RpcCode.Busy, "RPCの呼出し上限です。");
            }
            this.nextId++;
            if (policy.hasRequest) {
                validateRequest(policy.request, args[0]);
            }
            const invoke = this.calls[name] as (...values: Parameters<Calls[Name]>) => ReturnType<Calls[Name]>;
            // BLE選択はユーザー操作の同じスタックで開始し、前へPromise待機を挟まない。
            const result = invoke(...args);
            if (!(result instanceof Promise)) {
                return result;
            }
            this.pending++;
            return result.then(value => {
                options?.signal?.throwIfAborted();
                return value;
            }).catch(error => {
                throw failure(error);
            }).finally(() => {
                this.pending--;
            }) as ReturnType<Calls[Name]>;
        }
        catch (error) {
            if (policy?.synchronous) {
                throw failure(error);
            }
            return Promise.reject(failure(error)) as ReturnType<Calls[Name]>;
        }
    }

    /** 現在値の通知・センサー利用の登録を同期的に行い、購読元が返す解除関数をそのまま渡す。 */
    subscribe<Name extends keyof Subscriptions>(name: Name, ...args: Parameters<Subscriptions[Name]>): ReturnType<Subscriptions[Name]> {
        const invoke = this.subscriptions[name] as (...values: Parameters<Subscriptions[Name]>) => ReturnType<Subscriptions[Name]>;
        return invoke(...args);
    }
}
