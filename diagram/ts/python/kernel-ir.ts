/**
 * kernel.tsとsemantic.tsの解析結果を、数値計算専用の型付き中間表現へ変換する。
 * 中間表現は構文木・VMのValue・Cの識別名から独立し、kernel-c.tsが共通Cへ変換する。
 */
import {
    AbstractSyntaxNode, App, BlockStatement, CallStatement, ConstNum, ForStatement,
    IfStatement, RefVar, ReturnStatement, Term, WhileStatement, indexOpr
} from "./syntax";
import type { PythonKernelFunction, PythonKernelType } from "./kernel";
import type { PythonAnalysis } from "./semantic";

/** 数値演算と条件の型。配列モードは変数の型として別に保持する。 */
export type NumericKernelScalarType = "i32" | "f32" | "bool";
/** 仮引数とローカル変数の固定型。 */
export type NumericKernelValueType = NumericKernelScalarType | "in_f32" | "out_f32";
/** 関数が返すスカラーまたは値なしの型。 */
export type NumericKernelReturnType = NumericKernelScalarType | "void";
/** 対応する数値比較。 */
export type NumericKernelComparison = "==" | "!=" | "<" | "<=" | ">" | ">=";

/** 関数内の束縛。idは仮引数、ローカル変数の順に0から割り当てる。 */
export interface NumericKernelVariable {
    /** 関数内の一意な番号。 */
    id: number;
    /** 診断・表示用のPython名。 */
    name: string;
    /** 固定型と配列の入出力モード。 */
    type: NumericKernelValueType;
}

/**
 * 型付きの式。args/operandsは左から右に評価する。
 * logicalとcompareは短絡評価し、compareの中間項は一度だけ評価する。
 * 数値の暗黙昇格はcastへ変換し、連鎖比較では各比較のoperandTypeで昇格先を示す。
 */
export type NumericKernelExpression = {
    /** 式の結果型。 */
    type: NumericKernelReturnType;
    /** 元のPython位置。C本文とハッシュから分離する。 */
    charPos: number;
} & (
    /** 数値・bool・None。数値textは精度を落とさず十進表記で保持する。 */
    { kind: "literal"; text: string }
    /** 固定スカラー変数の読取り。 */
    | { kind: "variable"; variable: NumericKernelVariable }
    /** 入力配列の1要素読取り。 */
    | { kind: "load"; array: NumericKernelVariable; index: NumericKernelExpression }
    /** 配列引数に付随する要素数。 */
    | { kind: "length"; array: NumericKernelVariable }
    /** i32からf32への変換。 */
    | { kind: "cast"; value: NumericKernelExpression }
    /** 数値の単項符号またはboolの否定。 */
    | { kind: "unary"; operator: "+" | "-" | "not"; value: NumericKernelExpression }
    /** 数値の二項演算。 */
    | { kind: "binary"; operator: "+" | "-" | "*" | "/"; left: NumericKernelExpression; right: NumericKernelExpression }
    /** boolだけを返す短絡演算。 */
    | { kind: "logical"; operator: "and" | "or"; left: NumericKernelExpression; right: NumericKernelExpression }
    /** 比較ごとの型と演算子。隣接するoperandsを比較する。 */
    | { kind: "compare"; operands: NumericKernelExpression[]; comparisons: { operator: NumericKernelComparison; operandType: "i32" | "f32" }[] }
    /** 純粋な数値組込み。各引数を一度評価してから選択する。 */
    | { kind: "builtin"; name: "abs" | "min" | "max"; args: NumericKernelExpression[] }
    /** 静的に解決したスカラーヘルパー。 */
    | { kind: "call"; name: string; args: NumericKernelExpression[] }
);

