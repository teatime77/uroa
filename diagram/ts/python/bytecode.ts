/**
 * # Python構文木からアセンブリを生成する実装方針
 *
 * この文書は[バイトコード仕様](../../../docs/diagram/python/bytecode.md)と[既存の構文木](../../../docs/diagram/python/parser.md)を基にした実装方針。2026-11-03に[bytecode.ts](./bytecode.ts)へアセンブリ生成器とバイナリ生成器を実装した。[BLE転送](../ble-wifi/bytecode-transfer.ts)とESP32の形式検証・RAM保持まで対応し、数値・分岐・関数呼出しのVMまで実装した。以下に実装した方式と後続の課題を記す。
 *
 * ## 次の実装へ渡す事項
 *
 * `bytecode.md`に本ファイルに記したCALL／RET拡張と追加命令、関数情報、未初期化値の扱いを反映した。VMはこの契約に従って実装した。
 *
 * ## 文字列定数の生成（2026-11-04）
 *
 * generateAssembly()はsyntax.tsのStrを定数として登録し、`.string ID "値"`と
 * `PUSH_STRING ID`を出力する。同じ実行時の値は関数をまたいで共有する。
 * IDは0始まりで、モジュール本体、次いで関数の定義順に命令生成した初出順。
 * 定数は最大65535個。疑似指示は.globalsの直後にID順で置き、命令PCを進めない。
 *
 * Str.textは原文なので、生成時にエスケープを解釈して値へ変換する。対応するのは
 * バックスラッシュ・両引用符、a/b/f/n/r/t/v、xの2桁・uの4桁・Uの8桁の16進表記、
 * 1〜3桁で値が0〜255の8進表記、バックスラッシュ直後のLF/CRLF/CRによる行継続。
 * 未知のエスケープ・桁数不足・Unicodeスカラー値でない文字はcharPos付きで拒否する。
 * 変換済み値をキャッシュし、構文木・Str.text・toString()のキャッシュは変更しない。
 * .stringの値は二重引用符・バックスラッシュ・制御文字・行区切りをエスケープして
 * 1行に出力する。空文字列・日本語・BMP外文字・埋め込みNULも値として保持する。
 *
 * generateBytecode()も同じ定数IDを使い、値をTextEncoderでUTF-8へ符号化する。
 * NUL終端は付けず、空文字列・埋め込みNULも明示的なバイト長で保持する。
 * UTF-16の文字数をバイト長として使わず、Unicode正規化も行わない。
 *
 * ## バイナリversion=2
 *
 * 全体は24バイトヘッダー、関数表(F個×8バイト)、命令列(Cバイト)、
 * 文字列表(S個×8バイト)、UTF-8文字列データ(Dバイト)の順。パディングなし。
 * ヘッダーは次の位置に書き、複数バイトの数値はすべてlittle endianとする。
 *
 * | バイト位置 | 型 | 内容 |
 * |---|---|---|
 * | 0 | uint16 | 識別子0xB1C0 |
 * | 2 | uint16 | バイナリversion=2 |
 * | 4 | uint16 | 大域変数数 |
 * | 6 | uint16 | 関数数F |
 * | 8 | uint32 | 命令列長C（1〜65536） |
 * | 12 | uint16 | 開始PC。0固定 |
 * | 14 | uint16 | 予約。0固定 |
 * | 16 | uint16 | 文字列定数数S（0〜65535） |
 * | 18 | uint16 | 予約。0固定 |
 * | 20 | uint32 | UTF-8データの全バイト長D |
 *
 * 関数表は位置24、命令列は24+F*8、文字列表は24+F*8+C、
 * UTF-8データは24+F*8+C+S*8から始まる。全体長は24+F*8+C+S*8+Dで128KiB以内。
 * 文字列表の各レコードは、データ先頭からの相対offset:uint32とlength:uint32。
 * ID順にデータを連続配置し、最後の末尾をDに一致させる。空文字列のlengthは0。
 * 文字列なしのプログラムもversion=2でS=D=0とする。上限超過は切り詰めずRangeError。
 *
 * PUSH_STRINGはopcode=0x19、uint16のIDを直後へ置く3バイト命令で、ID<Sを必須とする。
 * 既存の0x01〜0x18の命令番号・長さ、関数表の8バイト形式は維持する。
 * 命令PCは命令列先頭を0とし、文字列表・データの長さを分岐先・CALL先へ加算しない。
 *
 * 関係するble-wifi/bytecode-transfer.tsとESP32のbytecode_receiver.cppはversion=1・2の
 * BLE転送・検証・RAM保持に対応する。bytecode_vm.cppのversion=2実行は後続の範囲。
 * 受信完了のACKはVMの開始・正常終了を表さず、現行VMはversion=2を形式エラーにする。
 * parser.tsのf文字列（関数名f"）・@formatのアセンブリ生成と実行も後続の範囲とする。
 *
 * ### 実装時の確認方針（当時の記録）
 *
 * 実行確認時の観点は、演算の評価順、両側の分岐、whileの入れ子、仮引数への再代入、条件内で代入する局所変数、式中の関数呼出し、再帰、戻り値の破棄とスタックの増減。ユーザーの従来の指定に従い、今回テストは作成・実行せず、ビルドと静的確認のみ行う。BLE・VM・実機での実行確認とは分けて報告する。
 */
import {
    AbstractSyntaxNode, App, BlockStatement, CallStatement, ConstNum, Fn,
    IfStatement, Module, RefVar, ReturnStatement, Statement, Str, Term,
    WhileStatement, isAssignmentToken
} from "./syntax.js";

