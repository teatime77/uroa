///<reference path="container.ts" />

import { Vec2 } from "@i18n";
import { VisibleArea, UI, UIAttr, registerUI } from "./core";
import { ContainerUI } from "./container";

import type { Canvas } from "./canvas";

export interface Draggable {
    pointerdown(canvas : Canvas) : void;
    pointermove(canvas : Canvas) : void;
    pointerup(canvas : Canvas) : void;
}

export class Thumb extends UI implements Draggable {
    static radius = 10;
    slider : Slider;
    value  : number = 0;

    constructor(slider : Slider){
        const data = {
            "className" : "Thumb",
            "size"      : [ 2 * Thumb.radius, 2 * Thumb.radius ]
        } as UIAttr;

        super(data);
        this.slider = slider;
    }

    isNear(position : Vec2) : boolean {
        return Math.hypot(position.x - this.position.x, position.y - this.position.y) <= Thumb.radius;
    }

    setPositionByValue() {
        const ratio   = (this.value - this.slider.min) / (this.slider.max - this.slider.min);

        const thumbStart = this.slider.thumbStart();
        const thumbEnd   = this.slider.thumbEnd();

        const new_position = thumbStart.mul(1 - ratio).add(thumbEnd.mul(ratio))
        this.position.copyFrom(new_position);
    }


    setPosition(position : Vec2) {
        const thumbStart = this.slider.thumbStart();
        const thumbEnd   = this.slider.thumbEnd();

        let ratio : number;
        if(this.slider instanceof HorizontalSlider){

            this.position.x = Math.max(thumbStart.x, Math.min(thumbEnd.x, position.x));
            this.position.y = thumbStart.y;

            ratio   = (this.position.x - thumbStart.x) / (thumbEnd.x - thumbStart.x);
        }
        else{

            this.position.x = thumbStart.x;
            this.position.y = Math.max(thumbStart.y, Math.min(thumbEnd.y, position.y));

            ratio   = (this.position.y - thumbStart.y) / (thumbEnd.y - thumbStart.y);
        }

        this.value    = this.slider.min * (1 - ratio) + this.slider.max * ratio;
    }

    draw(ctx : CanvasRenderingContext2D, offset : Vec2, visibleArea : VisibleArea | undefined) : void{
        if(! this.isVisible(offset, visibleArea)){
            return;
        }
        
        const center = offset.add(this.position);

        ctx.beginPath();
        ctx.arc(center.x, center.y, Thumb.radius, 0, 2 * Math.PI, true);

        ctx.fillStyle   = "silver";
        ctx.strokeStyle = "gray";

        ctx.fill();
        ctx.stroke();        
    }    

    pointerdown(canvas : Canvas) : void {

    }

    pointermove(canvas : Canvas) : void {

    }

    pointerup(canvas : Canvas) : void {

    }
}

export class Track extends UI {
    static breadth = 10;

    slider : Slider;

    constructor(slider : Slider){
        const data = {
            "className" : "Track"
        } as UIAttr;

        super(data);
        this.slider = slider;
    }
}


export abstract class Slider extends ContainerUI {
    static padding = 30;
    track : Track;
    thumb : Thumb;
    min   : number = 0;
    max   : number = 100;

    constructor(data : UIAttr){
        super(data);

        this.track = new Track(this);
        this.thumb = new Thumb(this);
        this.addChildren(this.track, this.thumb);

        this.layoutTrack();
    }

    abstract thumbStart() : Vec2;
    abstract thumbEnd()   : Vec2;

    value() : number {
        return this.thumb.value;
    }

    layoutTrack(){
        const thumbStart = this.thumbStart();
        const thumbEnd   = this.thumbEnd();

        let position = Vec2.zero();
        let size     = Vec2.zero();

        if(this instanceof HorizontalSlider){

            position.x = thumbStart.x;
            position.y = thumbStart.y - Track.breadth / 2;

            size.x = thumbEnd.x - thumbStart.x;
            size.y = Track.breadth;
        }
        else{

            position.x = thumbStart.x - Track.breadth / 2;
            position.y = thumbStart.y;

            size.x = Track.breadth;
            size.y = thumbEnd.y - thumbStart.y;
        }

        this.track.layout(position, size);
    }

    layout(position : Vec2, size : Vec2) : void {
        super.layout(position, size);
        this.layoutTrack();
        this.thumb.setPositionByValue();
    }
}

export class HorizontalSlider extends Slider {
    thumbStart() : Vec2 {
        const start_x = Slider.padding;
        const start_y = this.netSize.y / 2;

        return new Vec2(start_x, start_y);
    }

    thumbEnd() : Vec2 {
        const end_x   = this.netSize.x - Slider.padding;
        const end_y = this.netSize.y / 2;

        return new Vec2(end_x, end_y);
    }
}

registerUI(HorizontalSlider.name, (obj) => new HorizontalSlider(obj));

export class VerticalSlider extends Slider {
    thumbStart() : Vec2 {
        const start_x = this.netSize.x / 2;
        const start_y = Slider.padding;

        return new Vec2(start_x, start_y);
    }

    thumbEnd() : Vec2 {
        const end_x = this.netSize.x / 2;
        const end_y = this.netSize.y - Slider.padding;

        return new Vec2(end_x, end_y);
    }
}

registerUI(VerticalSlider.name, (obj) => new VerticalSlider(obj));
