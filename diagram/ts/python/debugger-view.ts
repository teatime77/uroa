/**
 * PythonBlockの停止時専用表示。通信はせず、同一ビルドのDebugInfoと検証済みSnapshotだけを使う。
 * 全Call Stackを復元・検証してから公開する。関数名の選択は閲覧だけでVMのPC/BPを変更しない。
 * 局所欄は仮引数を含み、global宣言・一時領域・管理値は除外する。構造体は宣言順の幅で再帰展開する。
 * 大域とスタックの生スロットは別の折畳み欄で表示する。DOMはtextContentで構築し、値をHTMLとして解釈しない。
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

/** DOM・イベントはこの表示が所有し、clear()で停止値とフレーム選択を全破棄する。 */
export class PythonDebuggerView {
    readonly element = document.createElement("section");

    constructor() {
        this.element.setAttribute("aria-label", "Pythonデバッグ情報");
        Object.assign(this.element.style, { display: "none", flex: "1 1 45%", minHeight: "0",
            overflow: "auto", background: "#f4f6ef", border: "1px solid #87957a", padding: "8px" });
    }

    clear(): void {
        this.element.replaceChildren();
        this.element.style.display = "none";
    }

    /** 現フレームを初期選択し、クリック・キーボードで呼出し元へ切り替える。 */
    show(info: PythonDebugInfo, snapshot: DebugSnapshot): void {
        const frames = restoreFrames(info, snapshot);
        // 大域の一時領域もSnapshotにあるが、利用者変数だけを通常欄へ出す。
        const globalView = this.variables(info.globals, snapshot.globals, 0, snapshot.globals.length, info, snapshot);
        const localViews = frames.map(frame => this.variables(frame.fn.variables, snapshot.stack, frame.bp, frame.limit, info, snapshot));
        const registers = textElement("div", `ブレークポイントで停止　PC=${snapshot.pc}　SP=${snapshot.sp}　BP=${snapshot.bp}`);
        const grid = document.createElement("div");
        Object.assign(grid.style, { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" });
        const calls = document.createElement("div");
        calls.append(textElement("h3", "Call Stack"));
        const globals = document.createElement("div");
        globals.append(textElement("h3", "大域変数"), globalView);
        const locals = document.createElement("div");
        const localTitle = textElement("h3", "局所変数");
        const localValues = document.createElement("div");
        locals.append(localTitle, localValues);
        const buttons: HTMLButtonElement[] = [];
        const select = (index: number) => {
            const frame = frames[index];
            localTitle.textContent = `局所変数: ${frame.fn.name} (BP=${frame.bp})`;
            localValues.replaceChildren(localViews[index]);
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
                marginBottom: "4px", cursor: "pointer", color: "#163b2b", border: "1px solid #87957a" });
            button.addEventListener("click", () => select(index));
            buttons.push(button);
            calls.append(button);
        }
        select(0);
        grid.append(calls, globals, locals);
        const raw = document.createElement("details");
        raw.append(textElement("summary", "大域・スタックの全スロット（管理値・一時値を含む）"));
        const rawText = [...snapshot.globals.map((value, slot) => `G[${slot}] ${this.value(value, snapshot)}`),
            ...snapshot.stack.map((value, slot) => `S[${slot}] ${this.value(value, snapshot)}`)].join("\n");
        raw.append(textElement("pre", rawText || "スロットなし"));
        this.element.replaceChildren(registers, grid, raw);
        this.element.style.display = "block";
    }

    private value(value: DebugValue, snapshot: DebugSnapshot): string {
        switch (value.tag) {
            case 0:
                return "未初期化";
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
