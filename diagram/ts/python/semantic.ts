/**
 * Python構文解析後の名前解決・型推論と、機器API定義の読込み・検証を担当する。
 * parser.tsの同期構文解析とは分離し、構文木を入力として意味解析結果を返す。
 * parser.tsの開発用入口とble-wifi/device-connection.tsの送信前処理から利用する。
 * 診断の画面表示はpython-block.tsとhighlight-editor.tsが担当し、ここではDOMを操作しない。
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

/**
 * 意味解析で扱う数値・文字列・None・APIオブジェクトの型。
 * objectはAPIクラスのIDで区別する。errorは既知の問題に依存する値を表す回復用の型で、
 * 機器APIのJSON・バイトコードには出力しない。
 */
export type PythonType = { /** 数値・文字列・None・APIオブジェクト・回復用エラーを区別する型種別。 */ kind: "int" | "float" | "str" | "none" | "error" }
    | { /** 数値・文字列・None・APIオブジェクト・回復用エラーを区別する型種別。 */ kind: "object"; /** APIオブジェクトの型を識別するクラスID。 */ classId: number };

/** APIの呼出し定義。コンストラクターの式の型にはreturnTypeではなくresultTypeを使う。 */
export interface DeviceCallable {
    /** 所属クラス等で使うID。コンストラクターだけは0。 */
    id: number;
    /** CALL_NATIVE用に全コンストラクター・メソッド・関数を通じて一意なID。 */
    nativeId: number;
    /**
     * 表示・保存・名前解決に使用する名前。
     */
    name: string;
    /**
     * 宣言順の仮引数と、それぞれの型情報。
     */
    parameters: { /** 表示・保存・名前解決に使用する名前。 */ name: string; /** 対象の種別またはデータ型。 */ type: PythonType }[];
    /**
     * API呼出しまたはユーザー関数の戻り値型。
     */
    returnType: PythonType;
    /**
     * コンストラクター式が生成するAPIオブジェクトの型。
     */
    resultType?: PythonType;
}

/** recordのフィールド定義。参照・代入の可否はそれぞれの公開権限で判断する。 */
export interface DeviceField {
    /**
     * 所属する定義一覧で名前解決に使う数値識別子。
     */
    id: number;
    /**
     * 表示・保存・名前解決に使用する名前。
     */
    name: string;
    /**
     * 対象の種別またはデータ型。
     */
    type: PythonType;
    /**
     * このフィールドの参照が公開されているか。
     */
    readable: boolean;
    /**
     * このフィールドへの代入が公開されているか。
     */
    writable: boolean;
}

/** APIクラスの定義。recordは値コピーの対象、deviceはフィールドを持たない機器ハンドル。 */
export interface DeviceClass {
    /**
     * 所属する定義一覧で名前解決に使う数値識別子。
     */
    id: number;
    /**
     * 表示・保存・名前解決に使用する名前。
     */
    name: string;
    /**
     * 宣言順に値コピーするrecordと、ハンドルで扱うdeviceの区別。
     */
    kind: "record" | "device";
    /**
     * 明示的に宣言されたコンストラクター。未宣言ならnull。
     */
    constructor: DeviceCallable | null;
    /**
     * APIクラスが公開するメソッドの定義一覧。
     */
    methods: DeviceCallable[];
    /**
     * クラスのフィールドを宣言順に保持する定義一覧。
     */
    fields: DeviceField[];
}

/**
 * 検証済みの機器API定義。JSON形式はdiagram/python/generate-device-api.pyのInterfaceParserの各docstringを参照。
 * abiHashはそのまま保持し、この解析器では指紋の再計算やVMとの照合は行わない。
 */
export interface DeviceApi {
    /**
     * 機器API定義のデータ形式の版番号。
     */
    schemaVersion: number;
    /**
     * recordの配置と呼出し時の値受渡し規約の版番号。
     */
    callingConventionVersion: number;
    /**
     * 表示引数等の文字列使用制約の版番号。
     */
    stringPolicyVersion: number;
    /**
     * 正規化したAPI定義のSHA-256指紋を保持する小文字16進文字列。
     */
    abiHash: string;
    /**
     * 名前とIDを解決するためのAPIクラス定義。
     */
    classes: DeviceClass[];
    /**
     * ユーザー関数またはAPI関数の名前と定義を管理する一覧。
     */
    functions: DeviceCallable[];
}

