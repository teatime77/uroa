import { assert, MyError, Vec2, msg, sum, AppMode, appMode, range, $div, AbstractUI, pixUI, initGrid, setMinSizeGrid, layoutGrid } from "@i18n";
import type { AbstractUIAttr, IGrid } from "@i18n";
import { renderKatexSub } from "@parser";
import { setImgFile } from "./layout_util";

type MouseEventCallback = (ev : MouseEvent)=>Promise<void>;
type EventCallback = (ev : Event)=>Promise<void>;

export const fgColor = "white";
export const bgColor = "#003000";
// export const bgColor = "black";

export let modalDlg : HTMLDivElement;

const TextSizeFill = 8;
const inputPadding = 4;

function ratio(width : string) : number {
    width = width.trim();
    assert(width.endsWith("%"));
    const num_str = width.substring(0, width.length - 1);

    const num = parseFloat(num_str);

    return num / 100;
}


function pixel(length : string,  remaining_length? : number) : number {
    if(length != undefined){
        if(length.endsWith("px")){
            const num_str = length.substring(0, length.length - 2);

            return parseFloat(num_str);
        }
        else if(length.endsWith("%")){
            if(remaining_length != undefined){
                return ratio(length) * remaining_length;
            }
        }
    }
    
    throw new MyError();
}

enum Orientation {
    horizontal,
    vertical,
}

export interface Attr extends AbstractUIAttr {
    id? : string;
    className? : string;
    parent? : Block;
    obj? : any;
    name? : string;
    position? : string;
    margin? : string;
    color? : string;
    backgroundColor? : string;
    borderStyle? : string;
    verticalAlign? : string;
    horizontalAlign? : string;
    textAlign? : string;
    fontSize? : string;
    width? : string;
    height? : string;
    disabled? : boolean;
    visibility? : string;
}

export abstract class UI extends AbstractUI {
    static count : number = 0;

    idx : number;
    id? : string;
    className? : string;
    parent? : Block;
    obj? : any;
    name? : string;
    position? : string;
    margin? : string;
    backgroundColor? : string;
    borderStyle? : string;
    verticalAlign? : string;
    horizontalAlign? : string;
    textAlign? : string;
    fontSize? : string;
    visibility? : string;

    constructor(data : Attr){   
        super();

        if(data.width != undefined || data.height != undefined){
            this.fixedSize = Vec2.fromXY(NaN, NaN);
            if(data.width != undefined){
                this.fixedSize.x = pixUI(data.width);
                data.width = undefined;
            }
            if(data.height != undefined){
                this.fixedSize.y = pixUI(data.height);
                data.height = undefined;
            }
        }

        assert((data.width ?? "px").endsWith("px"));
        assert((data.height ?? "px").endsWith("px"));
        this.minSize = Vec2.fromXY(NaN, NaN);

        if(data.padding == undefined && (this instanceof InputText || this instanceof InputNumberRange)){
            data.padding = inputPadding;
        }

        Object.assign(this, data);
        super.copyFromUIAttr(data);
        this.idx = ++UI.count;
    }

    hasFixedSizeX() : boolean {
        return this.fixedSize != undefined && !isNaN(this.fixedSize.x);
    }

    hasFixedSizeY() : boolean {
        return this.fixedSize != undefined && !isNaN(this.fixedSize.y);
    }

    getPosition() : Vec2 {
        throw new MyError();
    }

    setPosition(position : Vec2) : void {
        throw new MyError();
    }

