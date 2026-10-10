///<reference path="json.ts" />

import { TT, areSetsEqual, permutation, Vec2, Reading, token, MyError, assert, range } from "@i18n";
import { fgColor } from "@layout"

import { LineKind, ShapeMode } from "./enums";
import { pointOnLines, pointOnCircleArcs, congruentTriangles, similarTriangles, defaultLineWidth, OverLineWidth, GlobalState, AppServices } from "./inference";
import { MathEntity, fromXPixScale, fromYPixScale, registerEntity, TextBlock } from "./json";
import { addCenterOfCircleArcs, addEqualCircleArcs, addParallelLines, addPointOnCircleArcs, addPointOnLines, Arc__getAngles, calcFootOfPerpendicular, distanceFromLine, getCircleArcsByPoint, getCommonLineOfPoints, getCommonPointOfLines, getLinesByPoint, getModeColor, isBetweenAngles, isParallelogramPoints, modePointRadius, Point__zero } from "./all_functions";

import type { Constraint } from "./constraint";
import type { LengthSymbol, Angle } from "./dimension_symbol";

export abstract class Shape extends MathEntity {
    name      : string = "";
    color     : string = fgColor;
    lineWidth : number = defaultLineWidth;
    caption   : TextBlock | undefined;
    depends   : Shape[] = [];
    constraints : Constraint[] = [];

    abstract draw() : void;

    constructor(obj : any){
        super(obj);
        if(obj.name != undefined){
            this.name = obj.name;
        }

        if(obj.color != undefined){
            this.color = obj.color;
        }

        if(obj.lineWidth != undefined){
            this.lineWidth = obj.lineWidth;
        }

        this.caption = obj.caption;

        if(this.caption == undefined && this.name != ""){
            this.caption = this.makeCaption(this);
        }

        if(this.caption != undefined){
            this.caption.parent = this;
            this.caption.updateTextDiv();
        }
    }

    copy() : Shape {
        throw new MyError();
    }

    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            name : this.name
        });

        if(this.color != fgColor){
            obj.color = this.color;
        }

        if(this.lineWidth != defaultLineWidth){
            obj.lineWidth = this.lineWidth;
        }

        if(this.caption != undefined){
            obj.caption = this.caption.makeObj();
        }

        if(this.depends.length != 0){
            obj.depends = this.depends.map(x => x.id);
        }

        return obj;
    }

    makeCaption(parent : MathEntity) : TextBlock {
        const x = fromXPixScale(10);
        const y = fromYPixScale(20);
        return new TextBlock( { parent, text : "", isTex : false, offset : new Vec2(x, y) });
    }

    setName(name : string){
        this.name = name;

        if(this.name == ""){

            if(this.caption != undefined){
                this.caption.delete(new Set<string>());
                this.caption = undefined;
            }
        }
        else{

            if(this.name != "" && this.caption == undefined){
                this.caption = this.makeCaption(this);
            }

            this.caption!.updateTextDiv();
        }

        GlobalState.View__current!.dirty = true;
    }

    getProperties(){
        return super.getProperties().concat([
            "name", "color", "lineWidth", "caption"
        ]);
    }

    isNear(position : Vec2) : boolean {        
        return false;
    }

    modeColor() : string {
        if(this.mode == ShapeMode.none){
            return this.color;            
        }
        else{
            return getModeColor(this.mode);
        }
    }

    modeLineWidth() : number {
        return (this.isOver ? OverLineWidth : this.lineWidth);
    }

    calc(){      
        this.constraints.forEach(x => x.applyConstraint(this));
    }

    updateCaption(){ 
    }

    shapePointerdown(position : Vec2){
    }

    shapePointermove(position : Vec2, diff : Vec2){
    }

    shapePointerup(position : Vec2){
    }

    reading() : Reading {
        const name = (this.name != "" ? this.name : this.constructor.name);
        return new Reading(this, token(name), []);
    }

    show(){        
        if(this.caption != undefined){
            this.caption.show()
        }
    }

    hide(){        
        if(this.caption != undefined){
            this.caption.hide()
        }
    }

    delete(deleted : Set<string>){        
        if(deleted.has(this.id)){
            return;
        }

        super.delete(deleted);
        if(this.caption != undefined){
            this.caption.delete(deleted);
        }
    }

    addConstraint(constraint : Constraint){
        if(! this.constraints.includes(constraint)){
            this.constraints.push(constraint);
        }
    }
}

