/**
 * 独立したブラウザ／ESP32ソースをRPC公開定義で結ぶコンパイル用の入口。
 * parser.ts/syntax.tsは宣言、semantic.tsは各ソースの型、bytecode.tsは未実行成果物を担当する。
 * ブラウザの構文木・大域値・メソッド本体をESP32へ渡さず、公開署名だけから代理型を作る。
 * 第1段階は解析・生成まで。Workerでの受付・BLE/Wi-Fi配送・Future更新・2ソースのUIは未接続。
 */
import { AbstractSyntaxNode, App, CallStatement, RefVar } from "./syntax";
import { parsePython } from "./parser";
import { loadDeviceApi, resolvePython } from "./semantic";
import type { DeviceApi, DeviceCallable, DeviceClass, PythonAnalysis, PythonDiagnostic, PythonType } from "./semantic";
import { generateRemoteDraftBytecode } from "./bytecode";
import { createNumericKernelArtifact } from "./kernel-c";
import type { NumericKernelArtifact } from "./kernel-c";
import type { PythonDebugBuild } from "./debug-info";

/** コンパイル用登録情報の版。通信パケットの版・バイトコードの版とは独立する。 */
const remoteDefinitionVersion = 1;

/** 第1段階で解析・生成する型。数値配列の注釈・配送は第5段階で追加する。 */
export type RemoteValueType = "int" | "float" | "str" | "none";

/** 公開メソッドの署名。戻り値はブラウザの本体の型で、ESP32ではasyncだけFutureへ包む。 */
export interface RemoteMethod {
    /** 公開名の昇順に割り当てる、オブジェクト内の非0 ID。 */
    id: number;
    /** 公開メソッド名。self・コンストラクタ・非公開メソッドは含めない。 */
    name: string;
    /** 宣言順の明示引数。名前と型を指紋へ含める。 */
    parameters: { name: string; type: RemoteValueType }[];
    /** ブラウザのメソッドが返す値の型。 */
    result: RemoteValueType;
    /** trueならESP32の呼出し式はFutureを返す。内部のawaitは未対応。 */
    asynchronous: boolean;
}

/** 起動時に公開するRemoteインスタンス。型のID・スロット・本体ポインターは共有しない。 */
export interface RemoteObject {
    /** 公開名の昇順に割り当てる非0 ID。 */
    id: number;
    /** モジュール直下のインスタンス変数名。from remote importで参照する。 */
    name: string;
    /** ブラウザのクラス名。メソッド本体の照合に使う。 */
    className: string;
    /** 公開メソッドの定義一覧。 */
    methods: RemoteMethod[];
}

/** 両ソースを結び付ける公開定義。ソース全文や解析器の状態を含めない。 */
export interface RemoteRegistry {
    /** コンパイル用定義の版。 */
    version: number;
    /** 正規化した公開定義のSHA-256。 */
    fingerprint: string;
    /** 静的に公開するインスタンス。最初の実装は2ソース1組だけを扱う。 */
    objects: RemoteObject[];
}

/** ESP32のCALL_NATIVEとRPCの対象を結ぶ、未接続スタブの登録情報。 */
export interface RemoteNativeBinding {
    /** 基本機器APIの最大IDより後ろへ割り当てるID。既存nativeIdは変更しない。 */
    nativeId: number;
    /** RPCの公開オブジェクトID。 */
    objectId: number;
    /** 0は代理の取得、非0は公開メソッド。 */
    methodId: number;
}

/** 個別の構文木・解析結果と共通の公開定義。ブラウザに診断があればESP32解析は省く。 */
export interface RemoteProgramAnalysis {
    /** ブラウザ専用APIで解析した結果。 */
    browser: PythonAnalysis;
    /** 公開定義を外部APIとして解析したESP32の結果。 */
    esp32?: PythonAnalysis;
    /** ブラウザの解析成功後だけ生成する公開定義。 */
    registry?: RemoteRegistry;
    /** 機器APIと公開定義・スタブ配置を結び付けた指紋。 */
    apiHash?: string;
    /** 後続の実行接続が必要とするスタブ一覧。 */
    nativeBindings: RemoteNativeBinding[];
}