    setStyle() : UI {
        const ele = this.html();

        if(this.id != undefined){
            ele.id = this.id;
        }

        if(this.className != undefined){
            ele.className = this.className;
        }

        if(this.position != undefined){
            ele.style.position = this.position;
        }
        else if(!(ele instanceof Dialog) ){
            ele.style.position = "absolute";
        }

        if(this.margin != undefined){
            ele.style.margin = this.margin;
        }

        if(this.borderWidth != undefined){
            ele.style.borderWidth = `${this.borderWidth}`;
        }

        if(this.borderStyle != undefined){
            ele.style.borderStyle = this.borderStyle;
        }

        if(this.textAlign != undefined){
            ele.style.textAlign = this.textAlign;
        }

        if(this.fontSize != undefined){
            ele.style.fontSize = this.fontSize;
        }

        if(this.color != undefined){
            ele.style.color = this.color;
        }

        if(this.backgroundColor != undefined){
            ele.style.backgroundColor = this.backgroundColor;
        }
        else{
            ele.style.backgroundColor = bgColor;
        }

        if(this.hasFixedSizeX()){
            ele.style.width = `${this.fixedSize!.x}px`;
        }

        if(this.hasFixedSizeY()){
            ele.style.height = `${this.fixedSize!.y}px`;
        }

        if(this.visibility != undefined){
            ele.style.visibility = this.visibility;
        }

        return this;
    }

    abstract html() : HTMLElement;

    borderWidthPadding() : number {
        let n : number = 0;
        
        if(this.borderWidth != undefined){
            n += 2 * this.borderWidth;
        }

        if(this.padding != undefined){
            n += this.padding.width();
        }

        return n;
    }

    setMinSize() : void {        
        let width : number | undefined;
        let height : number | undefined;

        if(this.hasFixedSizeX()){
            width = this.fixedSize!.x + this.borderWidthPadding();
        }

        if(this.hasFixedSizeY()){
            height = this.fixedSize!.y + this.borderWidthPadding();
        }

        if(width == undefined || height == undefined){

            let size : Vec2;
            
            if(this instanceof AbstractText && !(this instanceof LaTeXBox)){
                size = this.getTextSize();
            }
            else{
                const rect = this.html().getBoundingClientRect();
                size = new Vec2(rect.width, rect.height);
            }

            if(width == undefined){
                width = size.x;
            }
            if(height == undefined){
                height = size.y;
            }
        }

        this.minSize = new Vec2(width, height);
        assert(! this.minSize.isNaN());
        this.netSize.copyFrom(this.minSize);
    }

    getMinSize() : Vec2 {
        if(this.minSize.isNaN()){
            this.setMinSize();
        }

        return this.minSize;
    }

    setXY(x : number, y : number){
        const html = this.html();

        if(this.position != "static"){
            html.style.left = `${x}px`;
            html.style.top  = `${y}px`;
        }
    }

    setSize(size : Vec2){
        if(size == undefined){
            throw new MyError();
        }
        const html = this.html();

        const borderWidthPadding = this.borderWidthPadding();

        if(this.minSize.isNaN()){
            throw new MyError();
        }

        let contentX : number;
        let contentY : number;

        if(this.hasFixedSizeX()){
            contentX  = this.minSize.x;
        }
        else{
            contentX  = size.x - borderWidthPadding;
        }

        if(this.hasFixedSizeY()){
            contentY = this.minSize.y;
        }
        else{
            contentY = size.y - borderWidthPadding;
        }

        html.style.width  = `${contentX}px`;
        html.style.height = `${contentY}px`;
    }

    selectUI(selected : boolean){
    }

    layout(pos : Vec2, size : Vec2, nest : number){
        if(appMode == AppMode.lessonPlay){            
            msg(`${" ".repeat(4 * nest)} id:${this.constructor.name} x:${pos.x.toFixed()} y:${pos.y.toFixed()} position:${this.position} ${this.html().style.position}`);
        }

        this.setSize(size);
        if(this.horizontalAlign == "center"){
            pos.x += 0.5 * (size.x - this.netSize.x);
        }
        this.setXY(pos.x, pos.y);
    }
}

export abstract class AbstractText extends UI {
    text : string;

    constructor(data : Attr & { text : string }){
        super(data);
        this.text = data.text;
    }

    setText(text : string){
        this.text = text;
    }

