import { Speech, sleep, assert, remove } from "@i18n";
import { Term, App, ConstNum, renderKatexSub } from "@parser";

async function sleepAlgebra(){
    await sleep(200);
}

/*
    x * c1 * c2 * y = (c1*c2) ・ x * y
*/
async function simplifyConstNumMultiplier(speech : Speech, ele : HTMLElement, root : Term){
    // 引数に定数を含む乗算のリスト
    const const_muls = root.allTerms().filter(x => x.isMul() && (x as App).args.some(y => y instanceof ConstNum)) as App[];

    while(const_muls.length != 0){
        // 引数に定数を含む乗算に対し
        const mul = const_muls.pop()!;

        // 引数内の定数のリスト
        const nums = mul.args.filter(x => x instanceof ConstNum);

        for(const num of nums){
            // 乗算の係数に、引数内の定数の積をかける。
            mul.value.setmul(num.value);
            num.canceled = true;
            renderKatexSub(ele, root.tex());
            await sleepAlgebra();

            // 引数内の定数を取り除く。
            num.remArg();
            renderKatexSub(ele, root.tex());
            await sleepAlgebra();
        }
    }

    return root;
}

/**
 * @param add 親の加算
 * @param add_child 子の加算
 * @description 加算の中の加算を、親の加算にまとめる。
 * a + (b + c) = a + b + c
 */
async function simplifyNestedAdd(add_child : App){
    const add : App = add_child.parent as App;
    assert(add != null && add.isAdd());

    // 引数の中の加算の位置
    const idx = add.args.indexOf(add_child);
    assert(idx != -1);

    // 引数の中の加算を削除する。
    add_child.remArg();

    // 引数の中の加算の引数に係数をかける。
    add_child.args.forEach(x => x.value.setmul(add_child.value));

    // 引数の中の加算の引数を元の加算の引数に入れる。
    add.insArgs(add_child.args, idx);
}


/**
 * 
 * @param root ルート
 * @description 加算の中の加算を、親の加算にまとめる。
 */
export async function simplifyNestedAddAll(speech : Speech, ele : HTMLElement, root : Term){
    // すべての加算のリスト
    const add_terms = root.allTerms().filter(x => x.isAdd()) as App[];

    while(add_terms.length != 0){
        // 未処理の加算がある場合

        const add = add_terms.pop()!;
        // msg(`root:${root.str()} add:[${add.str()}]`);

        while(true){
            // 加算の引数の中の加算を探す。
            const add_child = add.args.find(x => x.isAdd()) as App;
            if(add_child == undefined){
                // ない場合

                break;
            }
            root.verifyParent(root.parent);

            // 加算の中の加算を、親の加算にまとめる。
            // msg(`root1:${root.str()} add-child:[${add_child.str()}]`);
            simplifyNestedAdd(add_child);

            // msg(`root2:${root.str()}`);

            remove(add_terms, add_child, false);

            renderKatexSub(ele, root.tex());
            await sleepAlgebra();
        }
    }

    return root;
}


/**
 * 
 * @param root ルート
 * @description 加算の中の引数の係数が同じならまとめる。
 * 
 * c x + c y = c (x + y)
 */
export async function simplifyCommonConstFactorInAdd(speech : Speech, ele : HTMLElement, root : Term){
    // すべての加算のリスト
    const add_terms = root.allTerms().filter(x => x.isAdd()) as App[];

    for(const add of add_terms){
        // 最初の項の係数
        const value = add.args[0].value;

        if(add.args.slice(1).every(x => x.value.eq(value))){
            // 次項以降も同じ係数の場合

            add.value.setmul(value);
            add.args.forEach(x => x.value.set(1));

            renderKatexSub(ele, root.tex());
            await sleepAlgebra();
        }
    }

    return root;
}

/**
 * 
 * @param root ルート
 * @description 加算の中の同類項の係数をまとめる。
 * c1 x + c2 x = (c1 + c2) x
 */
export async function combineLikeTerms(speech : Speech, ele : HTMLElement, root : Term) {
    // すべての加算のリスト
    const add_terms = root.allTerms().filter(x => x.isAdd()) as App[];

    while(add_terms.length != 0){
        // 未処理の加算がある場合

        const add = add_terms.pop()!;
        let idx = 0;
        const map = new Map<string, Term>();
        while(idx < add.args.length){
            const term = add.args[idx];
            assert(!term.isAdd());

            const str2 = term.str2();
            const like_term = map.get(str2);
            if(like_term == undefined){
                map.set(str2, term);
                idx++;
            }
            else{
                like_term.value.addRational(term.value);
                term.remArg();

                renderKatexSub(ele, root.tex());
                await sleepAlgebra();
            }
        }

        if(add.args.length == 1){
            add.oneArg();
        }
    }

    return root;
}

/**
 * 
 * @param root ルート
 * @description 約分する。
 */
async function reduceFraction(speech : Speech, ele : HTMLElement, root : Term){
    // すべての除算のリスト
    const div_terms = root.allTerms().filter(x => x.isDiv()) as App[];

    while(div_terms.length != 0){
        // 未処理の除算がある場合

        const div = div_terms.pop()!;
        const dividend = div.dividend();
        const divisor  = div.divisor();
        if(divisor instanceof ConstNum){

            if(dividend.isAdd()){

                const add = dividend as App;
                if(add.args.every(x => divisor.value.isDivisor(x.value))){
                    add.args.forEach(x => x.value.setdiv(divisor.value));
                    div.replaceTerm(add);

                    renderKatexSub(ele, root.tex());
                    await sleepAlgebra();    
                }
            }
            else{

                if(divisor.value.isDivisor(dividend.value)){
                    dividend.value.setdiv(divisor.value);
                    div.replaceTerm(dividend);

                    renderKatexSub(ele, root.tex());
                    await sleepAlgebra();
                }
            }
        }
    }

    return root;

}

export async function simplify(speech : Speech, ele : HTMLElement, root : Term){
    root.verifyParent2();
    while(true){
        let root2 : Term;
        const strid = root.strid();
        root2 = await simplifyConstNumMultiplier(speech, ele, root);
        root2 = await simplifyNestedAddAll(speech, ele, root);
        root2 = await simplifyCommonConstFactorInAdd(speech, ele, root);
        root2 = await combineLikeTerms(speech, ele, root);
        root2 = await reduceFraction(speech, ele, root);

        if(strid == root.strid()){
            break;
        }
    }
    root.verifyParent2();

    return root;
}
