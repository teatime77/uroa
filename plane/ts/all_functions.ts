// ts\constraint.ts

import { AbstractSpeech, AppMode, appMode, areSetsEqual, check, getPlayMode, intersection, isEdge, MyError, permutation, PlayMode, Reading, remove, sleep, sum, TT, upperLatinLetters, Vec2, msg } from "@i18n";
import { App, makeNodeTextByApp, parseMath, showFlow } from "@parser";
import { $button, $dialog, $grid, $img, $label, $latex, $radio, Anchor, bgColor, Button, fgColor, Grid, Layout, RadioButton, saveBlob, UI } from "@layout";
import { AngleEqualityReason, ExprTransformReason, IsoscelesTriangleReason, LengthEqualityReason, ParallelogramReason, ParallelReason, PropositionReason, RhombusReason, ShapeEquationReason, ShapeMode, ShapeType, TriangleCongruenceReason, TriangleSimilarityReason } from "./enums";
import { defaultLineWidth, enumSelectionClassName, GlobalState, menuDialogs, modeColorMap, OverLineWidth, urlBase, enumToImgName, AppServices, toolList, editToolList } from "./inference";
import { Mat2 } from "./matrix";
import { calcFootFrom2Pos } from "./geometry_math";
// Compatibility exports; new callers import coordinate calculations directly.
export { calcFootFrom2Pos, distanceFromLine, calcCirclePointTangent } from "./geometry_math";
import { Widget, MathEntity, TextBlock } from "./json";

import type { AbstractLine, Point, Shape } from "./shape";
import type { View } from "./view";
import type { Angle, LengthSymbol } from "./dimension_symbol";
import type { Plane } from "./plane_ui";
import type { Operation, ToolSelection } from "./operation";
import type { Builder } from "./tool";
import type { EquationTextBlockClass, ShapeEquation } from "./deduction/shape_equation";
import { getCommonPointOfLines, findAnglesInPolygon } from "./relations";
// Compatibility exports; callers can import each feature module directly.
export {
    initRelations, recalcRelations, addShapeSetRelations, undoRelations, redoRelations,
    addCenterOfCircleArcs, addPointOnCircleArcs, addPointOnLines, getLinesByPoint, getCircleArcsByPoint,
    addPerpendicularPairs, addParallelLines, getPerpendicularLines, getParallelLines, isParallel, isPerpendicular,
    areEqualCircleArcs, addEqualCircleArcs, getCommonLineOfPoints, getPointsFromLine, getCommonPointOfLines, getLineFromPoints,
    addCongruentSimilarTriangles, addCongruentTriangles, addSimilarTriangles, getTrianglesByAngle, getTrianglesByLengthSymbol,
    getParallelogramClassifier, getParallelogramsByDiagonalLengthSymbols, isParallelogramPoints,
    angleKey, angleMatches3points, findAngleBy3points, findEqualAnglesBy3pointsPair, findAnglesInPolygon, findAngle,
    addEqualAngles, isEqualAngle, isEqualAnglePoints, findTrianglePairByAngles, getAngleUnitVectors, setEqualShapes,
    addEqualLengths, isEqualLength, findEqualLengthsByPointsPair, getCommonPoint,
    getParallelLinesByPointsPair, findParallelLinesOfLengthSymbols, findTrianglePairByLengthSymbols,
    Mylist, MyIntersection,
} from "./relations";
export { isClockwise, toClockwisePoints } from "./geometry_order";

export function sortShape<T>(shapes : T[]) : T[] {
    return shapes.slice().sort((a:T, b:T) => (a as Shape).order - (b as Shape).order);
}

export function lastShape<T>(shapes : T[]) : T {
    const sorted_shapes = sortShape<T>(shapes);

    return last(sorted_shapes);
}

// ts\geometry.ts

export function calcFootOfPerpendicular(position:Vec2, line: AbstractLine) : Vec2 {
    return calcFootFrom2Pos(position, line.pointA.position, line.e);
}
    

export function calcLineLineIntersection(l1 : AbstractLine, l2 : AbstractLine) : Vec2 {
    l1.calc();
    l2.calc();
    if(l1.e == undefined || l2.e == undefined){
        throw new MyError();
    }

    /*
    l1.p1 + u l1.e = l2.p1 + v l2.e

    l1.p1.x + u l1.e.x = l2.p1.x + v l2.e.x
    l1.p1.y + u l1.e.y = l2.p1.y + v l2.e.y

    l1.e.x, - l2.e.x   u = l2.p1.x - l1.p1.x
    l1.e.y, - l2.e.y   v = l2.p1.y - l1.p1.y
    
    */
    const m = new Mat2([[l1.e.x, - l2.e.x], [l1.e.y, - l2.e.y]]);
    const v = new Vec2(l2.pointA.position.x - l1.pointA.position.x, l2.pointA.position.y - l1.pointA.position.y);
    const mi = m.inv();
    const uv = mi.dot(v);
    const u = uv.x;

    const position = l1.pointA.position.add(l1.e.mul(u));

    return position;
}


// ts\json.ts



export function saveJson(anchor : Anchor){
    const text = getOperationsText();

    const blob = new Blob([text], { type: 'application/json' });

    saveBlob(anchor, "movie", blob);
}




// ts\operation.ts

