/**
 * device.pyiから生成する組込みモジュール定義の読込みと、呼出し引数の名前解決。
 * 生成元はdiagram/python/module_api.py、C++の共有enumはdevice_api_cpp.pyが担当する。
 * 機器APIのPythonType・nativeIdと分離し、第1段階ではNumPyの実行命令を生成しない。
 */
import { AbstractSyntaxNode, KeywordArgument, Term } from "./syntax";

/**
 * モジュール定義専用の型。現行VMの値スロット型とは混同しない。
 */
export type ModuleValueType = "shape" | "dtype" | "str" | "device" | "array_like" | "ndarray";

/**
 * 位置指定と省略可能性を独立に表す引数定義。実際の既定値は保持しない。
 */
export interface ModuleParameter {
    /**
     * 引数の名前。
     */
    name: string;
    /**
     * 値に要求する型。
     */
    type: ModuleValueType;
    /**
     * 位置指定番号。キーワード専用ならnull。
     */
    position: number | null;
    /**
     * 未指定ならエラーにするか。
     */
    required: boolean;
    /**
     * 省略可能な項目だけの宣言順番号。必須引数ならnull。
     */
    optionId: number | null;
}

/**
 * モジュール内の関数定義。idはnativeIdではなく、モジュール内で一意の番号。
 */
export interface ModuleFunction {
    /**
     * モジュール内の関数ID。
     */
    id: number;
    /**
     * 関数名。
     */
    name: string;
    /**
     * 宣言順の引数情報。
     */
    parameters: ModuleParameter[];
    /**
     * 戻り値に要求するモジュール型。
     */
    returnType: ModuleValueType;
}

/**
 * 機器クラスとは別に定義する組込みモジュールの名前空間。
 */
export interface ModuleDefinition {
    /**
     * importで使用する名前。
     */
    name: string;
    /**
     * モジュール専用の型名と形式型。
     */
    types: {
        /**
         * 宣言された型名。
         */
        name: string;
        /**
         * JSONとC++生成器で共有する形式型。
         */
        kind: ModuleValueType;
    }[];
    /**
     * dtype等の定数名。値は実装側で扱う。
     */
    constants: {
        /**
         * モジュールに公開する定数名。
         */
        name: string;
        /**
         * 定数の形式型。第1段階はdtypeだけを扱う。
         */
        type: "dtype";
    }[];
    /**
     * 宣言した関数。実行登録とは分離する。
     */
    functions: ModuleFunction[];
}

/**
 * ソース順を保持した呼出し対応。省略引数の値は補わない。
 */
export interface ModuleCallBinding {
    /**
     * importの解決先。
     */
    module: ModuleDefinition;
    /**
     * 呼出し先。
     */
    definition: ModuleFunction;
    /**
     * 必須引数のposition、optionalのoptionIdと対応する式。
     */
    arguments: {
        /**
         * 値の対応先となる引数定義。
         */
        parameter: ModuleParameter;
        /**
         * ソース順を保持した未評価の式。
         */
        value: Term;
    }[];
}

/**
 * モジュール定義形式の不一致を拒否する。
 * @param path 不正な値のJSON内の位置。
 * @throws {Error} 定義形式の不一致を示す例外を常に送出する。
 */
function invalid(path: string): never {
    throw new Error(`device-api.jsonのモジュール定義が不正です: ${path}`);
}

/**
 * JSONのobjectを検証する。
 * @param value 検証対象のJSON値。
 * @param path 診断に表示するJSON内の位置。
 * @returns 検証済みのプロパティ辞書。
 * @throws {Error} null・配列・object以外の値の場合。
 */
function object(value: unknown, path: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        invalid(path);
    }
    return value as Record<string, unknown>;
}

/**
 * JSONの配列を検証する。
 * @param value 検証対象のJSON値。
 * @param path 診断に表示するJSON内の位置。
 * @returns 検証済みの配列。
 * @throws {Error} 配列以外の場合。
 */
function array(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) {
        invalid(path);
    }
    return value;
}

/**
 * 名前を識別子として検証する。
 * @param value 検証対象の名前。
 * @param path 診断に表示するJSON内の位置。
 * @returns 検証済みの識別子。
 * @throws {Error} ASCIIの識別子として使用できない場合。
 */
function identifier(value: unknown, path: string): string {
    if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        invalid(path);
    }
    return value;
}

/**
 * 定義専用の型名を検証する。
 * @param value 検証対象の形式型名。
 * @param path 診断に表示するJSON内の位置。
 * @returns 対応するモジュール形式型。
 * @throws {Error} 未対応の形式型の場合。
 */
function valueType(value: unknown, path: string): ModuleValueType {
    if (value !== "shape" && value !== "dtype" && value !== "str" && value !== "device"
        && value !== "array_like" && value !== "ndarray") {
        invalid(path);
    }
    return value;
}

/**
 * 宣言順の位置番号とoptionIdを検証する。optionalの値自体はJSONに持たない。
 * @param value 検証対象の引数定義配列。
 * @param path 診断に表示するJSON内の位置。
 * @returns 宣言順の検証済み引数定義。
 * @throws {Error} 名前・型・番号・省略可否が定義形式に違反する場合。
 */
