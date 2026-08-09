///<reference path="container.ts" />

import { msg, Vec2, IGrid, AbstractUI, setMinSizeGrid, layoutGrid, initGrid } from "@i18n";
import { UIAttr, UI, registerUI } from "./core";
import { ContainerUI } from "./container";

export interface GridAttr extends UIAttr {
    children?: any[];
    columns? : string;
    rows?    : string;
}

export class Grid extends ContainerUI implements IGrid {
    columns! : string[];
    rows!    : string[];
    numCols! : number;
    numRows! : number;
    columnsPix : number[] = [];
    rowsPix    : number[] = [];

    static autoSize(count : number) : string {
        return (new Array(count).fill("*")).join(" ");
    }

    constructor(data : GridAttr) {
        super(data);
        initGrid(this, data.columns, data.rows);
    }

    absChildren() : AbstractUI[] {
        return this.children;
    }

    setMinSize() : void {
        setMinSizeGrid(this);
    }

    layout(position : Vec2, size : Vec2) : void {
        super.layout(position, size);
        layoutGrid(this, position, size)
    }
}

registerUI(Grid.name, (obj) => new Grid(obj));
