/**
 * Python編集・実行用ActionBlock。parser.ts、semantic.ts、bytecode.tsでビルドし、
 * ble-wifi/ble.tsが転送・VM指令を担当する。index.tsがツール、procedure.tsが復元を登録する。
 * 最大化はlayer-diagram内のDOM表示だけを拡大し、Actionの位置・接続・通常サイズを保つ。
 * 独自の動物アイコンはpublic/diagram/images/toolbox/PythonBlock.svgを使用する。
 * 編集領域の色分け・スクロール追従はhighlight-editor.tsが担当し、ソースはtextareaに保持する。
 */
import { Vec2 } from "@i18n";
import { diagramBLE } from "../ble-wifi/ble";
import type { BytecodeReceipt } from "../ble-wifi/bytecode-transfer";
import { theCanvas } from "../diagram_util";
import { ActionBlock, registerActionBlock } from "../procedure";
import { getProcedureSignal, subscribeDiagramStop } from "../runtime";
import type { Attr } from "../ui";
import { generateBytecode } from "./bytecode";
import { parsePython } from "./parser";
import { analyzePython } from "./semantic";
import { PythonHighlightEditor } from "./highlight-editor";

/**
 * Startでビルド・転送・VM_START、StopでVM_STOPを行う。Actionチェーンのrun()も同じ開始処理を待つ。
 * VMはESP32で独立して進むため、run()はVM初期化ACKまでを待ち、プログラム終了までは待たない。
 * Command v1（10バイト）にVM_START=10、VM_STOP=11を追加。CH=255、value=duration=0。
 * ESP32/lib/protocolが形式を検査し、app/diagram-control/src/main.cppのloop()が実行する。
 * COMMITは保持だけを行い、VM_STARTで保持中のコードを先頭から実行する。VM_STOPは所有機器も解放する。
 * 開始ACKは初期化の成功であり、実行終了・実行時エラーの通知は含まない。
 */