export function convertOperations(version : number, operations : Operation[]) : Operation[] {
    if(version == 2.0){

        const new_operations : Operation[] = [];
        let idx = 0;
        while(idx < operations.length){
            const operation = operations[idx];
            new_operations.push(operation);
        
            if(AppServices.isToolSelection(operation) && [ "LengthEqualityBuilder", "AngleEqualityBuilder", "ParallelDetectorBuilder"].includes(operation.toolName)){
                assert(AppServices.isEnumSelection(operations[idx + 3]));

                new_operations.push(operations[idx + 3]);
                new_operations.push(operations[idx + 1]);
                new_operations.push(operations[idx + 2]);

                idx += 4;
            }
            else if( AppServices.isToolSelection(operation) && operation.toolName ==  "QuadrilateralClassifierBuilder"){
                assert( AppServices.isEnumSelection(operations[idx + 5]) && AppServices.isEnumSelection(operations[idx + 6]));

                new_operations.push(operations[idx + 5]);
                new_operations.push(operations[idx + 6]);

                new_operations.push(operations[idx + 1]);
                new_operations.push(operations[idx + 2]);
                new_operations.push(operations[idx + 3]);
                new_operations.push(operations[idx + 4]);

                idx += 7;
            }
            else{
                idx++;
            }
        }
        return new_operations;
    }

    return operations;
}

export function getOperationsText(){
    const data = {
        version : 2.1,
        operations : GlobalState.View__current!.operations.map(x => x.toString())
    };

    const doc_text = JSON.stringify(data, null, 4);
    msg(`operations-text : \n${doc_text}\n`);
    
    return doc_text;
}

export async function typeIntoInput(element: HTMLInputElement, text: string, delay = 100) {
    for (let i = 0; i < text.length; i++) {
        element.value += text[i];
        await new Promise(resolve => setTimeout(resolve, delay));
    }
}

export async function movePointerAndHighlight(item : HTMLElement){
    const borderColor = item.style.borderColor;

    await movePointerToElement(item);
    item.style.borderColor = "DeepSkyBlue";
    await sleepInFastForward(100);
    item.style.borderColor = borderColor;
}

export async function speakAndHighlight(shape : MathEntity, speech : AbstractSpeech, lines : string[]){
    await speech.speak(lines.shift()!.trim());

    for(const dep of shape.dependencies()){
        
        dep.setMode(ShapeMode.depend);

        await sleep(0.5 * 1000 * shape.interval);
    }


    shape.setMode(ShapeMode.target);

    while(lines.length != 0){
        const line = lines.shift()!.trim();
        if(line != ""){
            await speech.waitEnd();
            await speech.speak(line);
        }
    }

    await sleep(1000 * shape.interval);
}


// ts\plane_event.ts


export function setCaptionEvent(caption : TextBlock) : void {
    caption.div.addEventListener("pointerdown", caption.captionPointerdown.bind(caption));
    caption.div.addEventListener("pointermove", caption.captionPointermove.bind(caption));
    caption.div.addEventListener("pointerup", caption.captionPointerup.bind(caption));
    caption.div.addEventListener("click", (ev : MouseEvent)=>{
        AppServices.showProperty(caption, 0);
    });

    caption.div.addEventListener("dblclick", (ev : MouseEvent)=>{
        caption.div.contentEditable = "true";
        caption.div.style.cursor = "text";
        caption.div.focus();

    });

    caption.div.addEventListener("blur", (ev : FocusEvent)=>{
        caption.div.contentEditable = "false";
        caption.div.style.cursor = "move";
        caption.text = caption.div.innerText;

        const text_area = document.getElementById("text-block-text-area") as HTMLTextAreaElement;
        if(text_area != null){
            text_area.value = caption.text;
        }
    });
}

export function deleteShapeEvent(shape : MathEntity, button : HTMLButtonElement){
    button.addEventListener("click", (ev : MouseEvent)=>{
        const ok = confirm("Are you sure to delete this shape?");
        if(ok){
            const idx = GlobalState.View__current!.shapes.indexOf(shape);
            if(idx == -1){
                throw new MyError();
            }
            const button = GlobalState.Plane__one!.shapes_block.children[idx];
            GlobalState.Plane__one!.shapes_block.removeChild(button);

            remove(GlobalState.View__current!.shapes, shape);
            shape.delete(new Set<string>());
            GlobalState.View__current!.dirty = true;
        }
    });
}

// ts\plane_ui.ts

export function makeCanvas(div : HTMLElement) : HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.id = "main-canvas";
    canvas.style.width  = "100%";
    canvas.style.height = "100%";

    div.append(canvas);

    return canvas;
}

export function makeCssClass(){
    const styles = [
`.tex_div {
    position: absolute;
    display: inline-block;
    background-color: transparent;
    cursor: move;
    user-select: none;
}`
    ,
`.selectable_tex {
    position: absolute;
    display: inline-block;
    background-color: transparent;
    cursor: pointer;
    user-select: none;
}`
    ];

    for(const style of styles){
        const tex_style = document.createElement('style');
        tex_style.innerHTML = style;

        document.getElementsByTagName('head')[0].appendChild(tex_style);
    }
}

export function drawLine(shape : Shape, p1 : Vec2, p2 : Vec2){
    GlobalState.View__current!.drawLine(shape, p1, p2);
}

export function makeGrid(plane : Plane){
    const root = $grid({
        rows     : "25px 100% 25px 80px",
        children:[
            $grid({
                children: [
                    plane.menu_block
                ]
            })
            ,
            $grid({
                columns  : "50px 50% 50% 300px",

                children : [
                    plane.tool_block
                    ,
                    plane.text_block
                    ,
                    plane.canvas_block
                    ,
                    plane.property_block
                ]
            })
            ,
            plane.shapes_block
            ,
            plane.narration_box
        ]
    });

    return root;    
}

// ts\plane_util.ts



const $dic = new Map<string, HTMLElement>();

export function $(id : string) : HTMLElement {
    let ele = $dic.get(id);
    if(ele == undefined){
        ele = document.getElementById(id)!;
        $dic.set(id, ele);
    }

    return ele;
}

export function $div(id : string) : HTMLDivElement {
    return $(id) as HTMLDivElement;
}

export function $inp(id : string) : HTMLInputElement {
    return $(id) as HTMLInputElement;
}

export function $dlg(id : string) : HTMLDialogElement {
    return $(id) as HTMLDialogElement;
}

export function $sel(id : string) : HTMLSelectElement {
    return $(id) as HTMLSelectElement;
}

