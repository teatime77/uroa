import { assert, fetchText, msg, MyError } from "@i18n";
import { App, parseMath, Parser, RefVar, Term, Variable } from "@parser";
import { Formula, mathLib, PredicateNode, Theorem, VarDecl } from "./formula.js";
import type { Proof } from "./proof.js";
import { DummyStep, FormulaMenuEntry, ProofStep, putTex, saveData } from "./algebra_util";
import { CopySide, makeFormulaDiv, Rewrite } from "./ProofStep";
import { checkRefVar } from "./formula_matcher.js";
import { CancelCommonFactors, testCancelCommonFactors } from "./manipulation.js";

function splitKeyword(line : string) : [string, string] {
    const k = line.indexOf(" ");
    if(k == -1){
        return [line, ""];
    }
    const keyword = line.slice(0, k);
    const data = line.slice(k + 1).trim();

    return [keyword, data];
}

export const formulaMenuItems: FormulaMenuEntry[] = [
    {
        type: "submenu",
        name: "交換法則",
        items: [
            {
                type: "action",
                step : new DummyStep(),
                name: "加法",
                latex: "b+a",
            },
            {
                type: "action",
                step : new DummyStep(),
                name: "乗法",
                latex: "ba",
            },
        ],
    },

    {
        type: "submenu",
        name: "展開",
        items: [
            {
                type: "action",
                step : new DummyStep(),
                name: "分配法則",
                latex: "ab+ac",
            },
            {
                type: "action",
                step : new DummyStep(),
                name: "平方差",
                latex: "(a+b)(a-b)",
            },
        ],
    },

    {
        type: "action",
        step : new DummyStep(),
        name: "簡約",
        latex: "a",
    },
];

let comments : string[] = [];

function readProofStep(parentFormula : Formula, prevStep : ProofStep, line: string){
    assert(prevStep.result != undefined);
    checkRefVar(prevStep.result!);

    const parser = new Parser(line.slice(1));
    const terms:Term[] = [];
    parser.readList(terms);
    terms.forEach(x => x.setString());
    const s = terms.map(x => `${x}`).join(", ");
    msg(`step-proof:${s}`);
    assert(terms[1] instanceof RefVar);

    const formulaSsideIdRef = terms[1] as RefVar;
    let step : ProofStep | undefined;
    msg(`#${CancelCommonFactors.name}`)
    if(formulaSsideIdRef.name == `#${CancelCommonFactors.name}`){

        assert(terms.length == 3);
        const target = terms[0] as App;
        step = testCancelCommonFactors(prevStep, target);
        if(step == undefined){
            throw new MyError();
        }
    }
    else{
        step = Rewrite.makeRewrite(parentFormula, prevStep, line, terms);
    }
    
    return step;
}

function readProof(formula : Formula, lines:string[], proof : Proof){
    let prevStep : ProofStep | undefined;
    while(lines.length != 0){
        const line = lines.shift()!;
        if(line == ""){
            continue;
        }
        else if(line.startsWith("//")){
            msg(`comment:[${line}]`)
            continue;
        }

        const [keyword, name] = splitKeyword(line);
        switch(keyword){
        case "@":
            if(prevStep == undefined){
                throw new MyError();
            }
            prevStep = readProofStep(formula, prevStep, line);
            break;

        case "©":{
            let sourceNode : PredicateNode;
            if(prevStep == undefined){
                sourceNode = formula;
            }
            else{
                sourceNode = prevStep;
            }

            prevStep = CopySide.makeCopySide(sourceNode, line);
            msg(`[${line}][${prevStep}]`);
            break;
        }

        case "qed":
            return;

        default:
            throw new MyError();
        }
        prevStep.applyProofStep();
    }
}

function readFormula(lines:string[], formula : Formula){
    while(lines.length != 0){
        const line = lines.shift()!;
        if(line == ""){
            continue;
        }
        else if(line.startsWith("//")){
            msg(`comment:[${line}]`);
            comments.push(line);
            continue;
        }

        if(line == "proof"){

            const proof = formula.startProof();

            readProof(formula, lines, proof);
        }
        else{
            lines.unshift(line);
            return;
        }
    }
}

function readVarDecl(theorem:Theorem, keyword: string, line: string){
    const parser = new Parser(line);
    parser.nextToken(keyword);
    const refVars = parser.readIds();

    let type : Term | undefined;
    let init : Term | undefined;

    if(parser.current() == ":"){
        parser.nextToken(":");
        type = parser.ArithmeticExpression();
    }

    if(parser.current() == "="){
        parser.nextToken("=");
        init = parser.ArithmeticExpression();
    }

    const varDecl = new VarDecl(keyword);
    theorem.varDecls.push(varDecl);

    for(const id of refVars){
        const va = new Variable(id.name, type, init);
        id.refVar = va;
        varDecl.vars.push(va);
    }

    const vars = varDecl.vars.map(x => `${x}`).join(", ");
    msg(`${keyword}:[${vars}]`);

}

function readTheorem(lines:string[], theorem : Theorem){
    assert(!mathLib.theorems.has(theorem.name));
    mathLib.theorems.set(theorem.name, theorem);

    while(lines.length != 0){
        const line = lines.shift()!;
        if(line == ""){
            continue;
        }
        else if(line.startsWith("//")){
            msg(`comment:[${line}]`)
            comments.push(line);
            continue;
        }

        const [keyword, name] = splitKeyword(line);

        if(keyword == "let" || keyword == "param"){
            // msg(`let:[${line}]`);

            readVarDecl(theorem, keyword, line);
        }
        else if(keyword == "theorem" || keyword == "law" || keyword == "formula"){
            lines.unshift(line);
            return;
        }
        else{
            const predicate = parseMath(line) as App;

            const formulaDiv = document.createElement("div");
            const formula = new Formula(theorem, predicate, formulaDiv);
            theorem.addFormula(formula);

            makeFormulaDiv(formulaDiv, formula);

            theorem.theoremDiv.appendChild(formulaDiv);

            readFormula(lines, formula);
        }
    }
}

export function parseMathFile(text: string) {
    mathLib.clear();

    const lines = text.replaceAll("\r", "").split('\n').map(x => x.trim());

    comments = [];
    while(lines.length != 0){
        const line = lines.shift()!;
        if(line == ""){
            continue;
        }
        else if(line.startsWith("//")){
            msg(`comment:[${line}]`);
            comments.push(line);
            continue;
        }

        const [keyword, name] = splitKeyword(line);
        if(keyword == "namespace"){
            mathLib.name = line.slice(9).trim();
            msg(`namespace:[${mathLib.name}]`);
        }
        else if(line == "axiom"){
        }
        else if(line == "definition"){
        }
        else{
            if(keyword == "theorem" || keyword == "law" || keyword == "formula"){
                msg(`${keyword}:[${name}]`);
                const theorem = new Theorem(comments, keyword, name);
                comments = [];

                readTheorem(lines, theorem);
            }
            else{
                throw new MyError();
            }
        }
    }
}

export async function testProof(){
    const text = await fetchText("./formula/example.math");
    parseMathFile(text);

    return true;
}

export async function saveProofOutput(){
    await saveData("output.math", mathLib.toString());
}
