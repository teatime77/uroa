///<reference path="shape.ts" />
///<reference path="statement.ts" />

import { MyError, Reading, TT, assert, Vec2 } from "@i18n";
import { App, parseMath } from "@parser";

import { AppServices } from "./inference";
import { MathEntity, TextBlock, registerEntity } from "./json"
import { addEqualAngles, addEqualLengths, addParallelLines, addPerpendicularPairs, Angle__setEqualAngleMarks, lastShape, LengthSymbol__setEqualLengthKinds, sortShape } from "./all_functions";

import { Shape, Point, AbstractLine, LineByPoints } from "./shape";
import { LengthSymbol, Angle } from "./dimension_symbol";
import { Statement } from "./statement";

export abstract class Constraint extends Statement {
    textBlock : TextBlock | undefined;

    constructor(obj : {shapes : MathEntity[]}){
        super(obj);
    }

    getAllShapes(shapes : MathEntity[]){
        super.getAllShapes(shapes);
        if(this.textBlock != undefined){
            shapes.push(this.textBlock);
        }
    }

    applyConstraint(shape : Shape){        
    }
    
    draw(): void {        
    }
}

export class LengthEqualityConstraint extends Constraint {
    point : Point;
    lengthSymbolA : LengthSymbol;
    lengthSymbolB : LengthSymbol;

    constructor(obj : { lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol }){
        const data = obj as any;
        data.shapes = [ obj.lengthSymbolA, obj.lengthSymbolB ];
        super(data);
        const [lengthSymbolA, lengthSymbolB] = sortShape<LengthSymbol>([ obj.lengthSymbolA, obj.lengthSymbolB ]);
        let points = [ obj.lengthSymbolA, obj.lengthSymbolB ].map(x => [x.pointA, x.pointB]).flat();
        this.point = lastShape(points);
        this.point.addConstraint(this);

        this.lengthSymbolA = obj.lengthSymbolA;
        this.lengthSymbolB = obj.lengthSymbolB;

        this.calc();

        LengthSymbol__setEqualLengthKinds(this.selectedShapes as LengthSymbol[]);
    }

    makeObj() : any {
        return Object.assign(super.makeObj(), {
            lengthSymbolA : this.lengthSymbolA.toObj(),
            lengthSymbolB : this.lengthSymbolB.toObj(),
        });
    }

    dependencies() : MathEntity[] {
        return super.dependencies().concat([ this.lengthSymbolA ]);
    }

    calc(): void {
        this.point.calc();
    }

    applyConstraint(shape : Shape){
        if(shape != this.point){
            throw new MyError();
        }

        const length = this.lengthSymbolA.length();
        const anchor = this.getAnchor();
        if(anchor == undefined){
            // msg(`no anchor for length-Symbol-B:${this.lengthSymbolB.id}`)
            return;
        }

        const dir = this.point.position.sub(anchor.position).unit();
        const theta = Math.atan2(dir.y, dir.x);
        const adjusted_position = anchor.position.add(dir.mul(length));
        this.point.setPosition(adjusted_position);
    }

    getAnchor() : Point | undefined {
        if(this.lengthSymbolB.pointA == this.point){
            return this.lengthSymbolB.pointB;
        }
        else if(this.lengthSymbolB.pointB == this.point){
            return this.lengthSymbolB.pointA;
        }
        else{
            return undefined;
        }
    }

    reading(): Reading {
        return this.textReading(TT("Make the two line segments equal in length."));
    }

    setRelations(): void {
        super.setRelations();
        addEqualLengths(this.lengthSymbolA, this.lengthSymbolB);
    }
}

registerEntity(LengthEqualityConstraint.name, (obj: any) => new LengthEqualityConstraint(obj));

export class AngleEqualityConstraint extends Constraint {
    equation : App | undefined;

    constructor(obj : {shapes : MathEntity[]}){
        super(obj);

        const angles = this.selectedShapes as Angle[];
        if(angles.every(x => x.name != "")){
            assert(angles.length == 2);
            const text = `${angles[0].name} == ${angles[1].name}`;
            this.equation = parseMath(text) as App;
            
            this.textBlock = AppServices.makeEquationTextBlock(this, this.equation);
        }
        else{

            Angle__setEqualAngleMarks(angles);
        }
    }

    setRelations(): void {
        super.setRelations();
        assert(this.selectedShapes.length == 2 && this.selectedShapes.every(x => x instanceof Angle));
        const [angleA, angleB] = this.selectedShapes as Angle[];

        addEqualAngles(angleA, angleB);
    }

    reading() : Reading {
        // msg(`empty reading:${this.constructor.name}`);
        return new Reading(this, "", []);
    }
}

registerEntity(AngleEqualityConstraint.name, (obj: any) => new AngleEqualityConstraint(obj));

abstract class LineConstraint extends Constraint {
    lineA : AbstractLine;
    lineB : LineByPoints;

    constructor(obj : { lineA : AbstractLine, lineB : LineByPoints }){
        const data = obj as any;
        data.shapes = [ obj.lineA, obj.lineB ];
        super(data);
        assert(obj.lineA.order < obj.lineB.order);
        this.lineA = obj.lineA;
        this.lineB = obj.lineB;
    }
}

export abstract class ParallelPerpendicularConstraint extends LineConstraint {
    constructor(obj : { lineA : AbstractLine, lineB : LineByPoints }){
        super(obj);

        this.lineB.pointB.addConstraint(this);
        this.calc();
    }

    makeObj() : any {
        return Object.assign(super.makeObj(), {
            lineA : this.lineA.toObj(),
            lineB : this.lineB.toObj(),
        });
    }

    dependencies() : MathEntity[] {
        return super.dependencies().concat([ this.lineA, this.lineB.pointA ]);
    }

    calc(): void {
        this.lineB.pointB.calc();        
    }

    applyConstraint(shape : Shape){  
        assert(shape == this.lineB.pointB);
        const AB = this.lineB.pointB.sub(this.lineB.pointA);
        let newAB : Vec2;
        if(this instanceof ParallelConstraint){
            newAB = this.lineA.e.project(AB);
        }
        else{
            newAB = this.lineA.e.rot90().project(AB);
        }

        const positionB = this.lineB.pointA.position.add( newAB );
        this.lineB.pointB.setPosition(positionB);
    }
}

export class ParallelConstraint extends ParallelPerpendicularConstraint {
    setRelations(){
        super.setRelations();
        addParallelLines(this.lineA, this.lineB);
    }
}

registerEntity(ParallelConstraint.name, (obj: any) => new ParallelConstraint(obj));

export class PerpendicularConstraint extends ParallelPerpendicularConstraint {
    setRelations(){
        super.setRelations();
        addPerpendicularPairs(this.lineA, this.lineB);
    }
}

registerEntity(PerpendicularConstraint.name, (obj: any) => new PerpendicularConstraint(obj));

console.log(`Loaded: constraint`);
