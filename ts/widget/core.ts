import { MyError, msg, Vec2, AbstractUI, AbstractUIAttr } from "@i18n";
import type { ContainerUI } from "./container";
import type { TreeNode } from "./tree";
import type { Canvas } from "./canvas";

const objMap : Map<string, UI> = new Map<string, UI>();

export let targetUI : UI | undefined;

export let worldCanvas : Canvas;

export function setCanvas(canvas : Canvas){
    worldCanvas = canvas;
}


export function setTargetUI(target : UI | undefined){
    targetUI = target;
}

export function addObject(id : string, obj : UI){
    if(objMap.has(id)){
        // throw new MyError();        
        msg(`dup obj:${id}`);
    }

    objMap.set(id, obj);
}

export function getObjectById(id : string) : UI {
    const obj = objMap.get(id);
    if(obj == undefined){
        throw new MyError();
    }

    return obj;
}

export class VisibleArea {
    x1 : number;
    y1 : number;

    x2 : number;
    y2 : number;

    constructor(x1 : number, y1 : number, width : number, height : number){
        this.x1 = x1;
        this.y1 = y1;
        this.x2 = x1 + width;
        this.y2 = y1 + height;
    }
}

export class Padding {
    left   : number;
    right  : number;
    top    : number;
    bottom : number;

    constructor(left : number, right : number, top : number, bottom : number){
        this.left  = left;
        this.right  = right;
        this.top    = top;
        this.bottom = bottom;
    }
}

const UI_padding : Padding = new Padding(5, 5, 5, 5);
const UI_borderWidth : number = 5;

export interface UIAttr extends AbstractUIAttr {
    className? : string;
    id?   : string;
    name? : string;
    position? : [number, number];
    top?     : number;
    left?    : number;
    right?   : number;
    bottom?  : number;
    size?     : [number, number];
    borderStyle? : string;
    borderWidth? : number;
    backgroundColor? : string;
    padding? : number | [number, number] | [number, number, number, number];
    imageFile? : string;
    lesson?  : string;
}

export interface TextUIAttr extends UIAttr {
    text? : string;
    fontFamily? : string;
    fontSize? : string;
    textAlign? : string;
    path? : string;
}
export interface LabelAttr extends TextUIAttr {
    args? : number[];
}

export abstract class UI extends AbstractUI {
    static count : number = 0;
    static fontFamily : string = "Arial";
    static fontSize   : string = "30px";

    className : string;
    idx      : number;
    id?      : string;
    name? : string;
    parent?  : ContainerUI;
    position : Vec2 = Vec2.zero();
    right?   : number;
    bottom?  : number;
    fixedSize? : Vec2;
    size     : Vec2 = Vec2.zero();
    backgroundColor? : string;
    color?           : string;
    borderWidth? : number;
    padding? : Padding;
    lesson?  : string;

    clickHandler? : ()=>Promise<void>;

    getRight() : number {
        return this.position.x + this.size.x;
    }

    getBottom() : number {
        return this.position.y + this.size.y;
    }

    setParent(parent : ContainerUI | TreeNode){
        this.parent = parent;
        // msg(`set parent:${this.constructor.name} ${this.parent.constructor.name}`)
    }

    getRootUI() : UI {
        let ui : UI = this;
        for(; ui.parent != undefined; ui = ui.parent);
        return ui;
    }

    getStageRoot() : UI {
        let ui : UI = this;
        for(; ui.parent != undefined; ui = ui.parent){
            if(ui.parent.name == "main-stage"){
                return ui;
            }
        }

        throw new MyError();
    }

    getAllUI(all_uis : UI[]){
        all_uis.push(this);
    }

    getPadding() : Padding {
        return (this.padding !== undefined ? this.padding : UI_padding);
    }

    getBorderWidth() : number {
        return this.borderWidth !== undefined ? this.borderWidth : UI_borderWidth;
    }

    getPaddingBorderSize() : Vec2 {
        const padding = this.getPadding();
        const borderWidth = this.getBorderWidth();

        const width  = padding.left + padding.right  + 2 * borderWidth;
        const height = padding.top  + padding.bottom + 2 * borderWidth;
        return Vec2.fromXY(width, height);
    }

    getContentSize() : Vec2 {
        const padding_border_size = this.getPaddingBorderSize();
        return this.size.sub(padding_border_size);
    }

    getContentPosition(){
        const borderWidth = this.getBorderWidth();
        const padding = this.getPadding();

        return Vec2.fromXY(borderWidth + padding.left, borderWidth + padding.top);
    }

    isVisible(offset : Vec2, visibleArea : VisibleArea | undefined) : boolean {
        if(visibleArea == undefined){
            return true;
        }

        const x1 = offset.x + this.position.x;
        const y1 = offset.y + this.position.y;

        const x2 = x1 + this.size.x;
        const y2 = y1 + this.size.y;

        if(x2 < visibleArea.x1 || visibleArea.x2 < x1 || y2 < visibleArea.y1 || visibleArea.y2 < y1){
            return false;
        }

        return true;
    }

