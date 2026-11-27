/**
 * PythonBlockとブラウザのコンパイル・実行Workerを接続する。
 * コンパイラーは共有して直列利用し、実行VMはPythonBlockの開始ごとに分離する。
 * Stopではメッセージだけを送る。実行WorkerのterminateはC復帰・完了通知後だけ行う。
 */
import { createNumericKernelArtifact } from "./kernel-c";
import type { NumericKernelArtifact } from "./kernel-c";
import { generateBrowserBytecode } from "./bytecode";
import type { PythonAnalysis } from "./semantic";
import type { BrowserPythonProgram } from "./browser-abi";

/** 固定資産を一度展開する共有コンパイラー。 */
let compiler: Worker | undefined;
/** コンパイルWorkerが受信処理を登録したことを示す待機状態。 */
let compilerReady: Promise<void> | undefined;
/** 現在のWorkerの準備完了通知を受け取る処理。 */
let readyResolve: (() => void) | undefined;
/** 初期化中の異常も待機中の呼出しへ伝える処理。 */
let readyReject: ((error: Error) => void) | undefined;
/** コンパイル要求の番号。 */
let nextCompileId = 0;
/** 応答待ちの要求。 */
const compilation = new Map<number, {
    /** 完了した計算用Wasmを受け取る。 */
    resolve: (bytes: Uint8Array) => void;
    /** 初期化・コンパイルの異常を受け取る。 */
    reject: (error: Error) => void;
    /** Worker内の現在の段階を表示する。 */
    progress: (message: string) => void;
}>();

/** Workerの異常終了で、待機中の要求をすべて失敗として解決する。 */
function resetCompiler(error: Error): void {
    compiler?.terminate();
    compiler = undefined;
    readyReject?.(error);
    compilerReady = undefined;
    readyResolve = undefined;
    readyReject = undefined;
    for (const request of compilation.values()) {
        request.reject(error);
    }
    compilation.clear();
}

/**
 * Workerの準備完了後に要求を送る。Binaryenの初期化待ちで最初の要求を失わない。
 * progress通知では要求を完了させず、成功または失敗の応答まで対応を保持する。
 * 準備・コンパイル待ちの取消は呼出しの待機を解除する。数値計算用の実行Workerは操作しない。
 */
function compile(artifact: NumericKernelArtifact, progress: (message: string) => void, signal: AbortSignal): Promise<Uint8Array> {
    if (!compiler) {
        compiler = new Worker(new URL("./browser-kernel-worker.ts", import.meta.url), { type: "module" });
        compilerReady = new Promise<void>((resolve, reject) => {
            readyResolve = resolve;
            readyReject = reject;
        });
        compiler.onerror = event => resetCompiler(new Error(event.message || "CコンパイラーのWorkerが終了しました"));
        compiler.onmessageerror = () => resetCompiler(new Error("CコンパイラーのWorker応答を読み取れません"));
        compiler.onmessage = event => {
            if (event.data.kind === "ready") {
                readyResolve?.();
                readyResolve = undefined;
                readyReject = undefined;
                return;
            }
            const request = compilation.get(event.data.id);
            if (request) {
                if (event.data.kind === "progress") {
                    request.progress(event.data.message);
                    return;
                }
                compilation.delete(event.data.id);
                if (event.data.error) {
                    request.reject(new Error(event.data.error));
                }
                else {
                    request.resolve(event.data.wasm);
                }
            }
        };
    }
    const worker = compiler;
    const ready = compilerReady!;
    let cancel: () => void;
    return new Promise<Uint8Array>((resolve, reject) => {
        const id = ++nextCompileId;
        cancel = () => {
            compilation.delete(id);
            reject(new DOMException("コンパイル待ちを取り消しました", "AbortError"));
        };
        compilation.set(id, { resolve, reject, progress });
        signal.addEventListener("abort", cancel, { once: true });
        // readyの失敗にも必ず受信先を設け、準備中の異常を未処理のPromiseにしない。
        void ready.then(() => {
            if (compilation.has(id)) {
                progress("Cコンパイラーの処理開始を待っています…");
                worker.postMessage({ id, artifact });
            }
        }).catch(error => {
            compilation.delete(id);
            reject(error);
        });
        if (signal.aborted) {
            cancel();
        }
    }).finally(() => signal.removeEventListener("abort", cancel));
}

/** 1回のブラウザ実行の所有者。停止要求はC計算から戻った後に反映する。 */
export class BrowserPythonRuntime {
    /** 開始・実行中のWorker。 */
    private worker?: Worker;
    /** 準備中の停止要求も記録する。 */
    private stopped = false;

    /** C生成・コンパイル・VM開始・正常終了までを同じ成果物で行う。 */
    async run(analysis: PythonAnalysis, signal: AbortSignal, status: (text: string) => void): Promise<Record<string, unknown>> {
        const cancel = () => this.stop();
        signal.addEventListener("abort", cancel, { once: true });
        try {
            signal.throwIfAborted();
            status("ブラウザ用Cを生成しています…");
            const artifact = await createNumericKernelArtifact(analysis, signal);
            let kernelWasm: Uint8Array | undefined;
            if (artifact.manifest.kernels.length !== 0) {
                status("CコンパイラーのWorkerを起動しています…");
                kernelWasm = await compile(artifact, status, signal);
            }
            signal.throwIfAborted();
            if (this.stopped) {
                throw new DOMException("開始を取り消しました", "AbortError");
            }
            const program: BrowserPythonProgram = { bytecode: generateBrowserBytecode(analysis, artifact.manifest),
                manifest: artifact.manifest, kernelWasm,
                globals: [...analysis.globals.values()].map(variable => ({ name: variable.name, slot: variable.slot })) };
            status("ブラウザ用Python VMを準備しています…");
            return await new Promise((resolve, reject) => {
                const worker = this.worker = new Worker(new URL("./browser-vm-worker.ts", import.meta.url), { type: "module" });
                let kernelFailure: string | undefined;
                /** 実行が完了したWorkerだけを破棄する。 */
                const finish = (): void => {
                    worker.terminate();
                    this.worker = undefined;
                };
                worker.onerror = event => {
                    finish();
                    reject(new Error(event.message || "ブラウザのVMが終了しました"));
                };
                worker.onmessage = event => {
                    const data = event.data;
                    if (data.kind === "started") {
                        status("ブラウザのPython VMを実行しています…");
                    }
                    else if (data.kind === "kernelError") {
                        kernelFailure = data.message;
                    }
                    else if (data.kind === "error" || data.kind === "finished") {
                        finish();
                        if (data.kind === "error" || data.error) {
                            reject(new Error(data.message ?? kernelFailure ?? `VM実行エラー：番号=${data.error}、PC=${data.pc}`));
                        }
                        else if (data.stopped) {
                            reject(new DOMException("VMを停止しました", "AbortError"));
                        }
                        else {
                            status(`ブラウザで実行完了：VM命令数=${data.instructions}`);
                            resolve(data.globals);
                        }
                    }
                };
                worker.postMessage({ kind: "run", program });
            });
        }
        finally {
            signal.removeEventListener("abort", cancel);
        }
    }

    /** C実行を中断せず、Workerの次のイベント処理で停止するよう要求する。 */
    stop(): void {
        this.stopped = true;
        this.worker?.postMessage({ kind: "stop" });
    }
}
