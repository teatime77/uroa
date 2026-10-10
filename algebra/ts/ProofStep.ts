import { App, ConstNum, parseMath, Parser, RefVar, Term, Variable } from "@parser";
import { Formula, mathLib } from "./formula.js";
import type { PredicateNode, Theorem } from "./formula.js";
import { checkRefVar, matchFormula, SearchMatchFormula } from "./formula_matcher.js";
import { FormulaMenuEntry, ProofStep, putStr } from "./algebra_util";
import { assert, msg, MyError, range } from "@i18n";
import { mathSelection, TexSelection, toTex } from "./tex";
import { Str } from "../../parser/ts/parser.js";
import { simplifyNew } from "./manipulation.js";

function parthFormulaPath(formulaSsideId: string) : [Theorem, Formula, number] {
    const items = formulaSsideId.split(".");
    assert(items.length == 3 && items[0][0] == "#");
    const [theoremId, tag, sideStr] = items;
    const theorem = mathLib.theorems.get(theoremId.slice(1));
    if(theorem == undefined){
        throw new MyError();
    }

    const formula = theorem.getFormula(tag);
    const predicate = formula.predicate
    if(predicate == undefined){
        throw new MyError();
    }

    const sideIdx = parseInt(sideStr) - 1;
    assert(0 <= sideIdx && sideIdx <= predicate.args.length - 1);

    return [theorem, formula, sideIdx];
}

function makeEqMenu(node:PredicateNode, eq : App) : FormulaMenuEntry[] {
    const items: FormulaMenuEntry[] = [];

    for(const [sideIdx, side] of eq.args.entries()){
        let name : string;

        if(sideIdx == 0){

            name = "左辺をコピー";
        }
        else if(sideIdx == eq.args.length - 1){

            name = "右辺をコピー";
        }
        else{
            name = `第${sideIdx + 1}辺をコピー`;
        }

        items.push({
            type:"action",
            step : new CopySide(node, sideIdx),
            name,
            latex: toTex(side)
        })
    }

    return items;
}

export function makeFormulaMenu(formula : Formula) : FormulaMenuEntry[] {
    const items: FormulaMenuEntry[] = [];

    if(formula.predicate.isEq()){
        const eq = formula.predicate as App;

        items.push(...makeEqMenu(formula, eq) );
    }
    else{
        throw new MyError();
    }

    return items;
}

export function makeProofStepMenu(step : ProofStep) : FormulaMenuEntry[] {
    const items: FormulaMenuEntry[] = [];

    if(step.getResult() instanceof App){
        const app = step.getResult() as App;
        if(app.isEq()){

            return makeEqMenu(step, app)
        }
        else{
            let selectedTerm : Term | undefined;
            if(mathSelection == undefined){
                selectedTerm = app;
            }
            else if(mathSelection != undefined && mathSelection.kind == "node"){
                selectedTerm = mathSelection.selectedTerm;
            }

            if(selectedTerm != undefined){
                const formulaSideIdxes = SearchMatchFormula(selectedTerm);
                for(const [formula, sideIdx, predicate_cp] of formulaSideIdxes){
                    assert(predicate_cp.isEq());
                    checkRefVar(predicate_cp);

                    const otherSideIdxes = range(predicate_cp.args.length).filter(x => x != sideIdx);
                    for(const sideIdx2 of otherSideIdxes){
                        let side2 = predicate_cp.getArg(sideIdx2);
                        const paramDic = new Map<Variable, Term>();
                        const rewrite = new Rewrite(step, selectedTerm, formula, paramDic, sideIdx, predicate_cp, sideIdx2);
                       
                        const params = formula.theorem.params();
                        if(params.length != 0){

                            checkRefVar(side2);
                            side2 = side2.clone2();
                            checkRefVar(side2);
                            simplifyNew(side2);
                            const paramRefs = side2.allIdRefs().filter(x => params.includes(x.refVar!)) as RefVar[];
                            if(paramRefs.length != 0){
                                paramRefs.forEach(x => x.name = "?");
                            }
                        }

                        items.push({
                            type:"action",
                            step : rewrite,
                            name : `${formula.theorem.name}.${formula.tag}`,
                            latex: toTex(side2)
                        })
                    }
                }
            }
        }
    }

    return items;
}

