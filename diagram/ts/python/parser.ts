/**
 * lex.tsのトークン列をsyntax.tsの構文木へ変換する再帰下降解析器。名前・型の意味解析はsemantic.ts、生成はbytecode.tsが担当する。
 */
/**
 * lex.tsが文字列部分・置換式・書式に分けたトークンを、このファイルで解析し、
 * syntax.tsのApp・Str・Termで保持する。bytecode.tsは意味解析結果を必須とする
 * アセンブリ・バイナリ生成まで対応する。ESP32のbytecode_vm.cppが新形式を実行し、
 * 機器APIはdevice_api.generated.cppの生成スタブを通して呼び出す。
 */
import { fetchText, msg } from "@i18n";
import { Token, TokenSubType, TokenType, lexicalAnalysis } from "./lex.js";
import {
    AbstractSyntaxNode, App, BlockStatement, CallStatement, ClassDefinition, ConstNum, Fn, KeywordArgument,
    ForStatement, GlobalStatement, IfStatement, Module, RefVar, ReturnStatement, Statement,
    Str, Term, Variable, WhileStatement, indexOpr, isAssignmentToken
} from "./syntax.js";
import { generateAssembly, generateBytecode } from "./bytecode.js";
import { analyzePython } from "./semantic.js";

/** 改行を保持し、Pythonサブセットを再帰下降で解析する。 */
export class Parser {
    /**
     * break/continueを許可する繰返し本体の入れ子の深さ。
     */
    private loopDepth = 0;
    /**
     * returnを許可する関数本体の入れ子の深さ。
     */
    private functionDepth = 0;
    /**
     * クラス本体の入れ子を防ぐための解析状態。
     */
    private classDepth = 0;
    /**
     * 入力トークンの末尾で使用する安全なeotトークン。
     */
    private readonly endToken: Token;

    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(/** 字句解析で得た元位置付きのトークン列。 */ public tokens: Token[], /** 次に解析するトークンの添字。next()が更新する。 */ public tokenPos = 0) {
        const position = tokens.length === 0 ? 0 : tokens[tokens.length - 1].charPos;
        this.endToken = new Token(TokenType.eot, TokenSubType.unknown, "", position);
    }

    /**
     * 現在位置のトークンを返す。入力末尾ではeotを返す。
     */
    get token(): Token {
        return this.tokens[this.tokenPos] ?? this.endToken;
    }

    /**
     * 現在位置のトークンの原文を返す。
     */
    current(): string {
        return this.token.text;
    }

    /**
     * eotを越えない範囲でトークン位置を一つ進める。
     */
    next(): void {
        if (!this.isEoT()) {
            this.tokenPos++;
        }
    }

    /**
     * 現在位置が入力トークン列の終端かを調べる。
     */
    isEoT(): boolean {
        return this.token.typeTkn === TokenType.eot;
    }

    /**
     * 現在トークンの元位置を含むSyntaxErrorを投げる。
     *
     * @param message 画面または診断に表示する説明。
     */
    private fail(message: string): never {
        throw new SyntaxError(`${message} (charPos=${this.token.charPos})`);
    }

    /**
     * 作成したノードに元ソースのUTF-16位置を設定して返す。
     *
     * @param node 対応する構文木のノード。
     * @param position 基準となる座標またはソース内の位置。
     */
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

    /**
     * 現在の記号・予約語トークンが指定した綴りと一致するかを調べる。
     */
    private isToken(word: string): boolean {
        return this.tokenIs(this.token, word);
    }

    /**
     * 現在トークンが指定した記号・予約語なら消費してtrueを返す。
     */
    private match(word: string): boolean {
        if (!this.isToken(word)) {
            return false;
        }
        this.next();
        return true;
    }

    /**
     * 指定した記号・予約語を要求して消費する。不一致なら構文エラーにする。
     */
    nextToken(word: string): void {
        if (!this.match(word)) {
            this.fail(`${word}が必要です`);
        }
    }

    /**
     * 現在のトークン原文を返し、解析位置を一つ進める。
     */
    readText(): string {
        const text = this.current();
        this.next();
        return text;
    }

    /**
     * 識別子トークンを要求し、その名前を読んで先へ進める。
     */
    readName(): string {
        if (this.token.typeTkn !== TokenType.identifier) {
            this.fail("識別子が必要です");
        }
        return this.readText();
    }

    /**
     * 連続する論理改行トークンを消費する。
     */
    private skipNewLine(): void {
        while (this.token.typeTkn === TokenType.newLine) {
            this.next();
        }
    }