/** undefinedは推論未定、errorは既知の問題に依存する値。slotは診断0件の場合だけ確定する。 */
export interface PythonVariable {
    /**
     * 表示・保存・名前解決に使用する名前。
     */
    name: string;
    /**
     * 変数の格納先を大域領域と関数の局所領域で区別する指定。
     */
    scope: "global" | "local";
    /**
     * 大域領域またはBPを基準とする固定スロットの先頭位置。
     */
    slot: number;
    /**
     * 変数の最初の宣言または代入先の元ノード。
     */
    declaration: AbstractSyntaxNode;
    /**
     * この変数の単一の推論型。undefinedは推論途中、errorは既知の問題への依存を示す。
     */
    type: PythonType | undefined;
}

/** ユーザー関数の束縛と推論状態。全呼出し箇所で単一の仮引数型・戻り値型を共有する。 */
export interface PythonFunction {
    /**
     * 元ソースの位置と構造を保持する宣言ノード。
     */
    node: Fn;
    /**
     * 宣言順の仮引数と、それぞれの型情報。
     */
    parameters: PythonVariable[];
    /**
     * 仮引数を含む変数の宣言・型・配置。
     */
    variables: Map<string, PythonVariable>;
    /** 関数全体に適用するglobal宣言。これらの変数はglobalsにだけ格納する。 */
    globalNames: ReadonlySet<string>;
    /**
     * この関数の戻り値の推論型。全呼出しで共有し、未定ならundefined。
     */
    type: PythonType | undefined;
}

/** 名前参照の解決先。未定義の名前は診断を記録したうえでerrorへ束縛する。 */
export type PythonBinding = { /** この共用型の要素を区別する種別。 */ kind: "variable"; /** 名前参照が解決された変数の宣言・型・配置。 */ variable: PythonVariable }
    | { /** この共用型の要素を区別する種別。 */ kind: "class"; /** 名前解決で特定したAPIまたはユーザー宣言の定義。 */ definition: DeviceClass }
    | { /** この共用型の要素を区別する種別。 */ kind: "native"; /** 名前解決で特定したAPIまたはユーザー宣言の定義。 */ definition: DeviceCallable }
    | { /** この共用型の要素を区別する種別。 */ kind: "function"; /** 名前解決で特定したAPIまたはユーザー宣言の定義。 */ definition: PythonFunction }
    | { /** この共用型の要素を区別する種別。 */ kind: "constant"; /** 表示・保存・名前解決に使用する名前。 */ name: string; /** 対象の種別またはデータ型。 */ type: PythonType }
    | { /** この共用型の要素を区別する種別。 */ kind: "error" };

/** 呼出し式の解決先。API呼出しのIDと型、またはユーザー関数の推論状態を生成器へ渡す。 */
export type PythonCall = { /** この共用型の要素を区別する種別。 */ kind: "constructor" | "method"; /** 解決したメソッドまたはフィールドを所有するAPIクラス。 */ owner: DeviceClass; /** 名前解決で特定したAPIまたはユーザー宣言の定義。 */ definition: DeviceCallable }
    | { /** この共用型の要素を区別する種別。 */ kind: "native"; /** 名前解決で特定したAPIまたはユーザー宣言の定義。 */ definition: DeviceCallable }
    | { /** この共用型の要素を区別する種別。 */ kind: "function"; /** 名前解決で特定したAPIまたはユーザー宣言の定義。 */ definition: PythonFunction };

/** ソース中の意味エラー。charPosは元ソースのUTF-16位置で、nodeは問題に対応する構文木。 */
export interface PythonDiagnostic {
    /**
     * 元のPythonソース内のUTF-16位置。自動生成命令では-1を使う。
     */
    charPos: number;
    /**
     * 診断として表示する問題の説明。
     */
    message: string;
    /**
     * 元ソースの位置と構造を保持する宣言ノード。
     */
    node: AbstractSyntaxNode;
}