/** バイナリ形式version=2の命令番号。0x01〜0x18はversion=1と共通。 */
export enum BytecodeOpcode {
    LOAD_L = 0x01,
    LOAD_G = 0x02,
    PUSH_INT = 0x03,
    PUSH_FLOAT = 0x04,
    STORE_L = 0x05,
    STORE_G = 0x06,
    JUMP = 0x07,
    JUMP_IF_FALSE = 0x08,
    JUMP_IF_TRUE = 0x09,
    ADD = 0x0A,
    SUB = 0x0B,
    MUL = 0x0C,
    DIV = 0x0D,
    EQ = 0x0E,
    NE = 0x0F,
    LT = 0x10,
    LE = 0x11,
    GT = 0x12,
    GE = 0x13,
    CALL = 0x14,
    RET = 0x15,
    PUSH_NONE = 0x16,
    POP = 0x17,
    HALT = 0x18,
    PUSH_STRING = 0x19
}

/** バイナリヘッダーの数値識別子。文字列のマジックナンバーは使わない。 */
export const bytecodeSignature = 0xB1C0;
export const bytecodeVersion = 2;
export const bytecodeHeaderLength = 24;
export const bytecodeFunctionRecordLength = 8;
export const bytecodeStringRecordLength = 8;
export const bytecodeMaxLength = 128 * 1024;

type Opcode = keyof typeof BytecodeOpcode;

/** オペランドなしの命令は登録しない。複数バイト値は全てlittle endian。 */
const operandEncoding: Readonly<Partial<Record<Opcode, "u16" | "i32" | "f32">>> = {
    LOAD_L: "u16",
    LOAD_G: "u16",
    PUSH_INT: "i32",
    PUSH_FLOAT: "f32",
    STORE_L: "u16",
    STORE_G: "u16",
    JUMP: "u16",
    JUMP_IF_FALSE: "u16",
    JUMP_IF_TRUE: "u16",
    CALL: "u16",
    PUSH_STRING: "u16"
};

const arithmetic: Readonly<Record<string, Opcode>> = {
    "+": "ADD",
    "-": "SUB",
    "*": "MUL",
    "/": "DIV"
};

const comparisons: Readonly<Record<string, Opcode>> = {
    "==": "EQ",
    "!=": "NE",
    "<": "LT",
    "<=": "LE",
    ">": "GT",
    ">=": "GE"
};

/** 変数の番号は、大域領域または管理領域2個を含むBPからのスロット位置。 */
interface Scope {
    fn: Fn | undefined;
    block: BlockStatement;
    variables: Map<string, number>;
}

/** 関数名がundefinedならモジュール本体。ラベルのアドレス解決に使う。 */
interface SourceLocation {
    /** 元ソースのUTF-16位置。対応するノードのない自動生成命令は-1。 */
    charPos: number;
    owner: string | undefined;
}

/** 実行命令と疑似指示・ラベルを区別し、アセンブリ文字列への依存を避ける。
 *
 * @remarks
 * 命令は内部では「命令名・オペランド・元の`charPos`」として保持する。これにより、後から同じ命令列へアドレス解決とバイナリ出力を追加できる。構文木の`toString()`やキャッシュは変更しない。
 */
type AssemblyEntry = SourceLocation & (
    { kind: "instruction"; opcode: Opcode; operand: string | undefined }
    | { kind: "label"; name: string }
    | { kind: "globals"; count: number }
    | { kind: "function"; name: string; args: number; locals: number }
);

type InstructionEntry = Extract<AssemblyEntry, { kind: "instruction" }>;
type FunctionEntry = Extract<AssemblyEntry, { kind: "function" }>;

/** 名前はコンパイル時だけ保持し、バイナリには数値のPCだけを書き込む。 */
interface LabelAddress {
    pc: number;
    owner: string | undefined;
}

/** 元の構文木を変更せず、名前の収集・検査と命令生成を順に行う。
 *
 * @remarks
 * ## 今回の範囲
 *
 * `parsePython()`が返す`Module`を入力に、変数名とラベルを使ったアセンブラソースを出力する。対象は変数への代入、四則演算、単独の比較、`if`／`elif`／`else`、`while`、関数定義・位置引数による呼出し・`return`。`pass`は命令を出さず、`break`／`continue`は所属するwhileのラベルへの分岐にする。
 *
 * 通常文字列はアセンブリとバイナリの生成に対応する。`for`、構造体・クラス、属性・添字、f文字列・コンテナ、import、クロージャ、関数を値として扱う処理は後回しにする。論理演算・連鎖比較や仕様にない演算子も拒否する。パーサーが受理しても生成対象外のノードには`charPos`付きのエラーを出し、黙って読み飛ばさない。
 *
 * ## 処理を2段階に分ける
 *
 * `diagram/ts/python/bytecode.ts`の入口は`generateAssembly(module: Module): string`と`generateBytecode(module: Module): Uint8Array`。
 *
 * 1. **事前走査**で関数表・大域変数表・関数ごとの局所変数表を作り、対応範囲、名前、引数個数を検査する。
 * 2. **命令生成**で構文木を再帰的にたどり、命令・ラベル・関数情報を配列へ追加し、最後にテキストへ整形する。
 */
class BytecodeGenerator {
    private readonly functions = new Map<string, Scope>();
    private readonly entries: AssemblyEntry[] = [];
    private readonly loops: { start: string; end: string }[] = [];
    private readonly stringValues = new Map<Str, string>();
    private readonly stringIds = new Map<string, number>();
    private labelCount = 0;
    private readonly globalScope: Scope;
    private readonly sourceLines: string[];
    private readonly lineStarts = [0];
    private scope: Scope;

    constructor(private readonly module: Module) {
        this.globalScope = { fn: undefined, block: module.block, variables: new Map() };
        this.scope = this.globalScope;
        this.sourceLines = module.source?.split(/\r\n|\r|\n/) ?? [];
        if (module.source !== undefined) {
            for (const match of module.source.matchAll(/\r\n|\r|\n/g)) {
                this.lineStarts.push(match.index + match[0].length);
            }
        }
    }

