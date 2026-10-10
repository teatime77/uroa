import { msg, Reading, TT, MyError } from "@i18n";

import { LengthEqualityReason } from "../enums";
import { AppServices, ilinesSelector_2 } from "../inference";
import { MathEntity, registerEntity } from "../json";
import { addEqualLengths, LengthSymbol__setEqualLengthKinds, reasonMsg } from "../all_functions";

import type { AbstractLine, Circle } from "../shape";
import type { LengthSymbol } from "../dimension_symbol";
import { Statement } from "../statement";

export class LengthEquality extends Statement {
    constructor(obj : { reason? : number, auxiliaryShapes? : MathEntity[], shapes : MathEntity[], mathText? : string }){
        super(obj);

        LengthSymbol__setEqualLengthKinds(this.selectedShapes as LengthSymbol[]);
    }

    reading(): Reading {
        return this.textReading(TT("the two length symbols are of equal length."));
    }

    setRelations(): void {
        super.setRelations();

        const [ lengthSymbolA, lengthSymbolB ] = this.selectedShapes as LengthSymbol[];
        addEqualLengths(lengthSymbolA, lengthSymbolB);
    }

    verify() : LengthEquality | undefined {
        let lengthEquality : LengthEquality | undefined;
        switch(this.reason){
        case LengthEqualityReason.radii_equal:{
                const [lengthSymbolA, lengthSymbolB] = this.selectedShapes as LengthSymbol[];

                lengthEquality = AppServices.makeEqualLengthByRadiiEqual(lengthSymbolA, lengthSymbolB);
            }
            break;

        case LengthEqualityReason.common_circle:{
                const circle = this.auxiliaryShapes[0] as Circle;
                const [lengthSymbolA, lengthSymbolB] = this.selectedShapes as LengthSymbol[];
                lengthEquality = AppServices.makeEqualLengthByCommonCircle(lengthSymbolA, lengthSymbolB, circle);
                if(lengthEquality == undefined){
                    lengthEquality = AppServices.makeEqualLengthByCommonCircle(lengthSymbolA, lengthSymbolB, circle);
                }
            }
            break;

        case LengthEqualityReason.parallel_lines_distance:{
                const parallel_lines = this.auxiliaryShapes as AbstractLine[];
                const [lengthSymbolA, lengthSymbolB] = this.selectedShapes as LengthSymbol[];
                lengthEquality = AppServices.makeEqualLengthByParallelLines(lengthSymbolA, lengthSymbolB, parallel_lines);
                ilinesSelector_2.clear();
            }
            break;

        case LengthEqualityReason.congruent_triangles:{
                const [lengthSymbolA, lengthSymbolB] = this.selectedShapes as LengthSymbol[];
                lengthEquality = AppServices.makeEqualLengthByCongruentTriangles(lengthSymbolA, lengthSymbolB);
            }
            break;

        case LengthEqualityReason.parallelogram_opposite_sides:{
                const [lengthSymbolA, lengthSymbolB] = this.selectedShapes as LengthSymbol[];
                lengthEquality = AppServices.makeEqualLengthByParallelogramOppositeSides(lengthSymbolA, lengthSymbolB);
            }
            break;

        case LengthEqualityReason.parallelogram_diagonal_bisection:{
                const [lengthSymbolA, lengthSymbolB] = this.selectedShapes as LengthSymbol[];
                lengthEquality = AppServices.makeEqualLengthByParallelogramDiagonalBisection(lengthSymbolA, lengthSymbolB);
            }
            break;

        case LengthEqualityReason.equivalence_class:{
                const [lengthSymbolA, lengthSymbolB] = this.selectedShapes as LengthSymbol[];
                lengthEquality = AppServices.makeEqualLengthByEquivalenceClass(lengthSymbolA, lengthSymbolB);
            }
            break;

        case LengthEqualityReason.midpoint:

        case LengthEqualityReason.not_used:
        default:
            throw new MyError();
        }

        const reason_str = reasonMsg(this.reason);
        if(lengthEquality == undefined){
            throw new MyError(`can not make Length-Equality: ${reason_str}`)
        }
        else{

            msg(`make Length-Equality OK: ${reason_str}`)
        }

        return lengthEquality;
    }
}

registerEntity(LengthEquality.name, (obj: any) => new LengthEquality(obj));
registerEntity("EqualLength", (obj: any) => new LengthEquality(obj));

console.log(`Loaded: length-equality`);
