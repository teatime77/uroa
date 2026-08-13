import { AbstractSpeech, assert, msg, MyError, Reading, Speech, Vec2 } from "@i18n";
import type { Readable } from "@i18n";
import { App, isGreek, operator, RefVar, renderKatexSub, Term } from "@parser";
import type { Highlightable } from "@parser";
import { transpose } from "@algebra";

import { ShapeMode } from "./enums";
import { AppServices, capturedShape, classCounters, GlobalState, idMap, setCapturedShape, Widget__processed } from "./inference";

// Actionを生成する関数の型定義
type entityCreator = (obj: any) => any;

export const entityRegistry: Record<string, entityCreator> = {};

export function registerEntity(name: string, creator: entityCreator) : void {
    entityRegistry[name] = creator;
}

export function fromXPixScale(pix : number) : number {
    return GlobalState.View__current!.fromXPixScale(pix);
}

export function fromYPixScale(pix : number) : number {
    return GlobalState.View__current!.fromYPixScale(pix);
}

export function toXPix(n : number) : number {
    return GlobalState.View__current!.toXPix(n);
}

export function toYPix(n : number) : number {
    return GlobalState.View__current!.toYPix(n);
}

export function toXPixScale(n : number) : number {
    return GlobalState.View__current!.toXPixScale(n);
}

export function toYPixScale(n : number) : number {
    return GlobalState.View__current!.toYPixScale(n);
}

function getTermFromPointerEvent(ev : PointerEvent, app : App) : Term | undefined {
    const terms = app.allTerms();

    let ele : HTMLElement | null = ev.target as HTMLElement;
    for(; ele != null; ele = ele.parentElement){
        if(ele.id.startsWith("tex-term-")){

            const id_offset = "tex-term-".length;
            const id = parseInt(ele.id.substring(id_offset));
            const term = terms.find(x => x.id == id)!;
            if(term == undefined){
                msg(`get-Term-From-Pointer-Event:no term id:[${id}]`)
                return undefined;
            }

            return term;
        }
    }

    throw new MyError();
}

export abstract class Widget {
    id : string;
    order : number = NaN;

    constructor(obj : any){        
        if(obj.id != undefined){

            this.id = `${obj.id}`;
            GlobalState.Widget__maxId = Math.max(GlobalState.Widget__maxId, obj.id);

            GlobalState.Widget__refMap.set(obj.id, this);
        }
        else{
            this.id = `${++GlobalState.Widget__maxId}`;
            // this.id = this.calcId();
        }
        assert(!idMap.has(this.id));
        idMap.set(this.id, this);
    }

    calcId() : string {
        // 新規作成時はクラス名から自動採番 (例: "Point_1")
        const className = this.constructor.name;
        const count = (classCounters.get(className) || 0) + 1;
        classCounters.set(className, count);
        
        return `${className}_${count}`;
    }

    getProperties(){
        return [ "id", "order" ];
    }

    makeObj() : any{
        return {
            id: this.id,
            typeName: this.constructor.name
        };
    }

    toObj(){
        if(Widget__processed.has(this.id)){
            return { ref: this.id };
        }

        Widget__processed.add(this.id);

        return this.makeObj();
    }
}

export abstract class MathEntity extends Widget implements Readable, Highlightable {
    setRelationsCount : number = 0;
    visible : boolean = true;
    mode : ShapeMode = ShapeMode.none;
    isOver : boolean = false;
    mute : boolean = false;
    interval : number = 1;

    constructor(obj : any){
        super(obj);

        if(obj.visible != undefined && !obj.visible){
            this.visible = false;
        }

        if(obj.mute != undefined){
            this.mute = obj.mute;
        }

        if(obj.interval != undefined){
            this.interval = obj.interval;
        }
        
        if(GlobalState.View__current != undefined){

            GlobalState.View__current!.dirty = true;
        }
    }

    makeObj() : any {
        let obj = super.makeObj();

        if(this.mute){
            obj.mute = true;
        }

        if(this.interval != 1){
            obj.interval = this.interval;
        }

        if(!this.visible){
            obj.visible = false;
        }

        return obj;
    }

    getProperties(){
        return super.getProperties().concat([
            "mute", "visible", "interval"
        ]);
    }

    abstract reading() : Reading;

    textReading(text : string) : Reading {
        return new Reading(this, text, []);
    }

    highlight(on : boolean) : void {
        if(on){
            this.setMode(ShapeMode.target);
        }
        else{
            this.setMode(ShapeMode.none);
        }
    }

    getAllShapes(shapes : MathEntity[]){
        shapes.push(this);
    }

    dependencies() : MathEntity[] {
        return [];
    }

    setOrder(){
        if(GlobalState.MathEntity__orderSet.has(this)){
            assert(!isNaN(this.order));
            return;
        }
        for(const dep of this.dependencies()){
            dep.setOrder();
        }

        assert(!GlobalState.MathEntity__orderSet.has(this));
        this.order = GlobalState.MathEntity__orderSet.size;
        GlobalState.MathEntity__orderSet.add(this);
    }

