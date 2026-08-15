///<reference path="../../widget/grid.ts" />
///<reference path="../../widget/text.ts" />

import { assert, MyError, msg, setRowColIdxOfChildren } from "@i18n";
import { Term, ConstNum, RefVar, parseMath, App } from "@parser";
import { Action, ActionAttr } from "../../action/action";
import { MathExprUI } from "../../lesson/exercise";
import { UI, TextUIAttr, UIAttr, registerAction, registerUI } from "../../widget/core";
import { Grid, GridAttr } from "../../widget/grid";
import { Label } from "../../widget/text";
import { makeMathExprLayout, MathExprLayout } from "../math-expr-layout";
import { ColumnArithmetic } from "./column-method";
import { ImageExpr, makeImageExprFromTerm } from "./image";

export const digitSize = 60;

export const termToUIs : Map<Term, UI[]> = new Map<Term, UI[]>();

export function addTermToUIs(term : Term, ui : UI){
    let uis = termToUIs.get(term);
    if(uis == undefined){
        uis = [ui];
        termToUIs.set(term, uis);
    }
    else{
        assert(!uis.includes(ui));
        uis.push(ui);
    }
    // msg(`term:${term} uis:[${uis.map(x => x.constructor.name)}]`);
}

function getDigitCount(n: number): number {
    assert(0 <= n && Math.floor(n) == n);
    return n.toString().length;
}

function splitDigits(n: number): number[] {
     return n.toString().split('').map(Number);
}

function toExpandedForm(n: number): number[] {
    const s = n.toString();
    return s.split('')
        .map((digit, i) => Number(digit) * Math.pow(10, s.length - i - 1))
        .filter(val => val !== 0); // 0の位を除去
}

const entries: [string, string][] = [
    [ "+", "＋" ],
    [ "-", "－" ],
    [ "*", "×" ],
    [ "/", "÷" ]
];

const myMap = new Map<string, string>(entries);

export function arithmeticOperator(operator : string){
    const ret = myMap.get(operator);
    return ret == undefined ? operator : ret;
}

export function makeOperatorLabel(operator : string) : Label {
    return new Label({text : arithmeticOperator(operator), size : [digitSize, digitSize] });
}

export class Digit extends Label {
    value : ConstNum;

    constructor(term  : ConstNum){
        const data : TextUIAttr = {
            text : `${term.int()}`,
            size : [digitSize, digitSize]
            // padding : 0,
            // borderWidth : 0
        };
        super(data);
        this.value = term;

        addTermToUIs(term, this);
    }

    splitDigitPlaceValues() : Digit[] {
        const values = toExpandedForm(this.value.int());
        const digits = values.map(n => new Digit(new ConstNum(n) ));

        return digits;
    }

    toString() : string {
        return `${super.toString()} ${typeof this.value == "number" ? this.value : this.value.toString()}`;
    }
}

export class NumberUI extends Grid {
    value  : ConstNum;
    digits : Digit[];

    constructor(value  : ConstNum){
        const nums = splitDigits(value.int());
        
        const grid_data : GridAttr ={
            columns  : Grid.autoSize(nums.length),
            rows     : "*"
        };

        super(grid_data);

        this.value = value;
        this.digits = nums.map(n => new Digit(new ConstNum(n)));
        this.addChildren(...this.digits);
        setRowColIdxOfChildren(this);        

        addTermToUIs(value, this);
    }

    splitNumberPlaceValues() : NumberUI[] {
        const values = toExpandedForm(this.value.int());
        const nums = values.map(n => new NumberUI(new ConstNum(n) ));

        return nums;
    }
}


export class VariableUI extends Label {
    value : RefVar;

    constructor(term  : RefVar){
        const data : TextUIAttr = {
            text : `${term.name == "ans" ? "❓" : term.name}`,
            size : [ term.name.length * digitSize, digitSize ]
        };
        super(data);
        this.value = term;

        addTermToUIs(term, this);
    }