export function makeFormulaDiv(parent:HTMLDivElement, formula: Formula) : HTMLDivElement {
    const expressDiv = document.createElement("div");
    if(formula instanceof Formula){

        putStr(expressDiv, formula.tag);
    }

    new TexSelection(expressDiv, formula);

    parent.appendChild(expressDiv);

    return expressDiv
}

export function makeProofStepDiv(parent:HTMLDivElement, step: ProofStep) : HTMLDivElement {
    step.stepDiv = document.createElement("div");

    new TexSelection(step.stepDiv, step);

    parent.appendChild(step.stepDiv);

    return step.stepDiv
}

export class CopySide extends ProofStep {
    sourceNode : PredicateNode;
    sideIdx : number;

    static makeCopySide(sourceNode : PredicateNode, line: string) : CopySide{
        const parser = new Parser(line.slice(1));
        const terms:Term[] = [];
        parser.readList(terms);
        terms.forEach(x => x.setString());

        assert(terms.length == 2);
        assert(terms[0] instanceof ConstNum);
        const [sideIdx, result] = terms as [ConstNum, Term];

        const step = new CopySide(sourceNode, sideIdx.int() - 1);
        if(`${step.result}` != `${result}`){
            msg(`make-copy-side:[${line}][${step.result}][${result}]`)
            throw new MyError();
        }

        return step;
    }

    constructor(sourceNode : PredicateNode, sideIdx : number){
        super(sourceNode instanceof ProofStep ? sourceNode : undefined);
        this.sourceNode = sourceNode;
        this.sideIdx = sideIdx;

        const eq = this.sourceNode.getResult() as App;
        assert(eq.isEq());
        checkRefVar(eq);

        this.result = eq.getArg(this.sideIdx).clone2();
        simplifyNew(this.result);

        checkRefVar(this.result);
        this.result.setParent(null);
    }

    applyProofStep() : void {
        msg(`apply-copy-side:${this.sourceNode.getNodeDiv().tagName}`);

        if(this.sourceNode instanceof Formula){
            let proof = this.sourceNode.getOpenProof();
            if(proof == undefined){
                proof = this.sourceNode.startProof();
            }
            proof.addProofStep(this);

            const parentDiv = proof.proofContent;
            putStr(parentDiv, "start proof");

            makeProofStepDiv(parentDiv, this);
        }
    }

    toString() : string {
        return `© ${this.sideIdx + 1}, ${this.result}\n`;
    }
}

export class Rewrite extends ProofStep {
    target : Term;
    formula : Formula;
    sideIdx : number;
    predicate_cp : App;
    sideIdx2 : number;
    paramDic : Map<Variable, Term>;

