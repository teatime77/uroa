/**
 * PythonBlock用の構文ハイライト。webgpu-sims/src/editor.tsのSyntaxHighlightEditorを参考に、
 * 透明なtextareaと表示専用Canvasを重ねる。python-block.tsが生成・表示切替・復元・破棄を管理し、
 * ソース・選択・キャレット・IME・スクロールはtextareaだけを正本とする。
 */

type HighlightKind = "plain" | "keyword" | "builtin" | "number" | "string" | "comment" | "bracket" | "operator";

interface HighlightToken {
    kind: HighlightKind;
    text: string;
}

/** 参考画像の暗色エディターに合わせ、背景#1e1e1e上で読みやすい明るい配色を使う。 */
const colors: Record<HighlightKind, string> = {
    plain: "#d4d4d4",
    keyword: "#569cd6",
    builtin: "#dcdcaa",
    number: "#b5cea8",
    string: "#ce9178",
    comment: "#6a9955",
    bracket: "#ffd700",
    operator: "#d4d4d4"
};

const keywords = new Set(("False None True and as assert async await break class continue def del elif else "
    + "except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield").split(" "));
const builtins = new Set(("abs all any bool dict enumerate float int len list max min print range round set "
    + "str sum tuple type zip").split(" "));
const font = "16px Consolas, 'Courier New', monospace";
const lineHeight = 24;
const padding = 12;
const tabSize = 4;

/**
 * コンパイラーとは独立した表示用字句分割。未終端の文字列・三重引用符も末尾まで色分けし、
 * 編集途中の構文エラーでは例外を投げない。文字列中の#やエスケープをコメントと区別する。
 * r/u/b/fとbr/rb/fr/rf接頭辞に対応し、f文字列は置換式を含め文字列全体を同じ色にする。
 * ハイライトはコンパイラーの対応構文や型の正しさを表さない。
 */
