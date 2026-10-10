import { $div, assert, MyError, remove } from "@i18n";
import { App, ConstNum, operator, Rational, RefVar, renderKatexSub, Term } from "@parser";

import { mathLib } from "./formula.js";
import type { PredicateNode } from "./formula.js";
import type { Proof } from "./proof.js";
import { clearHighlight, toTex } from "./tex.js";

export function putStr(div:HTMLDivElement, s : string){
    const p = document.createElement("p");
    p.innerHTML = s;
    div.appendChild(p);
}

export function putTex(div:HTMLDivElement, term : Term){
    const p = document.createElement("p");
    // p.innerHTML = `$$\n${term.tex()}\n$$`;
    div.appendChild(p);
    renderKatexSub(p, toTex(term));
}

export function makeAdd(trms : Term[]) : App {
    return new App(operator("+"), trms.slice());
}

export function makeMul(trms : Term[]) : App {
    return new App(operator("*"), trms.slice());
}

export function makeDiv(trms : Term[]) : App {
    return new App(operator("/"), trms.slice());
}

export function makeEq(trms : Term[]) : App {
    return new App(operator("=="), trms.slice());
}


export function makeAccordion(parent:HTMLElement, title:string) : HTMLDivElement {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const content = document.createElement("div");

    details.className = "accordion";

    summary.textContent= title;

    content.className = "accordion-content";

    details.appendChild(summary);
    details.appendChild(content);

    parent.appendChild(details);

    return content;
}

function fastHashToBigInt(str: string): bigint {
    let hash = 0xcbf29ce484222325n; // 64-bit FNV offset basis
    const prime = 0x100000001b3n;   // 64-bit FNV prime

    for (let i = 0; i < str.length; i++) {
        hash ^= BigInt(str.charCodeAt(i));

        // Multiply by prime and constrain to 64-bit unsigned integer
        hash = BigInt.asUintN(64, hash * prime);
    }

    return hash;
}


let hashMap : Map<string, bigint> ;

export function initHashTerm(){
    hashMap = new Map<string, bigint>();
}

function hashText(positions : number[], text : string) : bigint {
    const key = `${positions.join(".")}:${text}`
    let value = hashMap.get(key);
    if(value == undefined){
        if(hashMap.size < 64){

            value = 2n ** BigInt(hashMap.size);
        }
        else{

            value = BigInt(Math.random() * (2 ** 50));
        }
        // msg(`hash ${value.toString(2)} ${key}`);
        hashMap.set(key, value);
    }

    return value;
}

function hashRational(r : Rational) : string {
    if(r.denominator == 1){
        if(r.numerator == 1){
            return "";
        }
        else{
            return `${r.numerator}:`;
        }
    }
    else{
        return `${r.numerator}/${r.denominator}:`;
    }
}


export function setHashTerm(positions : number[], term : Term) : bigint {
    let hash : bigint;

    let value_str : string;
    if(positions.length == 0){
        value_str = "";
    }
    else{
        value_str = hashRational(term.value);
    }
    
    if(term instanceof ConstNum){

        hash = hashText(positions, value_str);
    }
    else if(term instanceof RefVar){
        hash = hashText(positions, value_str + term.name);
    }
    else if(term instanceof App){
        hash = hashText(positions, value_str + term.fncName);

        const positions_cp = positions.slice();
        if(term.isAdd() || term.isMul()){
            positions_cp.push(0);
            term.args.forEach(x => hash += setHashTerm(positions_cp, x));
        }
        else{
            for(const [idx, arg] of term.args.entries()){
                positions_cp.push(idx);

                hash += setHashTerm(positions_cp, arg);

                positions_cp.pop();
            }
        }
        
    }
    else{
        throw new MyError();
    }

    term.hash = hash;
    return term.hash;
}



function getTermByPointerEvent(map : Map<number,Term>, ev : PointerEvent) : Term {
    let target : HTMLElement = ev.target as HTMLElement;
    for(; target != null; target = target.parentElement as HTMLElement){
        if(target.id.startsWith("tex-term-")){

            const id_offset = "tex-term-".length;
            const id = parseInt(target.id.substring(id_offset));
            const term = map.get(id)!;
            assert(term != undefined);
            return term;
        }
    }

    throw new MyError();
}

export abstract class ProofStep implements PredicateNode {
    proof! : Proof;
    stepDiv! : HTMLDivElement;
    prevStep : ProofStep | undefined;
    result : Term | undefined;