export class Point extends Shape {

    position! : Vec2;
    positionSave : Vec2 | undefined;
    bound : AbstractLine | CircleArc | undefined;

    origin : Point | undefined;

    constructor(obj : { position : Vec2, bound? : AbstractLine | CircleArc }){
        super(obj);

        this.position = obj.position;

        if(this.name != "" && this.caption == undefined){
            this.caption = this.makeCaption(this);
        }

        if(obj.bound != undefined){
            this.setBound(obj.bound);
        }
        else{
            this.setPosition(obj.position);
        }

        GlobalState.Point__tempPoints.push(this);
    }

    copy() : Point {
        return AppServices.Point__fromArgs(this.position.copy());
    }

    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            position : this.position
        });

        if(this.bound != undefined){
            obj.bound = this.bound.toObj();
        }

        return obj;
    }

    setPosition(position : Vec2){
        this.position = position;

        this.updateCaption();

        GlobalState.View__current!.changed.add(this);
        GlobalState.View__current!.dirty = true;
    }

    getBounds() : (AbstractLine | CircleArc)[] {
        const lines   = getLinesByPoint(this) as (AbstractLine | CircleArc)[];
        const circles = getCircleArcsByPoint(this);

        return lines.concat(circles).filter(x => x.order < this.order);
    }

    setBound(bound : AbstractLine | CircleArc){
        this.bound = bound;

        this.bound.adjustPosition(this, this.position);

        this.setRelations();
    }

    updateCaption(){
        if(this.caption != undefined){
            this.caption.updateTextDiv();
            this.caption.setTextPosition(this.position.x, this.position.y);
        }
    }

    getProperties(){
        return super.getProperties().concat([
            "position"
        ]);
    }

    isNear(position : Vec2) : boolean {
        return GlobalState.View__current!.isNear(position.distance(this.position));
    }

    draw() : void {
        const color = this.modeColor();

        const radius = modePointRadius(this.mode);
        if(this.visible){

            GlobalState.View__current!.drawCircleRaw(this.position, radius, color);
        }
        else{

            GlobalState.View__current!.drawCircleRaw(this.position, radius, color, defaultLineWidth);
        }
        
        if(this.isOver){

            GlobalState.View__current!.drawCircleRaw(this.position, 3 * GlobalState.Point__radius!, "gray", defaultLineWidth);
        }
    }

    add(point : Point) : Vec2 {
        return this.position.add(point.position);
    }

    sub(point : Point) : Vec2 {
        return this.position.sub(point.position);
    }

    dot(point : Point) : number {
        return this.position.dot(point.position);
    }

    distance(p : Point | Vec2) : number {
        if(p instanceof Point){
            return this.position.distance(p.position);
        }
        else{
            return this.position.distance(p);
        }
    }

    shapePointerdown(position : Vec2){
        this.positionSave = this.position.copy();
    }

    shapePointermove(position : Vec2, diff : Vec2){
        const bounds = this.getBounds();

        if(2 <= bounds.length){
            return;
        }
        else if(bounds.length == 1){

            const bound = bounds[0];
            if(bound instanceof AbstractLine){

                this.setPosition(calcFootOfPerpendicular(position, bound));
            }
            else if(bound instanceof CircleArc){
                bound.adjustPosition(this, position);
            }
            else{
                throw new MyError();
            }
        }
        else{

            if(this.positionSave != undefined){

                this.setPosition(this.positionSave.add(diff));
            }
            else{
                this.setPosition(position);
            }
        }

        this.calc();
    }

    shapePointerup(position : Vec2){
        this.positionSave = undefined;
    }

    reading(): Reading {
        if(this.bound instanceof AbstractLine){
            return this.textReading(TT("Draw a point on the line."));

        }
        else if(this.bound instanceof Circle){
            return this.textReading(TT("Draw a point on the circle."));
        }
        else if(this.bound instanceof Arc){
            return this.textReading(TT("Draw a point on the arc."));            
        }
        else{
            return this.textReading(TT("Draw a point."));
        }
    }

    setRelations(): void {
        super.setRelations();

        if(this.bound instanceof AbstractLine){
            addPointOnLines(this, this.bound);
        }
        else if(this.bound instanceof CircleArc){
            addPointOnCircleArcs(this, this.bound);
        }
        else if(this.bound != undefined){
            throw new MyError();
        }
    }
}

