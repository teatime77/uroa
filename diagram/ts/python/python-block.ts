/**
 * Python編集・実行用ActionBlock。parser.ts、semantic.ts、bytecode.tsでビルドし、
 * ble-wifi/device-connection.tsが転送・VM指令を担当する。index.tsがツール、procedure.tsが復元を登録する。
 * 最大化はlayer-diagram内のDOM表示だけを拡大し、Actionの位置・接続・通常サイズを保つ。
 * 独自の動物アイコンはpublic/diagram/images/toolbox/PythonBlock.svgを使用する。
 * 編集領域の色分け・スクロール追従はhighlight-editor.tsが担当し、ソースはtextareaに保持する。
 * 行ブレークポイントのF9操作・背景・解除の仕様はhighlight-editor.tsのtoggleBreakpoint()を参照する。
 * チェックと表示の契約：チェックボタンは機器未接続でも字句・構文・意味解析だけを行い、
 * バイトコード生成・転送・VM操作を行わない。入力時の解析・自動チェックは行わない。
 * Startは送信済みコードを再利用する場合も必ずチェックし、問題があればVMを開始しない。
 * editor-diagnostics.tsが診断をUTF-16範囲へ変換し、highlight-editor.tsが赤い波線、
 * マウス位置のtooltipと、文字カーソル位置の編集領域下部の説明を表示する。
 * 構文エラーは最初の1件、意味エラーは診断一覧を表示する。API・通信失敗に仮の波線は付けない。
 * 入力・読込で古い診断を消し、解析中の入力変更・取消・削除後に遅れて届く結果は破棄する。
 * Startで得た解析結果はそのまま生成に使い、同じStart内で解析を繰り返さない。
 * Startは同一生成のDebugInfoとReceiptを保持し、行ブレークポイントを文開始PCへ変換して確定後にVMを開始する。
 * 停止通知で自動最大化し、取得完了した同一停止の大域・局所・Call Stack・PC/SP/BPと全スロットを表示する。
 * 構造体とフレーム選択はdebugger-view.ts、ワイヤー仕様はble-wifi/debug-protocol.tsを参照する。
 * 実行中・ブレークポイント停止中は編集とブレークポイント変更を禁止する。再開・ステップは未実装、Stop後に新規Startする。
 * ブレークポイントがある実行は手動Startに限定し、Actionチェーンからは開始前に拒否する。
 * 所有Receiptの失効・切断・Stop・編集・読込・削除で旧停止値を破棄し、保存・コピーには含めない。
 */
import { Vec2 } from "@i18n";
import { diagramDevice } from "../ble-wifi/device-connection";
import type { BytecodeReceipt } from "../ble-wifi/bytecode-transfer";
import { theCanvas } from "../diagram_util";
import { ActionBlock, registerActionBlock } from "../procedure";
import { getProcedureSignal, subscribeDiagramStop } from "../runtime";
import type { Attr } from "../ui";
import { generateDebugBytecode } from "./bytecode";
import { resolveBreakpoints, type PythonDebugInfo } from "./debug-info";
import { PythonDebuggerView, debugLine } from "./debugger-view";
import { parsePython } from "./parser";
import { analyzePython, type PythonAnalysis } from "./semantic";
import { PythonHighlightEditor } from "./highlight-editor";
import { semanticEditorDiagnostic, syntaxEditorDiagnostic } from "./editor-diagnostics";
import { openPythonSource } from "./source-dialog";

/**
 * Startでビルド・転送・VM_START、StopでVM_STOPを行う。Actionチェーンのrun()も同じ開始処理を待つ。
 * VMはESP32で独立して進むため、run()はVM初期化ACKまでを待ち、プログラム終了までは待たない。
 * Command v1（10バイト）にVM_START=10、VM_STOP=11を追加。CH=255、value=duration=0。
 * ESP32/lib/protocolが形式を検査し、app/diagram-control/src/main.cppのloop()が実行する。
 * COMMITは保持だけを行い、VM_STARTで保持中のコードを先頭から実行する。VM_STOPは所有機器も解放する。
 * 開始ACKは初期化の成功であり、実行終了・実行時エラーの通知は含まない。
 * 転送とVM指令は現在のBLE／Wi-Fiを使う。切断・切替では転送済みReceiptを失効させ、再送・明示開始を要求する。
 */