/** 構造を保った文。forのrange式は開始前に一度ずつ評価する。 */
export type NumericKernelStatement = {
    /** 元のPython位置。 */
    charPos: number;
} & (
    /** スカラーの代入。複合代入はbinaryとassignへ展開する。 */
    { kind: "assign"; target: NumericKernelVariable; value: NumericKernelExpression }
    /** 出力配列への代入。valueを評価してからindexを評価する。 */
    | { kind: "store"; array: NumericKernelVariable; index: NumericKernelExpression; value: NumericKernelExpression }
    /** 値を捨てる式文。 */
    | { kind: "expression"; value: NumericKernelExpression }
    /** if/elif/else。elifはelseBody内のifとして保持する。 */
    | { kind: "if"; condition: NumericKernelExpression; body: NumericKernelStatement[]; elseBody: NumericKernelStatement[] }
    /** 条件式を反復ごとに評価するwhile。 */
    | { kind: "while"; condition: NumericKernelExpression; body: NumericKernelStatement[] }
    /** rangeの制御値とPythonの束縛を分け、最後の反復値を保持するfor。 */
    | { kind: "for"; variable: NumericKernelVariable; start: NumericKernelExpression; stop: NumericKernelExpression; step: NumericKernelExpression; body: NumericKernelStatement[] }
    /** 内側のループへの制御移動。 */
    | { kind: "break" | "continue" }
    /** 値なし、またはスカラーのreturn。 */
    | { kind: "return"; value?: NumericKernelExpression }
);

/** 1要素分のカーネルまたは純粋なスカラーヘルパー。 */
export interface NumericKernelFunction {
    /** 静的な関数名。 */
    name: string;
    /** Python上の定義位置。 */
    charPos: number;
    /** 宣言順の仮引数。カーネルでは先頭が実行インデックス。 */
    parameters: NumericKernelVariable[];
    /** 仮引数を除く、宣言順の固定型ローカル。 */
    locals: NumericKernelVariable[];
    /** 戻り値型。 */
    returnType: NumericKernelReturnType;
    /** 型と変換を確定した関数本体。 */
    body: NumericKernelStatement[];
}

/** launchから参照するカーネル集合と、そこから到達するヘルパー。 */
export interface NumericKernelProgram {
    /** 名前のUTF-8バイト順に並べ、非0 uint16 IDを割り当てたカーネル。 */
    kernels: { id: number; fn: NumericKernelFunction }[];
    /** 名前のUTF-8バイト順に並べたヘルパー。 */
    helpers: NumericKernelFunction[];
}

/** バイトコードと登録表が使う非0 uint16 IDの上限。 */
const maxNumericKernelId = 0xFFFF;

/** Python名をロケールに依存せずUTF-8バイト列の昇順に並べる。 */
export function compareKernelNames(left: string, right: string): number {
    const encoder = new TextEncoder();
    const first = encoder.encode(left);
    const second = encoder.encode(right);
    for (let index = 0; index < Math.min(first.length, second.length); index++) {
        if (first[index] !== second[index]) {
            return first[index] - second[index];
        }
    }
    return first.length - second.length;
}

/** 解析と生成の契約が崩れた場合に、元位置付きで停止する。 */
function invalid(node: AbstractSyntaxNode, message: string): never {
    throw new SyntaxError(`数値カーネルの中間表現: ${message} (charPos=${node.charPos})`);
}

/** Pythonの解析型を数値用の型へ変換する。 */
function lowerType(type: PythonKernelType | undefined, node: AbstractSyntaxNode): NumericKernelReturnType | "in_f32" | "out_f32" {
    switch (type) {
        case "int":
            return "i32";
        case "float":
            return "f32";
        case "bool":
            return "bool";
        case "none":
            return "void";
        case "in_f32":
            return "in_f32";
        case "out_f32":
            return "out_f32";
        default:
            return invalid(node, "確定した数値型が必要です");
    }
}

/** i32からf32への昇格を明示する。他の変換は解析で解決済みとする。 */
function promote(value: NumericKernelExpression, type: NumericKernelReturnType): NumericKernelExpression {
    return value.type === "i32" && type === "f32" ? { kind: "cast", type, value, charPos: value.charPos } : value;
}

/**
 * 診断のないPythonAnalysisから、launch対象と到達するヘルパーだけを取り出す。
 * カーネルIDはUTF-8名順の1始まり。仮引数・ローカルの束縛は関数ごとの整数IDへ置き換える。
 * 構文木・解析結果とtoStringキャッシュは書き換えず、ソース位置をIR内に引き継ぐ。
 */
