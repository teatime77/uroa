///<reference path="core.ts" />

import { sleep, Vec2 } from "@i18n";
import { VisibleArea, LabelAttr, TextUIAttr, UI, registerUI, worldCanvas } from "./core";
import { Sequencer } from "../action/sequencer";


export let currentLesson : Label | undefined;

async function loadWorld(target : string) {
    const game = await import("../index");
    await game.loadWorld(target);
}

const textColor = "white";

interface TextDimensions {
    width: number;
    height: number;
    // Optional: for precise positioning
    actualLeft: number;
    actualTop: number;
}

export function getTextBoxSize(ctx: CanvasRenderingContext2D, text: string, font: string): TextDimensions {
    // 1. Set the font so measureText() can calculate based on it
    ctx.font = font;

    // 2. Get the TextMetrics object
    const metrics = ctx.measureText(text);

    // 3. Calculate Width
    // metrics.width is the advance width (how far the cursor moves after drawing)
    const textWidth = metrics.width;
    
    // OR, for the absolute visible width (handling overhanging italic characters):
    // const actualWidth = Math.abs(metrics.actualBoundingBoxLeft) + Math.abs(metrics.actualBoundingBoxRight);

    // 4. Calculate Height (The recommended way for the tight bounding box)
    // actualBoundingBoxAscent is the distance from the baseline to the top of the text.
    // actualBoundingBoxDescent is the distance from the baseline to the bottom of the text.
    const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;

    return {
        width: textWidth, 
        height: textHeight,
        // The distance from the (x, y) point to the top-left of the text's bounding box.
        actualLeft: metrics.actualBoundingBoxLeft,
        actualTop: metrics.actualBoundingBoxAscent 
    };
}

export abstract class TextUI extends UI {
    fontFamily? : string;
    fontSize? : string;
    textAlign? : string;
    text : string;
    metrics!: TextMetrics;
    actualHeight!: number;
    path? : string;

    constructor(data : TextUIAttr){
        super(data);
        if(data.fontFamily !== undefined){
            this.fontFamily = data.fontFamily;
        }
        if(data.fontSize !== undefined){
            this.fontSize = data.fontSize;
        }
        if(data.path !== undefined){
            this.path = data.path;
        }
        // this.textAlign = data.textAlign;
        this.text = (data.text != undefined ? data.text : "");
    }

    async click(){
        await super.click();

        if(this.name == "play"){
            Sequencer.start();
        }
        else if(this.name == "back"){
            const { loadStageMapPage } = await import("../isometric/isometric");
            loadStageMapPage();
        }
        else if(this instanceof Label && this.lesson != undefined){
            currentLesson = this;
            await loadWorld("stage.ArithFormEx"); 
            await sleep(500);
            Sequencer.start();
        }
        else if(this instanceof TextUI && this.path != undefined){
            await loadWorld(this.path);
        }
    }

    getFont() : string {
        const fontFamily = (this.fontFamily != undefined ? this.fontFamily : UI.fontFamily);
        const fontSize   = (this.fontSize   != undefined ? this.fontSize   : UI.fontSize);
        
        return `${fontSize} ${fontFamily}`;
    }

    setMinSize() : void {
        if(this.fixedSize !== undefined){

            this.minSize.copyFrom(this.fixedSize);
        }
        else{

            const padding_border_size = this.getPaddingBorderSize();

            const size = getTextBoxSize(worldCanvas.ctx, this.text, this.getFont());

            this.minSize.x = size.width  + padding_border_size.x;
            this.minSize.y = size.height + padding_border_size.y;
        }

        this.netSize.copyFrom(this.minSize);
        // msg(`text size:${this.size.x.toFixed()} ${this.size.y.toFixed()} ${this.text}`);
    }

    draw(ctx : CanvasRenderingContext2D, offset : Vec2, visibleArea : VisibleArea | undefined) : void {
        if(! this.isVisible(offset, visibleArea)){
            return;
        }

        super.draw(ctx, offset, visibleArea);

        ctx.save();

        if(this.color != undefined){
            ctx.strokeStyle = this.color;
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // ctx.font = `${(this.size.y * 0.8).toFixed()}px "Hiragino Kaku Gothic Pro", "Meiryo", sans-serif`;
        ctx.font = this.getFont();
        
        const x = offset.x + this.position.x + this.netSize.x / 2;
        const y = offset.y + this.position.y + this.netSize.y / 2;

        ctx.fillStyle = textColor;
        ctx.fillText(this.text, x, y);

        ctx.restore();
    }

    toString() : string {
        return `${this.constructor.name} : [${this.text}]`;
    }
}

export class Label extends TextUI {
    args : number[] = [];
    constructor(data : LabelAttr){
        super(data);
        if(data.args != undefined){
            this.args = data.args;
        }
    }
}

registerUI(Label.name, (obj) => new Label(obj));


export class PlaceHolder extends Label {    
}


registerUI(PlaceHolder.name, (obj) => new PlaceHolder(obj));


export class Button extends TextUI {
}

registerUI(Button.name, (obj) => new Button(obj));


export class Link extends TextUI {
    constructor(data : TextUIAttr){
        super(data);
    }
}


registerUI(Link.name, (obj) => new Link(obj));