    getTextSize() : Vec2 {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;

        const style = window.getComputedStyle(this.html());
        const font_info = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        ctx.font = font_info;

        const metrics = ctx.measureText(this.text);
      
        const actualHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
      
        // msg(`font :[${font_info}]  w:[${metrics.width}] h:[${actualHeight}] id:[${this.id}] [${this.text}]`);

        const width  = metrics.width + this.borderWidthPadding() + TextSizeFill;
        const height = actualHeight  + this.borderWidthPadding() + TextSizeFill;
        return new Vec2(width, height);
    }
}

export class Label extends AbstractText {
    span : HTMLSpanElement;

    constructor(data : Attr & { text : string }){        
        super(data);

        this.span = document.createElement("span");
        this.span.innerText = this.text;
        // this.span.style.justifyContent = "center";
        // this.span.style.textAlign = "center";
    }

    html() : HTMLElement {
        return this.span;
    }
}

export abstract class TextDiv extends AbstractText {
    div : HTMLDivElement;

    constructor(data : Attr & { text : string }){
        super(data);
        this.div = document.createElement("div");
        // this.div.style.borderStyle = "ridge";
        // this.div.style.borderWidth = "3px";
        // this.div.style.borderColor = "transparent";
    }

    html() : HTMLElement {
        return this.div;
    }

    show(){
        this.div.style.display = "";
    }

    hide(){
        this.div.style.display = "none";
    }

    setBorderColor(color : string){
        this.div.style.borderColor = color;
    }
}

export class TextBox extends TextDiv {
    constructor(data : Attr & { text : string }){
        super(data);
        this.div.innerHTML = data.text;
    }

    setText(text : string){
        super.setText(text);
        this.div.innerHTML = text;
    }

    clearText(){
        this.setText("");
    }
}

export class LaTeXBox extends TextDiv {
    click? : MouseEventCallback;

    constructor(data : Attr & { text : string, click? : MouseEventCallback }){        
        super(data);
        this.div.innerHTML = data.text;
        this.click = data.click;

        this.div.addEventListener("click", async (ev:MouseEvent)=>{
            if(this.click != undefined){
                await this.click(ev);
            }
        });
    }

    setStyle() : UI {
        super.setStyle();

        renderKatexSub(this.div, this.text);

        return this;
    }

    setText(text : string){
        super.setText(text);
        renderKatexSub(this.div, this.text);
    }
}

abstract class AbstractInput extends UI {
    input : HTMLInputElement;
    change? : (ev : Event)=>Promise<void>;

    constructor(data : Attr & { change? : EventCallback }){
        super(data);
        this.change = data.change;

        this.input = document.createElement("input");
        this.input.style.color = fgColor;

        if(this instanceof InputText){

            this.input.addEventListener("input", async (ev : Event)=>{
                msg("input event");
                if(this.change != undefined){
                    await this.change(ev);
                }
            });
        }
        else{

            this.input.addEventListener("change", async (ev : Event)=>{
                msg("change event");
                if(this.change != undefined){
                    await this.change(ev);
                }
            });
        }
    }

    html() : HTMLElement {
        return this.input;
    }
}

export class InputText extends AbstractInput {
    
    constructor(data : Attr & { text : string, change? : EventCallback }){
        super(data);
        this.input.type = "text";
        this.input.value = data.text;
    }
}


export class InputColor extends AbstractInput {
    constructor(data : Attr & { text : string, change? : EventCallback }){
        super(data);
        this.input.type = "color";
    }
}

class InputNumberRange extends AbstractInput {
    constructor(data : Attr & { value? : number, step? : number, min? : number, max? : number, change? : EventCallback }){
        super(data);
        
        if(data.width == undefined){
            data.width = "50px";
        }

        if(this instanceof InputNumber){

            this.input.type = "number";
        }
        else{

            this.input.type = "range";
        }

        if(data.value != undefined){
            this.input.value = `${data.value}`;
        }
        if(data.step != undefined){
            this.input.step = `${data.step}`;
        }
        if(data.min != undefined){
            this.input.min = `${data.min}`;
        }
        if(data.max != undefined){
            this.input.max = `${data.max}`;
        }
    }

    setValue(value : number){
        this.input.value = `${value}`;
    }

    getValue() : number {
        return parseFloat(this.input.value);
    }

