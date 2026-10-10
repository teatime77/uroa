import { assert, Reading, sleep, TT } from "@i18n";

import { MathEntity, registerEntity } from "../json";
import { addCongruentTriangles } from "../all_functions";

import { Triangle } from "../shape";
import { Statement } from "../statement";
import { ShapeMode } from "../enums";

export class TriangleCongruence extends Statement {
    constructor(obj : { reason? : number, shapes : MathEntity[], auxiliaryShapes? : MathEntity[] }){
        super(obj);
    }

    reading(): Reading {
        return this.textReading(TT("the two triangles are congruent."));
    }

    setRelations(): void {
        super.setRelations();
        const triangles = this.selectedShapes as Triangle[];
        addCongruentTriangles(triangles[0], triangles[1]);
    }

    async showSelectedShapes(){
        assert( this.selectedShapes.every(x => x instanceof Triangle) );

        for(const [i, shape] of this.selectedShapes.entries()){
            shape.setMode(i == 0 ? ShapeMode.target1 : ShapeMode.target2);
            await sleep(500);
        }
    }
}

registerEntity(TriangleCongruence.name, (obj: any) => new TriangleCongruence(obj));

console.log(`Loaded: triangle-congruence`);
