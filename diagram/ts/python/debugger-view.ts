/**
 * PythonBlockの停止時専用表示。通信はせず、同一ビルドのDebugInfoと検証済みSnapshotだけを使う。
 * 全Call Stackを復元・検証してから公開する。関数名の選択は閲覧だけでVMのPC/BPを変更しない。
 * 局所欄は仮引数を含み、global宣言・一時領域・管理値は除外する。構造体は宣言順の幅で再帰展開する。
 * python-block.tsが本表示をエディタ右側へ配置する。操作、大域、局所、Call Stack、全スロットを縦に並べ、
 * 欄全体を必要時に縦スクロールする。clear()でも操作と各欄の見出しを残し、古い停止値だけを破棄する。
 * DOMはtextContentで構築し、値をHTMLとして解釈しない。
 */
import type { DebugSnapshot, DebugValue } from "../ble-wifi/debug-protocol";
import type { PythonDebugFunction, PythonDebugInfo } from "./debug-info";
import { valueSlotTypes, type PythonType, type PythonVariable } from "./semantic";

interface DebugFrame {
    fn: PythonDebugFunction;
    bp: number;
    pc: number;
    limit: number;
}

/** ソース行は元のUTF-16位置を使う。自動生成命令では行を捏造しない。 */
export function debugLine(info: PythonDebugInfo, pc: number): number | undefined {
    const stop = info.stops.find(point => point.pc === pc);
    if (stop) {
        return stop.line;
    }
    const position = info.instructions.get(pc)?.charPos;
    return position === undefined || position < 0 ? undefined : info.source.slice(0, position).split("\n").length;
}

/** BP=0のモジュールと最初の関数を関数範囲・CALL対応で区別し、再帰も全件復元する。 */
function restoreFrames(info: PythonDebugInfo, snapshot: DebugSnapshot): DebugFrame[] {
    const frames: DebugFrame[] = [];
    let pc = snapshot.pc;
    let bp = snapshot.bp;
    let limit = snapshot.sp;
    for (let depth = 0; depth <= 64; depth++) {
        const fn = info.functions.find(item => pc >= item.entryPc && pc < item.endPc);
        if (!fn || !info.instructions.has(pc) || bp + fn.slots > limit) {
            throw new Error("停止データと関数の配置が一致しません。");
        }
        frames.push({ fn, pc, bp, limit });
        if (fn === info.functions[0]) {
            if (bp !== 0) {
                throw new Error("モジュールのBPが不正です。");
            }
            return frames;
        }
        const returnPc = snapshot.stack[bp];
        const savedBp = snapshot.stack[bp + 1];
        if (returnPc?.tag !== 4 || savedBp?.tag !== 5) {
            throw new Error("Call Stackの管理スロットが不正です。");
        }
        const callPc = Number(returnPc.value) - 3;
        const call = info.instructions.get(callPc);
        const parentBp = Number(savedBp.value);
        if (call?.opcode !== "CALL" || call.operand !== fn.name || parentBp > bp
            || parentBp === bp && call.owner !== undefined) {
            throw new Error("Call Stackの戻り先が一致しません。");
        }
        pc = callPc;
        limit = bp;
        bp = parentBp;
    }
    throw new Error("Call Stackの深さが上限を超えています。");
}

function textElement(tag: string, text: string): HTMLElement {
    const element = document.createElement(tag);
    element.textContent = text;
    return element;
}

/** 浮動小数点スロットだけを小数点以下3桁へ丸める。大きな値も指数表記・桁区切りを使わない。 */
const floatFormat = new Intl.NumberFormat("en-US", {
    useGrouping: false, minimumFractionDigits: 3, maximumFractionDigits: 3
});

