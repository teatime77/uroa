import { makeAdd, makeEq, initHashTerm, setHashTerm, makeMul, makeDiv } from "./algebra_util.js";
import { App, Term, renderKatexSub, ConstNum, RefVar } from '@parser';
import { MyError, check, assert, range, sleep, Speech } from '@i18n';

export async function transpose(root : App, term : Term, div : HTMLDivElement, speech : Speech, add_to_end : boolean = true, show_progress : boolean = true){
    assert(root.isEq() && root.args.length == 2);

    const origin_idx = range(2).find(i => root.args[i].includesTerm(term))!;
    assert(origin_idx != undefined);

    const destination_idx = 1 - origin_idx;
    
    const [origin, destination] = [origin_idx, destination_idx].map(i => root.args[i]);

    if(show_progress){
        term.canceled = true;
        renderKatexSub(div, root.tex());
        await sleep(1000);
        term.canceled = true;
    }

    if(origin == term){
        root.setArg(ConstNum.zero(), origin_idx);
    }
    else if(origin.isAdd()){
        assert(term.parent == origin);
        term.remArg();
    }
    else{
        throw new MyError();
    }

    term.changeSign();
    
    if(destination.isAdd()){
        const add = destination as App;
        if(add_to_end){
            add.addArg(term);
        }
        else{
            add.insArg(term, 0);
        }
    }
    else {

        const args = (add_to_end ? [destination, term] : [term, destination])
        const add = makeAdd(args);
        root.setArg(add, destination_idx);
    }
}

export async function addEquations(sides_arg : Term[], divs : HTMLDivElement[], speech : Speech) {
    const sides : Term[] = [];
    for(const [idx, side] of sides_arg.entries()){
        if(side.parent == null || !side.parent.isEq()){
            throw new MyError();
        }

        const [equation, side_cp] = side.cloneRoot();
        sides.push(side_cp);
    }

    const new_sides = [ makeAdd([]), makeAdd([]) ];

    for(const [idx, side1] of sides.entries()){
        if(side1.parent == null || !side1.parent.isEq()){
            throw new MyError();
        }

        const idx1 = side1.parent.args.indexOf(side1);
        check(idx1 != -1);

        const idx2 = 1 - idx1;
        const side2 = side1.parent.args[idx2];

        new_sides[idx1].addArg(side1);
        new_sides[idx2].addArg(side2);

        const eq = sides_arg[idx].parent as App;
        assert(eq.isEq() && eq.parent == null);
        eq.args[idx1].colorName = "blue";
        eq.args[idx2].colorName = "red";
        renderKatexSub(divs[idx], eq.tex());
    }
    await sleep(1000);

    const eq = makeEq(new_sides);
    assert(eq.parent == null);
    eq.setParent(null);
    eq.verifyParent(null);
    
    return eq;
}

function highlightTex(term : Term, ele : HTMLElement){
    term.colorName = "blue";
    renderKatexSub(ele, term.getRoot().tex());
}

export async function substitute(src_arg : Term, dst_arg : Term, src_div : HTMLDivElement, dst_div : HTMLDivElement, speech : Speech) : Promise<App> {
    const [dstRoot, dst] = dst_arg.cloneRoot();
    const srcEq = src_arg.getRoot();
    assert(srcEq.args.length == 2);
    const sideIdx = src_arg.getRootEqSideIdx();
    const src = srcEq.args[sideIdx];

    const expr = srcEq.args[1 - sideIdx].clone();
    expr.value.setdiv(src.value);

    let ok = false;
    if(src instanceof RefVar){
        if(dst instanceof RefVar && src.name == dst.name){
            ok = true;
        }
    }
    else if(src instanceof App){
        if(dst instanceof App){

            const dst_app = dst as App;

            initHashTerm();
            setHashTerm([], src);
            setHashTerm([], dst_app);

            if(src.hash == dst_app.hash){
                // msg(`hash ${src.str2()}[${src.hash.toString(2)}] == ${dst_app.str2()}[${dst_app.hash.toString(2)}]`);
                assert(src.str2() == dst_app.str2());
                ok = true;
            }
            else{
                // msg(`hash ${src.str2()}[${src.hash.toString(2)}] != ${dst_app.str2()}[${dst_app.hash.toString(2)}]`)
            }
        }
        else if(dst.parent instanceof App){
            const dst_app = dst.parent;
            if(src.str2() == dst_app.str2()){
                ok = true;
            }
            else if(src.fncName == dst_app.fncName){
                initHashTerm();
                setHashTerm([], src);
                setHashTerm([], dst_app);
    
                const hashes = dst_app.args.map(x => x.hash);
                const strids = dst_app.args.map(x => x.strid());
                const arg_idxs : number[] = [];
                for(const arg of src.args){
                    const hash  = arg.hash;
                    const strid = arg.strid();
                    const idx = strids.indexOf(strid);
                    if(idx == -1){
                        throw new MyError();
                    }

                    const idx2 = hashes.indexOf(hash);
                    assert(idx2 == idx);
                    // msg(`hash idx ok:[${strid}] ${hash.toString(2)}`);
                    
                    arg_idxs.push(idx);
                    strids[idx] = "";
                    hashes[idx] = -1n;
                }
    
                await highlightTex(src_arg, src_div);

                const dst_arg_app = dst_arg.parent as App;
                arg_idxs.forEach(idx => dst_arg_app.args[idx].colorName = "blue");
                renderKatexSub(dst_div, dst_arg.getRoot().tex());
                await sleep(1000);

                for(const idx of arg_idxs){
                    dst_app.args[idx].remArg();
                }
    
                dst_app.addArg(expr);

                return dstRoot;
            }
        }
    }

    if(ok){
        await highlightTex(src_arg, src_div);
        await highlightTex(dst_arg, dst_div);
        await sleep(1000);
        
        expr.value.setmul(dst.value);
        dst.replaceTerm(expr);

        return dstRoot;
    }

    throw new MyError();
}

export function mulTerm(multiplicand : Term, multiplier : Term) : App {
    let mul : App;

    if(multiplicand.isMul()){
        mul = multiplicand as App;
        mul.addArg(multiplier);
    }
    else{
        mul = makeMul([]);
        multiplicand.replaceTerm(mul);
        mul.addArgs([multiplicand, multiplier]);
    }

    return mul;
}

export async function divideEquation(eq_arg : App, term : Term, div : HTMLDivElement, speech : Speech) : Promise<App> {
    const eq = eq_arg.clone();
    assert(eq.isRootEq());

    const eq_args = eq.args.slice();
    for(const [idx, arg] of eq_args.entries()){
        const term_cp = term.clone();
        if(arg.isDiv()){
            const divisor = arg.divisor();
            mulTerm(divisor, term_cp);
        }
        else{
            const div = makeDiv([]);
            arg.replaceTerm(div);
            div.addArgs([arg, term_cp]);
        }


        eq.args[idx].colorName = "blue";
        renderKatexSub(div, eq.tex());
        await sleep(1000);
    }

    eq.allTerms().forEach(x => x.colorName = undefined);

    return eq;
}
