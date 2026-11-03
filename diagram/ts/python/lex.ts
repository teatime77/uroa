import { Token, TokenSubType, TokenType } from "../../../parser/ts/lex.js";

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
 * charPosは入力string内のUTF-16位置。字句エラーは位置付きSyntaxErrorにする。
 */
export function lexicalAnalysis(text: string): Token[] {
    const tokens: Token[] = [];
    const indents: number[] = [0];
    const brackets: string[] = [];
    const identifierPattern = /[A-Za-z_][A-Za-z0-9_]*/y;
    const numberPattern = /(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/y;
    let pos = 0;
    let atLineStart = true;
    let hasCode = false;

    function fail(message: string, position: number): never {
        throw new SyntaxError(`${message} (charPos=${position})`);
    }

    function add(type: TokenType, word: string, position: number, subType = TokenSubType.unknown): void {
        tokens.push(new Token(type, subType, word, position));
    }

    function newlineLength(position: number): number {
        if (text[position] === "\r") {
            return text[position + 1] === "\n" ? 2 : 1;
        }
        return text[position] === "\n" ? 1 : 0;
    }

    while (pos < text.length) {
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

        if (ch === "\"" || ch === "'") {
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
