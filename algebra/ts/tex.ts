import { $div, assert, msg, MyError } from "@i18n";
import { App, Binding, ConstNum, isUnicodeLetter, RefVar, Term } from "@parser";
import katex from "katex";
// KaTeX ships its stylesheet without TypeScript declarations.
// @ts-ignore -- this is a runtime-only side-effect import.
import "katex/dist/katex.min.css";
import { Formula, PredicateNode } from "./formula";
import { ProofStep, showFormulaMenu } from "./algebra_util";
import { makeFormulaMenu, makeProofStepMenu } from "./ProofStep";
import { SearchSimplifier } from "./manipulation";

const nodeMap = new Map<string, Term>();

export let mathSelection : MathSelection | undefined;
let selection_box! : HTMLDivElement;

let dragging = false;

let pointer_id: number | null = null;

let start_x = 0;
let start_y = 0;

interface NodeSelection {
    kind: "node";
    nodeId: string;
    selectedTerm : Term;
}

interface AssociativeRangeSelection {
    kind: "associative-range";

    parentId: string;

    startIndex: number;
    endIndex: number;
}

type MathSelection = | NodeSelection | AssociativeRangeSelection;

interface SelectionCandidate {
    selection: MathSelection;
    area: number;
}

function findAssociativeSelection(container: HTMLElement, mouse_rect: DOMRect): SelectionCandidate | null {
    /*
     * Immediate children of associative nodes.
     */
    const elements =
        Array.from(
            container.querySelectorAll<HTMLElement>(
                ".katex-html " +
                "[data-assocparent]" +
                "[data-associndex]"
            )
        );


    /*
     * Group fully-contained operands by parent.
     *
     * For example:
     *
     *     parent n1 -> [1, 2, 3]
     */
    const groups = new Map<string, Map<number, HTMLElement>>();

    for (const element of elements) {
        const rect = element.getBoundingClientRect();

        /*
         * Same strict containment rule as
         * findNodeSelection().
         */

        if (!containsRectangle(mouse_rect, rect) ) {
            continue;
        }

        const parent_id  = element.dataset.assocparent;
        const index_text = element.dataset.associndex;


        if (parent_id === undefined || index_text === undefined) {
            continue;
        }

        const index = Number(index_text);

        if (!Number.isInteger(index))
            continue;

        let group = groups.get(parent_id);

        if (!group) {

            group = new Map<number, HTMLElement>();

            groups.set(parent_id, group);
        }

        group.set(index, element);
    }


    let best: SelectionCandidate | null = null;

    /*
     * Look for consecutive runs.
     */
    for (const [parent_id, group] of groups) {

        const indexes = Array.from(group.keys() ).sort(
                (a, b) => a - b
            );


        if (indexes.length < 2)
            continue;


        /*
         * Example:
         *
         * indexes = [0, 1, 3, 4, 5]
         *
         * creates:
         *
         * [0,1]
         * [3,4,5]
         */

        let start_index = indexes[0];
        let end_index   =   indexes[0];

        function considerRange(start: number, end: number): void {
            /*
             * At least two operands are required.
             */

            if (end <= start) {
                return;
            }

            const rectangles: DOMRect[] = [];

            for (let index = start; index <= end; ++index) {
                const element = group.get(index);
                if (!element)
                    return;

                rectangles.push( element.getBoundingClientRect() );
            }

            /*
             * Find a bounding rectangle for the
             * entire associative range.
             */

            let left   = rectangles[0].left;
            let right  = rectangles[0].right;
            let top    = rectangles[0].top;
            let bottom = rectangles[0].bottom;


            for (let i = 1; i < rectangles.length; ++i) {
                const rect = rectangles[i];

                left  = Math.min(left, rect.left);
                right = Math.max(right, rect.right);

                top    = Math.min(top, rect.top);
                bottom = Math.max(bottom, rect.bottom);
            }

            const area = (right - left) * (bottom - top);

            /*
             * If nested associative operations both
             * qualify, use the visually largest range.
             */
            if (best === null || area > best.area) {
                best = {
                    selection: {
                        kind: "associative-range",
                        parentId: parent_id,
                        startIndex: start,
                        endIndex: end
                    },

                    area
                };
            }
        }

        for (let i = 1; i < indexes.length; ++i) {
            const current = indexes[i];

            if (current === end_index + 1) {
                end_index = current;

                continue;
            }

            /*
             * Previous contiguous range ended.
             */
            considerRange(start_index, end_index);

            start_index = current;
            end_index   = current;
        }

        /*
         * Last range.
         */
        considerRange(start_index, end_index);
    }

    return best;
}


