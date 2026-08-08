///<reference path="container.ts" />

import { msg, Vec2, IGrid, AbstractUI, setMinSizeGrid, layoutGrid } from "@i18n";
import { UIAttr, UI, registerUI } from "./core";
import { ContainerUI } from "./container";

export interface GridAttr extends UIAttr {
    children?: any[];
    columns? : string;
    rows?    : string;
}

export class Grid extends ContainerUI implements IGrid {
    columns : string[];
    rows    : string[];
    numCols : number;
    numRows : number;
    columnsPix : number[] = [];
    rowsPix    : number[] = [];

    static autoSize(count : number) : string {
        return (new Array(count).fill("*")).join(" ");
    }

    constructor(data : GridAttr) {
        super(data);
        if(data.columns !== undefined){

            this.columns = data.columns.split(" ");

            this.numCols = this.columns.length;
        }
        else{
            this.columns = ["*"];
            this.numCols = 1;
        }

        this.setRowColIdxOfChildren();

        if(data.rows !== undefined){

            this.rows = data.rows.split(" ");
            this.numRows = this.rows.length;
        }
        else{
            this.numRows = Math.max(... this.absChildren().map(x => x.rowIdx + x.getRowSpan()));
            this.rows    = new Array(this.numRows).fill("*");
        }
    }

    absChildren() : AbstractUI[] {
        return this.children;
    }

    setRowColIdxOfChildren(){
        let col_idx = 0;
        let row_idx = 0;
        for(const child of this.absChildren()){
            child.colIdx = col_idx;
            child.rowIdx = row_idx;

            col_idx += child.getColSpan();
            if(this.numCols <= col_idx){
                col_idx = 0;
                row_idx++;
            }
        }

        if(this.rows != undefined && this.rows.length < row_idx){
            while(this.rows.length < row_idx){
                this.rows.push("*");
            }

            this.numRows = row_idx;
            msg(`add rows to grid.`);
        }
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
