///<reference path="core.ts" />

import { msg, Vec2 } from "@i18n";
import { registerUI, UIAttr } from "./core";
import { Grid } from "./grid";
import type { Canvas } from "./canvas";

let popupMenus : PopupMenu[];

export function initPopupMenus(popup_menus : PopupMenu[]){
    popupMenus = popup_menus.slice();
}

export function showPopupMenu(canvas : Canvas, x : number, y : number){
    if(popupMenus.length == 0){
        msg("no popup menu");
        return;
    }
    
    const menu = popupMenus[0];

    menu.canvas = canvas;
    menu.setMinSize();
    menu.layout(Vec2.fromXY(x, y), menu.minSize);

    PopupMenu.one = menu;
}

export class PopupMenu extends Grid {
    static one : PopupMenu | undefined;

    constructor(data : UIAttr & { children : any[] }){
        super(data);
    }

    static close(){
        PopupMenu.one = undefined;
    }
}

registerUI(PopupMenu.name, (obj) => new PopupMenu(obj));