function highlightTokens(source: string): HighlightToken[] {
    const pattern = /(?<string>(?:[rRuUbBfF]|[bB][rR]|[rR][bB]|[fF][rR]|[rR][fF])?["'])|(?<comment>#[^\n]*)|(?<number>0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?[\d_]+)?[jJ]?)|(?<identifier>[_\p{ID_Start}][_\p{ID_Continue}]*)|(?<bracket>[()[\]{}])|(?<operator>[-+*/%=<>!&|^~:@,;]+)|(?<plain>\s+|.)/uy;
    const tokens: HighlightToken[] = [];
    while (pattern.lastIndex < source.length) {
        const match = pattern.exec(source)!;
        const groups = match.groups!;
        let kind: HighlightKind = "plain";
        if (groups.string !== undefined) {
            const quoteIndex = match.index + match[0].length - 1;
            const quote = source[quoteIndex];
            const delimiter = source.startsWith(quote.repeat(3), quoteIndex) ? quote.repeat(3) : quote;
            let end = quoteIndex + delimiter.length;
            while (end < source.length) {
                if (source[end] === "\\") {
                    end = Math.min(end + 2, source.length);
                }
                else if (source.startsWith(delimiter, end)) {
                    end += delimiter.length;
                    break;
                }
                else if (delimiter.length === 1 && source[end] === "\n") {
                    break;
                }
                else {
                    end++;
                }
            }
            pattern.lastIndex = end;
            kind = "string";
        }
        else if (groups.identifier !== undefined) {
            if (keywords.has(match[0])) {
                kind = "keyword";
            }
            else if (builtins.has(match[0])) {
                kind = "builtin";
            }
        }
        else {
            for (const candidate of ["comment", "number", "bracket", "operator"] as const) {
                if (groups[candidate] !== undefined) {
                    kind = candidate;
                    break;
                }
            }
        }
        tokens.push({ kind, text: source.slice(match.index, pattern.lastIndex) });
    }
    return tokens;
}

/** 入力・スクロール・サイズ変更を1フレームにまとめ、CSS座標で描画して高DPIにも対応する。 */
export class PythonHighlightEditor {
    readonly element = document.createElement("div");
    private readonly canvas = document.createElement("canvas");
    private readonly ctx: CanvasRenderingContext2D;
    private readonly observer: ResizeObserver;
    private readonly events = new AbortController();
    private frame?: number;
    private source?: string;
    private tokens: HighlightToken[] = [];

    /** textareaの入力機能を維持し、Canvasは選択・クリック・読み上げの対象にしない。 */
    constructor(private readonly textarea: HTMLTextAreaElement) {
        this.ctx = this.canvas.getContext("2d")!;
        Object.assign(this.element.style, {
            display: "none", position: "relative", flex: "1", minHeight: "0", width: "100%",
            overflow: "hidden", boxSizing: "border-box", border: "1px solid #454545",
            background: "#1e1e1e", colorScheme: "dark"
        });
        Object.assign(textarea.style, {
            position: "absolute", inset: "0", width: "100%", height: "100%", margin: "0",
            boxSizing: "border-box", border: "0", padding: `${padding}px`, resize: "none",
            font, lineHeight: `${lineHeight}px`, tabSize: `${tabSize}`, letterSpacing: "0",
            fontVariantLigatures: "none", fontKerning: "none", textIndent: "0",
            color: "transparent", caretColor: colors.plain, background: "transparent",
            overflow: "auto", whiteSpace: "pre", pointerEvents: "auto"
        });
        this.canvas.setAttribute("aria-hidden", "true");
        Object.assign(this.canvas.style, {
            position: "absolute", left: "0", top: "0", zIndex: "1", pointerEvents: "none"
        });
        // 文字を選択背景より手前に描き、選択中も色付きのコードを読めるようにする。
        this.element.append(textarea, this.canvas);
        textarea.addEventListener("input", () => this.refresh(), { signal: this.events.signal });
        textarea.addEventListener("scroll", () => this.refresh(), { signal: this.events.signal });
        textarea.addEventListener("compositionend", () => this.refresh(), { signal: this.events.signal });
        window.addEventListener("resize", () => this.refresh(), { signal: this.events.signal });
        this.observer = new ResizeObserver(() => this.refresh());
        this.observer.observe(textarea);
    }

    /** 代入による復元・コピーや表示切替でも呼ぶ。inputイベントは発生させず、送信済み判定を変えない。 */
    refresh(): void {
        if (this.events.signal.aborted || this.frame !== undefined) {
            return;
        }
        this.frame = requestAnimationFrame(() => {
            this.frame = undefined;
            this.render();
        });
    }

    /** スクロールバーを除く入力面とDPIを合わせ、表示範囲の行だけを描く。 */
    private render(): void {
        const width = this.textarea.clientWidth;
        const height = this.textarea.clientHeight;
        if (width === 0 || height === 0) {
            return;
        }
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
        const ctx = this.ctx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.font = font;
        ctx.fontKerning = "none";
        ctx.textBaseline = "alphabetic";
        const metrics = ctx.measureText("Mg");
        const ascent = metrics.fontBoundingBoxAscent;
        const descent = metrics.fontBoundingBoxDescent;
        const baseline = (lineHeight - ascent - descent) / 2 + ascent;
        const tabWidth = ctx.measureText(" ").width * tabSize;
        const source = this.textarea.value;
        if (source !== this.source) {
            this.source = source;
            this.tokens = highlightTokens(source);
        }
        // Canvasが入力欄のplaceholderを覆わないよう、空のときは何も描かない。
        let x = 0;
        let row = 0;
        for (const token of this.tokens) {
            ctx.fillStyle = colors[token.kind];
            const lines = token.text.split("\n");
            for (const [lineIndex, line] of lines.entries()) {
                if (lineIndex !== 0) {
                    row++;
                    x = 0;
                }
                const y = padding + row * lineHeight - this.textarea.scrollTop;
                for (const [partIndex, part] of line.split("\t").entries()) {
                    if (partIndex !== 0) {
                        x = (Math.floor(x / tabWidth + 0.000001) + 1) * tabWidth;
                    }
                    if (y + lineHeight > 0 && y < height) {
                        ctx.fillText(part, padding + x - this.textarea.scrollLeft, y + baseline);
                    }
                    // 固定文字数ではなく実際の字幅を使い、日本語・全角文字の後も位置を合わせる。
                    x += ctx.measureText(part).width;
                }
            }
        }
    }

    /** 削除後に描画しないよう、監視・イベント・予約フレームとDOMを解放する。 */
    dispose(): void {
        this.events.abort();
        this.observer.disconnect();
        if (this.frame !== undefined) {
            cancelAnimationFrame(this.frame);
            this.frame = undefined;
        }
        this.element.remove();
    }
}