registerEntity(Point.name, (obj: any) => new Point(obj));


export abstract class AbstractLine extends Shape {
    lineKind : number;
    pointA : Point;
    e!     : Vec2;

    constructor(obj : { lineKind : number, pointA: Point }){
        super(obj);
        if(obj.lineKind == undefined){
            throw new MyError("line kind is undefined.")
        }
        this.lineKind = obj.lineKind;
        this.pointA = obj.pointA;
    }


    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            lineKind : this.lineKind,
            pointA   : this.pointA.toObj()
        });

        return obj;
    }    

    dependencies() : MathEntity[] {
        return super.dependencies().concat([ this.pointA ]);
    }

    getAllShapes(shapes : MathEntity[]){
        super.getAllShapes(shapes);
        shapes.push(this.pointA);
    }

    getProperties(){
        return super.getProperties().concat([
            "lineKind"
        ]);
    }

    normal() : Vec2 {
        return this.e.rot90();
    }

    isNear(position : Vec2) : boolean {
        const distance = distanceFromLine(this.normal(), this.pointA.position, position);
        return GlobalState.View__current!.isNear(distance);
    }

    draw() : void {
        const l = GlobalState.View__current!.max.distance(GlobalState.View__current!.min);
        const p_minus = this.pointA.position.add(this.e.mul(-l));
        const p_plus  = this.pointA.position.add(this.e.mul( l));
        
        switch(this.lineKind){
        case LineKind.line_segment:
        case LineKind.line:
            GlobalState.View__current!.drawLine(this, p_minus, p_plus); 
            break;

        case LineKind.ray:
            GlobalState.View__current!.drawLine(this, this.pointA.position, p_plus); 
            break;

        case LineKind.ray_reverse:
            GlobalState.View__current!.drawLine(this, this.pointA.position, p_minus); 
            break;
        }
    }

    adjustPosition(point : Point, position : Vec2){
        const foot = calcFootOfPerpendicular(point.position, this);
        point.setPosition(foot);
    }

    setRelations(): void {
        super.setRelations();
        this.pointA.setRelations();
        addPointOnLines(this.pointA, this);
    }

    includesPoint(point : Point) : boolean {
        let line_set = pointOnLines.get(point);

        if(line_set != undefined){
            return line_set.has(this);
        }
        else{
            return false;
        }
    }
}

export class LineByPoints extends AbstractLine {
    pointB   : Point;