export function createNumericKernelIR(analysis: PythonAnalysis): NumericKernelProgram {
    if (analysis.diagnostics.length !== 0) {
        throw new SyntaxError("意味診断があるプログラムから数値カーネルを生成できません");
    }
    const checked = analysis.kernelAnalysis;
    const helperNames = new Set<string>();

    /** 解析で確定した1関数を変換する。ヘルパーへの参照もここで収集する。 */
    const lowerFunction = (fn: PythonKernelFunction): NumericKernelFunction => {
        const variables = new Map<string, NumericKernelVariable>();
        const fixedTypes = checked.locals.get(fn.node)!;
        for (const [name, type] of fixedTypes) {
            const valueType = lowerType(type, fn.node);
            if (valueType === "void") {
                invalid(fn.node, "変数には値の型が必要です");
            }
            variables.set(name, { id: variables.size, name, type: valueType });
        }
        const variable = (name: string, node: AbstractSyntaxNode): NumericKernelVariable => {
            return variables.get(name) ?? invalid(node, `束縛がありません: ${name}`);
        };
        const scalarType = (term: Term): NumericKernelReturnType => {
            const type = lowerType(checked.types.get(term), term);
            return type === "in_f32" || type === "out_f32" ? invalid(term, "スカラー式が必要です") : type;
        };
        const returnType = lowerType(fn.returnType, fn.node);
        if (returnType === "in_f32" || returnType === "out_f32") {
            invalid(fn.node, "戻り値にはスカラー型が必要です");
        }

        /** 数値式を固定型と明示変換へ展開する。 */
        const expression = (term: Term): NumericKernelExpression => {
            const charPos = term.charPos;
            const type = scalarType(term);
            if (term instanceof ConstNum) {
                return { kind: "literal", type, text: term.text.replace(/^0+(?=\d)/, ""), charPos };
            }
            if (term instanceof RefVar) {
                if (["True", "False", "None"].includes(term.name)) {
                    return { kind: "literal", type, text: term.name === "True" ? "1" : "0", charPos };
                }
                return { kind: "variable", type, variable: variable(term.name, term), charPos };
            }
            if (!(term instanceof App)) {
                return invalid(term, "解析済みの数値式が必要です");
            }
            const name = term.fncName;
            if (name === indexOpr || name === "len") {
                const array = variable((term.args[0] as RefVar).name, term);
                return name === "len" ? { kind: "length", type, array, charPos }
                    : { kind: "load", type, array, index: expression(term.args[1]), charPos };
            }
            const args = term.args.map(expression);
            if (name === "<compare>") {
                return { kind: "compare", type, operands: args, charPos,
                    comparisons: term.comparisonOperators.map((operator, index) => ({
                        operator: operator as NumericKernelComparison,
                        operandType: args[index].type === "f32" || args[index + 1].type === "f32" ? "f32" : "i32"
                    })) };
            }
            if (name === "and" || name === "or") {
                return { kind: "logical", type, operator: name, left: args[0], right: args[1], charPos };
            }
            if (name === "not" || (name === "+" || name === "-") && args.length === 1) {
                // 符号付き最小値も十進リテラルとして保持し、Cの中間int32反転を避ける。
                if (name !== "not" && args[0].kind === "literal" && type === "i32") {
                    const text = name === "+" ? args[0].text : args[0].text.startsWith("-") ? args[0].text.slice(1) : `-${args[0].text}`;
                    return { kind: "literal", type, text, charPos };
                }
                return { kind: "unary", type, operator: name as "+" | "-" | "not", value: args[0], charPos };
            }
            if (["+", "-", "*", "/"].includes(name)) {
                return { kind: "binary", type, operator: name as "+" | "-" | "*" | "/",
                    left: promote(args[0], type), right: promote(args[1], type), charPos };
            }
            if (name === "float") {
                return promote(args[0], "f32");
            }
            if (name === "abs" || name === "min" || name === "max") {
                return { kind: "builtin", type, name, args: args.map(argument => promote(argument, type)), charPos };
            }
            const helper = checked.calls.get(term) ?? invalid(term, "ヘルパーの解決情報が必要です");
            helperNames.add(helper.node.name);
            return { kind: "call", type, name: helper.node.name, charPos,
                args: args.map((argument, index) => promote(argument, lowerType(helper.parameters[index].type, term) as NumericKernelReturnType)) };
        };

        /** 文の制御構造を保ち、代入・returnの昇格を確定する。 */
        const block = (body: BlockStatement): NumericKernelStatement[] => body.statements.flatMap<NumericKernelStatement>(statement => {
            const charPos = statement.charPos;
            if (statement instanceof CallStatement) {
                const app = statement.app;
                if (app instanceof App && app.isAssignmentApp()) {
                    const target = app.args[0];
                    let value = expression(app.args[1]);
                    if (target instanceof RefVar) {
                        const binding = variable(target.name, target);
                        if (app.fncName !== "=") {
                            const left = expression(target);
                            const type = app.fncName === "/=" || left.type === "f32" || value.type === "f32" ? "f32" : "i32";
                            value = { kind: "binary", type, operator: app.fncName.slice(0, -1) as "+" | "-" | "*" | "/",
                                left: promote(left, type), right: promote(value, type), charPos };
                        }
                        return [{ kind: "assign", target: binding, value: promote(value, binding.type as NumericKernelScalarType), charPos }];
                    }
                    const item = target as App;
                    return [{ kind: "store", array: variable((item.args[0] as RefVar).name, item),
                        index: expression(item.args[1]), value: promote(value, "f32"), charPos }];
                }
                return [{ kind: "expression", value: expression(app), charPos }];
            }
            if (statement instanceof ReturnStatement) {
                return [{ kind: "return", value: statement.value === undefined || returnType === "void"
                    ? undefined : promote(expression(statement.value), returnType), charPos }];
            }
            if (statement instanceof IfStatement) {
                return [{ kind: "if", condition: expression(statement.condition), body: block(statement.ifBlock),
                    elseBody: statement.elseIf !== undefined ? block(new BlockStatement([statement.elseIf]))
                        : statement.elseBlock === undefined ? [] : block(statement.elseBlock), charPos }];
            }
            if (statement instanceof WhileStatement) {
                return [{ kind: "while", condition: expression(statement.condition), body: block(statement.block), charPos }];
            }
            if (statement instanceof ForStatement) {
                const args = (statement.list as App).args.map(expression);
                const literal = (text: string): NumericKernelExpression => ({ kind: "literal", type: "i32", text, charPos });
                return [{ kind: "for", variable: variable(statement.initializer.name, statement),
                    start: args.length === 1 ? literal("0") : args[0], stop: args.length === 1 ? args[0] : args[1],
                    step: args.length === 3 ? args[2] : literal("1"), body: block(statement.block), charPos }];
            }
            if (statement.keyword === "break" || statement.keyword === "continue") {
                return [{ kind: statement.keyword, charPos }];
            }
            if (statement.keyword === "pass") {
                return [];
            }
            return invalid(statement, "解析済みの数値文が必要です");
        });
        const parameters = fn.parameters.map(parameter => variable(parameter.name, fn.node));
        const parameterNames = new Set(fn.parameters.map(parameter => parameter.name));
        return { name: fn.node.name, charPos: fn.node.charPos, parameters, returnType,
            locals: [...variables.values()].filter(item => !parameterNames.has(item.name)), body: block(fn.node.block) };
    };

    const selected = new Map([...analysis.kernelLaunches.values()].map(launch => [launch.kernel.node.name, launch.kernel]));
    if (selected.size > maxNumericKernelId) {
        invalid(analysis.module, "カーネル数がuint16の上限を超えています");
    }
    const kernels = [...selected.keys()].sort(compareKernelNames).map((name, index) => ({ id: index + 1, fn: lowerFunction(selected.get(name)!) }));
    const helpers = new Map<string, NumericKernelFunction>();
    // lowerFunctionが新たに追加した到達先もSetの反復で処理する。
    for (const name of helperNames) {
        helpers.set(name, lowerFunction(checked.helpers.get(name)!));
    }
    return { kernels, helpers: [...helpers.keys()].sort(compareKernelNames).map(name => helpers.get(name)!) };
}
