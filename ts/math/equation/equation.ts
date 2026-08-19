import { App, ConstNum, parseMath, RefVar, Term } from "@parser";
import { Grid, GridAttr } from "../../widget/grid";
import { assert, initGrid, msg, MyError, range, Vec2 } from "@i18n";
import { Digit, VariableUI } from "../arithmetic/arithmetic";
import { LabelAttr, registerUI, UI, UIAttr } from "../../widget/core";
import { Label } from "../../widget/text";

function rowTex(uis:UI[]){
    const attr : GridAttr = {
        children : uis,
        rows : "*"
    }

    return new Grid(attr);
}

function columnTex(uis:UI[]){
    const attr : GridAttr = {
        children : uis,
        columns : "*"
    }

    return new Grid(attr);
}

function intTex(n : number) : Label {
    assert(n == Math.floor(n));

    const attr : LabelAttr = {
        text : `${n}`,
        padding: 0
    };

    return new Label(attr);
}

function oprTex(a : string) : Label {
    const attr : LabelAttr = {
        text : a,
        padding: 0
    };

    return new Label(attr);
}

function joinTex(uis:UI[], seperator:string) : UI[]{
    const uis2 : UI[] = [];
    for(const i of range(uis.length)){
        if(i != 0){
            uis2.push(oprTex(seperator));
        }

        uis2.push(uis[i]);
    }

    return uis2;
}

function appendValue(term:Term, ui : UI) : UI {
    if(term.isValueOne()){
        return ui;
    }

    if(term.value.isInt()){
        const uis : UI[] = [
            intTex(term.value.int()),
            oprTex("・"),
            ui
        ]

        return rowTex(uis);
    }

    throw new MyError();
}

function makeSumTex(app: App) : UI {
    const symbolUI = oprTex(app.fncName);
    const targetUI = makeTex(app.args[0]);
    const varUI = makeTex(app.args[1]);
    const domain = app.args[2];

    let headUI : UI;
    if(domain instanceof App && domain.fncName == ".."){
        const fromUI = makeTex(domain.args[0]);
        const toUI = makeTex(domain.args[1]);

        const subUI = rowTex([varUI, oprTex("="), fromUI ]);
        headUI = columnTex([toUI, symbolUI, subUI])
    }
    else{
        const domainUI = makeTex(domain);
        const subUI = rowTex([varUI, oprTex("∈"), domainUI ]);
        headUI = columnTex([symbolUI, subUI])
    }

    return rowTex([headUI, targetUI]);
}

function makeAppTexRaw(app : App) : UI {
    if(app.fncName == "sum"){
        return makeSumTex(app);
    }

    const args = app.args.map(x => makeTex(x));
    let uis: UI[] = [];

    switch(app.fncName){
    case "+":
    case "*":
    case "=":
    case "..":{
        return rowTex(joinTex(args, app.fncName));
    }
    case "^":
        return rowTex(joinTex(args, app.fncName));

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
    const app = parseMath(data.expr) as App;
    assert(app instanceof App);
    return new ProofUI(data, app);
});

msg("Loaded equation");