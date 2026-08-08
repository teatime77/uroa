///<reference path="container.ts" />

import { assert, msg, sum, last, Vec2, IGrid, AbstractUI, setMinSizeGrid, ratioUI } from "@i18n";
import { UIAttr, UI, registerUI } from "./core";
import { getDocumentSize } from "../game_util";
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

        const content_size = this.getContentSize();
        const columns_ratio_all = content_size.x - sum(this.columnsPix);
        const rows_ratio_all    = content_size.y - sum(this.rowsPix);
        assert(0 <= columns_ratio_all && 0 <= rows_ratio_all, `grid:layout: content:${content_size}\n  col:${this.columnsPix.map(x => Math.floor(x))}\n  row:${this.rowsPix.map(x => Math.floor(x))}\n  doc-size:${getDocumentSize()}`);
        const columns_pix = Array.from(this.columns.entries()).map(x => x[1].endsWith("%") ? ratioUI(x[1]) * columns_ratio_all : this.columnsPix[x[0]]);
        const rows_pix    = Array.from(this.rows.entries()).map(x => x[1].endsWith("%") ? ratioUI(x[1]) * rows_ratio_all : this.rowsPix[x[0]]);

        const column_pos : number[] = [0];
        columns_pix.forEach(x => column_pos.push( last(column_pos) + x ));

        const row_pos : number[] = [0];
        rows_pix.forEach(x => row_pos.push( last(row_pos) + x ));

        for(const child of this.absChildren()){
            const x = column_pos[child.colIdx];
            const y = row_pos[child.rowIdx];

            const width  = sum(columns_pix.slice(child.colIdx, child.colIdx + child.getColSpan()));
            const height = sum(rows_pix.slice(child.rowIdx, child.rowIdx + child.getRowSpan()));

            child.layout(new Vec2(x, y), new Vec2(width, height));
        }
    }
}

registerUI(Grid.name, (obj) => new Grid(obj));
