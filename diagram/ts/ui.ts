import { assert, MyError, msg, Vec2 } from "@i18n";
import { Canvas } from "./canvas";

const TextSizeFill = 8;
export const textColor = "black";

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

export interface Attr {
    className? : string;
    obj? : any;
    name? : string;
    position? : string;
    margin? : number[];
    color? : string;
    backgroundColor? : string;
    borderStyle? : string;
    borderWidth? : number;
    padding? : number[];
    verticalAlign? : string;
    horizontalAlign? : string;
    width? : string;
    height? : string;
    disabled? : boolean;
    visibility? : string;
    inToolbox?   : boolean;
}

export interface TextAttr extends Attr {
    text? : string;
    fontSize? : string;
    textAlign? : string;
}

export interface ButtonAttr extends TextAttr {
    click : ()=>Promise<void>;
}


export abstract class UI {
    static count : number = 0;

    idx : number;
    ctx! : CanvasRenderingContext2D;
    position : Vec2 = Vec2.zero();
    boxSize  : Vec2 = Vec2.zero();
    width? : string;
    height? : string;
    margin : number[] = [ 4, 4, 4, 4 ];     // left, right, top, bottom
    borderWidth : number = 3;
    padding : number[] = [ 0, 0, 0, 0 ];    // left, right, top, bottom

    horizontalAlign? : string;
    backgroundColor? : string;

    constructor(data : Attr){
        this.idx = ++UI.count;
        this.backgroundColor = data.backgroundColor;
    }

    copyUI(ui : UI){
        ui.position = this.position.copy();
        ui.boxSize  = this.boxSize.copy();
        ui.ctx      = this.ctx;
    }

    children() : UI[] {
        return [];
    }    

    getPosition() : Vec2 {
        return this.position;
    }

    marginWidth() : number {
        return this.margin[0] + this.margin[1];
    }

    marginHeight() : number {
        return this.margin[2] + this.margin[3];
    }

    marginBorderPaddingWidth() : number {
        return this.margin[0] + this.margin[1] + 2 * this.borderWidth + this.padding[0] + this.padding[1];
    }

    marginBorderPaddingHeight() : number {
        return this.margin[2] + this.margin[3] + 2 * this.borderWidth + this.padding[2] + this.padding[3];
    }

    setBoxSize() : void {
        this.boxSize = Vec2.zero();
        msg(`set-min-size:${this.constructor.name}`);
    }

    getMinWidth() : number {       
        assert(this.boxSize != undefined);
        return this.boxSize!.x;
    }

    getMinHeight() : number {
        assert(this.boxSize != undefined);
        return this.boxSize!.y;
    }

    setPosition(position : Vec2) : void {
        this.position = position;
    }

    marginBox() : [number, number, number, number] {
        const xa = this.position.x + this.margin[0];
        const ya = this.position.y + this.margin[2];
        const xb = xa + this.boxSize.x - this.marginWidth();
        const yb = ya + this.boxSize.y - this.marginHeight();

        return [ xa, ya, xb, yb ];
    }

    borderCenterBox() : [number, number, number, number] {
        const [xa, ya, xb, yb] = this.marginBox();

        const x1 = xa + this.borderWidth / 2;
        const y1 = ya + this.borderWidth / 2;

        const x2 = xb - this.borderWidth / 2;
        const y2 = yb - this.borderWidth / 2;

        return [x1, y1, x2, y2];

    }

    borderInnerBox() : [number, number, number, number] {
        const [xa, ya, xb, yb] = this.marginBox();

        const x1 = xa + this.borderWidth;
        const y1 = ya + this.borderWidth;

        const x2 = xb - this.borderWidth;
        const y2 = yb - this.borderWidth;

        return [x1, y1, x2, y2];
    }

    drawBox() : [number, number, number, number] {
        return this.borderInnerBox();
    }

    inMarginBox(pos : Vec2) : boolean {
        const [ xa, ya, xb, yb ] = this.marginBox();
        return xa <= pos.x && pos.x < xb && ya <= pos.y && pos.y < yb;
    }

    draw(){
        const [xa, ya, xb, yb] = this.marginBox();
        const w = xb - xa;
        const h = yb - ya;
        this.drawRidgeRect(this.ctx, xa, ya, w, h, this.borderWidth);
    }