export class PythonBlock extends ActionBlock {
    readonly sourceEditor: HTMLTextAreaElement;
    private readonly highlightEditor: PythonHighlightEditor;
    private readonly panel = document.createElement("div");
    private readonly maximizeButton = document.createElement("button");
    private readonly minimizeButton = document.createElement("button");
    private readonly openButton = document.createElement("button");
    private readonly downloadButton = document.createElement("button");
    private readonly filenameView = document.createElement("span");
    private readonly checkButton = document.createElement("button");
    private readonly startButton = document.createElement("button");
    private readonly stopButton = document.createElement("button");
    private readonly statusView = document.createElement("div");
    private readonly debuggerView = new PythonDebuggerView();
    private readonly events = new AbortController();
    private readonly releaseConnection: () => void;
    private readonly releaseStop: () => void;
    private readonly releaseDebug: () => void;
    private request?: AbortController;
    private checkRequest?: AbortController;
    private openRequest?: AbortController;
    private sourceFilename = "";
    private stopping?: Promise<void>;
    private receipt?: BytecodeReceipt;
    private uploadedSource?: string;
    private uploadedAbiHash?: string;
    private expanded = false;
    private removed = false;
    private ownsVM = false;
    private vmFinished = false;
    private vmReceipt?: BytecodeReceipt;
    private editRevision = 0;
    private debugInfo?: PythonDebugInfo;

