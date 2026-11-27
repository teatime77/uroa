/**
 * kernel-ir.tsの型付き中間表現から、ESP32・Colab・ブラウザ共通のCを生成する。
 * createNumericKernelArtifactが解析結果→IR→C→集合ハッシュ・マニフェストの入口となる。
 * parser.tsの開発用入口が成果物を表示し、環境別のビルド・登録処理が後続で利用する。
 */
import { createNumericKernelIR } from "./kernel-ir";
import type {
    NumericKernelExpression, NumericKernelFunction, NumericKernelProgram, NumericKernelReturnType,
    NumericKernelScalarType, NumericKernelStatement, NumericKernelValueType, NumericKernelVariable
} from "./kernel-ir";
import type { PythonAnalysis } from "./semantic";

/** 固定した数値実行プロファイル。最適化は各環境のビルド処理で適用する。 */
export const numericKernelProfile = "unsafe-fast-v1";
/** 成果物の契約版。バイトコードの版とは独立する。 */
export const numericKernelDesignVersion = 1;

/** 1個の公開ラッパーの登録情報。実行インデックスとnを型列から除く。 */
export interface NumericKernelEntry {
    /** UTF-8名順に割り当てた非0 uint16。 */
    id: number;
    /** Python上のカーネル名。 */
    name: string;
    /** Pythonの明示引数順の型列。配列1個を1引数として数える。 */
    argumentTypes: NumericKernelValueType[];
    /** Cの公開ラッパー名。 */
    publicName: string;
}

/** 共通Cの登録・ビルド条件。環境別の接続コードはホストで付加する。 */
export interface NumericKernelManifest {
    /** 共通成果物の契約版。 */
    designVersion: number;
    /** 数値計算のプロファイル名。 */
    profile: string;
    /** 正規化した共通Cと型列のSHA-256。小文字16進数64桁。 */
    kernelSetHash: string;
    /** ID順の公開関数と型列。 */
    kernels: NumericKernelEntry[];
    /** 計算用コンパイル単位へ適用する条件。実際のビルドは各ホストの担当。 */
    build: {
        /** ESP32とColab向けのC最適化条件。 */
        native: { language: "c"; flags: string[] };
        /** ブラウザ向けの固定ツールと計算用Wasmの最適化条件。 */
        browser: { wccCommit: string; binaryenVersion: string; optimizeLevel: number; shrinkLevel: number; fastMath: boolean };
    };
}

/** ホストへ渡す共通成果物。ソース位置はIRに保持し、Cとハッシュから分離する。 */
export interface NumericKernelArtifact {
    /** 型と制御構造を確定した中間表現。 */
    ir: NumericKernelProgram;
    /** LF改行のCソース。 */
    generatedC: string;
    /** 登録・コンパイル用メタデータ。 */
    manifest: NumericKernelManifest;
}

/** 数値型をCへ写像する。boolは0/1を保持するint32_tとして出力する。 */
function cType(type: NumericKernelReturnType): string {
    return type === "f32" ? "float" : type === "void" ? "void" : "int32_t";
}

/** Python名とC予約語の衝突を避ける、関数内の一意な識別名。 */
function variableName(variable: NumericKernelVariable): string {
    return `v${variable.id}`;
}

/** 配列引数に付随するint32の要素数。 */
function lengthName(variable: NumericKernelVariable): string {
    return `${variableName(variable)}_length`;
}

/** 配列はポインターと長さに展開し、スカラーは1引数にする。 */
function parameterDeclarations(parameters: NumericKernelVariable[]): string[] {
    return parameters.flatMap(parameter => {
        const name = variableName(parameter);
        if (parameter.type === "in_f32" || parameter.type === "out_f32") {
            return [`${parameter.type === "in_f32" ? "const " : ""}float *${name}`, `int32_t ${lengthName(parameter)}`];
        }
        return [`${cType(parameter.type)} ${name}`];
    });
}

/** カーネルIDに対応した安定した公開名。 */
function publicName(id: number): string {
    return `uroa_kernel_${id}_run`;
}

