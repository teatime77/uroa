import { AbstractSpeech, assert, Reading, sleep } from "@i18n";
import { LaTeXBox } from "@layout";
import { App, Term, parseMath, SyntaxError } from "@parser";

import { AngleEqualityReason, ExprTransformReason, IsoscelesTriangleReason, LengthEqualityReason, ParallelogramReason, ParallelReason, PropositionReason, RhombusReason, ShapeEquationReason, ShapeMode, ShapeType } from "./enums";
import { AppServices, GlobalState, usedReasons } from "./inference";
import { TextBlock, MathEntity, registerEntity } from "./json";
import { getModeColor, showAuxiliaryShapes, speakReason } from "./all_functions";

import { Shape, Triangle } from "./shape";
import { EquationTextBlock } from "./deduction/shape_equation";
import type { StatementBuilder } from "./tool";

export type menuDialogType = typeof LengthEqualityReason | typeof AngleEqualityReason | typeof ShapeType | 
typeof ParallelogramReason | typeof RhombusReason | typeof IsoscelesTriangleReason | typeof ParallelReason | typeof ShapeEquationReason | typeof ExprTransformReason | typeof PropositionReason;

export class Assumption extends MathEntity implements EquationTextBlock {
    equation  : App;
    textBlock : TextBlock;

    constructor(obj : { equation : App } ){
        super(obj);

        this.equation = obj.equation;
        this.textBlock = AppServices.makeEquationTextBlock(this, this.equation);
    }

    getAllShapes(shapes : MathEntity[]){
        super.getAllShapes(shapes);
        if(this.textBlock != undefined){
            shapes.push(this.textBlock!);
        }
    }

    reading() : Reading {
        // msg(`empty reading:${this.constructor.name}`);
        return new Reading(this, "", []);
    }
}

export class Statement extends Shape {

    reason : number = 0;
    mathText : string = "";
    latexBox? : LaTeXBox;
    auxiliaryShapes : MathEntity[] = [];
    selectedShapes : MathEntity[];

    constructor(obj : { reason? : number, shapes : MathEntity[], auxiliaryShapes? : MathEntity[], mathText? : string }){
        super(obj);
        this.selectedShapes = obj.shapes;

        if(obj.reason != undefined){
            this.reason = obj.reason;
        }

        if(obj.auxiliaryShapes != undefined){
            this.auxiliaryShapes = obj.auxiliaryShapes;
        }

        if(obj.mathText != undefined){
            this.mathText = obj.mathText;
        }
    }

    dependencies() : MathEntity[] {
        return this.selectedShapes as Shape[];
    }

    getProperties(){
        return super.getProperties().concat([
            "reason", "selectedShapes", "auxiliaryShapes", "mathText"
        ]);
    }

    reading() : Reading {
        // msg(`empty reading:${this.constructor.name}`);
        return new Reading(this, "", []);
    }    

    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            shapes : this.selectedShapes.map(x => x.toObj())
        });

        if(this.reason != 0){
            obj.reason = this.reason;
        }

        if(this.auxiliaryShapes.length != 0){
            obj.auxiliaryShapes = this.auxiliaryShapes.map(x => x.toObj());
        }

        if(this.mathText != ""){
            obj.mathText = this.mathText;
        }

        return obj;
    }

    makeTexUI() : LaTeXBox {
        return new LaTeXBox({
            parent : GlobalState.Plane__one!.text_block,
            text : "",
            click : async (ev : MouseEvent)=>{
                const position = GlobalState.View__current!.getPositionInCanvas(ev);
                await (GlobalState.Builder__tool as StatementBuilder).clickWithMouseEvent(ev, GlobalState.View__current!, position, this);
            }
        });
    }

    getAllShapes(shapes : MathEntity[]){
        super.getAllShapes(shapes);
        shapes.push(... this.selectedShapes);
        shapes.push(... this.auxiliaryShapes);
    }

    showMathText(){
        GlobalState.Statement__idTimeout = undefined;

        let term : Term;
        try{

            term = parseMath(this.mathText);
        }
        catch(e){
            if(e instanceof SyntaxError){
                return;
            }

            throw e;
        }
        const tex_text = term.tex();

        if(this.latexBox == undefined){
            this.latexBox = this.makeTexUI();
        }

        this.latexBox.setText(tex_text);
    }

    setMode(mode : ShapeMode){
        super.setMode(mode);
        if(this.latexBox != undefined){
            const color = (mode == ShapeMode.none ? "transparent" : getModeColor(mode));

            this.latexBox.setBorderColor(color);
        }
    }

    draw() : void {
        const shapes = this.auxiliaryShapes.concat(this.selectedShapes).filter(x => x instanceof Shape) as Shape[];
        shapes.filter(x => x.mode != ShapeMode.none).forEach(x => x.draw());
    }

    show(){    
        if(this.latexBox != undefined){
            this.latexBox.show();
        }
    }

    hide(){        
        if(this.latexBox != undefined){
            this.latexBox.hide();
        }
    }

    async showSelectedShapes(){
        for(const shape of this.selectedShapes){
            shape.setMode(ShapeMode.target);
            await sleep(500);
        }
    }

    async showReasonAndStatement(speech : AbstractSpeech){
        if(this.reason != 0){

            await speakReason(speech, this.reason);

            if([LengthEqualityReason.congruent_triangles, AngleEqualityReason.congruent_triangles].includes(this.reason)){
                assert( this.auxiliaryShapes.every(x => x instanceof Triangle) );

                for(const [i, shape] of this.auxiliaryShapes.entries()){
                    shape.setMode(i == 0 ? ShapeMode.target1 : ShapeMode.target2);
                    await sleep(500);
                }    
            }
            else{

                await showAuxiliaryShapes(this.reason, this.auxiliaryShapes);
            }

            await speech.waitEnd();
        }

        const reading = this.reading();
        await speech.speak(reading.text);

        await this.showSelectedShapes();
        
        await speech.waitEnd();
    }

    setRelations(): void {
        super.setRelations();

        this.auxiliaryShapes.forEach(x => x.setRelations());
        this.selectedShapes.forEach(x => x.setRelations());

        usedReasons.add(this.reason);
        // if(this.reason == 0){

        //     msg(`used 0 [${this.constructor.name}]`);
        // }
        // else{

        //     msg(`used [${reasonMsg(this.reason)}]`);
        // }
    }
}

registerEntity(Statement.name, (obj: any) => new Statement(obj));

console.log(`Loaded: statement`);
