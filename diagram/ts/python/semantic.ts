/**
 * Python構文解析後の名前解決・型推論。
 *
 * analyzePython(module, signal?)は/diagram/device/device-api.jsonを毎回読み直し、
 * resolvePython(module, api)で解析する。parsePython()は同期の構文解析APIとして維持する。
 * JSONの形式はdiagram/python/generate-device-api.pyの先頭コメントを参照する。
 * 形式の版、IDの重複、型参照、コンストラクター、表示APIの型制限を検証する。
 * abiHashは解析結果へ保持するが、ここでは指紋の再計算やVMとの照合は行わない。
 *
 * 全APIクラス・関数をimportなしで利用できる。API名・ユーザー関数名への再代入、
 * 仮引数による隠蔽は拒否する。関数定義は既存生成器と同じくモジュール先頭にまとめる。
 * 代入先を先に収集し、関数では仮引数・局所変数、次に大域変数の順で名前を解決する。
 * if/whileは変数スコープを作らず、属性名や演算子を変数として登録しない。
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
 * 参照できる。返却成功時はすべての変数型・戻り値型が確定している。
 * 元の構文木、parent、charPos、toString()のキャッシュは変更しない。
 * parser.tsの開発用入口とble-wifi/ble.tsの送信前処理が構文解析後に呼び出す。
 * アセンブリ・version=3のバイトコード生成はbytecode.tsがこの結果を利用する。
 * 新形式のBLE転送・受信形式検証はble-wifi側、値コピーと呼出しの実行はESP32の
 * bytecode_vm.cppが担当する。生成スタブはdevice_api.generated.cppからdevice_native.cppを呼ぶ。
 */
import {
    AbstractSyntaxNode, App, BlockStatement, CallStatement, ConstNum, Fn,
    IfStatement, Module, RefVar, ReturnStatement, Statement, Str, Term,
    WhileStatement, isAssignmentToken
} from "./syntax.js";

export type PythonType = { kind: "int" | "float" | "str" | "none" }
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

/** typeは推論中だけundefined。slotは解析完了時に値の幅込みで再配置する。 */
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
    type: PythonType | undefined;
}

export type PythonBinding = { kind: "variable"; variable: PythonVariable }
    | { kind: "class"; definition: DeviceClass }
    | { kind: "native"; definition: DeviceCallable }
    | { kind: "function"; definition: PythonFunction }
    | { kind: "constant"; name: string; type: PythonType };

export type PythonCall = { kind: "constructor" | "method"; owner: DeviceClass; definition: DeviceCallable }
    | { kind: "native"; definition: DeviceCallable }
    | { kind: "function"; definition: PythonFunction };

export interface PythonAnalysis {
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
    private readonly classes: Map<string, DeviceClass>;
    private readonly nativeFunctions: Map<string, DeviceCallable>;
    private scope: PythonFunction | undefined;
    private changed = false;
    private checking = false;

    constructor(private readonly module: Module, private readonly api: DeviceApi) {
        this.classes = new Map(api.classes.map(item => [item.name, item]));
        this.nativeFunctions = new Map(api.functions.map(item => [item.name, item]));
    }

    private fail(node: AbstractSyntaxNode, message: string): never {
        throw new SyntaxError(`${message} (charPos=${node.charPos})`);
    }

    private typeName(type: PythonType): string {
        return type.kind === "object" ? this.api.classes.find(item => item.id === type.classId)!.name : type.kind;
    }

    private merge(left: PythonType | undefined, right: PythonType | undefined, node: AbstractSyntaxNode): PythonType | undefined {
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
        if (type === undefined) {
            if (this.checking) {
                this.fail(term, "式の型を推論できません。関数の呼出し元・引数・戻り値を確認してください");
            }
            return undefined;
        }
        const previous = this.types.get(term);
        const merged = this.merge(previous, type, term)!;
        if (previous === undefined || !sameType(previous, merged)) {
            this.types.set(term, merged);
            this.changed = true;
        }
        return merged;
    }

    private reserved(name: string): boolean {
        return ["True", "False", "None"].includes(name) || this.classes.has(name) || this.nativeFunctions.has(name);
    }

