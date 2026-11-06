/**
 * Python構文解析後の名前解決・型推論。
 *
 * analyzePython(module, signal?)は/diagram/device/device-api.jsonを毎回読み直し、
 * resolvePython(module, api)で解析する。parsePython()は同期の構文解析APIとして維持する。
 * ソースの意味エラーでは例外を投げず、PythonAnalysis.diagnosticsへ位置・メッセージ・
 * 対応ノードを蓄積し、独立した引数・式・後続文の解析を続ける。構文解析の例外は従来どおり。
 * undefinedは推論途中、kind=errorは既知の問題に依存する値として区別する。
 * errorを式・束縛・戻り値へ伝播し、その影響による未定型・型不一致の連鎖報告を抑える。
 * 同じノード・メッセージは反復をまたいで重複させず、診断はcharPos順に返す。
 * 衝突・配置違反の関数定義は登録せず、その本体は解析対象から外す。
 * 診断がある結果は部分的な解決情報を含み、slot=-1で返す。bytecode.tsは両生成入口で
 * 診断を検査し、1件以上なら生成前に拒否する。python-block.tsとble-wifi/device-connection.tsは
 * この境界を通して送信を止める。parser.tsの開発用入口は診断を記録して生成を省く。
 * 診断の画面表示はpython-block.tsとhighlight-editor.tsが担当する。ここではDOMを操作しない。
 * API読込み・不正JSON・取消の例外は維持する。
 * JSONの形式はdiagram/python/generate-device-api.pyの先頭コメントを参照する。
 * 形式の版、IDの重複、型参照、コンストラクター、表示APIの型制限を検証する。
 * abiHashは解析結果へ保持するが、ここでは指紋の再計算やVMとの照合は行わない。
 *
 * 全APIクラス・関数をimportなしで利用できる。API名・ユーザー関数名への再代入、
 * 仮引数による隠蔽は拒否する。関数定義は既存生成器と同じくモジュール先頭にまとめる。
 * 代入先を先に収集し、関数では仮引数・局所変数、次に大域変数の順で名前を解決する。
 * if/whileは変数スコープを作らず、属性名や演算子を変数として登録しない。
 * global-scope.tsで関数全体のglobal宣言と宣言順を先に確認する。global名への代入・複合代入は
 * this.globalsへ束縛し、同じ名前の局所領域を作らない。宣言だけでは大域値を初期化しない。
 * 型推論は全関数で同じ大域変数を共有し、代入前の実行時LOADは既存VMの未初期化検査を使う。
 * 引数との衝突・宣言前の使用は意味診断に蓄積する。詳細な共通契約はglobal-scope.tsを参照。
 *
 * 数値・None・APIオブジェクトの型を反復して推論する。ユーザー関数は呼出し箇所全体で
 * 単一の引数型・戻り値型を持ち、再帰・相互再帰も収束するまで反復する。変数も単一型で、
 * int/floatの混在はfloatへ統合する。異なるクラス、Noneと数値等の混在は拒否する。
 * そのため再代入前後で型が変わるPython全般への対応ではなく、保守的な静的解析である。
 * 未使用関数の仮引数を含め、最終的に型が決まらない値はエラー。未初期化・到達可能性の
 * 証明は行わず、既存VMの未初期化値検査も必要になる。
 *
 * API引数・フィールド代入ではintからfloatだけを暗黙変換可能とする。recordは公開
 * フィールドを読み書きでき、deviceはメソッド呼出しだけを許す。メソッドの値としての
 * 取得、関数・クラスの別名代入、動的呼出しは未対応。未宣言のコンストラクターは作らない。
 * schemaVersion/callingConventionVersion=2のrecordは値コピーとし、入れ子を宣言順に
 * 平坦化する。Vec3は3、IMUValueは6スロット。device・数値・None・内部文字列は1。
 * 型推論後に変数のslotを幅込みで再配置する。関数内のslotはBPの管理領域2個を含む。
 * valueSlotTypes()が配置の共通処理で、bytecode.tsも使用する。空・循環recordは拒否する。
 * CALL_NATIVE用のnativeIdは全コンストラクター・メソッド・関数に共通の単一ID。
 * 通常文字列・f文字列はJSONでstrと宣言された表示API引数だけに許す。f文字列の断片・
 * 書式のStrは内部データとして扱い、置換式は数値だけにする。整形・文字列生成は行わない。
 * 四則、//・%、ビット演算、比較、論理演算、if/while、関数、属性代入に対応する。
 * 累乗、for、コンテナ・添字、import、入れ子の関数・f文字列は明示的に拒否する。
 * 解析で受理する演算・APIをすべてバイトコード化できることは意味しない。
 *
 * 結果のreferencesは実際の名前参照から束縛への対応、typesは式の型、calls/fieldsは
 * 呼出し・属性式からAPI定義（IDを含む）への対応。globals/functionsで変数と関数型を
 * 参照できる。diagnosticsが空の場合だけ全変数型・戻り値型とスロット配置が確定している。
 * 元の構文木、parent、charPos、toString()のキャッシュは変更しない。
 * parser.tsの開発用入口とble-wifi/device-connection.tsの送信前処理が構文解析後に呼び出す。
 * アセンブリ・version=3のバイトコード生成はbytecode.tsがこの結果を利用する。
 * 新形式のBLE転送・受信形式検証はble-wifi側、値コピーと呼出しの実行はESP32の
 * bytecode_vm.cppが担当する。生成スタブはdevice_api.generated.cppからdevice_native.cppを呼ぶ。
 */