/** 実行へ渡せない第1段階の生成物。両コード・PC一覧・署名を同じ生成で保持する。 */
export interface RemoteProgramBuild {
    /** 通常のStartへ渡せないことを明示する固定値。 */
    executable: false;
    /** 対応する公開定義。 */
    registry: RemoteRegistry;
    /** 両イメージのAPI指紋。 */
    apiHash: string;
    /** ブラウザのコードと個別のデバッグ情報。 */
    browser: PythonDebugBuild;
    /** ESP32のコードと個別のデバッグ情報。 */
    esp32: PythonDebugBuild;
    /** ブラウザ用数値カーネルの生成物。Wasmコンパイル・実行は行わない。 */
    kernels: NumericKernelArtifact;
    /** まだ実装していないRPCスタブの配置。 */
    nativeBindings: readonly RemoteNativeBinding[];
}

/** 確定した順序のJSONから小文字16進SHA-256を求める。 */
async function fingerprint(value: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** ID・順序・署名を決定的な配列へ正規化する。時刻・元位置・VM側の型IDは含めない。 */
function registryDefinition(registry: RemoteRegistry): unknown {
    return [registry.version, registry.objects.map(object => [object.id, object.name, object.className,
        object.methods.map(method => [method.id, method.name, method.asynchronous, method.result,
            method.parameters.map(parameter => [parameter.name, parameter.type])])])];
}

/** ソース上の問題を既存の意味診断と同じ形式で記録する。 */
function report(diagnostics: PythonDiagnostic[], node: AbstractSyntaxNode, message: string): void {
    diagnostics.push({ node, charPos: node.charPos, message });
}

/** 公開境界へ渡せる第1段階のスカラー型へ変換する。不正な型は診断後にNoneへ回復する。 */
function publicType(type: PythonType | undefined, node: AbstractSyntaxNode, diagnostics: PythonDiagnostic[]): RemoteValueType {
    if (type?.kind === "int" || type?.kind === "float" || type?.kind === "str" || type?.kind === "none") {
        return type.kind;
    }
    report(diagnostics, node, "RPCの公開型は現在int・float・str・Noneだけに対応しています。数値配列は後続段階です");
    return "none";
}

/**
 * ブラウザ解析から公開定義を抽出する。公開はモジュール直下のname = RemoteClass()だけ。
 * 公開メソッドは先頭が_以外で、self以外の全引数と戻り値へ注釈を必須にする。
 * 通常defはNoneだけ、async defはスカラーまたはNoneを返す。属性の直接公開は行わない。
 * 同じ公開名への再代入と動的なRemote生成は拒否する。クラスの__init__やprivate補助はローカルに留める。
 */
function collectRegistry(analysis: PythonAnalysis, diagnostics: PythonDiagnostic[]): RemoteRegistry {
    const owners = analysis.api.classes.filter(owner => owner.userClass?.remote);
    const constructors = new Set<App>();
    const objects: RemoteObject[] = [];
    for (const statement of analysis.module.block.statements) {
        if (!(statement instanceof CallStatement) || !(statement.app instanceof App) || statement.app.fncName !== "=") {
            continue;
        }
        const [target, value] = statement.app.args;
        const owner = owners.find(item => value instanceof App && value.fncName === item.name);
        if (!(target instanceof RefVar) || !(value instanceof App) || owner === undefined) {
            continue;
        }
        constructors.add(value);
        if (objects.some(object => object.name === target.name)) {
            report(diagnostics, target, "公開Remoteオブジェクトは一度だけ生成してください");
        }
        if (value.args.length !== 0 || (owner.userMethods?.get("__init__")?.parameters.length ?? 1) > 1) {
            report(diagnostics, value, "Remoteの公開インスタンスは引数なしのコンストラクタで生成してください");
        }
        const methods: RemoteMethod[] = [];
        const functions = [...owner.userMethods!.values()].filter(fn => !fn.node.name.startsWith("_"));
        functions.sort((left, right) => left.node.name < right.node.name ? -1 : left.node.name > right.node.name ? 1 : 0);
        for (const fn of functions) {
            const node = fn.node;
            const parameters = node.args.slice(1).map((parameter, index) => {
                if (parameter.annotation === undefined) {
                    report(diagnostics, parameter, "Remoteの公開引数には型注釈が必要です");
                }
                return { name: parameter.name, type: publicType(fn.parameters[index + 1]?.type, parameter, diagnostics) };
            });
            if (node.returnAnnotation === undefined) {
                report(diagnostics, node, "Remoteの公開メソッドには戻り値の型注釈が必要です");
            }
            const result = publicType(fn.type, node, diagnostics);
            if (!node.asynchronous && result !== "none") {
                report(diagnostics, node, "値を返すRemoteメソッドはasync defで宣言してください");
            }
            methods.push({ id: methods.length + 1, name: node.name, parameters, result, asynchronous: node.asynchronous });
        }
        objects.push({ id: 0, name: target.name, className: owner.name, methods });
    }
    objects.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const [index, object] of objects.entries()) {
        object.id = index + 1;
    }
    const nodes: AbstractSyntaxNode[] = [];
    analysis.module.getAll(nodes);
    for (const node of nodes) {
        if (node instanceof App && owners.some(owner => node.fncName === owner.name) && !constructors.has(node)) {
            report(diagnostics, node, "Remoteの生成はモジュール直下の公開変数への代入だけに対応しています");
        }
        if (node instanceof App && node.isAssignmentApp() && node.args[0] instanceof RefVar) {
            const target = node.args[0];
            const binding = analysis.references.get(target);
            if (objects.some(object => object.name === target.name) && binding?.kind === "variable"
                && binding.variable.scope === "global" && !constructors.has(node.args[1] as App)) {
                report(diagnostics, target, "公開Remoteオブジェクトは再代入できません");
            }
        }
    }
    if (objects.length === 0) {
        report(diagnostics, analysis.module, "ブラウザソースのモジュール直下にRemoteインスタンスを生成してください");
    }
    return { version: remoteDefinitionVersion, fingerprint: "", objects };
}