// Define a function that returns a Promise
export async function waitForClick(element: HTMLElement): Promise<number> {
    return new Promise<number>((resolve : (id:number)=>void) => {

        const clickHandler = (ev : MouseEvent) => {
            element.removeEventListener('click', clickHandler);

            const target = ev.target as HTMLElement;
            let result_value = NaN;
            if(target.className == enumSelectionClassName){

                result_value = parseInt(target.dataset.operation_value!);
            }
            resolve(result_value); 
        }

        element.addEventListener('click', clickHandler);
    });
}


export function assert(b : boolean, msg : string = ""){
    if(!b){
        throw new MyError(msg);
    }
}    

export function range(n: number) : number[]{
    return [...Array(n).keys()];
}

export function last<T>(v : Array<T>) : T {
    return v[v.length - 1];
}

export function unique<T>(v : Array<T>) : T[] {
    let set = new Set<T>();
    const ret : T[] = [];
    for(const x of v){
        if(!set.has(x)){
            set.add(x);
            ret.push(x);
        }
    }
    return ret;
}

export function average(v : number[]) : number {
    return sum(v) / v.length;
}

export async function fetchText(fileURL: string) {
    const response = await fetch(fileURL);
    const text = await response!.text();

    return text;
}

export function pseudoColor(n : number) : [number, number, number] {
    n = Math.max(0, Math.min(1, n));

    let r:number, g:number, b:number;

    if(n < 0.25){
        b = 1;
        g = n * 4;
        r = 0;
    }
    else if(n < 0.5){
        b = (0.5 - n) * 4;
        g = 1;
        r = 0;
    }
    else if(n < 0.75){
        b = 0;
        g = 1;
        r = (n - 0.5) * 4;
    }
    else{
        b = 0;
        g = (1 - n) * 4;
        r = 1;
    }

    return [r, g, b];
}

export function toRadian(degree : number) : number {
    return degree * Math.PI / 180;
}

export function toDegree(radian : number) : number {
    return radian * 180 / Math.PI;
}

export function inRange(start : number, theta : number, end : number) : boolean {
    const f = (x:number)=>{ return 0 <= x ? x : 180 + x };

    [start , theta, end] = [ f(start), f(theta), f(end)];
    [ theta, end ] = [ theta - start, end - start ];

    const g = (x:number)=>{ return 0 <= x ? x : 360 + x };
    [theta, end] = [ g(theta), g(end)];

    assert(0 <= theta && 0 <= end);
    return theta <= end;
}

export function linear(src_min : number, src_val : number, src_max : number, dst_min : number, dst_max : number) : number {
    const ratio = (src_val - src_min) / (src_max - src_min);    
    const dst_val = dst_min + ratio * (dst_max - dst_min);

    return dst_val;
}

export function MinMaxXY(p1 : Vec2, p2 : Vec2) : [number,number,number,number] {
    const min_x = Math.min(p1.x, p2.x);
    const min_y = Math.min(p1.y, p2.y);

    const max_x = Math.max(p1.x, p2.x);
    const max_y = Math.max(p1.y, p2.y);

    return [ min_x, min_y, max_x, max_y ];
}

export function pairKey(a : Widget, b : Widget) : string {
    return a.id <= b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
}

export async function sleepInFastForward(milliseconds : number) : Promise<void> {
    return new Promise((resolve) => {
        setTimeout(()=>{
            resolve();
        }, milliseconds);
    });
}

function normalizeAngle(theta : number) : number {
    return 0 <= theta ? theta : theta + 2 * Math.PI;
}

export function isBetweenAngles(start : number, theta : number, end : number ){
    theta  = normalizeAngle(theta - start);
    end    = normalizeAngle(end - start);

    assert(0 <= theta && 0 <= end);
    return theta <= end;
}

function makeName(){
    const points = GlobalState.View__current!.allRealShapes().filter(x => AppServices.isPoint(x)).concat(GlobalState.Point__tempPoints);

    const upper_latin_letters = upperLatinLetters;
    const idxes = points.map(x => upper_latin_letters.indexOf(x.name));

    let name : string;
    if(idxes.length == 0){
        name = upper_latin_letters[0];
    }
    else{
        const max_idx = Math.max(...idxes);
        if(max_idx == -1){
            name = upper_latin_letters[0];
        }
        else if(max_idx + 1 < upper_latin_letters.length){
            name = upper_latin_letters[max_idx + 1];
        }
        else{
            throw new MyError();
        }
    }
}


function setterName(name : string) : string {
    return "set" + name[0].toUpperCase() + name.substring(1);
}

export function setProperty(obj : any, property_name : string, newValue : any){
    const setter_name = setterName(property_name);
    if(obj[setter_name] != undefined){
        obj[setter_name](newValue);
    }
    else{
        obj[property_name] = newValue;
    }
}



