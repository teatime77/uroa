///<reference path="core.ts" />

import { msg, Vec2 } from "@i18n";
import { VisibleArea, UI, UIAttr, registerUI, worldCanvas } from "./core";
import { urlBase } from "..";

export const imageMap = new Map<string, HTMLImageElement>();

export class ImageUI extends UI {
    imageFile : string;

    constructor(data : UIAttr){
        super(data);
        this.imageFile = data.imageFile!;
        addImage(this.imageFile);
    }

    setImageFile(imageFile : string){
        this.imageFile = imageFile;
    }

    isNear(position : Vec2) : boolean {
        if(this.position.x <= position.x && position.x < this.position.x + this.netSize.x){
            if(this.position.y <= position.y && position.y < this.position.y + this.netSize.y){
                return true;
            }
        }

        return false;
    }

    draw(ctx : CanvasRenderingContext2D, offset : Vec2, visibleArea : VisibleArea | undefined) : void {
        if(! this.isVisible(offset, visibleArea)){
            return;
        }

        super.draw(ctx, offset, visibleArea);
        const image = imageMap.get(this.imageFile);
        if(image == undefined){
            // msg(`no img:${this.imageFile}`);
        } 
        else{
            const content_position    = this.getContentPosition();
            const padding_border_size = this.getPaddingBorderSize();

            const x = offset.x + this.position.x + content_position.x;
            const y = offset.y + this.position.y + content_position.y;
            const width = this.netSize.x - padding_border_size.x;
            const height = this.netSize.y - padding_border_size.y;
            ctx.drawImage(image, x, y, width, height);
        }
    }
}

registerUI(ImageUI.name, (obj) => new ImageUI(obj));

const pendingImageFiles = new Set<string>();

export function addImage(image_file : string){
    if(pendingImageFiles.has(image_file)){
        return;
    }

    pendingImageFiles.add(image_file);

    const image = new Image();
    // Set the path to your image file
    image.src = `${urlBase}/images/${image_file}`;    
    image.onload = ()=>{
        imageMap.set(image_file, image);
        worldCanvas.requestUpdateCanvas();
        msg(`image loaded:${image_file}`);
    }
}