/*
 * Values inserted into data attributes are generated
 * internally, but validate them anyway.
 */

function validateDataValue(value: string): string {
    if ( !/^[A-Za-z0-9_-]+$/.test( value) ) {

        throw new Error( `Invalid htmlData value: ${value}` );
    }

    return value;
}


function htmlData(attributes: Record<string, string | number>, body: string): string {
    const attributes_text = Object.entries(attributes)
            .map( ([name, value]) => `${name}=${validateDataValue(String(value))}` )
            .join(",");

    return (`\\htmlData{${attributes_text}}{${body}}`);
}

/* ============================================================
 * Mouse rectangle
 * ============================================================
 */

function makeRectangle( x1: number, y1: number, x2: number, y2: number): DOMRect {
    const left = Math.min( x1, x2);
    const top  = Math.min( y1, y2);

    const width = Math.abs( x2 - x1);
    const height = Math.abs( y2 - y1);

    return new DOMRect( 
        left, 
        top, 
        width, 
        height
    );
}


/* ============================================================
 * Rectangle containment
 *
 * Is "inner" completely contained in "outer"?
 * ============================================================
 */
function containsRectangle(outer: DOMRect, inner: DOMRect): boolean {
    return (
        inner.left >= outer.left &&
        inner.right <= outer.right &&
        inner.top >= outer.top &&
        inner.bottom <= outer.bottom
    );
}

/* ============================================================
 * Node selection
 *
 * THIS IS THE COMPLETE SELECTION ALGORITHM.
 *
 * 1. Find every [data-astid].
 *
 * 2. Get its bounding rectangle.
 *
 * 3. Check whether the entire node rectangle is
 *    contained in the mouse rectangle.
 *
 * 4. Of all contained nodes, choose the one with
 *    the largest area.
 *
 * No:
 *
 *     center-point tests
 *     coverage
 *     scores
 *     anchor nodes
 *     ancestor expansion
 *     associative selection
 *
 * ============================================================
 */
function findNodeSelection( container: HTMLElement, mouse_rect: DOMRect): SelectionCandidate | null {
    const elements = container.querySelectorAll<HTMLElement>( 
            ".katex-html [data-astid]" 
        );

    let best: SelectionCandidate | null = null;

    for (const element of elements) {
        const ast_id = element.dataset.astid;

        if (!ast_id) 
            continue;


        const rect = element.getBoundingClientRect();

        if ( rect.width <= 0 || rect.height <= 0 ) {
            continue;
        }

        if ( !containsRectangle( mouse_rect, rect) ) {
            continue;
        }

        const area = rect.width * rect.height;

        if ( best === null || area > best.area) {
            const selectedTerm = nodeMap.get(ast_id)!;
            assert(selectedTerm != undefined);
            best = {
                selection: {
                    kind: "node",
                    nodeId: ast_id,
                    selectedTerm
                },

                area
            };
        }
    }

    return best;
}

function findSelection( container: HTMLElement, mouse_rect: DOMRect): MathSelection | undefined {
    const node_candidate = findNodeSelection( container, mouse_rect);

    const associative_candidate = findAssociativeSelection( container, mouse_rect);

    if ( node_candidate === null && associative_candidate === null) {
        return undefined;
    }

    if ( node_candidate === null) {
        return ( associative_candidate!.selection);
    }

    if ( associative_candidate === null) {
        return ( node_candidate.selection);
    }

    /*
     * Both are possible.
     *
     * Choose the larger mathematical region.
     */
    if ( associative_candidate.area > node_candidate.area) {
        return ( associative_candidate.selection);
    }

    return ( node_candidate.selection);
}

/* ============================================================
 * Find rendered DOM element for AST node
 * ============================================================
 */