    /**
     * 現在位置が論理改行または入力終端かを調べる。
     */
    private isLineEnd(): boolean {
        return this.token.typeTkn === TokenType.newLine || this.isEoT();
    }

    /**
     * 演算子参照と引数から、元位置を持つAppノードを作る。
     *
     * @param position 基準となる座標またはソース内の位置。
     */
    private application(operator: string, args: Term[], position: number): App {
        return this.at(new App(this.at(new RefVar(operator), position), args), position);
    }

    /**
     * モジュール直下の文を順に読み、完成した木のparentを設定する。
     *
     * 各ノードに元のcharPosを設定し、parseSource完了時に通常どおりparentを設定する。
     */
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

    /**
     * if・while・for・class・defまたは単純文を読み、文末の改行も検査する。
     * @returns 元位置を保持した文の構文木。
     * @throws {SyntaxError} 文の構文や制御文の配置が不正な場合。
     */
    parseStatement(): Statement {
        if (this.isToken("class")) {
            return this.readClass();
        }
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

    /**
     * global・return・制御キーワード・importまたは式文を読む。
     *
     * global文はGlobalStatementに識別子ごとの元位置を保持する。宣言の適用範囲・順序検査は
     * global-scope.tsでsemantic.tsが検査し、bytecode.tsはその解析結果を使う。global文自体に実行時命令はない。
     */
    private readSimpleStatement(): Statement {
        const position = this.token.charPos;
        if (this.match("global")) {
            const names: Variable[] = [];
            do {
                const namePosition = this.token.charPos;
                names.push(this.at(new Variable(this.readName()), namePosition));
            } while (this.match(","));
            return this.at(new GlobalStatement(names), position);
        }
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

    /**
     * 条件とif本体を読み、続くelif・elseを同じ分岐ノードへまとめる。
     */
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

    /**
     * 繰返し深さを一時的に増やして本体を読み、終了時に深さを戻す。
     */
    private readLoopBlock(): BlockStatement {
        this.loopDepth++;
        try {
            return this.parseBlock();
        }
        finally {
            this.loopDepth--;
        }
    }

    /**
     * whileの条件と本体を解析して位置付きの文ノードを返す。
     */
    parseWhile(): WhileStatement {
        const position = this.token.charPos;
        this.nextToken("while");
        const condition = this.LogicalExpression();
        return this.at(new WhileStatement(condition, this.readLoopBlock()), position);
    }

    /**
     * forの変数名・反復対象式・本体を構文木として読む。生成対応の判定は後段で行う。
     */
    parseFor(): ForStatement {
        const position = this.token.charPos;
        this.nextToken("for");
        const targetPosition = this.token.charPos;
        const target = this.at(new Variable(this.readName()), targetPosition);
        this.nextToken("in");
        const list = this.LogicalExpression();
        return this.at(new ForStatement(target, list, this.readLoopBlock()), position);
    }

    /**
     * クラス名と本体を読む。継承・入れ子のクラスは対象外とする。
     * 型・フィールド配置とクラス本体の制約は後段の意味解析で検査する。
     * @returns クラス名・本体・元位置を保持したクラス宣言。
     * @throws {SyntaxError} 定義位置・継承指定・本体の構文が不正な場合。
     */
    private readClass(): ClassDefinition {
        if (this.functionDepth !== 0 || this.classDepth !== 0) {
            this.fail("クラス定義はモジュール直下に置いてください");
        }
        const position = this.token.charPos;
        this.nextToken("class");
        const name = this.readName();
        if (this.match("(")) {
            if (!this.match(")")) {
                this.fail("クラスの継承は未対応です");
            }
        }
        const previousLoopDepth = this.loopDepth;
        this.loopDepth = 0;
        this.classDepth++;
        try {
            return this.at(new ClassDefinition(name, this.parseBlock()), position);
        }
        finally {
            this.classDepth--;
            this.loopDepth = previousLoopDepth;
        }
    }

    /**
     * 関数名・重複のない仮引数・本体を読み、関数内の制御文の配置を検査する。
     */
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

    /**
     * ドットで連なるimport用のモジュール名を読む。
     */
    private readModuleName(): string {
        let name = this.readName();
        while (this.match(".")) {
            name += `.${this.readName()}`;
        }
        return name;
    }

    /**
     * import/fromの対象名と別名を構文木に保持する。実際のモジュールは読み込まない。
     */
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

    /**
     * 左辺の変数・属性・添字を検査し、単純代入または複合代入の式を読む。
     */
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

    /**
     * 呼出し引数を評価順に保持する。名前と値をKeywordArgumentで区別する。
     * 同じキーワードの重複と、キーワード後の位置引数は構文エラーにする。
     * *args・**kwargsは扱わない。引数名の存在・必須引数・型は意味解析が検査する。
     * @returns 位置引数とキーワード引数をソース順に保持した一覧。
     * @throws {SyntaxError} 引数の構文・順序・キーワードの重複が不正な場合。
     */
    private readCallArguments(): Term[] {
        this.nextToken("(");
        const args: Term[] = [];
        const names = new Set<string>();
        let keywordSeen = false;
        while (!this.isToken(")")) {
            if (this.token.typeTkn === TokenType.identifier && this.tokenIs(this.tokens[this.tokenPos + 1], "=")) {
                const position = this.token.charPos;
                const name = this.current();
                if (names.has(name)) {
                    this.fail(`キーワード引数が重複しています: ${name}`);
                }
                names.add(name);
                this.next();
                this.nextToken("=");
                args.push(this.at(new KeywordArgument(name, this.LogicalExpression()), position));
                keywordSeen = true;
            }
            else {
                if (keywordSeen) {
                    this.fail("キーワード引数の後に位置引数は指定できません");
                }
                args.push(this.LogicalExpression());
            }
            if (!this.match(",")) {
                break;
            }
        }
        this.nextToken(")");
        return args;
    }

    /**
     * f文字列を、文字列部分・置換式・@format呼出しを引数とするAppへ変換する。
     *
     * 開始記号は f"・f'・F"・F' を受け付け、対応する終了引用符までを読む。
     * いずれも関数名を f" に統一したAppとし、argsに各部分を出現順で格納する。
     * 文字列部分は原文を保持したStr、書式のない置換式は解析したTermをそのまま格納する。
     * 書式のある置換式はApp(RefVar("@format"), [式のTerm, 書式指定文字列のStr])とする。
     * 例: f"a + b={a + b:.2f}" は次の構文木になる。
     * App(RefVar('f"'), [Str("a + b="),
     *     App(RefVar("@format"), [App(RefVar("+"), [RefVar("a"), RefVar("b")]), Str(".2f")])])
     * 空のf文字列は引数なしのApp。複数の置換フィールドとf文字列の入れ子に対応する。
     * 置換式の対応範囲はLogicalExpressionと同じで、空の式や不正な区切りはSyntaxError。
     * コロン後はformat型トークンを必須とし、空の書式もStr("")として保持する。
     * 書式の桁・精度・型の制約とエスケープの原文保持はlex.tsのlexicalAnalysis()の仕様に従う。
     * この解析は構文木の生成のみを行い、f文字列専用のtoStringによる再生成は未対応。
     */
    private readFString(): App {
        const position = this.token.charPos;
        const quote = this.readText().slice(-1);
        const args: Term[] = [];
        while (!this.isToken(quote)) {
            if (this.token.typeTkn === TokenType.String) {
                const stringPosition = this.token.charPos;
                args.push(this.at(new Str(this.readText()), stringPosition));
            }
            else if (this.match("{")) {
                let term = this.LogicalExpression();
                if (this.match(":")) {
                    if (this.token.typeTkn !== TokenType.format) {
                        this.fail("f文字列の書式指定が必要です");
                    }
                    const formatPosition = this.token.charPos;
                    const format = this.at(new Str(this.readText()), formatPosition);
                    term = this.application("@format", [term, format], term.charPos);
                }
                this.nextToken("}");
                args.push(term);
            }
            else {
                this.fail("f文字列の文字列部分・置換フィールド・終了引用符が必要です");
            }
        }
        this.nextToken(quote);
        return this.application('f"', args, position);
    }

    /**
     * リテラル・名前・括弧式を読み、呼出し・属性・添字の後置式を連結する。
     * @returns 後置式を含む、元位置付きの式の構文木。
     * @throws {SyntaxError} 式や後置式の構文が不正な場合。
     */
    PrimaryExpression(): Term {
        const position = this.token.charPos;
        let term: Term;
        if (this.token.typeTkn === TokenType.Number) {
            term = this.at(new ConstNum(this.readText()), position);
        }
        else if (this.token.typeTkn === TokenType.String) {
            term = this.at(new Str(this.readText()), position);
        }
        else if (['f"', "f'", 'F"', "F'"].some(word => this.isToken(word))) {
            term = this.readFString();
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
                const args = this.readCallArguments();
                term = term instanceof RefVar
                    ? this.at(new App(term, args), position)
                    : this.application("()", [term, ...args], position);
            }
            else if (this.isToken("[")) {
                const indices = this.readComma("[", "]");
                if (indices.length === 0) {
                    this.fail("添字を1個以上指定してください");
                }
                term = this.application(indexOpr, [term, ...indices], position);
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

    /**
     * 単項式との結合順を保ちながら、累乗の右結合を解析する。
     */
    PowerExpression(): Term {
        const left = this.PrimaryExpression();
        if (this.match("**")) {
            return this.application("**", [left, this.UnaryExpression()], left.charPos);
        }
        return left;
    }

    /**
     * 単項の正負・ビット反転を再帰的に読み取る。
     */
    UnaryExpression(): Term {
        if (["+", "-", "~"].some(word => this.isToken(word))) {
            const position = this.token.charPos;
            const operator = this.readText();
            return this.application(operator, [this.UnaryExpression()], position);
        }
        return this.PowerExpression();
    }

    /**
     * 一段強い式を順に読み、指定した二項演算子を左結合でまとめる。
     */
    private readBinary(operand: () => Term, operators: string[]): Term {
        let left = operand();
        while (operators.some(word => this.isToken(word))) {
            const operator = this.readText();
            left = this.application(operator, [left, operand()], left.charPos);
        }
        return left;
    }

    /**
     * 乗算・除算・整数除算・剰余の優先順位の式を読む。
     */
    MultiplicativeExpression(): Term {
        return this.readBinary(() => this.UnaryExpression(), ["*", "/", "//", "%"]);
    }

    /**
     * 加算・減算の優先順位の式を読む。
     */
    AdditiveExpression(): Term {
        return this.readBinary(() => this.MultiplicativeExpression(), ["+", "-"]);
    }

    /**
     * 左右ビットシフトの優先順位の式を読む。
     */
    ShiftExpression(): Term {
        return this.readBinary(() => this.AdditiveExpression(), ["<<", ">>"]);
    }

    /**
     * ビットAND・XOR・ORを含む比較より強い式を読む。
     */
    ArithmeticExpression(): Term {
        const bitAnd = (): Term => this.readBinary(() => this.ShiftExpression(), ["&"]);
        const bitXor = (): Term => this.readBinary(bitAnd, ["^"]);
        return this.readBinary(bitXor, ["|"]);
    }

    /**
     * 比較演算子と連鎖する左右の式を比較ノードへまとめる。
     */
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

    /**
     * 比較より弱く結合するnotの単項式を読む。
     */
    private NotExpression(): Term {
        const position = this.token.charPos;
        if (this.match("not")) {
            return this.application("not", [this.NotExpression()], position);
        }
        return this.RelationalExpression();
    }

    /**
     * not式をandで連ねた論理式を読む。
     */
    AndExpression(): Term {
        return this.readBinary(() => this.NotExpression(), ["and"]);
    }

    /**
     * and式をorで連ねた論理式を読む。
     */
    OrExpression(): Term {
        return this.readBinary(() => this.AndExpression(), ["or"]);
    }

    /**
     * この構文解析器が対応する最も外側の論理式を読む。
     */
    LogicalExpression(): Term {
        return this.OrExpression();
    }
}

/**
 * ソース文字列からPython用Moduleを作る入口。
 *
 * 構文解析後の名前解決・型推論とimportなしのdevice API利用はsemantic.tsが担当する。
 * parsePythonは同期APIのまま保ち、利用側がawait analyzePython(module)を続けて呼ぶ。
 */
export function parsePython(text: string): Module {
    const module = new Parser(lexicalAnalysis(text)).parseSource();
    module.source = text;
    return module;
}

/** 開発用入口は意味解析付きアセンブリとversion=7のバイト列を表示する。通信は行わない。 */
export async function testPython(){
    const text = await fetchText("/diagram/python/a.py")
    msg(`python:${text}`)
    const mod = parsePython(text);
    msg(`  module:\n${mod.block}`);

    const analysis = await analyzePython(mod);
    // 意味解析は診断を返して続行する。開発用入口でも不完全な結果から生成しない。
    if (analysis.diagnostics.length !== 0) {
        for (const diagnostic of analysis.diagnostics) {
            msg(`  semantic error: ${diagnostic.message} (charPos=${diagnostic.charPos})`);
        }
        return;
    }
    for (const [name, variable] of analysis.globals) {
        msg(`  type ${name}: ${JSON.stringify(variable.type)}`);
    }

    const asm = generateAssembly(analysis);
    msg(`  asm:\n${asm}`);

    const bytecode = generateBytecode(analysis);
    const hex = Array.from(bytecode, value => value.toString(16).padStart(2, "0")).join(" ");
    msg(`  bytecode (${bytecode.byteLength} bytes):\n${hex}`);
}