    str() : string {
        if(this.boxSize == undefined){
            throw new MyError();
        }

        const width  = (this.width  != undefined ? `width:${this.width} `  : "");
        const height = (this.height != undefined ? `height:${this.height} ` : "");
        const minSize = (this.boxSize!= undefined ? `min-size:${this.boxSize.x.toFixed()}, ${this.boxSize.y.toFixed()} ` : "");
        const position = `pos:(${this.position.x},${this.position.y}) `;
        const boxSize = `box:(${this.boxSize.x},${this.boxSize.y}) `;

        return `${this.constructor.name} ${width}${height}${minSize}${position}${boxSize}`;
    }

    dump(nest : number){
        msg(`${tab(nest)}${this.str()}`);
    }

    drawRidgeRect(ctx : CanvasRenderingContext2D, x : number, y : number, width : number, height : number, ridgeWidth : number, isInset = false) {
        // Define light and dark colors
        // const lightColor = isInset ? '#888' : '#eee'; // Darker for inset top/left
        // const darkColor = isInset ? '#eee' : '#888';  // Lighter for inset bottom/right

        const lightColor = "#ffffff";
        const darkColor = "#888888";
        const backgroundColor = (this.backgroundColor != undefined ? this.backgroundColor : "#cccccc");

        // Optionally, draw the inner rectangle (fill or another stroke)
        ctx.fillStyle = backgroundColor; // Example inner color
        ctx.fillRect(x + ridgeWidth, y + ridgeWidth, width - 2 * ridgeWidth, height - 2 * ridgeWidth);

        // Draw the "light" sides (top and left)
        ctx.strokeStyle = lightColor;
        ctx.lineWidth = ridgeWidth;
        ctx.beginPath();
        ctx.moveTo(x + ridgeWidth / 2, y + height - ridgeWidth / 2); // Bottom-left corner
        ctx.lineTo(x + ridgeWidth / 2, y + ridgeWidth / 2);     // Top-left corner
        ctx.lineTo(x + width - ridgeWidth / 2, y + ridgeWidth / 2); // Top-right corner
        ctx.stroke();

        // Draw the "dark" sides (bottom and right)
        ctx.strokeStyle = darkColor;
        ctx.lineWidth = ridgeWidth;
        ctx.beginPath();
        ctx.moveTo(x + width - ridgeWidth / 2, y + ridgeWidth / 2);     // Top-right corner
        ctx.lineTo(x + width - ridgeWidth / 2, y + height - ridgeWidth / 2); // Bottom-right corner
        ctx.lineTo(x + ridgeWidth / 2, y + height - ridgeWidth / 2); // Bottom-left corner
        ctx.stroke();
    }
}

export class Filler extends UI {
}

export class TextUI extends UI {
    fontSize? : string;
    textAlign? : string;
    text : string;
    metrics!: TextMetrics;
    actualHeight!: number;

    constructor(data : TextAttr){
        super(data);
        this.fontSize  = data.fontSize;
        this.textAlign = data.textAlign;
        this.text = (data.text != undefined ? data.text : "");
    }


    setBoxSize() : void {
        this.metrics = this.ctx.measureText(this.text);
      
        this.actualHeight = this.metrics.actualBoundingBoxAscent + this.metrics.actualBoundingBoxDescent;
      
        msg(`idx:[${this.idx}]  font :[${this.fontSize}]  w:[${this.metrics.width}] h:[${this.actualHeight}] [${this.text}]`);

        const width  = this.metrics.width + this.marginBorderPaddingWidth() + TextSizeFill;
        const height = this.actualHeight  + this.marginBorderPaddingHeight() + TextSizeFill;

        this.boxSize = new Vec2(width, height);
    }

    draw(){
        super.draw();

        const x = this.position.x + this.margin[0] + this.borderWidth + this.padding[0];
        const y = this.position.y + this.margin[2] + this.borderWidth + this.padding[2]
                  + this.actualHeight;

        this.ctx.strokeStyle = textColor;
        this.ctx.strokeText(this.text, x, y);
    }

    str() : string {
        return `${super.str()} text:${this.text}`;
    }

}

export class Label extends TextUI {
}

export class Button extends TextUI {
    click : ()=>Promise<void>;

    constructor(data : ButtonAttr){
        super(data);
        this.click = data.click;
    }
}

export abstract class Node extends UI {
    abstract done() : boolean;
    abstract drawNode(canvas : Canvas) : void;

    constructor(data : Attr){
        super(data);
    }
}

export function tab(nest : number) : string {
    return " ".repeat(nest * 4);
}