function findAstElement( container: HTMLElement, ast_id: string): HTMLElement | null {
    const elements = container.querySelectorAll<HTMLElement>( ".katex-html [data-astid]" );

    for (const element of elements) {
        if ( element.dataset.astid === ast_id) {

            return element;
        }
    }

    return null;
}


/* ============================================================
 * Highlight
 * ============================================================
 */

export function clearHighlight( container: HTMLElement): void {
    container.querySelectorAll( 
            ".ast-selected" 
        )
        .forEach(
            element => {
                element.classList.remove( "ast-selected" );
            }
        );
}

function highlightSelection( container: HTMLElement, selection: MathSelection): void {
    clearHighlight($div("formula-book"));

    /* ========================================================
     * Ordinary AST node
     * ========================================================
     */
    if (selection.kind === "node") {
        const element = findAstElement(container, selection.nodeId);

        element?.classList.add("ast-selected");

        return;
    }

    /* ========================================================
     * Associative operands
     * ========================================================
     */

    const operands = container.querySelectorAll<HTMLElement>(
            ".katex-html " +
            "[data-assocparent]" +
            "[data-associndex]"
        );

    for (const element of operands) {
        if ( element.dataset.assocparent !== selection.parentId) {
            continue;
        }

        const index = Number( element.dataset.associndex);

        if ( index >= selection.startIndex && 
            index <= selection.endIndex) {

            element.classList.add( "ast-selected" );
        }
    }


    /* ========================================================
     * Operators between selected operands
     *
     * If terms 1..3 are selected:
     *
     *     term1 + term2 + term3
     *
     * separators 1 and 2 are highlighted.
     * ========================================================
     */
    const separators = 
        container.querySelectorAll<HTMLElement>( 
            ".katex-html " + 
            "[data-assocsep]" + 
            "[data-sepindex]" 
        );

    for (const element of separators) {
        if ( element.dataset.assocsep !== selection.parentId) {
            continue;
        }

        const index = Number( element.dataset.sepindex);
        if ( selection.startIndex <= index && index < selection.endIndex) {
            element.classList.add( "ast-selected" );
        }
    }
}

/* ============================================================
 * Render KaTeX
 * ============================================================
 */

/* ============================================================
 * Pointer interaction
 * ============================================================
 */
function showSelectionBox( rect: DOMRect): void {

    selection_box.style.display = "block";

    selection_box.style.left = `${rect.left}px`;

    selection_box.style.top = `${rect.top}px`;

    selection_box.style.width = `${rect.width}px`;

    selection_box.style.height = `${rect.height}px`;
}

export function hideSelectionBox(): void {
    selection_box.style.display = "none";
}

function showSelection(selection : MathSelection){
    if(selection.kind == "node"){
        const term = nodeMap.get(selection.nodeId)!;
        assert(term != undefined);

        msg(`select:[${term}]`);
    }
    else if(selection.kind == "associative-range"){
        const parent = nodeMap.get(selection.parentId) as App;
        assert(parent instanceof App);

        assert(0 <= selection.startIndex && selection.startIndex < selection.endIndex && selection.endIndex + 1 <= parent.args.length);
        const terms = parent.args.slice(selection.startIndex, selection.endIndex + 1);
        const s = terms.map(x => `[${x}]`).join(" ");
        msg(`select:${selection.startIndex}-${selection.endIndex} ${s}`);
    }
    else{
        throw new MyError();
    }

}

export class TexSelection {
    node : PredicateNode;
    mathContainer! : HTMLDivElement;

    constructor(parent:HTMLElement, node : PredicateNode){        
        this.node = node;

        let term:Term;
        if(node instanceof Formula){
            term = node.predicate;
        }
        else if(node instanceof ProofStep){
            term = node.getResult();
        }
        else{
            throw new MyError();
        }

        const tex = toTex(term);
        this.mathContainer = document.createElement( "div" );
        this.mathContainer.className = "math-container";
        parent.appendChild(this.mathContainer);

        katex.render(
            tex,
            this.mathContainer,
            {
                throwOnError: true,
                displayMode: true,
                trust: context => context.command === "\\htmlData",
                strict: error_code => error_code === "htmlExtension" ? "ignore" : "warn" 
            }
        );

        this.mathContainer.addEventListener("pointerdown", this.onPointerDown.bind(this));
        this.mathContainer.addEventListener("pointermove", this.onPointerMove.bind(this));
        this.mathContainer.addEventListener("pointerup", this.onPointerUp.bind(this));
        this.mathContainer.addEventListener("pointercancel", this.onPointerCancel.bind(this));
        this.mathContainer.addEventListener("contextmenu", this.onContextmenu.bind(this));
    }

