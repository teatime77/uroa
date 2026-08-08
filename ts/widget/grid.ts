///<reference path="container.ts" />

import { assert, msg, sum, last, Vec2, IGrid, AbstractUI } from "@i18n";
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

    static singleRow(data : UIAttr, ...children : UI[]) : GridAttr {
        const grid_data : GridAttr = Object.assign(
            data,
            {
                columns  : Grid.autoSize(children.length),
                rows     : "*",
                children
            }
        );

        return grid_data;
    }

    static pix(s : string) : number {
        assert(s.endsWith("px"));
        return parseFloat(s.slice(0, -2));
    }

    static ratio(s: string) : number {
        assert(s.endsWith("%"));
        return parseFloat(s.slice(0, -1)) / 100;
    }

    static pixSum(pixes : string[]) : number {
        const pix_nums = pixes.map(x => Grid.pix(x));
        return sum(pix_nums);
    }

    static ratioSum(ratioes : string[]) : number {
        const pix_nums = ratioes.map(x => Grid.ratio(x));
        return sum(pix_nums);
    }

    static minTotalSize(columns : string[], pix_sum : number, min_size : number) : number {
        const ratio_columns = columns.filter(x => x.endsWith("%"));
        if(ratio_columns.length == 0){
            return 0;
        }

        const ratio_sum = Grid.ratioSum(ratio_columns);

        if(min_size < pix_sum){
            return 0;
        }

        const ratio_pix = min_size - pix_sum;

        // grid-width * ratio_sum = ratio_pix
        return ratio_pix / ratio_sum;
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

    getColumnsPix(){
        const pix_columns = new Array(this.numCols).fill(0) as number[];

        for(const [col_idx, col] of this.columns.entries()){
            if(col.endsWith("px")){
                pix_columns[col_idx] = Grid.pix(col);
            }
            else if(col == "*"){
                const col_children = this.absChildren().filter(x => x.colIdx == col_idx && x.getColSpan() == 1);
                pix_columns[col_idx] = col_children.length > 0 ? Math.max(...col_children.map(x => x.minSize.x)) : 0;
            }
        }

        return pix_columns;
    }

    absChildren() : AbstractUI[] {
        return this.children;
    }

    getRowsPix(){
        const pix_rows = new Array(this.numRows).fill(0) as number[];

        for(const [row_idx, row] of this.rows.entries()){
            if(row.endsWith("px")){
                pix_rows[row_idx] = Grid.pix(row);
            }
            else if(row == "*"){
                const row_children = this.absChildren().filter(x => x.rowIdx == row_idx && x.getRowSpan() == 1);
                pix_rows[row_idx] = row_children.length > 0 ? Math.max(...row_children.map(x => x.minSize.y)) : 0;
            }
        }

        return pix_rows;
    }

    setMinSize() : void {
        assert(!isNaN(this.numCols) && !isNaN(this.numRows));

        this.absChildren().forEach(x => x.setMinSize());

        if(this.fixedSize !== undefined){

            this.minSize.copyFrom(this.fixedSize);
        }
        else{

            const padding_border_size = this.getPaddingBorderSize();

            let max_grid_ratio_width  = 0;
            let max_grid_ratio_height = 0;

            this.columnsPix = this.getColumnsPix();
            this.rowsPix    = this.getRowsPix();

            for(const child of this.absChildren()){
                const columns = this.columns.slice(child.colIdx, child.colIdx + child.getColSpan());
                const pix_col_sum = sum(this.columnsPix.slice(child.colIdx, child.colIdx + child.getColSpan()));
                max_grid_ratio_width = Math.max(max_grid_ratio_width, Grid.minTotalSize(columns, pix_col_sum, child.minSize.x));

                const rows = this.rows.slice(child.rowIdx, child.rowIdx + child.getRowSpan());
                const pix_row_sum = sum(this.rowsPix.slice(child.rowIdx, child.rowIdx + child.getRowSpan()));
                max_grid_ratio_height = Math.max(max_grid_ratio_height, Grid.minTotalSize(rows, pix_row_sum, child.minSize.y));
            }

            const grid_pix_width  = sum(this.columnsPix);
            const grid_pix_height = sum(this.rowsPix);

            this.minSize.x = grid_pix_width  + max_grid_ratio_width  + padding_border_size.x;
            this.minSize.y = grid_pix_height + max_grid_ratio_height + padding_border_size.y;
        }

        this.size.copyFrom(this.minSize);
    }

    layout(position : Vec2, size : Vec2) : void {
        super.layout(position, size);

        const content_size = this.getContentSize();
        const columns_ratio_all = content_size.x - sum(this.columnsPix);
        const rows_ratio_all    = content_size.y - sum(this.rowsPix);
        assert(0 <= columns_ratio_all && 0 <= rows_ratio_all, `grid:layout: content:${content_size}\n  col:${this.columnsPix.map(x => Math.floor(x))}\n  row:${this.rowsPix.map(x => Math.floor(x))}\n  doc-size:${getDocumentSize()}`);
        const columns_pix = Array.from(this.columns.entries()).map(x => x[1].endsWith("%") ? Grid.ratio(x[1]) * columns_ratio_all : this.columnsPix[x[0]]);
        const rows_pix    = Array.from(this.rows.entries()).map(x => x[1].endsWith("%") ? Grid.ratio(x[1]) * rows_ratio_all : this.rowsPix[x[0]]);

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
