/** ブラウザ用VM・コンパイラー・Worker間の契約。機器向けの通信形式から独立する。 */
import type { NumericKernelManifest } from "./kernel-c";

/** 自サイトから配布する固定資産の場所。browser/build.pyで生成する。 */
export const browserAssetBase = "/diagram/runtime/v1/";
/** browser/host.cppのKernelTagと共有する引数の種別。 */
export const browserKernelTags = { i32: 1, f32: 2, in_f32: 3, out_f32: 4, bool: 0 } as const;
/** 共通VMのErrorに対応する接続結果。 */
export const browserVmErrors = { none: 0, memory: 2, unavailable: 14, failure: 16 } as const;
/** 実行Workerへ渡す、一組のVMイメージと計算用Wasm。 */
export interface BrowserPythonProgram {
    /** version 7またはカーネル付きversion 8。 */
    bytecode: Uint8Array;
    /** 共通Cと照合済みの登録表。 */
    manifest: NumericKernelManifest;
    /** 計算用Wasm。カーネルがなければ省略する。 */
    kernelWasm?: Uint8Array;
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
    _browser_load(pointer: number, length: number): number;
    _browser_tick(budget: number): void;
    _browser_stop(): void;
    _browser_state(): number;
    _browser_error(): number;
    _browser_pc(): number;
    _browser_instructions(): number;
    _browser_value(slot: number): number;
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
