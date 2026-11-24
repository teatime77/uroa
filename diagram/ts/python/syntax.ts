/**
 * Pythonサブセットの式・文・ブロック・関数・モジュールの構文木を定義する。位置と親参照を保持し、必要な括弧と字下げを補ってソース表現を生成する。
 */
/** 添字アクセスを表すAppの演算子名。WebGPU側と共通の表記。 */
export const indexOpr = "t[i]";

/**
 * 単純代入または複合代入の記号であるかを調べる。
 *
 * @param text 処理する文字列。
 */
export function isAssignmentToken(text: string): boolean {
    return ["=", "+=", "-=", "*=", "/=", "//=", "%=", "**=", "&=", "|=", "^=", "<<=", ">>="].includes(text);
}

// 数値が大きいほど強く結合する。単項演算・累乗・後置演算は別途扱う。
const binaryPrecedence: Readonly<Record<string, number>> = {
    "or": 1,
    "and": 2,
    "==": 4,
    "!=": 4,
    "<": 4,
    ">": 4,
    "<=": 4,
    ">=": 4,
    "in": 4,
    "not in": 4,
    "is": 4,
    "is not": 4,
    "|": 5,
    "^": 6,
    "&": 7,
    "<<": 8,
    ">>": 8,
    "+": 9,
    "-": 9,
    "*": 10,
    "/": 10,
    "//": 10,
    "%": 10,
    "**": 12
};

/** 子のキャッシュは親に依存させず、使用位置で必要な括弧を補う。 */
function formatOperand(term: Term, precedence: number, wrapEqual = false): string {
    const source = term.toString();
    const childPrecedence = term.precedence();
    return childPrecedence < precedence || (wrapEqual && childPrecedence === precedence)
        ? `(${source})` : source;
}

/** ブロック自身のキャッシュは字下げせず、使用位置で1段字下げする。 */
function formatSuite(block: BlockStatement): string {
    const source = block.toString() || "pass";
    return source.split("\n").map(line => `    ${line}`).join("\n");
}

/** Python用構文木の基底。charPosは元ソース中のUTF-16位置。 */
export abstract class AbstractSyntaxNode {
    /**
     * 元のPythonソース内のUTF-16位置。
     */
    charPos = 0;
    /**
     * 構文木の親ノード。setParent()が全体の構築後に設定する。
     */
    parent: AbstractSyntaxNode | undefined;
    /**
     * このノードを単独でソース化した結果のキャッシュ。親の括弧や字下げは含めない。
     */
    protected _str?: string;

    /**
     * この構文木をPythonのソース表現へ変換し、必要な括弧・字下げを補う。
     */
    abstract toString(): string;

    /**
     * このノードが直接所有する子ノードを構文上の順序で返す。
     */
    get children(): AbstractSyntaxNode[] {
        return [];
    }

    /**
     * このノードと全子孫へ親ノードの参照を再帰的に設定する。
     */
    setParent(parent: AbstractSyntaxNode | undefined = undefined): void {
        this.parent = parent;
        for (const child of this.children) {
            child.setParent(this);
        }
    }

    /**
     * このノードから深さ優先で全子孫を渡された一覧へ追加する。
     */
    getAll(alls: AbstractSyntaxNode[]): void {
        alls.push(this);
        for (const child of this.children) {
            child.getAll(alls);
        }
    }

    /**
     * このノード自身から親をたどった祖先の一覧を返す。
     */
    ancestors(): AbstractSyntaxNode[] {
        const result: AbstractSyntaxNode[] = [];
        for (let node: AbstractSyntaxNode | undefined = this; node !== undefined; node = node.parent) {
            result.push(node);
        }
        return result;
    }

    /**
     * 自身と祖先のうち、BlockStatementに該当するものだけを返す。
     */
    ancestorBlocks(): BlockStatement[] {
        return this.ancestors().filter(node => node instanceof BlockStatement);
    }
}

/** 値・変数参照・演算・呼出しの基底。 */
export abstract class Term extends AbstractSyntaxNode {
    /** 原子式は最も強く結合する。 */
    precedence(): number {
        return 14;
    }