    /** 初期状態は縮小表示。編集欄・通信・実行は自動で開始しない。 */
    constructor(data: Attr) {
        super(data);
        this.setBoxSize();
        const panel = this.panel;
        panel.className = "diagram-python";
        Object.assign(panel.style, {
            position: "absolute", display: "flex", flexDirection: "column", gap: "8px",
            boxSizing: "border-box", padding: "8px", background: "cornsilk",
            color: "#163b2b", font: "14px sans-serif", pointerEvents: "none", zIndex: "1"
        });
        const heading = document.createElement("div");
        Object.assign(heading.style, { display: "flex", alignItems: "center", gap: "8px", font: "bold 18px sans-serif" });
        const icon = document.createElement("img");
        icon.src = "/diagram/images/toolbox/PythonBlock.svg";
        icon.alt = "パイソン";
        icon.width = 30;
        icon.height = 30;
        heading.append(icon, "Python");
        Object.assign(this.filenameView.style, {
            font: "14px sans-serif", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
        });
        heading.appendChild(this.filenameView);
        const controls = document.createElement("div");
        Object.assign(controls.style, { display: "flex", gap: "6px", flexWrap: "wrap" });
        const buttons: [HTMLButtonElement, string, () => void][] = [
            [this.maximizeButton, "最大化", () => this.setExpanded(true)],
            [this.minimizeButton, "最小化", () => this.setExpanded(false)],
            [this.openButton, "Open", () => {
                void this.openSource();
            }],
            [this.downloadButton, "Download", () => this.downloadSource()],
            [this.checkButton, "チェック", () => {
                void this.check();
            }],
            [this.startButton, "Start", () => {
                void this.start().catch(() => undefined);
            }],
            [this.stopButton, "Stop", () => {
                void this.stop().catch(() => undefined);
            }]
        ];
        for (const [button, text, click] of buttons) {
            button.type = "button";
            button.textContent = text;
            Object.assign(button.style, { pointerEvents: "auto", font: "16px sans-serif", padding: "6px 12px" });
            button.addEventListener("click", click, { signal: this.events.signal });
            controls.appendChild(button);
        }
        const editor = this.sourceEditor = document.createElement("textarea");
        editor.setAttribute("aria-label", "Pythonソースコード");
        editor.placeholder = "# ESP32で実行するPythonコードを入力してください\n";
        editor.spellcheck = false;
        editor.autocomplete = "off";
        editor.wrap = "off";
        this.highlightEditor = new PythonHighlightEditor(editor);
        // 1回でも編集したら、元の文字列へ戻した場合も再ビルド・再送する。
        editor.addEventListener("input", () => {
            this.editRevision++;
            this.openRequest?.abort();
            this.checkRequest?.abort();
            this.request?.abort();
            this.receipt = undefined;
            this.uploadedSource = undefined;
            this.uploadedAbiHash = undefined;
            this.debugInfo = undefined;
            this.clearDebugView();
            this.showStatus("ソースを変更しました。次のStartでビルド・送信します。");
        }, { signal: this.events.signal });
        // textarea内のTabはフォーカス移動の代わりに4スペースを挿入する。
        editor.addEventListener("keydown", event => {
            if (!editor.readOnly && event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                event.preventDefault();
                editor.setRangeText("    ", editor.selectionStart, editor.selectionEnd, "end");
                editor.dispatchEvent(new Event("input"));
            }
        }, { signal: this.events.signal });
        this.statusView.setAttribute("role", "status");
        Object.assign(this.statusView.style, { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minHeight: "18px" });
        panel.append(heading, controls, this.highlightEditor.element, this.debuggerView.element, this.statusView);
        (document.getElementById("layer-diagram") || document.body).appendChild(panel);
        this.releaseConnection = diagramDevice.subscribe(state => {
            if (state.phase !== "connected") {
                this.receipt = undefined;
                this.ownsVM = false;
                this.request?.abort();
                this.debugInfo = undefined;
                this.clearDebugView();
            }
            if (this.vmReceipt && diagramDevice.bytecodeReceipt !== this.vmReceipt) {
                this.ownsVM = false;
                this.vmReceipt = undefined;
                this.clearDebugView();
            }
            this.updateControls();
        });
        this.releaseStop = subscribeDiagramStop(() => {
            void this.stop().catch(() => undefined);
        });
        this.releaseDebug = diagramDevice.subscribeDebugSnapshots((snapshot, error, event) => {
            if (this.removed || !this.vmReceipt || diagramDevice.bytecodeReceipt !== this.vmReceipt) {
                return;
            }
            this.clearDebugView();
            if (event?.state === 1 || event?.state === 5) {
                this.vmFinished = false;
                this.updateControls();
            }
            if (event?.state === 5) {
                this.setExpanded(true);
            }
            if (error) {
                this.showStatus(`デバッグ情報取得失敗: ${error.message}。VMの状態を確認し、Stopしてください。`);
                return;
            }
            if (snapshot && this.debugInfo) {
                try {
                    this.debuggerView.show(this.debugInfo, snapshot);
                    this.highlightEditor.element.style.flex = "1 1 55%";
                    this.highlightEditor.setExecutionLine(debugLine(this.debugInfo, snapshot.pc));
                    this.showStatus("ブレークポイントで停止しました。関数名を選ぶと局所変数を表示します。再開・ステップは未実装です。");
                }
                catch (failure) {
                    this.showStatus(failure instanceof Error ? failure.message : "停止情報を表示できませんでした。");
                }
            }
            else if (event?.state === 5) {
                this.showStatus("ブレークポイントで停止しました。デバッグ情報を取得しています…");
            }
            else if (event && (event.state === 2 || event.state === 3 || event.state === 4)) {
                // HALTでも機器出力は保持されるため、Stopの所有権は残して編集と新規Startだけを許す。
                this.vmFinished = true;
                this.showStatus(event.state === 2 ? "VMの実行が終了しました。" : event.state === 4
                    ? "VMで実行時エラーが発生しました。ESP32のシリアルで詳細を確認してください。" : "VMを停止しました。");
            }
        });
        this.showStatus("最大化してPythonコードを編集してください。");
        this.positionPanel();
    }

