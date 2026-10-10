///<reference path="container.ts" />

import { Vec2 } from "@i18n";
import { registerUI, UIAttr } from "./core";
import { ContainerUI } from "./container";

export class Stage extends ContainerUI {
    static mainStage : Stage;

    constructor(data : UIAttr & { children? : any[] }){
        super(data);
        if(this.name == "main-stage"){
            Stage.mainStage = this;
        }
    }

    layout(position : Vec2, size : Vec2) : void {
        super.layout(position, size);
        this.children.forEach(x => x.layout(x.position, x.netSize));
    }    
}

registerUI(Stage.name, (obj) => new Stage(obj));
