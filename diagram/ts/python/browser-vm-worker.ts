/**
 * Emscripten製Python VMと計算用Wasmを同じWorkerで実行する。
 * VMのtick間でメッセージを受け、CALL_KERNEL中は同期呼出しが戻るまで処理を続ける。
 * メモリーは分離し、各配列全体を一度コピーして一度呼び、成功後に出力全体を反映する。
 */
import { browserAssetBase, browserKernelTags, browserVmErrors, loadBrowserAssets, readBrowserAsset } from "./browser-abi";
import type { BrowserPythonProgram, BrowserVM } from "./browser-abi";
import { BrowserWasiHost } from "./wasi-host";

/** Workerが所有するVM。実行終了までは破棄しない。 */
let vm: BrowserVM | undefined;
/** コンパイル・VM初期化中にも届く停止要求。C実行中はWorkerのイベントとして待機する。 */
let stopped = false;
/** 正常終了・停止・エラーの通知を一度だけ送る。 */
let completed = false;
/** tick内のprintを順序どおりにまとめる。VMの内部参照は保持しない。 */
let stdout: string[] = [];

/** tick終了時と終了・エラー通知の前に文字列出力を届ける。 */
function flushOutput(): void {
    if (stdout.length !== 0) {
        self.postMessage({ kind: "stdout", text: stdout.join("") });
        stdout = [];
    }
}

/** 完了時だけUIへ渡す大域値。数値配列のNaN・Infもそのまま保持する。 */
function readGlobals(program: BrowserPythonProgram): Record<string, unknown> {
    const values: Record<string, unknown> = Object.create(null);
    for (const global of program.globals) {
        const pointer = vm!._browser_value(global.slot);
        const descriptor = new Float64Array(vm!.HEAPU8.buffer, pointer, 4);
        const [tag, scalar, address, length] = descriptor;
        values[global.name] = tag === 1 || tag === 2 ? scalar : tag === 3 ? null
            : tag === 6 ? new TextDecoder().decode(vm!.HEAPU8.subarray(address, address + length))
                : tag === 100 ? new Float32Array(vm!.HEAPU8.buffer, address, length).slice()
                    : tag === 101 ? vm!.HEAPU8.slice(address, address + length) : `[VM値: ${tag}]`;
    }
    return values;
}

/** VMと計算用メモリーの間を同期コピーする。数値の検査・補正は挿入しない。 */
function connectKernel(instance: WebAssembly.Instance, program: BrowserPythonProgram): (id: number, n: number, address: number, count: number) => number {
    const memory = instance.exports.memory as WebAssembly.Memory;
    const allocate = instance.exports.uroa_kernel_alloc as (bytes: number) => number;
    const release = instance.exports.uroa_kernel_free as (pointer: number) => void;
    if (!(memory instanceof WebAssembly.Memory) || typeof allocate !== "function" || typeof release !== "function") {
        throw new Error("計算用Wasmのメモリー・接続関数がありません");
    }
    return (id, n, address, count) => {
        const entry = program.manifest.kernels.find(item => item.id === id);
        if (!entry || count !== entry.argumentTypes.length) {
            return browserVmErrors.unavailable;
        }
        const run = instance.exports[entry.publicName] as Function;
        if (typeof run !== "function") {
            return browserVmErrors.unavailable;
        }
        const allocated: number[] = [];
        const copies: { source: number; target: number; bytes: number; output: boolean }[] = [];
        const args: number[] = [n];
        try {
            const descriptors = new Float64Array(vm!.HEAPU8.buffer, address, count * 4);
            for (let index = 0; index < count; index++) {
                const [tag, scalar, source, length] = descriptors.subarray(index * 4, index * 4 + 4);
                if (tag === browserKernelTags.i32 || tag === browserKernelTags.f32) {
                    args.push(scalar);
                    continue;
                }
                const bytes = length * Float32Array.BYTES_PER_ELEMENT;
                const target = allocate(bytes);
                if (!target) {
                    return browserVmErrors.memory;
                }
                allocated.push(target);
                copies.push({ source, target, bytes, output: tag === browserKernelTags.out_f32 });
                args.push(target, length);
            }
            // 全割当て後にビューを作り直し、メモリー拡張による古いbufferの失効を避ける。
            for (const copy of copies) {
                new Uint8Array(memory.buffer, copy.target, copy.bytes).set(vm!.HEAPU8.subarray(copy.source, copy.source + copy.bytes));
            }
            run(...args);
            for (const copy of copies) {
                if (copy.output) {
                    vm!.HEAPU8.set(new Uint8Array(memory.buffer, copy.target, copy.bytes), copy.source);
                }
            }
            return browserVmErrors.none;
        }
        catch (error) {
            self.postMessage({ kind: "kernelError", message: String(error) });
            return browserVmErrors.failure;
        }
        finally {
            for (const pointer of allocated) {
                release(pointer);
            }
        }
    };
}

