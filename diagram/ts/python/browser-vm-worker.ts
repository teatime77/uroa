/**
 * Emscripten製Python VMと計算用Wasmを同じWorkerで実行する。
 * VMのtick間でメッセージを受け、CALL_KERNEL中は同期呼出しが戻るまで処理を続ける。
 * メモリーは分離し、各配列全体を一度コピーして一度呼び、成功後に出力全体を反映する。
 * RPCの公開表・スカラー型はbrowser-abi.ts、要求元の所有はbrowser-runtime.ts、
 * 関数表との照合・RETでの停止・大域を根とする回収はbrowser/host.cppと共通VMが担当する。
 */
import { browserAssetBase, browserKernelTags, browserRpcLimits, browserRpcTags, browserVmErrors, loadBrowserAssets, readBrowserAsset } from "./browser-abi";
import type { BrowserPythonProgram, BrowserVM, BrowserRpcRequest, BrowserRpcScalar, BrowserRpcMethod, BrowserRpcErrorCode } from "./browser-abi";
import { BrowserWasiHost } from "./wasi-host";

/** Workerが所有するVM。実行終了までは破棄しない。 */
let vm: BrowserVM | undefined;
/** コンパイル・VM初期化中にも届く停止要求。C実行中はWorkerのイベントとして待機する。 */
let stopped = false;
/** 正常終了・停止・エラーの通知を一度だけ送る。 */
let completed = false;
/** tick内のprintを順序どおりにまとめる。VMの内部参照は保持しない。 */
let stdout: string[] = [];
/** このWorkerで一度だけ初期化するプログラム。通常実行とRPC実行を同時に所有しない。 */
let currentProgram: BrowserPythonProgram | undefined;
/** VMが借用するイメージ。RPC受付中も保持し、終了時に一度だけ解放する。 */
let imagePointer = 0;
/** 予約済みの次tick。待機中は予約せず、要求・停止の受信時だけ起こす。 */
let scheduled: ReturnType<typeof setTimeout> | undefined;
/** 初期化と公開表の照合が完了したか。 */
let rpcReady = false;
/** 実行中を除く、受付順の要求。上限判定では実行中1件も数える。 */
const requests: BrowserRpcRequest[] = [];
/** 現在の関数呼出し。VMへ入るのはこの1件だけ。 */
let activeRequest: BrowserRpcRequest | undefined;
/** 受付済みIDの最大値。履歴を無制限に保持せず、重複・逆順の再実行を拒否する。 */
let lastRequestId = 0;

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
    imagePointer = vm!._malloc(program.bytecode.length);
    if (!imagePointer) {
        throw new Error("VMイメージの領域を確保できません");
    }
    vm!.HEAPU8.set(program.bytecode, imagePointer);
    if (!vm!._browser_load(imagePointer, program.bytecode.length)) {
        throw new Error(`VMを開始できません (${vm!._browser_error()})`);
    }
    self.postMessage({ kind: "started" });
    scheduleTick();
}

/** 次のイベントループへ返し、停止・RPC要求をC復帰後に受け取る。予約は1件だけ。 */
function scheduleTick(): void {
    if (!completed && scheduled === undefined) {
        scheduled = setTimeout(tick, 0);
    }
}

/** 第2段階のスカラー型と実行可能な範囲を、VMへ渡す前に検査する。 */
function validArgument(value: unknown, type: string): value is BrowserRpcScalar {
    if (type === "int") {
        return typeof value === "number" && Number.isInteger(value) && value >= -0x80000000 && value <= 0x7FFFFFFF;
    }
    if (type === "float") {
        return typeof value === "number" && Number.isFinite(Math.fround(value));
    }
    if (type === "str") {
        return typeof value === "string" && new TextEncoder().encode(value).length <= browserRpcLimits.stringBytes;
    }
    return type === "none" && value === null;
}