    toString() : string {
        return `${super.toString()} ${this.value.name}`;
    }
}

export class ArithmeticView extends Grid {
    static arithmeticViews : ArithmeticView[] = [];

    term : Term;
    imageView : ImageExpr;
    mathExpr  : MathExprUI;
    columnArithmetic : ColumnArithmetic;

    constructor(data : UIAttr & { expr : string }){
        const grid_data : GridAttr = Object.assign(
            data,
            {
                columns  : "*",
                rows     : "* * *"
            }
        );
        super(grid_data);
        ArithmeticView.arithmeticViews.push(this);

        this.term = parseMath(data.expr, true);

        this.imageView = makeImageExprFromTerm(this.term);
        this.mathExpr  = makeMathExprLayout(this.term);
        if(this.term instanceof App){

            this.columnArithmetic = new ColumnArithmetic(data, this.term);
        }
        else{
            throw new MyError();
        }

        this.addChildren(this.imageView, this.mathExpr, this.columnArithmetic);

        setRowColIdxOfChildren(this);
    }
}

registerUI(ArithmeticView.name, (obj) => new ArithmeticView(obj));

export class ArithmeticAction extends Action {
    static one : ArithmeticAction;
    arithmeticView : ArithmeticView;
    target : Term;
    argIdx : number;

    constructor(data : ActionAttr){  
        super(data);
        ArithmeticAction.one = this;
        msg(`arithmetic-Views:${ArithmeticView.arithmeticViews.length}`);

        const viewIdx = data.args.viewIdx;
        this.argIdx   = data.args.argIdx;
        assert(typeof viewIdx == "number" && viewIdx < ArithmeticView.arithmeticViews.length);


        this.arithmeticView = ArithmeticView.arithmeticViews[viewIdx];
        this.target = this.arithmeticView.term;
    }

    *exec() : Generator<any> {
        this.finished = false;

        if(this.target instanceof App && this.target.args[0] instanceof ConstNum){
        }
        else{
            throw new MyError();
        }

        assert(typeof this.argIdx == "number" && this.argIdx < this.target.args.length);

        const num = this.target.args[this.argIdx];
        const targetArg0UIs = termToUIs.get(num);
        if(targetArg0UIs == undefined){
            throw new MyError();
        }
        msg(`exec [${targetArg0UIs.map(x => x.toString() + ":" + x.parent!.toString()).join(", ")}] column:${this.arithmeticView.columnArithmetic.toString()}`);

        const roots = Array.from(new Set<UI>(targetArg0UIs.map(x => x.getStageRoot())));
        for(let progress : number = 0; ; progress += 0.01){

            for(const ui of targetArg0UIs){
                if(ui instanceof NumberUI && ui.parent instanceof ColumnArithmetic){
                    ui.parent.expandNumber(ui, progress);
                }
                else if(ui instanceof Digit && ui.parent instanceof MathExprLayout){
                    ui.parent.expandDigit(ui, progress);
                }
            }

            roots.forEach(x => x.setMinSizeUpdateLayout());

            if(1 < progress){

                break;
            }

            yield `expand number ${progress}`;
        }

        this.finished = true;
        return `expand number end`;

    }

}


registerAction(ArithmeticAction.name, (obj) => new ArithmeticAction(obj));



export abstract class BasicArithmetic extends Grid {

}

export class SingleDigitArithmetic extends BasicArithmetic {    
}

/*
abstract class ArithmeticTerm {
}

abstract class ArithmeticExpression extends ArithmeticTerm {
    args : number[] = [];
}

class AdditionExpression extends ArithmeticExpression {
    readonly symbol = '+';
}

class SubtractionExpression extends ArithmeticExpression {
    readonly symbol = '-';
}

class MultiplicationExpression extends ArithmeticExpression {
    readonly symbol = '×';
}

class DivisionExpression extends ArithmeticExpression {
    readonly symbol = '÷';
}
*/