export class PythonBlock extends ActionBlock {
    readonly sourceEditor: HTMLTextAreaElement;
    private readonly highlightEditor: PythonHighlightEditor;
    private readonly panel = document.createElement("div");
    private readonly maximizeButton = document.createElement("button");
    private readonly minimizeButton = document.createElement("button");
    private readonly startButton = document.createElement("button");
    private readonly stopButton = document.createElement("button");
    private readonly statusView = document.createElement("div");
    private readonly events = new AbortController();
    private readonly releaseBLE: () => void;
    private readonly releaseStop: () => void;
    private request?: AbortController;
    private stopping?: Promise<void>;
    private receipt?: BytecodeReceipt;
    private uploadedSource?: string;
    private expanded = false;
    private removed = false;
    private ownsVM = false;
    private vmReceipt?: BytecodeReceipt;
    private editRevision = 0;

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
        const controls = document.createElement("div");
        Object.assign(controls.style, { display: "flex", gap: "6px", flexWrap: "wrap" });
        const buttons: [HTMLButtonElement, string, () => void][] = [
            [this.maximizeButton, "最大化", () => this.setExpanded(true)],
            [this.minimizeButton, "最小化", () => this.setExpanded(false)],
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
            this.receipt = undefined;
            this.uploadedSource = undefined;
            this.showStatus("ソースを変更しました。次のStartでビルド・送信します。");
        }, { signal: this.events.signal });
        // textarea内のTabはフォーカス移動の代わりに4スペースを挿入する。
        editor.addEventListener("keydown", event => {
            if (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                event.preventDefault();
                editor.setRangeText("    ", editor.selectionStart, editor.selectionEnd, "end");
                editor.dispatchEvent(new Event("input"));
            }
        }, { signal: this.events.signal });
        this.statusView.setAttribute("role", "status");
        Object.assign(this.statusView.style, { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minHeight: "18px" });
        panel.append(heading, controls, this.highlightEditor.element, this.statusView);
        (document.getElementById("layer-diagram") || document.body).appendChild(panel);
        this.releaseBLE = diagramBLE.subscribe(state => {
            if (state.phase !== "connected" || state.transport === "wifi") {
                this.receipt = undefined;
                this.ownsVM = false;
                this.request?.abort();
            }
            if (this.vmReceipt && diagramBLE.bytecodeReceipt !== this.vmReceipt) {
                this.ownsVM = false;
                this.vmReceipt = undefined;
            }
            this.updateControls();
        });
        this.releaseStop = subscribeDiagramStop(() => {
            void this.stop().catch(() => undefined);
        });
        this.showStatus("最大化してPythonコードを編集してください。");
        this.positionPanel();
    }

    setBoxSize(): void {
        this.boxSize = new Vec2(370, 185);
    }

    /** 最大化状態は保存せず、ソースだけを通常のActionBlock情報に追加する。 */
    makeObj(): any {
        return { ...super.makeObj(), source: this.sourceEditor.value };
    }

    loadObj(obj: any): void {
        super.loadObj(obj);
        this.sourceEditor.value = typeof obj.source === "string" ? obj.source : "";
        this.highlightEditor.refresh();
        this.receipt = undefined;
        this.uploadedSource = undefined;
    }

    copy(): PythonBlock {
        const block = new PythonBlock({});
        this.copyUI(block);
        block.sourceEditor.value = this.sourceEditor.value;
        block.highlightEditor.refresh();
        block.setContext2D(this.ctx);
        block.setBlockPortPosition(block.position);
        return block;
    }

    /** diagramのDOM親を覆って編集する。通常のCanvas配置は変えず、縮小時にそのまま戻す。 */
    private setExpanded(expanded: boolean): void {
        if (this.removed || this.inToolbox) {
            return;
        }
        this.expanded = expanded;
        this.highlightEditor.element.style.display = expanded ? "block" : "none";
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
        this.startButton.disabled = disabled || this.request !== undefined || this.stopping !== undefined
            || diagramBLE.bytecodeSending || diagramBLE.state.phase !== "connected" || diagramBLE.state.transport === "wifi";
        this.stopButton.disabled = disabled || this.stopping !== undefined || (!this.request && !this.ownsVM);
        this.sourceEditor.readOnly = this.request !== undefined;
    }

    private showStatus(message: string): void {
        this.statusView.textContent = message;
        this.statusView.title = message;
        this.updateControls();
        theCanvas?.requestUpdateCanvas();
    }

    /** 未編集・現接続・最後の転送の3条件を満たすときだけ、ビルドとBLE転送を省略する。 */
    private async start(signal?: AbortSignal): Promise<void> {
        if (this.removed || this.inToolbox || this.request || this.stopping) {
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
            if (diagramBLE.state.phase !== "connected" || diagramBLE.state.transport === "wifi") {
                throw new Error("BLE接続ブロックでESP32へBLE接続してください。");
            }
            let receipt = this.receipt;
            if (!receipt || this.uploadedSource !== source || diagramBLE.bytecodeReceipt !== receipt) {
                this.showStatus("Pythonをビルドしています…");
                const module = parsePython(source);
                const analysis = await analyzePython(module, controller.signal);
                controller.signal.throwIfAborted();
                const bytes = generateBytecode(module, analysis);
                this.showStatus("バイトコードをBLE送信しています…");
                receipt = await diagramBLE.sendBytecode(bytes, controller.signal);
                controller.signal.throwIfAborted();
                if (this.sourceEditor.value === source && this.editRevision === editRevision) {
                    this.receipt = receipt;
                    this.uploadedSource = source;
                }
            }
            this.showStatus("VMを開始しています…");
            // 書込み直後から所有扱いにし、ACK待機中のStopでもVM_STOPを必ず送る。
            this.ownsVM = true;
            this.vmReceipt = receipt;
            await diagramBLE.startBytecode(receipt, current);
            controller.signal.throwIfAborted();
            this.showStatus("VM開始を受け付けました。実行結果はESP32のシリアルで確認できます。");
        }
        catch (error) {
            if (!this.removed) {
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
        await this.start(getProcedureSignal());
    }

    /** 開始待機を無効化してから停止指令を送る。転送の取消で切断した場合は機器側の切断停止を使う。 */
    private stop(): Promise<void> {
        if (this.stopping) {
            return this.stopping;
        }
        const active = this.request !== undefined || this.ownsVM;
        this.request?.abort();
        this.ownsVM = false;
        this.vmReceipt = undefined;
        if (!active) {
            return Promise.resolve();
        }
        const task = diagramBLE.stopBytecode().then(() => {
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
        this.releaseBLE();
        this.events.abort();
        this.highlightEditor.dispose();
        this.panel.remove();
        super.clearBlock();
    }
}

registerActionBlock(PythonBlock.name, () => new PythonBlock({}));