    private fail(node: AbstractSyntaxNode, message: string): never {
        throw new SyntaxError(`${message} (charPos=${node.charPos})`);
    }

    private location(node?: AbstractSyntaxNode): SourceLocation {
        return { charPos: node?.charPos ?? -1, owner: this.scope.fn?.name };
    }

    /** 先頭に連続するdefを登録し、実行するモジュール本体から分離する。 */
    private collectFunctions(): void {
        const statements: Statement[] = [];
        let executable = false;
        for (const statement of this.module.block.statements) {
            if (statement instanceof Fn) {
                if (executable) {
                    this.fail(statement, "関数定義はモジュール先頭にまとめてください");
                }
                if (this.functions.has(statement.name)) {
                    this.fail(statement, `関数が重複しています: ${statement.name}`);
                }
                const scope: Scope = { fn: statement, block: statement.block, variables: new Map() };
                for (const argument of statement.args) {
                    if (scope.variables.has(argument.name)) {
                        this.fail(argument, `仮引数が重複しています: ${argument.name}`);
                    }
                    this.addVariable(scope, argument.name, argument);
                }
                this.functions.set(statement.name, scope);
            }
            else {
                executable = true;
                statements.push(statement);
            }
        }
        this.scope.block = new BlockStatement(statements);
    }

    /** 関数内のif・whileにも同じスコープを使い、内側のdefには入らない。 */
    private walkStatements(
        block: BlockStatement,
        visit: (statement: Statement, loopDepth: number) => void,
        loopDepth = 0
    ): void {
        const walk = (statement: Statement): void => {
            visit(statement, loopDepth);
            if (statement instanceof IfStatement) {
                this.walkStatements(statement.ifBlock, visit, loopDepth);
                if (statement.elseIf !== undefined) {
                    walk(statement.elseIf);
                }
                if (statement.elseBlock !== undefined) {
                    this.walkStatements(statement.elseBlock, visit, loopDepth);
                }
            }
            else if (statement instanceof WhileStatement) {
                this.walkStatements(statement.block, visit, loopDepth + 1);
            }
        };
        for (const statement of block.statements) {
            walk(statement);
        }
    }

    private addVariable(scope: Scope, name: string, node: AbstractSyntaxNode): void {
        if (["True", "False", "None"].includes(name)) {
            this.fail(node, `予約された名前には代入できません: ${name}`);
        }
        if (!scope.variables.has(name)) {
            const slot = scope.variables.size + (scope.fn === undefined ? 0 : 2);
            if (slot > 0xFFFF) {
                this.fail(node, "変数の位置がuint16の範囲を超えています");
            }
            scope.variables.set(name, slot);
        }
    }

    private assignment(statement: CallStatement): App | undefined {
        const app = statement.app;
        return app instanceof App && isAssignmentToken(app.fncName) ? app : undefined;
    }

    /**
     * ## 変数領域と名前の解決
     *
     * 代入は`CallStatement.app`に入った`App("=", [左辺, 右辺])`で表される。左辺が`RefVar`なら、その名前を現在のスコープへ登録する。`+=`等も同じ束縛先として集め、四則の複合代入はLOAD・演算・STOREへ展開する。
     *
     * - モジュール直下の代入先は大域変数にする。直下のif・whileの内部も走査するが、関数本体には入らない。
     * - 関数では仮引数を先に登録し、続いて本体全体の代入先を初出順に登録する。if・whileの内部も含め、同じ名前は1領域にまとめる。内側の関数本体は混ぜない。
     * - Pythonではブロックごとの変数領域を作らない。条件付きの代入やreturnより後にある代入も事前走査に含め、呼出し時に必要な全領域を一度に確保する。
     * - 関数内の名前参照は局所変数を優先し、それ以外は大域変数を参照する。関数内で一度でも代入する名前は、その代入より前の参照も局所変数となる。`global`／`nonlocal`は今回扱わない。
     *
     * 仮引数と、それ以外の局所変数の個数を分けて関数情報へ記録する。未代入の領域には未初期化の印を置き、LOADでエラーにするVM契約が必要。0で初期化するとPythonの未束縛変数の挙動と変わる。
     */
    private collectVariables(scope: Scope): void {
        this.walkStatements(scope.block, statement => {
            if (statement instanceof CallStatement) {
                const assignment = this.assignment(statement);
                if (assignment !== undefined) {
                    const target = assignment.args[0];
                    if (assignment.args.length !== 2 || !(target instanceof RefVar)) {
                        this.fail(assignment, "代入先は単一の変数に限ります");
                    }
                    this.addVariable(scope, target.name, target);
                }
            }
        });
    }

    private variableKind(reference: RefVar, scope: Scope): "L" | "G" {
        if (scope.fn !== undefined && scope.variables.has(reference.name)) {
            return "L";
        }
        if (this.globalScope.variables.has(reference.name)) {
            return "G";
        }
        this.fail(reference, `変数が定義されていません: ${reference.name}`);
    }

