import { msg, getPlayMode, PlayMode, Vec2, unique } from "@i18n";
import { bgColor, fgColor } from "@layout";

import { LineKind, ShapeMode } from "./enums";
import { Angle__radius1Pix, classCounters, defaultLineWidth, equalLengths, GlobalState, idMap, Point__radiusPix, RelationLog, supplementaryAngles } from "./inference";
import { Widget, MathEntity, TextBlock } from "./json";
import { addToShapeHistory, clearShapeList, getModeColor, getParallelLines, getPerpendicularLines, getPointsFromLine, initRelations, linear, modeLineWidth, modePointRadius, popShapeList, pushShapeList, recalc, removeDiv } from "./all_functions";

import { Shape, Point, AbstractLine, CircleArcEllipse } from "./shape";
import { Angle, LengthSymbol, DimensionLine } from "./dimension_symbol";
import { Motion } from "./geometry";
import { Operation, ClickShape } from "./operation";
import { SelectionTool, StatementBuilder } from "./tool";

import type { UndoData } from "./plane_util";

export abstract class AbstractCanvas {
    canvas : HTMLCanvasElement;
    ctx : CanvasRenderingContext2D;
    downPos : Vec2 = Vec2.zero();
    movePos : Vec2 = Vec2.zero();
    uiOrgPos : Vec2 = Vec2.zero();
    pointerId : number = NaN;
    moved : boolean = false;

    constructor(canvas_html : HTMLCanvasElement){
        this.canvas = canvas_html;
        this.ctx = this.canvas.getContext('2d')!; // Or 'webgl', 'webgl2'
        if (!this.ctx) {
            console.error("Canvas context not supported!");
        }

        this.canvas.addEventListener("pointerdown",  this.pointerdown.bind(this));
        this.canvas.addEventListener("pointermove",  this.pointermove.bind(this));
        this.canvas.addEventListener("pointerup"  , async (ev:PointerEvent)=>{
            await this.pointerup(ev);
        });
    }

    abstract getPositionInCanvas(event : MouseEvent) : Vec2;
    abstract pointerdown(ev:PointerEvent) : void;
    abstract pointermove(ev:PointerEvent) : void;
    abstract pointerup(ev:PointerEvent) : Promise<void>;
    abstract resizeCanvas() : void;
    abstract repaint() : void;
    abstract clearCanvas() : void;
}

export class View extends AbstractCanvas {

    name  : string = "";
    grid : CanvasGrid;

    operations : Operation[] = [];
    shapes : MathEntity[] = [];
    relationLogs : RelationLog[] = [];

    undoStack : UndoData[] = [];

    changed : Set<MathEntity> = new Set<MathEntity>();

    min! : Vec2;
    max! : Vec2;

    textBase : Vec2;
    textBaseY : number;

    dirty : boolean = false;

    isNear(real_distance : number) : boolean {
        const pix_distance = this.toXPixScale(real_distance);
        return pix_distance < GlobalState.View__nearThreshold;
    }

    constructor(canvas : HTMLCanvasElement){
        super(canvas);
        this.canvas.innerHTML = "";

        this.movePos = Vec2.fromXY(NaN, NaN);
        
        this.grid   = new CanvasGrid(this);

        this.canvas.width  = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;

        const scale = 100;
        const span_x = this.canvas.clientWidth  / scale;
        const min_x = -0.75 * span_x;
        const max_x =  0.25 * span_x;

        const span_y = this.canvas.clientHeight / scale;
        const max_y = 0.5 * span_y;
        const min_y = -max_y;
        msg(`min-x:${min_x} max-x:${max_x} max-y:${max_y}`);

        this.setMinMax(new Vec2(min_x, min_y), new Vec2(max_x,  max_y));

        this.textBaseY = max_y - 0.1 * span_y;
        this.textBase = new Vec2(min_x + 0.05 * span_x, this.textBaseY);

        GlobalState.View__current = this;

        this.resizeCanvas();
    }

    clearCanvas() : void {
        const all_shapes = this.allShapes();
        all_shapes.forEach(x => x.hide());

        removeDiv();
    
        classCounters.clear();
        GlobalState.Widget__maxId = 1;
        idMap.clear();
        // this.id = this.calcId();

        this.operations = [];
        this.shapes = [];
        this.dirty = true;
        this.textBase.y = this.textBaseY;

        GlobalState.Plane__one!.clearPlane();
        clearShapeList();
        
        initRelations();    
    }