    /*
    * Called continuously while dragging.
    */
    updateSelection( current_x: number, current_y: number): MathSelection | undefined {
        const mouse_rect = makeRectangle( start_x, start_y, current_x, current_y);

        showSelectionBox( mouse_rect);

        /*
        * Ignore tiny accidental movements.
        */

        if ( mouse_rect.width < 2 || mouse_rect.height < 2 ) {
            clearHighlight( this.mathContainer);

            return undefined;
        }

        const selection = findSelection( this.mathContainer, mouse_rect);
        if(selection != undefined){

            highlightSelection( this.mathContainer, selection);
        }


        return selection;
    }

    onPointerDown(event : PointerEvent){
        msg(`down:${event.button}`);

        if (event.button !== 0) {
            return;
        }
        mathSelection = undefined;

        event.preventDefault();

        dragging = true;
        pointer_id = event.pointerId;

        start_x = event.clientX;
        start_y = event.clientY;

        /*
            * Clear previous selection when
            * starting a new drag.
            */

        clearHighlight(this.mathContainer);

        /*
            * Keep receiving pointermove even if
            * pointer leaves the math container.
            */

        this.mathContainer.setPointerCapture( event.pointerId);


        showSelectionBox( 
            makeRectangle( start_x, start_y, start_x, start_y) 
        );
    }

    onPointerMove(event : PointerEvent){
        // msg(`move:${event.button}`);
        if (!dragging || event.pointerId !== pointer_id) {
            return;
        }

        this.updateSelection(event.clientX, event.clientY);
    }

    onPointerUp(event : PointerEvent){
        msg(`up:${event.button}`);
        if(event.button == 2){
            return;
        }
        clearHighlight(this.mathContainer);

        if ( !dragging || event.pointerId !== pointer_id) { 
            return; 
        } 

        mathSelection = this.updateSelection( event.clientX, event.clientY);
        if(mathSelection != undefined){
            showSelection(mathSelection);
        }

        dragging = false;

        hideSelectionBox();


        if ( this.mathContainer.hasPointerCapture(event.pointerId)) {

            this.mathContainer.releasePointerCapture(event.pointerId);
        }

        pointer_id = null;    
    }

    onPointerCancel(event : PointerEvent){
        if ( event.pointerId !== pointer_id) {
            return;
        }

        dragging   = false;
        pointer_id = null;

        hideSelectionBox();
    }

    onContextmenu(event : PointerEvent){
        msg(`menu:${event.button}`);
        event.preventDefault();
        if(this.node instanceof Formula){
            showFormulaMenu(
                makeFormulaMenu(this.node),
                event.clientX, event.clientY
            );
        }
        else if(this.node instanceof ProofStep){
            this.node.result!.setString();
            const items = makeProofStepMenu(this.node);
            SearchSimplifier(this.node, items)
            showFormulaMenu(
                items,
                event.clientX, event.clientY
            );
        }
        else{
            throw new MyError();
        }
    }
}


function nodeId(term:Term) : string {
    const id = `nd${term.id}`;
    nodeMap.set(id, term);
    return id;
}

function BindingToTex(bnd : Binding){
    let body: string;
    const args = bnd.args.map(x => toTex(x));

    const varName = bnd.vars[0].name;
    switch(bnd.fncName){
    case "limit":
        body =
            `\\displaystyle ` +
            `\\lim_{${varName} \\to ${args[1]}} ` +
            `${args[0]}`;
        break;

    case "integrate":
        body =
            `\\displaystyle ` +
            `\\int_{${args[1]}}` +
            `^{${args[2]}} ` +
            `${args[0]}` +
            `\\,d${varName}`;
        break;

    case "diff":
        body = `\\frac{d ${toTex(bnd.getArg(0))}}{d ${varName}}`;
        break;
    default:
        throw new MyError();
    }

    return body;
}