/** 初期化終了時にだけ公開表を登録し、大域のRemoteを残して一時値を回収する。 */
function prepareRpc(program: BrowserPythonProgram): void {
    const rpc = program.rpc!;
    if (!Number.isInteger(rpc.session) || rpc.session < 1 || rpc.session > browserRpcLimits.maxId
        || !/^[0-9a-f]{64}$/.test(rpc.fingerprint) || rpc.methods.length === 0) {
        throw new Error("RPCの公開情報が不正です");
    }
    for (const method of rpc.methods) {
        if (![method.object, method.method, method.classId].every(value => Number.isInteger(value) && value >= 1 && value <= 65535)
            || ![method.slot, method.entry].every(value => Number.isInteger(value) && value >= 0 && value <= 65535)
            || method.parameters.length > browserRpcLimits.arguments
            || [...method.parameters, method.result].some(type => !Object.hasOwn(browserRpcTags, type))) {
            throw new Error("RPCのメソッド登録情報が不正です");
        }
        withBytes(Uint8Array.from([...method.parameters, method.result], type => browserRpcTags[type]), pointer => {
            if (!vm!._browser_rpc_register(method.object, method.method, method.slot, method.classId,
                method.entry, pointer, method.parameters.length)) {
                throw new Error("RPCの関数入口・署名・selfを照合できません");
            }
        });
    }
    if (!vm!._browser_rpc_release()) {
        throw new Error("RPC初期化後の一時値を回収できません");
    }
    rpcReady = true;
    self.postMessage({ kind: "rpcReady", session: rpc.session });
}

/** 引数は同期C呼出し中にVMへコピーする。mallocによるbuffer拡張後に記述子を書き込む。 */
function beginRequest(request: BrowserRpcRequest, method: BrowserRpcMethod): void {
    const allocated: number[] = [];
    const descriptors = new Float64Array(request.arguments.length * 4);
    try {
        for (const [index, value] of request.arguments.entries()) {
            const type = method.parameters[index];
            descriptors[index * 4] = browserRpcTags[type];
            if (typeof value === "number") {
                descriptors[index * 4 + 1] = type === "float" ? Math.fround(value) : value;
            }
            else if (typeof value === "string") {
                const bytes = new TextEncoder().encode(value);
                const pointer = vm!._malloc(Math.max(1, bytes.length));
                if (!pointer) {
                    throw new Error("RPC引数の転送領域を確保できません");
                }
                allocated.push(pointer);
                vm!.HEAPU8.set(bytes, pointer);
                descriptors[index * 4 + 2] = pointer;
                descriptors[index * 4 + 3] = bytes.length;
            }
        }
        withBytes(new Uint8Array(descriptors.buffer), pointer => {
            if (!vm!._browser_rpc_begin(request.object, request.method, pointer, request.arguments.length)) {
                throw new Error(`RPCメソッドを開始できません (${vm!._browser_error()})`);
            }
        });
    }
    finally {
        for (const pointer of allocated) {
            vm!._free(pointer);
        }
    }
}

/** 結果の借用はこの同期処理内だけ。次のGC・tick・stopより前にJSの値へコピーする。 */
function readRpcResult(): BrowserRpcScalar {
    const pointer = vm!._browser_rpc_result();
    if (!pointer) {
        throw new Error("RPCの戻り値が公開署名と一致しません");
    }
    const descriptor = new Float64Array(vm!.HEAPU8.buffer, pointer, 4);
    const tag = descriptor[0];
    if (tag === browserRpcTags.int || tag === browserRpcTags.float) {
        return descriptor[1];
    }
    if (tag === browserRpcTags.none) {
        return null;
    }
    if (tag === browserRpcTags.str) {
        if (descriptor[3] > browserRpcLimits.stringBytes) {
            throw new Error("RPCの戻り値の文字列が上限を超えています");
        }
        return new TextDecoder().decode(vm!.HEAPU8.subarray(descriptor[2], descriptor[2] + descriptor[3]));
    }
    throw new Error("RPCの戻り値はスカラーだけに対応しています");
}

/** 初期化と1件のRPCを同じVMでtickする。RPC待機中はタイマーを回さない。 */
function tick(): void {
    scheduled = undefined;
    const program = currentProgram;
    if (completed || !program || !vm) {
        return;
    }
    try {
        if (stopped) {
            finish(program, true);
            return;
        }
        if (rpcReady && activeRequest === undefined) {
            activeRequest = requests.shift();
            if (activeRequest === undefined) {
                return;
            }
            const method = program.rpc!.methods.find(item => item.object === activeRequest!.object && item.method === activeRequest!.method)!;
            beginRequest(activeRequest, method);
        }
        vm._browser_tick(4096);
        flushOutput();
        const state = vm._browser_state();
        if (state === 1) {
            scheduleTick();
        }
        else if (state === 2 && program.rpc) {
            if (!rpcReady) {
                prepareRpc(program);
            }
            else if (activeRequest !== undefined) {
                const value = readRpcResult();
                if (!vm._browser_rpc_release()) {
                    throw new Error("RPCの戻り値・一時値を解放できません");
                }
                self.postMessage({ kind: "rpcResult", session: program.rpc.session, id: activeRequest.id, value });
                activeRequest = undefined;
            }
            if (requests.length !== 0) {
                scheduleTick();
            }
        }
        else {
            finish(program, false);
        }
    }
    catch (error) {
        finish(program, false, String(error));
    }
}