/** 再開とステップの操作アイコン。VMの制御処理は未実装なのでボタンは常に無効とする。 */
function debugControls(): HTMLElement {
    const panel = document.createElement("div");
    panel.setAttribute("role", "toolbar");
    panel.setAttribute("aria-label", "デバッグ操作");
    Object.assign(panel.style, { display: "flex", gap: "6px", flexWrap: "wrap" });
    const icons = [
        { label: "再開", path: "M8 5 L19 12 L8 19 Z" },
        { label: "Step Over", path: "M4 11 C4 2 20 2 20 11 V14 M16 10 L20 14 L24 10 M8 20 H16" },
        { label: "Step In", path: "M12 3 V15 M7 10 L12 15 L17 10 M5 21 H19" },
        { label: "Step Out", path: "M12 21 V7 M7 12 L12 7 L17 12 M5 3 H19" }
    ];
    for (const icon of icons) {
        const button = document.createElement("button");
        button.type = "button";
        button.disabled = true;
        button.title = `${icon.label}（未実装）`;
        button.setAttribute("aria-label", button.title);
        Object.assign(button.style, { display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: "36px", height: "36px", padding: "5px", border: "1px solid #a2ad97",
            borderRadius: "4px", background: "#e7ebdf", color: "#7a8470", cursor: "not-allowed" });
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 28 24");
        svg.setAttribute("width", "24");
        svg.setAttribute("height", "24");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", icon.path);
        path.setAttribute("fill", icon.label === "再開" ? "currentColor" : "none");
        path.setAttribute("stroke", "currentColor");
        path.setAttribute("stroke-width", "2");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        svg.append(path);
        button.append(svg);
        panel.append(button);
    }
    return panel;
}

/** DOM・イベントはこの表示が所有し、clear()で停止値とフレーム選択を全破棄する。 */
export class PythonDebuggerView {
    readonly element = document.createElement("section");
    private readonly registers = document.createElement("div");
    private readonly globals = document.createElement("div");
    private readonly localTitle = textElement("h3", "局所変数");
    private readonly locals = document.createElement("div");
    private readonly calls = document.createElement("div");
    private readonly raw = document.createElement("pre");

    constructor() {
        this.element.setAttribute("aria-label", "Pythonデバッグ情報");
        Object.assign(this.element.style, { flex: "0 0 auto", width: "clamp(240px, 32%, 380px)", maxWidth: "50%",
            minWidth: "0", minHeight: "0", boxSizing: "border-box", overflowY: "auto", overflowX: "hidden",
            scrollbarGutter: "stable", background: "#f4f6ef", border: "1px solid #87957a", padding: "8px" });
        const controls = document.createElement("section");
        Object.assign(controls.style, { position: "sticky", top: "-8px", zIndex: "1", background: "#f4f6ef",
            padding: "8px 0", borderBottom: "1px solid #c4cbbd" });
        controls.append(this.heading("操作パネル"), debugControls(), textElement("div", "再開・ステップは未実装です。"), this.registers);
        const globals = document.createElement("section");
        globals.append(this.heading("大域変数"), this.globals);
        const locals = document.createElement("section");
        this.localTitle.style.cssText = "font-size:14px; margin:12px 0 6px; overflow-wrap:anywhere";
        locals.append(this.localTitle, this.locals);
        const calls = document.createElement("section");
        calls.append(this.heading("Call Stack"), this.calls);
        const raw = document.createElement("details");
        raw.append(textElement("summary", "大域・スタックの全スロット（管理値・一時値を含む）"), this.raw);
        raw.style.marginTop = "12px";
        Object.assign(this.raw.style, { whiteSpace: "pre-wrap", overflowWrap: "anywhere", font: "12px/1.5 monospace" });
        Object.assign(this.registers.style, { whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: "8px" });
        this.element.append(controls, globals, locals, calls, raw);
        this.clear();
    }

    private heading(text: string): HTMLElement {
        const heading = textElement("h3", text);
        Object.assign(heading.style, { fontSize: "14px", margin: "12px 0 6px" });
        return heading;
    }

    /** 停止データの失効後もパネルを残す。関数選択のイベントは旧ボタンと一緒に破棄する。 */
    clear(): void {
        this.registers.textContent = "停止データなし";
        this.globals.textContent = "停止データなし";
        this.localTitle.textContent = "局所変数";
        this.locals.textContent = "停止データなし";
        this.calls.textContent = "停止データなし";
        this.raw.textContent = "停止データなし";
    }