    constructor(obj : { lineKind : number, pointA: Point, pointB: Point }){
        super(obj);
        this.pointB = obj.pointB;

        this.calc();
    }

    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            pointB : this.pointB.toObj()
        });

        return obj;
    }

    dependencies() : MathEntity[] {
        return super.dependencies().concat([ this.pointB ]);
    }

    calc(){
        this.e = this.pointB.sub(this.pointA).unit();
    }

    getAllShapes(shapes : MathEntity[]){
        super.getAllShapes(shapes);
        shapes.push(this.pointB);
    }

    length() : number {
        return this.pointA.distance(this.pointB);
    }

    isNear(position : Vec2) : boolean {
        if(!super.isNear(position)){
            return false;
        }

        if(this.lineKind == LineKind.line){
            return true;
        }

        let n : number;

        if(this.lineKind == LineKind.ray || this.lineKind == LineKind.line_segment){
            n = this.e.dot(position.sub(this.pointA.position));
        }
        else if(this.lineKind == LineKind.ray_reverse){
            n = - this.e.dot(position.sub(this.pointB.position));
        }
        else{
            throw new MyError();
        }

        switch(this.lineKind){
        case LineKind.ray:
        case LineKind.ray_reverse:
            return 0 <= n;

        case LineKind.line_segment:{
                const AB = this.pointA.distance(this.pointB);

                return 0 <= n && n <= AB;
            }
        }
    }

    draw() : void {
        GlobalState.View__current!.drawLineWith2Points(this, this.pointB);
    }

    reading(): Reading {
        return this.textReading(TT('Draw a line.'));
/*
        switch(this.lineKind){
        case LineKind.line:
            return new Reading(this, TT('Draw a line through two points.'), []);
        case LineKind.ray:
        case LineKind.ray_reverse:
            return new Reading(this, TT('Draw a half-line through two points.'), []);
        case LineKind.line_segment:
            return new Reading(this, TT('Draw a line segment through two points.'), []);
        default:
            throw new MyError();
        }
*/
    }

    setRelations(): void {
        super.setRelations();
        this.pointB.setRelations();
        addPointOnLines(this.pointB, this);
    }
}

registerEntity(LineByPoints.name, (obj: any) => new LineByPoints(obj));



export class ParallelLine extends AbstractLine {   
    line : AbstractLine;

    constructor(obj : { lineKind : number, pointA: Point, line: AbstractLine }){
        super(obj);

        this.line = obj.line;

        this.calc();
    }

    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            line : this.line.toObj()
        });

        return obj;
    }

    dependencies() : MathEntity[] {
        return super.dependencies().concat([ this.line ]);
    }

    getAllShapes(shapes : MathEntity[]){
        super.getAllShapes(shapes);
        shapes.push(this.line);
    }

    calc(){
        this.e = this.line.e.copy();
    }

    reading(): Reading {
        return new Reading(this, TT('Draw a line through a point that is parallel to another line.'), []);
    }

    setRelations(): void {
        super.setRelations();
        addParallelLines(this, this.line);
    }
}

registerEntity(ParallelLine.name, (obj: any) => new ParallelLine(obj));

export abstract class CircleArcEllipse extends Shape {
    center : Point;

    constructor(obj : { center : Point }){
        super(obj);
        this.center = obj.center;
    }

    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            center : this.center.toObj(),
        });

        return obj;
    }

    getAllShapes(shapes : MathEntity[]){
        super.getAllShapes(shapes);
        shapes.push(this.center);
    }

    dependencies() : MathEntity[] {
        return [ this.center ];
    }
}

export abstract class CircleArc extends CircleArcEllipse {
    abstract radius() : number;

    adjustPosition(point : Point, position : Vec2){
        const v = position.sub(this.center.position);
        const theta = Math.atan2(v.y, v.x);
        const x = this.radius() * Math.cos(theta);
        const y = this.radius() * Math.sin(theta);
        
        const new_pos = this.center.position.add( new Vec2(x, y) );
        point.setPosition(new_pos);
    }

    includesPoint(point : Point) : boolean {
        let circle_arc_set = pointOnCircleArcs.get(point);

        if(circle_arc_set != undefined){
            return circle_arc_set.has(this);
        }
        else{
            return false;
        }
    }

    setRelations(): void {
        super.setRelations();
        addCenterOfCircleArcs(this.center, this);
    }
}

export abstract class Circle extends CircleArc {
    constructor(obj : { center : Point }){
        super(obj);
    }

    isNear(position : Vec2) : boolean {
        const r = position.distance(this.center.position);
        return GlobalState.View__current!.isNear( Math.abs(r - this.radius()) );
    }

