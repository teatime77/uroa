///<reference path="container.ts" />

import { Vec2 } from "@i18n";
import { VisibleArea, UI, UIAttr, getNearUIinArray, registerUI, makeUIFromJSON } from "./core";
import { ContainerUI } from "./container";
import { HorizontalSlider, VerticalSlider, Track } from "./slider";

export class ScrollView extends ContainerUI {
    horizontalSlider = new HorizontalSlider({ padding:0, borderWidth:0 });
    verticalSlider   = new VerticalSlider({ padding:0, borderWidth:0 });
    viewChildren : UI[];
    viewSize : Vec2;
    clientSize : Vec2 = Vec2.nan();

    constructor(data : UIAttr & { viewChildren : any[], viewSize:[number, number] }){
        super(data);

        this.viewChildren = data.viewChildren.map(x => makeUIFromJSON(x));

        this.addChildren(this.horizontalSlider, this.verticalSlider, ...this.viewChildren);

        this.viewSize = Vec2.fromXY(data.viewSize[0], data.viewSize[1]);
    }

    setMinSize() : void {
        if(this.fixedSize !== undefined){

            this.minSize.copyFrom(this.fixedSize);
        }
        else{

            this.minSize.copyFrom(this.getPaddingBorderSize());

            this.minSize.x += Track.breadth;
            this.minSize.y += Track.breadth;
        }

        this.netSize.copyFrom(this.minSize);

        this.children.forEach(x => x.setMinSize());
    }

    layoutHorizontalSlider(){
        const position_x = 0;
        const position_y = this.clientSize.y;

        const size_x = this.clientSize.x;
        const size_y = Track.breadth;

        this.horizontalSlider.layout(Vec2.fromXY(position_x, position_y), Vec2.fromXY(size_x, size_y));
    }

    layoutVerticalSlider(){
        const position_x = this.clientSize.x;
        const position_y = 0;

        const size_x = Track.breadth;
        const size_y = this.clientSize.y;

        this.verticalSlider.layout(Vec2.fromXY(position_x, position_y), Vec2.fromXY(size_x, size_y));
    }

    layout(position : Vec2, size : Vec2) : void {
        super.layout(position, size);
        const padding_border_size = this.getPaddingBorderSize();
        this.clientSize.x = this.netSize.x - padding_border_size.x - Track.breadth;
        this.clientSize.y = this.netSize.y - padding_border_size.y - Track.breadth;

        this.layoutHorizontalSlider();
        this.layoutVerticalSlider();

        this.horizontalSlider.max = this.viewSize.x - this.clientSize.x;
        this.verticalSlider.max   = this.viewSize.y - this.clientSize.y;

        this.viewChildren.forEach(x => x.updateLayout());
    }    

    getScrollOffset() : Vec2 {
        const x_value = - this.horizontalSlider.value();
        const y_value = - this.verticalSlider.value();

        return Vec2.fromXY(x_value, y_value);
    }

    drawScrollView(ctx : CanvasRenderingContext2D, offset2 : Vec2, visibleArea? : VisibleArea) : void {
        this.horizontalSlider.draw(ctx, offset2, visibleArea);
        this.verticalSlider.draw(ctx, offset2, visibleArea);

        const scroll_offset = this.getScrollOffset();
        const offset3 = offset2.add(scroll_offset);

        ctx.save();

        ctx.translate(offset3.x, offset3.y);
        visibleArea = new VisibleArea(- scroll_offset.x, - scroll_offset.y, this.clientSize.x, this.clientSize.y);

        ctx.beginPath();
        ctx.rect(- scroll_offset.x, - scroll_offset.y, this.clientSize.x, this.clientSize.y);
        ctx.clip();

        this.viewChildren.forEach(x => x.draw(ctx, Vec2.zero(), visibleArea));

        ctx.restore();
    }

    draw(ctx : CanvasRenderingContext2D, offset : Vec2, visibleArea : VisibleArea | undefined) : void {
        const offset2 = this.drawSub(ctx, offset, visibleArea);
        
        this.drawScrollView(ctx, offset2, visibleArea);
    }

    getNearUI(position : Vec2) : UI | undefined {
        if(this.isNear(position)){
            const content_position = this.getContentPosition();
            const position2 = position.sub(this.position).sub(content_position);

            let ui = getNearUIinArray([ this.horizontalSlider, this.verticalSlider ], position2);
            if(ui !== undefined){
                return ui;
            }

            const scroll_offset = this.getScrollOffset();
            const position3 = position2.sub(scroll_offset);

            ui = getNearUIinArray(this.viewChildren, position3);
            if(ui !== undefined){
                return ui;
            }

            return this;
        }

        return undefined;
    }

}

registerUI(ScrollView.name, (obj) => new ScrollView(obj));