/**
 * 式を左から順に一時変数へ評価し、Cの引数評価順やマクロの多重評価から独立させる。
 * 生成する数値型はint32_t/float、入力はconst float*、出力はfloat*とする。
 * 添字・有限性・オーバーフロー・ゼロ除算の検査と停止処理は挿入しない。
 * 1要素関数と要素ループは同じC単位へ出力し、ヘルパーと要素関数をstatic inlineにする。
 */
class NumericKernelCGenerator {
    /** LFで結合する生成行。 */
    private readonly lines: string[] = [];
    /** 補助関数のPython名から内部のC名への対応。 */
    private readonly helperNames = new Map<string, string>();
    /** 現在のCブロックの深さ。 */
    private indent = 0;
    /** 関数ごとの一時変数番号。 */
    private nextTemporary = 0;

    /** 決定済みのIR順に内部関数名を割り当てる。 */
    constructor(/** 生成対象のカーネル集合。 */ private readonly program: NumericKernelProgram) {
        for (const [index, helper] of program.helpers.entries()) {
            this.helperNames.set(helper.name, `uroa_kernel_helper_${index + 1}`);
        }
    }

    /** 現在の字下げで1行を追加する。 */
    private line(text = ""): void {
        this.lines.push(text === "" ? "" : `${"    ".repeat(this.indent)}${text}`);
    }

    /** 現在位置で値を固定し、以後の評価から切り離す。 */
    private temporary(type: NumericKernelReturnType, value: string): string {
        const name = `t${this.nextTemporary++}`;
        this.line(`${cType(type)} ${name} = ${value};`);
        return name;
    }

    /** 比較ごとのi32→f32昇格を、評価済みの値に適用する。 */
    private comparisonOperand(value: string, type: NumericKernelReturnType, expected: NumericKernelScalarType): string {
        return type === "i32" && expected === "f32" ? `((float)(${value}))` : value;
    }

    /** 値を一度評価し、結果を参照するC式を返す。 */
    private expression(expression: NumericKernelExpression): string {
        switch (expression.kind) {
            case "literal":
                if (expression.type === "void") {
                    return "((void)0)";
                }
                if (expression.type === "f32") {
                    // f接尾辞で計算用リテラルを単精度に固定する。
                    const text = /[.eE]/.test(expression.text) ? expression.text : `${expression.text}.0`;
                    return `${text}f`;
                }
                return expression.type === "bool" ? expression.text : `((int32_t)(${expression.text}LL))`;
            case "variable":
                return variableName(expression.variable);
            case "length":
                return lengthName(expression.array);
            case "load": {
                const index = this.expression(expression.index);
                return this.temporary("f32", `${variableName(expression.array)}[${index}]`);
            }
            case "cast": {
                const value = this.expression(expression.value);
                return this.temporary("f32", `((float)(${value}))`);
            }
            case "unary": {
                const value = this.expression(expression.value);
                return this.temporary(expression.type, `${expression.operator === "not" ? "!" : expression.operator}(${value})`);
            }
            case "binary": {
                const left = this.expression(expression.left);
                const right = this.expression(expression.right);
                return this.temporary(expression.type, `${left} ${expression.operator} ${right}`);
            }
            case "logical": {
                const left = this.expression(expression.left);
                const result = this.temporary("bool", left);
                this.line(`if (${expression.operator === "and" ? result : `!${result}`}) {`);
                this.indent++;
                const right = this.expression(expression.right);
                this.line(`${result} = ${right};`);
                this.indent--;
                this.line("}");
                return result;
            }
            case "compare": {
                const first = this.expression(expression.operands[0]);
                const result = this.temporary("bool", "1");
                /** 前の比較が成立した場合だけ次の項を一度評価する。 */
                const compare = (index: number, previous: string): void => {
                    const next = this.expression(expression.operands[index + 1]);
                    const comparison = expression.comparisons[index];
                    const left = this.comparisonOperand(previous, expression.operands[index].type, comparison.operandType);
                    const right = this.comparisonOperand(next, expression.operands[index + 1].type, comparison.operandType);
                    this.line(`${result} = ${left} ${comparison.operator} ${right};`);
                    if (index + 1 < expression.comparisons.length) {
                        this.line(`if (${result}) {`);
                        this.indent++;
                        compare(index + 1, next);
                        this.indent--;
                        this.line("}");
                    }
                };
                compare(0, first);
                return result;
            }
            case "builtin": {
                const args = expression.args.map(argument => this.expression(argument));
                const zero = expression.type === "f32" ? "0.0f" : "0";
                const value = expression.name === "abs" ? `${args[0]} < ${zero} ? -(${args[0]}) : ${args[0]}`
                    : `${args[1]} ${expression.name === "min" ? "<" : ">"} ${args[0]} ? ${args[1]} : ${args[0]}`;
                return this.temporary(expression.type, value);
            }
            case "call": {
                const args = expression.args.map(argument => this.expression(argument));
                return this.temporary(expression.type, `${this.helperNames.get(expression.name)!}(${args.join(", ")})`);
            }
        }
    }

