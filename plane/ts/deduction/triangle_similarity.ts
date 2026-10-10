import { Reading, TT } from "@i18n";

import { MathEntity, registerEntity } from "../json";
import { addSimilarTriangles } from "../all_functions";

import { Triangle } from "../shape";
import { Statement } from "../statement";

export class TriangleSimilarity extends Statement {
    constructor(obj : { reason? : number, shapes : MathEntity[], auxiliaryShapes? : MathEntity[] }){
        super(obj);
    }

    reading(): Reading {
        return this.textReading(TT("the two triangles are similar."));
    }

    setRelations(): void {
        super.setRelations();
        const triangles = this.selectedShapes as Triangle[];
        addSimilarTriangles(triangles[0], triangles[1]);
    }
}

registerEntity(TriangleSimilarity.name, (obj: any) => new TriangleSimilarity(obj));

console.log(`Loaded: triangle-similarity`);
