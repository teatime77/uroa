import { fetchText, msg } from "@i18n";
import { Token, TokenSubType, TokenType } from "../../../parser/ts/lex.js";
import { lexicalAnalysis } from "./lex.js";
import {
    AbstractSyntaxNode, App, BlockStatement, CallStatement, ConstNum, Fn,
    ForStatement, IfStatement, Module, RefVar, ReturnStatement, Statement,
    Str, Term, Variable, WhileStatement, indexOpr, isAssignmentToken
} from "./syntax.js";

/** 改行を保持し、Pythonサブセットを再帰下降で解析する。 */
export class Parser {
    private loopDepth = 0;
    private functionDepth = 0;
    private readonly endToken: Token;

    constructor(public tokens: Token[], public tokenPos = 0) {
        const position = tokens.length === 0 ? 0 : tokens[tokens.length - 1].charPos;
        this.endToken = new Token(TokenType.eot, TokenSubType.unknown, "", position);
    }

    get token(): Token {
        return this.tokens[this.tokenPos] ?? this.endToken;
    }

    current(): string {
        return this.token.text;
    }

    next(): void {
        if (!this.isEoT()) {
            this.tokenPos++;
        }
    }

    isEoT(): boolean {
        return this.token.typeTkn === TokenType.eot;
    }

    private fail(message: string): never {
        throw new SyntaxError(`${message} (charPos=${this.token.charPos})`);
    }

    private at<T extends AbstractSyntaxNode>(node: T, position: number): T {
        node.charPos = position;
        return node;
    }

    // Stringのtextも引用符を除いた値なので、文字列だけでは記号と判定しない。
    private tokenIs(token: Token | undefined, word: string): boolean {
        return token !== undefined
            && (token.typeTkn === TokenType.symbol || token.typeTkn === TokenType.reservedWord)
            && token.text === word;
    }

    private isToken(word: string): boolean {
        return this.tokenIs(this.token, word);
    }

    private match(word: string): boolean {
        if (!this.isToken(word)) {
            return false;
        }
        this.next();
        return true;
    }

    nextToken(word: string): void {
        if (!this.match(word)) {
            this.fail(`${word}が必要です`);
        }
    }

    readText(): string {
        const text = this.current();
        this.next();
        return text;
    }

    readName(): string {
        if (this.token.typeTkn !== TokenType.identifier) {
            this.fail("識別子が必要です");
        }
        return this.readText();
    }

    private skipNewLine(): void {
        while (this.token.typeTkn === TokenType.newLine) {
            this.next();
        }
    }

    private isLineEnd(): boolean {
        return this.token.typeTkn === TokenType.newLine || this.isEoT();
    }

    private application(operator: string, args: Term[], position: number): App {
        return this.at(new App(this.at(new RefVar(operator), position), args), position);
    }

    /** モジュール直下の文を順に読み、完成した木のparentを設定する。 */
    parseSource(): Module {
        const statements: Statement[] = [];
        this.skipNewLine();
        while (!this.isEoT()) {
            statements.push(this.parseStatement());
            this.skipNewLine();
        }
        const module = new Module(new BlockStatement(statements));
        module.setParent();
        return module;
    }

    parseStatement(): Statement {
        if (this.isToken("if")) {
            return this.parseIf();
        }
        if (this.isToken("while")) {
            return this.parseWhile();
        }
        if (this.isToken("for")) {
            return this.parseFor();
        }
        if (this.isToken("def")) {
            return this.readFn();
        }
        const statement = this.readSimpleStatement();
        if (!this.isLineEnd()) {
            this.fail("文の後に改行が必要です");
        }
        this.skipNewLine();
        return statement;
    }

    private readSimpleStatement(): Statement {
        const position = this.token.charPos;
        if (this.match("return")) {
            if (this.functionDepth === 0) {
                this.fail("returnは関数内でのみ使えます");
            }
            const value = this.isLineEnd()
                ? undefined : this.LogicalExpression();
            return this.at(new ReturnStatement(value), position);
        }
        for (const keyword of ["pass", "break", "continue"] as const) {
            if (this.match(keyword)) {
                if (keyword !== "pass" && this.loopDepth === 0) {
                    this.fail(`${keyword}はループ内でのみ使えます`);
                }
                return this.at(new Statement(keyword), position);
            }
        }
        if (this.isToken("import") || this.isToken("from")) {
            return this.readImport();
        }
        return this.at(new CallStatement(this.parseAssignment()), position);
    }