/**
 * 公開定義だけから代理クラスと読取専用Futureのrecord型を作る。
 * done/errorはint、error=0が成功。valueの実行時検査と完了更新は第4段階で接続する。
 * 機器APIの既存IDを維持し、追加nativeId・型IDは昇順に後置する。Futureは戻り値型ごとに共用する。
 */
function proxyApi(base: DeviceApi, registry: RemoteRegistry): {
    api: DeviceApi; objects: Map<string, DeviceClass>; bindings: RemoteNativeBinding[];
} {
    const api: DeviceApi = { ...base, classes: [...base.classes] };
    const objects = new Map<string, DeviceClass>();
    const bindings: RemoteNativeBinding[] = [];
    const futures = new Map<RemoteValueType, PythonType>();
    const existingIds = [...base.functions, ...base.classes.flatMap(owner => [
        ...(owner.constructor === null ? [] : [owner.constructor]), ...owner.methods])].map(item => item.nativeId);
    let nativeId = Math.max(0, ...existingIds);
    let classId = Math.max(0, ...base.classes.map(owner => owner.id));
    const addClass = (name: string, kind: "record" | "device"): DeviceClass => {
        const owner: DeviceClass = { id: ++classId, name, kind, constructor: null, methods: [], fields: [] };
        api.classes.push(owner);
        return owner;
    };
    for (const object of registry.objects) {
        const owner = addClass(`$remote.${object.name}`, "device");
        const type: PythonType = { kind: "object", classId: owner.id };
        owner.constructor = { id: 0, name: "__init__", nativeId: ++nativeId, parameters: [],
            returnType: { kind: "none" }, resultType: type };
        bindings.push({ nativeId, objectId: object.id, methodId: 0 });
        for (const method of object.methods) {
            let result: PythonType = { kind: method.result };
            if (method.asynchronous) {
                let future = futures.get(method.result);
                if (future === undefined) {
                    const record = addClass(`$future.${method.result}`, "record");
                    record.future = result;
                    record.fields = [{ id: 1, name: "done", type: { kind: "int" }, readable: true, writable: false },
                        { id: 2, name: "error", type: { kind: "int" }, readable: true, writable: false },
                        { id: 3, name: "value", type: result, readable: true, writable: false }];
                    future = { kind: "object", classId: record.id };
                    futures.set(method.result, future);
                }
                result = future;
            }
            const definition: DeviceCallable = { id: method.id, name: method.name, nativeId: ++nativeId,
                parameters: method.parameters.map(parameter => ({ name: parameter.name, type: { kind: parameter.type } })),
                returnType: result };
            owner.methods.push(definition);
            bindings.push({ nativeId, objectId: object.id, methodId: method.id });
        }
        objects.set(object.name, owner);
    }
    if (nativeId > 65535 || classId > 65535) {
        throw new Error("RPCのnativeIdまたは型IDがuint16の上限を超えています");
    }
    return { api, objects, bindings };
}

