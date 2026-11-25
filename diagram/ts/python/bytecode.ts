/**
 * PythonAnalysisを入力とするversion=5専用のアセンブリ・バイナリ生成器。
 * 名前・型・変数配置はsemantic.tsを使用し、意味解析なしの旧生成経路と版1/2は扱わない。
 * 形式の仕様はencodeBinary、参照共有とCALL/RETはcompileTypedと関連メソッドを参照する。
 * BLE/Wi-Fiの形式検査はbytecode-transfer.ts、実行はESP32のbytecode_vm.cppが担当する。
 */
import {
    AbstractSyntaxNode, App, BlockStatement, CallStatement, ClassDefinition, ConstNum, Fn,
    GlobalStatement, IfStatement, Module, RefVar, ReturnStatement, Statement, Str, Term,
    WhileStatement, isAssignmentToken
} from "./syntax.js";
import { valueSlotTypes } from "./semantic.js";
import type { DeviceCallable, PythonAnalysis, PythonType } from "./semantic.js";
import type { PythonDebugBuild, PythonDebugInfo } from "./debug-info";

/**
 * opcodeは0x01〜0x25。生成・転送時のbit7は0とし、デバッガーだけが命令先頭へ設定する。
 * NEW_OBJECTは型ID、GET_FIELD/SET_FIELDは0始まりのフィールド位置をu16で指定する。
 * NEW_OBJECTは未初期化Value列の本体参照を積み、DUPで構築途中のselfを根として保持する。
 * GET_FIELDは対象を値へ置換し、SET_FIELDは右辺・対象の順の2値を取り出して格納する。
 * CALL_NUMPYはtypedNumpyのスタック規約でnumpy_native.cppを呼ぶ。GET_ITEM/SET_ITEMのu16は軸数。
 * GET_ITEMは対象→各添字、SET_ITEMは右辺→対象→各添字。ARRAY_ATTRは0=len、1=size、2=ndim、
 * 3=itemsize、4=shape[軸]で、4だけ対象の後に整数の軸番号を積む。部分配列は返さない。
 * 命令番号・長さと元イメージのCRCを維持する。通信の正本はdebug-protocol.ts。
 */
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
    PUSH_STRING = 0x19,
    CALL_NATIVE = 0x1A,
    TO_FLOAT = 0x1B,
    FORMAT_VALUE = 0x1C,
    BUILD_STRING = 0x1D,
    NEW_OBJECT = 0x1E,
    GET_FIELD = 0x1F,
    SET_FIELD = 0x20,
    DUP = 0x21,
    CALL_NUMPY = 0x22,
    GET_ITEM = 0x23,
    SET_ITEM = 0x24,
    ARRAY_ATTR = 0x25
}

/** バイナリヘッダーの数値識別子。文字列のマジックナンバーは使わない。 */
export const bytecodeSignature = 0xB1C0;
/**
 * バイナリversion=5の固定配置。呼出し規約/API schemaは4。旧版は生成しない。
 */
export const bytecodeVersion = 5;
/**
 * version=5のバイナリヘッダー長（64バイト）。
 */
export const bytecodeHeaderLength = 64;
/**
 * 本体型レコードはid:u16@0、fieldCount:u16@2、fieldOffset:u32@4、kind:u8@8、rank:u8@9、予約0:u16@10。
 * 計12バイト。kind=0は通常本体（rank=0）、1=float32配列、2=uint8配列（rank=1～4・fieldCount=0）。
 * フィールドはkind:uint8、権限:uint8（読取1・書込2）、classId:uint16の4バイト。
 * classIdは機器7／GC本体8で非0とし、GC本体の型だけ型表へ登録する。
 */
export const bytecodeTypeRecordLength = 12;
/**
 * version=5の関数表1件の長さ（12バイト）。
 */
export const bytecodeFunctionRecordLength = 12;
/**
 * 文字列定数表のoffsetとlengthが占める長さ（8バイト）。
 */
export const bytecodeStringRecordLength = 8;
/**
 * ヘッダー・各表・命令・UTF-8データを含むバイナリ全体の上限。
 */
export const bytecodeMaxLength = 128 * 1024;

/** 内部命令列とアセンブリで使う命令名。バイナリではBytecodeOpcodeの数値へ変換する。 */
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
    PUSH_STRING: "u16",
    CALL_NATIVE: "u16",
    FORMAT_VALUE: "u16",
    BUILD_STRING: "u16",
    NEW_OBJECT: "u16",
    GET_FIELD: "u16",
    SET_FIELD: "u16",
    CALL_NUMPY: "u16",
    GET_ITEM: "u16",
    SET_ITEM: "u16",
    ARRAY_ATTR: "u16"
};

/** 生成器が対応する四則演算。その他の数値演算は意味解析で受理しても生成時に拒否する。 */
const arithmetic: Readonly<Record<string, Opcode>> = {
    "+": "ADD",
    "-": "SUB",
    "*": "MUL",
    "/": "DIV"
};

/** 連鎖しない二項比較の命令対応。is・in等は生成対象に含めない。 */
const comparisons: Readonly<Record<string, Opcode>> = {
    "==": "EQ",
    "!=": "NE",
    "is": "EQ",
    "is not": "NE",
    "<": "LT",
    "<=": "LE",
    ">": "GT",
    ">=": "GE"
};

/** 変数の番号は、大域領域または管理領域2個を含むBPからのスロット位置。 */
interface Scope {
    /** クラス所属を含む一意の関数名。モジュールでは未指定。 */
    name?: string;
    /**
     * このスコープの関数定義。モジュール本体ではundefined。
     */
    fn: Fn | undefined;
    /**
     * このスコープで命令へ変換する文列。
     */
    block: BlockStatement;
}

/** 関数名がundefinedならモジュール本体。ラベルのアドレス解決に使う。 */
interface SourceLocation {
    /** 元ソースのUTF-16位置。対応するノードのない自動生成命令は-1。 */
    charPos: number;
    /**
     * この命令・ラベルが属するユーザー関数名。モジュール本体ではundefined。
     */
    owner: string | undefined;
}

/** 実行命令と疑似指示・ラベルを区別し、アセンブリ文字列への依存を避ける。
 *
 * @remarks
 * 命令は内部では「命令名・オペランド・元の`charPos`」として保持する。これにより、後から同じ命令列へアドレス解決とバイナリ出力を追加できる。構文木の`toString()`やキャッシュは変更しない。
 */
type AssemblyEntry = SourceLocation & (
    { /** この共用型の要素を区別する種別。 */ kind: "instruction"; /** 内部命令列で扱う命令名。 */ opcode: Opcode; /** 命令に付くオペランドの文字列表現。オペランドなしではundefined。 */ operand: string | undefined }
    | { /** この共用型の要素を区別する種別。 */ kind: "label"; /** 表示・保存・名前解決に使用する名前。 */ name: string }
    | { /** この共用型の要素を区別する種別。 */ kind: "globals"; /** 大域領域として確保するスロット数。一時領域を含む。 */ count: number }
    | { /** この共用型の要素を区別する種別。 */ kind: "function"; /** 表示・保存・名前解決に使用する名前。 */ name: string; /** 引数のスロット数。各引数は1スロット。 */ args: number; /** 引数と管理領域を除く、追加局所変数と一時領域のスロット数。 */ locals: number; /** 戻り値のスロット数。Noneも参照も1個を使う。 */ returns: number }
);

/** PCを進める実行命令。疑似指示とラベルは含まない。 */
type InstructionEntry = Extract<AssemblyEntry, { /** この共用型の要素を区別する種別。 */ kind: "instruction" }>;
/** 関数の引数・追加局所領域と、生成経路での戻り値の幅を表す疑似指示。 */
type FunctionEntry = Extract<AssemblyEntry, { /** この共用型の要素を区別する種別。 */ kind: "function" }>;