function makeReasonMsgMap(){
    return new Map<number, string>([
        [ TriangleCongruenceReason.side_side_side, TT("Since three pairs of sides of two triangles are equal,")],
        [ TriangleCongruenceReason.side_angle_side, TT("Since two pairs of sides of two triangles are equal, and the included angles are equal,")],
        [ TriangleCongruenceReason.angle_side_angle, TT("Since two pairs of angles of two triangles are equal, and the included sides are equal,")],

        [ ShapeEquationReason.sum_of_angles_is_pi, TT("Since the sum of the angles is π,")],
        [ ShapeEquationReason.sum_of_angles_is_equal, TT("Since the sum of the angles is equal,")],
        [ ShapeEquationReason.sum_of_lengths_is_equal, TT("Since the sum of the lengths is equal,")],
        [ ShapeEquationReason.sum_of_interior_angles_of_triangle_is_pi, TT("Since the sum of the interior angles of a triangle is π,")],
        [ ShapeEquationReason.sum_of_interior_angles_of_quadrilateral_is_2pi, TT("Since the sum of the interior angles of a quadrilateral is 2 π,")],
        [ ShapeEquationReason.exterior_angle_theorem, TT("Since the exterior angle of a triangle equals the sum of two remote interior angles,")],

        [ LengthEqualityReason.radii_equal, TT("Since the two circles have the same radius,")],
        [ LengthEqualityReason.common_circle, TT("Since two length symbols are the radii of the same circle,")],
        [ LengthEqualityReason.parallel_lines_distance, TT("Since the distance between two parallel lines is constant,")],
        [ LengthEqualityReason.not_used, TT("Since the two circles have the same radius,")],
        [ LengthEqualityReason.congruent_triangles, TT("Since the two triangles are congruent,")],
        [ LengthEqualityReason.parallelogram_opposite_sides, TT("Since the opposite sides of a parallelogram are equal in length,")],
        [ LengthEqualityReason.parallelogram_diagonal_bisection, TT("Since the diagonals of a parallelogram intersect at the midpoint,")],
        [ LengthEqualityReason.equivalence_class, TT("Since these two length symbols are equal to another length symbol,")],
        [ LengthEqualityReason.midpoint, TT("Since the midpoint bisects the line segment,")],

        [ AngleEqualityReason.vertical_angles, TT("Since vertical angles are equal,")],
        [ AngleEqualityReason.parallel_line_angles, TT("Since the corresponding angles of parallel lines are equal,")],
        [ AngleEqualityReason.angle_bisector, TT("Since these angles are formed by the angle bisectors,")],
        [ AngleEqualityReason.congruent_triangles, TT("Since the two triangles are congruent,")],
        [ AngleEqualityReason.parallelogram_opposite_angles, TT("Since the diagonals of a parallelogram are congruent,")],
        [ AngleEqualityReason.similar_triangles, TT("Since the two triangles are similar,") ],
        [ AngleEqualityReason.isosceles_triangle_base_angles, TT("Since the base angles of an isosceles triangle are equal,")],

        [ ParallelogramReason.each_opposite_sides_are_equal, TT("Since each opposite sides are equal,")],
        [ ParallelogramReason.each_opposite_sides_are_parallel, TT("Since each opposite sides are parallel,")],
        [ ParallelogramReason.each_opposite_angles_are_equal, TT("Since each opposite angles are equal,")],
        [ ParallelogramReason.one_opposite_sides_are_parallel_and_equal, TT("Since one opposite sides are parallel and equal,")],
        [ ParallelogramReason.each_diagonal_bisections, TT("Since the diagonals intersect at their midpoints,")],

        [ RhombusReason.all_sides_are_equal, TT("Since all four sides are equal in length,")],

        [ IsoscelesTriangleReason.two_sides_are_equal, TT("Since two sides are equal in length,")],

        [ ParallelReason.parallelogram, TT("Since the opposite sides of a parallelogram are parallel,") ],
        [ ParallelReason.corresponding_angles_or_alternate_angles_are_equal, TT("Since corresponding angles or alternate angles are equal,")],
        [ ParallelReason.supplementary_angles, TT("Since the sum of the two interior angles on the same side is π,")],

        [ TriangleSimilarityReason.two_equal_angle_pairs, TT("Since both pairs of angles in two triangles are equal,")],

        [ ExprTransformReason.transposition, TT("Transpose the term.") ],
        [ ExprTransformReason.equality, TT("From the above equations,") ],
        [ ExprTransformReason.add_equation, TT("Add two equations together.") ],
        [ ExprTransformReason.substitution, TT("Substitute the term.") ],
        [ ExprTransformReason.dividing_equation, TT("Dividing an equation by the same term.") ],
        [ ExprTransformReason.arg_shift, TT("Shift the argument.")],

        [0 , TT("no reason")],
    ]);
}


let reasonMsgMap : Map<number, string> | undefined;

export function reasonMsg(reason : number) : string {
    if(reasonMsgMap == undefined){
        reasonMsgMap = makeReasonMsgMap();
    }

    const text = reasonMsgMap.get(reason);
    if(text != undefined){
        return text;
    }

    throw new MyError();
}

// ts\play.ts

let pointerMove : HTMLImageElement;
let pointer : HTMLImageElement;

let pointerPix : Vec2 = Vec2.zero();

export function initPlay(){
    pointerMove = document.getElementById("pointer_move_img") as HTMLImageElement;
    pointer = document.getElementById("pointer_img") as HTMLImageElement;
}

export async function movePointerPix(pix : Vec2){
    if(getPlayMode() != PlayMode.fastForward){
        pointerMove.style.visibility = "visible";

        const step = 20;
        for(const i of range(step)){
            const x = linear(0, i, step - 1, pointerPix.x, pix.x);
            const y = linear(0, i, step - 1, pointerPix.y, pix.y);
    
            pointerMove.style.left = `${x}px`;
            pointerMove.style.top  = `${y}px`;
            await sleep(10);
        }

        pointerMove.style.visibility = "hidden";
    }
    
    pointer.style.left = `${pix.x}px`;
    pointer.style.top  = `${pix.y}px`;
    pointer.style.visibility     = "visible";
    await sleep(500);
    pointer.style.visibility     = "hidden";

    pointerPix = pix;
}

export async function movePointer(pos : Vec2){
    const pix = GlobalState.View__current!.toPixPosition(pos);
    const rect = GlobalState.View__current!.canvas.getBoundingClientRect();
    const new_pix = new Vec2(rect.x + pix.x, rect.y + pix.y);

    await movePointerPix(new_pix);
}

export async function movePointerToElement(ele : HTMLElement){
    const rect = ele.getBoundingClientRect();
    const x = rect.x + 0.5 * rect.width;
    const y = rect.y + 0.5 * rect.height;

    await movePointerPix(new Vec2(x, y));
}

export async function moveToolSelectionPointer(operation : ToolSelection){
    const id = `${operation.toolName}-radio`;
    const radio = document.getElementById(id)!;
    assert(radio != null);

    await movePointerToElement(radio);
}