    setMinMax(min : Vec2, max : Vec2){
        this.min = min;
        this.max = max;

        GlobalState.Point__radius  = this.fromXPixScale(Point__radiusPix);
        GlobalState.Angle__radius1 = this.fromXPixScale(Angle__radius1Pix);
    }

    getPositionInCanvas(event : MouseEvent) : Vec2 {
        const flipped_y = this.canvas.clientHeight - event.offsetY;

        const x = linear(0, event.offsetX, this.canvas.clientWidth , this.min.x, this.max.x);
        const y = linear(0, flipped_y , this.canvas.clientHeight, this.min.y, this.max.y);

        return new Vec2(x, y);
    }

    fromXPixScale(pix : number) : number {
        return(this.max.x - this.min.x) * (pix / this.canvas.clientWidth);
    }

    fromYPixScale(pix : number) : number {
        return(this.max.y - this.min.y) * (pix / this.canvas.clientHeight);
    }

    fromPixScale(position : Vec2) : Vec2 {
        return new Vec2(this.fromXPixScale(position.x), this.fromYPixScale(position.y));
    }

    fromXPix(pix : number) : number {
        return linear(0, pix, this.canvas.clientWidth, this.min.x, this.max.x);
    }

    fromYPix(pix : number) : number {
        return linear(0, pix, this.canvas.clientHeight, this.min.y, this.max.y);
    }

    fromPix(position : Vec2) : Vec2 {
        return new Vec2(this.fromXPix(position.x), this.fromYPix(position.y));
    }

    toXPixScale(n : number) : number {
        return this.canvas.clientWidth * n / (this.max.x - this.min.x);
    }

    toYPixScale(n : number) : number {
        return this.canvas.clientHeight * n / (this.max.y - this.min.y);
    }

    toXPix(x : number) : number {
        const x_pix = linear(this.min.x, x, this.max.x, 0, this.canvas.clientWidth);
        return x_pix;
    }

    toYPix(y : number) : number {
        const pix_y = linear(this.min.y, y, this.max.y, 0, this.canvas.clientHeight);

        const flipped_y = this.canvas.clientHeight - pix_y;
        return flipped_y;
    }

    toPixPosition(position:Vec2) : Vec2 {
        const x_pix = this.toXPix(position.x);
        const y_pix = this.toYPix(position.y);

        return new Vec2(x_pix, y_pix);
    }

    getShapes() : Shape[] {
        return this.shapes.filter(x => x instanceof Shape) as Shape[];
    }

    allRealShapes() : Shape[] {
        return this.allShapes().filter(x => x instanceof Shape) as Shape[];
    }

    allShapes() : MathEntity[] {
        const shapes : MathEntity[] = [];
        this.shapes.forEach(x => x.getAllShapes(shapes));

        const unique_shapes = unique(shapes);

        return unique_shapes;
    }

    removeUnusedDivs(){
        const used_divs = this.allRealShapes().filter(x => x.caption != undefined).map(x => x.caption!.div);
        const used_divs_set = new Set<HTMLDivElement>(used_divs);
        const canvas_divs = Array.from(this.canvas.getElementsByTagName("div"));
        const unused_divs = canvas_divs.filter(x => !used_divs_set.has);
        for(const div of unused_divs){
            this.canvas.removeChild(div);
        }
    }

    resetMode(){
        this.allShapes().forEach(x =>{ x.setMode(ShapeMode.none); x.isOver = false; });
        this.dirty = true;
    }

    resetOrders(){
        GlobalState.MathEntity__orderSet.clear();
        this.allShapes().forEach(x => x.order = NaN);
        this.shapes.forEach(x => x.setOrder());
    }

    drawShapes(){
        if(this.dirty){
            this.dirty = false;

            // msg("redraw");

            this.repaint();
            GlobalState.Polygon__colorIndex = 0;

            this.grid.showGrid(GlobalState.Plane__one!.show_axis.checked(), GlobalState.Plane__one!.show_grid.checked());

            const shapes = this.allRealShapes();
            const visible_shapes = shapes.filter(x => x.visible);
            
            if(getPlayMode() != PlayMode.stop || ! GlobalState.Plane__one!.editMode){

                visible_shapes.forEach(c => c.draw());
            }
            else{

                shapes.forEach(c => c.draw());
            }

            visible_shapes.filter(x =>  x.mode != ShapeMode.none).forEach(c => c.draw());

            GlobalState.Builder__tool!.drawTool(this);

            if(GlobalState.Plane__one!.snap_to_grid.checked()){
                this.grid.showPointer();
            }
        }

        window.requestAnimationFrame(this.drawShapes.bind(this));
    }