import {
    AbstractSyntaxNode, App, BlockStatement, CallStatement, ConstNum, Fn,
    GlobalStatement, IfStatement, Module, RefVar, ReturnStatement, Statement, Str, Term,
    WhileStatement, isAssignmentToken
} from "./syntax.js";
import { collectScopeGlobals } from "./global-scope";

/** errorは意味解析の回復用で、機器APIのJSON・バイトコードには出力しない。 */
export type PythonType = { kind: "int" | "float" | "str" | "none" | "error" }
    | { kind: "object"; classId: number };

export interface DeviceCallable {
    id: number;
    nativeId: number;
    name: string;
    parameters: { name: string; type: PythonType }[];
    returnType: PythonType;
    resultType?: PythonType;
}

export interface DeviceField {
    id: number;
    name: string;
    type: PythonType;
    readable: boolean;
    writable: boolean;
}

export interface DeviceClass {
    id: number;
    name: string;
    kind: "record" | "device";
    constructor: DeviceCallable | null;
    methods: DeviceCallable[];
    fields: DeviceField[];
}

export interface DeviceApi {
    schemaVersion: number;
    callingConventionVersion: number;
    stringPolicyVersion: number;
    abiHash: string;
    classes: DeviceClass[];
    functions: DeviceCallable[];
}

/** undefinedは推論未定、errorは既知の問題に依存する値。slotは診断0件の場合だけ確定する。 */
export interface PythonVariable {
    name: string;
    scope: "global" | "local";
    slot: number;
    declaration: AbstractSyntaxNode;
    type: PythonType | undefined;
}

export interface PythonFunction {
    node: Fn;
    parameters: PythonVariable[];
    variables: Map<string, PythonVariable>;
    /** 関数全体に適用するglobal宣言。これらの変数はglobalsにだけ格納する。 */
    globalNames: ReadonlySet<string>;
    type: PythonType | undefined;
}

export type PythonBinding = { kind: "variable"; variable: PythonVariable }
    | { kind: "class"; definition: DeviceClass }
    | { kind: "native"; definition: DeviceCallable }
    | { kind: "function"; definition: PythonFunction }
    | { kind: "constant"; name: string; type: PythonType }
    | { kind: "error" };

export type PythonCall = { kind: "constructor" | "method"; owner: DeviceClass; definition: DeviceCallable }
    | { kind: "native"; definition: DeviceCallable }
    | { kind: "function"; definition: PythonFunction };

/** ソース中の意味エラー。charPosは元ソースのUTF-16位置で、nodeは問題に対応する構文木。 */
export interface PythonDiagnostic {
    charPos: number;
    message: string;
    node: AbstractSyntaxNode;
}

export interface PythonAnalysis {
    /** 同じノード・メッセージの重複を除き、ソース位置順で返す。1件以上ならコード生成禁止。 */
    diagnostics: readonly PythonDiagnostic[];
    module: Module;
    api: DeviceApi;
    globals: ReadonlyMap<string, PythonVariable>;
    functions: ReadonlyMap<string, PythonFunction>;
    references: ReadonlyMap<RefVar, PythonBinding>;
    types: ReadonlyMap<Term, PythonType>;
    calls: ReadonlyMap<App, PythonCall>;
    fields: ReadonlyMap<App, { owner: DeviceClass; definition: DeviceField }>;
}