export function removeDiv(){
    for(const class_name of [ "tex_div", "selectable_tex" ]){
        const tex_divs = Array.from(document.body.getElementsByClassName(class_name)) as HTMLDivElement[];
        tex_divs.forEach(x => x.remove());    
    }
}

export async function playShape(speech : AbstractSpeech, all_shapes : MathEntity[], named_all_shape_map : Map<string, Shape>, shape : MathEntity){
    AppServices.showProperty(shape, 0);

    let highlighted = new Set<Reading>();

    if( AppServices.isExprTransform(shape)){
        await shape.speakExprTransform(speech);
    }
    else if( AppServices.isShapeEquation(shape)){
    }
    else if( AppServices.isStatement(shape)){
        await shape.showReasonAndStatement(speech);
    }
    else if( AppServices.isMotion(shape)){
        await shape.animate(speech);
    }
    else{

        const root_reading = shape.reading();
        if(root_reading.text == ""){

        }
        else if(root_reading.args.length == 0){

            await speakAndHighlight(shape, speech, [root_reading.text]);
        }
        else{

            const text = root_reading.prepareReading();

            const readings = root_reading.getAllReadings();

            msg(`reading:${shape.constructor.name} ${text}`);
            msg("    " + readings.map(x => `[${x.start}->${x.end}:${x.text}]`).join(" "));

            speech.callback = (idx : number)=>{
                for(const reading of readings){
                    if(reading.start <= idx){

                        if(!highlighted.has(reading)){
                            msg(`hilight: start:${reading.start} ${reading.text}`);
                            reading.readable.highlight(true);
                            highlighted.add(reading);
                        }
                    }
                }
            }

            if(text != ""){
                await speech.speak(TT(text));
            }                
        }
    }

    await speech.waitEnd();

    Array.from(highlighted.values()).forEach(x => x.readable.highlight(false));
    speech.callback = undefined;

    if( AppServices.isShapeEquation(shape) ||  AppServices.isExprTransform(shape)){
        const [node, text] = makeNodeTextByApp(shape.equation);

        const div_child = shape.textBlock.div.children[0] as HTMLElement;

        /*
            const id = setInterval(()=>{
                speech.prevCharIndex++;
                if(text.length < speech.prevCharIndex){
                    clearInterval(id);
                }
            }, 100);
        */
        if(isEdge){

            await showFlow(speech, shape.equation, shape.textBlock.div, named_all_shape_map);
        }
        else{

            div_child.style.backgroundColor = "blue";
            await speech.speak(text);
        }

        await speech.waitEnd();                
        div_child.style.backgroundColor = "";
    }
    else if( AppServices.isTextBlock(shape) && shape.isTex){
        const term = parseMath(shape.text);

        await showFlow(speech, term, shape.div, named_all_shape_map);
    }
    else if( AppServices.isStatement(shape) && shape.mathText != ""){
        const term = parseMath(shape.mathText);

        if(shape.latexBox == undefined){
            shape.latexBox = shape.makeTexUI();
        }

        await showFlow(speech, term, shape.latexBox.div, named_all_shape_map);
    }

    all_shapes.forEach(x => {x.setMode(ShapeMode.none); });
}

// ts\property.ts

export function appendRow(grid : Grid, nest : number, name : string, value : UI){
    const label = $label({ 
        text : name
    });

    grid.addChild(label);
    grid.addChild(value);
}

export function makeConstantProperty(grid : Grid, nest : number, name : string, text : string){
    grid.addChild($label({ text : name }));
    grid.addChild($label({ text : text }));
}

export function makeTexProperty(grid : Grid, nest : number, name : string, text : string){
    grid.addChild($label({ text : name }));
    grid.addChild($latex({ text : text }));
}

export function appendTitle(grid : Grid, nest : number, title : string){
    const label = $label({
        text : title
    });

    const filler = $label({
        text : ""
    });

    grid.addChild(label);
    grid.addChild(filler);
}

function appendDelete(tbl : HTMLTableElement, shape : MathEntity){
    const all_dependencies = GlobalState.View__current!.allShapes().map(x => x.dependencies()).flat();

    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 2;

    const button = document.createElement("button");
    button.innerText = "delete";
    button.style.color = fgColor;
    button.style.backgroundColor = bgColor;

    if(all_dependencies.includes(shape as Shape)){
        button.disabled = true;
    }
    else{

        deleteShapeEvent(shape, button);
    }

    cell.append(button);
    row.append(cell);    

    tbl.append(row);
}

export let usedPropertyNames : Set<string>;
export function setUsed_property_names(used_property_names : Set<string>){
    usedPropertyNames = used_property_names;
}

// ts\shape.ts

export function getModeColor(mode : ShapeMode) : string {
    return modeColorMap.get(mode)!;
}

export function modePointRadius(mode : ShapeMode) : number {
    return (mode == ShapeMode.none ? 1 : 2) * GlobalState.Point__radius!;
}

// ts\statement.ts

