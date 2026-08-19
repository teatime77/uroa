///<reference path="core.ts" />

import { remove, MyError, Vec2, assert, last } from "@i18n";
import { VisibleArea, UI, UIAttr, getNearUIinArray, makeUIFromJSON } from "./core";

export abstract class ContainerUI extends UI {
    children : UI[] = [];

    constructor(data : UIAttr & { children? : any[] }){
        super(data);

        if(data.children != undefined){
            this.children = (data.children as any[]).map(x => makeUIFromJSON(x));
            this.children.forEach(x => x.parent = this);
        }
    }

    getAllUIsub(all_uis : UI[]){
        super.getAllUIsub(all_uis);
        this.children.forEach(x => x.getAllUIsub(all_uis));
    }

    lastUI() : UI {
        return last(this.children);
    }

    removeChild(child : UI){
        remove(this.children, child);
    }

    addChildren(...children : UI[]){
        this.children.push(...children);
        children.forEach(x => x.parent = this);
    }

    spliceChildren(idx : number, ...children : UI[]){
        this.children.splice(idx, 1, ...children);
        children.forEach(x => x.parent = this);
    }

    setMinSize() : void {
        this.children.forEach(x => x.setMinSize());
    }

    setMinSizeByChildren() : void {
        const padding_border_size = this.getPaddingBorderSize();

        const width  = Math.max(...this.children.map(x => x.getRight()));
        const height = Math.max(...this.children.map(x => x.getBottom()));

        this.minSize.x = width  + padding_border_size.x;
        this.minSize.y = height + padding_border_size.y;

        this.netSize.copyFrom(this.minSize);
    }

    getNearUI(position : Vec2) : UI | undefined {
        if(this.isNear(position)){
            const content_position = this.getContentPosition();
            const position2 = position.sub(this.position).sub(content_position);

            const ui = getNearUIinArray(this.children.slice().reverse(), position2);
            if(ui !== undefined){
                return ui;
            }

            return this;
        }

        return undefined;
    }

    drawSub(ctx : CanvasRenderingContext2D, offset : Vec2, visibleArea : VisibleArea | undefined) : Vec2 {
        super.draw(ctx, offset, visibleArea);

        const content_position = this.getContentPosition();
        const offset2 = offset.add(this.position).add(content_position);
        if(isNaN(offset2.x)){
            throw new MyError();
        }

        return offset2;
    }

    draw(ctx : CanvasRenderingContext2D, offset : Vec2, visibleArea : VisibleArea | undefined) : void {
        const offset2 = this.drawSub(ctx, offset, visibleArea);
        this.children.forEach(x => x.draw(ctx, offset2, visibleArea));
    }

    toString() : string {
        return `${this.constructor.name} : [ ${this.children.map(x => x.toString()).join(", ")} ]`;
    }
}