/** VM用メモリーへ一時データを置き、同期C処理へ渡す。 */
function withBytes(bytes: Uint8Array, action: (pointer: number) => void): void {
    const pointer = vm!._malloc(Math.max(1, bytes.length));
    if (!pointer) {
        throw new Error("VMの転送領域を確保できません");
    }
    try {
        vm!.HEAPU8.set(bytes, pointer);
        action(pointer);
    }
    finally {
        vm!._free(pointer);
    }
}

/** 一組の成果物を初期化してからVMのtickを開始する。 */
async function execute(program: BrowserPythonProgram): Promise<void> {
    const assets = await loadBrowserAssets();
    let kernelInvoke: (id: number, n: number, address: number, count: number) => number = () => browserVmErrors.unavailable;
    if (program.kernelWasm) {
        const host = new BrowserWasiHost();
        host.filesystem.fs.mkdirSync("/home/wasm", { recursive: true });
        const wasi = host.createWasi();
        const { instance } = await WebAssembly.instantiate(new Uint8Array(program.kernelWasm), { wasi_snapshot_preview1: wasi.wasiImport });
        wasi.setMemory(instance.exports.memory as WebAssembly.Memory);
        kernelInvoke = connectKernel(instance, program);
    }
    // public配下は静的資産として取得する。Vite開発時のソースimport経路へ渡さない。
    // JSもハッシュ照合し、Blobの相対URL解決を避けるためlocateFileを明示する。
    const moduleSource = await readBrowserAsset("python-vm.mjs", assets);
    const wasmBinary = await readBrowserAsset("python-vm.wasm", assets);
    const moduleURL = URL.createObjectURL(new Blob([moduleSource], { type: "text/javascript" }));
    try {
        const factory = (await import(/* @vite-ignore */ moduleURL)).default;
        vm = await factory({ wasmBinary, kernelInvoke,
            pythonPrint: (address: number, length: number) => {
                // 埋込NULも長さどおりに読み、print 1回につき改行を付加する。
                stdout.push(new TextDecoder().decode(vm!.HEAPU8.subarray(address, address + length)), "\n");
            },
            locateFile: (name: string) => new URL(browserAssetBase + name, self.location.href).href });
    }
    finally {
        URL.revokeObjectURL(moduleURL);
    }
    if (stopped) {
        finish(program, true);
        return;
    }
    if (program.print) {
        if (!/^[0-9a-f]{64}$/.test(program.print.abiHash)) {
            throw new Error("printのAPI指紋が不正です");
        }
        const apiHash = Uint8Array.from(program.print.abiHash.match(/../g)!, hex => Number.parseInt(hex, 16));
        withBytes(apiHash, pointer => {
            if (!vm!._browser_bind_print(program.print!.id, pointer)) {
                throw new Error("ブラウザのprint登録に失敗しました");
            }
        });
    }
    const hash = Uint8Array.from(program.manifest.kernelSetHash.match(/../g)!, hex => Number.parseInt(hex, 16));
    withBytes(hash, pointer => vm!._browser_kernel_hash(pointer));
    for (const entry of program.manifest.kernels) {
        withBytes(Uint8Array.from(entry.argumentTypes, type => browserKernelTags[type]), pointer => {
            if (!vm!._browser_register_kernel(entry.id, pointer, entry.argumentTypes.length)) {
                throw new Error("カーネルの登録に失敗しました");
            }
        });
    }
    // VMはイメージを借用するため、実行終了まで専用領域を保持する。
    const image = vm!._malloc(program.bytecode.length);
    if (!image) {
        throw new Error("VMイメージの領域を確保できません");
    }
    vm!.HEAPU8.set(program.bytecode, image);
    if (!vm!._browser_load(image, program.bytecode.length)) {
        throw new Error(`VMを開始できません (${vm!._browser_error()})`);
    }
    self.postMessage({ kind: "started" });
    /** 次のイベントループへ返し、停止要求をC復帰後に受け取る。 */
    const tick = (): void => {
        try {
            if (stopped) {
                vm!._browser_stop();
            }
            else {
                vm!._browser_tick(4096);
            }
            flushOutput();
            if (vm!._browser_state() === 1) {
                setTimeout(tick, 0);
            }
            else {
                finish(program, stopped);
                vm!._browser_stop();
                vm!._free(image);
            }
        }
        catch (error) {
            flushOutput();
            self.postMessage({ kind: "error", message: String(error) });
        }
    };
    tick();
}

/** 成功・停止・VMエラーを一度だけ通知する。 */
function finish(program: BrowserPythonProgram, stop: boolean): void {
    if (completed) {
        return;
    }
    completed = true;
    const error = vm?._browser_error() ?? 0;
    self.postMessage({ kind: "finished", stopped: stop, error, pc: vm?._browser_pc() ?? 0,
        instructions: vm?._browser_instructions() ?? 0, globals: stop || error ? {} : readGlobals(program) });
}

self.onmessage = event => {
    if (event.data.kind === "stop") {
        stopped = true;
    }
    else if (event.data.kind === "run") {
        void execute(event.data.program).catch(error => self.postMessage({ kind: "error", message: String(error) }));
    }
};