    /** -2147483648は正の子リテラルを先に検査せず、符号を含めて判定する。
     *
     * @remarks
     * `ConstNum.text`に小数点・指数表記がある場合は`PUSH_FLOAT`、整数表記なら`PUSH_INT`を選ぶ。int32の範囲と有限のfloat32への変換可否を検査する。`True`／`False`はそれぞれ整数1／0とする数値中心のサブセットとし、単項負号は0と対象の減算、単項正号は0との加算に展開する。直接数値に付いた負号は符号付きリテラルとして生成し、負の整数も符号込みで範囲を判定する。float32への丸めとアンダーフローは許可する。
     */
    private numberLiteral(term: Term): { opcode: Opcode; operand: string } | undefined {
        let number: ConstNum;
        let negative = false;
        if (term instanceof ConstNum) {
            number = term;
        }
        else if (term instanceof App && term.fncName === "-" && term.args.length === 1
            && term.args[0] instanceof ConstNum) {
            number = term.args[0];
            negative = true;
        }
        else {
            return undefined;
        }
        const operand = `${negative ? "-" : ""}${number.text}`;
        const value = Number(operand);
        if (/[.eE]/.test(number.text)) {
            if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
                this.fail(term, "数値を有限のfloat32で表現できません");
            }
            return { opcode: "PUSH_FLOAT", operand };
        }
        if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7FFFFFFF) {
            this.fail(term, "整数がint32の範囲を超えています");
        }
        return { opcode: "PUSH_INT", operand };
    }

    /** 原文を1回だけ値へ変換する。エスケープの対応範囲はファイル先頭を参照する。 */
    private stringLiteral(term: Str): string {
        const cached = this.stringValues.get(term);
        if (cached !== undefined) {
            return cached;
        }
        const escapes: Readonly<Record<string, string>> = {
            "\\": "\\", "'": "'", "\"": "\"", a: "\x07", b: "\b",
            f: "\f", n: "\n", r: "\r", t: "\t", v: "\v"
        };
        const text = term.text;
        let value = "";
        let position = 0;
        while (position < text.length) {
            if (text[position] !== "\\") {
                const codePoint = text.codePointAt(position)!;
                if (codePoint >= 0xD800 && codePoint <= 0xDFFF) {
                    this.fail(term, "文字列に単独のサロゲートは使用できません");
                }
                value += String.fromCodePoint(codePoint);
                position += codePoint > 0xFFFF ? 2 : 1;
                continue;
            }
            position++;
            if (position === text.length) {
                this.fail(term, "文字列のエスケープが完結していません");
            }
            const escape = text[position];
            position++;
            if (Object.hasOwn(escapes, escape)) {
                value += escapes[escape];
            }
            else if (escape === "\n" || escape === "\r") {
                if (escape === "\r" && text[position] === "\n") {
                    position++;
                }
            }
            else if (escape === "x" || escape === "u" || escape === "U") {
                const length = escape === "x" ? 2 : escape === "u" ? 4 : 8;
                const digits = text.slice(position, position + length);
                if (digits.length !== length || !/^[0-9A-Fa-f]+$/.test(digits)) {
                    this.fail(term, "文字列の16進エスケープの桁数または数字が不正です");
                }
                const codePoint = Number.parseInt(digits, 16);
                if (codePoint > 0x10FFFF || (codePoint >= 0xD800 && codePoint <= 0xDFFF)) {
                    this.fail(term, "文字列のエスケープがUnicodeスカラー値の範囲外です");
                }
                value += String.fromCodePoint(codePoint);
                position += length;
            }
            else if (/[0-7]/.test(escape)) {
                const start = position - 1;
                while (position - start < 3 && /[0-7]/.test(text[position] ?? "")) {
                    position++;
                }
                const codePoint = Number.parseInt(text.slice(start, position), 8);
                if (codePoint > 0xFF) {
                    this.fail(term, "文字列の8進エスケープは0〜255にしてください");
                }
                value += String.fromCodePoint(codePoint);
            }
            else {
                this.fail(term, `未対応の文字列エスケープです: \\${escape}`);
            }
        }
        this.stringValues.set(term, value);
        return value;
    }

    /** 値を共有して文字列定数IDを割り当てる。登録順は命令生成の初出順。 */
    private stringId(term: Str): number {
        const value = this.stringLiteral(term);
        const existing = this.stringIds.get(value);
        if (existing !== undefined) {
            return existing;
        }
        const id = this.stringIds.size;
        if (id >= 0xFFFF) {
            this.fail(term, "文字列定数は65535個以内にしてください");
        }
        this.stringIds.set(value, id);
        return id;
    }

    /** 対応する演算命令か、静的に解決した関数呼出しを返す。 */
    private operation(app: App, scope: Scope): Opcode {
        const name = app.fncName;
        if (name === 'f"' || name === "@format") {
            this.fail(app, "f文字列と書式指定のアセンブリ生成には対応していません");
        }
        if (app.args.length === 1 && (name === "+" || name === "-")) {
            return name === "+" ? "ADD" : "SUB";
        }
        if (app.args.length === 2 && Object.hasOwn(arithmetic, name)) {
            return arithmetic[name];
        }
        if (name === "<compare>" && app.args.length === 2
            && app.comparisonOperators.length === 1
            && Object.hasOwn(comparisons, app.comparisonOperators[0])) {
            return comparisons[app.comparisonOperators[0]];
        }
        const fn = this.functions.get(name)?.fn;
        if (fn === undefined) {
            this.fail(app, `未対応の演算または未定義の関数です: ${name}`);
        }
        if (scope.variables.has(name)) {
            this.fail(app, `変数を関数として呼び出せません: ${name}`);
        }
        if (fn.args.length !== app.args.length) {
            this.fail(app, `関数${name}の引数は${fn.args.length}個必要です`);
        }
        return "CALL";
    }

    private validateExpression(term: Term, scope: Scope): void {
        if (term instanceof Str) {
            this.stringLiteral(term);
            return;
        }
        if (this.numberLiteral(term) !== undefined) {
            return;
        }
        if (term instanceof RefVar) {
            if (!["True", "False", "None"].includes(term.name)) {
                this.variableKind(term, scope);
            }
            return;
        }
        if (term instanceof App) {
            this.operation(term, scope);
            for (const argument of term.args) {
                this.validateExpression(argument, scope);
            }
            return;
        }
        this.fail(term, "この式のアセンブリ生成には対応していません");
    }

    private validateScope(scope: Scope): void {
        // 全関数・全変数を集めた後で、相互再帰や前方の大域参照も解決する。
        this.walkStatements(scope.block, (statement, loopDepth) => {
            if (statement instanceof CallStatement) {
                const assignment = this.assignment(statement);
                if (assignment === undefined) {
                    this.validateExpression(statement.app, scope);
                }
                else {
                    if (assignment.fncName !== "="
                        && !["+=", "-=", "*=", "/="].includes(assignment.fncName)) {
                        this.fail(assignment, `未対応の複合代入です: ${assignment.fncName}`);
                    }
                    this.validateExpression(assignment.args[1], scope);
                }
            }
            else if (statement instanceof IfStatement || statement instanceof WhileStatement) {
                this.validateExpression(statement.condition, scope);
            }
            else if (statement instanceof ReturnStatement) {
                if (scope.fn === undefined) {
                    this.fail(statement, "returnは関数内でのみ使えます");
                }
                if (statement.value !== undefined) {
                    this.validateExpression(statement.value, scope);
                }
            }
            else if (statement.keyword === "break" || statement.keyword === "continue") {
                if (loopDepth === 0) {
                    this.fail(statement, `${statement.keyword}はwhile内でのみ使えます`);
                }
            }
            else if (statement.keyword !== "pass") {
                this.fail(statement, "この文のアセンブリ生成には対応していません");
            }
        });
    }

    private emit(opcode: Opcode, node?: AbstractSyntaxNode, operand?: string): void {
        this.entries.push({ kind: "instruction", opcode, operand, ...this.location(node) });
    }

    private label(name: string, node: AbstractSyntaxNode): void {
        this.entries.push({ kind: "label", name, ...this.location(node) });
    }

    private newLabel(prefix: string): string {
        // $はPythonの識別子に使えないので、ユーザーの関数名と衝突しない。
        return `$${prefix}_${this.labelCount++}`;
    }

    /**
     * ## 式と文の生成
     *
     * 式は評価結果を必ず1個スタックに残し、文は一時的な値を残さない。二項演算は左、右の順に生成し、演算命令を置く。VMは右辺を先にpopし、次に左辺をpopして`左辺 op 右辺`を計算する。
     *
     * 関数内の`a * (b + c)`は次のようになる。
     *
     * ```asm
     * LOAD_L a
     * LOAD_L b
     * LOAD_L c
     * ADD
     * MUL
     * ```
     *
     * ## 関数呼出しとスタックフレーム
     *
     * 初期仕様のCALLは戻り先PCのpush、RETはPCのpopだけを行うため、旧ベースポインタの復元、局所変数の解放、戻り値をトップへ残す処理が不足していた。**CALL／RETに以下のフレーム管理を含める契約**をバイトコード仕様へ反映した。実際のスタック操作はESP32のVMが行い、今回の生成器はそのための命令と関数情報を出力する。
     *
     * CALL前に引数を左から右へ評価して積む。CALLは関数情報を使い、次のフレームを作る。各位置は値スタックのスロット単位とする。
     *
     * | BPからの位置 | 内容 |
     * |---|---|
     * | 0 | CALLの次の命令を指す戻り先PC |
     * | 1 | 呼出し元のBP |
     * | 2以降 | 仮引数、続いて追加の局所変数 |
     * | 固定領域の後 | 式評価用の一時スタック |
     *
     * CALLは積まれた引数の前に管理領域2個を挿入し、BPをその先頭へ設定する。局所変数表のスロット番号は、この管理領域も含めて割り当てる。呼出しより前の式の一時値はフレームの下に保存されるため、`a + f(b)`や再帰呼出しにも対応できる。
     */
    private expression(term: Term): void {
        const literal = this.numberLiteral(term);
        if (literal !== undefined) {
            this.emit(literal.opcode, term, literal.operand);
        }
        else if (term instanceof Str) {
            this.emit("PUSH_STRING", term, String(this.stringId(term)));
        }
        else if (term instanceof RefVar) {
            if (term.name === "None") {
                this.emit("PUSH_NONE", term);
            }
            else if (term.name === "True" || term.name === "False") {
                this.emit("PUSH_INT", term, term.name === "True" ? "1" : "0");
            }
            else {
                this.emit(`LOAD_${this.variableKind(term, this.scope)}`, term, term.name);
            }
        }
        else if (term instanceof App) {
            const opcode = this.operation(term, this.scope);
            const unary = term.args.length === 1 && (term.fncName === "+" || term.fncName === "-");
            if (unary) {
                this.emit("PUSH_INT", term, "0");
            }
            for (const argument of term.args) {
                this.expression(argument);
            }
            this.emit(opcode, term, opcode === "CALL" ? term.fncName : undefined);
        }
        else {
            this.fail(term, "この式のアセンブリ生成には対応していません");
        }
    }

    private block(block: BlockStatement): void {
        for (const statement of block.statements) {
            this.statement(statement);
        }
    }

    /**
     * `x = 式`は右辺を生成して`STORE_L x`または`STORE_G x`。比較は通常の二項`App`ではなく`App("<compare>")`なので、`comparisonOperators`が1個の場合に`EQ`／`NE`／`LT`／`LE`／`GT`／`GE`へ変換する。
     *
     * ifは条件を生成して`JUMP_IF_FALSE`、必要なら末尾から共通の終了ラベルへ`JUMP`する。elifは偽側に次のifを生成する。whileは次の形にする。
     *
     * ```asm
     * while_test_0:
     *     ; 条件の生成
     *     JUMP_IF_FALSE while_end_0
     *     ; 本体の生成
     *     JUMP while_test_0
     * while_end_0:
     * ```
     *
     * ラベルは生成器内で一意にし、Pythonの関数名との衝突を避けるため実際の生成名は`$while_test_0`等とする。命令・ラベルには所属関数の情報も保持する。ループの開始・終了ラベルを生成器のスタックへ積むことで、入れ子の`break`／`continue`を解決する。
     *
     * `return 式`では式を生成してRETを出す。RETはトップの戻り値を一時退避し、PC・旧BPを読み、SPを現在のBPまで戻して引数・局所変数・管理領域をまとめて解放する。その後BP・PCを復元し、呼出し元のスタックへ戻り値を1個pushする。
     *
     * 関数呼出しを式文として使う場合は戻り値を捨てる。全経路でreturnしない関数と値のないreturnはNoneを返す。このため、次の命令も仕様へ追加した。
     *
     * | 命令 | 用途 |
     * |---|---|
     * | `POP` | 式文の結果を1個捨てる |
     * | `PUSH_NONE` | Noneを1個積む。値のないreturn・関数末尾・Noneリテラルに使う |
     * | `HALT` | モジュール本体の終了。後ろに置いた関数本体への流入を防ぐ |
     */
    private statement(statement: Statement): void {
        if (statement instanceof CallStatement) {
            const assignment = this.assignment(statement);
            if (assignment === undefined) {
                this.expression(statement.app);
                this.emit("POP", statement);
            }
            else {
                const target = assignment.args[0] as RefVar;
                const kind = this.variableKind(target, this.scope);
                if (assignment.fncName !== "=") {
                    this.emit(`LOAD_${kind}`, target, target.name);
                }
                this.expression(assignment.args[1]);
                if (assignment.fncName !== "=") {
                    this.emit(arithmetic[assignment.fncName[0]], assignment);
                }
                this.emit(`STORE_${kind}`, target, target.name);
            }
        }
        else if (statement instanceof IfStatement) {
            const otherwise = this.newLabel("if_else");
            const end = this.newLabel("if_end");
            this.expression(statement.condition);
            this.emit("JUMP_IF_FALSE", statement, otherwise);
            this.block(statement.ifBlock);
            this.emit("JUMP", statement, end);
            this.label(otherwise, statement);
            if (statement.elseIf !== undefined) {
                this.statement(statement.elseIf);
            }
            if (statement.elseBlock !== undefined) {
                this.block(statement.elseBlock);
            }
            this.label(end, statement);
        }
        else if (statement instanceof WhileStatement) {
            const start = this.newLabel("while_test");
            const end = this.newLabel("while_end");
            this.label(start, statement);
            this.expression(statement.condition);
            this.emit("JUMP_IF_FALSE", statement, end);
            this.loops.push({ start, end });
            this.block(statement.block);
            this.loops.pop();
            this.emit("JUMP", statement, start);
            this.label(end, statement);
        }
        else if (statement instanceof ReturnStatement) {
            if (statement.value === undefined) {
                this.emit("PUSH_NONE", statement);
            }
            else {
                this.expression(statement.value);
            }
            this.emit("RET", statement);
        }
        else if (statement.keyword === "break" || statement.keyword === "continue") {
            const loop = this.loops[this.loops.length - 1];
            this.emit("JUMP", statement, statement.keyword === "break" ? loop.end : loop.start);
        }
        else if (statement.keyword !== "pass") {
            this.fail(statement, "この文のアセンブリ生成には対応していません");
        }
    }

    private format(entry: AssemblyEntry): string {
        switch (entry.kind) {
            case "instruction":
                return entry.operand === undefined ? entry.opcode : `${entry.opcode} ${entry.operand}`;
            case "label":
                return `${entry.name}:`;
            case "globals":
                return `.globals ${entry.count}`;
            case "function":
                return `.function ${entry.name} ${entry.args} ${entry.locals}`;
        }
    }

    /** charPosを元ソースの行番号（0始まり）へ変換する。自動生成は-1。 */
    private sourceLine(charPos: number): number {
        if (charPos < 0) {
            return -1;
        }
        let low = 0;
        let high = this.lineStarts.length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (this.lineStarts[middle] <= charPos) {
                low = middle + 1;
            }
            else {
                high = middle;
            }
        }
        return low - 1;
    }

    /** 同じPython行に対応する連続した命令には、先頭にだけコメントを付ける。
     *
     * @remarks
     * `parsePython()`は元のソースを`Module.source`に保持する。アセンブリ出力では命令・ラベルの`charPos`を使い、対応するPythonの行番号と原文を`;`コメントで出す。同じ行の連続命令には1つのコメントを付け、元の行を持たないHALT・暗黙returnは自動生成と表示する。元ソースがないModuleはコメントなしで生成する。
     */
    private formatAssembly(): string {
        const lines: string[] = [];
        let previousLine = -2;
        for (const entry of this.entries) {
            if (this.sourceLines.length > 0 && (entry.kind === "instruction" || entry.kind === "label")) {
                const line = this.sourceLine(entry.charPos);
                if (line !== previousLine) {
                    lines.push(line < 0 ? "; 自動生成" : `; ${line + 1}: ${this.sourceLines[line]}`);
                    previousLine = line;
                }
            }
            lines.push(this.format(entry));
            if (entry.kind === "globals") {
                for (const [value, id] of this.stringIds) {
                    // JSONの引用で値を表示し、改行として扱われる文字と追加の制御文字も保護する。
                    const quoted = JSON.stringify(value).replace(/[\x7f-\x9f\u2028\u2029]/g,
                        ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
                    lines.push(`.string ${id} ${quoted}`);
                }
            }
        }
        return `${lines.join("\n")}\n`;
    }

    /** アセンブリとバイナリで共通の命令列・変数表・関数表を作る。
     *
     * @remarks
     * 関数情報に「入口ラベル・仮引数個数・追加の局所変数個数」を持たせる。アセンブリでは疑似指示`.function f 2 1`のように出力する。この例は引数2個・追加の局所変数1個を示し、VMの実行命令ではない。大域変数の個数も`.globals 個数`で記録する。
     *
     * 関数定義は最初の実装ではモジュール先頭にまとめた無条件のdefに限定し、そこから関数表を作る。重複定義、変数と関数の同名使用、入れ子・条件内・実行文の後のdefは生成エラーにする。この制約により、実行中の関数名の束縛変更を扱わずに、再帰・関数間の呼出しを静的に解決できる。関数本体はモジュール本体とHALTの後へ配置する。
     */
    private compile(): void {
        this.collectFunctions();
        const globalScope = this.scope;
        const scopes = [globalScope, ...this.functions.values()];
        for (const scope of scopes) {
            this.collectVariables(scope);
        }
        for (const scope of scopes) {
            for (const name of scope.variables.keys()) {
                if (this.functions.has(name)) {
                    this.fail(scope.fn ?? this.module, `変数と関数に同じ名前は使えません: ${name}`);
                }
            }
            this.validateScope(scope);
        }

        this.entries.push({ kind: "globals", count: globalScope.variables.size, ...this.location() });
        for (const scope of this.functions.values()) {
            const fn = scope.fn!;
            this.entries.push({
                kind: "function", name: fn.name, args: fn.args.length,
                locals: scope.variables.size - fn.args.length, charPos: fn.charPos, owner: fn.name
            });
        }
        this.block(globalScope.block);
        this.emit("HALT");
        for (const scope of this.functions.values()) {
            const fn = scope.fn!;
            this.scope = scope;
            this.label(fn.name, fn);
            this.block(scope.block);
            // 末尾まで到達したときも必ず戻り値を1個返す。
            this.emit("PUSH_NONE");
            this.emit("RET");
        }
    }

    private instructionLength(entry: InstructionEntry): number {
        const encoding = operandEncoding[entry.opcode];
        if (encoding === undefined) {
            return 1;
        }
        return encoding === "u16" ? 3 : 5;
    }

    private binaryError(location: SourceLocation, message: string): never {
        throw new RangeError(`${message} (charPos=${location.charPos})`);
    }

    private uint16(value: number, location: SourceLocation, description: string): number {
        if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) {
            this.binaryError(location, `${description}がuint16の範囲を超えています: ${value}`);
        }
        return value;
    }

    private labelAddress(
        name: string | undefined,
        labels: ReadonlyMap<string, LabelAddress>,
        location: SourceLocation
    ): LabelAddress {
        const address = name === undefined ? undefined : labels.get(name);
        if (address === undefined) {
            this.binaryError(location, `命令アドレスを解決できません: ${name}`);
        }
        return address;
    }

    /** 変数名・関数名・分岐ラベル・文字列定数IDをuint16オペランドへ解決する。
     *
     * @remarks
     * アセンブリでは`LOAD_L a`等の名前を残す。内部の変数表にはスロット番号も保持し、バイナリ生成時にuint16のオペランドへ変換する。
     */
    private addressOperand(entry: InstructionEntry, labels: ReadonlyMap<string, LabelAddress>): number {
        const name = entry.operand;
        let value: number | undefined;
        switch (entry.opcode) {
            case "PUSH_STRING":
                value = name === undefined ? undefined : Number(name);
                if (value === undefined || !Number.isInteger(value) || value < 0 || value >= this.stringIds.size) {
                    this.binaryError(entry, "文字列定数IDが範囲外です");
                }
                break;
            case "LOAD_G":
            case "STORE_G":
                value = name === undefined ? undefined : this.globalScope.variables.get(name);
                break;
            case "LOAD_L":
            case "STORE_L": {
                const scope = entry.owner === undefined ? undefined : this.functions.get(entry.owner);
                value = name === undefined ? undefined : scope?.variables.get(name);
                break;
            }
            case "CALL":
                if (name === undefined || !this.functions.has(name)) {
                    this.binaryError(entry, "CALL先の関数情報がありません");
                }
                value = this.labelAddress(name, labels, entry).pc;
                break;
            case "JUMP":
            case "JUMP_IF_FALSE":
            case "JUMP_IF_TRUE": {
                const target = this.labelAddress(name, labels, entry);
                if (target.owner !== entry.owner) {
                    this.binaryError(entry, "所属関数の外へは分岐できません");
                }
                const base = entry.owner === undefined ? 0 : this.labelAddress(entry.owner, labels, entry).pc;
                value = target.pc - base;
                break;
            }
        }
        if (value === undefined) {
            this.binaryError(entry, `オペランドを解決できません: ${name}`);
        }
        return this.uint16(value, entry, "オペランド");
    }

    /** PCを解決し、固定長ヘッダー・関数表・実行命令・UTF-8文字列定数を書き込む。
     *
     * @remarks
     * 初期仕様の「関数内ラベルはBPからの相対位置」はデータスタックのBPと命令アドレスが混在するため、分岐先を「関数先頭PCからのオフセット」、CALL先を「命令列先頭からの絶対PC」として区別した。バイナリ化では、1回目に命令長から全ラベルのPCを求め、2回目に変数スロット・分岐先・CALL先を数値化して書き込む。命令アドレスはバイト単位とし、ヘッダー・関数表を除いた命令列の先頭を0とする。
     *
     * バイナリversion=2の配置・ヘッダー・文字列表の形式は本ファイル先頭を参照する。
     * 命令列は最大65536バイト、全体は128KiB以内とし、範囲超過で切り詰めない。
     * 変数名・関数名・ラベル名・原文・コメントは書き込まない。
     */
    private encodeBinary(): Uint8Array {
        const labels = new Map<string, LabelAddress>();
        const functions: FunctionEntry[] = [];
        const moduleLocation = this.location(this.module);
        let codeLength = 0;
        for (const entry of this.entries) {
            if (entry.kind === "instruction") {
                codeLength += this.instructionLength(entry);
                if (codeLength > 0x10000) {
                    this.binaryError(entry, "命令列は65536バイト以内にしてください");
                }
            }
            else if (entry.kind === "label") {
                labels.set(entry.name, { pc: codeLength, owner: entry.owner });
            }
            else if (entry.kind === "function") {
                functions.push(entry);
            }
        }

        const globals = this.uint16(this.globalScope.variables.size, moduleLocation, "大域変数の個数");
        const functionCount = this.uint16(functions.length, moduleLocation, "関数の個数");
        const stringCount = this.uint16(this.stringIds.size, moduleLocation, "文字列定数の個数");
        const codeOffset = bytecodeHeaderLength + functionCount * bytecodeFunctionRecordLength;
        const stringTableOffset = codeOffset + codeLength;
        const stringDataOffset = stringTableOffset + stringCount * bytecodeStringRecordLength;
        if (stringDataOffset > bytecodeMaxLength) {
            this.binaryError(moduleLocation, "バイトコード全体は128KiB以内にしてください");
        }
        const encoder = new TextEncoder();
        const strings: Uint8Array[] = [];
        let stringDataLength = 0;
        for (const value of this.stringIds.keys()) {
            const encoded = encoder.encode(value);
            stringDataLength += encoded.byteLength;
            if (stringDataLength > bytecodeMaxLength - stringDataOffset) {
                this.binaryError(moduleLocation, "文字列データを含むバイトコード全体は128KiB以内にしてください");
            }
            strings.push(encoded);
        }
        const bytes = new Uint8Array(stringDataOffset + stringDataLength);
        const view = new DataView(bytes.buffer);
        view.setUint16(0, bytecodeSignature, true);
        view.setUint16(2, bytecodeVersion, true);
        view.setUint16(4, globals, true);
        view.setUint16(6, functionCount, true);
        view.setUint32(8, codeLength, true);
        view.setUint16(12, 0, true);
        view.setUint16(14, 0, true);
        view.setUint16(16, stringCount, true);
        view.setUint16(18, 0, true);
        view.setUint32(20, stringDataLength, true);

        for (const [index, fn] of functions.entries()) {
            const start = this.labelAddress(fn.name, labels, fn).pc;
            const next = functions[index + 1];
            const end = next === undefined ? codeLength : this.labelAddress(next.name, labels, next).pc;
            const offset = bytecodeHeaderLength + index * bytecodeFunctionRecordLength;
            view.setUint16(offset, this.uint16(start, fn, "関数の入口PC"), true);
            view.setUint16(offset + 2, this.uint16(end - start, fn, "関数の命令列の長さ"), true);
            view.setUint16(offset + 4, this.uint16(fn.args, fn, "仮引数の個数"), true);
            view.setUint16(offset + 6, this.uint16(fn.locals, fn, "追加の局所変数の個数"), true);
        }

        let offset = codeOffset;
        for (const entry of this.entries) {
            if (entry.kind !== "instruction") {
                continue;
            }
            view.setUint8(offset, BytecodeOpcode[entry.opcode]);
            switch (operandEncoding[entry.opcode]) {
                case "u16":
                    view.setUint16(offset + 1, this.addressOperand(entry, labels), true);
                    break;
                case "i32":
                    view.setInt32(offset + 1, Number(entry.operand), true);
                    break;
                case "f32":
                    view.setFloat32(offset + 1, Number(entry.operand), true);
                    break;
            }
            offset += this.instructionLength(entry);
        }
        let dataOffset = 0;
        for (const [id, encoded] of strings.entries()) {
            const recordOffset = stringTableOffset + id * bytecodeStringRecordLength;
            view.setUint32(recordOffset, dataOffset, true);
            view.setUint32(recordOffset + 4, encoded.byteLength, true);
            bytes.set(encoded, stringDataOffset + dataOffset);
            dataOffset += encoded.byteLength;
        }
        return bytes;
    }

    generateAssembly(): string {
        this.compile();
        return this.formatAssembly();
    }

    generateBytecode(): Uint8Array {
        this.compile();
        return this.encodeBinary();
    }
}