    private addVariable(name: string, declaration: AbstractSyntaxNode, scope?: PythonFunction): PythonVariable {
        if (this.reserved(name) || this.functions.has(name)) {
            this.fail(declaration, `API・関数・定数の名前には束縛できません: ${name}`);
        }
        const variables = scope?.variables ?? this.globals;
        let variable = variables.get(name);
        if (variable === undefined) {
            variable = { name, scope: scope === undefined ? "global" : "local",
                slot: variables.size + (scope === undefined ? 0 : 2), declaration, type: undefined };
            variables.set(name, variable);
        }
        return variable;
    }

    /** ブロックをまたぐ代入を収集し、属性の左辺を新しい変数と誤認しない。 */
    private collect(block: BlockStatement, scope?: PythonFunction): void {
        for (const statement of block.statements) {
            if (statement instanceof Fn) {
                if (scope !== undefined || this.functions.get(statement.name)?.node !== statement) {
                    this.fail(statement, "関数定義はモジュール先頭だけに置けます");
                }
            }
            else if (statement instanceof CallStatement && statement.app instanceof App && statement.app.isAssignmentApp()) {
                const target = statement.app.args[0];
                if (target instanceof RefVar) {
                    this.addVariable(target.name, target, scope);
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
        const variable = this.scope?.variables.get(ref.name) ?? this.globals.get(ref.name);
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
            return this.fail(ref, `未定義の名前です: ${ref.name}`);
        }
        this.references.set(ref, result);
        return result;
    }

    private requireNumeric(type: PythonType | undefined, term: Term, integer = false): void {
        if (type !== undefined && (!numeric(type) || integer && type.kind !== "int")) {
            this.fail(term, `${integer ? "int" : "数値"}が必要です: ${this.typeName(type)}`);
        }
    }

    private compatible(actual: PythonType | undefined, expected: PythonType, node: AbstractSyntaxNode): void {
        if (this.checking && actual !== undefined && !sameType(actual, expected)
            && !(actual.kind === "int" && expected.kind === "float")) {
            this.fail(node, `${this.typeName(expected)}が必要です: ${this.typeName(actual)}`);
        }
    }

    private owner(term: Term): DeviceClass | undefined {
        const type = this.expression(term);
        if (type === undefined) {
            return undefined;
        }
        if (type.kind !== "object") {
            this.fail(term, `属性の対象はAPIオブジェクトにしてください: ${this.typeName(type)}`);
        }
        return this.api.classes.find(item => item.id === type.classId)!;
    }

    private field(app: App, write = false): DeviceField | undefined {
        const owner = this.owner(app.args[0]);
        const member = app.args[1];
        if (!(member instanceof RefVar)) {
            this.fail(app, "属性名が不正です");
        }
        if (owner === undefined) {
            return undefined;
        }
        const definition = owner.fields.find(item => item.name === member.name);
        if (owner.kind !== "record" || definition === undefined || !(write ? definition.writable : definition.readable)) {
            this.fail(app, `${owner.name}.${member.name}は${write ? "代入" : "参照"}できるフィールドではありません`);
        }
        this.fields.set(app, { owner, definition });
        this.remember(app, definition.type);
        return definition;
    }

    private nativeArguments(app: App, args: Term[], callable: DeviceCallable): void {
        if (args.length !== callable.parameters.length) {
            this.fail(app, `${callable.name}の引数は${callable.parameters.length}個必要です`);
        }
        for (const [index, argument] of args.entries()) {
            const expected = callable.parameters[index].type;
            this.compatible(this.expression(argument, expected.kind === "str"), expected, argument);
        }
    }

    private call(app: App): PythonType | undefined {
        if (app.fncName === "()") {
            const attribute = app.args[0];
            if (!(attribute instanceof App) || attribute.fncName !== "." || !(attribute.args[1] instanceof RefVar)) {
                this.fail(app, "動的な関数呼出しには対応していません");
            }
            const member = attribute.args[1];
            const owner = this.owner(attribute.args[0]);
            if (owner === undefined) {
                for (const argument of app.args.slice(1)) {
                    // 所有クラスが決まるまで表示引数かどうかを確定せず、次の反復で検査する。
                    this.expression(argument, true);
                }
                return undefined;
            }
            const method = owner.methods.find(item => item.name === member.name);
            if (method === undefined) {
                this.fail(attribute, `${owner.name}に指定のメソッドがありません: ${member.name}`);
            }
            this.calls.set(app, { kind: "method", owner, definition: method });
            this.nativeArguments(app, app.args.slice(1), method);
            return method.returnType;
        }
        const binding = this.binding(app.fnc);
        if (binding.kind === "class") {
            const owner = binding.definition;
            if (owner.constructor === null) {
                this.fail(app, `${owner.name}にはコンストラクターが宣言されていません`);
            }
            this.calls.set(app, { kind: "constructor", owner, definition: owner.constructor });
            this.nativeArguments(app, app.args, owner.constructor);
            return owner.constructor.resultType;
        }
        if (binding.kind === "native") {
            this.calls.set(app, { kind: "native", definition: binding.definition });
            this.nativeArguments(app, app.args, binding.definition);
            return binding.definition.returnType;
        }
        if (binding.kind === "function") {
            const fn = binding.definition;
            if (app.args.length !== fn.parameters.length) {
                this.fail(app, `${fn.node.name}の引数は${fn.parameters.length}個必要です`);
            }
            this.calls.set(app, { kind: "function", definition: fn });
            for (const [index, argument] of app.args.entries()) {
                this.update(fn.parameters[index], this.expression(argument), argument);
            }
            return fn.type;
        }
        return this.fail(app, `この名前は呼び出せません: ${app.fncName}`);
    }

    private formatted(app: App): PythonType {
        for (const part of app.args) {
            if (part instanceof Str) {
                this.remember(part, strType);
            }
            else if (part instanceof App && part.fncName === "@format") {
                const value = this.expression(part.args[0]);
                this.requireNumeric(value, part.args[0]);
                const format = part.args[1];
                if (!(format instanceof Str) || !/^(?:\d+)?(?:\.\d+)?[bcdeEfFgGnosxX%]?$/.test(format.text)) {
                    this.fail(part, "未対応の書式指定です");
                }
                if (/[bcdoxX]$/.test(format.text)) {
                    this.requireNumeric(value, part.args[0], true);
                }
                if (/s$/.test(format.text)) {
                    this.fail(format, "文字列の置換式には対応していません");
                }
                this.remember(format, strType);
                this.remember(part, strType);
            }
            else {
                this.requireNumeric(this.expression(part), part);
            }
        }
        return strType;
    }

    private operation(app: App): PythonType | undefined {
        const operator = app.fncName;
        if (operator === ".") {
            return this.field(app)?.type;
        }
        if (["[]", ",", "t[i]", "@format", "**"].includes(operator) || isAssignmentToken(operator)) {
            this.fail(app, `未対応の式です: ${operator}`);
        }
        if (operator === "<compare>") {
            const types = app.args.map(term => this.expression(term));
            for (const [index, comparison] of app.comparisonOperators.entries()) {
                if (["in", "not in"].includes(comparison)) {
                    this.fail(app, "コンテナの比較には対応していません");
                }
                if (!["==", "!=", "is", "is not"].includes(comparison)) {
                    this.requireNumeric(types[index], app.args[index]);
                    this.requireNumeric(types[index + 1], app.args[index + 1]);
                }
            }
            return intType;
        }
        if (["not", "and", "or"].includes(operator)) {
            const left = this.expression(app.args[0]);
            return operator === "not" ? intType : this.merge(left, this.expression(app.args[1]), app);
        }
        if (["+", "-", "*", "/", "//", "%", "~", "&", "|", "^", "<<", ">>"].includes(operator)) {
            const types = app.args.map(term => this.expression(term));
            const integer = ["~", "&", "|", "^", "<<", ">>"].includes(operator);
            for (const [index, type] of types.entries()) {
                this.requireNumeric(type, app.args[index], integer);
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
            if (binding.kind !== "variable" && binding.kind !== "constant") {
                this.fail(term, "クラス・関数・メソッドを値として扱う処理には対応していません");
            }
            type = binding.kind === "variable" ? binding.variable.type : binding.type;
        }
        else if (term instanceof Str || term instanceof App && term.fncName === 'f"') {
            if (!text) {
                this.fail(term, "文字列・f文字列は表示APIの引数だけに使用できます");
            }
            type = term instanceof Str ? strType : this.formatted(term);
        }
        else if (term instanceof App) {
            type = this.operation(term);
        }
        else {
            this.fail(term, "未対応の式です");
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
            if (!["+=", "-=", "*=", "/=", "//=", "%=", "&=", "|=", "^=", "<<=", ">>="].includes(app.fncName)) {
                this.fail(app, `未対応の複合代入です: ${app.fncName}`);
            }
            const integer = ["&=", "|=", "^=", "<<=", ">>="].includes(app.fncName);
            this.requireNumeric(leftType, target, integer);
            this.requireNumeric(rightType, right, integer);
            type = app.fncName === "/=" ? floatType : this.merge(leftType, rightType, app);
        }
        if (target instanceof RefVar) {
            const binding = this.binding(target);
            if (binding.kind !== "variable") {
                this.fail(target, "変数に代入してください");
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
        if (statement instanceof Fn) {
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
            if (this.scope === undefined) {
                this.fail(statement, "returnは関数内だけに使用できます");
            }
            this.update(this.scope, statement.value === undefined ? noneType : this.expression(statement.value), statement);
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

    resolve(): PythonAnalysis {
        let executable = false;
        for (const statement of this.module.block.statements) {
            if (!(statement instanceof Fn)) {
                executable = true;
                continue;
            }
            if (executable || this.reserved(statement.name) || this.functions.has(statement.name)) {
                this.fail(statement, "関数名の重複・API名との衝突、または先頭以外の関数定義です");
            }
            this.functions.set(statement.name, { node: statement, parameters: [], variables: new Map(), type: undefined });
        }
        this.collect(this.module.block);
        for (const fn of this.functions.values()) {
            for (const parameter of fn.node.args) {
                if (fn.variables.has(parameter.name)) {
                    this.fail(parameter, `仮引数が重複しています: ${parameter.name}`);
                }
                fn.parameters.push(this.addVariable(parameter.name, parameter, fn));
            }
            this.collect(fn.node.block, fn);
        }
        const nodes: AbstractSyntaxNode[] = [];
        this.module.getAll(nodes);
        // 各型は未定→具体型→数値のfloatへの拡張だけ。ノード数と束縛数から反復を制限する。
        const variableCount = this.globals.size + [...this.functions.values()].reduce((count, fn) => count + fn.variables.size + 1, 0);
        const limit = 2 * (nodes.length + variableCount) + 2;
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
            if (this.checking) {
                break;
            }
            if (!this.changed) {
                this.checking = true;
            }
            if (pass === limit - 1) {
                this.fail(this.module, "型推論が収束しませんでした");
            }
        }
        for (const fn of this.functions.values()) {
            for (const variable of fn.variables.values()) {
                if (variable.type === undefined) {
                    this.fail(variable.declaration, `変数の型を推論できません: ${variable.name}`);
                }
            }
            if (fn.type === undefined) {
                this.fail(fn.node, `戻り値の型を推論できません: ${fn.node.name}`);
            }
        }
        for (const variable of this.globals.values()) {
            if (variable.type === undefined) {
                this.fail(variable.declaration, `変数の型を推論できません: ${variable.name}`);
            }
        }
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
        return { module: this.module, api: this.api, globals: this.globals, functions: this.functions,
            references: this.references, types: this.types, calls: this.calls, fields: this.fields };
    }
}

/** 読込済みの検証済みAPIを用いて、同期的に名前解決と型推論を行う。 */
export function resolvePython(module: Module, api: DeviceApi): PythonAnalysis {
    return new PythonResolver(module, api).resolve();
}

/** 構文解析の後に呼ぶ入口。APIの読込み・意味解析が成功した場合だけ結果を返す。 */
export async function analyzePython(module: Module, signal?: AbortSignal): Promise<PythonAnalysis> {
    const api = await loadDeviceApi(signal);
    signal?.throwIfAborted();
    return resolvePython(module, api);
}