    setMax(max_value : number){
        this.input.max = `${max_value}`;        
    }
}

export class InputNumber extends InputNumberRange {
}


export class InputRange extends InputNumberRange {
}

export class CheckBox extends AbstractInput {
    span  : HTMLSpanElement;

    constructor(data : Attr & { text : string, change? : EventCallback }){
        super(data);

        this.input.type = "checkbox";
        this.input.id = `layout.ts-checkbox-${this.idx}`;
    
        const label = document.createElement("label");
        label.htmlFor = this.input.id;
        label.textContent = data.text;    
        label.style.color = fgColor;

        this.span = document.createElement("span");
        this.span.append(this.input);
        this.span.append(label);
    }

    html() : HTMLElement {
        return this.span;
    }

    checked() : boolean {
        return this.input.checked;
    }
}

export class TextArea extends UI {
    textArea : HTMLTextAreaElement;
    change? : EventCallback;

    constructor(data : Attr & { value? : string, cols? : number, rows? : number, placeholder? : string, change? : EventCallback }){
        super(data);
        this.change = data.change;
        this.textArea = document.createElement("textarea");
        if(data.value != undefined){
            this.textArea.value = data.value;
        }

        if(data.cols != undefined){
            this.textArea.cols = data.cols;
        }

        if(data.rows != undefined){
            this.textArea.rows = data.rows;
        }

        this.textArea.style.color = fgColor;

        if(data.placeholder != undefined){
            this.textArea.placeholder = data.placeholder;
        }

        this.textArea.addEventListener("input", async (ev : Event)=>{
            if(this.change != undefined){
                await this.change(ev);
            }
        });
    }

    html() : HTMLElement {
        return this.textArea;
    }

    getValue() : string {
        return this.textArea.value;
    }

    setValue(text : string){
        this.textArea.value = text;
    }
}

export class Img extends UI {
    imgUrl : string;
    img : HTMLImageElement;
    click? : MouseEventCallback;

    constructor(data : Attr & { imgUrl : string, file? : File, click? : MouseEventCallback }){
        super(data);
        this.imgUrl = data.imgUrl;
        this.img = document.createElement("img");
        this.img.style.objectFit = "contain";
        if(data.file != undefined){

            setImgFile(this.img, data.file);
        }
        else{

            this.img.src = this.imgUrl;
            // msg(`img url 1:${this.img.src}`);
        }

        if(data.click != undefined){
            this.click = data.click;

            this.img.addEventListener("click", async (ev:MouseEvent)=>{
                if(this.click != undefined){
                    await this.click(ev);
                }
            });
        }
    }

    html() : HTMLElement {
        return this.img;
    }

    setImgUrl(url : string){
        this.img.src = url;
        msg(`img url 2:${this.img.src}`);
        this.imgUrl  = url;
    }
}

abstract class AbstractButton extends UI {
    static imgMargin = 2;

    value?  : string;
    button : HTMLButtonElement;
    img? : HTMLImageElement;

    constructor(data : Attr & { id? : string, value? : string, text? : string, url? : string }){
        super(data);
        this.value = data.value;
        this.button = document.createElement("button");
        this.button.style.padding = "1px";
        this.button.style.color = fgColor;

        if(data.disabled != undefined && data.disabled){
            this.button.disabled = true;
        }

        if(data.text != undefined){
            this.button.innerText = data.text;
        }

        if(data.url != undefined){
            this.img = document.createElement("img");
            this.img.src = data.url;
            // msg(`img url 3:${this.img.src}`);
    
            this.img.style.width   = "100%";
            this.img.style.height  = "100%";
            this.img.style.objectFit = "contain";
        
            this.button.append(this.img);    
        }
    }

    setImgUrl(url : string){
        this.img!.src = url;
    }
}

export class Button extends AbstractButton {
    click? : MouseEventCallback;

    constructor(data : Attr & { value? : string, text? : string, url? : string, click? : MouseEventCallback }){        
        super(data);
        this.click = data.click;

        this.button.addEventListener("click", async (ev:MouseEvent)=>{
            if(this.click != undefined){
                await this.click(ev);
            }
        });
    }

