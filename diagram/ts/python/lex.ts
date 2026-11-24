/**
 * Pythonサブセットのソースを、位置・インデント・論理改行を持つトークン列へ変換する。f文字列の分割はlexicalAnalysis()、構文木化はparser.tsが担当する。
 */
/**
 * Pythonソースの字句解析と、構文解析へ渡す位置付きトークンを定義する。
 * 構文木化はparser.ts、リテラルの値への変換は後段の生成器が担当する。
 */
export enum TokenType{
    unknown,

    // 識別子
    identifier,

    // クラス
    Class,

    // 数値
    Number,

    // 記号
    symbol,

    // 予約語
    reservedWord,

    // #n.m
    path,

    // End Of Text
    eot,

    // 指定なし
    any,

    // 行コメント
    lineComment,

    // ブロックコメント
    blockComment,

    // 改行
    newLine,

    // 文字列
    String,

    // 書式
    format,

    // 文字
    character,

    // 不正
    illegal
}
    
/**
 * 数値トークンの整数・単精度・倍精度等の補助分類。
 */
export enum TokenSubType {
    unknown,
    integer,
    float,
    double
}

/**
 * 元ソースの位置と原文を保持する字句。
 */
export class Token{
    /**
     * 識別子・記号・改行・文字列等のトークン種別。
     */
    typeTkn:TokenType;
    /**
     * 数値等の補助的なトークン分類。
     */
    subType:TokenSubType;
    /**
     * 部品に表示する文字列。
     */
    text:string;
    /**
     * 元のPythonソース内のUTF-16位置。自動生成命令では-1を使う。
     */
    charPos:number;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param type 検証または配置するデータ型。
     * @param text 処理する文字列。
     */
    public constructor(type : TokenType, sub_type : TokenSubType, text : string, char_pos : number){
        //console.log("" + TokenType[type] + " " + TokenSubType[sub_type] + " " + text + " " + char_pos);
        this.typeTkn = type;
        this.subType = sub_type;
        this.text = text;
        this.charPos = char_pos;
    }
}    

/**
 * Pythonの予約語として識別する字句の集合。
 */
const keywords = new Set([
    "False", "None", "True", "and", "as", "assert", "async", "await",
    "break", "class", "continue", "def", "del", "elif", "else", "except",
    "finally", "for", "from", "global", "if", "import", "in", "is",
    "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try",
    "while", "with", "yield"
]);

// 長い記号を先に照合する。
const symbols = [
    "**=", "//=", "<<=", ">>=", "**", "//", "<<", ">>",
    "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
    "@=", "->", ":=", "+", "-", "*", "/", "%", "&", "|", "^", "~",
    "<", ">", "=", "(", ")", "[", "]", "{", "}", ":", ",", ".", ";", "@"
];

/**
 * ESP32向けPythonサブセットのソースを共通Tokenの列へ変換する。
 * INDENT / DEDENTはsymbol型、論理行の終端はnewLine型で返す。eotは付けない。
 * Stringのtextは引用符を除いた原文で、エスケープの解釈は後段で行う。
 * f文字列は開始・終了引用符と置換フィールドを分離し、書式は桁・精度・型のみ扱う。
 * charPosは入力string内のUTF-16位置。字句エラーは位置付きSyntaxErrorにする。
 *
 * fまたはF接頭辞と、二重引用符または単一引用符の文字列を扱う。
 * 開始（f"等）・終了引用符と置換フィールドの {・}・: はsymbol、
 * 文字列部分はString、置換式は通常の式トークン、コロン後の書式はformatに分ける。
 * 例: f"a + b={a + b:.2f}" は次の順に出力する。
 * symbol f" / String a + b= / symbol { / identifier a / symbol + /
 * identifier b / symbol : / format .2f / symbol } / symbol "
 * 論理行末には通常どおりnewLineを付ける。
 *
 * 書式は [width][.precision][type] のみ。width・precisionは1桁以上の10進数字、
 * typeは b c d e E f F g G n o s x X % のいずれか1文字とし、各要素は省略可能。
 * 配置・符号・桁区切り・書式内の置換フィールドは未対応として拒否する。
 * 文字列中の {{・}} とエスケープは原文のまま保持し、空の文字列部分は出力しない。
 * 通常文字列も引用符を除いた原文を保持し、値への変換は後段で行う。
 * 三重引用符、raw・bytes等の接頭辞付き文字列は未対応として拒否する。
 * f文字列の構文木への変換仕様と後段の対応範囲はparser.tsのreadFString()のコメントを参照する。
 */
