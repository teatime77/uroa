import { App, ConstNum, parseMath, RefVar, Term } from "@parser";
import { Grid, GridAttr } from "../../widget/grid";
import { assert, initGrid, msg, MyError, range, Vec2 } from "@i18n";
import { Digit, VariableUI } from "../arithmetic/arithmetic";
import { LabelAttr, registerUI, UI, UIAttr } from "../../widget/core";
import { Label } from "../../widget/text";

function makeTexGrid(uis:UI[]){
    const attr : GridAttr = {
        children : uis,
        rows : "*"
    }

    return new Grid(attr);
}

function makeOprTex(a : string) : Label {
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
            uis2.push(makeOprTex(seperator));
        }

        uis2.push(uis[i]);
    }

    return uis2;
}

function makeAppTex(app : App) : UI {
    const args = app.args.map(x => makeTex(x));
    let uis: UI[] = [];

    switch(app.fncName){
    case "+":
    case "*":{
        uis = joinTex(args, app.fncName);
        break;
    }
    default:
        throw new MyError();
    }

    return makeTexGrid(uis);
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