export async function makeSelectionDlg(){    
    const data : [string, string, (typeof LengthEqualityReason | typeof AngleEqualityReason | typeof ShapeType | 
        typeof ParallelogramReason | typeof RhombusReason | typeof IsoscelesTriangleReason | typeof ParallelReason | typeof ShapeEquationReason | typeof ExprTransformReason | typeof PropositionReason)][] = [ 
        [ TT("Reason for length equality"), "length-equality-reason", LengthEqualityReason ],
        [ TT("Reason for angle equality" ), "angle-equality-reason" , AngleEqualityReason ],
        [ TT("Shape type"                ), "shape-type"            , ShapeType ],
        [ TT("Reason for parallelogram"  ), "parallelogram-reason"  , ParallelogramReason ],
        [ TT("Reason for rhombus"        ), "rhombus-reason"        , RhombusReason ], 
        [ TT("Reason for isosceles triangle"), "isosceles-triangle-reason", IsoscelesTriangleReason ],
        [ TT("Reason for parallel"       ), "parallel-reason"       , ParallelReason ], 
        [ TT("Equation derived from shapes" ), "shape-equation-reason"       , ShapeEquationReason ], 
        [ TT("Types of formula transformation"), "expr-transform-reason", ExprTransformReason ], 
        [ TT("Types of proposition"), "proposition-reason", PropositionReason ], 
    ];

    const titles = data.map(x => x[0]);
    const span_id_prefixes = data.map(x => x[1]);
    const dics = data.map(x => x[2]);

    menuDialogs.clear();
    for(const [idx, dic] of dics.entries()){
        const children : UI[] = [];

        const title = $label({
            text : titles[idx],
            borderWidth : 5,
            borderStyle : "ridge",
            padding : 5,
        });
        children.push(title);

        for(const [key, value] of Object.entries(dic)){
            if (isNaN(Number(key))){
                if(["none", "not_used"].includes(key)){
                    continue;
                }

                let img_name = enumToImgName.get(value);
                assert(img_name != undefined && img_name != "");

                // console.log(`of key:[${key}]${typeof key} value:[${value}]${typeof value} dic[value]:[${dic[value]}]`); 
                const img = $img({
                    id     : `${span_id_prefixes[idx]}-${key}`,
                    className : enumSelectionClassName,
                    imgUrl : `../plane/images/${img_name}.png`,
                    width  : "64px",
                    height : "64px",
                    borderWidth : 5,
                    borderStyle : "ridge",
                    horizontalAlign : "center",
                });
                img.html().dataset.operation_value = `${value}`;
                // img.html().style.position = "";

                children.push(img);
            }
        }

        const grid = $grid({
            children : children
        });

        const dlg = $dialog({
            content : grid
        });

        menuDialogs.set(dic, dlg);
    }
}

export async function speakReason(speech : AbstractSpeech, reason : number) {
    const reason_msg = reasonMsg(reason);
    await speech.speak(reason_msg);
}

export async function showAuxiliaryShapes(reason : number, auxiliaryShapes : MathEntity[]){
    switch(reason){
    case ParallelogramReason.each_opposite_sides_are_equal:
    case ParallelogramReason.each_opposite_sides_are_parallel:
    case ParallelogramReason.each_opposite_angles_are_equal:
    case ParallelogramReason.each_diagonal_bisections:
        assert(auxiliaryShapes.length == 4);

        for(const shape of auxiliaryShapes.slice(0, 2)){
            shape.setMode(ShapeMode.depend1);
        }
        await sleep(500);

        for(const shape of auxiliaryShapes.slice(2)){
            shape.setMode(ShapeMode.depend2);
        }
        break;

    case ParallelogramReason.one_opposite_sides_are_parallel_and_equal:
    case RhombusReason.all_sides_are_equal:
        auxiliaryShapes.forEach(x => x.setMode(ShapeMode.depend));
        break;

    default:
        for(const shape of auxiliaryShapes){
            shape.setMode(ShapeMode.depend);
            await sleep(500);
        }
        break;
    }

    await sleep(500);
}

// ts\tool.ts

function initToolList(){
    if(appMode == AppMode.edit){
        toolList.push(... editToolList);
    }
}

export function makeShapeButton(shape : MathEntity, in_shape_history : boolean) : Button {
    let shape_img_name : string | undefined;

    for(const [ tool, img_name, title, shape_classes] of toolList){
        if(shape_classes.some(x => x.name == shape.constructor.name)){

            shape_img_name = img_name;
            break;
        }
    }

    if(shape_img_name == undefined){
        if( AppServices.isPolygon(shape)){
            shape_img_name = "polygon";
        }
        else{

            throw new MyError(`unknown shape class name:[${shape.constructor.name}]`);
        }
    }

    const button = $button({
        url    : `${urlBase}/../plane/images/${shape_img_name}.png`,
        width  : "20px",
        height : "20px",
    });

    button.click = async (ev : MouseEvent)=>{
        if(in_shape_history){
            PlayBack__setStartIndex(shape);

            if(button.parent == GlobalState.Plane__one!.shapes_block && AppServices.isStatement(shape)){
                AppServices.Builder__setToolByShape(shape);
            }

            AppServices.showProperty(shape, 0);
        }

        GlobalState.View__current!.resetMode();
        shape.setMode(ShapeMode.target);
    };

    return button;
}

export function addToShapeHistory(shape : MathEntity){
    const button = makeShapeButton(shape, true);
    
    GlobalState.Plane__one!.shapes_block.addChild(button);
    assert(GlobalState.Plane__one!.shapes_block.children.length == GlobalState.View__current!.shapes.length);
    Layout.root.updateRootLayout();
}

export function pushShapeList(ui : UI){
    GlobalState.Plane__one!.shapes_block.addChild(ui);
    Layout.root.updateRootLayout();
}

export function popShapeList() : UI | undefined {
    const child = GlobalState.Plane__one!.shapes_block.popChild();
    Layout.root.updateRootLayout();
    return child;
}

export function clearShapeList(){
    GlobalState.Plane__one!.shapes_block.clear();
    Layout.root.updateRootLayout();
}

export function makeToolButtons() : RadioButton[] {
    initToolList();

    const tool_buttons : RadioButton[] = [];

    for(const [ tool, img_name, title, shapes] of toolList){
        const id = `${tool.name}-radio`;
        const radio = $radio({
            id,
            value : tool.name,
            title : title,
            url   : `${urlBase}/../plane/images/${img_name}.png`,
            width : "36px",
            height : "36px",
        });

        tool_buttons.push(radio);
    }    

    return tool_buttons;
}

export function makeToolByType(tool_name: string): Builder {
    for(const [ tool, img_name, title, shapes] of toolList){
        if(tool.name == tool_name){
            return new tool()
        }
    }

    throw new MyError();
}