function parameters(value: unknown, path: string): ModuleParameter[] {
    let position = 0;
    let optionId = 0;
    let keywordOnly = false;
    let optionalSeen = false;
    const names = new Set<string>();
    return array(value, path).map((item, index) => {
        const current = `${path}[${index}]`;
        const data = object(item, current);
        const name = identifier(data.name, `${current}.name`);
        if (names.has(name) || typeof data.required !== "boolean" || index >= 65535) {
            invalid(current);
        }
        names.add(name);
        if (data.position === null) {
            keywordOnly = true;
        }
        else if (keywordOnly || data.position !== position++) {
            invalid(`${current}.position`);
        }
        if (data.required) {
            if (optionalSeen || data.position === null || data.optionId !== null) {
                invalid(current);
            }
        }
        else {
            optionalSeen = true;
            if (data.optionId !== optionId++) {
                invalid(`${current}.optionId`);
            }
        }
        return { name, type: valueType(data.type, `${current}.type`), position: data.position as number | null,
            required: data.required, optionId: data.optionId as number | null };
    });
}

/**
 * moduleDefinitionVersion=1の定義を全件検証する。旧モジュール形式は受理しない。
 * 引数の宣言順・番号・型はC++生成enumと同じABI指紋に含まれる。
 * @param version JSONのmoduleDefinitionVersion。
 * @param value JSONのmodules配列。
 * @returns 宣言順の検証済みモジュール定義。
 * @throws {Error} 版・名前・型・関数・引数の定義が不正な場合。
 */
export function readModuleDefinitions(version: unknown, value: unknown): ModuleDefinition[] {
    if (version !== 1) {
        invalid("moduleDefinitionVersion");
    }
    const modules = new Set<string>();
    return array(value, "modules").map((item, index) => {
        const path = `modules[${index}]`;
        const data = object(item, path);
        const name = identifier(data.name, path);
        if (modules.has(name)) {
            invalid(path);
        }
        modules.add(name);
        const members = new Set<string>();
        /**
         * 型・定数・関数で共有する名前の重複を検査して登録する。
         * @param value 登録するメンバー名。
         * @returns 検証・登録済みの識別子。
         * @throws {Error} 名前が不正、または同じモジュール内で重複する場合。
         */
        const memberName = (value: unknown): string => {
            const name = identifier(value, path);
            if (members.has(name)) {
                invalid(path);
            }
            members.add(name);
            return name;
        };
        const types = array(data.types, `${path}.types`).map(item => {
            const type = object(item, path);
            return { name: memberName(type.name), kind: valueType(type.kind, path) };
        });
        const known = new Set<ModuleValueType>(["str", ...types.map(type => type.kind)]);
        const constants = array(data.constants, `${path}.constants`).map(item => {
            const constant = object(item, path);
            if (constant.type !== "dtype" || !known.has("dtype")) {
                invalid(path);
            }
            return { name: memberName(constant.name), type: "dtype" as const };
        });
        const functions = array(data.functions, `${path}.functions`).map((item, index): ModuleFunction => {
            const fn = object(item, path);
            if (fn.id !== index + 1 || index >= 65535) {
                invalid(`${path}.function.id`);
            }
            const args = parameters(fn.parameters, `${path}.${String(fn.name)}.parameters`);
            const result = valueType(fn.returnType, path);
            if (!known.has(result) || args.some(parameter => !known.has(parameter.type))) {
                invalid(path);
            }
            return { id: index + 1, name: memberName(fn.name), parameters: args, returnType: result };
        });
        return { name, types, constants, functions };
    });
}

/**
 * 呼出し引数を名前・位置番号へ対応付ける。式は評価せず、ソース順に保持する。
 * 重複・未知のキーワード・必須不足を診断し、optionalの既定値は補わない。
 * @param definition 呼出し先の引数定義。
 * @param args ソース順に並んだ位置引数とキーワード引数。
 * @param call 必須引数不足の診断位置となる呼出し式。
 * @param report 不正な引数のノードとメッセージを受け取る診断関数。
 * @returns 正しく対応付けられた引数だけをソース順に並べた一覧。
 */
export function bindModuleArguments(definition: ModuleFunction, args: readonly Term[],
    call: AbstractSyntaxNode, report: (node: AbstractSyntaxNode, message: string) => void): ModuleCallBinding["arguments"] {
    const result: ModuleCallBinding["arguments"] = [];
    const assigned = new Set<string>();
    let position = 0;
    let keywordSeen = false;
    for (const argument of args) {
        const keyword = argument instanceof KeywordArgument;
        const parameter = keyword ? definition.parameters.find(parameter => parameter.name === argument.name)
            : definition.parameters.find(parameter => parameter.position === position++);
        if (!keyword && keywordSeen) {
            report(argument, "キーワード引数の後に位置引数は指定できません");
        }
        keywordSeen = keywordSeen || keyword;
        if (parameter === undefined) {
            report(argument, keyword ? `未知のキーワード引数です: ${argument.name}` : "位置引数が多すぎます");
        }
        else if (assigned.has(parameter.name)) {
            report(argument, `引数が二重に指定されています: ${parameter.name}`);
        }
        else {
            assigned.add(parameter.name);
            result.push({ parameter, value: keyword ? argument.value : argument });
        }
    }
    for (const parameter of definition.parameters) {
        if (parameter.required && !assigned.has(parameter.name)) {
            report(call, `必須引数がありません: ${parameter.name}`);
        }
    }
    return result;
}