/** 名前はコンパイル時だけ保持し、バイナリには数値のPCだけを書き込む。 */
interface LabelAddress {
    /**
     * 命令列の先頭を0とする命令のバイト位置。
     */
    pc: number;
    /**
     * この命令・ラベルが属するユーザー関数名。モジュール本体ではundefined。
     */
    owner: string | undefined;
}

/** 値スロットの位置。recordを含め、すべての値が1スロットを占有する。 */
interface ValueAddress {
    /**
     * この共用型の要素を区別する種別。
     */
    kind: "G" | "L";
    /**
     * 大域領域またはBPを基準とする固定スロットの先頭位置。
     */
    slot: number;
    /**
     * 対象の種別またはデータ型。
     */
    type: PythonType;
}

/** 生成経路の固定スロット領域と、文ごとに再利用する一時領域の割当て状態。 */
interface SlotAllocation {
    /** 変数領域の直後。一時領域の開始位置でもある。 */
    variablesEnd: number;
    /** 現在の文で次に確保する位置。 */
    cursor: number;
    /** これまでの最大使用位置の直後。関数情報や大域領域のサイズに使う。 */
    end: number;
}

/**
 * 意味解析済みの構文木から命令列を作り、同じ配置でテキスト・バイナリを生成する。
 */
class BytecodeGenerator {
    /**
     * ユーザー関数またはAPI関数の名前と定義を管理する一覧。
     */
    private readonly functions = new Map<string, Scope>();
    /** テキスト・バイナリ・デバッグ情報が共有する内部命令列。 */
    private readonly entries: AssemblyEntry[] = [];
    /** 入れ子のwhileの分岐先。末尾が現在のbreak/continueの対象。 */
    private readonly loops: { /** 現在の繰返し条件へ戻るための内部ラベル。 */ start: string; /** 現在の繰返しから抜けるための内部ラベル。 */ end: string }[] = [];
    /** 元の文字列ノードからエスケープ解釈済みの値へのキャッシュ。 */
    private readonly stringValues = new Map<Str, string>();
    /** モジュールと全関数で共有する、文字列値から初出順のIDへの対応。 */
    private readonly stringIds = new Map<string, number>();
    /**
     * スコープごとの固定変数末尾・一時カーソル・最大使用位置。
     */
    private readonly allocations = new Map<Scope, SlotAllocation>();
    /**
     * API定義内に存在するnativeId。バイナリ化時に呼出しIDを検査する。
     */
    private readonly nativeIds = new Set<number>();
    /** 文全体の評価前を示す内部要素の位置。命令長確定後に停止PCへ変換する。 */
    private readonly statementStarts: { /** 停止候補を対応付ける内部命令列の要素位置。 */ index: number; /** 元のPythonソース内のUTF-16位置。自動生成命令では-1を使う。 */ charPos: number; /** この命令・ラベルが属するユーザー関数名。モジュール本体ではundefined。 */ owner?: string }[] = [];
    /** 行ブレークポイントにはせず、ステップ停止にだけ使う暗黙returnの内部要素の位置。 */
    private readonly implicitReturns: number[] = [];
    /**
     * ユーザー識別子と衝突しない内部ラベルの採番状態。
     */
    private labelCount = 0;
    /**
     * モジュール直下の文列と大域変数の配置を保持する生成スコープ。
     */
    private readonly globalScope: Scope;
    /**
     * アセンブリの原文コメントへ表示する元ソースの行列。
     */
    private readonly sourceLines: string[];
    /**
     * charPosを行番号へ変換する、各行先頭のUTF-16位置。
     */
    private readonly lineStarts = [0];
    /**
     * 現在命令を生成しているモジュールまたは関数のスコープ。
     */
    private scope: Scope;
    /**
     * 意味解析と同一の構文木。生成では変更しない。
     */
    private readonly module: Module;

    /**
     * 意味解析結果とその構文木から、生成用の索引と元ソースの行位置を準備する。
     * 意味診断がある結果は命令生成前に拒否し、構文木と意味解析結果は書き換えない。
     *
      * @param analysis 診断のない意味解析結果。構文木もこの結果から取得する。
      * @throws SyntaxError 意味診断が1件以上ある場合。
     */
    constructor(/** 同じ構文木に対応する、診断のない意味解析結果。 */ private readonly analysis: PythonAnalysis) {
        this.module = analysis.module;
        const module = this.module;
        // 意味解析は診断を蓄積して正常に戻るため、部分的な解析結果を命令へ変換する前に拒否する。
        // generateAssembly/generateBytecodeの両入口とBLE送信元に共通の境界。契約はsemantic.tsを参照。
        if (analysis.diagnostics.length !== 0) {
            const first = analysis.diagnostics[0];
            throw new SyntaxError(`意味解析に${analysis.diagnostics.length}件のエラーがあります: ${first.message} (charPos=${first.charPos})`);
        }
        this.globalScope = { fn: undefined, block: module.block };
        this.scope = this.globalScope;
        this.sourceLines = module.source?.split(/\r\n|\r|\n/) ?? [];
        for (const owner of analysis.api.classes) {
            if (owner.constructor !== null) {
                this.nativeIds.add(owner.constructor.nativeId);
            }
            for (const method of owner.methods) {
                this.nativeIds.add(method.nativeId);
            }
        }
        for (const fn of analysis.api.functions) {
            this.nativeIds.add(fn.nativeId);
        }
        if (module.source !== undefined) {
            for (const match of module.source.matchAll(/\r\n|\r|\n/g)) {
                this.lineStarts.push(match.index + match[0].length);
            }
        }
    }

    /**
     * 生成エラーを元ソースの位置付きで報告する。
     *
     * @param node 問題に対応する構文木のノード。
     * @param message エラーの説明。
     * @throws SyntaxError charPosを含む生成エラー。
     */
    private fail(node: AbstractSyntaxNode, message: string): never {
        throw new SyntaxError(`${message} (charPos=${node.charPos})`);
    }

    /**
     * 現在の所属関数と元ソースの位置を内部命令用にまとめる。
     *
     * @param node 位置を取得するノード。省略時は自動生成命令として扱う。
     * @returns UTF-16位置と所属関数名。自動生成の位置は-1、モジュールの所属はundefined。
     */
    private location(node?: AbstractSyntaxNode): SourceLocation {
        return { charPos: node?.charPos ?? -1, owner: this.scope.name };
    }

    /**
     * 意味解析で検証済みの関数とモジュール本体を生成用スコープへ分ける。
     */
    private collectFunctions(): void {
        this.globalScope.block = new BlockStatement(this.module.block.statements.filter(statement =>
            !(statement instanceof Fn) && !(statement instanceof ClassDefinition) && statement.keyword !== "import"));
        for (const fn of this.analysis.functions.values()) {
            this.functions.set(fn.name, { name: fn.name, fn: fn.node, block: fn.node.block });
        }
    }



    /**
     * 文に含まれる単純代入・複合代入の式を取り出す。
     *
     * @param statement 代入かどうかを調べる呼出し文。
     * @returns 代入式。代入でなければundefined。
     */
    private assignment(statement: CallStatement): App | undefined {
        const app = statement.app;
        return app instanceof App && isAssignmentToken(app.fncName) ? app : undefined;
    }



