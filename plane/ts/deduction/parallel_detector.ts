import { Reading, TT, assert } from "@i18n";

import { addParallelLines } from "../relations";

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


console.log(`Loaded: parallel-detector`);