    /**
     * 指定した関数名または演算子名のAppであるかを調べる。
     */
    isApp(fncName: string): this is App {
        return this instanceof App && this.fncName === fncName;
    }

    /**
     * 単純代入または複合代入を表すAppであるかを調べる。
     */
    isAssignmentApp(): boolean {
        return this instanceof App && isAssignmentToken(this.fncName);
    }
}

/** 数値リテラル。負号は単項演算のAppとして保持する。 */
export class ConstNum extends Term {
    /**
     * 数値リテラルの原文をNumberで変換した値。
     */
    value: number;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param text 処理する文字列。
     */
    constructor(/** 符号を含めずに保持する数値リテラルの原文。 */ public text: string) {
        super();
        this.value = Number(text);
    }

    /**
     * この構文木をPythonのソース表現へ変換し、必要な括弧・字下げを補う。
     */
    toString(): string {
        if (this._str === undefined) {
            this._str = this.text;
        }
        return this._str;
    }
}

/** 通常文字列。textは引用符を除いた原文で、エスケープは未解釈。 */
export class Str extends Term {
    /**
     * この型の状態と依存先を初期化する。
     *
     * @param text 処理する文字列。
     */
    constructor(/** 引用符を除き、エスケープを解釈せず保持する文字列の原文。 */ public text: string) {
        super();
    }

    /**
     * この構文木をPythonのソース表現へ変換し、必要な括弧・字下げを補う。
     */
    toString(): string {
        if (this._str === undefined) {
            // 既存のエスケープを二重化せず、二重引用符だけを追加で保護する。
            const content = this.text.replace(/\\(?:\r\n|[\s\S])|["\x00-\x1f\x7f]/g, part => {
                if (part[0] === "\\") {
                    // 行継続を除き、ブロックの字下げが文字列に入り込まない形にする。
                    return part[1] === "\r" || part[1] === "\n" ? "" : part;
                }
                switch (part) {
                    case "\"":
                        return "\\\"";
                    case "\n":
                        return "\\n";
                    case "\r":
                        return "\\r";
                    case "\t":
                        return "\\t";
                    default:
                        return `\\x${part.charCodeAt(0).toString(16).padStart(2, "0")}`;
                }
            });
            this._str = `"${content}"`;
        }
        return this._str;
    }
}

/** 名前参照。True・False・Noneも予約された名前として保持する。 */
export class RefVar extends Term {
    /**
     * この型の状態と依存先を初期化する。
     *
     * @param name 対象を識別する名前。
     */
    constructor(/** 表示・保存・名前解決に使用する名前。 */ public name: string) {
        super();
    }

    /**
     * この構文木をPythonのソース表現へ変換し、必要な括弧・字下げを補う。
     */
    toString(): string {
        if (this._str === undefined) {
            this._str = this.name;
        }
        return this._str;
    }
}

/** 演算・呼出し・属性・添字・リスト・タプルを共通の形で保持する。 */
export class App extends Term {
    // <compare>のとき、args間の比較演算子を評価順で保持する。
    comparisonOperators: string[] = [];

    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(/** 演算子または呼出し名を保持する名前参照。 */ public fnc: RefVar, /** 関数の引数または演算の項を宣言・出現順で保持する一覧。 */ public args: Term[]) {
        super();
    }

    /**
     * 演算子または呼出し先の識別名を返す。
     */
    get fncName(): string {
        return this.fnc.name;
    }

    /**
     * このノードが直接所有する子ノードを構文上の順序で返す。
     */
    get children(): AbstractSyntaxNode[] {
        return [this.fnc, ...this.args];
    }

    /**
     * 括弧を補う判定に使用する、この式の結合の強さを返す。
     */
    precedence(): number {
        if (isAssignmentToken(this.fncName)) {
            return 0;
        }
        if (this.fncName === "not") {
            return 3;
        }
        if (this.fncName === "<compare>") {
            return 4;
        }
        if (this.args.length === 1 && ["+", "-", "~"].includes(this.fncName)) {
            return 11;
        }
        if (["[]", ","].includes(this.fncName)) {
            return 14;
        }
        return Object.hasOwn(binaryPrecedence, this.fncName) ? binaryPrecedence[this.fncName] : 13;
    }

