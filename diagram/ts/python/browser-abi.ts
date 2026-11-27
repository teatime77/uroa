/** ブラウザ用VM・コンパイラー・Worker間の契約。機器向けの通信形式から独立する。 */
import type { NumericKernelManifest } from "./kernel-c";
import type { RemoteValueType } from "./remote";

/** 自サイトから配布する固定資産の場所。browser/build.pyで生成する。 */
export const browserAssetBase = "/diagram/runtime/v1/";
/** browser/host.cppのKernelTagと共有する引数の種別。 */
export const browserKernelTags = { i32: 1, f32: 2, in_f32: 3, out_f32: 4, bool: 0 } as const;
/** 共通VMのErrorに対応する接続結果。 */
export const browserVmErrors = { none: 0, memory: 2, unavailable: 14, failure: 16 } as const;
/** Worker内RPCの上限。通信パケットの上限・版とは独立する。実行中1件を待ち数へ含める。 */
export const browserRpcLimits = { pending: 16, arguments: 32, stringBytes: 1024, maxId: 0xFFFFFFFF } as const;
/** browser/host.cppと共有する、スカラー引数・戻り値のVMタグ。 */
export const browserRpcTags = { int: 1, float: 2, none: 3, str: 6 } as const;
/** 第2段階でWorkerへコピーする値。配列・オブジェクト・VMアドレスは渡さない。 */
export type BrowserRpcScalar = number | string | null;
/** 公開署名と、その同一生成で得たブラウザ側の関数入口・selfの配置。 */
export interface BrowserRpcMethod {
    /** 公開オブジェクトID。 */
    object: number;
    /** 公開メソッドID。 */
    method: number;
    /** 大域のselfのスロット。 */
    slot: number;
    /** selfの本体型ID。 */
    classId: number;
    /** 関数の入口PC。 */
    entry: number;
    /** selfを含めない引数型。 */
    parameters: RemoteValueType[];
    /** ブラウザ本体の戻り値型。 */
    result: RemoteValueType;
}
/** 初期化終了後もVMとイメージを保持するRPCの公開情報。 */
export interface BrowserRpcProgram {
    /** Runtimeが開始ごとに採番し、全要求・応答へ付ける世代。 */
    session: number;
    /** 同じ2ソースの公開定義の指紋。 */
    fingerprint: string;
    /** このWorkerで呼べるメソッドだけの表。 */
    methods: BrowserRpcMethod[];
}
/** Workerへ送る1件のRPC。idはセッション内で単調増加し、再利用・自動再送を行わない。 */
export interface BrowserRpcRequest {
    /** Worker内の要求種別。通信パケットの操作番号とは分離する。 */
    kind: "rpc";
    /** 開始時に割り当てた世代。旧世代の要求を拒否する。 */
    session: number;
    /** セッション内で再利用しない要求番号。 */
    id: number;
    /** 公開オブジェクトID。 */
    object: number;
    /** 公開メソッドID。 */
    method: number;
    /** 呼出し時点のスカラー値。VMへの借用参照は含めない。 */
    arguments: BrowserRpcScalar[];
}
/** RPC配送前の第2段階だけで使う、Worker要求の失敗種別。VMのError番号とは分離する。 */
export type BrowserRpcErrorCode = "notReady" | "invalidRequest" | "unknownMethod" | "argument"
    | "busy" | "duplicate" | "stopped" | "vmError";
/** Workerが返す受付準備・要求受付・成功・失敗。受付通知は完了通知ではない。 */
export type BrowserRpcEvent = { kind: "rpcReady"; session: number }
    | { kind: "rpcAccepted"; session: number; id: number }
    | { kind: "rpcResult"; session: number; id: number; value: BrowserRpcScalar }
    | { kind: "rpcError"; session: number; id: number; code: BrowserRpcErrorCode; message: string };
/** 実行Workerへ渡す、一組のVMイメージと計算用Wasm。 */
export interface BrowserPythonProgram {
    /** 指定時は初期化後も受付を維持する。省略時は従来どおり正常終了で破棄する。 */
    rpc?: BrowserRpcProgram;
    /** version 7またはカーネル付きversion 8。 */
    bytecode: Uint8Array;
    /** 共通Cと照合済みの登録表。 */
    manifest: NumericKernelManifest;
    /** 計算用Wasm。カーネルがなければ省略する。 */
    kernelWasm?: Uint8Array;
    /** printのnativeIdとAPI指紋。同じPythonAnalysisから取得する。 */
    print?: { id: number; abiHash: string };
    /** 結果表示に使用する大域変数の名前とスロット。 */
    globals: { name: string; slot: number }[];
}

/** EmscriptenのC公開関数とVMメモリー。値・配列の借用は同期呼出し中だけ有効。 */
export interface BrowserVM {
    HEAPU8: Uint8Array;
    _malloc(bytes: number): number;
    _free(pointer: number): void;
    _browser_kernel_hash(pointer: number): void;
    _browser_register_kernel(id: number, tags: number, count: number): number;
    _browser_bind_print(id: number, hash: number): number;
    _browser_load(pointer: number, length: number): number;
    _browser_tick(budget: number): void;
    _browser_stop(): void;
    _browser_state(): number;
    _browser_error(): number;
    _browser_pc(): number;
    _browser_instructions(): number;
    _browser_value(slot: number): number;
    _browser_rpc_register(object: number, method: number, slot: number, classId: number,
        entry: number, tags: number, count: number): number;
    _browser_rpc_begin(object: number, method: number, descriptors: number, count: number): number;
    _browser_rpc_result(): number;
    _browser_rpc_release(): number;
}

/** 配布物の固定点と各ファイルのSHA-256。 */
export interface BrowserAssetManifest {
    wccCommit: string;
    emscriptenVersion: string;
    files: Record<string, { sha256: string; bytes: number }>;
}

/** 配布資産を取得する。HTTP失敗をコンパイル診断と区別する。 */
export async function loadBrowserAssets(): Promise<BrowserAssetManifest> {
    const response = await fetch(browserAssetBase + "assets.json", { cache: "no-cache" });
    if (!response.ok) {
        throw new Error(`ブラウザ用VM・コンパイラー資産を取得できません (${response.status})`);
    }
    return response.json();
}

/** 固定資産のバイト列を長さとSHA-256で照合する。 */
export async function readBrowserAsset(name: string, assets: BrowserAssetManifest): Promise<Uint8Array<ArrayBuffer>> {
    const expected = assets.files[name];
    if (!expected) {
        throw new Error(`資産が登録されていません: ${name}`);
    }
    const response = await fetch(`${browserAssetBase}${name}?v=${expected.sha256}`);
    if (!response.ok) {
        throw new Error(`資産を取得できません: ${name} (${response.status})`);
    }
    const data = new Uint8Array(await response.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", data);
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    if (data.length !== expected.bytes || hash !== expected.sha256) {
        throw new Error(`資産のハッシュが一致しません: ${name}`);
    }
    return data;
}