/**
 * 2ソースをそれぞれparsePython→resolvePythonへ渡す。API読込みは共有するが解析状態は共有しない。
 * ブラウザ側の診断がなければ公開定義を作り、ESP32のfrom remote importと型検査へ接続する。
 * expectedFingerprintを指定した場合は以前の公開定義との不一致をESP32解析前に拒否する。
 * UIの2ソース選択・開始順序・RPCの実行はまだ接続しない。意味エラーは各ソースのdiagnosticsへ返す。
 */
export async function analyzeRemoteSources(browserSource: string, esp32Source: string, signal?: AbortSignal,
    expectedFingerprint?: string): Promise<RemoteProgramAnalysis> {
    const api = await loadDeviceApi(signal);
    const browserModule = parsePython(browserSource);
    let browser = resolvePython(browserModule, api, { target: "browser", remote: { objects: new Map() } });
    const result: RemoteProgramAnalysis = { browser, nativeBindings: [] };
    if (browser.diagnostics.length !== 0) {
        return result;
    }
    const diagnostics: PythonDiagnostic[] = [];
    const registry = collectRegistry(browser, diagnostics);
    if (diagnostics.length !== 0) {
        diagnostics.sort((left, right) => left.charPos - right.charPos);
        // semantic.tsと同じく、診断付き結果の配置を後続の生成器へ渡さない。
        for (const variables of [browser.globals, ...[...browser.functions.values()].map(fn => fn.variables)]) {
            for (const variable of variables.values()) {
                variable.slot = -1;
            }
        }
        result.browser = { ...browser, diagnostics };
        return result;
    }
    registry.fingerprint = await fingerprint(registryDefinition(registry));
    signal?.throwIfAborted();
    if (expectedFingerprint !== undefined && expectedFingerprint !== registry.fingerprint) {
        throw new Error("RPCの公開定義が変更されています。ESP32側を新しい定義で再解析してください");
    }
    const proxies = proxyApi(api, registry);
    const apiHash = await fingerprint([remoteDefinitionVersion, api.abiHash, registry.fingerprint, proxies.bindings]);
    signal?.throwIfAborted();
    browser = { ...browser, api: { ...browser.api, abiHash: apiHash } };
    const esp32Module = parsePython(esp32Source);
    result.browser = browser;
    result.esp32 = resolvePython(esp32Module, { ...proxies.api, abiHash: apiHash },
        { target: "esp32", remote: { objects: proxies.objects } });
    result.registry = registry;
    result.apiHash = apiHash;
    result.nativeBindings = proxies.bindings;
    return result;
}

/**
 * 対応する2解析から、未実行のバイトコード・各PC情報・登録情報を生成する。
 * 呼出し例：const analysis = await analyzeRemoteSources(browserSource, esp32Source);
 * const build = await createRemoteProgramBuild(analysis); 生成物は確認用で、Startや転送には使わない。
 * 既存version 7/8とAPI指紋を使い、命令・通信形式は変更しない。両イメージの内容と指紋を確認する。
 */
export async function createRemoteProgramBuild(analysis: RemoteProgramAnalysis, signal?: AbortSignal): Promise<RemoteProgramBuild> {
    signal?.throwIfAborted();
    const { browser, esp32, registry, apiHash } = analysis;
    if (registry === undefined || esp32 === undefined || apiHash === undefined
        || browser.diagnostics.length !== 0 || esp32.diagnostics.length !== 0) {
        throw new Error("診断のないブラウザ／ESP32のRPC解析結果が必要です");
    }
    if (registry.fingerprint !== await fingerprint(registryDefinition(registry))
        || browser.api.abiHash !== apiHash || esp32.api.abiHash !== apiHash) {
        throw new Error("RPCの公開定義と両ソースの解析結果が一致しません");
    }
    const kernels = await createNumericKernelArtifact(browser, signal);
    return { executable: false, registry, apiHash, kernels,
        browser: generateRemoteDraftBytecode(browser, kernels.manifest),
        esp32: generateRemoteDraftBytecode(esp32), nativeBindings: analysis.nativeBindings };
}