    async click(event : MouseEvent){
        msg("click");
        let position = this.getPositionInCanvas(event);
        if(GlobalState.Plane__one!.snap_to_grid.checked()){
            position = this.grid.snap(position);
        }

        GlobalState.Point__tempPoints = [];
        const shape = this.getShape(position);


        if(GlobalState.Builder__tool instanceof SelectionTool){
            if(shape instanceof Point){

                const click_shape = this.operations.find(x => x instanceof ClickShape && x.createdPoint === shape) as ClickShape;
                if(click_shape != undefined){
                    msg(`click shape position is changed: ${click_shape.position}=>${position}`);
                    click_shape.position = position;
                }
            }

            await GlobalState.Builder__tool.click(this, position, shape);
        }
        else{
            this.addOperation(new ClickShape(position, (shape != undefined ? shape.id : undefined)));

            if(GlobalState.Builder__tool instanceof StatementBuilder){

                await GlobalState.Builder__tool.clickWithMouseEvent(event, this, position, shape);
            }
            else{

                await GlobalState.Builder__tool!.click(this, position, shape);
            }
        }

        this.dirty = true;
    }

    async dblclick(event : MouseEvent){
        let position = this.getPositionInCanvas(event);
        const shape = this.getShape(position);
        if(shape == undefined){
            return;
        }

        if(GlobalState.Builder__tool instanceof SelectionTool){
            this.resetMode();

            if(shape instanceof LengthSymbol){
                const length_symbols = equalLengths.find(x => x.has(shape));
                if(length_symbols != undefined){
                    Array.from(length_symbols.values()).forEach(x => x.setMode(ShapeMode.depend));
                    this.dirty = true;
                }
            }
            else if(shape instanceof Angle){
                const angles = Array.from(supplementaryAngles.flat()).find(x => x.has(shape));
                if(angles != undefined){
                    this.resetMode();
                    angles.forEach(x => x.setMode(ShapeMode.depend));
                    this.dirty = true;
                }
            }
            else if(shape instanceof AbstractLine){
                const points = getPointsFromLine(shape);
                points.forEach(x => x.setMode(ShapeMode.depend));

                const parallel_lines = getParallelLines(shape);
                if(parallel_lines != undefined){
                    parallel_lines.forEach(x => x.setMode(ShapeMode.target));
                }

                const perpendicular_lines = getPerpendicularLines(shape);
                if(perpendicular_lines != undefined){
                    perpendicular_lines.forEach(x => x.setMode(ShapeMode.depend));
                }
            }

            shape.setMode(ShapeMode.target);
        }

        this.dirty = true;
    }


    pointerdown(event : PointerEvent) : void {
        if(event.button != 0){
            msg(`pointerdown:${event.button.toString(2)}`);
            return;
        }

        let position = this.getPositionInCanvas(event);
        if(GlobalState.Plane__one!.snap_to_grid.checked()){
            position = this.grid.snap(position);
        }

        const shape = this.getShape(position);

        GlobalState.Builder__tool!.pointerdown(event, this, position, shape);
    }

    pointermove(event : PointerEvent) : void {
        // タッチによる画面スクロールを止める
        event.preventDefault(); 

        let position = this.getPositionInCanvas(event);
        if(GlobalState.Plane__one!.snap_to_grid.checked()){
            position = this.grid.snap(position);
        }

        const shapes = this.allShapes().concat(GlobalState.Builder__tool!.pendingShapes());

        const old_near_shape = shapes.find(x => x.isOver);
        const near_shape = this.getShape(position);

        if(old_near_shape != near_shape){
            if(old_near_shape != undefined){
                old_near_shape.isOver = false;
            }

            if(near_shape != undefined){
                near_shape.isOver = true;
                // msg(`over:${near_shape.constructor.name}`);
            }

            this.dirty = true;
        }

        const shape = this.getShape(position);
        GlobalState.Builder__tool!.pointermove(event, this, position, shape);

        this.movePos = position;

        if(GlobalState.Plane__one!.snap_to_grid.checked()){
            const prev_snap_position = this.grid.snapPosition;
            this.grid.setSnapPosition();
            if(! prev_snap_position.equals(this.grid.snapPosition)){
                this.dirty = true;
            }
        }
    }

