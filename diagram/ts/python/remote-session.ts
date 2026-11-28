/**
 * ブラウザ受付・BLE公開定義・ESP32の開始を1組として所有する。
 * device-rpc.tsの共通APIから既存のBLE通信を呼ぶ。rpc-protocol.tsが通信契約、
 * BrowserRemoteRuntimeがメソッド実行、PythonBlockが編集と全体Stopを担当する。
 * 第3段階は整数通知だけ。Worker受付後にACKし、メソッド失敗は表示と全体停止へ伝える。
 */
import { diagramDevice } from "../ble-wifi/device-connection";
import { encodeRpcConfiguration, rpcProtocol } from "../ble-wifi/rpc-protocol";
import type { RpcClient } from "../ble-wifi/rpc-client";
import type { RemoteRpcCalls } from "../ble-wifi/device-rpc";
import { BrowserRemoteRuntime } from "./browser-runtime";
import type { RemoteProgramBuild } from "./remote";

/** 同一ページで使い回さないRPC実行世代。初期値もページの再読込を考慮して選ぶ。 */
let nextNonce = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7FFFFFFF;

/** BLEの要求キューをブラウザVMへ配送し、終了・エラー時に両側を止める。 */
export class RemoteBleSession {
    /** Remoteの実行元。終了通知までWorkerを保持する。 */
    private readonly runtime = new BrowserRemoteRuntime();
    /** 設定・メソッド受付の生存期間。 */
    private readonly controller = new AbortController();
    /** BLEの現接続へ限定したRPC窓口。 */
    private transport?: RpcClient<RemoteRpcCalls>;
    /** 配送ループ。通常のESP32終了後も未ACK要求を配送する。 */
    private pump?: Promise<void>;
    /** 開始・設定の途中でもStopが完了を待てるよう保持する。 */
    private preparing?: Promise<void>;
    /** 明示停止の重複処理をまとめる。 */
    private closing?: Promise<void>;
    /** 正常な停止でのclosed通知を障害と混同しない。 */
    private stopping = false;
    /** 待機タイマーをStopで即座に解除する処理。 */
    private wake?: () => void;
    /** 親の取消購読を解除する。 */
    private releaseAbort?: () => void;

    /** 異常はPythonBlockが表示し、VM停止を行う。 */
    constructor(private readonly failed: (error: Error) => void) {
    }

    /** ブラウザの準備完了後に公開定義を登録する。ESP32コードの送信・開始は呼出元が続けて行う。 */
    start(build: RemoteProgramBuild, signal: AbortSignal, status: (text: string) => void,
        output: (text: string) => void): Promise<void> {
        const config = encodeRpcConfiguration(build);
        if (nextNonce >= 0xFFFFFFFF) {
            throw new Error("RPC実行世代の上限です。ページを再読み込みしてください");
        }
        const nonce = ++nextNonce;
        const cancel = () => {
            void this.stop();
        };
        signal.addEventListener("abort", cancel, { once: true });
        this.releaseAbort = () => signal.removeEventListener("abort", cancel);
        if (signal.aborted) {
            this.controller.abort();
        }
        const task = (async () => {
            this.controller.signal.throwIfAborted();
            if (diagramDevice.state.phase !== "connected" || diagramDevice.state.transport !== "ble") {
                throw new Error("第3段階のRPCにはBLE接続が必要です");
            }
            await diagramDevice.rpc.call("program.stop");
            this.controller.signal.throwIfAborted();
            await this.runtime.start(build, this.controller.signal, status, output);
            this.controller.signal.throwIfAborted();
            this.transport = await diagramDevice.rpc.call("remote.open", { nonce });
            await this.transport.call("registry.configure", { config }, { signal: this.controller.signal });
            this.controller.signal.throwIfAborted();
            // ブラウザの異常終了は、ESP32が終了している場合も一組の終了として扱う。
            void this.runtime.closed.then(() => {
                if (!this.stopping) {
                    this.failed(new Error("ブラウザのRPC受付が終了しました"));
                }
            });
            this.pump = this.deliver().catch(error => {
                if (!this.stopping) {
                    this.failed(error instanceof Error ? error : new Error(String(error)));
                }
            });
        })();
        this.preparing = task;
        return task;
    }

    /** 先頭要求を一度だけWorkerへ渡し、受付確認後にESP32へACKする。完了は待たない。 */
    private async deliver(): Promise<void> {
        let lastId = 0;
        while (!this.stopping) {
            const request = await this.transport!.call("request.read");
            if (this.stopping) {
                return;
            }
            if (request) {
                if (request.id <= lastId) {
                    throw new Error("古いRPC要求が再配送されました");
                }
                await new Promise<void>((resolve, reject) => {
                    void this.runtime.call(request.object, request.method, request.arguments, resolve).catch(error => {
                        reject(error);
                        if (!this.stopping) {
                            this.failed(error instanceof Error ? error : new Error(String(error)));
                        }
                    });
                });
                lastId = request.id;
                if (this.stopping) {
                    return;
                }
                await this.transport!.call("request.acknowledge", { id: request.id });
            }
            else {
                await new Promise<void>(resolve => {
                    const timer = setTimeout(() => {
                        this.wake = undefined;
                        resolve();
                    }, rpcProtocol.pollMs);
                    this.wake = () => {
                        clearTimeout(timer);
                        this.wake = undefined;
                        resolve();
                    };
                });
            }
        }
    }

    /** 準備・配送を止めてC復帰を待つ。ESP32の登録解除は所有者のVM_STOPに任せる。 */
    stop(): Promise<void> {
        if (this.closing) {
            return this.closing;
        }
        this.stopping = true;
        this.controller.abort();
        this.wake?.();
        this.releaseAbort?.();
        this.closing = (async () => {
            await this.runtime.stop();
            await this.preparing?.catch(() => undefined);
            await this.pump;
        })();
        return this.closing;
    }
}
