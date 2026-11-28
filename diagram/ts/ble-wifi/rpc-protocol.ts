/**
 * ESP32→ブラウザRPC第3段階の中心契約。BLE専用で、戻り値なし・整数0〜1引数を扱う。
 * bytecode_rpc.h/.cppが設定・要求キュー、uroa_ble.h/.cppがGATT、device-connection.tsが接続世代と
 * 通常指令との共通待ち列、python/remote-session.tsがブラウザVMとの仲介を担当する。
 * 固定領域と登録レコードの読み書きはwire.protoの生成codec、分割反復はwire-transfer.tsを使う。
 * 動的署名・指紋・連番・nonce・Worker受付ACKは本ファイルと既存の所有者が検査する。
 * Control=f364140d(Write)、Result=f364140e(Read)、Event=f364140f(Read)。UUID末尾は既存Serviceと共通。
 * 全パケットは20バイト以下、整数はlittle endian。Controlはversion:u8=1,op:u8,seq:u16,nonce:u32。
 * BEGIN(1)はtotal:u16@8,CRC32:u32@10で14バイト。DATA(2)はoffset:u16@8,data@10で11〜20バイト。
 * COMMIT(3)・END(5)は8バイト、ACK(4)はrequestId:u32@8の12バイト。連番は非0で折り返さない。
 * Resultは20バイト。Controlの先頭8バイトをechoし、code:u8@8,state:u8@9,received:u16@10、残り0。
 * code=0成功/1形式/2順序/3範囲/4混雑/5指紋不一致/6期限。state=0未登録/1受信/2登録済み。
 * 設定はversion:u8=1,count:u8,予約0:u16,baseApiHash[32]@4,rpcApiHash[32]@36,registryHash[32]@68、
 * 各10バイトのnativeId:u16,objectId:u16,methodId:u16,classId:u16,argc:u8,予約0:u8が@100から続く。
 * methodId=0は代理取得、その他はNone戻り値。追加nativeIdは基本APIの最大ID直後から連続させる。
 * Eventは20バイト。version:u8@0,kind:u8@1(0空/1要求/2障害),nonce:u32@2,id:u32@6,object:u16@10,
 * method:u16@12,argc:u8@14,error:u8@15,int32@16。先頭要求をACKまで保持し、Readで全件配送する。
 * ACKはWorker受付までを表し、メソッド完了ではない。通常終了後も未ACK要求を保持する。
 * ESP32の送信キュー8件・設定420バイト/32binding、設定受信2.5秒・要求配送5秒を上限とする。
 * ブラウザは100msごとにReadする。通知の欠落に依存せず、自動再送・自動再実行はしない。
 * nonceは開始ごとに更新し、設定はVM開始1回に使う。Stop・切断・経路変更では設定と要求を破棄する。
 * 一組のStopは通常のVM_STOPを送り、WorkerのC復帰待ちと独立させる。ENDも登録を破棄する管理操作。
 * baseApiHashは既存バックエンドと照合し、rpcApiHashは登録表とコードの対応を照合する。
 * 署名のハッシュ生成はremote.tsが担当し、ファームウェアは受信した公開名のハッシュを再計算しない。
 */
import { forWireChunks } from "./wire-transfer";
import * as wire from "./device-wire.generated";
import type { RemoteProgramBuild } from "../python/remote";
import { bytecodeCrc32 } from "./bytecode-transfer";

/** 現接続へ限定した専用GATT窓口。各操作は通常指令と共通の待ち列を使う。 */
export interface RpcChannel {
    writeControl(data: Uint8Array): Promise<void>;
    readResult(): Promise<DataView>;
    readEvent(): Promise<DataView>;
}

/** 20バイトのEventを全体検証した結果。 */
export interface RpcRequest {
    id: number;
    object: number;
    method: number;
    arguments: number[];
}

/** 第3段階の上限とControl操作。通信の版はWorker内RPCと分離する。 */
export const rpcProtocol = { version: 1, begin: 1, data: 2, commit: 3, ack: 4, end: 5,
    ok: 0, idle: 0, request: 1, fault: 2, maxBindings: 32, timeoutMs: 2500, pollMs: 100 } as const;

/** 16進指紋をバイト列へ変換し、不正な生成物を登録前に拒否する。 */
function hashBytes(hash: string): Uint8Array {
    if (!/^[0-9a-f]{64}$/.test(hash)) {
        throw new Error("RPCのAPI指紋が不正です");
    }
    return Uint8Array.from(hash.match(/../g)!, byte => Number.parseInt(byte, 16));
}