/** 未検証のJSONを型アサーションだけで使わず、異常箇所をJSONパスで報告する。 */
function invalidApi(path: string): never {
    throw new Error(`device-api.jsonの形式が不正です: ${path}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        invalidApi(path);
    }
    return value as Record<string, unknown>;
}

function list(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value) || value.length > 65535) {
        invalidApi(path);
    }
    return value;
}

function name(value: unknown, path: string): string {
    if (typeof value !== "string" || value.length === 0) {
        invalidApi(path);
    }
    return value;
}

function id(value: unknown, path: string, minimum = 1): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > 65535) {
        invalidApi(path);
    }
    return value;
}

function readType(value: unknown, path: string): PythonType {
    const data = record(value, path);
    if (data.kind === "object") {
        return { kind: "object", classId: id(data.classId, `${path}.classId`) };
    }
    if (data.kind !== "int" && data.kind !== "float" && data.kind !== "str" && data.kind !== "none") {
        invalidApi(path);
    }
    return { kind: data.kind };
}

function unique<T extends { id: number; name: string }>(items: T[], path: string): T[] {
    if (new Set(items.map(item => item.id)).size !== items.length
        || new Set(items.map(item => item.name)).size !== items.length) {
        invalidApi(`${path}（IDまたは名前の重複）`);
    }
    return items;
}

function readCallable(value: unknown, path: string, constructor = false): DeviceCallable {
    const data = record(value, path);
    const parameters = list(data.parameters, `${path}.parameters`).map((value, index) => {
        const parameter = record(value, `${path}.parameters[${index}]`);
        return { name: name(parameter.name, path), type: readType(parameter.type, path) };
    });
    if (new Set(parameters.map(parameter => parameter.name)).size !== parameters.length
        || parameters.some(parameter => parameter.type.kind === "none")) {
        invalidApi(`${path}.parameters`);
    }
    const result: DeviceCallable = {
        id: id(data.id, `${path}.id`, constructor ? 0 : 1),
        nativeId: id(data.nativeId, `${path}.nativeId`),
        name: name(data.name, `${path}.name`),
        parameters,
        returnType: readType(data.returnType, `${path}.returnType`)
    };
    if (constructor) {
        result.resultType = readType(data.resultType, `${path}.resultType`);
        if (result.id !== 0 || result.name !== "__init__" || result.returnType.kind !== "none") {
            invalidApi(path);
        }
    }
    return result;
}

/** 型参照と公開権限も検査し、名前解決で使うJSONのモデルを作る。 */
export function readDeviceApi(value: unknown): DeviceApi {
    const data = record(value, "$");
    if (data.schemaVersion !== 2 || data.callingConventionVersion !== 2 || data.stringPolicyVersion !== 1
        || typeof data.abiHash !== "string" || !/^[0-9a-f]{64}$/.test(data.abiHash)) {
        invalidApi("version/abiHash");
    }
    const classes = unique(list(data.classes, "classes").map((value, index): DeviceClass => {
        const path = `classes[${index}]`;
        const item = record(value, path);
        if (item.kind !== "record" && item.kind !== "device") {
            invalidApi(`${path}.kind`);
        }
        const fields = unique(list(item.fields, `${path}.fields`).map((value): DeviceField => {
            const field = record(value, `${path}.fields`);
            if (typeof field.readable !== "boolean" || typeof field.writable !== "boolean") {
                invalidApi(`${path}.fields`);
            }
            return { id: id(field.id, path), name: name(field.name, path),
                type: readType(field.type, path), readable: field.readable, writable: field.writable };
        }), `${path}.fields`);
        const methods = unique(list(item.methods, `${path}.methods`)
            .map(value => readCallable(value, `${path}.methods`)), `${path}.methods`);
        const constructor = item.constructor === null ? null : readCallable(item.constructor, `${path}.constructor`, true);
        if (item.kind === "device" && fields.length > 0
            || new Set([...fields, ...methods, ...(constructor === null ? [] : [constructor])]
                .map(member => member.name)).size !== fields.length + methods.length + (constructor === null ? 0 : 1)) {
            invalidApi(path);
        }
        return { id: id(item.id, path), name: name(item.name, path), kind: item.kind, constructor, methods, fields };
    }), "classes");
    const functions = unique(list(data.functions, "functions").map(value => readCallable(value, "functions")), "functions");
    if (new Set([...classes, ...functions].map(item => item.name)).size !== classes.length + functions.length) {
        invalidApi("classes/functions（名前の重複）");
    }
    const classIds = new Set(classes.map(item => item.id));
    const nativeIds = new Set<number>();
    const checkType = (type: PythonType): void => {
        if (type.kind === "object" && !classIds.has(type.classId)) {
            invalidApi(`classId=${type.classId}`);
        }
    };
    const checkCallable = (callable: DeviceCallable, qualifiedName: string): void => {
        if (nativeIds.has(callable.nativeId)) {
            invalidApi(`${qualifiedName}.nativeId（重複）`);
        }
        nativeIds.add(callable.nativeId);
        checkType(callable.returnType);
        if (callable.returnType.kind === "str") {
            invalidApi(`${qualifiedName}.returnType`);
        }
        for (const parameter of callable.parameters) {
            checkType(parameter.type);
            if (parameter.type.kind === "str" && !["print", "Display.print"].includes(qualifiedName)) {
                invalidApi(`${qualifiedName}.${parameter.name}`);
            }
        }
        if (["print", "Display.print"].includes(qualifiedName)
            && (callable.parameters.length !== 1 || callable.parameters[0].name !== "text"
                || callable.parameters[0].type.kind !== "str" || callable.returnType.kind !== "none")) {
            invalidApi(qualifiedName);
        }
    };
    for (const owner of classes) {
        if (owner.constructor !== null) {
            const result = owner.constructor.resultType;
            if (result?.kind !== "object" || result.classId !== owner.id) {
                invalidApi(`${owner.name}.constructor.resultType`);
            }
            checkCallable(owner.constructor, `${owner.name}.__init__`);
        }
        for (const method of owner.methods) {
            if (method.name === "__init__") {
                invalidApi(`${owner.name}.methods（__init__はconstructorへ置いてください）`);
            }
            checkCallable(method, `${owner.name}.${method.name}`);
        }
        for (const field of owner.fields) {
            checkType(field.type);
            if (field.type.kind === "str" || field.type.kind === "none") {
                invalidApi(`${owner.name}.${field.name}`);
            }
        }
    }
    for (const fn of functions) {
        checkCallable(fn, fn.name);
    }
    const api = { schemaVersion: 2, callingConventionVersion: 2, stringPolicyVersion: 1,
        abiHash: data.abiHash, classes, functions };
    for (const owner of classes) {
        valueSlotTypes({ kind: "object", classId: owner.id }, api);
    }
    return api;
}

/** recordを末端フィールドの型列へ展開する。ID順ではなくJSONの宣言順で配置する。 */
export function valueSlotTypes(type: PythonType, api: DeviceApi, ancestors: readonly number[] = []): PythonType[] {
    if (type.kind === "error") {
        throw new Error("意味エラーを含む型はスロットへ配置できません");
    }
    if (type.kind !== "object") {
        return [type];
    }
    const owner = api.classes.find(item => item.id === type.classId);
    if (owner === undefined || ancestors.includes(type.classId)) {
        invalidApi(`classId=${type.classId}（未知または循環するrecord）`);
    }
    if (owner.kind === "device") {
        return [type];
    }
    if (owner.fields.length === 0) {
        invalidApi(`${owner.name}（空のrecord）`);
    }
    const result: PythonType[] = [];
    for (const field of owner.fields) {
        const fields = valueSlotTypes(field.type, api, [...ancestors, owner.id]);
        if (result.length + fields.length > 65535) {
            invalidApi(`${owner.name}（スロット数の上限超過）`);
        }
        result.push(...fields);
    }
    return result;
}

/** HTTP失敗・不正JSONは伝播し、失敗した結果をキャッシュしない。 */
export async function loadDeviceApi(signal?: AbortSignal): Promise<DeviceApi> {
    const response = await fetch("/diagram/device/device-api.json", { signal, cache: "no-store" });
    if (!response.ok) {
        throw new Error(`device-api.jsonを読み込めません: HTTP ${response.status}`);
    }
    const api = readDeviceApi(await response.json());
    signal?.throwIfAborted();
    return api;
}

const intType: PythonType = { kind: "int" };
const floatType: PythonType = { kind: "float" };
const noneType: PythonType = { kind: "none" };
const strType: PythonType = { kind: "str" };
const errorType: PythonType = { kind: "error" };

function sameType(left: PythonType, right: PythonType): boolean {
    return left.kind === right.kind && (left.kind !== "object" || right.kind === "object" && left.classId === right.classId);
}

function numeric(type: PythonType): boolean {
    return type.kind === "int" || type.kind === "float";
}

/** 同じASTを反復して解析するが、結果はすべて外部の表へ格納する。 */
class PythonResolver {
    private readonly globals = new Map<string, PythonVariable>();
    private readonly functions = new Map<string, PythonFunction>();
    private readonly references = new Map<RefVar, PythonBinding>();
    private readonly types = new Map<Term, PythonType>();
    private readonly calls = new Map<App, PythonCall>();
    private readonly fields = new Map<App, { owner: DeviceClass; definition: DeviceField }>();
    private readonly diagnostics: PythonDiagnostic[] = [];
    private readonly reported = new Map<AbstractSyntaxNode, Set<string>>();
    private readonly invalidDeclarations = new Set<AbstractSyntaxNode>();
    private readonly invalidCalls = new Set<PythonFunction>();
    private readonly validCalls = new Set<PythonFunction>();
    private readonly classes: Map<string, DeviceClass>;
    private readonly nativeFunctions: Map<string, DeviceCallable>;
    private scope: PythonFunction | undefined;
    private changed = false;
    private checking = false;

    constructor(private readonly module: Module, private readonly api: DeviceApi) {
        this.classes = new Map(api.classes.map(item => [item.name, item]));
        this.nativeFunctions = new Map(api.functions.map(item => [item.name, item]));
    }

    /** 解析を中断せず記録する。反復中の同じ問題を重複登録しない。 */
    private fail(node: AbstractSyntaxNode, message: string): PythonType {
        let messages = this.reported.get(node);
        if (messages === undefined) {
            messages = new Set();
            this.reported.set(node, messages);
        }
        if (!messages.has(message)) {
            messages.add(message);
            this.diagnostics.push({ node, charPos: node.charPos, message });
        }
        return errorType;
    }

    private typeName(type: PythonType): string {
        return type.kind === "object" ? this.api.classes.find(item => item.id === type.classId)!.name : type.kind;
    }

    /** errorを伝播し、その値に依存する式では原因と同じ型エラーを追加しない。 */
    private merge(left: PythonType | undefined, right: PythonType | undefined, node: AbstractSyntaxNode): PythonType | undefined {
        if (left?.kind === "error" || right?.kind === "error") {
            return errorType;
        }
        if (left === undefined || right === undefined) {
            return left ?? right;
        }
        if (sameType(left, right)) {
            return left;
        }
        if (numeric(left) && numeric(right)) {
            return floatType;
        }
        return this.fail(node, `型を統合できません: ${this.typeName(left)} / ${this.typeName(right)}`);
    }

    private update(target: { type: PythonType | undefined }, type: PythonType | undefined, node: AbstractSyntaxNode): void {
        const merged = this.merge(target.type, type, node);
        if (merged !== undefined && (target.type === undefined || !sameType(target.type, merged))) {
            target.type = merged;
            this.changed = true;
        }
    }

    private remember(term: Term, type: PythonType | undefined): PythonType | undefined {
        const previous = this.types.get(term);
        const merged = this.merge(previous, type, term);
        if (merged !== undefined && (previous === undefined || !sameType(previous, merged))) {
            this.types.set(term, merged);
            this.changed = true;
        }
        return merged;
    }

    private reserved(name: string): boolean {
        return ["True", "False", "None"].includes(name) || this.classes.has(name) || this.nativeFunctions.has(name);
    }

    /** 不正な宣言は既存のAPI・関数を隠さず、右辺や他の文の解析を続ける。 */
    private addVariable(name: string, declaration: AbstractSyntaxNode, scope?: PythonFunction): PythonVariable | undefined {
        if (this.reserved(name) || this.functions.has(name)) {
            this.fail(declaration, `API・関数・定数の名前には束縛できません: ${name}`);
            this.invalidDeclarations.add(declaration);
            return undefined;
        }
        const variables = scope?.variables ?? this.globals;
        let variable = variables.get(name);
        if (variable === undefined) {
            variable = { name, scope: scope === undefined ? "global" : "local",
                slot: -1, declaration, type: undefined };
            variables.set(name, variable);
        }
        return variable;
    }

    /** ブロックをまたぐ代入を収集し、属性の左辺を新しい変数と誤認しない。 */
    private collect(block: BlockStatement, scope?: PythonFunction): void {
        for (const statement of block.statements) {
            if (statement instanceof Fn) {
                if (!this.invalidDeclarations.has(statement)
                    && (scope !== undefined || this.functions.get(statement.name)?.node !== statement)) {
                    this.fail(statement, "関数定義はモジュール先頭だけに置けます");
                    this.invalidDeclarations.add(statement);
                }
            }
            else if (statement instanceof CallStatement && statement.app instanceof App && statement.app.isAssignmentApp()) {
                const target = statement.app.args[0];
                if (target instanceof RefVar) {
                    this.addVariable(target.name, target, scope?.globalNames.has(target.name) ? undefined : scope);
                }
            }
            else if (statement instanceof IfStatement) {
                this.collect(statement.ifBlock, scope);
                if (statement.elseIf !== undefined) {
                    this.collect(new BlockStatement([statement.elseIf]), scope);
                }
                if (statement.elseBlock !== undefined) {
                    this.collect(statement.elseBlock, scope);
                }
            }
            else if (statement instanceof WhileStatement) {
                this.collect(statement.block, scope);
            }
        }
    }

    private binding(ref: RefVar): PythonBinding {
        let result: PythonBinding;
        const variable = this.scope?.globalNames.has(ref.name) ? this.globals.get(ref.name)
            : this.scope?.variables.get(ref.name) ?? this.globals.get(ref.name);
        const owner = this.classes.get(ref.name);
        const native = this.nativeFunctions.get(ref.name);
        const fn = this.functions.get(ref.name);
        if (variable !== undefined) {
            result = { kind: "variable", variable };
        }
        else if (owner !== undefined) {
            result = { kind: "class", definition: owner };
        }
        else if (native !== undefined) {
            result = { kind: "native", definition: native };
        }
        else if (fn !== undefined) {
            result = { kind: "function", definition: fn };
        }
        else if (["True", "False", "None"].includes(ref.name)) {
            result = { kind: "constant", name: ref.name, type: ref.name === "None" ? noneType : intType };
        }
        else {
            this.fail(ref, `未定義の名前です: ${ref.name}`);
            result = { kind: "error" };
        }
        this.references.set(ref, result);
        return result;
    }

    private requireNumeric(type: PythonType | undefined, term: Term, integer = false): boolean {
        if (type?.kind === "error") {
            return false;
        }
        if (type !== undefined && (!numeric(type) || integer && type.kind !== "int")) {
            this.fail(term, `${integer ? "int" : "数値"}が必要です: ${this.typeName(type)}`);
            return false;
        }
        return true;
    }

    private compatible(actual: PythonType | undefined, expected: PythonType, node: AbstractSyntaxNode): boolean {
        if (actual?.kind === "error" || expected.kind === "error") {
            return false;
        }
        if (this.checking && actual !== undefined && !sameType(actual, expected)
            && !(actual.kind === "int" && expected.kind === "float")) {
            this.fail(node, `${this.typeName(expected)}が必要です: ${this.typeName(actual)}`);
            return false;
        }
        return true;
    }

    private owner(term: Term): DeviceClass | undefined {
        const type = this.expression(term);
        if (type === undefined || type.kind === "error") {
            return undefined;
        }
        if (type.kind !== "object") {
            this.remember(term, this.fail(term, `属性の対象はAPIオブジェクトにしてください: ${this.typeName(type)}`));
            return undefined;
        }
        return this.api.classes.find(item => item.id === type.classId);
    }

    private field(app: App, write = false): DeviceField | undefined {
        const owner = this.owner(app.args[0]);
        const member = app.args[1];
        if (!(member instanceof RefVar)) {
            this.remember(app, this.fail(app, "属性名が不正です"));
            return undefined;
        }
        if (owner === undefined) {
            if (this.types.get(app.args[0])?.kind === "error") {
                this.remember(app, errorType);
            }
            return undefined;
        }
        const definition = owner.fields.find(item => item.name === member.name);
        if (owner.kind !== "record" || definition === undefined || !(write ? definition.writable : definition.readable)) {
            this.remember(app, this.fail(member, `${owner.name}.${member.name}は${write ? "代入" : "参照"}できるフィールドではありません`));
            return undefined;
        }
        this.fields.set(app, { owner, definition });
        this.remember(app, definition.type);
        return definition;
    }

    /** 個数不一致でも実在する引数を全件解析し、余分な引数の未定義名も検出する。 */
    private nativeArguments(app: App, args: Term[], callable: DeviceCallable): boolean {
        let valid = args.length === callable.parameters.length;
        if (!valid) {
            this.fail(app, `${callable.name}の引数は${callable.parameters.length}個必要です`);
        }
        for (const [index, argument] of args.entries()) {
            const expected = callable.parameters[index]?.type;
            const actual = this.expression(argument, expected === undefined || expected.kind === "str");
            if (actual?.kind === "error" || expected !== undefined && !this.compatible(actual, expected, argument)) {
                valid = false;
            }
        }
        return valid;
    }

    private call(app: App): PythonType | undefined {
        if (app.fncName === "()") {
            const attribute = app.args[0];
            if (!(attribute instanceof App) || attribute.fncName !== "." || !(attribute.args[1] instanceof RefVar)) {
                for (const argument of app.args) {
                    this.expression(argument, true);
                }
                return this.fail(app, "動的な関数呼出しには対応していません");
            }
            const member = attribute.args[1];
            const owner = this.owner(attribute.args[0]);
            if (owner === undefined) {
                for (const argument of app.args.slice(1)) {
                    this.expression(argument, true);
                }
                return this.types.get(attribute.args[0])?.kind === "error" ? errorType : undefined;
            }
            const method = owner.methods.find(item => item.name === member.name);
            if (method === undefined) {
                for (const argument of app.args.slice(1)) {
                    this.expression(argument, true);
                }
                return this.fail(member, `${owner.name}に指定のメソッドがありません: ${member.name}`);
            }
            this.calls.set(app, { kind: "method", owner, definition: method });
            return this.nativeArguments(app, app.args.slice(1), method) ? method.returnType : errorType;
        }
        const binding = this.binding(app.fnc);
        if (binding.kind === "class") {
            const owner = binding.definition;
            if (owner.constructor === null) {
                for (const argument of app.args) {
                    this.expression(argument, true);
                }
                return this.fail(app, `${owner.name}にはコンストラクターが宣言されていません`);
            }
            this.calls.set(app, { kind: "constructor", owner, definition: owner.constructor });
            return this.nativeArguments(app, app.args, owner.constructor) ? owner.constructor.resultType : errorType;
        }
        if (binding.kind === "native") {
            this.calls.set(app, { kind: "native", definition: binding.definition });
            return this.nativeArguments(app, app.args, binding.definition) ? binding.definition.returnType : errorType;
        }
        if (binding.kind === "function") {
            const fn = binding.definition;
            let valid = app.args.length === fn.parameters.length;
            if (!valid) {
                this.fail(app, `${fn.node.name}の引数は${fn.parameters.length}個必要です`);
                this.invalidCalls.add(fn);
            }
            else {
                this.validCalls.add(fn);
            }
            this.calls.set(app, { kind: "function", definition: fn });
            for (const [index, argument] of app.args.entries()) {
                const actual = this.expression(argument);
                const parameter = fn.parameters[index];
                // 個数が違う呼出しは仮引数の推論へ混ぜず、他の正しい呼出しからの推論を維持する。
                if (parameter !== undefined && app.args.length === fn.parameters.length) {
                    this.update(parameter, actual, argument);
                }
                if (actual?.kind === "error" || parameter?.type?.kind === "error") {
                    valid = false;
                }
            }
            return valid ? fn.type : errorType;
        }
        for (const argument of app.args) {
            this.expression(argument, true);
        }
        return binding.kind === "error" ? errorType
            : this.fail(app.fnc, `この名前は呼び出せません: ${app.fncName}`);
    }

    private formatted(app: App): PythonType {
        let valid = true;
        for (const part of app.args) {
            if (part instanceof Str) {
                this.remember(part, strType);
            }
            else if (part instanceof App && part.fncName === "@format") {
                const value = this.expression(part.args[0]);
                if (!this.requireNumeric(value, part.args[0])) {
                    valid = false;
                }
                const format = part.args[1];
                if (!(format instanceof Str) || !/^(?:\d+)?(?:\.\d+)?[bcdeEfFgGnosxX%]?$/.test(format.text)) {
                    this.fail(part, "未対応の書式指定です");
                    this.remember(part, errorType);
                    valid = false;
                    continue;
                }
                if (/[bcdoxX]$/.test(format.text) && !this.requireNumeric(value, part.args[0], true)) {
                    valid = false;
                }
                if (/s$/.test(format.text)) {
                    this.fail(format, "文字列の置換式には対応していません");
                    valid = false;
                }
                this.remember(format, strType);
                this.remember(part, value?.kind === "error" ? errorType : strType);
            }
            else if (!this.requireNumeric(this.expression(part), part)) {
                valid = false;
            }
        }
        return valid ? strType : errorType;
    }

    private operation(app: App): PythonType | undefined {
        const operator = app.fncName;
        if (operator === ".") {
            this.field(app);
            return this.types.get(app);
        }
        if (["[]", ",", "t[i]", "@format", "**"].includes(operator) || isAssignmentToken(operator)) {
            for (const argument of app.args) {
                this.expression(argument, true);
            }
            return this.fail(app, `未対応の式です: ${operator}`);
        }
        if (operator === "<compare>") {
            const types = app.args.map(term => this.expression(term));
            let valid = !types.some(type => type?.kind === "error");
            for (const [index, comparison] of app.comparisonOperators.entries()) {
                if (["in", "not in"].includes(comparison)) {
                    this.fail(app, "コンテナの比較には対応していません");
                    valid = false;
                }
                if (!["==", "!=", "is", "is not"].includes(comparison)) {
                    const left = this.requireNumeric(types[index], app.args[index]);
                    const right = this.requireNumeric(types[index + 1], app.args[index + 1]);
                    valid = left && right && valid;
                }
            }
            return valid ? intType : errorType;
        }
        if (["not", "and", "or"].includes(operator)) {
            const types = app.args.map(term => this.expression(term));
            if (types.some(type => type?.kind === "error")) {
                return errorType;
            }
            return operator === "not" ? intType : this.merge(types[0], types[1], app);
        }
        if (["+", "-", "*", "/", "//", "%", "~", "&", "|", "^", "<<", ">>"].includes(operator)) {
            const types = app.args.map(term => this.expression(term));
            const integer = ["~", "&", "|", "^", "<<", ">>"].includes(operator);
            let valid = true;
            for (const [index, type] of types.entries()) {
                if (!this.requireNumeric(type, app.args[index], integer)) {
                    valid = false;
                }
            }
            if (!valid) {
                return errorType;
            }
            if (types.some(type => type === undefined)) {
                return undefined;
            }
            return operator === "/" || types.some(type => type?.kind === "float") ? floatType : intType;
        }
        return this.call(app);
    }

    private expression(term: Term, text = false): PythonType | undefined {
        let type: PythonType | undefined;
        if (term instanceof ConstNum) {
            type = /[.eE]/.test(term.text) ? floatType : intType;
        }
        else if (term instanceof RefVar) {
            const binding = this.binding(term);
            if (binding.kind === "variable") {
                type = binding.variable.type;
            }
            else if (binding.kind === "constant") {
                type = binding.type;
            }
            else {
                type = binding.kind === "error" ? errorType
                    : this.fail(term, "クラス・関数・メソッドを値として扱う処理には対応していません");
            }
        }
        else if (term instanceof Str || term instanceof App && term.fncName === 'f"') {
            // 使用位置が不正でもf文字列の置換式を解析し、独立した未定義名を拾う。
            const formatted = term instanceof Str ? strType : this.formatted(term);
            type = text ? formatted : this.fail(term, "文字列・f文字列は表示APIの引数だけに使用できます");
        }
        else if (term instanceof App) {
            type = this.operation(term);
        }
        else {
            type = this.fail(term, "未対応の式です");
        }
        return this.remember(term, type);
    }

    private assignment(app: App): void {
        const target = app.args[0];
        const right = app.args[1];
        let type: PythonType | undefined;
        if (app.fncName === "=") {
            type = this.expression(right);
        }
        else {
            const leftType = this.expression(target);
            const rightType = this.expression(right);
            const integer = ["&=", "|=", "^=", "<<=", ">>="].includes(app.fncName);
            const leftValid = this.requireNumeric(leftType, target, integer);
            const rightValid = this.requireNumeric(rightType, right, integer);
            if (!["+=", "-=", "*=", "/=", "//=", "%=", "&=", "|=", "^=", "<<=", ">>="].includes(app.fncName)) {
                type = this.fail(app, `未対応の複合代入です: ${app.fncName}`);
            }
            else if (!leftValid || !rightValid) {
                type = errorType;
            }
            else {
                type = app.fncName === "/=" ? floatType : this.merge(leftType, rightType, app);
            }
        }
        if (this.invalidDeclarations.has(target)) {
            return;
        }
        if (target instanceof RefVar) {
            const binding = this.binding(target);
            if (binding.kind !== "variable") {
                if (binding.kind !== "error") {
                    this.fail(target, "変数に代入してください");
                }
                return;
            }
            this.update(binding.variable, type, app);
            this.remember(target, binding.variable.type);
        }
        else if (target instanceof App && target.fncName === ".") {
            const field = this.field(target, true);
            if (field !== undefined) {
                this.compatible(type, field.type, right);
            }
        }
        else {
            this.fail(target, "代入先は変数または公開フィールドにしてください");
            this.expression(target, true);
        }
    }

    /** 両方の分岐がreturnする場合だけ、関数末尾の暗黙Noneを省く。 */
    private fallsThrough(block: BlockStatement): boolean {
        for (const statement of block.statements) {
            if (statement instanceof ReturnStatement) {
                return false;
            }
            if (statement instanceof IfStatement && !this.fallsThrough(statement.ifBlock)) {
                const alternative = statement.elseIf === undefined ? statement.elseBlock : new BlockStatement([statement.elseIf]);
                if (alternative !== undefined && !this.fallsThrough(alternative)) {
                    return false;
                }
            }
        }
        return true;
    }

    private statement(statement: Statement): void {
        if (statement instanceof Fn || statement instanceof GlobalStatement) {
            return;
        }
        if (statement instanceof CallStatement) {
            if (statement.app instanceof App && statement.app.isAssignmentApp()) {
                this.assignment(statement.app);
            }
            else {
                this.expression(statement.app);
            }
        }
        else if (statement instanceof ReturnStatement) {
            const type = statement.value === undefined ? noneType : this.expression(statement.value);
            if (this.scope === undefined) {
                this.fail(statement, "returnは関数内だけに使用できます");
                return;
            }
            this.update(this.scope, type, statement);
        }
        else if (statement instanceof IfStatement) {
            this.expression(statement.condition);
            this.block(statement.ifBlock);
            if (statement.elseIf !== undefined) {
                this.statement(statement.elseIf);
            }
            if (statement.elseBlock !== undefined) {
                this.block(statement.elseBlock);
            }
        }
        else if (statement instanceof WhileStatement) {
            this.expression(statement.condition);
            this.block(statement.block);
        }
        else if (!["pass", "break", "continue"].includes(statement.keyword)) {
            this.fail(statement, "未対応の文です。device APIはimportなしで使用できます");
        }
    }

    private block(block: BlockStatement): void {
        for (const statement of block.statements) {
            this.statement(statement);
        }
    }

    /** 確定した型の検査でerrorになった値も、収束まで後続の式・関数へ伝播させる。 */
    private infer(limit: number): void {
        for (let pass = 0; pass < limit; pass++) {
            this.changed = false;
            this.scope = undefined;
            this.block(this.module.block);
            for (const fn of this.functions.values()) {
                this.scope = fn;
                this.block(fn.node.block);
                if (this.fallsThrough(fn.node.block)) {
                    this.update(fn, noneType, fn.node);
                }
            }
            if (!this.changed) {
                if (this.checking) {
                    return;
                }
                this.checking = true;
            }
        }
        this.fail(this.module, "型推論が収束しませんでした");
    }

    resolve(): PythonAnalysis {
        let executable = false;
        for (const statement of this.module.block.statements) {
            if (statement instanceof GlobalStatement) {
                continue;
            }
            if (!(statement instanceof Fn)) {
                executable = true;
                continue;
            }
            if (executable || this.reserved(statement.name) || this.functions.has(statement.name)) {
                this.fail(statement, "関数名の重複・API名との衝突、または先頭以外の関数定義です");
                this.invalidDeclarations.add(statement);
                continue;
            }
            const globalNames = collectScopeGlobals(statement.block, statement.args, (node, message) => {
                this.fail(node, message);
            });
            this.functions.set(statement.name, { node: statement, parameters: [], variables: new Map(), globalNames, type: undefined });
        }
        collectScopeGlobals(this.module.block, [], (node, message) => {
            this.fail(node, message);
        });
        this.collect(this.module.block);
        for (const fn of this.functions.values()) {
            for (const parameter of fn.node.args) {
                let variable: PythonVariable | undefined;
                if (fn.variables.has(parameter.name)) {
                    this.fail(parameter, `仮引数が重複しています: ${parameter.name}`);
                }
                else {
                    variable = this.addVariable(parameter.name, parameter, fn);
                }
                // 不正な仮引数も位置を残し、後続の引数番号をずらさない。名前の束縛は追加しない。
                fn.parameters.push(variable ?? { name: parameter.name, scope: "local", slot: -1,
                    declaration: parameter, type: errorType });
            }
            this.collect(fn.node.block, fn);
        }
        const nodes: AbstractSyntaxNode[] = [];
        this.module.getAll(nodes);
        // 型は未定→具体型→floatへの拡張→errorの順。errorは具体型へ戻さない。
        const variableCount = this.globals.size + [...this.functions.values()].reduce((count, fn) => count + fn.variables.size + 1, 0);
        const limit = 3 * (nodes.length + variableCount) + 3;
        this.infer(limit);
        // 個数不一致の呼出ししかない関数では、未定の仮引数を二次的な推論エラーとして報告しない。
        // 正しい個数の呼出しが1つでもあれば、その呼出しから得た型を引き続き使用する。
        let blocked = false;
        for (const fn of this.invalidCalls) {
            if (!this.validCalls.has(fn)) {
                for (const parameter of fn.parameters) {
                    if (parameter.type === undefined) {
                        parameter.type = errorType;
                        blocked = true;
                    }
                }
            }
        }
        if (blocked) {
            this.infer(limit);
        }
        // errorに依存する値は既に伝播済み。独立して未定の束縛だけを診断する。
        let unresolved = false;
        for (const fn of this.functions.values()) {
            for (const variable of fn.variables.values()) {
                if (variable.type === undefined) {
                    variable.type = this.fail(variable.declaration, `変数の型を推論できません: ${variable.name}`);
                    unresolved = true;
                }
            }
            if (fn.type === undefined) {
                fn.type = this.fail(fn.node, `戻り値の型を推論できません: ${fn.node.name}`);
                unresolved = true;
            }
        }
        for (const variable of this.globals.values()) {
            if (variable.type === undefined) {
                variable.type = this.fail(variable.declaration, `変数の型を推論できません: ${variable.name}`);
                unresolved = true;
            }
        }
        if (unresolved) {
            this.infer(limit);
        }
        // 診断を含む結果のslotは全て-1のまま返し、部分的な配置を生成器へ渡さない。
        if (this.diagnostics.length === 0) {
            for (const [variables, start] of [
                [this.globals, 0] as const,
                ...[...this.functions.values()].map(fn => [fn.variables, 2] as const)
            ]) {
                let slot = start;
                for (const variable of variables.values()) {
                    variable.slot = slot;
                    slot += valueSlotTypes(variable.type!, this.api).length;
                    if (slot > 65536) {
                        this.fail(variable.declaration, "変数のスロット位置がuint16の範囲を超えています");
                    }
                }
            }
        }
        if (this.diagnostics.length !== 0) {
            for (const variables of [this.globals, ...[...this.functions.values()].map(fn => fn.variables)]) {
                for (const variable of variables.values()) {
                    variable.slot = -1;
                }
            }
        }
        this.diagnostics.sort((left, right) => left.charPos - right.charPos);
        return { diagnostics: this.diagnostics, module: this.module, api: this.api,
            globals: this.globals, functions: this.functions, references: this.references,
            types: this.types, calls: this.calls, fields: this.fields };
    }
}

/** ソースの意味エラーはdiagnosticsへ蓄積し、部分的な解析結果も返す。apiは検証済みを渡す。 */
export function resolvePython(module: Module, api: DeviceApi): PythonAnalysis {
    return new PythonResolver(module, api).resolve();
}

/** 意味エラーではrejectしない。API読込み・形式不正・取消は解析の前提がないため例外を維持する。 */
export async function analyzePython(module: Module, signal?: AbortSignal): Promise<PythonAnalysis> {
    const api = await loadDeviceApi(signal);
    signal?.throwIfAborted();
    return resolvePython(module, api);
}