/** 要求の失敗を、実行完了やセッション終了と区別して通知する。 */
function rejectRequest(request: BrowserRpcRequest, code: BrowserRpcErrorCode, message: string): void {
    self.postMessage({ kind: "rpcError", session: request.session, id: request.id, code, message });
}

/** 署名・世代・上限を検査してから一度だけ受付する。引数評価やRPCを再発行しない。 */
function acceptRequest(request: BrowserRpcRequest): void {
    const rpc = currentProgram?.rpc;
    if (!rpcReady || completed || stopped || !rpc || request.session !== rpc.session) {
        rejectRequest(request, "notReady", "現在のRPCセッションは受付可能ではありません");
        return;
    }
    if (!Number.isInteger(request.id) || request.id < 1 || request.id > browserRpcLimits.maxId
        || !Number.isInteger(request.object) || !Number.isInteger(request.method) || !Array.isArray(request.arguments)) {
        rejectRequest(request, "invalidRequest", "RPC要求の形式が不正です");
        return;
    }
    if (request.id <= lastRequestId) {
        rejectRequest(request, "duplicate", "受付済みまたは古いRPC要求IDです");
        return;
    }
    const method = rpc.methods.find(item => item.object === request.object && item.method === request.method);
    if (!method) {
        rejectRequest(request, "unknownMethod", "公開されていないRPCメソッドです");
        return;
    }
    if (request.arguments.length !== method.parameters.length
        || request.arguments.some((value, index) => !validArgument(value, method.parameters[index]))) {
        rejectRequest(request, "argument", "RPC引数の個数・型・範囲が公開署名と一致しません");
        return;
    }
    if (requests.length + (activeRequest === undefined ? 0 : 1) >= browserRpcLimits.pending) {
        rejectRequest(request, "busy", "RPCの待ち数が上限に達しました");
        return;
    }
    lastRequestId = request.id;
    requests.push(request);
    self.postMessage({ kind: "rpcAccepted", session: rpc.session, id: request.id });
    scheduleTick();
}

/** 成功・停止・VMエラーを一度だけ通知する。VM復帰後に全資源を解放してから親へ終了を渡す。 */
function finish(program: BrowserPythonProgram, stop: boolean, message?: string): void {
    if (completed) {
        return;
    }
    completed = true;
    rpcReady = false;
    if (scheduled !== undefined) {
        clearTimeout(scheduled);
        scheduled = undefined;
    }
    flushOutput();
    const error = vm?._browser_error() ?? 0;
    const pc = vm?._browser_pc() ?? 0;
    const instructions = vm?._browser_instructions() ?? 0;
    let globals: Record<string, unknown> = {};
    try {
        if (!stop && !error && !message && !program.rpc) {
            globals = readGlobals(program);
        }
    }
    catch (failure) {
        message = String(failure);
    }
    for (const request of [...(activeRequest === undefined ? [] : [activeRequest]), ...requests]) {
        rejectRequest(request, stop ? "stopped" : "vmError", message ?? `RPCセッションが終了しました (VM=${error})`);
    }
    activeRequest = undefined;
    requests.length = 0;
    vm?._browser_stop();
    if (imagePointer) {
        vm!._free(imagePointer);
        imagePointer = 0;
    }
    self.postMessage({ kind: message === undefined ? "finished" : "error", stopped: stop, error, pc,
        instructions, globals, message, session: program.rpc?.session });
}

self.onmessage = event => {
    if (event.data?.kind === "stop") {
        stopped = true;
        if (vm) {
            scheduleTick();
        }
    }
    else if (event.data?.kind === "rpc") {
        acceptRequest(event.data);
    }
    else if (event.data?.kind === "run" && currentProgram === undefined) {
        currentProgram = event.data.program;
        void execute(event.data.program).catch(error => finish(event.data.program, false, String(error)));
    }
};