    /**
     * 演算子の結合順と子の優先順位を保って、Appの原文表現を組み立てる。
     */
    private source(): string {
        const name = this.fncName;
        const args = this.args;
        switch (name) {
            case "[]":
                return `[${args.map(arg => arg.toString()).join(", ")}]`;
            case ",": {
                const content = args.map(arg => arg.toString()).join(", ");
                return `(${content}${args.length === 1 ? "," : ""})`;
            }
            case "()":
                return `${formatOperand(args[0], 13)}(${args.slice(1).map(arg => arg.toString()).join(", ")})`;
            case ".": {
                // 整数の直後のドットが小数点として読まれることを防ぐ。
                const base = args[0] instanceof ConstNum ? `(${args[0]})` : formatOperand(args[0], 13);
                return `${base}.${args[1]}`;
            }
            case indexOpr:
                return `${formatOperand(args[0], 13)}[${args[1]}]`;
            case "<compare>": {
                let source = formatOperand(args[0], 4, true);
                for (const [index, operator] of this.comparisonOperators.entries()) {
                    source += ` ${operator} ${formatOperand(args[index + 1], 4, true)}`;
                }
                return source;
            }
            case "not":
                return `not ${formatOperand(args[0], 3)}`;
            case "**":
                // 累乗は右結合。右辺の単項演算は括弧なしで書ける。
                return `${formatOperand(args[0], 12, true)} ** ${formatOperand(args[1], 11)}`;
        }
        if (args.length === 1 && ["+", "-", "~"].includes(name)) {
            return `${name}${formatOperand(args[0], 11)}`;
        }
        if (isAssignmentToken(name)) {
            return `${args[0]} ${name} ${args[1]}`;
        }
        if (Object.hasOwn(binaryPrecedence, name)) {
            const precedence = this.precedence();
            // 左結合の演算でも右の同順位の木を平坦化せず、元の計算順を保つ。
            return `${formatOperand(args[0], precedence, precedence === 4)} ${name} ${formatOperand(args[1], precedence, true)}`;
        }
        return `${this.fnc}(${args.map(arg => arg.toString()).join(", ")})`;
    }

    /**
     * この構文木をPythonのソース表現へ変換し、必要な括弧・字下げを補う。
     */
    toString(): string {
        if (this._str === undefined) {
            this._str = this.source();
        }
        return this._str;
    }
}

/**
 * 文の基底。単独のpass・break・continueとimport文はこのクラスで表す。
 * fromによるimportはmoduleNameに取込元を設定する。
 */
export class Statement extends AbstractSyntaxNode {
    /**
     * from/import文が参照するモジュール名。通常の文では未指定。
     */
    moduleName: string | undefined;
    /**
     * importする対象名と任意の別名を保持する一覧。
     */
    imports: { /** 表示・保存・名前解決に使用する名前。 */ name: string; /** import元の名前に付ける別名。指定がなければundefined。 */ alias: string | undefined }[] = [];

    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(/** pass・break・continue・import等の文の種類。 */ public keyword: "" | "pass" | "break" | "continue" | "import" = "") {
        super();
    }

    /**
     * この式文が代入のAppを持つかを調べる。
     */
    isAssignmentCall(): boolean {
        return this instanceof CallStatement && this.app.isAssignmentApp();
    }

    /**
     * この構文木をPythonのソース表現へ変換し、必要な括弧・字下げを補う。
     */
    toString(): string {
        if (this._str === undefined) {
            if (this.keyword === "import") {
                const names = this.imports.map(item => item.alias === undefined
                    ? item.name : `${item.name} as ${item.alias}`).join(", ");
                const prefix = this.moduleName === undefined ? "" : `from ${this.moduleName} `;
                this._str = `${prefix}import ${names}`;
            }
            else {
                this._str = this.keyword;
            }
        }
        return this._str;
    }
}

/** Pythonの式文・代入文。appは呼出し以外の式も保持できる。 */
export class CallStatement extends Statement {
    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(/** 式文または代入文の本体となる式。 */ public app: Term) {
        super();
    }

    /**
     * このノードが直接所有する子ノードを構文上の順序で返す。
     */
    get children(): AbstractSyntaxNode[] {
        return [this.app];
    }