    /** コロンの後の単一の単純文、または改行とINDENTで始まる文列。 */
    parseBlock(): BlockStatement {
        const position = this.token.charPos;
        this.nextToken(":");
        if (this.token.typeTkn !== TokenType.newLine) {
            const statement = this.readSimpleStatement();
            if (!this.isLineEnd()) {
                this.fail("文の後に改行が必要です");
            }
            this.skipNewLine();
            return this.at(new BlockStatement([statement]), position);
        }
        this.skipNewLine();
        this.nextToken("INDENT");
        const statements: Statement[] = [];
        while (!this.isToken("DEDENT") && !this.isEoT()) {
            statements.push(this.parseStatement());
            this.skipNewLine();
        }
        if (statements.length === 0) {
            this.fail("ブロックに文が必要です。空にする場合はpassを使います");
        }
        this.nextToken("DEDENT");
        return this.at(new BlockStatement(statements), position);
    }

    parseIf(): IfStatement {
        const position = this.token.charPos;
        if (!this.match("if")) {
            this.nextToken("elif");
        }
        const condition = this.LogicalExpression();
        const block = this.parseBlock();
        let elseIf: IfStatement | undefined;
        let elseBlock: BlockStatement | undefined;
        if (this.isToken("elif")) {
            elseIf = this.parseIf();
        }
        else if (this.match("else")) {
            elseBlock = this.parseBlock();
        }
        return this.at(new IfStatement(condition, block, elseIf, elseBlock), position);
    }

    private readLoopBlock(): BlockStatement {
        this.loopDepth++;
        try {
            return this.parseBlock();
        }
        finally {
            this.loopDepth--;
        }
    }

    parseWhile(): WhileStatement {
        const position = this.token.charPos;
        this.nextToken("while");
        const condition = this.LogicalExpression();
        return this.at(new WhileStatement(condition, this.readLoopBlock()), position);
    }

    parseFor(): ForStatement {
        const position = this.token.charPos;
        this.nextToken("for");
        const targetPosition = this.token.charPos;
        const target = this.at(new Variable(this.readName()), targetPosition);
        this.nextToken("in");
        const list = this.LogicalExpression();
        return this.at(new ForStatement(target, list, this.readLoopBlock()), position);
    }

    readFn(): Fn {
        const position = this.token.charPos;
        this.nextToken("def");
        const name = this.readName();
        this.nextToken("(");
        const args: Variable[] = [];
        while (!this.isToken(")")) {
            const argumentPosition = this.token.charPos;
            const argument = this.readName();
            if (args.some(arg => arg.name === argument)) {
                this.fail(`仮引数が重複しています: ${argument}`);
            }
            args.push(this.at(new Variable(argument), argumentPosition));
            if (!this.match(",")) {
                break;
            }
        }
        this.nextToken(")");
        const previousLoopDepth = this.loopDepth;
        this.loopDepth = 0;
        this.functionDepth++;
        try {
            return this.at(new Fn(name, args, this.parseBlock()), position);
        }
        finally {
            this.functionDepth--;
            this.loopDepth = previousLoopDepth;
        }
    }

    private readModuleName(): string {
        let name = this.readName();
        while (this.match(".")) {
            name += `.${this.readName()}`;
        }
        return name;
    }

    private readImport(): Statement {
        const statement = this.at(new Statement("import"), this.token.charPos);
        if (this.match("from")) {
            statement.moduleName = this.readModuleName();
        }
        this.nextToken("import");
        const parenthesized = statement.moduleName !== undefined && this.match("(");
        while (true) {
            const name = statement.moduleName === undefined ? this.readModuleName() : this.readName();
            const alias = this.match("as") ? this.readName() : undefined;
            statement.imports.push({ name, alias });
            if (!this.match(",")) {
                break;
            }
            if (parenthesized && this.isToken(")")) {
                break;
            }
        }
        if (parenthesized) {
            this.nextToken(")");
        }
        return statement;
    }

    parseAssignment(): Term {
        const left = this.LogicalExpression();
        if (this.token.typeTkn !== TokenType.symbol || !isAssignmentToken(this.current())) {
            return left;
        }
        const operator = this.readText();
        const assignable = left instanceof RefVar && !["True", "False", "None"].includes(left.name)
            || left instanceof App && [".", indexOpr].includes(left.fncName);
        if (!assignable) {
            this.fail("代入先には変数・属性・添字が必要です");
        }
        return this.application(operator, [left, this.LogicalExpression()], left.charPos);
    }

    /** 通常の位置引数・リスト要素。末尾のカンマも許可する。 */
    readComma(start: string, end: string): Term[] {
        this.nextToken(start);
        const terms: Term[] = [];
        while (!this.isToken(end)) {
            terms.push(this.LogicalExpression());
            if (!this.match(",")) {
                break;
            }
        }
        this.nextToken(end);
        return terms;
    }

