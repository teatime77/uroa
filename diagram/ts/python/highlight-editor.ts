/**
 * PythonBlock用の構文ハイライトと行ブレークポイント表示。webgpu-sims/src/editor.tsのSyntaxHighlightEditorを参考に、
 * 透明なtextareaと表示専用Canvasを重ねる。python-block.tsが生成・表示切替・復元・破棄を管理し、
 * ソース・選択・キャレット・IME・スクロールはtextareaだけを正本とする。
 * 診断の表示・チェックのタイミングについての共通契約はpython-block.tsを参照する。
 */
import type { PythonEditorDiagnostic } from "./editor-diagnostics";

type HighlightKind = "plain" | "keyword" | "builtin" | "number" | "string" | "comment" | "bracket" | "operator";

interface HighlightToken {
    kind: HighlightKind;
    text: string;
}

interface DiagnosticBox {
    x: number;
    y: number;
    width: number;
    diagnostic: PythonEditorDiagnostic;
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
    private static nextId = 0;
    readonly element = document.createElement("div");
    private readonly viewport = document.createElement("div");
    private readonly description = document.createElement("div");
    private readonly tooltip = document.createElement("div");
    private readonly breakpointCanvas = document.createElement("canvas");
    private readonly canvas = document.createElement("canvas");
    private readonly ctx: CanvasRenderingContext2D;
    private readonly breakpointContext: CanvasRenderingContext2D;
    private readonly observer: ResizeObserver;
    private readonly events = new AbortController();
    private frame?: number;
    private source?: string;
    private tokens: HighlightToken[] = [];
    private lines: string[] = [];
    private lineStarts: number[] = [];
    private readonly breakpointLines = new Set<number>();
    private executionLine?: number;
    private breakpointSource: string;
    private composing = false;
    private diagnostics: readonly PythonEditorDiagnostic[] = [];
    private diagnosticSource?: string;
    private diagnosticBoxes: DiagnosticBox[] = [];
    private summary = "未チェックです。「チェック」またはStartで確認してください。";

