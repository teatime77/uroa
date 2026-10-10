import { Reading, TT, assert } from "@i18n";

import { registerEntity } from "../json";
import { addParallelLines } from "../all_functions";

import { AbstractLine } from "../shape";
import { Statement } from "../statement";

export class ParallelDetector extends Statement {
    reading(): Reading {
        return this.textReading(TT("these two lines are parallel."));
    }

    setRelations(){
        super.setRelations();
        assert(this.selectedShapes.length == 2 && this.selectedShapes.every(x => x instanceof AbstractLine));
        const [ lineA, lineB ] = this.selectedShapes as AbstractLine[];
        addParallelLines(lineA, lineB);
    }
}

registerEntity(ParallelDetector.name, (obj: any) => new ParallelDetector(obj));

console.log(`Loaded: parallel-detector`);