    draw() : void {
        const stroke_color = this.modeColor();
        const line_width = this.modeLineWidth();
        GlobalState.View__current!.drawCircle(this, this.center.position, this.radius());
    }
}

export class CircleByPoint extends Circle {
    point : Point;

    constructor(obj : { center : Point, point : Point }){
        super(obj);
        this.point = obj.point;
    }

    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            point : this.point.toObj(),
        });

        return obj;
    }

    getAllShapes(shapes : MathEntity[]){
        super.getAllShapes(shapes);
        shapes.push(this.point);
    }

    dependencies() : MathEntity[] {
        return super.dependencies().concat([ this.point ]);
    }

    calc(){        
    }

    radius() : number {
        return this.center.position.distance(this.point.position);
    }

    reading(): Reading {
        return new Reading(this, TT('Draw a circle.'), []);
    }

    setRelations(): void {
        super.setRelations();

        addPointOnCircleArcs(this.point, this);
    }
}

registerEntity(CircleByPoint.name, (obj: any) => new CircleByPoint(obj));

export class CircleByRadius extends Circle {
    lengthSymbol : LengthSymbol;

    constructor(obj : { center : Point, lengthSymbol : LengthSymbol }){
        super(obj);
        this.lengthSymbol = obj.lengthSymbol;
    }

    makeObj() : any {
        return Object.assign(super.makeObj(), {
            lengthSymbol : this.lengthSymbol.toObj(),
        });
    }

    getAllShapes(shapes : MathEntity[]){
        super.getAllShapes(shapes);
        this.lengthSymbol.getAllShapes(shapes);
    }

    dependencies() : MathEntity[] {
        return super.dependencies().concat([ this.lengthSymbol ]);
    }

    radius() : number {
        return this.lengthSymbol.length();
    }

    setRelations(): void {
        super.setRelations();

        if(this.lengthSymbol.circle != undefined){
            addEqualCircleArcs(this, this.lengthSymbol.circle);
        }
    }
}

registerEntity(CircleByRadius.name, (obj: any) => new CircleByRadius(obj));

export class Ellipse extends CircleArcEllipse {
    xPoint  : Point;
    radiusY : number;

    constructor(obj : { center : Point, xPoint : Point, radiusY : number }){
        super(obj);
        this.xPoint  = obj.xPoint;
        this.radiusY = obj.radiusY;
    }

    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            xPoint : this.xPoint.toObj(),
            radiusY : this.radiusY
        });

        return obj;
    }

    setRadiusY(radiusY : number){
        this.radiusY = radiusY;
        GlobalState.View__current!.dirty = true;
    }

    getAllShapes(shapes : MathEntity[]){
        super.getAllShapes(shapes);
        shapes.push(this.xPoint);
    }

    dependencies() : MathEntity[] {
        return super.dependencies().concat([ this.center, this.xPoint ]);
    }

    draw() : void {
        const radius_x = this.xPoint.position.distance(this.center.position);

        const center_to_x = this.xPoint.sub(this.center)
        const rotation = Math.atan2(- center_to_x.y, center_to_x.x);

        const color = this.modeColor();
        const line_width = (this.isOver || this.mode != ShapeMode.none ? 3 : 1);

        GlobalState.View__current!.drawEllipse(this.center.position, radius_x, this.radiusY, rotation, color, line_width);
    }
}

registerEntity(Ellipse.name, (obj: any) => new Ellipse(obj));

export abstract class Arc extends CircleArc {
}

export class ArcByPoint extends Arc {
    pointA : Point;
    pointB : Point;