    draw(ctx : CanvasRenderingContext2D, offset : Vec2, visibleArea : VisibleArea | undefined) : void {
        if(this.backgroundColor != undefined || targetUI == this){
            ctx.fillStyle = this.backgroundColor != undefined ? this.backgroundColor : "green";

            const x = offset.x + this.position.x;
            const y = offset.y + this.position.y;
            ctx.fillRect(x, y, this.size.x, this.size.y);
        }
        this.drawBorder(ctx, offset);
    }

    drawTop(ctx : CanvasRenderingContext2D){
        this.draw(ctx, Vec2.zero(), undefined)
    }

    str() : string {
        return `${this.idx} ${this.constructor.name}`;
    }

    copyFromUIAttr(data : UIAttr){
        if(data.padding !== undefined){
            if(typeof data.padding == "number"){
                this.padding = new Padding(data.padding, data.padding, data.padding, data.padding);
            }
            else if(data.padding.length == 2){
                this.padding = new Padding(data.padding[0], data.padding[0], data.padding[1], data.padding[1]);
            }
            else{
                this.padding = new Padding(... data.padding);
            }
        }

        if(data.left != undefined){
            this.position.x = data.left;
        }
        if(data.top != undefined){
            this.position.y = data.top;
        }
        if(data.right != undefined){
            this.right = data.right;
        }
        if(data.bottom != undefined){
            this.bottom = data.bottom;
        }

        if(data.size !== undefined){
            this.fixedSize     = new Vec2(data.size[0], data.size[1]);
        }
        // this.minSize = this.size.copy();

        if(data.colSpan !== undefined){
            this.colSpan = data.colSpan;
        }

        if(data.rowSpan !== undefined){
            this.rowSpan = data.rowSpan;
        }

        if(data.backgroundColor !== undefined){
            this.backgroundColor = data.backgroundColor;
        }

        if(data.borderWidth !== undefined){
            this.borderWidth = data.borderWidth;
        }

        if(data.lesson != undefined){
            this.lesson = data.lesson;
        }
    }

    constructor(data : UIAttr){
        super();
        this.className = this.constructor.name;
        this.idx      = UI.count++;

        if(data.id !== undefined){
            this.id = data.id;
            addObject(this.id, this);
        }

        if(data.name !== undefined){
            this.name = data.name;
        }

        if(data.position !== undefined){
            this.position = new Vec2(data.position[0], data.position[1]);
        }

        this.copyFromUIAttr(data);
    }

    absPosition() : Vec2 {
        let ui : UI = this;
        let pos = this.position;
        while(ui.parent !== undefined){
            ui = ui.parent;
            pos = pos.add(ui.position);
        }

        return pos;
    }

    getPosition() : Vec2 {
        return this.position.copy();
    }

    setPosition(position : Vec2) : void {
        this.position.copyFrom(position);
    }

    setCenterPosition(center: Vec2){
        this.setPosition(center.sub(this.size.mul(0.5)));
    }

    setMinSize() : void {
        if(this.fixedSize !== undefined){

            this.minSize.copyFrom(this.fixedSize);
        }
        else{

            this.minSize.copyFrom(this.getPaddingBorderSize());
        }

        this.size.copyFrom(this.minSize);
    }

    setMinSizeFromContentSize(width : number, height : number){
        const padding_border_size = this.getPaddingBorderSize();

        this.minSize.x = width  + padding_border_size.x;
        this.minSize.y = height + padding_border_size.y;

        this.size.copyFrom(this.minSize);
    }

    layoutByRightBottom(){
        if(this.right != undefined || this.bottom != undefined){
            const content_size = this.parent!.getContentSize();

            if(this.right != undefined){
                this.position.x = content_size.x - this.size.x;
                msg(`right:${this.name} ${this.right} ${this.position.x} = ${content_size.x} - ${this.size.x}`)
            }
            if(this.bottom != undefined){
                this.position.y = content_size.y - this.size.y;
                msg(`bottom:${this.name} ${this.position.y} = ${content_size.y} - ${this.size.y}`)
            }
        }
    }

    layout(position : Vec2, size : Vec2) : void {
        this.layoutByRightBottom();
        this.position.copyFrom(position);
        this.size.copyFrom(size);
    }

    layoutXY(x : number, y : number) : void {
        this.layout(Vec2.fromXY(x, y), this.size);
    }

    setMinSizeUpdateLayout(){
        this.setMinSize();
        this.updateLayout();
    }

    updateLayout(){
        this.layout(this.position, this.size);
    }

    isNear(position : Vec2) : boolean {
        if(this.position.x <= position.x && position.x < this.position.x + this.size.x){
            if(this.position.y <= position.y && position.y < this.position.y + this.size.y){
                return true;
            }
        }

        return false;
    }

    getNearUI(position : Vec2) : UI | undefined {
        if(this.isNear(position)){
            return this;
        }
        else{
            return undefined;
        }
    }

    async click(){
        if(this.clickHandler !== undefined){
            await this.clickHandler();
        }
    }