    setBoxSize(): void {
        // 通常表示では7個のボタンを2行に折り返して収める。
        this.boxSize = new Vec2(440, 220);
    }

    /** 最大化状態は保存せず、ソースとファイル名を通常のActionBlock情報に追加する。旧データは無名で復元する。 */
    makeObj(): any {
        return { ...super.makeObj(), source: this.sourceEditor.value, sourceFilename: this.sourceFilename };
    }

    loadObj(obj: any): void {
        void this.stop().catch(() => undefined);
        super.loadObj(obj);
        this.replaceSource(typeof obj.source === "string" ? obj.source : "",
            typeof obj.sourceFilename === "string" ? obj.sourceFilename : "");
    }

    /** ファイル読込・図の復元では旧コードの診断・ブレークポイント・転送と停止情報を失効させる。 */
    private replaceSource(source: string, filename: string): void {
        this.sourceEditor.value = source;
        this.setSourceFilename(filename);
        this.editRevision++;
        this.checkRequest?.abort();
        this.request?.abort();
        this.highlightEditor.clearBreakpoints();
        this.highlightEditor.clearDiagnostics();
        this.highlightEditor.refresh();
        this.receipt = undefined;
        this.uploadedSource = undefined;
        this.uploadedAbiHash = undefined;
        this.debugInfo = undefined;
        this.clearDebugView();
    }

    copy(): PythonBlock {
        const block = new PythonBlock({});
        this.copyUI(block);
        block.sourceEditor.value = this.sourceEditor.value;
        block.setSourceFilename(this.sourceFilename);
        block.highlightEditor.refresh();
        block.setContext2D(this.ctx);
        block.setBlockPortPosition(block.position);
        return block;
    }

    private setSourceFilename(filename: string): void {
        this.sourceFilename = filename;
        this.filenameView.textContent = filename;
        this.filenameView.title = filename;
    }

    /**
     * Openはsource-dialog.tsのモーダルから公開済み.pyを選び、成功時だけ名前とコードを置き換えて最大化する。
     * vite.config.tsはpublic/diagram/python直下の.py名配列を開発時に/diagram/python-list.jsonで返し、
     * ビルド時はdist/diagram/python-list.jsonを出力する。本文は/diagram/python/<URL符号化した名前>から読む。
     * 実行・開始・停止処理中は開かない。Stop・復元・削除・入力変更で取消し、遅れた取得結果を反映しない。
     * ファイル名は編集後も保持し、図の保存・復元・コピーにも含める。サーバーのファイルへは書き戻さない。
     */
    private async openSource(): Promise<void> {
        if (this.removed || this.inToolbox || this.ownsVM && !this.vmFinished
            || this.request || this.checkRequest || this.stopping || this.openRequest) {
            return;
        }
        const controller = new AbortController();
        const revision = this.editRevision;
        this.openRequest = controller;
        this.updateControls();
        try {
            const file = await openPythonSource(controller.signal);
            if (file && !controller.signal.aborted && !this.removed && this.editRevision === revision) {
                this.replaceSource(file.source, file.filename);
                this.setExpanded(true);
                this.showStatus(`${file.filename} を読み込みました。`);
            }
        }
        catch (error) {
            if (!controller.signal.aborted && !this.removed) {
                this.showStatus(error instanceof Error ? error.message : "Pythonファイルを開けませんでした。");
            }
        }
        finally {
            this.openRequest = undefined;
            this.updateControls();
        }
    }