    async pointerup(event : PointerEvent) : Promise<void> {
        if(event.button != 0){
            msg(`pointerup:${event.button.toString(2)}`);
            return;
        }
        
        let position = this.getPositionInCanvas(event);
        if(GlobalState.Plane__one!.snap_to_grid.checked()){
            position = this.grid.snap(position);
        }

        const shape = this.getShape(position);
        GlobalState.Builder__tool!.pointerup(event, this, position, shape);
    }

    wheel(event : WheelEvent){
        event.preventDefault();

        let position = this.getPositionInCanvas(event);
        if(GlobalState.Plane__one!.snap_to_grid.checked()){
            position = this.grid.snap(position);
        }

        const ratio = 0.002 * event.deltaY;
        const min_x = this.min.x - (position.x - this.min.x) * ratio;
        const min_y = this.min.y - (position.y - this.min.y) * ratio;

        const max_x = this.max.x + (this.max.x - position.x) * ratio;
        const max_y = this.max.y + (this.max.y - position.y) * ratio;

        this.setMinMax(new Vec2(min_x, min_y), new Vec2(max_x, max_y));

        this.allRealShapes().forEach(x => x.updateCaption());

        GlobalState.View__current!.dirty = true;
    }

    resizeCanvas() : void {
        this.canvas.width  = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;

        this.updateTextBlockPositions();
        this.dirty = true;

        msg(`resize: w:${this.canvas.width} h:${this.canvas.height} max:${this.max}`);
    }

    addOperation(operation : Operation){
        this.operations.push(operation);
    }

    addShape(shape : MathEntity){
        this.shapes.push(shape);
        shape.setOrder();
        addToShapeHistory(shape);
    }

    getShape(position : Vec2) : Shape | undefined {
        const shapes = this.allRealShapes().concat(GlobalState.Builder__tool!.pendingShapes());
        const point = shapes.filter(x => x instanceof Point).find(x => x.isNear(position));
        if(point != undefined){
            return point;
        }

        const symbol = shapes.filter(x => x instanceof LengthSymbol).find(x => x.isNear(position));
        if(symbol != undefined){
            return symbol;
        }

        const angle = shapes.filter(x => x instanceof Angle).find(x => x.isNear(position));
        if(angle != undefined){
            return angle;
        }

        const line = shapes.filter(x => x instanceof AbstractLine).find(x => x.isNear(position));
        if(line != undefined){
            return line;
        }
        
        const circle = shapes.filter(x => x instanceof CircleArcEllipse).find(x => x.isNear(position));
        return circle;
    }

    updateShapes(){
        for(const shape of this.getShapes()){
            let shapes : MathEntity[] = [];
            
            shape.getAllShapes(shapes);

            const points = shapes.filter(x => x instanceof Point) as Point[];
            
            for(const point of points){
                const bounds = point.getBounds();
                if(bounds.length == 1){
                    const bound = bounds[0];

                    bound.adjustPosition(point, point.position);

                    this.changed.add(point);
                }
            }

            recalc(shape, this.changed);
        }
    }

    updateTextBlockPositions(){
        const shapes = this.allShapes();

        const parents = shapes.filter(x => (x instanceof Point || x instanceof DimensionLine) && x.caption != undefined) as (Point | DimensionLine)[];
        parents.forEach(x => x.updateCaption());

        const text_blocks = this.shapes.filter(x => x instanceof TextBlock) as TextBlock[];
        text_blocks.forEach(x => x.updateTextPosition());
    }