// ts\view.ts

export function recalc(shape : MathEntity, changed : Set<MathEntity>){
    const dependencies = shape.dependencies();
    for(const dep of dependencies){
        recalc(dep, changed);
    }

    if( AppServices.isShape(shape) && dependencies.some(x => changed.has(x)) ){
        shape.calc();

        changed.add(shape);
    }
}

export function modeLineWidth(mode : ShapeMode) : number {
    return (mode == ShapeMode.none ? defaultLineWidth : OverLineWidth);    
}



export function showPrompt(text : string){
    const dlg = $dlg("help-dlg");
    $("help-msg").innerText = text;

    // dlg.remove();
    // document.body.append(dlg);

    dlg.show();
    const timeout = (getPlayMode() == PlayMode.fastForward ? 50 : 3000);
    setTimeout(()=>{
        dlg.close();
    }, timeout);
}

// ts\deduction\parallel_detector.ts

// ts\deduction\shape_equation.ts

export function isEquationTextBlock(x : MathEntity | undefined) : boolean {
    if(x == undefined){
        return false;
    }

    const guards = [AppServices.isAngleEqualityConstraint , AppServices.isAssumption , AppServices.isExprTransform , AppServices.isShapeEquation];
    return guards.some(c => c(x));
}

export async function makeSumOfAnglesIsPi(angles_arg: Angle[]) : Promise<ShapeEquation | undefined>  {
    const angles_list = permutation(angles_arg);
    for(const angles of angles_list){
        if( range(angles.length - 1).every( i => angles[i].commonLineBA(angles[i + 1]) ) ){
            const [first_angle, last_angle] = [ angles[0], last(angles) ];
            if(first_angle.lineA == last_angle.lineB && first_angle.directionA == - last_angle.directionB){

                const text = angles.map(x => x.name).join(" + ") + " = pi";
                return await AppServices.makeShapeEquationByEquationText(ShapeEquationReason.sum_of_angles_is_pi, angles, text);
            }
        }
    }

    return undefined;
}


export async function makeSumOfAnglesIsEqual(angles_arg: Angle[]) : Promise<ShapeEquation | undefined>  {
    check(3 <= angles_arg.length);
    const angles_list = permutation(angles_arg);
    for(const angles of angles_list){
        const outer_angle = angles[0];
        const inner_angles = angles.slice(1);
        if(outer_angle.commonLineAA(inner_angles[0]) && outer_angle.commonLineBB(last(inner_angles))){
            if(range(inner_angles.length - 1).every(i => inner_angles[i].commonLineBA(inner_angles[i + 1]))){
                const text = `${outer_angle.name} = ` + inner_angles.map(x => x.name).join(" + ");
                return await AppServices.makeShapeEquationByEquationText(ShapeEquationReason.sum_of_angles_is_equal, angles, text);
            }
        }
    }

    return undefined;
}

export async function makeShapeEquationByExteriorAngleTheorem(angles: Angle[]) : Promise<ShapeEquation | undefined>  {
    for(const [angle1, angle2, angle3] of permutation(angles)){
        if(angle1.lineA == angle2.lineB && angle1.directionA == - angle2.directionB){
            const intersection = getCommonPointOfLines(angle1.lineB, angle2.lineA);
            if(angle3.intersection == intersection){
                if(areSetsEqual([angle1.lineB, angle2.lineA], [angle3.lineA, angle3.lineB])){

                    const text = `${angle1.name} + ${angle2.name} = ${angle3.name}`;
                    return await AppServices.makeShapeEquationByEquationText(ShapeEquationReason.exterior_angle_theorem, angles, text);    
                }
            }
        }
    }

    return undefined;
}

export async function makeSumOfTriangleQuadrilateralAngles(angles: Angle[], reason : ShapeEquationReason) : Promise<ShapeEquation | undefined>  {
    let num_vertices : number;
    let sum_angles : string;
    if(reason == ShapeEquationReason.sum_of_interior_angles_of_triangle_is_pi){
        num_vertices = 3;
        sum_angles   = "pi";
    }
    else{
        num_vertices = 4;
        sum_angles   = "2 * pi";
    }

    check(angles.length == num_vertices);
    check(angles.every(x => x.name != ""));

    const text = angles.map(x => x.name).join(" + ") + " = " + sum_angles;
    return await AppServices.makeShapeEquationByEquationText(reason, angles, text);
}


export async function makeShapeEquation(reason : ShapeEquationReason, shapes: Shape[]) : Promise<ShapeEquation | undefined>  {
    switch(reason){
    case ShapeEquationReason.sum_of_angles_is_pi:
    case ShapeEquationReason.sum_of_angles_is_equal:
    case ShapeEquationReason.exterior_angle_theorem:{
        check(shapes.every(x => AppServices.isAngle(x) && x.name != ""), TT("The selected shapes are not named angles."));
        const angles = shapes as Angle[];

        if(reason == ShapeEquationReason.exterior_angle_theorem){
            return await makeShapeEquationByExteriorAngleTheorem(angles);
        }

        const intersections = unique(angles.map(x => intersection));
        if(intersections.length != 1){
            msg(TT("The vertices of the angles do not match."));
            return undefined;
        }

        if(reason == ShapeEquationReason.sum_of_angles_is_pi){

            return await makeSumOfAnglesIsPi(angles);
        }
        else{

            return await makeSumOfAnglesIsEqual(angles);
        }
    }

    case ShapeEquationReason.sum_of_interior_angles_of_triangle_is_pi:
    case ShapeEquationReason.sum_of_interior_angles_of_quadrilateral_is_2pi:{

        assert(shapes.every(x => AppServices.isPoint(x)));
        const angles = findAnglesInPolygon(shapes as Point[]);

        return await makeSumOfTriangleQuadrilateralAngles(angles, reason);
    }

    default:
        throw new MyError();
    }
}

