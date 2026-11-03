/** 添字アクセスを表すAppの演算子名。WebGPU側と共通の表記。 */
export const indexOpr = "t[i]";

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
    charPos = 0;
    parent: AbstractSyntaxNode | undefined;
    protected _str?: string;

    abstract toString(): string;

    get children(): AbstractSyntaxNode[] {
        return [];
    }

    setParent(parent: AbstractSyntaxNode | undefined = undefined): void {
        this.parent = parent;
        for (const child of this.children) {
            child.setParent(this);
        }
    }

    getAll(alls: AbstractSyntaxNode[]): void {
        alls.push(this);
        for (const child of this.children) {
            child.getAll(alls);
        }
    }

    ancestors(): AbstractSyntaxNode[] {
        const result: AbstractSyntaxNode[] = [];
        for (let node: AbstractSyntaxNode | undefined = this; node !== undefined; node = node.parent) {
            result.push(node);
        }
        return result;
    }

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

    isApp(fncName: string): this is App {
        return this instanceof App && this.fncName === fncName;
    }

    isAssignmentApp(): boolean {
        return this instanceof App && isAssignmentToken(this.fncName);
    }
}

/** 数値リテラル。負号は単項演算のAppとして保持する。 */
export class ConstNum extends Term {
    value: number;

    constructor(public text: string) {
        super();
        this.value = Number(text);
    }

    toString(): string {
        if (this._str === undefined) {
            this._str = this.text;
        }
        return this._str;
    }
}

/** 通常文字列。textは引用符を除いた原文で、エスケープは未解釈。 */
export class Str extends Term {
    constructor(public text: string) {
        super();
    }

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
    constructor(public name: string) {
        super();
    }

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

    constructor(public fnc: RefVar, public args: Term[]) {
        super();
    }

    get fncName(): string {
        return this.fnc.name;
    }

    get children(): AbstractSyntaxNode[] {
        return [this.fnc, ...this.args];
    }

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
    moduleName: string | undefined;
    imports: { name: string; alias: string | undefined }[] = [];

    constructor(public keyword: "" | "pass" | "break" | "continue" | "import" = "") {
        super();
    }

    isAssignmentCall(): boolean {
        return this instanceof CallStatement && this.app.isAssignmentApp();
    }

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
    constructor(public app: Term) {
        super();
    }

    get children(): AbstractSyntaxNode[] {
        return [this.app];
    }

    toString(): string {
        if (this._str === undefined) {
            this._str = this.app.toString();
        }
        return this._str;
    }
}

export class ReturnStatement extends Statement {
    constructor(public value: Term | undefined) {
        super();
    }

    get children(): AbstractSyntaxNode[] {
        return this.value === undefined ? [] : [this.value];
    }

    toString(): string {
        if (this._str === undefined) {
            this._str = this.value === undefined ? "return" : `return ${this.value}`;
        }
        return this._str;
    }
}

/** ソース順の文列。Pythonではブロックごとの変数スコープは作らない。 */
export class BlockStatement extends Statement {
    constructor(public statements: Statement[]) {
        super();
    }

    get children(): AbstractSyntaxNode[] {
        return this.statements;
    }

    toString(): string {
        if (this._str === undefined) {
            this._str = this.statements.map(statement => statement.toString()).join("\n");
        }
        return this._str;
    }
}

export class IfStatement extends Statement {
    constructor(
        public condition: Term,
        public ifBlock: BlockStatement,
        public elseIf: IfStatement | undefined = undefined,
        public elseBlock: BlockStatement | undefined = undefined
    ) {
        super();
    }

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

export class WhileStatement extends Statement {
    constructor(public condition: Term, public block: BlockStatement) {
        super();
    }

    get children(): AbstractSyntaxNode[] {
        return [this.condition, this.block];
    }

    toString(): string {
        if (this._str === undefined) {
            this._str = `while ${this.condition}:\n${formatSuite(this.block)}`;
        }
        return this._str;
    }
}

/** 関数の仮引数、forの単一の束縛先。型宣言は持たない。 */
export class Variable extends AbstractSyntaxNode {
    constructor(public name: string) {
        super();
    }

    toString(): string {
        if (this._str === undefined) {
            this._str = this.name;
        }
        return this._str;
    }
}

/** Pythonのfor ... in ...。listにはrange等の呼出しも保持できる。 */
export class ForStatement extends Statement {
    constructor(public initializer: Variable, public list: Term, public block: BlockStatement) {
        super();
    }

    get children(): AbstractSyntaxNode[] {
        return [this.initializer, this.list, this.block];
    }

    toString(): string {
        if (this._str === undefined) {
            this._str = `for ${this.initializer} in ${this.list}:\n${formatSuite(this.block)}`;
        }
        return this._str;
    }
}

/** Pythonのdefは実行順を保つため、文列中にも保持する。 */
export class Fn extends Statement {
    constructor(public name: string, public args: Variable[], public block: BlockStatement) {
        super();
    }

    get children(): AbstractSyntaxNode[] {
        return [...this.args, this.block];
    }

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
    constructor(public block: BlockStatement) {
        super();
    }

    get fns(): Fn[] {
        return this.block.statements.filter(statement => statement instanceof Fn);
    }

    get children(): AbstractSyntaxNode[] {
        return [this.block];
    }

    toString(): string {
        if (this._str === undefined) {
            const source = this.block.toString();
            this._str = source === "" ? "" : `${source}\n`;
        }
        return this._str;
    }
}

export class Module extends Domain {
}
