import { assert, msg, MyError, remove } from "@i18n";
import { App, ConstNum, Rational, Term } from "@parser";
import { FormulaMenuEntry, ProofStep } from "./algebra_util";
import { makeProofStepDiv } from "./ProofStep";
import { toTex } from "./tex";


function allMuls(term : Term) : App[] {
    return term.allTerms().filter(x => x.isMul()) as App[];
}

function setSignInMul(root : Term){
    for(const mul of allMuls(root)){
        let val = Rational.one();
        for(const arg of mul.args){
            val.setmul(arg.value);
            arg.value.set(1);
        }

        mul.value.setmul(val);
    }
}

function removeOneInMul(root : Term){
    for(const mul of allMuls(root)){
        const ones = mul.args.filter(x => x instanceof ConstNum && x.isInt() && x.int() == 1);
        if(ones.length != 0){
            for(const one of ones){
                one.remArg();
            }

            if(mul.args.length == 0){
                const one = ConstNum.one();
                mul.replaceTerm(one);
            }
            else if(mul.args.length == 1){
                mul.replaceTerm(mul.getArg(0));
            }
        }
    }
}

export function testCancelCommonFactors(prevStep : ProofStep, target : App) : CancelCommonFactors | undefined {
    const target_cp = target.clone2();

    const div_terms = target_cp.allTerms().filter(x => x.isDiv()) as App[];

    let changed = false;
    for(const div of div_terms){
        let numerators : Term[];
        let denominators : Term[];
        
        const [arg0, arg1] = div.args;
        if(arg0.isMul()){
            numerators = (arg0 as App).args.slice();
        }
        else{
            numerators = [ arg0 ];
        }

        if(arg1.isMul()){
            denominators = (arg1 as App).args.slice();
        }
        else{
            denominators = [ arg1 ];
        }

        const denominatorStridMap = new Map<Term, string>(denominators.map(x => [x, x.strid()]));
        for(const trm0 of numerators.slice()){
            const trm0Strid = trm0.strid();
            const trm1 = denominators.find(x => denominatorStridMap.get(x) == trm0Strid);
            if(trm1 != undefined){
                remove(numerators, trm0);
                remove(denominators, trm1);

                changed = true;
            }
        }

        if(numerators.length == 0 && denominators.length == 0){
            div.replaceTerm( ConstNum.one() );
        }
        else{
            for(const [arg , terms] of [[arg0, numerators], [arg1, denominators]] as [Term,Term[]][] ){
                if(terms.length == 0){
                    arg.replaceTerm(ConstNum.one());
                }
                else if(terms.length == 1){
                    if(arg != terms[0]){
                        assert(arg.isMul());
                        arg.replaceTerm(terms[0]);
                    }
                }
                else{
                    assert(arg.isMul());
                    (arg as App).clearArgs();
                    (arg as App).addArgs(terms);
                }
            }
        }
    }

    if(changed){
        return new CancelCommonFactors(prevStep, target, target_cp);
    }
    else{
        return undefined;
    }
}

export class CancelCommonFactors extends ProofStep {
    target : Term;

    constructor(prevStep : ProofStep, target : Term, result : App){
        super(prevStep);
        this.target = target;

        this.result = result;
        prevStep.proof.formula.theorem.setRefVars(this.result);
    }

    applyProofStep() : void {
        if(this.prevStep == undefined || this.prevStep.proof == undefined){
            throw new MyError();
        }

        this.prevStep.proof.addProofStep(this);
        msg(`Cancel-Common-Factors`);

        makeProofStepDiv(this.prevStep.proof.proofContent, this);

    }

    toString() : string {
        return `@ ${this.target}, #CancelCommonFactors, ${this.result} \n`;
    }
}

export function SearchSimplifier(step : ProofStep, items: FormulaMenuEntry[]){
    const result = step.getResult();
    if(result instanceof App){

        const cancelCommonFactors = testCancelCommonFactors(step, result);
        if(cancelCommonFactors != undefined){
            items.push({
                type:"action",
                step : cancelCommonFactors,
                name : cancelCommonFactors.constructor.name,
                latex: toTex(cancelCommonFactors.result!)
            })
        }
    }
}

export function simplifyNew(root : Term){
    setSignInMul(root);
    removeOneInMul(root);
}