/** 第3段階で実行可能な署名だけを登録する。未対応async・型・個数は送信前に拒否する。 */
export function encodeRpcConfiguration(build: RemoteProgramBuild): Uint8Array {
    const bindings = build.nativeBindings;
    if (!bindings.length || bindings.length > rpcProtocol.maxBindings) {
        throw new Error("RPCの登録数は1〜32件にしてください");
    }
    const data = new Uint8Array(100 + bindings.length * 10);
    const view = new DataView(data.buffer);
    wire.writeRegistryHeader(view, 0, { version: rpcProtocol.version, count: bindings.length, reserved: 0,
        baseHash: hashBytes(build.baseApiHash), rpcHash: hashBytes(build.apiHash), registryHash: hashBytes(build.registry.fingerprint) });
    for (const [index, binding] of bindings.entries()) {
        const object = build.registry.objects.find(item => item.id === binding.objectId)!;
        const owner = build.esp32.info.api.classes.find(item => item.name === `$remote.${object.name}`)!;
        const method = object.methods.find(item => item.id === binding.methodId);
        if (binding.methodId !== 0 && (!method || method.asynchronous || method.result !== "none"
            || method.parameters.length > 1 || method.parameters.some(parameter => parameter.type !== "int"))) {
            throw new Error("第3段階のRPCはdef・None戻り値・整数引数0〜1個に対応しています");
        }
        const offset = 100 + index * 10;
        wire.writeRegistryRecord(view, offset, { native: binding.nativeId, object: binding.objectId,
            method: binding.methodId, classId: owner.id, argc: method?.parameters.length ?? 0, reserved: 0 });
    }
    return data;
}

/** ACKと未配送要求を別々に読み、世代・連番・CRCを照合するRPCの1実行。 */
export class RpcTransport {
    /** Controlの連番。セッション中は折り返さない。 */
    private sequence = 0;

    /** 接続に束縛された窓口と、実行ごとの非0 nonceを借用する。 */
    constructor(private readonly channel: RpcChannel, readonly nonce: number) {
    }

    /** 1操作のloop()での受付結果を待つ。GATT Write成功だけで採用済みとは扱わない。 */
    private async send(op: number, payload = new Uint8Array()): Promise<void> {
        if (this.sequence >= 65535) {
            throw new Error("RPCの操作連番が上限に達しました");
        }
        const sequence = ++this.sequence;
        const bytes = wire.encodeRemoteHeader({ version: rpcProtocol.version, op, sequence, nonce: this.nonce }, payload);
        await this.channel.writeControl(bytes);
        const deadline = performance.now() + rpcProtocol.timeoutMs;
        do {
            const value = await this.channel.readResult();
            const result = wire.readRemoteResult(value);
            if (value.byteLength !== 20 || result.version !== rpcProtocol.version) {
                throw new Error("RPCの受付結果の形式が不正です");
            }
            if (result.op === op && result.sequence === sequence && result.nonce === this.nonce) {
                if (result.code !== rpcProtocol.ok) {
                    throw new Error(`ESP32がRPC操作を拒否しました (${result.code})`);
                }
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        } while (performance.now() < deadline);
        throw new Error("RPC操作の受付結果が届きません");
    }

    /** 全体CRCと順序を付けて公開定義を登録する。 */
    async configure(data: Uint8Array, signal: AbortSignal): Promise<void> {
        const begin = wire.encodeRemoteBeginBody({ total: data.length, crc: bytecodeCrc32(data) });
        signal.throwIfAborted();
        await this.send(rpcProtocol.begin, begin);
        await forWireChunks(data, 10, () => signal.throwIfAborted(), async (chunk, offset) => {
            await this.send(rpcProtocol.data, wire.encodeOffset16({ value: offset }, chunk));
        });
        signal.throwIfAborted();
        await this.send(rpcProtocol.commit);
    }

    /** キュー先頭を読む。同じ先頭はACKまで変わらず、障害・旧実行は拒否する。 */
    async read(): Promise<RpcRequest | undefined> {
        const value = await this.channel.readEvent();
        const event = wire.readRemoteEvent(value);
        if (value.byteLength !== 20 || event.version !== rpcProtocol.version || event.nonce !== this.nonce) {
            throw new Error("RPCの接続または実行世代が変わりました");
        }
        const kind = event.kind;
        if (kind === rpcProtocol.idle) {
            return undefined;
        }
        if (kind !== rpcProtocol.request) {
            throw new Error(`ESP32がRPC配送を停止しました (${event.error})`);
        }
        const id = event.id;
        const object = event.object;
        const method = event.method;
        const count = event.argc;
        if (!id || !object || !method || count > 1 || event.error) {
            throw new Error("RPC要求の形式が不正です");
        }
        return { id, object, method, arguments: count ? [event.value] : [] };
    }

    /** Workerの受付後にだけ先頭要求を取り除く。メソッド終了の通知ではない。 */
    acknowledge(id: number): Promise<void> {
        const data = wire.encodeWord32({ value: id });
        return this.send(rpcProtocol.ack, data);
    }

    /** 明示Stopで登録と要求を破棄する。 */
    end(): Promise<void> {
        return this.send(rpcProtocol.end);
    }
}