    drawBorder(ctx : CanvasRenderingContext2D, offset : Vec2) {
        const borderWidth = this.getBorderWidth();
        if(borderWidth == 0){
            return;
        }

        const x1 = offset.x + this.position.x;
        const y1 = offset.y + this.position.y;
        const width  = this.size.x;
        const height = this.size.y;

        if(borderWidth == 1){
            ctx.strokeStyle = "white";
            ctx.strokeRect(x1, y1, width, height);
            return;
        }

        const x2 = x1 + borderWidth / 2;
        const y2 = y1 + borderWidth / 2;

        const x3 = x1 + borderWidth;
        const y3 = y1 + borderWidth;

        const x4 = x1 + width  - borderWidth;
        const y4 = y1 + height - borderWidth;

        const x5 = x1 + width  - borderWidth / 2;
        const y5 = y1 + height - borderWidth / 2;

        const x6 = x1 + width;
        const y6 = y1 + height;

        const light_dark_sides = [
            [
                [ x1, y1 ],
                [ x1, y6 ],
                [ x2, y5 ],
                [ x2, y2 ],
                [ x5, y2 ],
                [ x6, y1 ]
            ]
            ,
            [
                [ x2, y5 ],
                [ x5, y5 ],
                [ x5, y2 ],
                [ x4, y3 ],
                [ x4, y4 ],
                [ x3, y4 ]
            ]
            ,
            [
                [ x2, y2 ],
                [ x2, y5 ],
                [ x3, y4 ],
                [ x3, y3 ],
                [ x4, y3 ],
                [ x5, y2 ]
            ],
            [
                [ x1, y6 ],
                [ x6, y6 ],
                [ x6, y1 ],
                [ x5, y2 ],
                [ x5, y5 ],
                [ x2, y5 ]
            ]
        ];

        // const x : number, y : number, width : number, height : number, ridgeWidth : number
        // Define light and dark colors
        // const lightColor = isInset ? '#888' : '#eee'; // Darker for inset top/left
        // const darkColor = isInset ? '#eee' : '#888';  // Lighter for inset bottom/right

        const lightColor = "#ffffff";
        const darkColor = "#888888";
        const backgroundColor = (this.backgroundColor != undefined ? this.backgroundColor : "#cccccc");


        for(const [light_dark, sides] of light_dark_sides.entries()){
            if(light_dark <= 1){
                ctx.fillStyle = lightColor;
            }
            else{
                ctx.fillStyle = darkColor;
            }

            ctx.beginPath();
            for(const [idx, [x,y]] of sides.entries()){
                if(idx == 0){
                    ctx.moveTo(x, y);
                }
                else{
                    ctx.lineTo(x, y);
                }
            }

            ctx.closePath();
            ctx.fill();
        }

        return;


        // Optionally, draw the inner rectangle (fill or another stroke)
        ctx.fillStyle = backgroundColor; // Example inner color
        ctx.fillRect(x3, y3, width - 2 * borderWidth, height - 2 * borderWidth);

        // Draw the "light" sides (top and left)
        ctx.strokeStyle = lightColor;
        ctx.lineWidth = borderWidth;
        ctx.beginPath();
        ctx.moveTo(x2, y1 + height - borderWidth / 2); // Bottom-left corner
        ctx.lineTo(x2, y2);     // Top-left corner
        ctx.lineTo(x1 + width - borderWidth / 2, y2); // Top-right corner
        ctx.stroke();

        // Draw the "dark" sides (bottom and right)
        ctx.strokeStyle = darkColor;
        ctx.lineWidth = borderWidth;
        ctx.beginPath();
        ctx.moveTo(x1 + width - borderWidth / 2, y2);     // Top-right corner
        ctx.lineTo(x1 + width - borderWidth / 2, y1 + height - borderWidth / 2); // Bottom-right corner
        ctx.lineTo(x2, y1 + height - borderWidth / 2); // Bottom-left corner
        ctx.stroke();
    }
}

class Filler extends UI {
    constructor(data : UIAttr){
        super(data);
    }
}


export function getNearUIinArray(children : UI[], position : Vec2){
    for(const child of children){
        const ui = child.getNearUI(position);
        if(ui !== undefined){
            return ui;
        }
    }

    return undefined;
}

export function filler() : Filler {
    return new Filler({ borderWidth : 0 });
}

// Actionを生成する関数の型定義
type ActionCreator = (obj: any) => any;

const actionRegistry: Record<string, ActionCreator> = {};

export function registerAction(name: string, creator: ActionCreator) {
    actionRegistry[name] = creator;
}

export function makeActionFromJSON(obj: any) {
    const className = obj.className;
    const creator = actionRegistry[className];
    if (!creator){
        throw new MyError(`Unknown class: ${className}`);
    }

    return creator(obj);
}

// UIを生成する関数の型定義
type UICreator = (obj: any) => any;

const UIRegistry: Record<string, UICreator> = {};

export function registerUI(name: string, creator: UICreator) {
    UIRegistry[name] = creator;
}

export function makeUIFromJSON(obj: any) {
    if(obj instanceof UI){
        return obj;
    }

    const className = obj.className;
    const creator = UIRegistry[className];
    if (!creator){
        throw new MyError(`Unknown class: ${className}`);
    }
    return creator(obj);
}