    async undo(){
        if(this.operations.length == 0){
            return;
        }

        let undoData : UndoData | undefined;

        for(let idx = this.operations.length - 1 - 1; 0 <= idx; idx--){
            const operation = this.operations[idx];
            if(!isNaN(operation.shapesLength)){
                undoData = {
                    operations : this.operations.slice(idx + 1),
                    shapes     : this.shapes.slice(operation.shapesLength),
                    relationLogs : this.relationLogs.slice(operation.relationLogsLength),
                    historyUIs   : []
                }

                this.operations   = this.operations.slice(0, idx + 1);
                this.shapes       = this.shapes.slice(0, operation.shapesLength);
                this.relationLogs = this.relationLogs.slice(0, operation.relationLogsLength);
                break;
            }
        }

        if(undoData == undefined){

            undoData = {
                operations : this.operations.slice(),
                shapes     : this.shapes.slice(),
                relationLogs : this.relationLogs.slice(),
                historyUIs   : []
            }

            this.operations   = [];
            this.shapes       = [];
            this.relationLogs = [];

            initRelations();
        }

        undoData.shapes.forEach(x => x.hide());

        while(GlobalState.View__current!.shapes.length < GlobalState.Plane__one!.shapes_block.children.length){
            const ui = popShapeList();
            if(ui != undefined){
                undoData.historyUIs.unshift(ui);
            }
        }

        this.undoStack.push(undoData);

        this.dirty = true;
    }

    async redo(){
        const view : View = GlobalState.View__current!;

        if(this.undoStack.length == 0){
            return;
        }

        const undoData = this.undoStack.pop()!;

        this.operations.push(... undoData.operations);
        this.shapes.push(... undoData.shapes);
        this.relationLogs.push(... undoData.relationLogs);

        undoData.shapes.forEach(x => x.show());

        undoData.historyUIs.forEach(x => pushShapeList(x));

        this.dirty = true;
    }

    restoreView(){
        const motions = this.shapes.filter(x => x instanceof Motion) as Motion[];
        motions.reverse().forEach(x => x.restorePropertyChanges());
    }

    texPosition(){

    }

    getAttributes(shape : Shape | undefined) : [string, number]{
        let color : string;
        let line_width : number;

        if(shape != undefined){

            color      = shape.modeColor();
            line_width = shape.modeLineWidth();
        }
        else{

            color = fgColor;
            line_width = defaultLineWidth;
        }

        return [color, line_width];
    }

    repaint() : void {
        const rc = this.canvas.getBoundingClientRect();
        this.ctx.fillStyle = bgColor;
        this.ctx.fillRect(0, 0, rc.width, rc.height);
    }

