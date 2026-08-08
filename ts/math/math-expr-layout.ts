///<reference path="../widget/grid.ts" />

import { assert, MyError, Vec2 } from "@i18n";
import { App, Term, ConstNum, RefVar } from "@parser";
import { UIAttr, UI, worldCanvas } from "../widget/core";
import { updateRoot } from "../game_util";
import { MathExprUI } from "../lesson/exercise";
import { ContainerUI } from "../widget/container";
import { Digit, makeOperatorLabel, VariableUI } from "./arithmetic/arithmetic";

export class MathExprLayout extends ContainerUI {
    app : App;
    expandNumberIdx : number = NaN;
    progress : number = NaN;
    widthDiff : number = NaN;

    constructor(data : UIAttr & { children : UI[] }, app : App){
        super(data);
        this.app = app;
    }

    setMinSize() : void {
        this.children.forEach(x => x.setMinSize());
        this.layoutChildren();
        this.setMinSizeByChildren();
    }

    layoutChildren(){
        let x = 0;
        for(const [idx, child] of this.children.entries()){

            child.setPosition(Vec2.fromXY(x, 0));

            if(!isNaN(this.progress) && this.expandNumberIdx == idx){
                x += this.widthDiff * this.progress;
            }
            else{
                x += child.netSize.x;
            }
        }
        const width  = Math.max(...this.children.map(x => x.getRight()));

        this.children.forEach(x => x.updateLayout());
    }

    expandDigit(digit : Digit, progress : number){
        if(progress == 0){

            this.expandNumberIdx = this.children.indexOf(digit);
            assert(this.expandNumberIdx != -1);

            const child_digits = digit.splitDigitPlaceValues();     
            
            const expr = child_digits.flatMap((x, i) => i == 0 ? [x] : [makeOperatorLabel(this.app.fncName), x]);

            this.spliceChildren(this.expandNumberIdx, ...expr);

            expr.forEach(x => x.setMinSize());
            // this.widthDiff = sum(expr.map(x => x.size.x)) - digit.size.x;
            this.widthDiff = digit.netSize.x;
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

export function makeMathExprLayout(expr : Term) : MathExprUI {
    if(expr instanceof ConstNum){
        return new Digit(expr);
    }
    else if(expr instanceof RefVar){
        return new VariableUI(expr);
    }
    else if(expr instanceof App){
        assert(expr.args.length == 2);
        const [arg1, arg2] = expr.args.map(x => makeMathExprLayout(x));
        if(arg2 instanceof Digit && arg2.value.int() < 0 && expr.isAdd()){
            arg2.value.value.changeSign();
            arg2.text = `${arg2.value.int()}`;
            const operator = makeOperatorLabel("-");
            return new MathExprLayout({ children : [arg1, operator, arg2]}, expr);
        }
        else{

            const operator = makeOperatorLabel(expr.fncName);
            return new MathExprLayout({ children : [arg1, operator, arg2]}, expr);
        }
    }
    else{
        throw new MyError();
    }
}