    html() : HTMLElement {
        return this.button;
    }
}

export class Anchor extends UI {
    anchor : HTMLAnchorElement;

    constructor(data : Attr & { text? : string, url? : string }){
        super(data);

        this.anchor = document.createElement("a");
    }

    html() : HTMLElement {
        return this.anchor;
    }
}

export class RadioButton extends AbstractButton {
    constructor(data : Attr & { id? : string, value : string, title? : string, text? : string, url? : string }){
        super(data);

        this.button.value = data.value;
        if(data.title != undefined){
            this.button.title = data.title;
        }
        this.button.style.borderWidth = "3px";
        this.button.style.borderStyle = "outset";
    }

    html() : HTMLElement {
        return this.button;
    }

    selectUI(selected : boolean){
        if(this.parent == undefined){
            throw new MyError();
        }
        
        if(this.parent.selectedUI != undefined){
            const old_selected = this.parent.selectedUI;
            this.parent.selectedUI = undefined;
            old_selected.selectUI(false);
        }

        const html = this.html();
        if(selected){

            html.style.borderStyle = "inset";

            if(this.parent.selectedUI != this){

                this.parent.selectedUI = this;
                if(this.parent.onChange != undefined){
                    this.parent.onChange(this);
                }
            }
        }
        else{

            html.style.borderStyle = "outset";
        }
    }
}

export class Block extends UI {
    div : HTMLDivElement;
    children : UI[];
    selectedUI? : UI;

    onChange? : (ui:UI)=>void;

    constructor(data : Attr & { children : UI[] }){        
        super(data);
        this.div = document.createElement("div");

        this.children = [];
        data.children.forEach(x => this.addChild(x));

        if(this.children.length != 0 && this.children[0] instanceof RadioButton){
            this.children[0].selectUI(true);
        }

        this.children.forEach(x => this.div.append(x.html()));
    }

    html() : HTMLElement {
        return this.div;
    }

    addChild(child : UI){
        child.parent = this;
        this.children.push(child);

        this.div.append(child.html());

        if(child instanceof RadioButton){

            child.button.addEventListener("click", (ev:MouseEvent)=>{
                child.selectUI(true);                
            });
        }
    }

    popChild() : UI | undefined {
        if(this.children.length == 0){
            return undefined;
        }

        const child = this.children.pop()!;
        child.parent = undefined;

        this.div.removeChild(child.html());

        return child;
    }

    removeChild(child : UI){
        const idx = this.children.indexOf(child);
        if(idx == -1){
            throw new MyError();
        }

        this.children.splice(idx, 1);
        this.div.removeChild(child.html());
    }

    getAllUI() : UI[] {
        let uis : UI[] = [ this ];
        for(const child of this.children){
            if(child instanceof Block){
                uis = uis.concat(child.getAllUI());
            }
            else{
                uis.push(child);
            }
        }

        return uis;
    }

    getAllHtml() : HTMLElement[] {
        const uis = this.getAllUI();
        return uis.map(x => x.html());
    }

    getElementById(id : string) : HTMLElement | undefined {
        return this.getAllHtml().find(x => x.id == id);
    }

    $(id : string){
        return this.getUIById(id);
    }

    getUIById(id : string) : UI | undefined {
        const uis = this.getAllUI();
        return uis.find(x => x.id == id);
    }

    clear(){
        this.children = [];
        this.div.innerHTML = "";
    }
}

function autoToAst(s : string | undefined) : string | undefined {
    return s == undefined ? s : s.replaceAll("auto", "*");
}

export class Grid extends Block implements IGrid {
    columns! : string[];
    rows! : string[];

    minWidths : number[] = [];
    heights! : number[];

    numCols : number = NaN;
    numRows : number = NaN;
    columnsPix : number[] = [];
    rowsPix    : number[] = [];

    constructor(data : Attr & { columns?: string, rows? : string, children : UI[] }){        
        super(data);
        data.columns = autoToAst(data.columns);
        data.rows    = autoToAst(data.rows);
        initGrid(this, data.columns, data.rows);
    }

