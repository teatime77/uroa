import { MyError, msg, Reading, TT } from "@i18n";

import { AngleEqualityReason } from "../enums";
import { AppServices } from "../inference";
import { MathEntity, registerEntity } from "../json";
import { addEqualAngles, Angle__setEqualAngleMarks, reasonMsg } from "../all_functions";

import type { Quadrilateral } from "../shape";
import type { Angle } from "../dimension_symbol";
import type { AngleBisector } from "../geometry";
import {Statement } from "../statement";

export class AngleEquality extends Statement {
    constructor(obj : { reason? : number, auxiliaryShapes? : MathEntity[], shapes : MathEntity[], mathText? : string }){
        super(obj);

        const angles = this.selectedShapes as Angle[];
        Angle__setEqualAngleMarks(angles);
    }

    reading(): Reading {
        return this.textReading(TT("the two angles are equal."));
    }

    setRelations(): void {
        super.setRelations();

        const [angleA, angleB] = this.selectedShapes as Angle[];
        addEqualAngles(angleA, angleB);
    }

    verify() : AngleEquality | undefined {
        let angleEquality : AngleEquality | undefined;

        const [angleA, angleB] = this.selectedShapes as Angle[];

        const reason_str = reasonMsg(this.reason);
        switch(this.reason){
        case AngleEqualityReason.vertical_angles:
            angleEquality = AppServices.makeAngleEqualityByVertical_angles(angleA, angleB);
            break;

        case AngleEqualityReason.parallel_line_angles:{
                angleEquality = AppServices.makeAngleEqualityByParallelLines(angleA, angleB);
            }
            break;
            
        case AngleEqualityReason.angle_bisector:{

                const angle_bisector = this.auxiliaryShapes[2] as AngleBisector;
                angleEquality = AppServices.makeAngleEqualityByAngleBisector(angleA, angleB, angle_bisector);
            }
            break;

        case AngleEqualityReason.congruent_triangles:
            angleEquality = AppServices.makeAngleEqualityByCongruentTriangles(angleA, angleB);
            break;

        case AngleEqualityReason.parallelogram_opposite_angles:{
                const parallelogram = this.auxiliaryShapes[0] as Quadrilateral;
                angleEquality = AppServices.makeAngleEqualityByParallelogramOppositeAngles(angleA, angleB, parallelogram);
            }
            break;

        case AngleEqualityReason.similar_triangles:
            angleEquality = AppServices.makeAngleEqualityBySimilarTriangles(angleA, angleB);
            break;

        default:
            throw new MyError(`unknown Angle-Equality reason: ${this.reason} ${reason_str}`);
        }

        if(angleEquality == undefined){
            throw new MyError(`can not make Angle-Equality: ${reason_str}`)
        }
        else{

            msg(`make Angle-Equality OK: ${reason_str}`)
        }

        return angleEquality;
    }
}

registerEntity(AngleEquality.name, (obj: any) => new AngleEquality(obj));

console.log(`Loaded: angle-equality`);
