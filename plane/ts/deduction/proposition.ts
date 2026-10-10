import { assert } from "@i18n";
import { App } from "@parser";
import { propositions } from "../inference";
import { MathEntity, TextBlock } from "../json";
import { Statement } from "../statement";
import { EquationTextBlock } from "./shape_equation";

export abstract class Proposition extends Statement {
    constructor(obj : { reason? : number, auxiliaryShapes? : MathEntity[], shapes : MathEntity[] }){
        super(obj);

        propositions.push(this);
    }
}

export class ShapeProposition extends Statement {
    constructor(obj : { reason? : number, auxiliaryShapes? : MathEntity[], shapes : MathEntity[] }){
        super(obj);
    }
}

export class EquationProposition extends Statement implements EquationTextBlock {
    equation  : App;
    textBlock : TextBlock;

    constructor(obj : { reason? : number, auxiliaryShapes? : MathEntity[], shapes : MathEntity[], equation : App }){
        super(obj);

        this.equation = obj.equation;

        assert(this.selectedShapes.length == 1 && this.selectedShapes[0] instanceof TextBlock);
        this.textBlock = this.selectedShapes[0] as TextBlock;
    }
}

console.log(`Loaded: proposition`);