    absChildren() : AbstractUI[] {
        return this.children;
    }

    setMinSize() : void {        
        setMinSizeGrid(this);
    }

    getMinSize() : Vec2 {
        this.setMinSize();
        return this.minSize;
    }

    layout(pos : Vec2, size : Vec2, nest : number){
        super.layout(pos, size, nest);
        layoutGrid(this, pos, size)
    }

    updateRootLayout(){
        this.getAllUI().forEach(x => x.minSize = Vec2.fromXY(NaN, NaN));
        const size = this.getMinSize();

        let x : number;
        let y : number;

        if(this.columns != undefined && this.columns.some(x => x.endsWith("%"))){

            size.x = window.innerWidth;
            x = 0;
        }
        else{

            x = Math.max(0, 0.5 * (window.innerWidth  - size.x));
        }

        if(this.rows != undefined && this.rows.some(x => x.endsWith("%"))){

            size.y = window.innerHeight;
            y = 0;
        }
        else{

            y = Math.max(0, 0.5 * (window.innerHeight - size.y));
        }

        this.layout(Vec2.fromXY(x, y), size, 0);
    }
}

export class Flex extends Grid {
    static initialWidth = "300px";
    static padding = 2;

    constructor(data : Attr & { direction?: string, columns?: string, rows? : string, children : UI[] }){
        if((data.direction ?? "row") == "row"){
            data.columns = Array(data.children.length).fill("*").join(" ");
        }
        else{
            data.rows    = Array(data.children.length).fill("*").join(" ");
        }
        super(data);

        this.div.style.width = Flex.initialWidth;
        this.children.forEach(x => this.div.append(x.html()));
    }
}

export class PopupMenu extends UI {
    dlg  : HTMLDialogElement;
    flex : Flex;
    click? : (index : number, id? : string, value? : string)=>void;

    constructor(data : Attr & { children : UI[], click? : (index : number)=>void }){
        super(data);
        this.click = data.click;

        this.dlg = document.createElement("dialog");
        this.dlg.style.position = "fixed";
        this.dlg.style.zIndex  = "1";


        this.flex = $flex({
            direction : "column",
            children : data.children
        });

        for(const child of data.children){
            child.html().addEventListener("click", (ev : MouseEvent)=>{
                const dlgs = document.body.getElementsByTagName("dialog");
                for(const dlg of dlgs){

                    dlg.close();
                }
            })
        }

        this.dlg.append(this.flex.div);

        document.body.append(this.dlg);
    }

    html(): HTMLElement {
        return this.dlg;
    }

    show(ev : MouseEvent){
        setTimeout(()=>{
            this.flex.getAllUI().forEach(x => x.minSize = Vec2.fromXY(NaN, NaN));

            const size = this.flex.getMinSize();
            this.flex.layout(Vec2.zero(), size, 0);

            this.dlg.style.width  = `${size.x}px`;
            this.dlg.style.height = `${size.y}px`;
    
            this.dlg.style.marginLeft = `${ev.pageX}px`;
            this.dlg.style.marginTop  = `${ev.pageY}px`;
    
        });
        this.dlg.showModal();
    }

    close(){        
        this.dlg.close();
    }
}

export class SelectionList extends Grid {
    selectedIndex : number = NaN;
    selectionChanged? : (index:number)=>void;

    constructor(data : Attr & { orientation? : Orientation, children : RadioButton[], selectedIndex? : number, selectionChanged? : (index:number)=>void }){
        if(data.orientation == Orientation.vertical){
            (data as any).rows    = data.children.map(_ => "auto").join(" ");
        }
        else{
            (data as any).columns = data.children.map(_ => "auto").join(" ");
        }
        super(data);

        if(data.selectedIndex != undefined){
            this.selectedIndex = data.selectedIndex;
        }

        if(data.selectionChanged != undefined){

            this.selectionChanged = data.selectionChanged;
        }

        for(const [idx, ui] of this.children.entries()){
            ui.html().addEventListener("click", (ev : MouseEvent)=>{
                msg(`selection-Changed[${idx}]`);
                this.selectedIndex = idx;
                if(this.selectionChanged != undefined){
                    this.selectionChanged(idx);
                }
            });
        }
    }