    static makeRewrite(parentFormula : Formula, prevStep : ProofStep, line: string, terms:Term[]) : Rewrite{
        assert(terms.length == 4 || terms.length == 5);
        
        const targetTmp = terms[0];
        const formulaSsideIdRef = terms[1] as RefVar;
        const [theorem, formula, sideIdx] = parthFormulaPath(formulaSsideIdRef.name);

        const paramDic = new Map<Variable, Term>();
        if(terms.length == 5){            
            const paramVals = terms[2] as App;
            terms.splice(2, 1);

            parentFormula.theorem.setRefVars(paramVals);
            checkRefVar(paramVals);

            assert(paramVals instanceof App && paramVals.fncName == "[]" && paramVals.args.length == 1);
            const nameTerm = paramVals.getArg(0) as App;
            assert(nameTerm instanceof App && nameTerm.fncName == "[]" && nameTerm.args.length == 2);
            const [name, term] = nameTerm.args as [Str, Term];
            assert(name instanceof Str);
            const param = theorem.params().find(x => x.name == name.text)!;
            assert(param != undefined);
            msg(`param-name:[${param.name}][${term}]`);
            paramDic.set(param, term);
        }

        assert(terms[2] instanceof ConstNum);
        const sideIdx2 = (terms[2] as ConstNum).int() - 1;
        const result = terms[3];

        const targetTmpStr = targetTmp.strid();
        const targets = prevStep.result!.allTerms().filter(x => x.strid() == targetTmpStr);
        if(targets.length != 1){
            msg(`make-rewrite:[${targetTmpStr}]`);
            prevStep.result!.allTerms().forEach(x => msg(`    [${x}]`));
            throw new MyError();
        }
        const target = targets[0];

        const predicate_cp = matchFormula(target, theorem, paramDic, formula, sideIdx);
        if(predicate_cp == undefined){
            throw new MyError();
        }
        parentFormula.theorem.setRefVars(predicate_cp);

        const step = new Rewrite(prevStep, target, formula, paramDic, sideIdx, predicate_cp, sideIdx2);
        if(`${step.result}` != `${result}`){
            msg(`make-rewrite2:[${line}][${step.result}][${result}]`)
            throw new MyError();
        }

        return step;
    }

    constructor(prevStep : ProofStep, target : Term, formula : Formula, paramDic : Map<Variable, Term>, sideIdx : number, predicate_cp : App, sideIdx2 : number){
        super(prevStep);
        this.target = target;
        this.formula = formula;
        this.paramDic = paramDic;
        this.sideIdx = sideIdx;

        this.predicate_cp = predicate_cp;
        this.sideIdx2 = sideIdx2;

        const [target_root_cp, target_cp] = this.target.cloneRoot();
        
        const side2 = this.predicate_cp.getArg(this.sideIdx2).clone2();
        assert(target_cp.value.isInt() && Math.abs(target_cp.value.int()) == 1);
        if(target_cp.value.int() == -1){
            side2.value.changeSign();
        }

        if(target_root_cp == target_cp){
            this.result = side2;
        }
        else{

            target_cp.replaceTerm(side2);
            this.result = target_root_cp;
        }
        simplifyNew(this.result);

        this.result.setParent(null);
        this.result.setString();
    }

    applyProofStep() : void {
        if(this.prevStep == undefined || this.prevStep.proof == undefined){
            throw new MyError();
        }
        const params = this.formula.theorem.params();
        if(params.length != 0){
            assert(params.length == 1 && this.result != undefined);
            const paramRefs = this.result!.allTerms().filter(x => x instanceof RefVar && params.includes(x.refVar!));
            if(paramRefs.length != 0){

                const s = window.prompt("Input the expression");
                if(s == null || s.trim() == ""){
                    return;
                }
                const term = parseMath(s);
                for(const refvar of paramRefs){
                    refvar.replaceTerm(term.clone());
                }
            }
        }
        this.prevStep.proof.addProofStep(this);
        msg(`apply rewrite`);

        makeProofStepDiv(this.prevStep.proof.proofContent, this);
    }

    toString() : string {
        if(this.paramDic.size != 0){
            const paramStr = "[" + Array.from(this.paramDic.entries()).map(([va,x],i) => `["${va.name}", ${x}]`).join(", ") + "]";
            return `@ ${this.target}, #${this.formula.theorem.name}.${this.formula.tag}.${this.sideIdx + 1}, ${paramStr}, ${this.sideIdx2 + 1}, ${this.result} \n`;
        }
        else{

            return `@ ${this.target}, #${this.formula.theorem.name}.${this.formula.tag}.${this.sideIdx + 1}, ${this.sideIdx2 + 1}, ${this.result} \n`;
        }
    }
}