    /** 現フレームを初期選択し、クリック・キーボードで呼出し元へ切り替える。 */
    show(info: PythonDebugInfo, snapshot: DebugSnapshot): void {
        const frames = restoreFrames(info, snapshot);
        // 大域の一時領域もSnapshotにあるが、利用者変数だけを通常欄へ出す。
        const globalView = this.variables(info.globals, snapshot.globals, 0, snapshot.globals.length, info, snapshot);
        const localViews = frames.map(frame => this.variables(frame.fn.variables, snapshot.stack, frame.bp, frame.limit, info, snapshot));
        const calls = document.createElement("div");
        const buttons: HTMLButtonElement[] = [];
        const select = (index: number) => {
            const frame = frames[index];
            this.localTitle.textContent = `局所変数: ${frame.fn.name} (BP=${frame.bp})`;
            this.locals.replaceChildren(localViews[index]);
            for (const [buttonIndex, button] of buttons.entries()) {
                const selected = buttonIndex === index;
                button.setAttribute("aria-pressed", String(selected));
                button.style.background = selected ? "#d5e7bc" : "white";
            }
        };
        for (const [index, frame] of frames.entries()) {
            const line = debugLine(info, frame.pc);
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = `${index === 0 ? "→ " : ""}${frame.fn.name}　${line === undefined ? "自動生成" : `${line}行`}　BP=${frame.bp}`;
            Object.assign(button.style, { display: "block", width: "100%", textAlign: "left", padding: "6px",
                marginBottom: "4px", cursor: "pointer", color: "#163b2b", border: "1px solid #87957a",
                boxSizing: "border-box", overflowWrap: "anywhere" });
            button.addEventListener("click", () => select(index));
            buttons.push(button);
            calls.append(button);
        }
        select(0);
        const rawText = [...snapshot.globals.map((value, slot) => `G[${slot}] ${this.value(value, snapshot)}`),
            ...snapshot.stack.map((value, slot) => `S[${slot}] ${this.value(value, snapshot)}`)].join("\n");
        this.registers.textContent = `ブレークポイントで停止\nPC=${snapshot.pc}　SP=${snapshot.sp}　BP=${snapshot.bp}`;
        this.globals.replaceChildren(globalView);
        this.calls.replaceChildren(calls);
        this.raw.textContent = rawText || "スロットなし";
    }

    /** 構造体の末端・全スロットを含む共通の値表記。int・PC・BP・IDには小数点を付けない。 */
    private value(value: DebugValue, snapshot: DebugSnapshot): string {
        switch (value.tag) {
            case 0:
                return "未初期化";
            case 2:
                return floatFormat.format(Number(value.value));
            case 3:
                return "None";
            case 4:
                return `戻りPC ${value.value}`;
            case 5:
                return `保存BP ${value.value}`;
            case 6: {
                const text = snapshot.strings.get(Number(value.value));
                return text === undefined ? `文字列本体取得不可 (ID=${value.value})` : JSON.stringify(text);
            }
            case 7:
                return `handle=${value.value} (classId=${value.classId})`;
            default:
                return String(value.value);
        }
    }

    private variables(variables: readonly PythonVariable[], slots: readonly DebugValue[], base: number, limit: number,
        info: PythonDebugInfo, snapshot: DebugSnapshot): HTMLElement {
        const result = document.createElement("div");
        if (variables.length === 0) {
            result.textContent = "変数なし";
        }
        for (const variable of variables) {
            const type = variable.type!;
            const slot = base + variable.slot;
            if (variable.slot < 0 || slot + valueSlotTypes(type, info.api).length > limit) {
                throw new Error(`変数 ${variable.name} のスロット範囲が一致しません。`);
            }
            result.append(this.variable(variable.name, type, slot, slots, info, snapshot));
        }
        return result;
    }

    /** recordはフラットな末端スロットを名前付きの木へ戻す。機器のObjectは不透明ハンドルとして表示する。 */
    private variable(name: string, type: PythonType, slot: number, slots: readonly DebugValue[],
        info: PythonDebugInfo, snapshot: DebugSnapshot): HTMLElement {
        const owner = type.kind === "object" ? info.api.classes.find(item => item.id === type.classId) : undefined;
        const typeName = owner?.name ?? type.kind;
        if (owner?.kind === "record") {
            const details = document.createElement("details");
            details.open = true;
            details.append(textElement("summary", `${name}: ${typeName}`));
            const children = document.createElement("div");
            children.style.paddingLeft = "18px";
            let offset = slot;
            for (const field of owner.fields) {
                children.append(this.variable(field.name, field.type, offset, slots, info, snapshot));
                offset += valueSlotTypes(field.type, info.api).length;
            }
            if (owner.fields.length === 0) {
                children.textContent = slots[slot]?.tag === 0 ? "未初期化" : "メンバーなし";
            }
            details.append(children);
            return details;
        }
        const row = textElement("div", `${name}: ${typeName} = ${this.value(slots[slot], snapshot)}`);
        Object.assign(row.style, { whiteSpace: "pre-wrap", overflowWrap: "anywhere", padding: "3px 0" });
        return row;
    }
}
