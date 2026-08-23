import { App, ConstNum, parseMath, parseMathDetachFactor, Rational, RefVar, Term } from "@parser";
import { Grid, GridAttr } from "../../widget/grid";
import { assert, initGrid, msg, MyError, range, Vec2 } from "@i18n";
import { Digit, VariableUI } from "../arithmetic/arithmetic";
import { LabelAttr, registerUI, UI, UIAttr } from "../../widget/core";
import { Label } from "../../widget/text";

export interface TermTex {
    getTerm() : Rational | Term;
}

class LabelTex extends Label implements TermTex {  
    term:Rational | Term;

    constructor(term:Rational | Term, data : LabelAttr){
        super(data);
        this.term = term;
    }  

    getTerm() : Rational | Term {
        return this.term;
    }
}

class TmpTex extends Label implements TermTex {  
    term:Rational | Term;

    constructor(term:Rational | Term, data : LabelAttr){
        super(data);
        this.term = term;
    }  

    getTerm() : Rational | Term {
        return this.term;
    }
}

class GridTex extends Grid implements TermTex {
    term : Term;

    constructor(term : Term, data : GridAttr) {
        super(data);
        this.term = term;
    }

    getTerm() : Rational | Term {
        return this.term;
    }
}

export type MathTex = LabelTex | TmpTex | GridTex;

export function selectTerms(selectedUIs: UI[]){
    if(! selectedUIs.every(x => x instanceof LabelTex || x instanceof GridTex || x instanceof Digit || x instanceof TmpTex || x instanceof VariableUI)){
        assert(false);
        return;
    }

    const terms = selectedUIs.filter(x => !(x instanceof TmpTex)).map(x => x.getTerm());
    msg("selected:" + terms.map(x => `${x}`). join(" | "));
}

function rowTex(term : Term, uis:UI[]){
    const attr : GridAttr = {
        children : uis,
        rows : "*"
    }

    return new GridTex(term, attr);
}

function columnTex(term : Term, uis:UI[]){
    const attr : GridAttr = {
        children : uis,
        columns : "*"
    }

    return new GridTex(term, attr);
}

function intTex(value:Rational) : LabelTex {
    const n = value.int();
    assert(n == Math.floor(n));

    const attr : LabelAttr = {
        text : `${n}`,
        padding: 0
    };

    return new LabelTex(value, attr);
}

function labelTex(term:Rational | Term, a : string) : LabelTex {
    const attr : LabelAttr = {
        text : a,
        padding: 0
    };

    return new LabelTex(term, attr);
}

function tmpTex(term:Rational | Term, a : string) : LabelTex {
    const attr : LabelAttr = {
        text : a,
        padding: 0
    };

    return new TmpTex(term, attr);
}

function oprTex(term:Rational | Term, a : string) : LabelTex {
    const attr : LabelAttr = {
        text : a,
        padding: 0
    };

    return new LabelTex(term, attr);
}

function joinTex(app: App) : UI[]{
    const argUIs = app.args.map(x => makeTex(x));

    const uis2 : UI[] = [];
    for(const i of range(argUIs.length)){
        if(i != 0){
            uis2.push(tmpTex(app.fnc, app.fncName));
        }

        uis2.push(argUIs[i]);
    }

    return uis2;
}

function appendValue(term:Term, ui : UI) : UI {
    if(term.isValueOne()){
        return ui;
    }

    if(term.value.isInt()){
        const uis : UI[] = [
            intTex(term.value),
            tmpTex(term.value, "・"),
            ui
        ]

        return rowTex(term, uis);
    }

    throw new MyError();
}

function makeSumTex(app: App) : UI {
    const symbolUI = labelTex(app.fnc, app.fncName);
    const targetUI = makeTex(app.args[0]);
    const varUI = makeTex(app.args[1]);
    const domain = app.args[2];

    let headUI : UI;
    if(domain instanceof App && domain.fncName == ".."){
        const fromUI = makeTex(domain.args[0]);
        const toUI = makeTex(domain.args[1]);

        const subUI = rowTex(app, [varUI, tmpTex(app, "="), fromUI ]);
        headUI = columnTex(app, [toUI, symbolUI, subUI])
    }
    else{
        const domainUI = makeTex(domain);
        const subUI = rowTex(app, [varUI, tmpTex(app, "∈"), domainUI ]);
        headUI = columnTex(app, [symbolUI, subUI])
    }

    return rowTex(app, [headUI, targetUI]);
}

function makeAppTexRaw(app : App) : UI {
    if(app.fncName == "sum"){
        return makeSumTex(app);
    }

    switch(app.fncName){
    case "+":
    case "*":
    case "=":
    case "..":{
        return rowTex(app, joinTex(app));
    }
    case "^":
        return rowTex(app, joinTex(app));

    default:
        throw new MyError();
    }
}

function makeAppTex(app : App) : UI {
    return appendValue(app, makeAppTexRaw(app));
}
    
export function makeTex(expr : Term) : UI {
    if(expr instanceof ConstNum){
        return new Digit(expr);
    }
    else if(expr instanceof RefVar){
        return new VariableUI(expr);
    }
    else if(expr instanceof App){
        return makeAppTex(expr);
    }
    else{
        throw new MyError();
    }
}


export class ProofUI extends Grid {
    constructor(data : GridAttr, app : App){
        super(data);
        
        const ui = makeTex(app);
        this.addChildren(ui);
        initGrid(this, data.columns, data.rows);
    }

    setMinSize() : void {
        super.setMinSize();
    }

    layout(position : Vec2, size : Vec2) : void {
        super.layout(position, size);
    }

}

registerUI(ProofUI.name, (data : GridAttr & { expr: string }) => {
    data.columns = "*";
    const app = parseMathDetachFactor(data.expr) as App;
    assert(app instanceof App);
    return new ProofUI(data, app);
});

msg("Loaded equation");