    drawLineRaw(p1 : Vec2, p2 : Vec2, color : string, line_width : number){
        const pix1 = this.toPixPosition(p1);
        const pix2 = this.toPixPosition(p2);

        const ctx = this.ctx;
        ctx.beginPath();
        ctx.moveTo(pix1.x, pix1.y);
        ctx.lineTo(pix2.x, pix2.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = line_width;
        ctx.stroke();   
    }

    drawLine(shape : Shape | undefined, p1 : Vec2, p2 : Vec2){
        const [color, line_width] = this.getAttributes(shape);
        this.drawLineRaw(p1, p2, color, line_width);
    }

    drawLineWith2Points(line : AbstractLine, pointB : Point){
        const l = GlobalState.View__current!.max.distance(GlobalState.View__current!.min);
        const p_plus  = line.pointA.position.add(line.e.mul( l));
        const p_minus = line.pointA.position.add(line.e.mul(-l));

        switch(line.lineKind){
        case LineKind.line_segment:
            this.drawLine(line, line.pointA.position, pointB.position);
            break;

        case LineKind.ray:
            this.drawLine(line, line.pointA.position, p_plus);
            break;

        case LineKind.ray_reverse:
            this.drawLine(line, line.pointA.position, p_minus);
            break;

        case LineKind.line:
            this.drawLine(line, p_minus, p_plus);
            break;
        }
    }

    drawPolygonRaw(positions : Vec2[], color : string, line_width : number, fill : boolean = false){
        const ctx = this.ctx;

        ctx.beginPath();
        if(fill){

            ctx.globalAlpha = 0.5;
            ctx.fillStyle = color;
        }
        else{

            ctx.strokeStyle = color;
            ctx.lineWidth   = line_width;
        }

        for(const [idx, position] of positions.entries()){
            const pix = this.toPixPosition(position);

            if(idx == 0){

                ctx.moveTo(pix.x, pix.y);
            }
            else{

                ctx.lineTo(pix.x, pix.y);
            }
        }

        ctx.closePath();

        if(fill){

            ctx.fill();
            ctx.globalAlpha = 1;
        }
        else{

            ctx.stroke();
        }
    }

    drawPolygon(shape : Shape, positions : Vec2[]){
        const [color, line_width] = this.getAttributes(shape);
        this.drawPolygonRaw(positions, color, line_width);
    }

    drawPartialPolygon(points : Point[], mode : ShapeMode){
        const color = getModeColor(mode);
        const radius = modePointRadius(mode);

        const positions = points.map(x => x.position);
        positions.forEach(x => GlobalState.View__current!.drawCircleRaw(x, radius, color));

        const line_width = modeLineWidth(mode);
        GlobalState.View__current!.drawPolygonRaw(positions, color, line_width);
    }

    drawLinesRaw(lines : [Vec2, Vec2][], color : string, line_width : number){
        const ctx = this.ctx;

        for(const [p1, p2] of lines){
            const pix1 = this.toPixPosition(p1);
            const pix2 = this.toPixPosition(p2);

            ctx.beginPath();
            ctx.moveTo(pix1.x, pix1.y);
            ctx.lineTo(pix2.x, pix2.y);
            ctx.strokeStyle = color;
            ctx.lineWidth   = line_width;
            ctx.stroke();
        }
    }

    drawLines(shape : Shape, lines : [Vec2, Vec2][]){
        const [color, line_width] = this.getAttributes(shape);
        this.drawLinesRaw(lines, color, line_width);
    }

    drawArcRaw(center : Vec2, radius : number, start_angle : number, end_angle : number, color : string, line_width? : number){
        const ctx = this.ctx;
        const pix = this.toPixPosition(center);

        // flip Y
        start_angle = 2 * Math.PI - start_angle;
        end_angle   = 2 * Math.PI - end_angle;

        const radius_pix = this.toXPixScale(radius);

        ctx.beginPath();
        ctx.arc(pix.x, pix.y, radius_pix, start_angle, end_angle, true);

        if(line_width == undefined){

            ctx.fillStyle = color;
            ctx.fill();
        }
        else{

            ctx.lineWidth   = line_width;
            ctx.strokeStyle = color;
            ctx.stroke();
        }
    }

    drawCircleRaw(center : Vec2, radius : number, color : string, line_width? : number){
        this.drawArcRaw(center, radius, 0, 2 * Math.PI, color, line_width)
    }

    drawArc(shape : Shape, center : Vec2, radius : number, start_angle : number, end_angle : number){
        const [color, line_width] = this.getAttributes(shape);
        this.drawArcRaw(center, radius, start_angle, end_angle, color, line_width)
    }

    drawCircle(shape : Shape, center : Vec2, radius : number){
        this.drawArc(shape, center, radius, 0, 2 * Math.PI)
    }

    drawEllipse(center : Vec2, radius_x : number, radius_y : number, rotation : number, color : string, line_width : number){

        const center_pix = this.toPixPosition(center);
        const radius_x_pix = this.toXPixScale(radius_x);
        const radius_y_pix = this.toXPixScale(radius_y);

        const ctx = this.ctx;

        ctx.beginPath();
        ctx.ellipse(center_pix.x, center_pix.y, radius_x_pix, radius_y_pix, rotation, 0, 2 * Math.PI);
        ctx.lineWidth = line_width;
        ctx.strokeStyle = color;
        ctx.stroke();
    }

    drawText(position : Vec2, text : string, color : string){
        const pos_pix = this.toPixPosition(position);
        const ctx = this.ctx;
        ctx.font = "16px serif";
        ctx.lineWidth = 1;
        ctx.strokeStyle = color;
        ctx.strokeText(text, pos_pix.x, pos_pix.y);
    }

    drawRect(shape : Shape | undefined, p1 : Vec2, p2 : Vec2){
        const [color, line_width] = this.getAttributes(shape);

        const pix1 = this.toPixPosition(p1);
        const pix2 = this.toPixPosition(p2);

        const x = Math.min(pix1.x, pix2.x);
        const y = Math.min(pix1.y, pix2.y);
        const w = Math.abs(pix1.x - pix2.x);
        const h = Math.abs(pix1.y - pix2.y);

        const ctx = this.ctx;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = line_width;
        ctx.rect(x, y, w, h);
        ctx.stroke();   
    }

}

class CanvasGrid {
    view : View;
    subSpanX : number | undefined;
    subSpanY : number | undefined;
    snapPosition : Vec2 = Vec2.zero();

    constructor(view : View){
        this.view = view;
    }

