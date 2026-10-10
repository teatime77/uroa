import { Reading, AbstractSpeech } from "@i18n";
import { Term, App } from "@parser";

import { ExprTransformReason } from "../enums";
import { AppServices } from "../inference";
import { MathEntity, TextBlock } from "../json";
import { reasonMsg } from "../all_functions";

import type { EquationTextBlock } from "./shape_equation";

export class ExprTransform extends MathEntity implements EquationTextBlock {
    reason : ExprTransformReason;
    equation : App;
    terms : Term[];
    textBlock : TextBlock;

    constructor(obj : { reason : ExprTransformReason, equation : App, terms : Term[]} ){
        super(obj);
        this.reason   = obj.reason;
        this.equation = obj.equation;
        this.terms    = obj.terms;
        this.textBlock = AppServices.makeEquationTextBlock(this, this.equation);
    }

    getProperties(){
        return super.getProperties().concat([
            "reason", "equation", "terms"
        ]);
    }

    getAllShapes(shapes : MathEntity[]){
        super.getAllShapes(shapes);
        shapes.push(this.textBlock);
    }

    reading() : Reading {
        // msg(`empty reading:${this.constructor.name}`);
        return new Reading(this, "", []);
    }

    async speakExprTransform(speech : AbstractSpeech){
        const text = reasonMsg(this.reason);

        await speech.speak(text);
    }

    show(){        
        this.textBlock.show();
    }

    hide(){        
        this.textBlock.hide();
    }
}

console.log(`Loaded: expr-transform`);