    constructor(obj : { center : Point, pointA : Point, pointB : Point }){
        super(obj);
        this.pointA = obj.pointA;
        this.pointB = obj.pointB;
    }

    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            pointA : this.pointA.toObj(),
            pointB : this.pointB.toObj()
        });

        return obj;
    }

    getAllShapes(shapes : MathEntity[]){
        super.getAllShapes(shapes);
        shapes.push(this.pointA, this.pointB);
    }

    dependencies() : MathEntity[] {
        return super.dependencies().concat([ this.pointA, this.pointB ]);
    }

    calc(){        
        this.adjustPosition(this.pointB, this.pointB.position);
    }

    isNear(position : Vec2) : boolean {
        const r = position.distance(this.center.position);
        if(GlobalState.View__current!.isNear( Math.abs(r - this.radius()) )){

            const v = position.sub(this.center.position);
            let theta = Math.atan2(v.y, v.x);

            const [startAngle, endAngle] = Arc__getAngles(this.center, this.pointA, this.pointB);

            return isBetweenAngles(startAngle, theta, endAngle);
        }

        return false;
    }

    draw(): void {
        const [startAngle, endAngle] = Arc__getAngles(this.center, this.pointA, this.pointB);
        GlobalState.View__current!.drawArc(this, this.center.position, this.radius(), startAngle, endAngle);
    }

    radius() : number {
        return this.center.position.distance(this.pointA.position);
    }

    reading(): Reading {
        return new Reading(this, TT('Draw an arc.'), [ ]);
    }

    setRelations(): void {
        super.setRelations();

        addPointOnCircleArcs(this.pointA, this);
        addPointOnCircleArcs(this.pointB, this);
    }
}

registerEntity(ArcByPoint.name, (obj: any) => new ArcByPoint(obj));


export abstract class ArcByRadius extends Arc {
    startAngle : number;
    endAngle : number;
    pointA : Point;
    pointB : Point;

    constructor(obj : { center : Point, startAngle : number, endAngle : number  }){
        super(obj);
        this.startAngle   = obj.startAngle;
        this.endAngle     = obj.endAngle;

        this.pointA = Point__zero();
        this.pointB = Point__zero();

        this.pointA.visible = false;
        this.pointB.visible = false;
    }

    makeObj() : any {
        return Object.assign(super.makeObj(), {
            startAngle   : this.startAngle,
            endAngle     : this.endAngle
        });
    }

    getAllShapes(shapes : MathEntity[]){
        super.getAllShapes(shapes);
        shapes.push(this.pointA, this.pointB);
    }


    setOrder(){
        if(GlobalState.MathEntity__orderSet.has(this)){
            return;
        }

        this.order = GlobalState.MathEntity__orderSet.size;
        GlobalState.MathEntity__orderSet.add(this);

        this.pointA.setOrder();
        this.pointB.setOrder();
    }


    positionFromAngle(theta : number) : Vec2 {
        const length = this.radius();

        const x = this.center.position.x + length * Math.cos(theta);
        const y = this.center.position.y + length * Math.sin(theta);
        
        return new Vec2(x, y);
    }

    adjustPosition(point : Point, position : Vec2){
        const v = position.sub(this.center.position);
        const theta = Math.atan2(v.y, v.x);

        if(point == this.pointA){
            this.startAngle = theta;
        }
        else{
            this.endAngle   = theta;
        }
        
        const new_pos = this.positionFromAngle(theta);
        point.setPosition(new_pos);
    }

    calc(){        
        this.pointA.setPosition( this.positionFromAngle(this.startAngle) )
        this.pointB.setPosition( this.positionFromAngle(this.endAngle) )
    }

    isNear(position : Vec2) : boolean {
        const r = position.distance(this.center.position);
        if(GlobalState.View__current!.isNear( Math.abs(r - this.radius()) )){

            const v = position.sub(this.center.position);
            const th = Math.atan2(v.y, v.x);

            return this.startAngle <= th && th <= this.endAngle;
        }

        return false;
    }

    angles() : [number, number] {
        const v1 = this.pointA.sub(this.center);
        const th1 = Math.atan2(v1.y, v1.x);

        const v2 = this.pointB.sub(this.center);
        const th2 = Math.atan2(v2.y, v2.x);

        return [th1, th2];
    }

    draw(): void {
        GlobalState.View__current!.drawArc(this, this.center.position, this.radius(), this.startAngle, this.endAngle);
    }