    /**
     * この構文木をPythonのソース表現へ変換し、必要な括弧・字下げを補う。
     */
    toString(): string {
        if (this._str === undefined) {
            this._str = this.app.toString();
        }
        return this._str;
    }
}

/** global文の名前と元位置を保持する。束縛・宣言順の共通契約はglobal-scope.tsを参照する。 */
export class GlobalStatement extends Statement {
    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(/** global文で宣言した名前と、それぞれの元位置。 */ public names: Variable[]) {
        super();
    }

    /**
     * このノードが直接所有する子ノードを構文上の順序で返す。
     */
    get children(): AbstractSyntaxNode[] {
        return this.names;
    }

    /**
     * この構文木をPythonのソース表現へ変換し、必要な括弧・字下げを補う。
     */
    toString(): string {
        if (this._str === undefined) {
            this._str = `global ${this.names.map(name => name.toString()).join(", ")}`;
        }
        return this._str;
    }
}

/**
 * 値を返す、または暗黙のNoneを返すreturn文。
 */
export class ReturnStatement extends Statement {
    /**
     * この型の状態と依存先を初期化する。
     *
     * @param value 検証または反映する値。
     */
    constructor(/** returnに明示された式。値なしreturnではundefined。 */ public value: Term | undefined) {
        super();
    }

    /**
     * このノードが直接所有する子ノードを構文上の順序で返す。
     */
    get children(): AbstractSyntaxNode[] {
        return this.value === undefined ? [] : [this.value];
    }

    /**
     * この構文木をPythonのソース表現へ変換し、必要な括弧・字下げを補う。
     */
    toString(): string {
        if (this._str === undefined) {
            this._str = this.value === undefined ? "return" : `return ${this.value}`;
        }
        return this._str;
    }
}

/** ソース順の文列。Pythonではブロックごとの変数スコープは作らない。 */
export class BlockStatement extends Statement {
    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(/** ブロック内に出現した順の文一覧。 */ public statements: Statement[]) {
        super();
    }

    /**
     * このノードが直接所有する子ノードを構文上の順序で返す。
     */
    get children(): AbstractSyntaxNode[] {
        return this.statements;
    }

    /**
     * この構文木をPythonのソース表現へ変換し、必要な括弧・字下げを補う。
     */
    toString(): string {
        if (this._str === undefined) {
            this._str = this.statements.map(statement => statement.toString()).join("\n");
        }
        return this._str;
    }
}

/**
 * 条件式とif・elif・elseの文列を持つ分岐文。
 */
export class IfStatement extends Statement {
    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(
        /**
         * 分岐または繰返しで評価する条件式。
         */
        public condition: Term,
        /**
         * if条件が真のときに実行する文列。
         */
        public ifBlock: BlockStatement,
        /**
         * 後続のelifを表す入れ子の分岐ノード。
         */
        public elseIf: IfStatement | undefined = undefined,
        /**
         * 全条件が偽のときの文列。elseがなければundefined。
         */
        public elseBlock: BlockStatement | undefined = undefined
    ) {
        super();
    }

    /**
     * このノードが直接所有する子ノードを構文上の順序で返す。
     */
    get children(): AbstractSyntaxNode[] {
        const nodes: AbstractSyntaxNode[] = [this.condition, this.ifBlock];
        if (this.elseIf !== undefined) {
            nodes.push(this.elseIf);
        }
        if (this.elseBlock !== undefined) {
            nodes.push(this.elseBlock);
        }
        return nodes;
    }

    /**
     * この構文木をPythonのソース表現へ変換し、必要な括弧・字下げを補う。
     */
    toString(): string {
        if (this._str === undefined) {
            let source = `if ${this.condition}:\n${formatSuite(this.ifBlock)}`;
            if (this.elseIf !== undefined) {
                source += `\nel${this.elseIf}`;
            }
            if (this.elseBlock !== undefined) {
                source += `\nelse:\n${formatSuite(this.elseBlock)}`;
            }
            this._str = source;
        }
        return this._str;
    }
}

/**
 * 条件式と本体の文列を持つwhile文。
 */
