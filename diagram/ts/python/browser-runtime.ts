/**
 * PythonBlockとブラウザのコンパイル・実行Workerを接続する。
 * コンパイラーは共有して直列利用し、実行VMはPythonBlockの開始ごとに分離する。
 * Stopではメッセージだけを送る。実行WorkerのterminateはC復帰・完了通知後だけ行う。
 * BrowserRemoteRuntimeは専用生成物のブラウザ側を起動し、公開中はWorkerとRPC要求を保持する。
 */
import { createNumericKernelArtifact } from "./kernel-c";
import type { NumericKernelArtifact } from "./kernel-c";
import { generateBrowserBytecode } from "./bytecode";
import type { PythonAnalysis } from "./semantic";
import type { BrowserPythonProgram } from "./browser-abi";
import { browserRpcLimits } from "./browser-abi";
import type { BrowserRpcErrorCode, BrowserRpcEvent, BrowserRpcMethod, BrowserRpcScalar } from "./browser-abi";
import type { RemoteProgramBuild } from "./remote";

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
/** RPC実行の世代。Workerを作り直すごとに増やし、同一ページで再利用しない。 */
let nextRpcSession = 0;
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

    /**
     * C生成・コンパイル・VM開始・正常終了までを同じ成果物で行う。
     * printは解析済みAPIの文字列1引数・None戻り値だけを登録し、出力は到着順に通知する。
     */
    async run(analysis: PythonAnalysis, signal: AbortSignal, status: (text: string) => void,
        output: (text: string) => void): Promise<Record<string, unknown>> {
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
            const print = analysis.api.functions.find(fn => fn.name === "print");
            if (print && (print.parameters.length !== 1 || print.parameters[0].type.kind !== "str" || print.returnType.kind !== "none")) {
                throw new Error("ブラウザのprintは文字列1引数とNoneの戻り値に対応しています");
            }
            const program: BrowserPythonProgram = { bytecode: generateBrowserBytecode(analysis, artifact.manifest),
                manifest: artifact.manifest, kernelWasm,
                print: print === undefined ? undefined : { id: print.nativeId, abiHash: analysis.api.abiHash },
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
                    else if (data.kind === "stdout") {
                        output(data.text);
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

/** Workerが拒否したRPCの種類を後続のBLE/Wi-Fi配送へ渡す。VMのError番号とは区別する。 */
export class BrowserRpcCallError extends Error {
    /** 受付前の不正・混雑・停止・VM失敗を識別するコード。 */
    readonly code: BrowserRpcErrorCode;

    /** 要求単位の失敗を生成する。 */
    constructor(code: BrowserRpcErrorCode, message: string) {
        super(message);
        this.name = "BrowserRpcCallError";
        this.code = code;
    }
}

/**
 * 1組の生成物のうちブラウザVMだけを起動し、初期化後もRemoteの受付を維持する。
 * start()はrpcReadyまで、call()は各メソッドの完了まで、stop()/closedはWorker終了までを表す。
 * 要求は単調増加IDと世代で照合し、再送しない。実行エラーは全保留要求を失敗にして受付を終える。
 * StopはC復帰後の終了通知を待ってterminateする。通常のBrowserPythonRuntimeとは寿命を分離する。
 * PythonBlockの2ソース開始ではremote-session.tsから利用する。
 */
export class BrowserRemoteRuntime {
    /** Worker内のVM。終了通知または異常終了まで保持する。 */
    private worker?: Worker;
    /** 初期化・コンパイル待ちの取消と、終了後の要求拒否に使う。 */
    private readonly controller = new AbortController();
    /** 1インスタンスを別のプログラムへ使い回さない。 */
    private started = false;
    /** Workerが公開表の照合と初期化を完了したか。 */
    private ready = false;
    /** 終了の処理を一度だけ行ったか。 */
    private finished = false;
    /** このWorkerへ割り当てた非0の世代。 */
    private session = 0;
    /** セッション内で使い回さない要求ID。 */
    private nextId = 0;
    /** 準備完了の通知先。 */
    private readyResolve?: () => void;
    /** 準備中の異常・停止の通知先。 */
    private readyReject?: (error: Error) => void;
    /** 親のAbortSignalの購読解除。RPC受付の寿命全体で保持する。 */
    private removeAbort?: () => void;
    /** 応答の復号・利用側コールバックが失敗した場合、C復帰後の終了まで保持する理由。 */
    private failure?: Error;
    /** closedの完了通知。closedは失敗時も解放完了としてresolveする。 */
    private closeResolve: () => void = () => {};
    /** C復帰とVM・イメージの解放後に完了する。 */
    readonly closed = new Promise<void>(resolve => {
        this.closeResolve = resolve;
    });
    /** 保留要求だけの対応表。受付通知では消さず、結果・失敗で除く。 */
    private readonly pending = new Map<number, {
        resolve: (value: BrowserRpcScalar) => void;
        reject: (error: Error) => void;
        accepted?: () => void;
    }>();

    /**
     * ブラウザ成果物のself・関数入口を公開署名へ結び、初期化後の受付まで待つ。
     * 生成物全体のexecutable=falseはESP32未接続を表す。ここではブラウザ用だけを実行する。
     * signalはstartの完了後も監視し、RPCの全寿命の取消に使う。
     */
    async start(build: RemoteProgramBuild, signal: AbortSignal, status: (text: string) => void,
        output: (text: string) => void): Promise<void> {
        if (this.started || this.finished || nextRpcSession >= browserRpcLimits.maxId) {
            throw new Error("RPC Runtimeは新しいインスタンスで開始してください");
        }
        this.started = true;
        this.session = ++nextRpcSession;
        const cancel = () => { void this.stop(); };
        signal.addEventListener("abort", cancel, { once: true });
        this.removeAbort = () => signal.removeEventListener("abort", cancel);
        if (signal.aborted) {
            cancel();
        }
        try {
            this.controller.signal.throwIfAborted();
            const info = build.browser.info;
            if (info.api.abiHash !== build.apiHash) {
                throw new Error("ブラウザ成果物のRPC指紋が一致しません");
            }
            const methods: BrowserRpcMethod[] = [];
            for (const object of build.registry.objects) {
                const self = info.globals.find(variable => variable.name === object.name);
                if (self?.type?.kind !== "object") {
                    throw new Error("公開Remoteオブジェクトの大域配置がありません");
                }
                for (const method of object.methods) {
                    const fn = info.functions.find(item => item.name === `${object.className}.${method.name}`);
                    if (!fn) {
                        throw new Error("公開Remoteメソッドの関数入口がありません");
                    }
                    methods.push({ object: object.id, method: method.id, slot: self.slot, classId: self.type.classId,
                        entry: fn.entryPc, parameters: method.parameters.map(parameter => parameter.type), result: method.result });
                }
            }
            let kernelWasm: Uint8Array | undefined;
            if (build.kernels.manifest.kernels.length !== 0) {
                status("RPC用の数値カーネルをコンパイルしています…");
                kernelWasm = await compile(build.kernels, status, this.controller.signal);
            }
            this.controller.signal.throwIfAborted();
            const print = info.api.functions.find(fn => fn.name === "print");
            const program: BrowserPythonProgram = { bytecode: build.browser.bytes, manifest: build.kernels.manifest,
                kernelWasm, print: print === undefined ? undefined : { id: print.nativeId, abiHash: build.apiHash },
                globals: info.globals.map(variable => ({ name: variable.name, slot: variable.slot })),
                rpc: { session: this.session, fingerprint: build.registry.fingerprint, methods } };
            status("ブラウザのRPC受付を準備しています…");
            await new Promise<void>((resolve, reject) => {
                this.readyResolve = resolve;
                this.readyReject = reject;
                const worker = this.worker = new Worker(new URL("./browser-vm-worker.ts", import.meta.url), { type: "module" });
                worker.onerror = event => this.finish(new Error(event.message || "RPC Workerが異常終了しました"));
                worker.onmessageerror = () => {
                    this.failure = new Error("RPC Workerの応答を読み取れません");
                    void this.stop();
                };
                worker.onmessage = event => {
                    const data = event.data;
                    if (data.kind === "finished" || data.kind === "error") {
                        this.finish(data.stopped ? new DOMException("RPCを停止しました", "AbortError")
                            : new Error(data.message ?? `RPC VMが終了しました (VM=${data.error}, PC=${data.pc})`));
                    }
                    else if (this.controller.signal.aborted) {
                        // Stop後の結果を新たに利用させず、終了通知で全保留要求を解決する。
                        return;
                    }
                    else if (data.kind === "stdout") {
                        try {
                            output(data.text);
                        }
                        catch (error) {
                            this.failure = error instanceof Error ? error : new Error(String(error));
                            void this.stop();
                        }
                    }
                    else if (data.kind === "kernelError") {
                        status(data.message);
                    }
                    else {
                        this.receive(data as BrowserRpcEvent);
                    }
                };
                worker.postMessage({ kind: "run", program });
            });
            status("ブラウザのRPC受付を開始しました。");
        }
        catch (error) {
            // 準備中の取消では共有コンパイラーだけが残り得る。実行Workerは終了を待つ。
            if (this.worker) {
                await this.stop();
            }
            else {
                this.finish(error instanceof Error ? error : new Error(String(error)));
            }
            throw error;
        }
    }

    /** 1回だけ送り完了値を受け取る。acceptedはWorker受付時に呼び、メソッド完了とは分ける。 */
    call(object: number, method: number, args: readonly BrowserRpcScalar[], accepted?: () => void): Promise<BrowserRpcScalar> {
        if (!this.ready || this.controller.signal.aborted || !this.worker) {
            return Promise.reject(new BrowserRpcCallError("notReady", "RPCは受付可能ではありません"));
        }
        if (this.pending.size >= browserRpcLimits.pending || this.nextId >= browserRpcLimits.maxId) {
            return Promise.reject(new BrowserRpcCallError("busy", "RPCの保留数または要求IDが上限に達しました"));
        }
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject, accepted });
            try {
                this.worker!.postMessage({ kind: "rpc", session: this.session, id, object, method, arguments: [...args] });
            }
            catch (error) {
                this.pending.delete(id);
                reject(error);
            }
        });
    }

    /** 明示Stopは全保留要求を取り消す。C実行中はWorkerの復帰後の停止・解放を待つ。 */
    stop(): Promise<void> {
        this.ready = false;
        this.controller.abort();
        if (this.worker) {
            this.worker.postMessage({ kind: "stop" });
        }
        else {
            this.finish(new DOMException("RPCを停止しました", "AbortError"));
        }
        return this.closed;
    }

    /** 世代を照合して、受付・結果・要求単位の拒否を分けて反映する。 */
    private receive(data: BrowserRpcEvent): void {
        if (data.session !== this.session || this.finished) {
            return;
        }
        if (data.kind === "rpcReady") {
            this.ready = true;
            this.readyResolve?.();
        }
        else if (data.kind === "rpcAccepted") {
            this.pending.get(data.id)?.accepted?.();
        }
        else if (data.kind === "rpcResult" || data.kind === "rpcError") {
            const request = this.pending.get(data.id);
            this.pending.delete(data.id);
            if (data.kind === "rpcResult") {
                request?.resolve(data.value);
            }
            else {
                request?.reject(new BrowserRpcCallError(data.code, data.message));
            }
        }
    }

    /** Workerの終了通知または異常終了後に、一度だけ要求・購読・Workerを解放する。 */
    private finish(error: Error): void {
        if (this.finished) {
            return;
        }
        this.finished = true;
        this.ready = false;
        error = this.failure ?? error;
        this.worker?.terminate();
        this.worker = undefined;
        this.removeAbort?.();
        this.removeAbort = undefined;
        this.readyReject?.(error);
        this.readyResolve = undefined;
        this.readyReject = undefined;
        for (const request of this.pending.values()) {
            request.reject(error);
        }
        this.pending.clear();
        this.closeResolve();
    }
}