    reading(): Reading {
        return new Reading(this, TT("Draw an arc with the same radius."), [ ]);
    }

    setRelations(): void {
        super.setRelations();

        addPointOnCircleArcs(this.pointA, this);
        addPointOnCircleArcs(this.pointB, this);        
    }
}

registerEntity(ArcByRadius.name, (obj: any) => new ArcByLengthSymbol(obj));

export class ArcByLengthSymbol extends ArcByRadius {
    lengthSymbol : LengthSymbol;

    constructor(obj : { center : Point, lengthSymbol : LengthSymbol, startAngle : number, endAngle : number  }){
        super(obj);
        this.lengthSymbol = obj.lengthSymbol;

        this.calc();
    }

    makeObj() : any {
        return Object.assign(super.makeObj(), {
            lengthSymbol : this.lengthSymbol.toObj(),
        });
    }

    getAllShapes(shapes : MathEntity[]){
        super.getAllShapes(shapes);
        this.lengthSymbol.getAllShapes(shapes);
    }

    dependencies() : MathEntity[] {
        return super.dependencies().concat([ this.lengthSymbol ]);
    }

    radius() : number {
        return this.lengthSymbol.length();
    }

    setRelations(): void {
        super.setRelations();

        if(this.lengthSymbol.circle != undefined){
            addEqualCircleArcs(this, this.lengthSymbol.circle);
        }
    }
}

registerEntity(ArcByLengthSymbol.name, (obj: any) => new ArcByLengthSymbol(obj));


export class ArcByCircle extends ArcByRadius {
    circle : CircleArc;

    constructor(obj : { center : Point, circle : CircleArc, startAngle : number, endAngle : number  }){
        super(obj);
        this.circle = obj.circle;

        this.calc();
    }

    makeObj() : any {
        return Object.assign(super.makeObj(), {
            circle : this.circle.toObj(),
        });
    }

    getAllShapes(shapes : MathEntity[]){
        super.getAllShapes(shapes);
        this.circle.getAllShapes(shapes);
    }

    dependencies() : MathEntity[] {
        return super.dependencies().concat([ this.circle ]);
    }

    radius() : number {
        return this.circle.radius();
    }

    setRelations(): void {
        super.setRelations();
        addEqualCircleArcs(this, this.circle);
    }
}

registerEntity(ArcByCircle.name, (obj: any) => new ArcByCircle(obj));


export class Polygon extends Shape {
    points : Point[];
    lines  : AbstractLine[];