    setStyle() : UI {
        super.setStyle();

        // msg(`selected-Index : ${this.selectedIndex}`);
        if(!isNaN(this.selectedIndex)){
            this.children[this.selectedIndex].selectUI(true);
        }

        return this;
    }
}

export class Dialog extends UI {
    div : HTMLDivElement;
    content : UI;

    constructor(data : Attr & { content : UI }){
        super(data);
        this.content = data.content;

        this.div = document.createElement("div");
        this.div.style.position = "fixed";
        this.div.style.zIndex  = "1";

        this.div.append(this.content.html());
    }

    html() : HTMLElement {
        return this.div;
    }

    setXY(x : number, y : number){
        this.div.style.marginLeft = `${x}px`;
        this.div.style.marginTop  = `${y}px`;
    }

    showStyle(pageX : 0, pageY : 0){
        const size = this.content.getMinSize();
        this.content.layout(Vec2.zero(), size, 0);

        // msg(`dlg: ${size.x} ${size.y} ${pageX} ${pageY}`);
        this.div.style.width  = `${size.x + 10}px`;
        this.div.style.height = `${size.y + 10}px`;

        this.div.style.marginLeft = `${pageX}px`;
        this.div.style.marginTop  = `${pageY}px`;
    }

    open() : boolean {
        return this.div.parentElement == modalDlg;
    }

    close(){
        modalDlg.innerHTML = "";
        modalDlg.style.display = "none";
    }

    showModal(){
    /*
        setTimeout(()=>{
            // getBoundingClientRect can be used after showModal

            this.showStyle(0, 0);
        });
    */
        if(this.div.parentElement != modalDlg){

            modalDlg.append(this.div);
        }

        this.showStyle(0, 0);

        modalDlg.style.display = "block";
    }
}

export class Log extends UI {
    static one : Log;

    dlg : HTMLDialogElement;
    pre : HTMLPreElement;
    texts : string = "";
    lastText : string = "";
    count : number = 0;

    static init(){
        if(Log.one == undefined){
            Log.one = new Log({ width : `${0.5 * window.innerWidth}px`, height : `${0.5 * window.innerHeight}px` });
        }
    }

    static log(text : string){
        Log.init();
        Log.one.addText(text);
        console.log(text);
    }

    static show(ev : MouseEvent){
        if(Log.one.dlg.open){

            Log.one.dlg.close();
        }
        else{

            Log.init();

            Log.one.dlg.style.marginTop = `${0.8 * window.innerHeight}px`;
            Log.one.dlg.show();
        }
    }

    constructor(data : Attr){
        super(data);
        if(data.width == undefined || data.height == undefined){
            throw new MyError();
        }

        const width_px  = pixel(data.width);
        const height_px = pixel(data.height);

        this.dlg = document.createElement("dialog");
        this.dlg.style.position = "fixed";
        this.dlg.style.width  = `${width_px}px`;
        this.dlg.style.height = `${height_px}px`;
        this.dlg.style.padding = "0";
        this.dlg.style.marginRight  = "0";
        this.dlg.style.zIndex = "1";

        const div = document.createElement("div");
        div.style.width  = "100%";
        div.style.height = "100%";
        div.style.overflow = "auto"
        div.style.padding = "0";

        this.pre = document.createElement("pre");
        this.pre.style.width  = "100%";
        this.pre.style.height = "100%";

        div.append(this.pre);
        this.dlg.append(div);
        document.body.append(this.dlg);
    }

    html() : HTMLElement {
        return this.dlg;
    }

    addText(text : string){
        if(text == this.lastText){
            if(text != ""){

                this.count++;
    
                this.pre.innerText = this.texts + `\n${this.count}:` + text;    
            }
        }
        else{
            this.texts += "\n" + this.lastText;
            this.lastText = text;

            this.pre.innerText = this.texts + "\n" + text;

            this.count = 1;
        }
    }
}

