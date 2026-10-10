import { range, msg, Vec2 } from "@i18n";

export class Mat {
    dt: (number[])[];

    constructor(dt: (number[])[] | undefined = undefined){
        this.dt = this.zeroDt();

        if(dt == undefined){
            return;
        }
        for(let i = 0; i < dt.length; i++){
            for(let j = 0; j < dt[0].length; j++){
                this.dt[i][j] = dt[i][j];
            }
        }
    }

    dim(){
        return [ NaN, NaN];
    }

    zeroDt(){
        let [nrow, ncol] = this.dim();
        return range(nrow).map(x => range(ncol).map(y => 0) );
    }

    zeros() : Mat {
        return new Mat2(this.zeroDt());
    }

    copy() : Mat2{
        let [nrow, ncol] = this.dim();
        let m : Mat2 = new Mat2();

        for(let r = 0; r < nrow; r++){
            for(let c = 0; c < ncol; c++){
                m.dt[r][c] = this.dt[r][c];
            }
        }

        return m;
    }

    print(name:string = ""){
        if(name != ""){
            msg(`${name} = [`)
        }
        else{
            msg("[");
        }

        let [nrow, ncol] = this.dim();
        for(let r = 0; r < nrow; r++){
            let s = this.dt[r].map(x => x.toFixed(5)).join(", ");
            msg(`\t[ ${s} ]`);
        }
    }

    mul(x : Mat | number) : Mat {
        let [nrow, ncol] = this.dim();

        if(typeof(x) == "number"){
            let m = this.copy();
            for(let r = 0; r < nrow; r++){
                for(let c = 0; c < ncol; c++){
                    m.dt[r][c] *= x;
                }
            }
    
            return m;
        }
        else{
            let m = this.zeros();

            for(let r = 0; r < nrow; r++){
                for(let c = 0; c < ncol; c++){
                    let sum = 0;

                    for(let k = 0; k < ncol; k++){
                        sum += this.dt[r][k] * x.dt[k][c];
                    }

                    m.dt[r][c] = sum;
                }
            }
    
            return m;
        }
    }
}

export class Mat2 extends Mat {
    dim(){
        return [2,2];
    }

    det(){
        return this.dt[0][0] * this.dt[1][1] - this.dt[0][1] * this.dt[1][0];
    }

    dot(v:Vec2) : Vec2{
        return new Vec2(this.dt[0][0] * v.x + this.dt[0][1] * v.y, this.dt[1][0] * v.x + this.dt[1][1] * v.y);
    }

    inv() : Mat2 {
        const det = this.det();
        console.assert(det != 0);

        return new Mat2([[this.dt[1][1] / det, - this.dt[0][1] / det], [- this.dt[1][0] / det, this.dt[0][0] / det]])
    }
}


console.log(`Loaded: matrix`);
