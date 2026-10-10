import { assert, msg, MyError } from "@i18n";
import { RefVar, App, Term, ConstNum, isLetter, Variable } from "@parser";
import type { Formula, Theorem } from "./formula.js";
import { mathLib } from "./formula.js";

class FormulaError extends Error {    
}

/**
 * 
 * @param dic 変換辞書
 * @param trm1 フォーカス側の項
 * @param trm2 公式側の項
 */
function matchTerm(dic : Map<Variable, Term>, fdic : Map<string, [App, Term]>, focus: Term, trm1 : Term, trm2 : Term){
    if(trm2 instanceof RefVar){
        // 公式側が変数参照の場合

        if(! isLetter(trm2.name[0])){
            // 公式側が演算子の場合

            if(! trm1.eq(trm2)){
                // 等しくない場合

                throw new FormulaError();
            }
        }
        else{
            // 公式側が変数の場合

            if(trm2.refVar == undefined){
                throw new MyError();
            }

            // 変換値
            const conv = dic.get(trm2.refVar);
    
            if(conv == undefined){
                // 変換値が未定の場合
    
                // 新しい変換値をセットする。
                const trm1_cp = trm1.clone2();

                // 変換値を変数参照の係数で割る。
                trm1_cp.value.setdiv(trm2.value);

                dic.set(trm2.refVar, trm1_cp);
            }
            else{
                // 変換値が既定の場合
    
                if(! trm1.eq(conv)){
                    // 変換値と等しくない場合
    
                    throw new FormulaError();
                }
            }
        }
    }
    else if(trm2 instanceof ConstNum){
        // 定数の場合

        if(! trm1.eq(trm2)){
            // 定数に等しくない場合

            throw new FormulaError();
        }
    }
    else if(trm2 instanceof App){
        // 公式側が関数呼び出しの場合

        if(trm1 instanceof App){
            // フォーカス側が関数呼び出しの場合

            if(trm2.fnc instanceof RefVar && trm2.fnc.isNamedFnc() && trm1.fnc.isOprFnc()){
                // 公式側の関数が変数で、フォーカス側の関数が演算子の場合

                // 変換値
                const conv = fdic.get(trm2.fnc.name);
                if(conv == undefined){
                    // 変換値が未定の場合
        
                    // 新しい変換値をセットする。
                    const trm1_cp = trm1.clone2();
                    fdic.set(trm2.fnc.name, [trm2.clone2(), trm1_cp]);
                }
                else{
                    // 変換値が既定の場合

                    // 公式側の関数呼び出しの文字表記と、変換値を得る。
                    const [trm2_cp, trm1_conv] = conv;

                    if(trm2.eq(trm2_cp)){
                        // 公式側の関数の引数が一致する場合

                        if(! trm1.eq(trm1_conv)){
                            // 変換値と等しくない場合
            
                            throw new FormulaError();
                        }        
                    }
                    else{
                        // 公式側の関数の引数が違う場合
        
                        // 未実装としてエラーにする。
                        throw new FormulaError();
                    }
                }
            }
            else{

                // 関数をマッチさせる。
                matchTerm(dic, fdic, focus, trm1.fnc, trm2.fnc);
    
                if(trm1.args.length != trm2.args.length){
                    // 引数の数が等しくない場合
    
                    throw new FormulaError();
                }
    
                // それぞれの引数をマッチさせる。
                for(const [i, t] of Array.from(trm2.args).entries()){
                    matchTerm(dic, fdic, focus, trm1.args[i], t);
                }

                if(! trm1.value.eq(trm2.value) && trm1 != focus){
                    throw new FormulaError();
                }
            }
        }
        else{
            // 関数呼び出しでない場合

            throw new FormulaError();
        }
    }
    else{
        assert(false);
    }
}

export function substByDic(dic : Map<Variable, Term>, fdic : Map<string, [App, Term]>, predicate_cp : App){
    const all_terms = predicate_cp.allTerms();

    const apps = all_terms.filter(x => x instanceof App && fdic.has(x.fncName)) as App[];
    for(const trm2 of apps){
        const [trm2_cp, trm1_conv] = fdic.get(trm2.fncName)!;
        if(trm2.equal(trm2_cp)){
            // 公式側の関数呼び出しと一致する場合

            assert(trm1_conv != undefined);
            trm2.replaceTerm(trm1_conv.clone2());
        }
        else{
            // 公式側の関数呼び出し違う場合

            // 未実装としてエラーにする。
            throw new FormulaError();
        }
    }

    const refs = all_terms.filter(x => x instanceof RefVar && isLetter(x.name)) as RefVar[];
    for(const ref of refs){
        if(ref.refVar == undefined){
            throw new MyError();
        }

        if(dic.has(ref.refVar)){

            const trm = dic.get(ref.refVar)!.clone2();

            // 変換値に変数参照の係数をかける。
            trm.value.setmul(ref.value);

            // 変数参照を変換値で置き換える。
            ref.replaceTerm(trm);
        }
    }
}

export function checkRefVar(term : Term){
    let refs = term.allIdRefs().filter(x => x.refVar == undefined);
    if(refs.length != 0){
        term.setString();
        msg(`ref-var err:[${term.cachedString}]`);
        for(const r of refs){
            msg(`    ref:${r.name}`);
        }
        throw new MyError();
    }
}

export function matchFormula(target : Term, theorem:Theorem, paramDic:Map<Variable, Term>, formula: Formula, sideIdx : number) : App | undefined {
    checkRefVar(target);
    checkRefVar(formula.predicate);

    assert(formula.predicate.isEq());
    const side = formula.predicate.args[sideIdx];
    if(target instanceof App && side instanceof App){
        if(target.fncName == side.fncName && target.args.length == side.args.length){

            const [predicate_cp, side_cp] = side.cloneRoot() as [App, App];
            formula.theorem.setRefVars(predicate_cp);
            checkRefVar(predicate_cp)

            const dic = new Map<Variable, Term>(paramDic);
            const fdic = new Map<string, [App, Term]>();

            Array.from(dic.values()).flat().forEach(x => checkRefVar(x));

            try{
                matchTerm(dic, fdic, target, target, side_cp);
                for(const [app,trm] of fdic.values()){
                    checkRefVar(app);
                    checkRefVar(trm);
                }

                Array.from(dic.values()).flat().forEach(x => checkRefVar(x));

                checkRefVar(predicate_cp)
                substByDic(dic, fdic, predicate_cp);
                predicate_cp.setString();

                checkRefVar(predicate_cp);

                msg(`form : OK ${target} F:${predicate_cp}`);

                return predicate_cp;
            }
            catch(e){
                if(e instanceof FormulaError){

                    msg(`form : NG ${target.str()}`);
                }
                else{
                    assert(false);
                }
            }
        }
    }

    return undefined;
}

export function SearchMatchFormula(target : Term) : [Formula, number, App][] {
    const formulaSideIdxes :[Formula, number, App][] = [];

    for(const [name, theorem] of mathLib.theorems.entries()){
        const paramDic = new Map<Variable, Term>();
        for(const [id, formula] of theorem.formulas.entries()){
            if(formula.predicate.isEq()){
                const eq = formula.predicate as App;
                for(const [sideIdx, side] of eq.args.entries()){
                    const predicate_cp = matchFormula(target, theorem, paramDic, formula, sideIdx);
                    if(predicate_cp != undefined){

                        formulaSideIdxes.push([formula, sideIdx, predicate_cp]);
                    }
                }
            }
        }
    }

    return formulaSideIdxes;
}