export class Layout {
    static root : Grid;

    static initLayout(root : Grid, parentElement : HTMLElement = document.body){
        Layout.root = root;

        parentElement.append(root.div);
        Layout.root.updateRootLayout();
    
        window.addEventListener("resize", (ev : UIEvent)=>{
            Layout.root.updateRootLayout();
        });

        modalDlg = $div("modal_dlg");
    }
}

export function saveBlob(anchor : Anchor, name : string, blob : Blob){
    // a 要素の href 属性に Object URL をセット
    anchor.anchor.href = window.URL.createObjectURL(blob);
    
    // a 要素の download 属性にファイル名をセット
    anchor.anchor.download = `${name}.json`;
    
    // 疑似的に a 要素をクリックさせる
    anchor.anchor.click();

}

export function $label(data : Attr & { text : string }) : Label {
    return new Label(data).setStyle() as Label;
}

export function $input_text(data : Attr & { text : string, change? : EventCallback }) : InputText {
    return new InputText(data).setStyle() as InputText;
}

export function $input_color(data : Attr & { text : string, change? : EventCallback }) : InputColor {
    return new InputColor(data).setStyle() as InputColor;
}

export function $input_number(data : Attr & { value? : number, step? : number, min? : number, max? : number, change? : EventCallback }) : InputNumber {
    return new InputNumber(data).setStyle() as InputNumber;
}

export function $input_range(data : Attr & { value? : number, step? : number, min? : number, max? : number, change? : EventCallback }) : InputRange {
    return new InputRange(data).setStyle() as InputRange;
}

export function $checkbox(data : Attr & { text : string, change? : EventCallback }) : CheckBox {
    return new CheckBox(data).setStyle() as CheckBox;
}

export function $textarea(data : Attr & { value? : string, cols? : number, rows? : number, placeholder? : string, change? : EventCallback }) : TextArea {
    return new TextArea(data).setStyle() as TextArea;
}

export function $img(data : Attr & { imgUrl : string, file? : File, click? : MouseEventCallback }) : Img {
    return new Img(data).setStyle() as Img;
}

export function $button(data : Attr & { value? : string, text? : string, url? : string, click? : MouseEventCallback }) : Button {
    return new Button(data).setStyle() as Button;
}

export function $anchor(data : Attr & { text? : string, url? : string }) : Anchor {
    return new Anchor(data).setStyle() as Anchor;
}

export function $radio(data : Attr & { id? : string, value : string, title? : string, text? : string, url? : string }) : RadioButton {
    return new RadioButton(data).setStyle() as RadioButton;
}

export function $textbox(data : Attr & { text : string }) : TextBox {
    return new TextBox(data).setStyle() as TextBox;
}

export function $latex(data : Attr & { text : string, click? : MouseEventCallback }) : LaTeXBox {
    return new LaTeXBox(data).setStyle() as LaTeXBox;
}

export function $block(data : Attr & { children : UI[] }) : Block {
    return new Block(data).setStyle() as Block;
}

export function $grid(data : Attr & { columns?: string, rows? : string, children : UI[] }) : Grid {
    return new Grid(data).setStyle() as Grid;
}

export function $selection(data : Attr & { orientation? : Orientation, children : RadioButton[], selectedIndex? : number, selectionChanged? : (index:number)=>void }) : SelectionList {
    return new SelectionList(data).setStyle() as SelectionList;
}

export function $flex(data : Attr & { direction?: string, children : UI[] }) : Flex {
    return new Flex(data).setStyle() as Flex;
}

export function $popup(data : Attr & { direction?: string, children : UI[], click? : (index : number, id? : string, value? : string)=>void }) : PopupMenu {
    return new PopupMenu(data).setStyle() as PopupMenu;
}

export function $dialog(data : Attr & { content : UI, okClick? : MouseEventCallback }) : Dialog {
    return new Dialog(data).setStyle() as Dialog;
}
