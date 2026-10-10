import { assert, Reading, TT, MyError } from "@i18n";
import { IsoscelesTriangleReason } from "../enums";
import { isoscelesTriangle } from "../inference";
import { MathEntity } from "../json";
import { Triangle } from "../shape";
import { TriangleQuadrilateralDetector } from "./quadrilateral";

export class TriangleDetector extends TriangleQuadrilateralDetector {
    constructor(obj : { reason? : number, shapes : MathEntity[], auxiliaryShapes? : MathEntity[], mathText? : string }){
        super(obj);
        const triangle = this.selectedShapes[0] as Triangle;
        assert(triangle instanceof Triangle);
        if(this.reason == IsoscelesTriangleReason.two_sides_are_equal){
            isoscelesTriangle.push(triangle);
        }
    }

    reading(): Reading {
        switch(this.reason){
        case IsoscelesTriangleReason.two_sides_are_equal:
            return this.textReading(TT("The triangle is an isosceles triangle."));
        }

        throw new MyError();
    }

}

console.log(`Loaded: triangle-detector`);