    /**
     * promptの既定名は直近のOpen／Download名（無名はpython.py）。取消・空名では何もしない。
     * 入力名を保持・表示し、現在のtextarea全体をUTF-8のBlobとして指定名でダウンロードする。
     */
    private downloadSource(): void {
        if (this.removed || this.inToolbox) {
            return;
        }
        const filename = window.prompt("ファイル名を入力してください。", this.sourceFilename || "python.py")?.trim();
        if (!filename) {
            return;
        }
        const url = URL.createObjectURL(new Blob([this.sourceEditor.value], { type: "text/x-python;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        try {
            link.click();
            this.setSourceFilename(filename);
        }
        finally {
            link.remove();
            // ブラウザーのダウンロード処理がURLを参照してから解放する。
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    }

    /** diagramのDOM親を覆って編集する。通常のCanvas配置は変えず、縮小時にそのまま戻す。 */
    private setExpanded(expanded: boolean): void {
        if (this.removed || this.inToolbox) {
            return;
        }
        this.expanded = expanded;
        this.highlightEditor.element.style.display = expanded ? "flex" : "none";
        this.debuggerView.element.style.display = expanded && this.debuggerView.element.childElementCount !== 0 ? "block" : "none";
        this.highlightEditor.refresh();
        this.positionPanel();
        this.updateControls();
        if (expanded) {
            this.sourceEditor.focus();
        }
        theCanvas?.requestUpdateCanvas();
    }

    setPosition(position: Vec2): void {
        super.setPosition(position);
        this.positionPanel();
    }

    /** CanvasのCSS倍率と親の位置を反映する。最大化では図のレイヤー内を覆い、他アプリには出さない。 */
    private positionPanel(): void {
        if (!this.panel || !this.ctx || this.removed || this.inToolbox) {
            if (this.panel) {
                this.panel.style.display = "none";
            }
            return;
        }
        this.panel.style.display = "flex";
        if (this.expanded) {
            Object.assign(this.panel.style, {
                left: "4px", top: "4px", width: "calc(100% - 8px)", height: "calc(100% - 8px)",
                zIndex: "200", pointerEvents: "auto", border: "3px solid #587343"
            });
            return;
        }
        const canvas = this.ctx.canvas;
        const rect = canvas.getBoundingClientRect();
        const parent = this.panel.parentElement!.getBoundingClientRect();
        const sx = rect.width / canvas.width;
        const sy = rect.height / canvas.height;
        const [xa, ya, xb, yb] = this.drawBox();
        Object.assign(this.panel.style, {
            left: `${rect.left - parent.left + (xa + 8) * sx}px`,
            top: `${rect.top - parent.top + (ya + 14) * sy}px`,
            width: `${(xb - xa - 16) * sx}px`, height: `${(yb - ya - 26) * sy}px`,
            zIndex: "1", pointerEvents: "none", border: "none"
        });
    }

    private updateControls(): void {
        const disabled = this.removed || this.inToolbox;
        this.maximizeButton.disabled = disabled || this.expanded;
        this.minimizeButton.disabled = disabled || !this.expanded;
        this.openButton.disabled = disabled || this.ownsVM && !this.vmFinished || this.request !== undefined
            || this.checkRequest !== undefined || this.stopping !== undefined || this.openRequest !== undefined;
        this.downloadButton.disabled = disabled || this.openRequest !== undefined;
        this.checkButton.disabled = disabled || this.ownsVM && !this.vmFinished || this.request !== undefined
            || this.checkRequest !== undefined || this.stopping !== undefined || this.openRequest !== undefined;
        this.startButton.disabled = disabled || this.ownsVM && !this.vmFinished || this.request !== undefined || this.stopping !== undefined
            || this.checkRequest !== undefined || this.openRequest !== undefined
            || diagramDevice.bytecodeSending || diagramDevice.state.phase !== "connected";
        this.stopButton.disabled = disabled || this.stopping !== undefined || (!this.request && !this.ownsVM);
        this.sourceEditor.readOnly = this.request !== undefined || this.openRequest !== undefined || this.ownsVM && !this.vmFinished;
    }

    /** 部分受信・失効時には古い値を残さない。最大化状態は維持する。 */
    private clearDebugView(): void {
        this.debuggerView.clear();
        this.highlightEditor.setExecutionLine();
        this.highlightEditor.element.style.flex = "1";
    }

    private showStatus(message: string): void {
        this.statusView.textContent = message;
        this.statusView.title = message;
        this.updateControls();
        theCanvas?.requestUpdateCanvas();
    }

    /** チェックは手動操作時だけ実行する。入力変更で取消し、古い結果やエラーを表示し直さない。 */
    private async check(): Promise<void> {
        if (this.removed || this.inToolbox || this.request || this.checkRequest || this.stopping || this.openRequest) {
            return;
        }
        const controller = new AbortController();
        const revision = this.editRevision;
        this.checkRequest = controller;
        this.updateControls();
        try {
            await this.checkSource(controller);
        }
        catch (error) {
            if (!controller.signal.aborted && !this.removed) {
                const message = error instanceof Error ? error.message : "チェックに失敗しました。";
                this.showStatus(message);
            }
            else if (!this.removed && this.editRevision === revision) {
                this.highlightEditor.clearDiagnostics("チェックを取り消しました。再チェックしてください。");
                this.showStatus("チェックを取り消しました。");
            }
        }
        finally {
            this.checkRequest = undefined;
            this.updateControls();
        }
    }

    /** 同じスナップショットの診断と解析結果を返す。構文・意味エラーがあれば生成用の結果は返さない。 */
    private async checkSource(controller: AbortController): Promise<PythonAnalysis | undefined> {
        const source = this.sourceEditor.value;
        const revision = this.editRevision;
        controller.signal.throwIfAborted();
        this.highlightEditor.clearDiagnostics("チェックしています…");
        this.showStatus("Pythonをチェックしています…");
        try {
            const module = parsePython(source);
            const analysis = await analyzePython(module, controller.signal);
            controller.signal.throwIfAborted();
            if (this.removed || this.editRevision !== revision || this.sourceEditor.value !== source) {
                controller.abort();
                controller.signal.throwIfAborted();
            }
            this.highlightEditor.setDiagnostics(source, analysis.diagnostics.map(item => semanticEditorDiagnostic(source, item)));
            this.showStatus(analysis.diagnostics.length === 0 ? "チェック完了：問題はありません。"
                : `${analysis.diagnostics.length}件の問題があります。問題箇所を確認してください。`);
            return analysis.diagnostics.length === 0 ? analysis : undefined;
        }
        catch (error) {
            if (controller.signal.aborted || this.removed || this.editRevision !== revision) {
                throw error;
            }
            const diagnostic = syntaxEditorDiagnostic(source, error);
            if (diagnostic === undefined) {
                const message = error instanceof Error ? error.message : "チェックに失敗しました。";
                this.highlightEditor.clearDiagnostics(`チェックできませんでした：${message}`);
                throw error;
            }
            this.highlightEditor.setDiagnostics(source, [diagnostic]);
            this.showStatus("構文エラーがあります。問題箇所を確認してください。");
            return undefined;
        }
    }

    /** チェックは毎回行い、未編集・同じAPI・現接続・最後の転送の場合だけ生成と転送を省略する。 */
    private async start(signal?: AbortSignal): Promise<void> {
        if (this.removed || this.inToolbox || this.ownsVM && !this.vmFinished || this.request || this.checkRequest || this.stopping || this.openRequest) {
            return;
        }
        const controller = new AbortController();
        const cancel = () => controller.abort();
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) {
            controller.abort();
        }
        this.request = controller;
        const source = this.sourceEditor.value;
        const editRevision = this.editRevision;
        const current = () => !this.removed && !controller.signal.aborted;
        this.updateControls();
        try {
            controller.signal.throwIfAborted();
            const analysis = await this.checkSource(controller);
            if (analysis === undefined) {
                // Actionチェーンでも後続へ進まない。画面の波線・診断説明は保持する。
                throw new Error("Pythonに問題があります。表示された問題箇所を修正してください。");
            }
            if (diagramDevice.state.phase !== "connected") {
                throw new Error("機器接続ブロックでESP32へ接続してください。");
            }
            let receipt = this.receipt;
            if (!receipt || !this.debugInfo || this.uploadedSource !== source || this.uploadedAbiHash !== analysis.api.abiHash
                || diagramDevice.bytecodeReceipt !== receipt) {
                this.showStatus("Pythonをビルドしています…");
                const build = generateDebugBytecode(analysis);
                // 不可行はプログラムの置換より先に説明する。
                resolveBreakpoints(build.info, this.highlightEditor.getBreakpointLines());
                this.showStatus("バイトコードを送信しています…");
                receipt = await diagramDevice.sendBytecode(build.bytes, controller.signal);
                controller.signal.throwIfAborted();
                if (this.sourceEditor.value === source && this.editRevision === editRevision) {
                    this.receipt = receipt;
                    this.uploadedSource = source;
                    this.uploadedAbiHash = analysis.api.abiHash;
                    this.debugInfo = build.info;
                }
            }
            this.showStatus("ブレークポイントを送信しています…");
            await diagramDevice.sendBreakpoints(receipt,
                resolveBreakpoints(this.debugInfo!, this.highlightEditor.getBreakpointLines()), controller.signal);
            controller.signal.throwIfAborted();
            this.showStatus("VMを開始しています…");
            // 書込み直後から所有扱いにし、ACK待機中のStopでもVM_STOPを必ず送る。
            this.ownsVM = true;
            this.vmFinished = false;
            this.vmReceipt = receipt;
            await diagramDevice.startBytecode(receipt, current);
            controller.signal.throwIfAborted();
            // 短いプログラムは開始ACKより前に停止通知が届くことがある。
            if (!diagramDevice.debugEvent || diagramDevice.debugEvent.state === 1) {
                this.showStatus("VM開始を受け付けました。ブレークポイントに到達するとデバッグ情報を表示します。");
            }
        }
        catch (error) {
            if (!this.removed) {
                if (controller.signal.aborted && this.editRevision === editRevision) {
                    this.highlightEditor.clearDiagnostics("開始を取り消しました。再チェックしてください。");
                }
                this.showStatus(controller.signal.aborted ? "開始を取り消しました。"
                    : error instanceof Error ? error.message : "Pythonを開始できませんでした。");
            }
            throw error;
        }
        finally {
            signal?.removeEventListener("abort", cancel);
            this.request = undefined;
            this.updateControls();
        }
    }

    async run(): Promise<void> {
        if (this.highlightEditor.getBreakpointLines().length !== 0) {
            throw new Error("ブレークポイントがあるPythonは、PythonBlockのStartボタンで手動実行してください。");
        }
        await this.start(getProcedureSignal());
    }

    /** 開始待機を無効化してから停止指令を送る。転送の取消で切断した場合は機器側の切断停止を使う。 */
    private stop(): Promise<void> {
        this.openRequest?.abort();
        this.checkRequest?.abort();
        if (this.stopping) {
            return this.stopping;
        }
        const active = this.request !== undefined || this.ownsVM;
        this.request?.abort();
        this.ownsVM = false;
        this.vmReceipt = undefined;
        this.clearDebugView();
        if (!active) {
            return Promise.resolve();
        }
        const task = diagramDevice.stopBytecode().then(() => {
            if (!this.removed) {
                this.showStatus("VMを停止しました。");
            }
        }).catch(error => {
            if (!this.removed) {
                this.showStatus(error instanceof Error ? error.message : "VMを停止できませんでした。");
            }
            throw error;
        }).finally(() => {
            this.stopping = undefined;
            this.updateControls();
        });
        this.stopping = task;
        this.updateControls();
        return task;
    }

    draw(): void {
        super.draw();
        this.positionPanel();
    }

    /** 通信取消・VM停止を要求し、購読・イベント・textareaを含むDOMをすべて破棄する。 */
    clearBlock(): void {
        if (this.removed) {
            return;
        }
        void this.stop().catch(() => undefined);
        this.removed = true;
        this.releaseStop();
        this.releaseConnection();
        this.releaseDebug();
        this.events.abort();
        this.highlightEditor.dispose();
        this.panel.remove();
        super.clearBlock();
    }
}

registerActionBlock(PythonBlock.name, () => new PythonBlock({}));