    setMode(mode : ShapeMode){
        this.mode = mode;
        GlobalState.View__current!.dirty = true;
    }

    delete(deleted : Set<string>){
        if(deleted.has(this.id)){
            return;
        }
        deleted.add(this.id);

        for(let [name, val] of Object.entries(this)){
            if(val instanceof MathEntity){
                val.delete(deleted);
            }
        }    
    }

    async play(speech : AbstractSpeech){
    }

    show(){        
    }

    hide(){        
    }

    setRelations(){
        this.setRelationsCount++;
    }
}

export class TermRect {
    term : Term;
    span : HTMLSpanElement;
    rect : DOMRect;

    constructor(term : Term, span : HTMLSpanElement){
        this.term = term;
        this.span = span;
        this.rect = span.getBoundingClientRect();
    }
}

export class TextBlockEvent {
    startTerm : Term | undefined;
    term : Term | undefined;
    textBlock : TextBlock | undefined;
    downTime : number = NaN;

    setTextBlockEvent(textBlock : TextBlock){
        textBlock.div.addEventListener("pointerdown", (ev : PointerEvent)=>{
            if(this.textBlock != textBlock){

                this.textBlock = textBlock;
            }

            if(textBlock.getEquation() == undefined){
                msg(`pointer-down:no app`);
                return;
            }

            this.term = getTermFromPointerEvent(ev, textBlock.getEquation()!);
            if(this.term == undefined){

                msg(`pointer-down: no term`);
            }
            else{

                this.downTime = Date.now();
                msg(`pointer-down:${this.term.str()}`);
            }
        });

        textBlock.div.addEventListener("pointerup", (ev : PointerEvent)=>{
            if(this.term != undefined && this.textBlock == textBlock){
                const elapsed_time = Date.now() - this.downTime;
                msg(`pointer-up:${elapsed_time} ${this.term.str()}`);

                if(this.startTerm == this.term){
                    this.startTerm = undefined;
                }

                this.term.colorName = (elapsed_time < 500 ? "blue" : "red");
                const root = this.term.getRoot();

                if(elapsed_time < 500){

                    if(this.startTerm != undefined){
                        const parent = this.startTerm.parent as App;
                        if(parent != null && this.term.parent == parent && (parent.isAdd() || parent.isMul())){
                            let idx1 = this.startTerm.argIdx();
                            let idx2 = this.term.argIdx();
                            if(idx2 < idx1){
                                [idx1, idx2] = [idx2, idx1];
                            }

                            const args = parent.args.slice(idx1, idx2 + 1);
                            const app = new App(operator(parent.fncName), args);
                            app.colorName = "red";
                            parent.args.splice(idx1, (idx2 + 1 - idx1));
                            parent.insArg(app, idx1);

                            this.term = app;
                        }
                    }
                }
                else{

                    this.startTerm = this.term;
                    this.term = undefined;
                }

                renderKatexSub(this.textBlock.div, root.tex());
            }
        });

        textBlock.div.addEventListener("contextmenu", (ev : MouseEvent)=>{
            msg("text-Block-context-menu");
            ev.stopPropagation();
            ev.preventDefault();
        });
    }

    async keyDown(ev : KeyboardEvent){
        if(this.term == undefined || this.textBlock == undefined){
            return;
        }
        const div = this.textBlock.div;

        if (ev.key === "Escape"){
            const root = this.term.getRoot();
            root.allTerms().forEach(x => x.colorName = undefined);
            renderKatexSub(div, root.tex());

            this.startTerm = undefined;
            this.term = undefined;
            this.textBlock = undefined;
            return;
        }

        const parent = this.term.parent;
        if(parent != null && (parent.isAdd() || parent.isMul())){
            msg(`key-down:${ev.key}`);

            let diff : number;
            if(ev.key == "ArrowRight"){
                diff = 1;
            }
            else if(ev.key == "ArrowLeft"){
                diff = -1;
            }
            else{
                return;
            }

            const new_idx = this.term.argIdx() + diff;
            const root = this.term.getRoot();
            if(new_idx == -1){
                if(parent.isAdd() && parent.parent != null && parent.parent.isEq() && 0 < parent.argIdx()){
                    await transpose(root, this.term, div, new Speech(), true, false);
                    renderKatexSub(div, root.tex());
                }
            }
            else if(new_idx < parent.args.length){

                this.term.argShift(diff);
                renderKatexSub(div, root.tex());
            }
            else if(new_idx == parent.args.length){
                if(parent.isAdd() && parent.parent != null && parent.parent.isEq() && parent.argIdx() == 0){
                    await transpose(root, this.term, div, new Speech(), false, false);
                    renderKatexSub(div, root.tex());
                }
            }
            else{
                msg("can not move.");
            }
        }
    }
}

export const textBlockEvent = new TextBlockEvent();

export class TextBlock extends MathEntity {
    parent : MathEntity | undefined;
    text  : string;
    isTex : boolean;
    div   : HTMLDivElement;

    offset : Vec2 = new Vec2(0, 0);
    termRects : TermRect[] = [];