    /** 文列を出力する。whileの条件用一時変数は反復の内側へ置く。 */
    private block(statements: NumericKernelStatement[]): void {
        for (const statement of statements) {
            switch (statement.kind) {
                case "assign": {
                    const value = this.expression(statement.value);
                    this.line(`${variableName(statement.target)} = ${value};`);
                    break;
                }
                case "store": {
                    const value = this.expression(statement.value);
                    const index = this.expression(statement.index);
                    this.line(`${variableName(statement.array)}[${index}] = ${value};`);
                    break;
                }
                case "expression": {
                    const value = this.expression(statement.value);
                    this.line(`(void)(${value});`);
                    break;
                }
                case "if": {
                    const condition = this.expression(statement.condition);
                    this.line(`if (${condition}) {`);
                    this.indent++;
                    this.block(statement.body);
                    this.indent--;
                    this.line("}");
                    if (statement.elseBody.length !== 0) {
                        this.line("else {");
                        this.indent++;
                        this.block(statement.elseBody);
                        this.indent--;
                        this.line("}");
                    }
                    break;
                }
                case "while": {
                    this.line("while (1) {");
                    this.indent++;
                    const condition = this.expression(statement.condition);
                    this.line(`if (!(${condition})) {`);
                    this.indent++;
                    this.line("break;");
                    this.indent--;
                    this.line("}");
                    this.block(statement.body);
                    this.indent--;
                    this.line("}");
                    break;
                }
                case "for": {
                    const start = this.temporary("i32", this.expression(statement.start));
                    const stop = this.temporary("i32", this.expression(statement.stop));
                    const step = this.temporary("i32", this.expression(statement.step));
                    const cursor = `t${this.nextTemporary++}`;
                    this.line(`for (int32_t ${cursor} = ${start}; ${cursor} < ${stop}; ${cursor} += ${step}) {`);
                    this.indent++;
                    this.line(`${variableName(statement.variable)} = ${cursor};`);
                    this.block(statement.body);
                    this.indent--;
                    this.line("}");
                    break;
                }
                case "break":
                case "continue":
                    this.line(`${statement.kind};`);
                    break;
                case "return": {
                    const value = statement.value === undefined ? undefined : this.expression(statement.value);
                    this.line(value === undefined ? "return;" : `return ${value};`);
                    break;
                }
            }
        }
    }

    /** 1関数のプロトタイプまたは本体の共通宣言。 */
    private declaration(fn: NumericKernelFunction, name: string): string {
        const parameters = parameterDeclarations(fn.parameters);
        return `static inline ${cType(fn.returnType)} ${name}(${parameters.length === 0 ? "void" : parameters.join(", ")})`;
    }