    drawGridAxis(axis : string, show_grid : boolean, show_axis : boolean){
        let size : number;
        let min_a : number;
        let max_a : number

        let min_b : number;
        let max_b : number

        if(axis == "X"){

            size = this.view.fromXPixScale(75);
            [min_a, max_a] = [this.view.min.x, this.view.max.x];
            [min_b, max_b] = [this.view.min.y, this.view.max.y];
        }
        else{

            size = this.view.fromYPixScale(75);
            [min_a, max_a] = [this.view.min.y, this.view.max.y];
            [min_b, max_b] = [this.view.min.x, this.view.max.x];
        }

        const power = Math.round( Math.log10(size) );

        let fraction_digits : number;
        fraction_digits = -power;

        let main_span = 10 ** power;
        if(main_span < size){
            if(Math.abs(2 * main_span - size) < size - main_span){
                main_span = 2 * main_span;
            }
        }
        else{
            if(Math.abs(0.5 * main_span - size) < main_span - size){
                main_span = 0.5 * main_span;
                fraction_digits++;
            }
        }
        fraction_digits = Math.max(0, fraction_digits);

        let sub_span = main_span / 5;

        if(show_grid){

            const n1 = Math.floor(min_a / sub_span);
            const n2 = Math.ceil(max_a / sub_span);

            const main_lines : [Vec2, Vec2][] = [];
            const sub_lines : [Vec2, Vec2][] = [];
            const axis_lines : [Vec2, Vec2][] = [];

            for(let n = n1; n <= n2; n++){

                const a = n * sub_span;
                let p1 : Vec2;
                let p2 : Vec2;
                if(axis == "X"){

                    p1 = new Vec2(a, min_b);
                    p2 = new Vec2(a, max_b);
                }
                else{

                    p1 = new Vec2(min_b, a);
                    p2 = new Vec2(max_b, a);
                }

                if(n == 0){

                    axis_lines.push([p1, p2]);
                }
                else if(n % 5 == 0){

                    main_lines.push([p1, p2]);
                }
                else{

                    sub_lines.push([p1, p2]);
                }
            }        

            this.view.drawLinesRaw(axis_lines, fgColor, 1.0);
            this.view.drawLinesRaw(main_lines, "gray", 0.5);
            this.view.drawLinesRaw(sub_lines , "gray", 0.2);
        }

        if(show_axis){
            const n1 = Math.floor(min_a / main_span);
            const n2 = Math.ceil(max_a / main_span);

            for(let n = n1; n <= n2; n++){
                const a = n * main_span;

                const text = (n == 0 ? "0" : a.toFixed(fraction_digits));
                if(axis == "X"){                    
                    this.view.drawText(new Vec2(a, 0), text, fgColor);
                }
                else{

                    this.view.drawText(new Vec2(0, a), text, fgColor);
                }
            }
        }

        if(axis == "X"){
            this.subSpanX = sub_span;
        }
        else{
            this.subSpanY = sub_span;
        }
    }

    showGrid(show_grid : boolean, show_axis : boolean){
        if(show_grid || show_axis){
            this.drawGridAxis("X", show_grid, show_axis);
            this.drawGridAxis("Y", show_grid, show_axis);
        }
    }

    setSnapPosition(){
        if(isNaN(this.view.movePos.x) || this.subSpanX == undefined || this.subSpanY == undefined){
            return;
        }

        this.snapPosition = this.snap(this.view.movePos);
    }

    showPointer(){
        if(this.subSpanX == undefined || this.subSpanY == undefined){
            return;
        }

        let position = this.snapPosition;
        const lines : [Vec2, Vec2][] = [
            [ new Vec2(position.x - this.subSpanX, position.y), new Vec2(position.x + this.subSpanX, position.y) ],
            [ new Vec2(position.x, position.y - this.subSpanY), new Vec2(position.x, position.y + this.subSpanY) ]
        ]

        this.view.drawLinesRaw(lines, "blue", 1);
    }

    snap(position : Vec2) : Vec2 {
        if(this.subSpanX == undefined || this.subSpanY == undefined){
            return position;
        }

        const x = Math.round(position.x / this.subSpanX) * this.subSpanX;
        const y = Math.round(position.y / this.subSpanY) * this.subSpanY;

        return new Vec2(x, y);
    }


}

console.log(`Loaded: view`);