    constructor(obj : { points : Point[], lines : AbstractLine[] }){
        super(obj);
        this.points = obj.points;
        this.lines  = obj.lines;
    }

    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            points : this.points.map(x => x.toObj()),
            lines  : this.lines.map(x => x.toObj())
        });

        return obj;
    }

    dependencies() : MathEntity[] {
        return super.dependencies().concat(this.lines).concat(this.points);
    }

    shrinkPoints() : Vec2[] {
        const positions = this.points.map(x => x.position);
        
        let center = positions[0];
        positions.slice(1).forEach(x => center = center.add(x));

        center = center.mul(1 / positions.length);

        const shrinked_positions : Vec2[] = [];
        for(const position of positions){
            const v = position.sub(center);
            const len = v.len();
            const diff = GlobalState.View__current!.fromXPixScale(1 * OverLineWidth);
            const shrinked_v = v.unit().mul(len - diff);
            const new_position = center.add(shrinked_v);
            shrinked_positions.push(new_position);
        }

        return shrinked_positions;
    }

    draw(): void {
        const color = this.modeColor();

        if([ShapeMode.target1, ShapeMode.target2].includes(this.mode)){
            const positions = this.points.map(x => x.position);
            GlobalState.View__current!.drawPolygonRaw(positions, color, NaN, true);

            return;
        }

        const radius = (this.mode == ShapeMode.none ? 1 : 2) * GlobalState.Point__radius!;

        let positions : Vec2[];
        if(this.mode == ShapeMode.none){
            positions = this.points.map(x => x.position);
        }
        else{
            positions = this.shrinkPoints();
        }

        for(const position of positions){
            GlobalState.View__current!.drawCircleRaw(position, radius, color);
        }

        const line_width = (this.mode == ShapeMode.none ? defaultLineWidth : OverLineWidth);
        GlobalState.View__current!.drawPolygonRaw(positions, color, line_width, false);
    }

    getAllShapes(shapes : MathEntity[]){
        super.getAllShapes(shapes);
        shapes.push(... this.points, ... this.lines);
    }

    reading(): Reading {
        switch(this.points.length){
        case 3:
            return new Reading(this, TT('Draw a triangle.'), []);
        case 4:
            return new Reading(this, TT('Draw a quadrilateral.'), []);        
        }

        throw new MyError();
    }

    setRelations(): void {
        super.setRelations();
        this.points.forEach(x => x.setRelations());
        this.lines.forEach(x => x.setRelations());

        const num_points = this.points.length;
        const lines = range(num_points).map(i => getCommonLineOfPoints(this.points[i], this.points[(i + 1) % num_points])) as AbstractLine[];
        if(lines.some(x => x == undefined)){
            this.lines.forEach(x => x.setRelations());

            throw new MyError();
        }

        if(range(this.points.length).some(i => lines[i] != this.lines[i])){
            // msg(`modify lines of ${this.id}:${this.constructor.name}`);
            this.lines = lines;
        }
    }

    isEqual(polygon : Polygon) : boolean {
        return areSetsEqual(this.points, polygon.points);
    }
}

registerEntity(Polygon.name, (obj: any) => new Polygon(obj));


export class Triangle extends Polygon {  

    angleIndex(angle : Angle) : number {
        const idx = this.points.indexOf(angle.intersection);
        if(idx != -1){
        
            const other_points = [0, 1, 2].filter(i => i != idx).map(i => this.points[i]);
            assert(other_points.length == 2);
            for(const [p1, p2] of permutation<Point>(other_points)){
                if(angle.lineA.includesPoint(p1) && angle.lineB.includesPoint(p2)){
                    return idx;
                }
            }
        }

        return -1;
    }

    lengthSymbolIndex(lengthSymbol : LengthSymbol) : number {
        for(const [i1, i2] of [[0,1], [1,2], [2,0]]){
            for(const [p1, p2] of permutation<Point>([ this.points[i1], this.points[i2] ])){
                if(lengthSymbol.pointA == p1 && lengthSymbol.pointB == p2){
                    return i1;
                }
            }
        }

        return -1;
    }

    key() : string {
        return this.points.map(x => `${x.id}`).join(":");
    }

    isCongruent(triangle : Triangle) : boolean {
        for(const triangles of congruentTriangles){   
            if(triangles.some(x => x.isEqual(this))){
                return triangles.some(x => x.isEqual(triangle));
            }
        }

        return false;
    }

    isSimilar(triangle : Triangle) : boolean {
        if(this.isCongruent(triangle)){
            return true;
        }

        for(const triangles of similarTriangles){   
            if(triangles.some(x => x.isEqual(this))){
                return triangles.some(x => x.isEqual(triangle));
            }
        }

        return false;
    }

}

registerEntity(Triangle.name, (obj: any) => new Triangle(obj));

export class Quadrilateral extends Polygon {
    isParallelogram() : boolean {
        return isParallelogramPoints(this.points);
    }

    diagonalIntersection() : Point | undefined {
        const point_pairs = [ [this.points[0], this.points[2]], [this.points[1], this.points[3]] ]
        const diagonals = point_pairs.map(x => getCommonLineOfPoints(x[0], x[1]) );
        if(diagonals.every(x => x != undefined)){
            return getCommonPointOfLines(diagonals[0], diagonals[1]);
        }

        return undefined;
    }
}

registerEntity(Quadrilateral.name, (obj: any) => new Quadrilateral(obj));


console.log(`Loaded: shape`);