    /** 固定型ローカルを関数先頭へ置き、Pythonの分岐をまたぐ束縛を保つ。 */
    private functionBody(fn: NumericKernelFunction, name: string): void {
        this.nextTemporary = 0;
        this.line(`${this.declaration(fn, name)} {`);
        this.indent++;
        for (const variable of fn.locals) {
            this.line(`${cType(variable.type as NumericKernelScalarType)} ${variableName(variable)};`);
        }
        this.block(fn.body);
        this.indent--;
        this.line("}");
        this.line();
    }

    /** 1要素関数、公開ラッパー、必要なヘルパーを同じC単位へ出力する。 */
    generate(): string {
        this.line(`/* Generated numeric kernels: ${numericKernelProfile}. */`);
        this.line("#include <stdint.h>");
        this.line();
        for (const helper of this.program.helpers) {
            this.line(`${this.declaration(helper, this.helperNames.get(helper.name)!)};`);
        }
        if (this.program.helpers.length !== 0) {
            this.line();
        }
        for (const helper of this.program.helpers) {
            this.functionBody(helper, this.helperNames.get(helper.name)!);
        }
        for (const { id, fn } of this.program.kernels) {
            const elementName = `uroa_kernel_${id}_element`;
            this.functionBody(fn, elementName);
            const parameters = fn.parameters.slice(1);
            this.line(`void ${publicName(id)}(${["int32_t n", ...parameterDeclarations(parameters)].join(", ")}) {`);
            this.indent++;
            this.line("for (int32_t i = 0; i < n; ++i) {");
            this.indent++;
            const argumentsList = parameters.flatMap(parameter => parameter.type === "in_f32" || parameter.type === "out_f32"
                ? [variableName(parameter), lengthName(parameter)] : [variableName(parameter)]);
            this.line(`${elementName}(${["i", ...argumentsList].join(", ")});`);
            this.indent--;
            this.line("}");
            this.indent--;
            this.line("}");
            this.line();
        }
        return `${this.lines.join("\n").trimEnd()}\n`;
    }
}

/** 診断のない解析から作った数値IRを共通Cへ変換する同期API。 */
export function generateNumericKernelC(program: NumericKernelProgram): string {
    return new NumericKernelCGenerator(program).generate();
}

/**
 * 共通C・IR・登録マニフェストを生成する。使用例:
 * const artifact = await createNumericKernelArtifact(await analyzePython(parsePython(source)));
 * artifact.generatedCを.cとして、JSON.stringify(artifact.manifest)を登録情報として保存できる。
 *
 * hash入力はUTF-8のJSON.stringify([1, profile, generatedC, [[id, name, argumentTypes], ...]])。
 * C本文はLF、関数順と内部名はIRの確定順とし、時刻・ソース位置・通常VM命令を含めない。
 * VM用バイトコードとホストの接続・割当てコードは後続の専用経路で生成する。
 */
export async function createNumericKernelArtifact(analysis: PythonAnalysis, signal?: AbortSignal): Promise<NumericKernelArtifact> {
    signal?.throwIfAborted();
    const ir = createNumericKernelIR(analysis);
    const generatedC = generateNumericKernelC(ir);
    const kernels = ir.kernels.map(({ id, fn }) => ({ id, name: fn.name, publicName: publicName(id),
        argumentTypes: fn.parameters.slice(1).map(parameter => parameter.type) }));
    const input = JSON.stringify([numericKernelDesignVersion, numericKernelProfile, generatedC,
        kernels.map(kernel => [kernel.id, kernel.name, kernel.argumentTypes])]);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    signal?.throwIfAborted();
    const kernelSetHash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
    return { ir, generatedC, manifest: { designVersion: numericKernelDesignVersion, profile: numericKernelProfile,
        kernelSetHash, kernels, build: {
            native: { language: "c", flags: ["-O3", "-ffast-math"] },
            browser: { wccCommit: "659a1773f20499864a8c3fdc7cd25cb506092bc1", binaryenVersion: "132.0.0",
                optimizeLevel: 3, shrinkLevel: 0, fastMath: true }
        } } };
}