// ts\deduction\shape_equation.ts

// ts\deduction\triangle_congruence.ts


export function Angle__setEqualAngleMarks(angles : Angle[]){
    assert(angles.length == 2 && angles.every(x => AppServices.isAngle(x)));

    const named_angle = angles.find(x => x.name != "");
    if(named_angle != undefined){
        for(const angle of angles){
            if(angle != named_angle){
                angle.setAngleMark(GlobalState.Angle__DefaultAngleMark);
                angle.setName(named_angle.name);    
            }
        }

        return;
    }
    
    for(const [angle1, angle2] of permutation([angles[0], angles[1]])){
        if(angle1.intersection == angle2.intersection){
            if(angle1.lineA == angle2.lineB && angle1.lineB == angle2.lineA){

                // msg("Angle Equality:Since the two angles bisect the line, they are right angles.");
                angles.forEach(x => x.setAngleMark(GlobalState.Angle__RightAngleMark));
                return;
            }
        }
    }

    if(angles.some(x => x.isRightAngle())){
        // msg("Angle Equality:Since one angle is a right angle, the other angle is also a right angle.");
        angles.forEach(x => x.setAngleMark(GlobalState.Angle__RightAngleMark));
    }
    else{

        const max_angleMark = Math.max(... angles.map(x => x.angleMark));
        if(max_angleMark != GlobalState.Angle__DefaultAngleMark){
            angles.forEach(x => x.angleMark = max_angleMark);
        }
        else{
            const all_angles = GlobalState.View__current!.allShapes().filter(x => AppServices.isAngle(x));
            if(all_angles.length == 0){

                angles.forEach(x => x.angleMark = GlobalState.Angle__DefaultAngleMark + 1);
            }
            else{

                const max_all_angleMark = Math.max(... all_angles.map(x => x.angleMark));
                angles.forEach(x => x.angleMark = max_all_angleMark + 1);
            }
        }
    }
}


export function LengthSymbol__setEqualLengthKinds(lengthSymbols : LengthSymbol[]){
    assert(lengthSymbols.every(x => AppServices.isLengthSymbol(x)));
    
    const max_lengthKind = Math.max(... lengthSymbols.map(x => x.lengthKind));
    if(max_lengthKind != GlobalState.LengthSymbol__DefaultLengthKind){
        lengthSymbols.forEach(x => x.lengthKind = max_lengthKind);
    }
    else{
        const all_lengthSymbols = GlobalState.View__current!.allShapes().filter(x => AppServices.isLengthSymbol(x));
        if(all_lengthSymbols.length == 0){

            lengthSymbols.forEach(x => x.lengthKind = GlobalState.LengthSymbol__DefaultLengthKind + 1);
        }
        else{

            const max_all_lengthKind = Math.max(... all_lengthSymbols.map(x => x.lengthKind));
            lengthSymbols.forEach(x => x.lengthKind = max_all_lengthKind + 1);
        }
    }
}

export function PlayBack__setStartIndex(shape : MathEntity){
    if(GlobalState.playBackOperations != undefined){
        const index = GlobalState.playBackOperations.shapeToIndex.get(shape);
        if(index != undefined){
            GlobalState.PlayBack__startIndex = index;
            msg(`play start:${GlobalState.PlayBack__startIndex}`);
        }
    }
}


export function Point__zero() : Point {
    return AppServices.Point__fromArgs(Vec2.zero());
}

export function Arc__getAngles(center : Point | Vec2, pointA : Point | Vec2, pointB : Point | Vec2) : [number, number] {
    const center_pos = ( AppServices.isPoint(center) ? center.position : center);
    const pointA_pos = ( AppServices.isPoint(pointA) ? pointA.position : pointA);
    const pointB_pos = ( AppServices.isPoint(pointB) ? pointB.position : pointB);

    return [pointA_pos, pointB_pos].map(p => p.sub(center_pos)).map(v => Math.atan2(v.y, v.x)) as [number, number];
}

export async function Builder__builderResetTool(view : View){
    while(view.operations.length != 0){
        if( AppServices.isToolSelection(last(view.operations))){
            break;
        }
        view.operations.pop();
    }
    view.operations.forEach(x => msg(x.dump()));

    GlobalState.Builder__tool!.resetTool(undefined);
    
    await AppServices.Builder__setToolByName(GlobalState.Builder__toolName!, false);
}

export function Builder__cancelTool(){
    const view = GlobalState.View__current!;
    while(view.operations.length != 0){
        const last_operation = last(view.operations);
        if( AppServices.isToolSelection(last_operation)){
            msg(`cancel tool:${last_operation.toolName}`);
            break;
        }
        view.operations.pop();
    }
}

export function getEquationOfTextBlock(self : TextBlock) : App | undefined {
    if(AppServices.isEquationTextBlock(self.parent)){
        return (self.parent as EquationTextBlockClass).equation;
    }

    return undefined;
}

export async function texClickOfTextBlock(self : TextBlock, ev : MouseEvent) : Promise<void> {
    if(AppServices.isExprTransformBuilder(GlobalState.Builder__tool)){
        const srcTermRect = self.getClickedTermRect(ev.clientX, ev.clientY);

        const dstTermRect = GlobalState.Builder__tool.getDstTermRect(self.termRects, srcTermRect);
        const dstTerm = dstTermRect.term;
        
        if(!GlobalState.View__isPlayBack){
            const path = dstTerm.getPath();

            const operation = AppServices.makeClickTerm(self.id, path.indexes);

            GlobalState.View__current!.addOperation(operation);
        }

        await GlobalState.Builder__tool.termClick(dstTerm, self);
    }
}

export function getTextOfTextBlock(self : TextBlock) : string {
    let text = self.text;
    if(text == "" && AppServices.isShape(self.parent)){
        text = self.parent.name;
    }
    return text;
}


console.log(`Loaded: all-functions`);