    PrimaryExpression(): Term {
        const position = this.token.charPos;
        let term: Term;
        if (this.token.typeTkn === TokenType.Number) {
            term = this.at(new ConstNum(this.readText()), position);
        }
        else if (this.token.typeTkn === TokenType.String) {
            term = this.at(new Str(this.readText()), position);
        }
        else if (this.token.typeTkn === TokenType.identifier
            || ["True", "False", "None"].some(word => this.isToken(word))) {
            term = this.at(new RefVar(this.readText()), position);
        }
        else if (this.isToken("[")) {
            term = this.application("[]", this.readComma("[", "]"), position);
        }
        else if (this.match("(")) {
            if (this.match(")")) {
                term = this.application(",", [], position);
            }
            else {
                const first = this.LogicalExpression();
                if (this.match(",")) {
                    const items = [first];
                    while (!this.isToken(")")) {
                        items.push(this.LogicalExpression());
                        if (!this.match(",")) {
                            break;
                        }
                    }
                    term = this.application(",", items, position);
                }
                else {
                    term = first;
                }
                this.nextToken(")");
            }
        }
        else {
            this.fail("式が必要です（未対応の構文を含む可能性があります）");
        }

        while (true) {
            if (this.isToken("(")) {
                const args = this.readComma("(", ")");
                term = term instanceof RefVar
                    ? this.at(new App(term, args), position)
                    : this.application("()", [term, ...args], position);
            }
            else if (this.match("[")) {
                const index = this.LogicalExpression();
                this.nextToken("]");
                term = this.application(indexOpr, [term, index], position);
            }
            else if (this.match(".")) {
                const fieldPosition = this.token.charPos;
                const field = this.at(new RefVar(this.readName()), fieldPosition);
                term = this.application(".", [term, field], position);
            }
            else {
                return term;
            }
        }
    }

    PowerExpression(): Term {
        const left = this.PrimaryExpression();
        if (this.match("**")) {
            return this.application("**", [left, this.UnaryExpression()], left.charPos);
        }
        return left;
    }

    UnaryExpression(): Term {
        if (["+", "-", "~"].some(word => this.isToken(word))) {
            const position = this.token.charPos;
            const operator = this.readText();
            return this.application(operator, [this.UnaryExpression()], position);
        }
        return this.PowerExpression();
    }

    private readBinary(operand: () => Term, operators: string[]): Term {
        let left = operand();
        while (operators.some(word => this.isToken(word))) {
            const operator = this.readText();
            left = this.application(operator, [left, operand()], left.charPos);
        }
        return left;
    }

    MultiplicativeExpression(): Term {
        return this.readBinary(() => this.UnaryExpression(), ["*", "/", "//", "%"]);
    }

    AdditiveExpression(): Term {
        return this.readBinary(() => this.MultiplicativeExpression(), ["+", "-"]);
    }

    ShiftExpression(): Term {
        return this.readBinary(() => this.AdditiveExpression(), ["<<", ">>"]);
    }

    ArithmeticExpression(): Term {
        const bitAnd = (): Term => this.readBinary(() => this.ShiftExpression(), ["&"]);
        const bitXor = (): Term => this.readBinary(bitAnd, ["^"]);
        return this.readBinary(bitXor, ["|"]);
    }

    RelationalExpression(): Term {
        const terms = [this.ArithmeticExpression()];
        const operators: string[] = [];
        while (true) {
            let operator: string;
            if (["==", "!=", "<", ">", "<=", ">=", "in", "is"].some(word => this.isToken(word))) {
                operator = this.readText();
                if (operator === "is" && this.match("not")) {
                    operator = "is not";
                }
            }
            else if (this.isToken("not") && this.tokenIs(this.tokens[this.tokenPos + 1], "in")) {
                this.nextToken("not");
                this.nextToken("in");
                operator = "not in";
            }
            else {
                break;
            }
            operators.push(operator);
            terms.push(this.ArithmeticExpression());
        }
        if (operators.length === 0) {
            return terms[0];
        }
        // 連鎖比較の中間値を複製せず保持し、VMが1度ずつ評価できる形にする。
        const app = this.application("<compare>", terms, terms[0].charPos);
        app.comparisonOperators = operators;
        return app;
    }

    private NotExpression(): Term {
        const position = this.token.charPos;
        if (this.match("not")) {
            return this.application("not", [this.NotExpression()], position);
        }
        return this.RelationalExpression();
    }

    AndExpression(): Term {
        return this.readBinary(() => this.NotExpression(), ["and"]);
    }

    OrExpression(): Term {
        return this.readBinary(() => this.AndExpression(), ["or"]);
    }

    LogicalExpression(): Term {
        return this.OrExpression();
    }
}

/** ソース文字列からPython用Moduleを作る入口。 */
export function parsePython(text: string): Module {
    return new Parser(lexicalAnalysis(text)).parseSource();
}

export async function testPython(){
    const text = await fetchText("/diagram/python/a.py")
    msg(`python:${text}`)
    const mod = parsePython(text);
    msg(`  module:${mod.block}`)
}