    /**
     * -2147483648は正の子リテラルを先に検査せず、符号を含めて判定する。
     *
     * @remarks
     * `ConstNum.text`に小数点・指数表記がある場合は`PUSH_FLOAT`、整数表記なら`PUSH_INT`を選ぶ。int32の範囲と有限のfloat32への変換可否を検査する。`True`／`False`はそれぞれ整数1／0とする数値中心のサブセットとし、単項負号は0と対象の減算、単項正号は0との加算に展開する。直接数値に付いた負号は符号付きリテラルとして生成し、負の整数も符号込みで範囲を判定する。float32への丸めとアンダーフローは許可する。
     *
     * @param term 数値リテラル、または数値に直接付いた単項負号の式。
     * @returns PUSH命令と符号を含むオペランド。該当する数値でなければundefined。
     * @throws SyntaxError int32または有限float32の範囲を超える場合。
     */
    private numberLiteral(term: Term): { /** 内部命令列で扱う命令名。 */ opcode: Opcode; /** 命令に付くオペランドの文字列表現。オペランドなしではundefined。 */ operand: string } | undefined {
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

    /**
     * 原文を1回だけ値へ変換し、結果をキャッシュする。構文木とStr.textは変更しない。
     *
     * Str.textは原文なので、生成時にエスケープを解釈して値へ変換する。対応するのは
     * バックスラッシュ・両引用符、a/b/f/n/r/t/v、xの2桁・uの4桁・Uの8桁の16進表記、
     * 1〜3桁で値が0〜255の8進表記、バックスラッシュ直後のLF/CRLF/CRによる行継続。
     * 未知のエスケープ・桁数不足・Unicodeスカラー値でない文字はcharPos付きで拒否する。
     * 変換済み値をキャッシュし、構文木・Str.text・toString()のキャッシュは変更しない。
     * .stringの値は二重引用符・バックスラッシュ・制御文字・行区切りをエスケープして
     * 1行に出力する。空文字列・日本語・BMP外文字・埋め込みNULも値として保持する。
     *
     * @param term 引用符を除いた原文を保持する文字列ノード。
     * @returns エスケープを解釈した文字列値。
     * @throws SyntaxError 不正なエスケープやUnicode文字を含む場合。
     */
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

    /**
     * 値を共有して文字列定数IDを割り当てる。登録順は命令生成の初出順。
     *
     * ## 文字列定数の生成（2026-11-04）
     *
     * generateAssembly()はsyntax.tsのStrを定数として登録し、`.string ID "値"`と
     * `PUSH_STRING ID`を出力する。同じ実行時の値は関数をまたいで共有する。
     * IDは0始まりで、モジュール本体、次いで関数の定義順に命令生成した初出順。
     * 定数は最大65535個。疑似指示は.globalsの直後にID順で置き、命令PCを進めない。
     *
     * @param term 実行時の値へ変換して登録する文字列ノード。
     * @returns 同じ値では共有する、0始まりの文字列定数ID。
     * @throws SyntaxError 文字列値が不正、または定数数が65535を超える場合。
     */
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

    /**
     * 数値の四則・単独比較に対応する演算命令を返す。呼出しはtypedCallが担当する。
     *
     * @param app 四則・単独比較の式。
     * @returns 対応する演算命令。
     * @throws SyntaxError 未対応の演算。
     */
    private operation(app: App): Opcode {
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
        this.fail(app, `未対応の演算です: ${name}`);
    }



    /**
     * 実行命令に元ソースの位置と所属関数を付け、内部命令列へ追加する。
     *
     * @param opcode 生成する命令名。
     * @param node 対応ノード。自動生成命令では省略する。
     * @param operand オペランドの文字列表現。オペランドなしの命令では省略する。
     */
    private emit(opcode: Opcode, node?: AbstractSyntaxNode, operand?: string): void {
        this.entries.push({ kind: "instruction", opcode, operand, ...this.location(node) });
    }

    /**
     * PC解決用のラベルを追加する。ラベル自体は命令列のバイト数を増やさない。
     *
     * @param name 生成器内で一意なラベル名。
     * @param node 元ソースの位置を対応付けるノード。
     */
    private label(name: string, node: AbstractSyntaxNode): void {
        this.entries.push({ kind: "label", name, ...this.location(node) });
    }

    /**
     * ユーザーの関数名と衝突しない一意のラベル名を作る。
     *
     * @param prefix if・while等の用途を識別する接頭辞。
     * @returns $と連番を含む生成ラベル名。
     */
    private newLabel(prefix: string): string {
        // $はPythonの識別子に使えないので、ユーザーの関数名と衝突しない。
        return `$${prefix}_${this.labelCount++}`;
    }

    /**
     * 型・束縛が確定した式を生成する。
     * @param term 対象の式。
     */
    private expression(term: Term): void {
        this.typedExpression(term);
    }

    /**
     * 意味解析の式と型の対応表から、生成対象の型を取得する。
     *
     * @param term 型を取得する式。
     * @returns 解決済みの型。
     * @throws SyntaxError 式の型が意味解析結果にない場合。
     */
    private valueType(term: Term): PythonType {
        const type = this.analysis.types.get(term);
        if (type === undefined) {
            this.fail(term, "式の型がありません。アセンブリ生成前に意味解析してください");
        }
        return type;
    }

    /**
     * semantic.tsと共通の配置規則で値のスロット幅を求める。
     *
     * @param type 幅を求める型。本体も参照1スロットとして配置する。
     * @returns 値が占有するスロット数。
     */
    private valueWidth(type: PythonType): number {
        return valueSlotTypes(type, this.analysis.api).length;
    }

    /**
     * すべてをpushしてから逆順にpopするため、コピー元と先が重なっても値を壊さない。
     *
     * @param address 読み出す値の先頭スロットと型。先頭から順に全スロットを積む。
     * @param node LOAD命令へ対応付ける元ソースのノード。
     */
    private loadValue(address: ValueAddress, node: AbstractSyntaxNode): void {
        for (let index = 0; index < this.valueWidth(address.type); index++) {
            this.emit(`LOAD_${address.kind}`, node, String(address.slot + index));
        }
    }

    /**
     * スタック上の値を末尾スロットから逆順に格納する。
     * loadValueで全体を積んだ後に格納するため、コピー元と先が重なっても値を壊さない。
     *
     * @param address 格納先の先頭スロットと型。
     * @param node STORE命令へ対応付ける元ソースのノード。
     */
    private storeValue(address: ValueAddress, node: AbstractSyntaxNode): void {
        for (let index = this.valueWidth(address.type) - 1; index >= 0; index--) {
            this.emit(`STORE_${address.kind}`, node, String(address.slot + index));
        }
    }

    /**
     * 型の幅に応じた一時領域を確保し、現在のスコープに必要な最大幅を更新する。
     * カーソルはstatementで文ごとに変数領域の末尾へ戻し、領域を再利用する。
     *
     * @param type 保存する値の型。
     * @param node スロット数が65535を超える場合の診断位置。
     * @returns 確保した大域または局所の固定スロット位置。
     */
    private temporary(type: PythonType, node: AbstractSyntaxNode): ValueAddress {
        const allocation = this.allocations.get(this.scope)!;
        const slot = allocation.cursor;
        allocation.cursor += this.valueWidth(type);
        allocation.end = Math.max(allocation.end, allocation.cursor);
        if (allocation.end > 65535) {
            this.fail(node, "一時領域を含むスロット数が65535を超えています");
        }
        return { kind: this.scope.fn === undefined ? "G" : "L", slot, type };
    }

    /**
     * 変数の固定スロットを取得する。属性はGET_FIELD/SET_FIELDで扱い、固定スロットへ展開しない。
     * @param term 変数参照。
     * @returns 値の先頭スロットと型。
     */
    private address(term: Term): ValueAddress {
        if (term instanceof RefVar) {
            const binding = this.analysis.references.get(term);
            if (binding?.kind !== "variable") {
                this.fail(term, "この名前の格納位置を取得できません");
            }
            const variable = binding.variable;
            const address: ValueAddress = { kind: variable.scope === "global" ? "G" : "L",
                slot: variable.slot, type: variable.type! };
            return address;
        }
        this.fail(term, "固定スロットは変数だけに対応します");
    }

    /**
     * 型がfloatへ統合された変数・仮引数・戻り値にも、整数値をそのまま格納しない。
     *
     * @param term 評価する式。
     * @param expected 代入先・仮引数・戻り値の要求型。intからfloatの場合だけTO_FLOATを追加する。
     */
    private expressionAs(term: Term, expected: PythonType): void {
        this.expression(term);
        if (this.valueType(term).kind === "int" && expected.kind === "float") {
            this.emit("TO_FLOAT", term);
        }
    }

    /**
     * ソース順に引数を評価し、shape・指定済みoptionId/値だけをC++へ渡す。
     * CALL_NUMPYのu16は戻り値型ID。スタックは各軸、optionId/値の組、組数、モジュール関数IDの順。
     * 省略引数を追加しない。dtypeコードは0=None・1=float32・2=uint8で、既定値はC++が設定する。
     * 一時値を最後に積み直してから根を解除し、入れ子の呼出しでも評価順と生存を保つ。
     * @param app 意味解析で数値NumPy呼出しとして解決済みの式。
     */
    private typedNumpy(app: App): void {
        const call = this.analysis.numpyCalls.get(app)!;
        const dimensions: ValueAddress[] = [];
        const options: {
            /** 共通宣言の引数番号。 */
            id: number;
            /** 評価済み値の位置。 */
            address: ValueAddress;
        }[] = [];
        for (const { parameter, value } of call.binding.arguments) {
            if (parameter.name === "shape") {
                for (const dimension of call.shape) {
                    const address = this.temporary({ kind: "int" }, dimension);
                    this.expression(dimension);
                    this.storeValue(address, dimension);
                    dimensions.push(address);
                }
            }
            else {
                const dtype = parameter.name === "dtype";
                const address = this.temporary(dtype ? { kind: "int" } : this.valueType(value), value);
                if (dtype) {
                    this.emit("PUSH_INT", value, String(call.dtypeCode));
                }
                else {
                    this.expression(value);
                }
                this.storeValue(address, value);
                options.push({ id: parameter.optionId!, address });
            }
        }
        for (const address of dimensions) {
            this.loadValue(address, app);
        }
        for (const option of options) {
            this.emit("PUSH_INT", app, String(option.id));
            this.loadValue(option.address, app);
        }
        this.emit("PUSH_INT", app, String(options.length));
        this.emit("PUSH_INT", app, String(call.binding.definition.id));
        for (const address of [...dimensions, ...options.map(option => option.address)]) {
            this.emit("PUSH_NONE", app);
            this.storeValue(address, app);
        }
        this.emit("CALL_NUMPY", app, String(call.owner.id));
    }

    /**
     * 配列要素・軸長・スカラー属性を生成する。対象と各添字は左から一度ずつ評価する。
     * @param app 意味解析で解決済みの添字・属性・len式。
     */
    private typedArray(app: App): void {
        const operation = this.analysis.arrayOperations.get(app)!;
        if (operation.kind === "shape") {
            this.expression((app.args[0] as App).args[0]);
            this.expression(app.args[1]);
            this.emit("ARRAY_ATTR", app, "4");
        }
        else if (operation.kind === "item") {
            for (const argument of app.args) {
                this.expression(argument);
            }
            this.emit("GET_ITEM", app, String(operation.owner.array!.rank));
        }
        else {
            this.expression(app.args[0]);
            const code = { length: 0, size: 1, ndim: 2, itemsize: 3 }[operation.kind];
            this.emit("ARRAY_ATTR", app, String(code));
        }
    }

    /**
     * テキストのAPI表はformatAssembly、暗黙変換はexpressionAs、
     * オブジェクト演算の制限はtypedExpressionとconditionで実装する。
     *
     * APIのコンストラクター・メソッド・関数は、device-api.jsonの共通nativeIdによる
     * CALL_NATIVE 単一IDへ変換する。メソッドはselfを最初に、その後に明示引数を積む。
     * コンストラクターの結果はresultType、その他はreturnTypeの幅を使う。
     * .apiには呼出し規約版とABI指紋、.nativeには「ID 名前 引数スロット数 戻り値スロット数」
     * を出力する。詳細な型・selfのクラス情報は指紋で結合したAPI表から取得する。
     * int→floatの暗黙変換にはTO_FLOATを使う。floatなら変更せず、
     * その他の型は実行時の型エラーにする契約。ユーザークラスはNEW_OBJECTと通常のCALLで
     * 初期化し、__init__のNoneを捨てて本体参照を残す。メソッドはselfを先頭引数にする。
     *
     * @param app 意味解析済みの呼出し式。メソッドはselfを先に、引数は左から順に積む。
     * @returns 呼出し先の対応表にあり命令を生成した場合はtrue、対応がない場合はfalse。
     */
    private typedCall(app: App): boolean {
        const call = this.analysis.calls.get(app);
        if (call === undefined) {
            return false;
        }
        if (call.kind === "userConstructor" || call.kind === "userMethod") {
            const fn = call.definition;
            if (call.kind === "userConstructor") {
                this.emit("NEW_OBJECT", app, String(call.owner.id));
                if (fn === undefined) {
                    return true;
                }
                this.emit("DUP", app);
            }
            else {
                this.expression((app.args[0] as App).args[0]);
            }
            const args = call.kind === "userConstructor" ? app.args : app.args.slice(1);
            for (const [index, argument] of args.entries()) {
                this.expressionAs(argument, fn!.parameters[index + 1].type!);
            }
            this.emit("CALL", app, fn!.name);
            if (call.kind === "userConstructor") {
                this.emit("POP", app);
            }
            return true;
        }
        if (call.kind === "function") {
            for (const [index, argument] of app.args.entries()) {
                this.expressionAs(argument, call.definition.parameters[index].type!);
            }
            this.emit("CALL", app, call.definition.name);
            return true;
        }
        if (call.definition === undefined || !("nativeId" in call.definition)) {
            this.fail(app, "ネイティブ呼出しの定義がありません");
        }
        const args = call.kind === "method" ? app.args.slice(1) : app.args;
        if (call.kind === "method") {
            const attribute = app.args[0] as App;
            this.expression(attribute.args[0]);
        }
        for (const [index, argument] of args.entries()) {
            this.expressionAs(argument, call.definition.parameters[index].type);
        }
        this.emit("CALL_NATIVE", app, String(call.definition.nativeId));
        return true;
    }

    /**
     * 表示引数のf文字列はFORMAT_VALUE 書式定数IDとBUILD_STRING 断片数で生成する。
     * 置換式は左から1回ずつ評価し、表示APIは結合後に1回だけ呼ぶ。通常文字列の解釈は
     * 下記と共通で、f文字列の定数断片だけは原文の{{/}}を単一の括弧へ戻す。
     *
     * @param app 意味解析済みのf文字列。空の断片列もBUILD_STRINGで空文字列を1個積む。
     */
    private formattedString(app: App): void {
        for (const part of app.args) {
            if (part instanceof Str) {
                // 置換は原文に対してだけ行い、Unicodeエスケープで作った括弧は縮約しない。
                const fragment = new Str(part.text.replace(/\{\{/g, "{").replace(/\}\}/g, "}"));
                fragment.charPos = part.charPos;
                this.emit("PUSH_STRING", part, String(this.stringId(fragment)));
            }
            else {
                const formatted = part instanceof App && part.fncName === "@format";
                const value = formatted ? part.args[0] : part;
                const format = formatted ? part.args[1] as Str : new Str("");
                this.expression(value);
                this.emit("FORMAT_VALUE", part, String(this.stringId(format)));
            }
        }
        this.emit("BUILD_STRING", app, String(this.uint16(app.args.length, this.location(app), "文字列の断片数")));
    }

    /**
     * 意味解析結果を使い、数値・文字列・変数・属性・呼出し・f文字列の評価命令を生成する。
     * recordは1スロットの本体参照を積む。参照の同一性比較と真偽変換に対応する。
     * and/orは短絡評価し、選択した値を返す。オブジェクトの数値演算は拒否する。
     *
     * @param term 型と束縛が解決済みの式。
     */
    private typedExpression(term: Term): void {
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
                this.loadValue(this.address(term), term);
            }
        }
        else if (term instanceof App) {
            if (this.analysis.numpyCalls.has(term)) {
                this.typedNumpy(term);
                return;
            }
            if (this.analysis.arrayOperations.has(term)) {
                this.typedArray(term);
                return;
            }
            if (this.typedCall(term)) {
                return;
            }
            if (term.fncName === ".") {
                const field = this.analysis.fields.get(term)!;
                this.expression(term.args[0]);
                this.emit("GET_FIELD", term, String(field.definition.id - 1));
                return;
            }
            if (term.fncName === 'f"') {
                this.formattedString(term);
                return;
            }
            if (term.fncName === "and" || term.fncName === "or") {
                const end = this.newLabel("logical_end");
                this.expressionAs(term.args[0], this.valueType(term));
                this.emit("DUP", term);
                this.emit(term.fncName === "and" ? "JUMP_IF_FALSE" : "JUMP_IF_TRUE", term, end);
                this.emit("POP", term);
                this.expressionAs(term.args[1], this.valueType(term));
                this.label(end, term);
                return;
            }
            if (term.fncName === "not") {
                const yes = this.newLabel("not_true");
                const end = this.newLabel("not_end");
                this.condition(term.args[0]);
                this.emit("JUMP_IF_FALSE", term, yes);
                this.emit("PUSH_INT", term, "0");
                this.emit("JUMP", term, end);
                this.label(yes, term);
                this.emit("PUSH_INT", term, "1");
                this.label(end, term);
                return;
            }
            const opcode = this.operation(term);
            if (term.args.length === 1 && (term.fncName === "+" || term.fncName === "-")) {
                this.emit("PUSH_INT", term, "0");
            }
            for (const argument of term.args) {
                if (this.valueType(argument).kind === "object" && opcode !== "EQ" && opcode !== "NE") {
                    this.fail(term, "オブジェクトの数値演算・順序比較は未対応です");
                }
                this.expression(argument);
            }
            this.emit(opcode, term);
        }
        else {
            this.fail(term, "未対応の式です");
        }
    }

    /**
     * 値の読出し・格納はloadValue/storeValue、属性と一時領域の解決はaddressが担当する。
     *
     * 通常変数は1スロット、record・ユーザー本体はGC参照を共有する。
     * 属性代入は右辺→対象の順に評価してSET_FIELDを出す。複合代入は対象を一度だけ
     * 一時スロットへ保存し、旧値→右辺→格納の順を維持する。GET_FIELD/SET_FIELDが
     * 実行時に型・権限・未初期化・範囲を検査する。評価途中の参照はスタックの根に残す。
     *
     * @param app 意味解析済みの単純代入または四則の複合代入式。
     */
    private typedAssignment(app: App): void {
        const target = app.args[0];
        const right = app.args[1];
        if (target instanceof App && target.fncName === "t[i]") {
            const operation = this.analysis.arrayOperations.get(target)!;
            const cached: ValueAddress[] = [];
            if (app.fncName === "=") {
                this.expressionAs(right, this.valueType(target));
            }
            else {
                for (const argument of target.args) {
                    const address = this.temporary(this.valueType(argument), argument);
                    this.expression(argument);
                    this.storeValue(address, argument);
                    cached.push(address);
                }
                for (const address of cached) {
                    this.loadValue(address, target);
                }
                this.emit("GET_ITEM", target, String(operation.owner.array!.rank));
                this.expression(right);
                const opcode = arithmetic[app.fncName.slice(0, -1)];
                if (opcode === undefined) {
                    this.fail(app, "この配列の複合代入演算には対応していません");
                }
                this.emit(opcode, app);
                if (this.valueType(target).kind === "float") {
                    this.emit("TO_FLOAT", app);
                }
            }
            if (cached.length === 0) {
                for (const argument of target.args) {
                    this.expression(argument);
                }
            }
            else {
                for (const address of cached) {
                    this.loadValue(address, target);
                }
                for (const address of cached) {
                    this.emit("PUSH_NONE", target);
                    this.storeValue(address, target);
                }
            }
            this.emit("SET_ITEM", app, String(operation.owner.array!.rank));
            return;
        }
        if (target instanceof App && target.fncName === ".") {
            const field = this.analysis.fields.get(target)!;
            if (app.fncName === "=") {
                this.expressionAs(right, this.valueType(target));
                this.expression(target.args[0]);
            }
            else {
                const receiver = this.temporary(this.valueType(target.args[0]), target);
                this.expression(target.args[0]);
                this.storeValue(receiver, target);
                this.loadValue(receiver, target);
                this.emit("GET_FIELD", target, String(field.definition.id - 1));
                this.expression(right);
                const opcode = arithmetic[app.fncName.slice(0, -1)];
                if (opcode === undefined) {
                    this.fail(app, "未対応の複合代入です");
                }
                this.emit(opcode, app);
                if (this.valueType(target).kind === "float") {
                    this.emit("TO_FLOAT", app);
                }
                this.loadValue(receiver, target);
                // 対象は値スタック上に残っているので、評価済み一時領域の根をここで解除できる。
                this.emit("PUSH_NONE", target);
                this.storeValue(receiver, target);
            }
            this.emit("SET_FIELD", app, String(field.definition.id - 1));
            return;
        }
        let address: ValueAddress;
        if (app.fncName === "=") {
            this.expressionAs(right, this.valueType(target));
            address = this.address(target);
        }
        else {
            const opcode = arithmetic[app.fncName.slice(0, -1)];
            if (opcode === undefined) {
                this.fail(app, `未対応の複合代入です: ${app.fncName}`);
            }
            address = this.address(target);
            this.loadValue(address, target);
            this.expression(right);
            this.emit(opcode, app);
            if (address.type.kind === "float") {
                this.emit("TO_FLOAT", app);
            }
        }
        this.storeValue(address, app);
    }

    /**
     * 現在のスコープでブロック内の文を順に命令へ変換する。
     *
     * @param block 生成する文列。
     */
    private block(block: BlockStatement): void {
        for (const statement of block.statements) {
            this.statement(statement);
        }
    }

    /**
     * 分岐条件を評価し、スタックへ結果を積む。
     *
     * @param term 条件式。None・数値・文字列・本体参照の真偽変換はVMが行う。
     */
    private condition(term: Term): void {
        this.expression(term);
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
     *
     * 意味解析済みのrecordの戻り値は、1個ではなく関数情報に記録した幅で扱う。
     * 式文も型の幅だけPOPし、文ごとに一時領域のカーソルを戻す。
     *
     * @param statement 命令生成する文。globalとpassは実行命令を生成しない。
     */
    private statement(statement: Statement): void {
        if (statement instanceof GlobalStatement) {
            return;
        }
        // 文全体の評価前だけを停止点にする。whileの先頭ラベルと同じPCなので次周も停止する。
        // 構造体の複数STOREやCALLからの継続へ行ブレークポイントを作らない。
        if (statement instanceof CallStatement || statement instanceof IfStatement || statement instanceof WhileStatement
            || statement instanceof ReturnStatement || statement.keyword === "break" || statement.keyword === "continue") {
            this.statementStarts.push({ index: this.entries.length, ...this.location(statement) });
        }
        const allocation = this.allocations.get(this.scope)!;
        allocation.cursor = allocation.variablesEnd;
        if (statement instanceof CallStatement) {
            const assignment = this.assignment(statement);
            if (assignment === undefined) {
                this.expression(statement.app);
                const count = this.valueWidth(this.valueType(statement.app));
                for (let index = 0; index < count; index++) {
                    this.emit("POP", statement);
                }
            }
            else {
                this.typedAssignment(assignment);
            }
        }
        else if (statement instanceof IfStatement) {
            const otherwise = this.newLabel("if_else");
            const end = this.newLabel("if_end");
            this.condition(statement.condition);
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
            this.condition(statement.condition);
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
                const fn = this.analysis.functions.get(this.scope.name!)!;
                this.expressionAs(statement.value, fn.type!);
            }
            this.emit("RET", statement);
        }
        else if (statement.keyword === "break" || statement.keyword === "continue") {
            const loop = this.loops[this.loops.length - 1];
            if (loop === undefined) {
                this.fail(statement, "break/continueはwhile内だけに使用できます");
            }
            this.emit("JUMP", statement, statement.keyword === "break" ? loop.end : loop.start);
        }
        else if (statement.keyword !== "pass") {
            this.fail(statement, "この文のアセンブリ生成には対応していません");
        }
    }

    /**
     * 内部の命令・ラベル・大域領域を1行へ整形する。
     * 関数情報・数値PCはformatAssemblyで整形する。
     *
     * @param entry 整形する内部要素。
     * @returns 改行を含まないアセンブリの1行。
     */
    private format(entry: Exclude<AssemblyEntry, FunctionEntry>): string {
        switch (entry.kind) {
            case "instruction":
                return entry.operand === undefined ? entry.opcode : `${entry.opcode} ${entry.operand}`;
            case "label":
                return `${entry.name}:`;
            case "globals":
                return `.globals ${entry.count}`;
        }
    }

    /**
     * charPosを元ソースの行番号（0始まり）へ変換する。自動生成は-1。
     *
     * @param charPos 元ソースのUTF-16位置。負数は自動生成を表す。
     * @returns 0始まりの行番号。自動生成の場合は-1。
     */
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

    /**
     * 同じPython行に対応する連続した命令には、先頭にだけコメントを付ける。
     *
     * 意味解析済みは.apiとnativeId順の.native表を出し、呼出し・分岐先を数値PCへ解決する。
     * .functionは「名前 入口PC 引数スロット数 追加局所スロット数 戻り値スロット数」とする。
     * 文字列定数は.globalsの直後にID順で置き、制御文字等をエスケープして1行に出力する。
     *
     * @remarks
     * `parsePython()`は元のソースを`Module.source`に保持する。アセンブリ出力では命令・ラベルの`charPos`を使い、対応するPythonの行番号と原文を`;`コメントで出す。同じ行の連続命令には1つのコメントを付け、元の行を持たないHALT・暗黙returnは自動生成と表示する。元ソースがないModuleはコメントなしで生成する。
     *
     * @returns 疑似指示・ラベル・命令と元ソースのコメントを含む、末尾改行付きのアセンブリ。
     */
    private formatAssembly(): string {
        const lines: string[] = [];
        const labels = new Map<string, LabelAddress>();
        let pc = 0;
        for (const entry of this.entries) {
            if (entry.kind === "label") {
                labels.set(entry.name, { pc, owner: entry.owner });
            }
            else if (entry.kind === "instruction") {
                pc += this.instructionLength(entry);
            }
        }
        if (pc > 65536) {
            this.binaryError(this.location(this.module), "アセンブリの命令列長が65536バイトを超えています");
        }
        lines.push(`.api ${this.analysis.api.callingConventionVersion} ${this.analysis.api.abiHash}`);
        const natives: { /** 名前解決で特定したAPIまたはユーザー宣言の定義。 */ definition: DeviceCallable; /** 表示・保存・名前解決に使用する名前。 */ name: string; /** メソッド呼出しで先頭に積む対象オブジェクトのスロット幅。 */ self: number }[] = [];
        for (const owner of this.analysis.api.classes) {
            if (owner.array) {
                lines.push(`.array ${owner.id} ${owner.array.dtype} ${owner.array.rank}`);
            }
            if (owner.constructor !== null) {
                natives.push({ definition: owner.constructor, name: `${owner.name}.__init__`, self: 0 });
            }
            for (const definition of owner.methods) {
                natives.push({ definition, name: `${owner.name}.${definition.name}`,
                    self: this.valueWidth({ kind: "object", classId: owner.id }) });
            }
        }
        for (const definition of this.analysis.api.functions) {
            natives.push({ definition, name: definition.name, self: 0 });
        }
        for (const native of natives.sort((left, right) => left.definition.nativeId - right.definition.nativeId)) {
            const args = native.self + native.definition.parameters.reduce((count, parameter) => count + this.valueWidth(parameter.type), 0);
            const result = this.valueWidth(native.definition.resultType ?? native.definition.returnType);
            this.uint16(args, this.location(), "ネイティブ関数の引数スロット数");
            lines.push(`.native ${native.definition.nativeId} ${native.name} ${args} ${result}`);
        }
        let previousLine = -2;
        for (const entry of this.entries) {
            if (this.sourceLines.length > 0 && (entry.kind === "instruction" || entry.kind === "label")) {
                const line = this.sourceLine(entry.charPos);
                if (line !== previousLine) {
                    lines.push(line < 0 ? "; 自動生成" : `; ${line + 1}: ${this.sourceLines[line]}`);
                    previousLine = line;
                }
            }
            if (entry.kind === "function") {
                const pc = this.uint16(this.labelAddress(entry.name, labels, entry).pc, entry, "関数入口PC");
                lines.push(`.function ${entry.name} ${pc} ${entry.args} ${entry.locals} ${entry.returns}`);
            }
            else if (entry.kind === "instruction"
                && ["CALL", "JUMP", "JUMP_IF_FALSE", "JUMP_IF_TRUE"].includes(entry.opcode)) {
                const target = this.labelAddress(entry.operand, labels, entry);
                const base = entry.opcode === "CALL" || entry.owner === undefined ? 0
                    : this.labelAddress(entry.owner, labels, entry).pc;
                const operand = this.uint16(target.pc - base, entry, "呼出し・分岐先PC");
                lines.push(`${entry.opcode} ${operand} ; ${entry.operand}`);
            }
            else {
                lines.push(this.format(entry));
            }
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

    /**
     * 意味解析で確定した幅と配置を使用し、追加の一時領域だけを生成器が管理する。
     *
     * スロット配置はsemantic.tsの解析結果を使い、一時領域の最大幅だけを追加する。
     * 関数本体はモジュールのHALTの後へ定義順に配置する。
     *
     * ## 構造体・ネイティブ呼出しのコード生成（2026-11-04）
     *
     * 引数も戻り値もrecordを含め各1スロットを渡す。関数内はBP+0/1を管理用とし、BP+2から
     * 引数、局所変数、コンパイラーの一時領域を配置する。一時領域は文ごとに
     * 再利用し、同時に必要な最大数を確保する。.functionは「名前 入口PC 引数スロット数
     * 追加局所スロット数 戻り値スロット数」。RETはこの戻り値数を保ってフレームを破棄
     * する契約。非None関数の末尾RETは解析上到達不能で、到達時は戻り値不足で停止する。
     * Noneも1スロット。式文は結果のスロット数だけPOPする。
     */
    private compileTyped(): void {
        this.collectFunctions();
        const globalScope = this.scope;
        const scopes = [globalScope, ...this.functions.values()];
        for (const scope of scopes) {
            const fn = scope.fn === undefined ? undefined : this.analysis.functions.get(scope.name!)!;
            const variables = fn === undefined ? this.analysis.globals : fn.variables;
            let end = scope.fn === undefined ? 0 : 2;
            for (const variable of variables.values()) {
                end = Math.max(end, variable.slot + this.valueWidth(variable.type!));
            }
            if (end > 65535) {
                this.fail(scope.fn ?? this.module, "変数領域のスロット数が65535を超えています");
            }
            this.allocations.set(scope, { variablesEnd: end, cursor: end, end });
        }
        const globals: Extract<AssemblyEntry, { /** この共用型の要素を区別する種別。 */ kind: "globals" }> = {
            kind: "globals", count: 0, ...this.location()
        };
        this.entries.push(globals);
        const records = new Map<Scope, FunctionEntry>();
        for (const scope of this.functions.values()) {
            const fn = this.analysis.functions.get(scope.name!)!;
            const args = fn.parameters.reduce((count, parameter) => count + this.valueWidth(parameter.type!), 0);
            const entry: FunctionEntry = { kind: "function", name: fn.name, args, locals: 0,
                returns: this.valueWidth(fn.type!), charPos: fn.node.charPos, owner: fn.name };
            records.set(scope, entry);
            this.entries.push(entry);
        }
        this.block(globalScope.block);
        this.emit("HALT");
        for (const scope of this.functions.values()) {
            this.scope = scope;
            const fn = this.analysis.functions.get(scope.name!)!;
            this.label(fn.name, fn.node);
            this.block(scope.block);
            // 暗黙returnはステップ専用。def行や末尾の別行へ行ブレークポイントを作らない。
            this.implicitReturns.push(this.entries.length);
            if (fn.type!.kind === "none") {
                this.emit("PUSH_NONE");
            }
            // 非None関数の末尾は到達不能。RETは戻り値スロット不足を検査する契約。
            this.emit("RET");
            const record = records.get(scope)!;
            record.locals = this.allocations.get(scope)!.end - 2 - record.args;
        }
        globals.count = this.allocations.get(globalScope)!.end;
    }


    /**
     * opcodeとオペランドの符号化形式から、命令長をバイト単位で求める。
     *
     * @param entry 長さを求める実行命令。
     * @returns オペランドなしは1、uint16は3、int32/float32は5バイト。
     */
    private instructionLength(entry: InstructionEntry): number {
        const encoding = operandEncoding[entry.opcode];
        if (encoding === undefined) {
            return 1;
        }
        return encoding === "u16" ? 3 : 5;
    }

    /**
     * バイナリ形式の範囲・アドレス解決エラーを元ソースの位置付きで報告する。
     *
     * @param location 問題の命令または生成処理の位置。
     * @param message エラーの説明。
     * @throws RangeError charPosを含む形式エラー。
     */
    private binaryError(location: SourceLocation, message: string): never {
        throw new RangeError(`${message} (charPos=${location.charPos})`);
    }

    /**
     * 数値がuint16へ切り詰めず格納できる整数か検査する。
     *
     * @param value 検査する値。
     * @param location 範囲違反の場合の診断位置。
     * @param description エラーへ付ける項目名。
     * @returns 検証した0〜65535の整数。
     * @throws RangeError 整数でない場合、または範囲外の場合。
     */
    private uint16(value: number, location: SourceLocation, description: string): number {
        if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) {
            this.binaryError(location, `${description}がuint16の範囲を超えています: ${value}`);
        }
        return value;
    }

    /**
     * ラベル名を命令列内のPCと所属関数へ解決する。
     *
     * @param name 解決するラベル名。
     * @param labels 命令長から作成したラベルの対応表。
     * @param location 解決に失敗した場合の診断位置。
     * @returns ラベルのPCと所属関数。
     * @throws RangeError 名前が未指定、またはラベルが存在しない場合。
     */
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

    /**
     * 変数名・関数名・分岐ラベル・文字列定数IDをuint16オペランドへ解決する。
     *
     * ユーザー関数はCALL 入口PC。PCは命令列先頭=0のバイト位置で、CALL/分岐等の
     * uint16オペランド命令とCALL_NATIVE/FORMAT_VALUE/BUILD_STRINGは3バイト、
     * PUSH_INT/PUSH_FLOATは5バイト、TO_FLOATを含むオペランドなし命令は1バイトとして
     * PCを計算する。分岐は所属関数先頭からの相対位置。ラベルはテキストの表示にも残す。
     *
     * @remarks
     * LOAD/STOREのオペランドは意味解析で確定したスロット番号を使用し、
     * 固定位置になっているので、一時領域を含む領域の範囲を検査する。
     *
     * @param entry 固定スロット・呼出し先・分岐先・定数ID等を持つ命令。
     * @param labels 命令列先頭を0とするラベルのPC対応表。
     * @returns 範囲検査済みのuint16オペランド。
     * @throws RangeError 未解決・範囲外、APIにないnativeId、別関数への分岐の場合。
     */
    private addressOperand(entry: InstructionEntry, labels: ReadonlyMap<string, LabelAddress>): number {
        const name = entry.operand;
        let value: number | undefined;
        switch (entry.opcode) {
            case "PUSH_STRING":
            case "FORMAT_VALUE":
                value = name === undefined ? undefined : Number(name);
                if (value === undefined || !Number.isInteger(value) || value < 0 || value >= this.stringIds.size) {
                    this.binaryError(entry, "文字列定数IDが範囲外です");
                }
                break;
            case "LOAD_G":
            case "STORE_G":
                value = Number(name);
                if (value >= this.allocations.get(this.globalScope)!.end) {
                    this.binaryError(entry, "大域スロットが領域の範囲外です");
                }
                break;
            case "LOAD_L":
            case "STORE_L": {
                const scope = entry.owner === undefined ? undefined : this.functions.get(entry.owner);
                value = Number(name);
                if (scope === undefined || value < 2 || value >= this.allocations.get(scope)!.end) {
                    this.binaryError(entry, "局所スロットが管理領域または領域の範囲外です");
                }
                break;
            }
            case "CALL_NATIVE":
                value = Number(name);
                if (!this.nativeIds.has(value)) {
                    this.binaryError(entry, "CALL_NATIVEのIDがAPI定義に存在しません");
                }
                break;
            case "BUILD_STRING":
            case "NEW_OBJECT":
            case "GET_FIELD":
            case "SET_FIELD":
            case "CALL_NUMPY":
            case "GET_ITEM":
            case "SET_ITEM":
            case "ARRAY_ATTR":
                value = Number(name);
                break;
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

    /**
     * version=5だけをlittle endianで符号化する。全体128KiB、命令列1〜65536バイト。
     * ヘッダー64バイト: magic:u16@0=0xB1C0、version:u16@2=5、大域数:u16@4、関数数:u16@6、
     * 命令長:u32@8、開始PC:u16@12=0、呼出し規約:u16@14=4、文字列数:u16@16、
     * schema:u16@18=4、UTF-8長:u32@20、ABI SHA-256の生32バイト@24、
     * 本体型数:u16@56、予約0:u16@58、本体型表とフィールド表の合計長:u32@60。
     * 関数表は12バイト/件: 入口PC・命令長・引数幅・追加局所幅・戻り値幅・予約0を各u16。
     * 戻り値はNoneも1スロット以上。管理領域2個は追加局所幅に含めず、一時領域は含める。
     * 関数表→本体型表・フィールド表→命令列→文字列表→UTF-8の順でパディングなし。
     * 型レコード12バイトとフィールド4バイトの詳細はbytecodeTypeRecordLengthのコメントを参照する。
     * 型IDは非0昇順、フィールド表は型の宣言順で隙間なく配置する。空の本体型・型の循環を許す。
     * 文字列レコードはoffset:u32と
     * byteLength:u32の8バイトで、ID順に隙間なく連結する。NUL終端・正規化は行わない。
     * 命令PCは命令列先頭=0。CALLは絶対PC、分岐は所属関数先頭からの相対PC。
     * nativeIdはAPI表に存在するものだけ許可し、指紋で同じC++登録表へ結合する。
     * @returns 現行形式のバイナリ。版1/2は生成しない。
     * @throws RangeError 不正な型情報・幅・アドレス・上限超過。
     */
    private encodeBinary(): Uint8Array {
        const api = this.analysis.api;
        const headerLength = bytecodeHeaderLength;
        const functionRecordLength = bytecodeFunctionRecordLength;
        if (api.schemaVersion !== 4 || api.callingConventionVersion !== 4
            || api.stringPolicyVersion !== 2 || !/^[0-9a-f]{64}$/.test(api.abiHash)) {
            this.binaryError(this.location(this.module), "バイナリversion=5に対応するAPI定義・ABI指紋ではありません");
        }
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

        const globalsEntry = this.entries.find(entry => entry.kind === "globals");
        if (globalsEntry === undefined) {
            this.binaryError(moduleLocation, "大域領域の情報がありません");
        }
        const globals = this.uint16(globalsEntry.count, moduleLocation, "大域スロット数");
        const functionCount = this.uint16(functions.length, moduleLocation, "関数の個数");
        const stringCount = this.uint16(this.stringIds.size, moduleLocation, "文字列定数の個数");
        const heapTypes = api.classes.filter(owner => owner.kind === "record").sort((left, right) => left.id - right.id);
        const typeCount = this.uint16(heapTypes.length, moduleLocation, "本体型の個数");
        const typeLength = typeCount * bytecodeTypeRecordLength + heapTypes.reduce((length, owner) => length + owner.fields.length * 4, 0);
        const typeOffset = headerLength + functionCount * functionRecordLength;
        const codeOffset = typeOffset + typeLength;
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
        view.setUint16(14, api.callingConventionVersion, true);
        view.setUint16(16, stringCount, true);
        view.setUint16(18, api.schemaVersion, true);
        view.setUint32(20, stringDataLength, true);
        view.setUint16(56, typeCount, true);
        view.setUint32(60, typeLength, true);
        for (let index = 0; index < 32; index++) {
            view.setUint8(24 + index, Number.parseInt(api.abiHash.slice(index * 2, index * 2 + 2), 16));
        }
        let fieldOffset = typeCount * bytecodeTypeRecordLength;
        for (const [index, owner] of heapTypes.entries()) {
            const offset = typeOffset + index * bytecodeTypeRecordLength;
            view.setUint16(offset, owner.id, true);
            view.setUint16(offset + 2, this.uint16(owner.fields.length, moduleLocation, "フィールド数"), true);
            view.setUint32(offset + 4, fieldOffset, true);
            view.setUint8(offset + 8, owner.array === undefined ? 0 : owner.array.dtype === "float32" ? 1 : 2);
            view.setUint8(offset + 9, owner.array?.rank ?? 0);
            for (const field of owner.fields) {
                const type = field.type;
                const kind = type.kind === "object" ? (api.classes.find(item => item.id === type.classId)!.kind === "device" ? 7 : 8)
                    : { int: 1, float: 2, none: 3, str: 6, error: 0 }[type.kind];
                view.setUint8(typeOffset + fieldOffset, kind);
                view.setUint8(typeOffset + fieldOffset + 1, (field.readable ? 1 : 0) | (field.writable ? 2 : 0));
                view.setUint16(typeOffset + fieldOffset + 2, type.kind === "object" ? type.classId : 0, true);
                fieldOffset += 4;
            }
        }

        for (const [index, fn] of functions.entries()) {
            const start = this.labelAddress(fn.name, labels, fn).pc;
            const next = functions[index + 1];
            const end = next === undefined ? codeLength : this.labelAddress(next.name, labels, next).pc;
            const offset = headerLength + index * functionRecordLength;
            view.setUint16(offset, this.uint16(start, fn, "関数の入口PC"), true);
            view.setUint16(offset + 2, this.uint16(end - start, fn, "関数の命令列の長さ"), true);
            view.setUint16(offset + 4, this.uint16(fn.args, fn, "引数スロット数"), true);
            view.setUint16(offset + 6, this.uint16(fn.locals, fn, "追加の局所スロット数"), true);
            const returns = this.uint16(fn.returns, fn, "戻り値スロット数");
            if (returns === 0) {
                this.binaryError(fn, "戻り値にはNoneを含めて1スロット以上が必要です");
            }
            view.setUint16(offset + 8, returns, true);
            view.setUint16(offset + 10, 0, true);
        }

        let offset = codeOffset;
        for (const entry of this.entries) {
            if (entry.kind !== "instruction") {
                continue;
            }
            if (!Object.hasOwn(BytecodeOpcode, entry.opcode)) {
                this.binaryError(entry, `このバイナリversionでは使用できない命令です: ${entry.opcode}`);
            }
            const opcode = entry.opcode;
            view.setUint8(offset, BytecodeOpcode[opcode]);
            switch (operandEncoding[opcode]) {
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


    /**
     * この生成器で内部命令列を1回生成し、テキストへ整形する。
     *
     * @returns 元ソースのコメントと疑似指示を含むアセンブリ。
     */
    generateAssembly(): string {
        this.compileTyped();
        return this.formatAssembly();
    }

    /**
     * この生成器で内部命令列を1回生成し、共通の命令・定数表からバイナリへ符号化する。
     *
     * @returns 意味解析済みのversion=5バイナリ。
     */
    generateBytecode(): Uint8Array {
        this.compileTyped();
        return this.encodeBinary();
    }

    /**
     * 同じ1回のコンパイルからバイナリと最終PC・変数配置を返す。名前・型はdiagramだけに保持する。
     *
     * 文の先頭・関数入口・暗黙returnの最終PCを停止候補へ対応付ける。
     * 複数スロットのSTOREの途中やCALLからの継続には行ブレークポイントを作らない。
     *
     * @returns 同じ命令列から作ったversion=5のbytesと、元ソース・変数配置・停止位置のinfo。
     * @throws Error 元ソースまたは意味解析結果がない場合。
     */
    generateDebugBytecode(): PythonDebugBuild {
        if (this.module.source === undefined) {
            throw new Error("デバッグ情報には元ソースと意味解析結果が必要です。");
        }
        this.compileTyped();
        const bytes = this.encodeBinary();
        const positions: number[] = [];
        const instructions: PythonDebugInfo["instructions"] = new Map();
        const labels = new Map<string, number>();
        let pc = 0;
        for (const entry of this.entries) {
            positions.push(pc);
            if (entry.kind === "instruction") {
                instructions.set(pc, { charPos: entry.charPos, owner: entry.owner,
                    opcode: entry.opcode, operand: entry.operand });
                pc += this.instructionLength(entry);
            }
            else if (entry.kind === "label") {
                labels.set(entry.name, pc);
            }
        }
        const functions = [...this.functions.values()].map(scope => {
            const name = scope.name!;
            const record = this.entries.find((entry): entry is FunctionEntry => entry.kind === "function" && entry.name === name)!;
            return { name, entryPc: labels.get(name)!, endPc: pc, slots: 2 + record.args + record.locals,
                variables: [...this.analysis.functions.get(name)!.variables.values()] };
        });
        for (let index = 0; index + 1 < functions.length; index++) {
            functions[index].endPc = functions[index + 1].entryPc;
        }
        const info: PythonDebugInfo = {
            source: this.module.source, api: this.analysis.api, instructions,
            stepPcs: [...new Set([...this.statementStarts.map(point => positions[point.index]),
                ...functions.map(fn => fn.entryPc), ...this.implicitReturns.map(index => positions[index])])]
                .sort((left, right) => left - right),
            globals: [...this.analysis.globals.values()],
            functions: [{ name: "<module>", entryPc: 0, endPc: functions[0]?.entryPc ?? pc,
                slots: 0, variables: [] }, ...functions],
            stops: this.statementStarts.map(point => ({ pc: positions[point.index],
                line: this.sourceLine(point.charPos) + 1, charPos: point.charPos, owner: point.owner }))
        };
        return { bytes, info };
    }
}

/**
 * 意味解析済みの構文木からアセンブリを生成する。意味診断があれば拒否する。
 * @param analysis 型・配置を確定した解析結果。構文木は変更しない。
 * @returns 疑似指示・命令と元ソースの行コメント。末尾LF付き。
 */
export function generateAssembly(analysis: PythonAnalysis): string {
    return new BytecodeGenerator(analysis).generateAssembly();
}

/**
 * version=5のバイナリを生成する。意味解析なしの生成とバイナリ版1/2は非対応。
 * bytecode-transfer.tsとESP32受信器は形式を検証し、VMが実行する。
 * 転送成功・開始ACKは正常終了や実機動作の確認を意味しない。
 * @param analysis 型・配置を確定した解析結果。
 * @returns ヘッダー・関数表・命令列・文字列表・UTF-8データ。
 */
export function generateBytecode(analysis: PythonAnalysis): Uint8Array {
    return new BytecodeGenerator(analysis).generateBytecode();
}

/**
 * 同じコンパイルからversion=5のバイナリとデバッグ情報を返す。
 * @param analysis 元ソースを持つ意味解析結果。
 * @returns 転送バイナリ・最終PC・名前と型・停止点。
 */
export function generateDebugBytecode(analysis: PythonAnalysis): PythonDebugBuild {
    return new BytecodeGenerator(analysis).generateDebugBytecode();
}
