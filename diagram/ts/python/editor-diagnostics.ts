/**
 * semantic.tsの診断と字句・構文例外を、highlight-editor.tsが使うUTF-16範囲へ変換する。
 * python-block.tsがチェックしたソースのスナップショットを渡す。HTMLとしては解釈しない。
 */
import type { PythonDiagnostic } from "./semantic";
import { Term } from "./syntax";

/** endは含まない。EOFではstart=endとし、表示側が1文字幅の波線を補う。 */
export interface PythonEditorDiagnostic {
    start: number;
    end: number;
    message: string;
}

/** charPosが指すトークンの末尾を求める。空白・記号は最低1文字とし、ソース末尾を越えない。 */
function tokenEnd(source: string, position: number): number {
    const text = source.slice(position);
    const token = /^(?:[_\p{ID_Start}][_\p{ID_Continue}]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/u.exec(text);
    if (token !== null) {
        return position + token[0].length;
    }
    if (text[0] === "\"" || text[0] === "'") {
        let end = position + 1;
        while (end < source.length && source[end] !== "\n") {
            if (source[end] === "\\") {
                end = Math.min(end + 2, source.length);
            }
            else if (source[end++] === text[0]) {
                return end;
            }
        }
        return end;
    }
    return Math.min(position + (source.codePointAt(position)! > 0xFFFF ? 2 : 1), source.length);
}

/** 意味診断の式は子ノードまで含め、文・関数全体の診断は開始トークンだけを対象にする。 */
export function semanticEditorDiagnostic(source: string, diagnostic: PythonDiagnostic): PythonEditorDiagnostic {
    const start = Math.max(0, Math.min(diagnostic.charPos, source.length));
    let end = tokenEnd(source, start);
    if (diagnostic.node instanceof Term) {
        const nodes = [diagnostic.node];
        for (const node of nodes) {
            // 型はTermでもchildrenには他の構文木を含め得るため、範囲は元ソース位置だけで決める。
            for (const child of node.children) {
                if (child instanceof Term) {
                    nodes.push(child);
                }
                if (child.charPos >= start && child.charPos <= source.length) {
                    end = Math.max(end, tokenEnd(source, child.charPos));
                }
            }
        }
    }
    return { start, end, message: diagnostic.message };
}

/** 字句・構文解析の最初のエラーだけを表示する。通信・API定義の失敗に仮のソース位置は付けない。 */
export function syntaxEditorDiagnostic(source: string, error: unknown): PythonEditorDiagnostic | undefined {
    if (!(error instanceof SyntaxError)) {
        return undefined;
    }
    const position = /\s*\(charPos=(\d+)\)$/.exec(error.message);
    if (position === null) {
        return undefined;
    }
    const start = Math.max(0, Math.min(Number(position[1]), source.length));
    return { start, end: tokenEnd(source, start), message: error.message.slice(0, position.index) };
}