    constructor(prevStep : ProofStep | undefined){
        this.prevStep = prevStep;
    }

    getNodeDiv() : HTMLDivElement {
        assert(this.stepDiv != undefined);
        return this.stepDiv;
    }

    setProof(proof : Proof){
        this.proof = proof;
    }

    getResult() : Term {
        assert(this.result != undefined);
        return this.result!;
    }

    abstract applyProofStep() : void;
    abstract toString() : string;
}

export class DummyStep extends ProofStep {    
    constructor(){
        super({} as ProofStep)
    }

    applyProofStep() : void {
        throw new MyError();
    }

    toString() : string {
        return "dummy-step";
    }
}

export interface FormulaAction {
    type: "action";
    step: ProofStep;
    name: string;
    latex: string;
}

export interface FormulaSubmenu {
    type: "submenu";
    name: string;
    items: FormulaMenuEntry[];
}

export type FormulaMenuEntry =
    | FormulaAction
    | FormulaSubmenu;

export function showFormulaMenu(items: FormulaMenuEntry[], x: number, y: number): void {
    document.querySelector(".formula-popup-menu")?.remove();

    const root_menu = createMenu(items);

    root_menu.classList.add("formula-popup-menu");
    document.body.appendChild(root_menu);

    root_menu.style.left = `${x}px`;
    root_menu.style.top = `${y}px`;

    adjustPosition(root_menu);

    function createMenu(menu_items: FormulaMenuEntry[]): HTMLDivElement {
        const menu = document.createElement("div");
        menu.className = "formula-menu";

        for (const item of menu_items) {
            if (item.type === "action") {
                menu.appendChild(createAction(item));
            } else {
                menu.appendChild(createSubmenu(item));
            }
        }

        return menu;
    }

    function createAction(item: FormulaAction): HTMLButtonElement {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "formula-menu-item";

        const name = document.createElement("span");
        name.className = "formula-menu-name";
        name.textContent = item.name;

        const formulaSpan = document.createElement("span");
        formulaSpan.className = "formula-menu-formula";

        renderKatexSub(formulaSpan, item.latex);

        button.append(name, formulaSpan);

        button.addEventListener("click", async(event) => {
            event.stopPropagation();

            close();
            item.step.applyProofStep();

            await saveData("output2.math", mathLib.toString());
        });

        return button;
    }

    function createSubmenu(item: FormulaSubmenu): HTMLDivElement {
        const container = document.createElement("div");
        container.className = "formula-submenu-container";

        const button = document.createElement("button");
        button.type = "button";
        button.className =
            "formula-menu-item formula-submenu-button";

        const name = document.createElement("span");
        name.className = "formula-menu-name";
        name.textContent = item.name;

        const arrow = document.createElement("span");
        arrow.className = "formula-submenu-arrow";
        arrow.textContent = "▶";

        button.append(name, arrow);

        const submenu = createMenu(item.items);
        submenu.classList.add("formula-submenu");

        container.append(button, submenu);

        return container;
    }

    function adjustPosition(menu: HTMLElement): void {
        const rect = menu.getBoundingClientRect();

        if (rect.right > window.innerWidth) {
            menu.style.left =
                `${Math.max(0, window.innerWidth - rect.width)}px`;
        }

        if (rect.bottom > window.innerHeight) {
            menu.style.top =
                `${Math.max(0, window.innerHeight - rect.height)}px`;
        }
    }

    function close(): void {
        root_menu.remove();

        document.removeEventListener("pointerdown", handleOutsideClick);
        document.removeEventListener("keydown"    ,handleKeyDown);

        clearHighlight($div("formula-book"));
    }

    function handleOutsideClick(event: PointerEvent): void {
        if (!root_menu.contains(event.target as Node)) {
            close();
        }
    }

    function handleKeyDown(event: KeyboardEvent): void {
        if (event.key === "Escape") {
            close();
        }
    }

    setTimeout(() => {
        document.addEventListener("pointerdown", handleOutsideClick);
        document.addEventListener("keydown"    ,handleKeyDown);
    });
}

export async function saveData(filename: string, data: unknown): Promise<void> {
    const type = typeof data == "string" ? "text" : "json";

    const response = await fetch('/api/save', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            filename,
            type,
            data,
        }),
    })

    if (!response.ok) {
        throw new Error(`Save failed: ${response.status}`)
    }
}