/**
 * Python構文木を検査し、変数名・ラベルを保持したアセンブラソースを生成する。
 * @param module parsePythonが返すModule。元の木とtoStringのキャッシュは変更しない。
 * @returns 疑似指示と命令を改行で区切った文字列（末尾改行付き）。Module.sourceが
 * 設定されている場合は、対応するPythonの行番号と原文をコメントで付ける。
 * @throws SyntaxError 未対応の構文、不明な名前、引数個数・数値範囲の不一致。
 */
export function generateAssembly(module: Module): string {
    return new BytecodeGenerator(module).generateAssembly();
}

/**
 * Python構文木から、UTF-8文字列定数を含むversion=2のESP32向けバイナリを生成する。
 * @param module parsePythonが返すModule。対応範囲はgenerateAssemblyと共通。
 * @returns ヘッダー・関数情報・命令列・文字列表・UTF-8データを持つUint8Array。
 * 複数バイトの数値はlittle endian。形式の詳細はファイル先頭を参照する。
 * @throws SyntaxError 未対応の構文、不明な名前、引数個数・数値範囲・文字列エスケープの不一致。
 * @throws RangeError 命令列長、全体長、アドレス、変数数・関数数等の形式上限の超過。
 */
export function generateBytecode(module: Module): Uint8Array {
    return new BytecodeGenerator(module).generateBytecode();
}
