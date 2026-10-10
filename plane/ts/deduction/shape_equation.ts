import { TT, assert, Reading, Speech, permutation, last, areSetsEqual, intersection, unique, Vec2 } from "@i18n";
import { App } from "@parser";
import { ShapeEquationReason } from "../enums";
import { AppServices } from "../inference";
import { MathEntity, TextBlock } from "../json";
import { AngleEqualityConstraint } from "../constraint";
import { Angle } from "../dimension_symbol";
import { Assumption, Statement } from "../statement";
import { ExprTransform } from "./expr_transform";

export type EquationTextBlockClass = AngleEqualityConstraint | Assumption | ExprTransform | ShapeEquation;

export interface EquationTextBlock {
    equation  : App;
    textBlock : TextBlock;
}

export class ShapeEquation extends Statement implements EquationTextBlock {
    equation : App;
    textBlock : TextBlock;
    
    constructor(obj : { reason? : number, auxiliaryShapes? : MathEntity[], shapes : MathEntity[], equation : App }){
        super(obj);
        this.equation = obj.equation;

        this.textBlock = AppServices.makeEquationTextBlock(this, this.equation);

        if(this.reason == ShapeEquationReason.sum_of_angles_is_pi && this.auxiliaryShapes.length == 2){
            assert(this.auxiliaryShapes.every(x => x instanceof Angle));

            const [angle1, angle2] = this.auxiliaryShapes as Angle[];
            AppServices.addSupplementaryAngles(angle1, angle2);
            // msg(`add-Supplementary-Angles ${angle1.name} ${angle2.name}`);
        }
    }


    reading(): Reading {
        // msg(`empty reading:${this.constructor.name}`);
        return this.textReading(TT(""));
    }

    show(){        
        this.textBlock.show();
    }

    hide(){        
        this.textBlock.hide();
    }
}

console.log(`Loaded: shape-equation`);