export class WhileStatement extends Statement {
    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(/** 分岐または繰返しで評価する条件式。 */ public condition: Term, /** このスコープまたは制御文が所有する本体の文列。 */ public block: BlockStatement) {
        super();
    }

    /**
     * このノードが直接所有する子ノードを構文上の順序で返す。
     */
    get children(): AbstractSyntaxNode[] {
        return [this.condition, this.block];
    }

    /**
     * この構文木をPythonのソース表現へ変換し、必要な括弧・字下げを補う。
     */
    toString(): string {
        if (this._str === undefined) {
            this._str = `while ${this.condition}:\n${formatSuite(this.block)}`;
        }
        return this._str;
    }
}

/** 関数の仮引数、forの単一の束縛先。型宣言は持たない。 */
export class Variable extends AbstractSyntaxNode {
    /**
     * この型の状態と依存先を初期化する。
     *
     * @param name 対象を識別する名前。
     */
    constructor(/** 表示・保存・名前解決に使用する名前。 */ public name: string) {
        super();
    }

    /**
     * この構文木をPythonのソース表現へ変換し、必要な括弧・字下げを補う。
     */
    toString(): string {
        if (this._str === undefined) {
            this._str = this.name;
        }
        return this._str;
    }
}

/** Pythonのfor ... in ...。listにはrange等の呼出しも保持できる。 */
export class ForStatement extends Statement {
    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(/** for文で反復値を代入する変数名。 */ public initializer: Variable, /** for文が反復する対象の式。 */ public list: Term, /** このスコープまたは制御文が所有する本体の文列。 */ public block: BlockStatement) {
        super();
    }

    /**
     * このノードが直接所有する子ノードを構文上の順序で返す。
     */
    get children(): AbstractSyntaxNode[] {
        return [this.initializer, this.list, this.block];
    }

    /**
     * この構文木をPythonのソース表現へ変換し、必要な括弧・字下げを補う。
     */
    toString(): string {
        if (this._str === undefined) {
            this._str = `for ${this.initializer} in ${this.list}:\n${formatSuite(this.block)}`;
        }
        return this._str;
    }
}

/** Pythonのdefは実行順を保つため、文列中にも保持する。 */
export class Fn extends Statement {
    /**
     * この型の状態と依存先を初期化する。
     *
     * @param name 対象を識別する名前。
     */
    constructor(/** 表示・保存・名前解決に使用する名前。 */ public name: string, /** 宣言順に保持する仮引数名の一覧。 */ public args: Variable[], /** このスコープまたは制御文が所有する本体の文列。 */ public block: BlockStatement) {
        super();
    }

    /**
     * このノードが直接所有する子ノードを構文上の順序で返す。
     */
    get children(): AbstractSyntaxNode[] {
        return [...this.args, this.block];
    }

    /**
     * この構文木をPythonのソース表現へ変換し、必要な括弧・字下げを補う。
     */
    toString(): string {
        if (this._str === undefined) {
            const args = this.args.map(arg => arg.toString()).join(", ");
            this._str = `def ${this.name}(${args}):\n${formatSuite(this.block)}`;
        }
        return this._str;
    }
}

/** モジュール全体の文列と、その直下の関数定義への参照。 */
export class Domain extends AbstractSyntaxNode {
    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(/** このスコープまたは制御文が所有する本体の文列。 */ public block: BlockStatement) {
        super();
    }

    /**
     * このスコープの直下に宣言された関数だけを取り出す。
     */
    get fns(): Fn[] {
        return this.block.statements.filter(statement => statement instanceof Fn);
    }

    /**
     * このノードが直接所有する子ノードを構文上の順序で返す。
     */
    get children(): AbstractSyntaxNode[] {
        return [this.block];
    }

    /**
     * この構文木をPythonのソース表現へ変換し、必要な括弧・字下げを補う。
     */
    toString(): string {
        if (this._str === undefined) {
            const source = this.block.toString();
            this._str = source === "" ? "" : `${source}\n`;
        }
        return this._str;
    }
}

/**
 * 元ソースを保持するPythonプログラムの最外側スコープ。
 */
export class Module extends Domain {
    /** charPosに対応する元のPythonソース。parsePythonで設定する。 */
    source: string | undefined;
}