export function lexicalAnalysis(text: string): Token[] {
    const tokens: Token[] = [];
    const indents: number[] = [0];
    const brackets: string[] = [];
    const fStrings: { /** 解析中のf文字列を閉じる引用符。 */ quote: string; /** 解析中のf文字列が元ソースで始まったUTF-16位置。 */ start: number; /** 置換式を開始した時点の括弧の深さ。 */ bracketDepth: number; /** f文字列の本文ではなく置換式を読み取っている状態。 */ inExpression: boolean }[] = [];
    const identifierPattern = /[A-Za-z_][A-Za-z0-9_]*/y;
    const numberPattern = /(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/y;
    let pos = 0;
    let atLineStart = true;
    let hasCode = false;

    /**
     * 元のUTF-16位置を含む字句エラーを投げ、解析を終了する。
     *
     * @param message 画面または診断に表示する説明。
     * @param position 基準となる座標またはソース内の位置。
     */
    function fail(message: string, position: number): never {
        throw new SyntaxError(`${message} (charPos=${position})`);
    }

    /**
     * 指定した原文と位置を持つトークンを解析結果の末尾へ追加する。
     *
     * @param type 検証または配置するデータ型。
     * @param position 基準となる座標またはソース内の位置。
     */
    function add(type: TokenType, word: string, position: number, subType = TokenSubType.unknown): void {
        tokens.push(new Token(type, subType, word, position));
    }

    /**
     * 指定位置のLF・CRLF・CRの長さを返す。改行でなければ0。
     *
     * @param position 基準となる座標またはソース内の位置。
     */
    function newlineLength(position: number): number {
        if (text[position] === "\r") {
            return text[position + 1] === "\n" ? 2 : 1;
        }
        return text[position] === "\n" ? 1 : 0;
    }

    while (pos < text.length) {
        const fString = fStrings[fStrings.length - 1];
        if (fString !== undefined && !fString.inExpression) {
            const contentStart = pos;
            while (pos < text.length && text[pos] !== fString.quote) {
                if (newlineLength(pos) !== 0) {
                    fail("f文字列が改行前に閉じられていません", fString.start);
                }
                if (text[pos] === "{" || text[pos] === "}") {
                    if (text[pos + 1] === text[pos]) {
                        // 二重波括弧は文字列の原文として保持する。
                        pos += 2;
                        continue;
                    }
                    if (text[pos] === "}") {
                        fail("f文字列内の単独の閉じ波括弧は使用できません", pos);
                    }
                    break;
                }
                if (text[pos] === "\\") {
                    pos++;
                    // バックスラッシュでは置換フィールドの波括弧をエスケープしない。
                    if (pos < text.length && text[pos] !== "{" && text[pos] !== "}") {
                        pos += newlineLength(pos) || 1;
                    }
                }
                else {
                    pos++;
                }
            }
            if (pos > contentStart) {
                add(TokenType.String, text.slice(contentStart, pos), contentStart);
            }
            if (pos >= text.length) {
                fail("f文字列が閉じられていません", fString.start);
            }
            add(TokenType.symbol, text[pos], pos);
            if (text[pos] === fString.quote) {
                fStrings.pop();
            }
            else {
                brackets.push("{");
                fString.bracketDepth = brackets.length;
                fString.inExpression = true;
            }
            pos++;
            continue;
        }

        if (atLineStart) {
            let width = 0;
            // タブは8桁ごとのタブストップまで進める。
            while (text[pos] === " " || text[pos] === "\t") {
                width += text[pos] === "\t" ? 8 - width % 8 : 1;
                pos++;
            }
            atLineStart = false;
            // 空行・コメントだけの行と括弧内ではインデントを変更しない。
            if (pos < text.length && text[pos] !== "#" && newlineLength(pos) === 0 && brackets.length === 0) {
                if (width > indents[indents.length - 1]) {
                    indents.push(width);
                    add(TokenType.symbol, "INDENT", pos);
                }
                else {
                    while (width < indents[indents.length - 1]) {
                        indents.pop();
                        add(TokenType.symbol, "DEDENT", pos);
                    }
                    if (width !== indents[indents.length - 1]) {
                        fail("インデントが以前の段に一致しません", pos);
                    }
                }
            }
        }

        if (pos >= text.length) {
            break;
        }
        const start = pos;
        const ch = text[pos];
        const lineLength = newlineLength(pos);

        if (fString !== undefined && brackets.length === fString.bracketDepth) {
            if (ch === "}") {
                add(TokenType.symbol, ch, pos);
                brackets.pop();
                fString.inExpression = false;
                pos++;
                continue;
            }
            if (ch === ":") {
                add(TokenType.symbol, ch, pos);
                pos++;
                const formatStart = pos;
                while (pos < text.length && text[pos] !== "}" && text[pos] !== fString.quote && newlineLength(pos) === 0) {
                    pos++;
                }
                const format = text.slice(formatStart, pos);
                // width / .precision / typeはそれぞれ省略可能。配置・符号等は受け付けない。
                if (!/^[0-9]*(?:\.[0-9]+)?[bcdeEfFgGnosxX%]?$/.test(format)) {
                    fail("書式は桁・精度・型のみ対応しています", formatStart);
                }
                if (text[pos] !== "}") {
                    fail("f文字列の置換フィールドが閉じられていません", start);
                }
                add(TokenType.format, format, formatStart);
                continue;
            }
        }

        if (ch === " " || ch === "\t") {
            pos++;
            continue;
        }
        if (ch === "#") {
            while (pos < text.length && newlineLength(pos) === 0) {
                pos++;
            }
            continue;
        }
        if (lineLength !== 0) {
            if (brackets.length === 0 && hasCode) {
                add(TokenType.newLine, "\n", start);
                hasCode = false;
            }
            pos += lineLength;
            atLineStart = true;
            continue;
        }
        if (ch === "\\") {
            const length = newlineLength(pos + 1);
            if (length === 0 || pos + 1 + length === text.length) {
                fail("行継続の後に次の行が必要です", start);
            }
            pos += 1 + length;
            // 継続先の行頭空白は通常の空白として読み飛ばす。
            continue;
        }

        if ((ch === "f" || ch === "F") && (text[pos + 1] === "\"" || text[pos + 1] === "'")) {
            const quote = text[pos + 1];
            if (text.startsWith(quote.repeat(3), pos + 1)) {
                fail("三重引用符の文字列には対応していません", start);
            }
            add(TokenType.symbol, text.slice(pos, pos + 2), start);
            fStrings.push({ quote, start, bracketDepth: brackets.length, inExpression: false });
            pos += 2;
        }
        else if (ch === "\"" || ch === "'") {
            if (text.startsWith(ch.repeat(3), pos)) {
                fail("三重引用符の文字列には対応していません", start);
            }
            pos++;
            const contentStart = pos;
            while (pos < text.length && text[pos] !== ch) {
                if (newlineLength(pos) !== 0) {
                    fail("文字列が改行前に閉じられていません", start);
                }
                if (text[pos] === "\\") {
                    pos++;
                    if (pos < text.length) {
                        pos += newlineLength(pos) || 1;
                    }
                }
                else {
                    pos++;
                }
            }
            if (pos >= text.length) {
                fail("文字列が閉じられていません", start);
            }
            add(TokenType.String, text.slice(contentStart, pos), start);
            pos++;
        }
        else if (/[A-Za-z_]/.test(ch)) {
            identifierPattern.lastIndex = pos;
            const word = identifierPattern.exec(text)![0];
            pos += word.length;
            if (/^(?:[fFrRbBuU]|[bB][rR]|[rR][bBfF]|[fF][rR])$/.test(word)
                && (text[pos] === "\"" || text[pos] === "'")) {
                fail("接頭辞付き文字列には対応していません", start);
            }
            add(keywords.has(word) ? TokenType.reservedWord : TokenType.identifier, word, start);
        }
        else if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(text[pos + 1] ?? ""))) {
            numberPattern.lastIndex = pos;
            const word = numberPattern.exec(text)![0];
            pos += word.length;
            const isFloat = /[.eE]/.test(word);
            if (/[A-Za-z_0-9]/.test(text[pos] ?? "") || (!isFloat && /^0[0-9]*[1-9]/.test(word))) {
                fail("不正または未対応の数値リテラルです", start);
            }
            add(TokenType.Number, word, start, isFloat ? TokenSubType.float : TokenSubType.integer);
        }
        else {
            const symbol = symbols.find(candidate => text.startsWith(candidate, pos));
            if (symbol === undefined) {
                fail(`未対応の文字です: ${ch}`, start);
            }
            if ("([{".includes(symbol)) {
                brackets.push(symbol);
            }
            else if (")]}".includes(symbol)) {
                const expected = "([{"[")]}".indexOf(symbol)];
                if (brackets.pop() !== expected) {
                    fail("閉じ括弧が対応していません", start);
                }
            }
            add(TokenType.symbol, symbol, start);
            pos += symbol.length;
        }
        hasCode = true;
    }

    if (fStrings.length !== 0) {
        fail("f文字列が閉じられていません", fStrings[fStrings.length - 1].start);
    }
    if (brackets.length !== 0) {
        fail("括弧が閉じられていません", text.length);
    }
    if (hasCode) {
        add(TokenType.newLine, "\n", text.length);
    }
    while (indents.length > 1) {
        indents.pop();
        add(TokenType.symbol, "DEDENT", text.length);
    }
    return tokens;
}