/**
 * 構文木を変更せず、束縛・型・呼出し・属性の対応を別表へ格納した意味解析結果。
 * diagnosticsが空の場合だけ全変数型・戻り値型とスロット配置が確定する。
 * 診断がある場合も部分的な解決情報を返すが、変数のslotはすべて-1とする。
 */
export interface PythonAnalysis {
    /** 同じノード・メッセージの重複を除き、ソース位置順で返す。1件以上ならコード生成禁止。 */
    diagnostics: readonly PythonDiagnostic[];
    /**
     * この処理が対象とする構文解析済みのモジュール。
     */
    module: Module;
    /**
     * 検証済みの機器API定義。型参照・nativeId・ABI指紋を共有する。
     */
    api: DeviceApi;
    /** 全関数で共有する大域変数。 */
    globals: ReadonlyMap<string, PythonVariable>;
    /** 登録されたユーザー関数と、その変数・戻り値の型。 */
    functions: ReadonlyMap<string, PythonFunction>;
    /** 実際に解析した名前参照から束縛への対応。 */
    references: ReadonlyMap<RefVar, PythonBinding>;
    /** 式から推論済みの型への対応。未定の式は登録しない。 */
    types: ReadonlyMap<Term, PythonType>;
    /** 呼出し式からユーザー関数またはAPI定義への対応。 */
    calls: ReadonlyMap<App, PythonCall>;
    /** 属性式から所有クラスと公開フィールド定義への対応。 */
    fields: ReadonlyMap<App, { /** 解決したメソッドまたはフィールドを所有するAPIクラス。 */ owner: DeviceClass; /** 名前解決で特定したAPIまたはユーザー宣言の定義。 */ definition: DeviceField }>;
}

/**
 * API定義の形式不正を例外として報告する。
 * @param path 異常箇所のJSONパスまたは検証項目。
 * @throws 検証箇所を含むError。ソースの意味診断とは区別する。
 */
function invalidApi(path: string): never {
    throw new Error(`device-api.jsonの形式が不正です: ${path}`);
}

/**
 * null・配列を除くオブジェクトであることを検証する。
 * @param value 未検証のJSON値。
 * @param path 形式不正時に報告する位置。
 * @returns プロパティを検証するためのオブジェクト。
 */
function record(value: unknown, path: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        invalidApi(path);
    }
    return value as Record<string, unknown>;
}

/**
 * 要素数が65535以下の配列であることを検証する。要素自体は呼出し元が検証する。
 * @param value 未検証のJSON値。
 * @param path 形式不正時に報告する位置。
 * @returns 検証対象の要素列。
 */
function list(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value) || value.length > 65535) {
        invalidApi(path);
    }
    return value;
}

/**
 * 空でない文字列であることを検証する。Python識別子としての字句検査は行わない。
 * @param value 未検証の名前。
 * @param path 形式不正時に報告する位置。
 * @returns 検証した名前。
 */
function name(value: unknown, path: string): string {
    if (typeof value !== "string" || value.length === 0) {
        invalidApi(path);
    }
    return value;
}

/**
 * IDが指定した下限から65535までの整数であることを検証する。
 * @param value 未検証のID。
 * @param path 形式不正時に報告する位置。
 * @param minimum 許容する最小値。通常は1、コンストラクターのIDには0を指定する。
 * @returns 検証したID。
 */
function id(value: unknown, path: string, minimum = 1): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > 65535) {
        invalidApi(path);
    }
    return value;
}

/**
 * JSONの型定義を読む。objectの参照先の存在はreadDeviceApiで別途検証する。
 * @param value 未検証の型定義。回復用のerrorは受理しない。
 * @param path 形式不正時に報告する位置。
 * @returns 型の種類と、objectの場合はクラスID。
 */
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

/**
 * 同じ一覧のIDと名前がそれぞれ一意であることを検証する。
 * @param items 検証する定義の一覧。
 * @param path 重複時に報告する位置。
 * @returns 渡された一覧。宣言順は変更しない。
 */
