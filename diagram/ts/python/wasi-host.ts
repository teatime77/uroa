/**
 * 固定版wccのwa_proc.ts/wasi_worker.tsを基にした、既存Wasmerホストへの接続。
 * 上流: tyfkda/xcc 659a1773f20499864a8c3fdc7cd25cb506092bc1 (MIT、配布資産にLICENSEを保持)。
 * ファイルシステムとWASIは既存ライブラリーを使い、上流の実行・終了コードの扱いを共有する。
 */
import { WASI, WASIExitError } from "@wasmer/wasi";
import { WasmFs } from "@wasmer/wasmfs";
import path from "path-browserify";

/** コンパイラー用の仮想ファイルシステムと固定WASIホスト。Worker内で直列に使用する。 */
export class BrowserWasiHost {
    /** 上流と同じ既存仮想ファイルシステム。 */
    readonly filesystem = new WasmFs();
    /** ファイル診断の出力先。 */
    output: (text: string) => void = () => undefined;

    /** stdout/stderrの出力をコンパイラー診断へ転送する。 */
    constructor() {
        const fs = this.filesystem.fs;
        const original = fs.writeSync.bind(fs);
        fs.writeSync = ((fd: number, data: Uint8Array | string, offset?: number, length?: number, position?: number) => {
            if (fd === 1 || fd === 2) {
                this.output(typeof data === "string" ? data : new TextDecoder().decode(data.subarray(offset ?? 0, (offset ?? 0) + (length ?? data.length))));
            }
            return (original as Function)(fd, data, offset, length, position);
        }) as typeof fs.writeSync;
    }

    /** 同じWASIと仮想FSを計算用Wasmの初期化にも使う。 */
    createWasi(args: string[] = []): WASI {
        return new WASI({ args, env: { HOME: "/home/wasm", PWD: "/home/wasm", INCLUDE: "/usr/include", LIB: "/usr/lib" },
            bindings: { ...WASI.defaultBindings, fs: this.filesystem.fs, path }, preopens: { "/": "/", ".": "/home/wasm" } });
    }

    /** WASIの終了コードを返し、それ以外の異常は呼出し元へ伝える。 */
    async compile(args: string[]): Promise<number> {
        const wasi = this.createWasi(args);
        const bytes = this.filesystem.fs.readFileSync("/usr/bin/cc") as Uint8Array;
        const binary = new Uint8Array(bytes);
        const { instance } = await WebAssembly.instantiate(binary, { wasi_snapshot_preview1: wasi.wasiImport });
        try {
            wasi.start(instance);
            return 0;
        }
        catch (error) {
            if (error instanceof WASIExitError) {
                return error.code ?? 0;
            }
            throw error;
        }
    }
}