    /** textareaの入力機能を維持し、Canvasは選択・クリック・読み上げの対象にしない。 */
    constructor(private readonly textarea: HTMLTextAreaElement) {
        this.ctx = this.canvas.getContext("2d")!;
        this.breakpointContext = this.breakpointCanvas.getContext("2d")!;
        this.breakpointSource = textarea.value;
        Object.assign(this.element.style, {
            display: "none", position: "relative", flex: "1", minHeight: "0", width: "100%",
            overflow: "hidden", boxSizing: "border-box", border: "1px solid #454545",
            background: "#1e1e1e", colorScheme: "dark"
        });
        this.element.style.flexDirection = "column";
        Object.assign(this.viewport.style, { position: "relative", flex: "1", minHeight: "0", overflow: "hidden" });
        Object.assign(textarea.style, {
            position: "absolute", inset: "0", width: "100%", height: "100%", margin: "0",
            boxSizing: "border-box", border: "0", padding: `${padding}px`, resize: "none",
            font, lineHeight: `${lineHeight}px`, tabSize: `${tabSize}`, letterSpacing: "0",
            fontVariantLigatures: "none", fontKerning: "none", textIndent: "0",
            color: "transparent", caretColor: colors.plain, background: "transparent",
            overflow: "auto", whiteSpace: "pre", pointerEvents: "auto"
        });
        this.canvas.setAttribute("aria-hidden", "true");
        this.breakpointCanvas.setAttribute("aria-hidden", "true");
        Object.assign(this.breakpointCanvas.style, {
            position: "absolute", left: "0", top: "0", pointerEvents: "none"
        });
        Object.assign(this.canvas.style, {
            position: "absolute", left: "0", top: "0", zIndex: "1", pointerEvents: "none"
        });
        // 文字を選択背景より手前に描き、選択中も色付きのコードを読めるようにする。
        this.description.id = `python-diagnostics-${++PythonHighlightEditor.nextId}`;
        this.description.setAttribute("role", "status");
        this.description.setAttribute("aria-live", "polite");
        Object.assign(this.description.style, {
            flexShrink: "0", minHeight: "20px", maxHeight: "100px", overflow: "auto",
            padding: "6px 10px", borderTop: "1px solid #454545", color: "#d4d4d4",
            font: "14px/1.5 sans-serif", whiteSpace: "pre-wrap", overflowWrap: "anywhere", pointerEvents: "auto"
        });
        textarea.setAttribute("aria-describedby", this.description.id);
        this.tooltip.setAttribute("role", "tooltip");
        this.tooltip.hidden = true;
        Object.assign(this.tooltip.style, {
            position: "absolute", zIndex: "2", maxWidth: "min(480px, calc(100% - 16px))",
            boxSizing: "border-box", padding: "8px", border: "1px solid #f48771",
            background: "#252526", color: "#f1f1f1", font: "14px/1.5 sans-serif",
            whiteSpace: "pre-wrap", overflowWrap: "anywhere", pointerEvents: "none"
        });
        // 行背景はtextareaより背面へ置き、ブラウザーの選択背景を覆わない。
        this.viewport.append(this.breakpointCanvas, textarea, this.canvas, this.tooltip);
        this.element.append(this.viewport, this.description);
        this.updateDescription();
        textarea.addEventListener("input", () => {
            this.clearBreakpoints();
            this.clearDiagnostics();
            this.refresh();
        }, { signal: this.events.signal });
        textarea.setAttribute("aria-keyshortcuts", "F9");
        textarea.title = "F9: この行のブレークポイントをON/OFF。ソース変更で全解除します。";
        textarea.addEventListener("keydown", event => {
            if (event.key !== "F9" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey
                || event.isComposing || this.composing) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) {
                this.toggleBreakpoint();
            }
        }, { signal: this.events.signal });
        textarea.addEventListener("scroll", () => {
            this.diagnosticBoxes = [];
            this.tooltip.hidden = true;
            this.refresh();
        }, { signal: this.events.signal });
        textarea.addEventListener("pointermove", event => this.showTooltip(event), { signal: this.events.signal });
        textarea.addEventListener("pointerleave", () => {
            this.tooltip.hidden = true;
        }, { signal: this.events.signal });
        textarea.addEventListener("blur", () => {
            this.tooltip.hidden = true;
        }, { signal: this.events.signal });
        for (const event of ["select", "keyup", "pointerup", "focus"]) {
            textarea.addEventListener(event, () => this.updateDescription(), { signal: this.events.signal });
        }
        document.addEventListener("selectionchange", () => {
            if (document.activeElement === textarea) {
                this.updateDescription();
            }
        }, { signal: this.events.signal });
        textarea.addEventListener("compositionstart", () => {
            this.composing = true;
        }, { signal: this.events.signal });
        textarea.addEventListener("compositionend", () => {
            this.composing = false;
            this.refresh();
        }, { signal: this.events.signal });
        window.addEventListener("resize", () => this.refresh(), { signal: this.events.signal });
        this.observer = new ResizeObserver(() => this.refresh());
        this.observer.observe(textarea);
    }

    /**
     * 修飾なしF9でselectionStartの1始まり行番号を切り替える。IME変換中・キーリピートは除外する。
     * 空行・コメントを含む任意の行が対象。Start時にpython-block.tsが実行可能PCへの変換を検証する。
     * 実行・停止中はreadOnlyとして変更を拒否する。変更後の再開・ステップは未対応。
     * 状態はこのエディタ内だけに保持し、PythonBlockの保存・コピーには含めない。
     */
    private toggleBreakpoint(): void {
        if (this.textarea.readOnly) {
            return;
        }
        // 直前に代入されたソースの変更も反映してから、新しい行を登録する。
        this.refresh();
        const line = this.textarea.value.slice(0, this.textarea.selectionStart).split("\n").length;
        if (this.breakpointLines.has(line)) {
            this.breakpointLines.delete(line);
        }
        else {
            this.breakpointLines.add(line);
        }
        this.refresh();
    }

    /** Startが読み取る行番号のコピー。保存・コピーには含めない。 */
    getBreakpointLines(): number[] {
        return [...this.breakpointLines].sort((left, right) => left - right);
    }

    /** 次に実行する文を黄色で示す。最初の停止通知だけスクロールし、閲覧中は位置を保つ。 */
    setExecutionLine(line?: number): void {
        const changed = this.executionLine !== line;
        this.executionLine = line;
        if (changed && line !== undefined) {
            const top = (line - 1) * lineHeight;
            if (top < this.textarea.scrollTop || top + lineHeight > this.textarea.scrollTop + this.textarea.clientHeight) {
                this.textarea.scrollTop = Math.max(0, top - this.textarea.clientHeight / 3);
            }
        }
        this.refresh();
    }

    /** 入力・Undo/Redo・復元で全解除する。PythonBlock.loadObj()は同じソースの読込でも呼ぶ。 */
    clearBreakpoints(): void {
        this.breakpointLines.clear();
        this.breakpointSource = this.textarea.value;
        this.refresh();
    }

    /** 入力・復元・チェック開始時に古い位置情報を破棄する。ここから解析を実行することはない。 */
    clearDiagnostics(message = "未チェックです。「チェック」またはStartで確認してください。"): void {
        this.diagnostics = [];
        this.diagnosticSource = undefined;
        this.diagnosticBoxes = [];
        this.summary = message;
        this.tooltip.hidden = true;
        this.updateDescription();
        this.refresh();
    }

    /** 解析対象と入力が一致する場合だけ反映する。変更後に届いた古い結果では波線を戻さない。 */
    setDiagnostics(source: string, diagnostics: readonly PythonEditorDiagnostic[]): void {
        if (this.events.signal.aborted || this.textarea.value !== source) {
            return;
        }
        this.diagnosticSource = source;
        this.diagnostics = diagnostics;
        this.diagnosticBoxes = [];
        this.summary = diagnostics.length === 0 ? "チェック完了：問題はありません。"
            : `${diagnostics.length}件の問題があります。赤い波線にマウスまたは文字カーソルを合わせてください。`;
        this.tooltip.hidden = true;
        this.updateDescription();
        this.refresh();
    }

    private diagnosticMessage(diagnostic: PythonEditorDiagnostic): string {
        const before = this.textarea.value.slice(0, diagnostic.start);
        const row = before.split("\n").length;
        const column = diagnostic.start - before.lastIndexOf("\n");
        return `${row}行 ${column}列：${diagnostic.message}`;
    }

    /** 選択方向に応じて実際の文字カーソル位置を見る。マウス操作だけでなく矢印キーでも更新する。 */
    private updateDescription(): void {
        const position = this.textarea.selectionDirection === "backward"
            ? this.textarea.selectionStart : this.textarea.selectionEnd;
        // キャレットは文字間の位置なので、問題範囲の末尾に置いた場合も説明する。
        const selected = this.diagnosticSource === this.textarea.value
            ? this.diagnostics.filter(item => position >= item.start && position <= item.end) : [];
        this.description.textContent = selected.length === 0 ? this.summary
            : selected.map(item => this.diagnosticMessage(item)).join("\n");
        this.description.style.color = selected.length === 0 ? "#d4d4d4" : "#f48771";
    }

    /** 描画と同じCSS座標の範囲を使い、日本語・Tab・スクロール後も文字の上で説明する。 */
    private showTooltip(event: PointerEvent): void {
        const rect = this.textarea.getBoundingClientRect();
        const x = (event.clientX - rect.left) * this.textarea.offsetWidth / rect.width;
        const y = (event.clientY - rect.top) * this.textarea.offsetHeight / rect.height;
        const boxes = this.diagnosticBoxes.filter(box => x >= box.x && x < box.x + box.width
            && y >= box.y && y < box.y + lineHeight);
        if (boxes.length === 0 || this.diagnosticSource !== this.textarea.value
            || x >= this.textarea.clientWidth || y >= this.textarea.clientHeight) {
            this.tooltip.hidden = true;
            return;
        }
        this.tooltip.textContent = [...new Set(boxes.map(box => this.diagnosticMessage(box.diagnostic)))].join("\n");
        this.tooltip.hidden = false;
        this.tooltip.style.left = `${Math.max(4, Math.min(x + 12, this.textarea.clientWidth - this.tooltip.offsetWidth - 4))}px`;
        const below = boxes[0].y + lineHeight + 4;
        this.tooltip.style.top = `${Math.max(0, below + this.tooltip.offsetHeight <= this.textarea.clientHeight
            ? below : boxes[0].y - this.tooltip.offsetHeight - 4)}px`;
    }

    /** 代入による復元・コピーや表示切替でも呼ぶ。inputイベントは発生させず、送信済み判定を変えない。 */
    refresh(): void {
        // inputを発生させないソース代入も対象。描画待ち・非表示中でも変更時点で全解除する。
        if (this.breakpointSource !== this.textarea.value) {
            this.breakpointLines.clear();
            this.breakpointSource = this.textarea.value;
        }
        this.diagnosticBoxes = [];
        this.tooltip.hidden = true;
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
        this.drawBreakpoints(width, height, dpr);
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
            this.lines = source.split("\n");
            let start = 0;
            this.lineStarts = this.lines.map(line => {
                const position = start;
                start += line.length + 1;
                return position;
            });
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
        this.drawDiagnostics(width, height, tabWidth);
    }

    /** 行背景を入力面の全幅へ描く。縦スクロールだけを反映し、横スクロールでも背景幅を保つ。 */
    private drawBreakpoints(width: number, height: number, dpr: number): void {
        this.breakpointCanvas.width = Math.round(width * dpr);
        this.breakpointCanvas.height = Math.round(height * dpr);
        this.breakpointCanvas.style.width = `${width}px`;
        this.breakpointCanvas.style.height = `${height}px`;
        const ctx = this.breakpointContext;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#5a1d1d";
        for (const line of this.breakpointLines) {
            const y = padding + (line - 1) * lineHeight - this.textarea.scrollTop;
            if (y + lineHeight > 0 && y < height) {
                ctx.fillRect(0, y, width, lineHeight);
            }
        }
        if (this.executionLine !== undefined) {
            const y = padding + (this.executionLine - 1) * lineHeight - this.textarea.scrollTop;
            ctx.fillStyle = "#655315";
            ctx.fillRect(0, y, width, lineHeight);
            ctx.fillStyle = "#ffd866";
            ctx.font = "bold 12px sans-serif";
            ctx.fillText("→", 0, y + 17);
        }
    }

    /** UTF-16位置から行番号を求める。長いソースでも診断ごとの先頭からの走査を避ける。 */
    private rowAt(position: number): number {
        let left = 0;
        let right = this.lineStarts.length;
        while (left + 1 < right) {
            const middle = Math.floor((left + right) / 2);
            if (this.lineStarts[middle] <= position) {
                left = middle;
            }
            else {
                right = middle;
            }
        }
        return left;
    }

    private textWidth(text: string, tabWidth: number): number {
        let x = 0;
        for (const [index, part] of text.split("\t").entries()) {
            if (index !== 0) {
                x = (Math.floor(x / tabWidth + 0.000001) + 1) * tabWidth;
            }
            x += this.ctx.measureText(part).width;
        }
        return x;
    }

    /** 複数行の式は行ごとに波線を分け、改行・EOFの問題には最低8pxの目印を付ける。 */
    private drawDiagnostics(width: number, height: number, tabWidth: number): void {
        if (this.diagnosticSource !== this.textarea.value) {
            return;
        }
        const ctx = this.ctx;
        ctx.save();
        ctx.strokeStyle = "#f14c4c";
        ctx.lineWidth = 1.5;
        for (const diagnostic of this.diagnostics) {
            const firstRow = this.rowAt(diagnostic.start);
            const lastRow = this.rowAt(Math.max(diagnostic.start, diagnostic.end - 1));
            for (let row = firstRow; row <= lastRow; row++) {
                const y = padding + row * lineHeight - this.textarea.scrollTop;
                if (y + lineHeight <= 0 || y >= height) {
                    continue;
                }
                const line = this.lines[row];
                const start = Math.max(0, diagnostic.start - this.lineStarts[row]);
                const end = Math.min(line.length, diagnostic.end - this.lineStarts[row]);
                const left = this.textWidth(line.slice(0, start), tabWidth);
                const right = this.textWidth(line.slice(0, end), tabWidth);
                const x = padding + left - this.textarea.scrollLeft;
                const span = Math.max(8, right - left);
                if (x + span <= 0 || x >= width) {
                    continue;
                }
                this.diagnosticBoxes.push({ x, y, width: span, diagnostic });
                const waveStart = Math.max(0, x);
                const waveEnd = Math.min(width, x + span);
                ctx.beginPath();
                ctx.moveTo(waveStart, y + lineHeight - 3);
                for (let point = waveStart + 2; point < waveEnd + 2; point += 2) {
                    const offset = Math.round((point - waveStart) / 2) % 2 === 0 ? 0 : 2;
                    ctx.lineTo(Math.min(point, waveEnd), y + lineHeight - 3 + offset);
                }
                ctx.stroke();
            }
        }
        ctx.restore();
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