function unique<T extends { /** 所属する定義一覧で名前解決に使う数値識別子。 */ id: number; /** 表示・保存・名前解決に使用する名前。 */ name: string }>(items: T[], path: string): T[] {
    if (new Set(items.map(item => item.id)).size !== items.length
        || new Set(items.map(item => item.name)).size !== items.length) {
        invalidApi(`${path}（IDまたは名前の重複）`);
    }
    return items;
}

/**
 * 呼出し定義を読み、仮引数名の重複とNone型の引数を拒否する。
 * コンストラクターはID=0・名前=__init__・returnType=Noneとし、resultTypeも読む。
 * @param value 未検証の呼出し定義。
 * @param path 形式不正時に報告する位置。
 * @param constructor コンストラクター固有の項目を検証するか。
 * @returns 共通の呼出し定義。型参照とnativeIdの全体検証はreadDeviceApiが担当する。
 */
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

/**
 * 未検証のJSONから、名前解決に使う機器API定義を作る。
 * schemaVersion/callingConventionVersion=2、stringPolicyVersion=1とABI指紋の形式を検証する。
 * ID・名前の重複、型参照、メンバーの公開権限、コンストラクターの結果型を検査する。
 * nativeIdは全呼出し定義で一意とし、文字列引数はprint・Display.printのtextだけに許す。
 * recordの空定義・循環・スロット数はvalueSlotTypesで検証する。指紋の再計算は行わない。
 * @param value 未検証のdevice-api.jsonの内容。
 * @returns 検証済みのAPI定義。JSONの宣言順を保持する。
 * @throws 形式・参照・制約に違反する場合のError。
 */