    constructor(obj : { parent? : MathEntity, text : string, isTex : boolean, offset : Vec2 }){
        super(obj);
        this.parent = obj.parent;
        this.text  = obj.text;
        this.isTex = obj.isTex;
        this.offset = obj.offset;

        this.div   = document.createElement("div");
        if(this.getEquation() != undefined){

            this.div.className = "selectable_tex";
            this.div.addEventListener("click", this.texClick.bind(this));
        }
        else{

            this.div.className = "tex_div";
        }
        this.div.style.fontSize = "x-large";

        this.setVisible(this.visible);

        GlobalState.View__current!.canvas.parentElement!.append(this.div);

        if(this.getEquation() == undefined){

            AppServices.setCaptionEvent(this);
        }

        this.updateTextPosition();

        textBlockEvent.setTextBlockEvent(this);
    }

    getEquation() : App | undefined {
        return AppServices.getEquationOfTextBlock(this);
    }

    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            text   : this.text,
            isTex  : this.isTex,
            offset : this.offset
        });

        return obj;
    }

    getProperties(){
        return super.getProperties().concat([
            "text", "isTex", "offset"
        ]);
    }

    getClickedTermRect(x : number, y : number) : TermRect {
        this.termRects.forEach(x => x.span.style.backgroundColor = "transparent");

        const refvar_rects = this.termRects.filter(x => x.term instanceof RefVar);
        for(const term_rect of refvar_rects){
            const rect = term_rect.rect;
            const span = term_rect.span;

            if(rect.left <= x && x < rect.right && rect.top <= y && y < rect.bottom){
                return term_rect;
            }
        }

        throw new MyError();
    }

    async texClick(ev : MouseEvent) : Promise<void> {
        ev.stopPropagation();

        AppServices.texClickOfTextBlock(this, ev);
    }

    updateTextDiv(){
        let text = AppServices.getTextOfTextBlock(this);

        if(this.isTex){

            if(isGreek(text)){
                text = `\\${text}`;
            }

            renderKatexSub(this.div, text);

            if(this.getEquation() != undefined){
                const terms = this.getEquation()!.allTerms();
                const tex_spans = Array.from(this.div.getElementsByClassName("enclosing")) as HTMLSpanElement[];
                this.termRects = [];

                const id_offset = "tex-term-".length;
                for(const span of tex_spans){
                    const id = parseInt(span.id.substring(id_offset));
                    const term = terms.find(x => x.id == id)!;
                    assert(term != undefined);
                    this.termRects.push(new TermRect(term, span));
                }
            }
        }
        else{

            this.div.innerText = text;
        }
    }

    setVisible(visible : boolean){
        this.visible = visible;

        if(this.visible){
            this.div.style.color = "";
            this.div.style.display = "";
        }
        else{
            if(GlobalState.Plane__one!.editMode){

                this.div.style.color = "gray";
            }
            else{
                this.div.style.display = "none";
            }
        }
    }

    show(){        
        this.div.style.display = "";
    }

    hide(){        
        this.div.style.display = "none";
    }

    setIsTex(is_tex : boolean){
        this.isTex = is_tex;
        this.updateTextDiv();
    }

    setTextPosition(x : number, y : number){
        this.div.style.left = `${GlobalState.View__current!.canvas.offsetLeft + toXPix(x + this.offset.x)}px`;
        this.div.style.top  = `${GlobalState.View__current!.canvas.offsetTop  + toYPix(y + this.offset.y)}px`;
    }

    updateTextPosition(){
        this.div.style.left = `${GlobalState.View__current!.canvas.offsetLeft + toXPix(this.offset.x)}px`;
        this.div.style.top  = `${GlobalState.View__current!.canvas.offsetTop  + toYPix(this.offset.y)}px`;
    }

    setRotation(degree : number){
        this.div.style.transform = `rotate(${degree}deg)`;
    }

    getSize() : [number, number] {
        return [ this.div.offsetWidth, this.div.offsetHeight ];
    }

    captionPointerdown(event : PointerEvent){
        this.div.setPointerCapture(event.pointerId);
        setCapturedShape(this);
    }

    captionPointermove(event : PointerEvent){
        if(capturedShape != this){
            return;
        }

        this.offset.x += fromXPixScale(event.movementX);
        this.offset.y -= fromYPixScale(event.movementY);
        
        this.div.style.left = `${this.div.offsetLeft + event.movementX}px`;
        this.div.style.top  = `${this.div.offsetTop  + event.movementY}px`;
    }

    captionPointerup(event : PointerEvent){
        this.div.releasePointerCapture(event.pointerId);
        setCapturedShape(undefined);
    }

    reading() : Reading {
        // msg(`empty reading:${this.constructor.name}`);
        return new Reading(this, "", []);
    }

    delete(deleted : Set<string>){
        if(deleted.has(this.id)){
            return;
        }
        super.delete(deleted);

        this.div.remove();
    }
}

registerEntity(TextBlock.name, (obj: any) => new TextBlock(obj));


console.log(`Loaded: json`);
