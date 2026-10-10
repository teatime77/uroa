import { range, assert, msg } from "@i18n";

export function EuclideanAlgorithm(n : number, m : number){
    assert(n != m && 0 < n && 0 < m);
    if(m < n){
        [n, m] = [m, n];
    }
    const fs = [ m, n ] 
    for(let i = 0; n != 0; i++){
        const q = fs[i] % fs[i + 1];
        const p = (fs[i] - q) / fs[i + 1];
        assert(p == Math.floor(p));

        msg(`f${i}[${fs[i]}] = p[${p}] * f${i+1}[${fs[i + 1]}] + f${i+2}[${q}]`);

        if(q == 0){
            break;
        }

        fs.push(q);


/*
入力を m, n (m ≧ n) とする。
n = 0 なら、 m を出力してアルゴリズムを終了する。
m を n で割った余りを新たに n とし、更に 元のnを新たにm とし 2. に戻る。


n0 = m0 * p0 + n1
m0 = n1 * p1 + n2
n1 = n2 * p3 + n3

n1 = m0 * p1 + (m0 * p2 + n3) = m0 * (p1 + p2) + n3
n0 = m0 * p0 + m0 * (p1 + p2) + n3 = m0 


*/
    }
}

abstract class Group {
}

class Permutation {
    dst : number[];
    str : string;

    len() : number {
        return this.dst.length;
    }

    constructor(dst : number[]){
        this.dst = dst.slice();
        this.str = this.dst.map(x => `${x}`).join(":");
    }

    eq(p : Permutation) : boolean {
        return this.str == p.str;
    }
}

class ModGroup extends Group {
    modulo : number = 1;
    members : number[] = [];

    static makeAll(modulo : number) : ModGroup {
        return new ModGroup(modulo, range(modulo));
    }

    constructor(modulo : number, members : number[]){
        super();
        this.modulo = modulo;
        this.members = members.slice();

    }


}

class SymmetricGroup extends Group {
    members : Permutation[] = [];

    static makePermutations(g : SymmetricGroup, nums : number[], rems : number[]){
        for(let i = 0; i < rems.length; i++){
            const nums2 = nums.slice();
            nums2.push(rems[i]);
            const rems2 = rems.slice();
            rems2.splice(i, 1);
            if(rems2.length == 1){
                nums2.push(rems2[0]);
                const p = new Permutation(nums2);
                g.addMember(p);
            }
            else{
                SymmetricGroup.makePermutations(g,  nums2, rems2);
            }

        }
    }

    static makeAllSub2(order : number, idx : number){

    }

    addMember(p : Permutation){
        this.members.push(p);
    }
}

function makeSymmetricGroup(order : number) : SymmetricGroup {
    const g = new SymmetricGroup();

    const rems = range(order);
    SymmetricGroup.makePermutations(g, [], rems);

    msg(`\n============================== order: ${order}`)
    for(const p of g.members){
        msg(`${p.str}`);
    }
    

    return g;
}

export function testGalois(){
    EuclideanAlgorithm(2 * 3 * 5 * 11, 2 * 3 * 5 * 7);
    makeSymmetricGroup(3);
    makeSymmetricGroup(4);
    makeSymmetricGroup(5);
}