function readDeviceApi(value: unknown): DeviceApi {
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
    /**
     * object型の参照先がAPI内に存在することを検証する。
     * @param type 引数・戻り値・フィールドの型。
     */
    const checkType = (type: PythonType): void => {
        if (type.kind === "object" && !classIds.has(type.classId)) {
            invalidApi(`classId=${type.classId}`);
        }
    };
    /**
     * nativeIdの一意性、型参照、表示APIの文字列引数の制約を検証する。
     * @param callable 検証する呼出し定義。
     * @param qualifiedName メソッドはクラス名を含めた名前。表示APIの判定と診断に使う。
     */
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

/**
 * recordを入れ子も含めて末端フィールドの型列へ展開する。
 * 値コピーの配置をbytecode.tsと共有し、ID順ではなくJSONの宣言順で並べる。
 * Vec3は3、IMUValueは6スロット。device・数値・None・内部文字列は1スロットとする。
 * @param type 配置する型。意味解析の回復用のerrorは指定できない。
 * @param api クラスIDを解決するAPI定義。
 * @param ancestors 循環検出用の展開中のクラスID列。通常の呼出しでは省略する。
 * @returns 各スロットに格納する型の列。
 * @throws error型、未知のクラス、空・循環record、65535スロット超過の場合のError。
 */
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

/**
 * /diagram/device/device-api.jsonを毎回読み直し、readDeviceApiで検証する。
 * fetchのキャッシュは使わず、読込み結果をこのモジュールにも保持しない。
 * @param signal 読込みと読込み完了後の取消確認に使うシグナル。
 * @returns 検証済みのAPI定義。
 * @throws HTTP失敗・不正JSON・API形式不正・取消の例外を呼出し元へ伝播する。
 */
async function loadDeviceApi(signal?: AbortSignal): Promise<DeviceApi> {
    const response = await fetch("/diagram/device/device-api.json", { signal, cache: "no-store" });
    if (!response.ok) {
        throw new Error(`device-api.jsonを読み込めません: HTTP ${response.status}`);
    }
    const api = readDeviceApi(await response.json());
    signal?.throwIfAborted();
    return api;
}

/**
 * 整数式の推論で共有するint型の定義。
 */
const intType: PythonType = { kind: "int" };
/**
 * 数値統合と除算等で共有するfloat型の定義。
 */
const floatType: PythonType = { kind: "float" };
/**
 * Noneリテラルと値なしreturnで共有する型。
 */
const noneType: PythonType = { kind: "none" };
/**
 * 表示APIの文字列・f文字列で共有する内部型。
 */
const strType: PythonType = { kind: "str" };
/**
 * 既知の問題に依存する値を伝播し、連鎖診断を抑える回復用の型。
 */
const errorType: PythonType = { kind: "error" };

/**
 * 型の種類と、objectの場合はクラスIDが一致するかを調べる。
 * @param left 比較する型。
 * @param right 比較相手の型。
 * @returns 同一型ならtrue。intとfloatは異なる型として扱う。
 */
function sameType(left: PythonType, right: PythonType): boolean {
    return left.kind === right.kind && (left.kind !== "object" || right.kind === "object" && left.classId === right.classId);
}

/**
 * 数値演算の対象となる型かを調べる。
 * @param type 判定する型。
 * @returns intまたはfloatならtrue。
 */
function numeric(type: PythonType): boolean {
    return type.kind === "int" || type.kind === "float";
}

/**
 * 1つのモジュールの宣言収集・名前解決・型推論を管理する。
 * 同じ構文木を反復して解析し、結果はすべて別表へ格納する。
 * 元の構文木、parent、charPos、toString()のキャッシュは変更しない。
 */
class PythonResolver {
    /**
     * 全関数で共有する大域変数の型と配置。
     */
    private readonly globals = new Map<string, PythonVariable>();
    /**
     * ユーザー関数またはAPI関数の名前と定義を管理する一覧。
     */
    private readonly functions = new Map<string, PythonFunction>();
    /**
     * 元の名前参照から解決済みの束縛へ対応付ける表。
     */
    private readonly references = new Map<RefVar, PythonBinding>();
    /**
     * 式のノードから単一の推論型へ対応付ける表。
     */
    private readonly types = new Map<Term, PythonType>();
    /**
     * 呼出し式からAPI定義またはユーザー関数へ対応付ける表。
     */
    private readonly calls = new Map<App, PythonCall>();
    /**
     * 属性式から所有クラスと公開フィールド定義へ対応付ける表。
     */
    private readonly fields = new Map<App, { /** 解決したメソッドまたはフィールドを所有するAPIクラス。 */ owner: DeviceClass; /** 名前解決で特定したAPIまたはユーザー宣言の定義。 */ definition: DeviceField }>();
    /**
     * 検出した意味エラーの位置と説明。コード生成前に全件の有無を確認する。
     */
    private readonly diagnostics: PythonDiagnostic[] = [];
    /** 反復をまたぐ診断の重複をノードとメッセージの組で除く。 */
    private readonly reported = new Map<AbstractSyntaxNode, Set<string>>();
    /** 束縛や本体の解析から除外する不正な宣言。 */
    private readonly invalidDeclarations = new Set<AbstractSyntaxNode>();
    /** 引数の個数が不一致だった呼出し先。 */
    private readonly invalidCalls = new Set<PythonFunction>();
    /** 引数の個数が一致した呼出し先。引数型の正否とは別に記録する。 */
    private readonly validCalls = new Set<PythonFunction>();
    /**
     * importなしで解決するAPIクラス名と定義の索引。
     */
    private readonly classes: Map<string, DeviceClass>;
    /**
     * importなしで解決するAPI関数名と定義の索引。
     */
    private readonly nativeFunctions: Map<string, DeviceCallable>;
    /** 現在解析中の関数。undefinedはモジュール直下。 */
    private scope: PythonFunction | undefined;
    /** 現在の反復で型が更新されたか。 */
    private changed = false;
    /** 型の初回収束後にAPIの引数・代入型の適合検査を有効にする。 */
    private checking = false;

    /**
     * 全APIクラス・関数をimportなしで名前解決できるよう索引を作る。
     * @param module 構文解析済みのモジュール。
     * @param api 検証済みのAPI定義。
     */
    constructor(/** この処理が対象とする構文解析済みのモジュール。 */ private readonly module: Module, /** 検証済みの機器API定義。型参照・nativeId・ABI指紋を共有する。 */ private readonly api: DeviceApi) {
        this.classes = new Map(api.classes.map(item => [item.name, item]));
        this.nativeFunctions = new Map(api.functions.map(item => [item.name, item]));
    }

    /**
     * 意味エラーの位置・メッセージ・対応ノードを記録し、解析を続ける。
     * 反復をまたいで同じノード・メッセージを重複登録しない。
     * @param node 問題に対応する元の構文木のノード。
     * @param message 診断メッセージ。
     * @returns 依存する式や束縛へ伝播するerror型。
     */
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

    /**
     * 診断に表示する型名を取得する。
     * @param type 表示する型。objectのクラスIDは検証済みであること。
     * @returns APIクラス名、または型の種類。
     */
    private typeName(type: PythonType): string {
        return type.kind === "object" ? this.api.classes.find(item => item.id === type.classId)!.name : type.kind;
    }

    /**
     * 変数・式・戻り値に単一の型を割り当てるため、2つの推論結果を統合する。
     * 未定と具体型なら具体型、intとfloatならfloatとし、異なるクラスやNoneと数値は拒否する。
     * errorを伝播し、その値に依存する未定型・型不一致の連鎖報告を抑える。
     * @param left 既存の型。undefinedは推論途中。
     * @param right 新しく得た型。undefinedは推論途中。
     * @param node 統合できない場合の診断位置。
     * @returns 統合した型。両方が未定ならundefined、不整合ならerror。
     */
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

    /**
     * 束縛の型を統合し、変化があれば次の推論反復を必要とする状態にする。
     * @param target 型を更新する変数またはユーザー関数。
     * @param type 新しく得た型。
     * @param node 型不一致の場合の診断位置。
     */
    private update(target: { /** 対象の種別またはデータ型。 */ type: PythonType | undefined }, type: PythonType | undefined, node: AbstractSyntaxNode): void {
        const merged = this.merge(target.type, type, node);
        if (merged !== undefined && (target.type === undefined || !sameType(target.type, merged))) {
            target.type = merged;
            this.changed = true;
        }
    }

    /**
     * 式の型を既存の結果と統合して記録し、変化を推論反復へ通知する。
     * @param term 型を対応付ける式。
     * @param type 新しく得た型。
     * @returns 統合した型。未定なら表へ追加せずundefinedを返す。
     */
    private remember(term: Term, type: PythonType | undefined): PythonType | undefined {
        const previous = this.types.get(term);
        const merged = this.merge(previous, type, term);
        if (merged !== undefined && (previous === undefined || !sameType(previous, merged))) {
            this.types.set(term, merged);
            this.changed = true;
        }
        return merged;
    }

    /**
     * API名または組込み定数名との衝突を調べる。
     * @param name 宣言候補の名前。
     * @returns True・False・None、APIクラス名、API関数名のいずれかならtrue。
     */
    private reserved(name: string): boolean {
        return ["True", "False", "None"].includes(name) || this.classes.has(name) || this.nativeFunctions.has(name);
    }

    /**
     * 指定したスコープに変数を登録する。同名の変数があれば既存の束縛を再利用する。
     * API名・定数名・ユーザー関数名への再代入や仮引数による隠蔽は拒否する。
     * 不正な宣言は既存の束縛を隠さず、右辺や他の文の解析を続ける。
     * @param name 変数名。
     * @param declaration 宣言として扱う仮引数または代入先のノード。
     * @param scope 局所変数の所属関数。省略時は共有の大域変数へ登録する。
     * @returns 初期状態が型未定・slot=-1の変数、既存変数、または宣言不正ならundefined。
     */
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

    /**
     * 型推論に先立ち、ブロックをまたぐ代入先を収集する。
     * if/whileはスコープを作らず、属性名や演算子を変数として登録しない。
     * global名への代入・複合代入はglobalsへ束縛し、同名の局所領域を作らない。
     * 入れ子等の不正な関数定義は記録して本体へ入らない。global宣言だけでは値を初期化しない。
     * @param block 代入先を収集するブロック。
     * @param scope 所属関数。省略時はモジュール直下として扱う。
     */
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

    /**
     * 名前を解決し、参照ノードから束縛への対応を記録する。
     * 関数では仮引数・局所変数、次に大域変数を探す。global宣言名は大域変数だけを探す。
     * 変数以外はAPIクラス・API関数・ユーザー関数・組込み定数の順で解決する。
     * @param ref 解決する名前参照。
     * @returns 解決先。未定義なら診断を記録してerrorを返す。
     */
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

    /**
     * 数値または整数に限定される演算の型制約を検査する。
     * @param type 検査する型。未定なら検査を保留し、errorなら追加診断を出さない。
     * @param term 制約違反の場合の診断位置。
     * @param integer floatを許さずintだけに制限するか。
     * @returns 未定または制約を満たすならtrue、errorまたは制約違反ならfalse。
     */
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

    /**
     * API引数・フィールド代入の型を検査する。暗黙変換はintからfloatだけを許す。
     * 初回収束前または実際の型が未定の間は適合検査を保留する。
     * @param actual 引数または代入する値の型。
     * @param expected API定義が要求する型。
     * @param node 型不一致の場合の診断位置。
     * @returns 保留中または適合ならtrue、errorまたは型不一致ならfalse。
     */
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

    /**
     * 属性の対象式を解析し、APIクラスを取得する。
     * @param term フィールドまたはメソッドを持つ対象式。
     * @returns 対象のクラス。未定・errorならundefined、非objectなら診断してundefined。
     */
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

    /**
     * recordの公開フィールドを解決し、属性式の型と定義を記録する。
     * deviceのフィールド参照・代入や、メソッドを値として取得する操作は受理しない。
     * @param app 対象式と属性名を引数に持つ「.」式。
     * @param write 読取り権限ではなく書込み権限を検査するか。
     * @returns 利用可能なフィールド定義。未定または不正ならundefined。
     */
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

    /**
     * API呼出しの引数の個数・型を検査する。
     * 個数不一致でも全引数を解析し、余分な引数の未定義名も検出する。
     * str型の表示API引数では文字列・f文字列を許す。余分な引数も文字列を許して解析する。
     * @param app 個数不一致の場合の診断対象となる呼出し式。
     * @param args 明示引数の列。メソッドの対象オブジェクトは含めない。
     * @param callable 呼出し先のAPI定義。
     * @returns 個数・引数の解析・型の適合検査に問題がなければtrue。
     */
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

    /**
     * APIまたはユーザー関数の呼出しを解決し、呼出し先と式の型を求める。
     * APIメソッドは属性経由の呼出しだけに対応し、動的呼出し・別名呼出しには対応しない。
     * JSONにないコンストラクターは補わない。ユーザー関数では個数が正しい呼出しの
     * 引数型を仮引数へ統合し、全呼出し箇所で単一の関数型を共有する。
     * @param app 呼出し式。
     * @returns 戻り値型。未定ならundefined、不正な呼出しならerror。
     */
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

    /**
     * f文字列の断片・数値の置換式・書式指定を検証する。整形や文字列生成は行わない。
     * 断片と書式のStrは内部データとして扱い、整数書式にはintを要求する。
     * 文字列の置換式と入れ子のf文字列は受理しない。
     * @param app f文字列を表す式。
     * @returns 全断片が有効ならstr、制約違反があればerror。
     */
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

    /**
     * 属性・比較・論理・数値演算を解析し、それ以外は呼出しとして解決する。
     * 四則・//・%・ビット演算に対応し、累乗・コンテナ・添字等は拒否する。
     * 比較とnotはint、and/orは両辺の統合型、除算はfloatを返す。
     * ここで受理する演算やAPIのすべてをbytecode.tsが生成できるとは限らない。
     * @param app 演算子または呼出しを表す式。
     * @returns 演算結果の型。推論途中はundefined、制約違反はerror。
     */
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

    /**
     * 式を解析して型を記録する。クラス・関数・メソッドの値としての利用は拒否する。
     * 通常文字列・f文字列はstr宣言の表示API引数だけに許し、通常の値には使えない。
     * エラー回復用にtext=trueで解析する場合も、f文字列内の独立した問題は検出する。
     * @param term 解析する式。
     * @param text 文字列を許す引数位置、またはエラー回復用の解析か。
     * @returns 記録した型。推論途中はundefined、意味エラーはerror。
     */
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

    /**
     * 単純代入・複合代入を解析し、変数の型または公開フィールドの型制約へ反映する。
     * 変数は既存の型と統合し、フィールドは宣言型を変更せず適合性を検査する。
     * 不正な変数宣言でも右辺の解析は続ける。累乗の複合代入には対応しない。
     * @param app 代入先と右辺を引数に持つ代入式。
     */
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

    /**
     * 関数末尾に暗黙のNoneを加える必要があるか、文列を保守的に調べる。
     * returnまたは両方の分岐がreturnするifで末尾へ進まないと判断し、ループの終了は証明しない。
     * @param block 判定する関数本体または分岐ブロック。
     * @returns 末尾へ進む可能性があればtrue。
     */
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

    /**
     * 代入・呼出し・return・if/whileの型を解析する。関数定義とglobalは収集済みとして扱う。
     * pass・break・continueは型を更新しない。for・import等の未対応文は診断する。
     * @param statement 解析する文。分岐・ループの本体も同じスコープで解析する。
     */
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

    /**
     * ブロック内の文を順に解析する。先行文の意味エラーでも後続文の解析を続ける。
     * @param block 現在のスコープで解析するブロック。
     */
    private block(block: BlockStatement): void {
        for (const statement of block.statements) {
            this.statement(statement);
        }
    }

    /**
     * モジュールと全関数の型が収束するまで反復する。再帰・相互再帰も同じ反復で扱う。
     * 大域変数は全関数で共有し、ユーザー関数の仮引数・戻り値も呼出し箇所全体で共有する。
     * 初回収束後にAPI型の適合検査を有効にし、errorになった値も収束まで伝播させる。
     * 型が変わるPython全般ではなく単一型を使う保守的な解析で、未初期化や到達可能性の
     * 証明は行わない。代入前の実行時LOADには既存VMの未初期化値検査が必要になる。
     * @param limit 反復の上限。超過時はモジュールへ未収束の診断を追加する。
     */
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

    /**
     * 宣言収集・型推論・未定型の診断・スロット配置を行う。
     * 関数定義はモジュール先頭にまとめ、衝突・配置違反の定義は登録せず本体も解析しない。
     * global-scope.tsで関数全体のglobal名と宣言順を先に検査し、引数との衝突・宣言前の
     * 使用を意味診断へ蓄積する。globalの共通契約はcollectScopeGlobalsのコメントを参照する。
     * 未使用関数の仮引数も含め、最終的に型が決まらない変数・戻り値はエラーとする。
     * 型推論後はvalueSlotTypesの幅で変数を宣言順に配置し、関数内はBPの管理領域2個を空ける。
     * @returns 診断をcharPos順に並べた解析結果。診断があれば全変数のslotを-1にする。
     */
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

/**
 * 検証済みAPIを使い、構文解析済みのモジュールを同期的に意味解析する。
 * ソースの意味エラーは例外を投げずdiagnosticsへ蓄積し、部分的な解析結果も返す。
 * bytecode.tsは両生成入口で診断を検査し、1件以上なら生成前に拒否する。
 * python-block.tsとble-wifi/device-connection.tsはこの境界を通して送信を止める。
 * parser.tsの開発用入口は診断を記録して生成を省く。
 * @param module 元の構文木。解析では書き換えない。
 * @param api readDeviceApiまたはloadDeviceApiで検証済みのAPI定義。
 * @returns 名前の束縛・型・呼出し先・公開フィールドと意味診断。
 */
function resolvePython(module: Module, api: DeviceApi): PythonAnalysis {
    return new PythonResolver(module, api).resolve();
}

/**
 * 機器APIを毎回読み直し、resolvePythonで名前解決・型推論を行う非同期の入口。
 * parsePythonは同期の構文解析APIとして維持し、その構文エラーの例外も変更しない。
 * @param module 構文解析済みのモジュール。
 * @param signal API読込みと意味解析直前の取消確認に使うシグナル。
 * @returns 意味解析結果。ソースの意味エラーではrejectせずdiagnosticsへ蓄積する。
 * @throws API読込み・JSONやAPIの形式不正・取消の例外を呼出し元へ伝播する。
 */
export async function analyzePython(module: Module, signal?: AbortSignal): Promise<PythonAnalysis> {
    const api = await loadDeviceApi(signal);
    signal?.throwIfAborted();
    return resolvePython(module, api);
}
