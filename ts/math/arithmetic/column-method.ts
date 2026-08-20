///<reference path="../../widget/grid.ts" />
///<reference path="../../widget/text.ts" />

import { assert, sum, Vec2 } from "@i18n";
import { App, ConstNum, parseMath, parseMathDetachFactor } from "@parser";
import { registerUI, UIAttr, worldCanvas } from "../../widget/core";
import { updateRoot } from "../../game_util";
import { ContainerUI } from "../../widget/container";
import { Label } from "../../widget/text";
import { NumberUI, makeOperatorLabel } from "./arithmetic";

export class ColumnArithmetic extends ContainerUI {
    expr : App;
    nums : NumberUI[];
    operator : Label;

    expandNumberIdx : number = NaN;
    progress : number = NaN;
    heightDiff : number = NaN;

    constructor(data : UIAttr, app : App){
        super(data);

        this.expr = app;
        assert(this.expr.args.every(x => x instanceof ConstNum));

        this.nums = this.expr.args.map(arg => new NumberUI(arg as ConstNum));
        this.operator = makeOperatorLabel(this.expr.fncName);

        this.addChildren(...this.nums, this.operator);
    }

    setMinSize() : void {
        this.children.forEach(x => x.setMinSize());
        this.layoutChildren();
        this.setMinSizeByChildren();
    }

    setMinSizeByChildren() : void {
        const padding_border_size = this.getPaddingBorderSize();

        const width  = this.operator.netSize.x + Math.max(...this.nums.map(x => x.netSize.x));
        const height = Math.max(...this.nums.map(x => x.position.y + x.netSize.y));

        this.minSize.x = width  + padding_border_size.x;
        this.minSize.y = height + padding_border_size.y;

        this.netSize.copyFrom(this.minSize);
    }

    layout(position : Vec2, size : Vec2) : void {
        this.layoutByRightBottom();
        this.position.copyFrom(position);
    }

    layoutChildren() : void {
        let y = 0;

        const maxNumWidth = Math.max(...this.nums.map(n => n.netSize.x));        
        const contentWidth = this.operator.netSize.x + maxNumWidth;
        for(const [row, num] of this.nums.entries()){
            const x = contentWidth - num.netSize.x;

            num.setPosition(Vec2.fromXY(x, y));

            if(row == this.nums.length - 1){

                this.operator.setPosition(Vec2.fromXY(0, y));
                break;
            }

            if(!isNaN(this.progress) && this.expandNumberIdx == row){
                y += this.heightDiff * this.progress;
                // msg(`diff y ${row} diff:${this.heightDiff} prog:${this.progress}`)
            }
            else{
                y += num.netSize.y;
            }
        }

        this.children.forEach(x => x.updateLayout());
    }

    expandNumber(num : NumberUI, progress : number){
        if(progress == 0){

            this.expandNumberIdx = this.nums.indexOf(num);
            assert(this.expandNumberIdx != -1);

            const child_nums = num.splitNumberPlaceValues();        

            this.nums.splice(this.expandNumberIdx, 1, ...child_nums);

            this.children = [];
            this.addChildren(...this.nums, this.operator);

            child_nums.forEach(x => x.setMinSize());
            this.heightDiff = sum(child_nums.map(x => x.netSize.y)) - num.netSize.y;
        }
        else if(1 < progress){

            this.progress = NaN;
            updateRoot(this);
            return;
        }

        this.progress = progress;

        this.setMinSize();
        this.updateLayout();
        worldCanvas.requestUpdateCanvas();
    }
}

registerUI(ColumnArithmetic.name, (data) => {
    const app = parseMathDetachFactor((data as (UIAttr & { expr: string })).expr ) as App;
    assert(app instanceof App);
    return new ColumnArithmetic(data as UIAttr, app);
});