export function toTex(term : Term) : string {
    let body: string;

    if(term instanceof ConstNum){
        if(term.value.denominator == 1){

            body = ` ${term.value.numerator} `;
        }
        else{

            body = ` \\frac{${term.value.numerator}}{${term.value.denominator}} `;
        }
    }
    else if(term instanceof RefVar){
        body = ` ${term.name} `;
    }
    else if(term instanceof Binding){
        body = BindingToTex(term);
    }
    else if(term instanceof App){
        if(term.fnc instanceof RefVar && term.args.length == 1 && term.args[0].isApp("[]")){
            const list = term.args[0] as App;
            const listTex = list.args.map(x => toTex(x)).join(", ");
            body = `{${toTex(term.fnc)}}_{${listTex}}`;
        }
        else{

            const args = term.args.map(x => toTex(x));

            switch(term.fncName){
            case "limit":
                body =
                    `\\displaystyle ` +
                    `\\lim_{${args[1]} \\to ${args[2]}} ` +
                    `${args[0]}`;
                break;

            case "integrate":
                body =
                    `\\displaystyle ` +
                    `\\int_{${args[2]}}` +
                    `^{${args[3]}} ` +
                    `${args[0]}` +
                    `\\,d${args[1]}`;
                break;

            case "sin":
            case "cos":
            case "tan":
                if(term.args[0].isAdd() || term.args[0].isMul()){

                    body = `\\${term.fncName}{(${args[0]})}`;
                }
                else{

                    body = `\\${term.fncName}{${args[0]}}`;
                }
                break;
            case "sqrt":
                body = `\\${term.fncName}{${args[0]}}`;
                break;

            case "root":
                body = `\\sqrt[${args[1]}]{${args[0]}}`;
                break;

            case "+":
                body = "";
                for(const [i, arg] of term.args.entries()){
                    assert(arg.value.fval() == arg.value.int());
                    if(arg.value.fval() < 0){
                        body += ` - ${args[i]}`;
                    }
                    else if(i == 0 || args.length == 1){
                        body = args[0];
                    }
                    else{
                        body += ` + ${args[i]}`;
                    }
                }
                break;

            case "=":
                body = args.join(` ${term.fncName} `);
                break;

            case "*":
                body = args.join(" \\cdot ");
                break;

            case "/":
                body = `\\frac{${args[0]}}{${args[1]}}`;
                break;

            case "^":
                if(term.args[0] instanceof App && ["sin","cos","tan"].includes(term.args[0].fncName)){

                    const app = term.args[0];
                    body = `\\${app.fncName}^{${args[1]}}`;
                    if(app.args[0].isAdd() || app.args[0].isMul()){

                        body += `( ${toTex(app.args[0])} )`;
                    }
                    else{

                        body += ` ${toTex(app.args[0])}`;
                    }
                }
                else{

                    body = `{${args[0]}}^{${args[1]}}`;
                }
                break;

            // case "[]":
            //     assert(term.args[1].isApp("[]"));
            //     body = `{${args[0]}}_{${args[1]}}`;
            //     break;

            default:
                if([...term.fncName].every(x => isUnicodeLetter(x))){
                    body = `${term.fncName}(${args.join(", ")})`;
                }
                else{

                    throw new MyError();
                }
            }

            if(term.isOperator() && term.parent != null && term.parent.isOperator() && !term.parent.isDiv()){
                if(term.parent.precedence() <= term.precedence()){
                    body = `\\left(${body}\\right)`;
                }            
            }
        }
    }
    else{
        throw new MyError();
    }

    const attributes: Record<string, string | number> = {
        astid: nodeId(term)
    };

    if(term.parent instanceof App && ["+", "*"].includes(term.parent.fncName)){
        attributes.assocparent = nodeId(term.parent);
        attributes.associndex = term.argIdx();

    }

    return htmlData(attributes, body);
}

export function initTexTest(){

    selection_box = document.createElement( "div" );

    selection_box.className = "selection-box";

    document.body.appendChild( selection_box);

    nodeMap.clear();
}