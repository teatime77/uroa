import { AbstractSpeech, appMode, AppMode, areSetsEqual, assert, isSubSet, msg, MyError, permutation, PlayMode, range, setPlayMode, sleep, Speech, unique, Vec2 } from "@i18n";
import { AbstractLine, CircleArc, LineByPoints, Point, Quadrilateral, Shape, Triangle } from "./shape";
import { transpose, addEquations, substitute, divideEquation } from "@algebra";
import { Grid, UI, RadioButton, closeDlg, Layout, $grid, $dialog } from "@layout";
import { App, Term, RefVar, renderKatexSub, parseMath } from "@parser";

import { LineKind, AngleEqualityReason, ExprTransformReason, LengthEqualityReason, ParallelReason, PropositionReason, ParallelogramReason, RhombusReason, ShapeEquationReason, TriangleCongruenceReason, IsoscelesTriangleReason, TriangleSimilarityReason } from "./enums";
import { GlobalState, menuDialogs, enumSelectionClassName, Angle__numMarks, lineKindImgNames, propertySettingText, congruentTriangles, similarTriangles, isoscelesTriangle, parallelogramClassifiers, pointsToLengthSymbol, equalLengths, AppServices } from "./inference";
import { MathEntity, Widget, TextBlock, textBlockEvent } from "./json";
import { convertOperations, initPlay, makeCssClass, makeCanvas, makeSelectionDlg, Builder__builderResetTool, movePointerAndHighlight, waitForClick, reasonMsg, movePointerToElement, typeIntoInput, getCommonPointOfLines, isParallel, toClockwisePoints, areEqualCircleArcs, getParallelogramClassifier, getParallelogramsByDiagonalLengthSymbols, isEqualAngle, findEqualLengthsByPointsPair, getParallelLinesByPointsPair, findEqualAnglesBy3pointsPair, getCommonLineOfPoints, isEqualLength, speakReason, showAuxiliaryShapes, pairKey, findAngle, makeToolByType, dropEvent, appendTitle, makeConstantProperty, makeTexProperty, appendRow, findTrianglePairByAngles, getAngleUnitVectors, setEqualShapes, findTrianglePairByLengthSymbols, getCommonPoint, usedPropertyNames, setUsed_property_names, findParallelLinesOfLengthSymbols } from "./all_functions";

import { AngleEquality } from "./deduction/angle_equality";
import { ExprTransform } from "./deduction/expr_transform";
import { LengthEquality } from "./deduction/length_equality";
import { ParallelDetector } from "./deduction/parallel_detector";
import { ShapeProposition, EquationProposition } from "./deduction/proposition";
import { ParallelogramClassifier, RhombusClassifier } from "./deduction/quadrilateral";
import { EquationTextBlockClass, ShapeEquation } from "./deduction/shape_equation";
import { TriangleCongruence } from "./deduction/triangle_congruence";
import { TriangleDetector } from "./deduction/triangle_detector";
import { TriangleSimilarity } from "./deduction/triangle_similarity";
import { Angle, LengthSymbol } from "./dimension_symbol";
import { AngleBisector } from "./geometry";
import { Operation, ClickShape, ToolSelection, ToolFinish, EnumSelection, TextPrompt, PropertySetting, PlayBack } from "./operation";
import { Plane } from "./plane_ui";
import { InputProperty, TextAreaProperty, SelectProperty, ImgSelectionProperty, ShapesProperty, ColorProperty, StringProperty, NumberProperty, BooleanProperty, Property } from "./property";
import { menuDialogType, Statement } from "./statement";
import { SelectionTool, TriangleCongruenceBuilder, LengthEqualityBuilder, StatementBuilder } from "./tool";
import { isTextPrompt, isShapeEquationBuilder, isExprTransformBuilder, isEnumSelection, isWidget, isTextBlock, isAngle, isMathEntity, isPropertySetting, isTriangleCongruence, isLengthEquality } from "./type_guards";
import { View } from "./view";

export async function loadOperationsText(data : any) : Promise<Operation[]> {
    let lines : string[];

    if(2 <= data["version"]){
        lines = data["operations"];
        assert(Array.isArray(lines) && (lines.length == 0 || typeof lines[1] == "string"));
    }
    else{
        msg(`data is empty.`);
        lines = [];
    }

    const view = GlobalState.View__current!;
    view.clearCanvas();

    let operations : Operation[] = [];

    let prev_line : string = "";
    for(let line of lines){
        line = line.trim().replaceAll(/\s+/g, " ");        
        if(line == ""){
            continue;
        }
        if(prev_line == line && line.startsWith("property")){
            msg(`dup line:[${line}]`);
            continue;
        }
        prev_line = line;

        let operation : Operation;

        // msg(`load:${line}`);
        const items = line.split(" ");
        switch(items[0]){
        case "click":{
                const x = parseFloat(items[1]);
                const y = parseFloat(items[2]);
                let shapeId = undefined;
                if(4 <= items.length){
                    const n = parseInt(items[3]);
                    assert(! isNaN(n));
                    shapeId = `${n}`;
                }

                operation = new ClickShape(new Vec2(x, y), shapeId);
            }
            break;

        case "term":{
                const textBlock_id = `${parseInt(items[1])}`;
                let indexes : number[];
                if(items.length == 2){
                    indexes = [];
                }
                else{
                    indexes = items[2].split(":").map(x => parseInt(x));
                }
                operation = AppServices.makeClickTerm(textBlock_id, indexes);
            }
            break;

        case "tool":
            operation = new ToolSelection(items[1]);
            break;

        case "finish":
            operation = new ToolFinish(items[1]);
            break;
            
        case "enum":{
                const enum_id = parseInt(items[1]);
                operation = new EnumSelection(enum_id);
            }
            break;

        case "text":{
                const regex = /text\s+'?([^']+)'?/;
                const matches = line.match(regex);
                assert(matches != null);

                const items2 = Array.from(matches!);
                // msg(`text len:${items2.length} [${items2[1]}]`);

                const text = items2[1];
                operation = new TextPrompt(text);
            }
            break;

        case "property":{
                const regex = /property\s+(\d+)\s+([0-9a-zA-Z_]+)\s+'?([^']+)'?/;
                const matches = line.match(regex);
                assert(matches != null);

                const items2 = Array.from(matches!);
                assert(items2.length == 4);

                const [id, name, value_str] = items2.slice(1);
                let value : string | number;

                if(line.endsWith("'")){
                    value = value_str;
                }
                else{
                    value = parseFloat(value_str);
                }
                operation = new PropertySetting(`${parseInt(id)}`, name, value);
            }
            break;

        default:
            throw new MyError();
        }

        operations.push(operation);
    }

    operations = convertOperations(data["version"], operations);

    return operations;
}

export async function loadOperationsJSON(data: any): Promise<Operation[]> {
    const view = GlobalState.View__current!;
    view.clearCanvas();

    let operations: Operation[] = [];

    for (const opData of data.operations) {
        let operation: Operation;

        switch (opData.op) {
            case "click": {
                const position = new Vec2(opData.x, opData.y);
                operation = new ClickShape(position, opData.shapeId);
                break;
            }

            case "term": {
                operation = AppServices.makeClickTerm(opData.textBlock_id, opData.indexes);
                break;
            }

            case "tool": {
                operation = new ToolSelection(opData.name);
                break;
            }

            case "finish": {
                operation = new ToolFinish(opData.name);
                break;
            }

            case "enum": {
                operation = new EnumSelection(opData.value);
                break;
            }

            case "text": {
                operation = new TextPrompt(opData.text);
                break;
            }

            case "property": {
                operation = new PropertySetting(opData.id, opData.name, opData.value);
                break;
            }

            default:
                throw new MyError(`Unknown operation op: ${opData.op}`);
        }

        operations.push(operation);
    }

    // 既存の変換・後処理があれば通す（必要に応じて）
    // operations = convertOperations(data.version, operations);

    return operations;
}


export function inputTextPrompt(message : string) : string | null {
    let text : string | null;

    if(GlobalState.View__isPlayBack){

        const operation = GlobalState.playBackOperations!.next();
        GlobalState.View__current!.addOperation(operation);
        if( isTextPrompt(operation)){
            text = operation.text;
        }
        else{
            throw new MyError();
        }
    }
    else{

        text = prompt(message);
        if(text != null){
            GlobalState.View__current!.addOperation(new TextPrompt(text.trim()));
        }
    }
    
    return text;
}


export async function playBack(play_mode : PlayMode){
    const view : View = GlobalState.View__current!;

    const operations_copy = view.operations.slice();
    view.restoreView();
    view.clearCanvas();

    if(!isNaN(GlobalState.PlayBack__startIndex)){
        play_mode = PlayMode.fastForward;
    }
    
    setPlayMode(play_mode);

    GlobalState.playBackOperations = new PlayBack(view, operations_copy);

    assert(view.shapes.length == 0);

    await GlobalState.playBackOperations.play();

    view.restoreView();

    view.dirty = true;
    view.updateShapes();
}

export async function initPlane(plane : Plane, root : Grid){
    initPlay();
    makeCssClass();

    plane.tool_block.onChange = async (ui : UI)=>{
        const button = ui as RadioButton;

        const tool_name = button.button.value;
        await AppServices.Builder__setToolByName(tool_name, true);
    }

    const canvas = makeCanvas(plane.canvas_block.div);

    const view = new View(canvas);

    viewEvent(view);

    await AppServices.Builder__setToolByName(SelectionTool.name, false);

    await makeSelectionDlg();
}

export function viewEvent(view : View){
    view.canvas.addEventListener("click"      , async (ev : MouseEvent)=>{
        await view.click(ev);
    }); 

    view.canvas.addEventListener("dblclick"   , async (ev : MouseEvent)=>{
        await view.dblclick(ev);
    });

    view.canvas.addEventListener("contextmenu", async (ev : MouseEvent)=>{
        msg("contextmenu");
        ev.stopPropagation();
        ev.preventDefault();

        const position = view.getPositionInCanvas(ev);
        const shape = view.getShape(position);
        if(shape != undefined){
            await showPropertyDlg(shape, undefined);
        }
    })

    document.addEventListener('keydown', async (ev : KeyboardEvent) => {
        if(GlobalState.View__isPlayBack){
            return;
        }

        await textBlockEvent.keyDown(ev);

        if (ev.key === "Escape") {
            msg("Escape key pressed!");
            const closed = closeDlg();
            if(closed){
                return;
            }
            
            await Builder__builderResetTool(view);
        }
        else if(ev.key == "Enter"){
            if( isShapeEquationBuilder(GlobalState.Builder__tool) ||  isExprTransformBuilder(GlobalState.Builder__tool)){

                view.addOperation(new ToolFinish(GlobalState.Builder__toolName!));
                await GlobalState.Builder__tool.finish(view);
            }
        }
    });    

    window.addEventListener("resize", view.resizeCanvas.bind(view));

    // Passive event listeners
    // https://github.com/WICG/EventListenerOptions/blob/gh-pages/explainer.md
    view.canvas.addEventListener("wheel"      , view.wheel.bind(view), {"passive" : false } );

    dropEvent(view);
    
    window.requestAnimationFrame(view.drawShapes.bind(view));
}

export async function showMenu(dlgType : menuDialogType) : Promise<number> {
    const dlg = menuDialogs.get(dlgType)!;
    assert(dlg != undefined);
    dlg.showModal();
    
    let value : number

    if(GlobalState.View__isPlayBack){
        const operation = GlobalState.playBackOperations!.next();
        // msg(`show Menu:${operation.dump()}`);
        GlobalState.View__current!.addOperation(operation);
        if( isEnumSelection(operation)){

            const items = Array.from(dlg.html().getElementsByClassName(enumSelectionClassName)) as HTMLElement[];

            const enum_value = `${operation.value}`;
            const item  = items.find(x => x.dataset.operation_value == enum_value)!;
            assert(item != undefined);
            await movePointerAndHighlight(item);

            value = operation.value;
        }
        else{
            throw new MyError();
        }
    }
    else{

        value = await waitForClick(dlg.html());

        GlobalState.View__current!.addOperation(new EnumSelection(value));
    }

    dlg.close();

    return value
}

export function showProperty(widget : Widget | Widget[], nest : number) : void {    
    if(nest == 0){
        setUsed_property_names(new Set<string>());
    }

    let widgets : Widget[];
    if( isWidget(widget)){
        widgets = [widget];
    }
    else{
        widgets = widget;
    }

    let properties : string[] = [];
    for(const [idx, w] of widgets.entries() ){
        const names = w.getProperties();
        if(idx == 0){
            properties = names;
        }
        else{
            properties = properties.filter(x => names.includes(x));
        }
    }

    const grid = GlobalState.Plane__one!.property_block;
    if(nest == 0){
        grid.clear();
    }

    const constructor_names = unique(widgets.map(x => x.constructor.name));
    for(const constructor_name of constructor_names){
        appendTitle(grid, nest, constructor_name);
    }


    for(const property_name of properties){
        assert(typeof property_name == "string");

        if(usedPropertyNames.has(property_name)){
            continue;
        }

        if(appMode == AppMode.play){
            if(![ "name", "reason", "selectedShapes", "auxiliaryShapes" ].includes(property_name)){
                continue;
            }
        }

        const name = property_name;
        const value = (widgets[0] as any)[name];
        if(value == undefined){
            continue;
        }

        let property : InputProperty | TextAreaProperty | SelectProperty | ImgSelectionProperty | ShapesProperty;

        if(name == "mathText" || name == "text" &&  isTextBlock(widget)){

            property = new TextAreaProperty(widgets, name, value as string);
        }
        else if(name == "angleMark"){

            const angles = widgets.filter(x => isAngle(x)) as Angle[];

            const img_names = range(Angle__numMarks).map(i => `angle_${i}`);

            property = new ImgSelectionProperty(angles, name, value, img_names);
        }
        else if(name == "reason"){

            const text = reasonMsg(value);
            makeConstantProperty(grid, nest + 1, name, text);
            continue;
        }
        else if(name == "equation"){
            assert(value instanceof App);
            makeTexProperty(grid, nest + 1, name, (value as App).tex());
            continue;
        }
        else if(name == "terms"){
            assert(Array.isArray(value));
            const terms = value as Term[];
            assert(terms.every(x => x instanceof Term));

            const text = terms.map(x => x.tex()).join("\\quad , \\quad");
            makeTexProperty(grid, nest + 1, name, text);
            continue;
        }
        else if(name == "selectedShapes" || name == "auxiliaryShapes"){

            property = new ShapesProperty(widgets, name, value);
        }
        else if(name == "line"){

            property = new ShapesProperty(widgets, name, [value]);
        }
        else{
            switch(typeof value){
            case "string":
                if(name == "color"){

                    property = new ColorProperty(widgets, name, value);
                }
                else{

                    property = new StringProperty(widgets, name, value);
                }
                break;
                
            case "number":
                if(name == "interval"){
                    property = new NumberProperty(widgets, name, value, 0.1, 0, 10000);
                }
                else if(name == "lineKind"){
                    property = new ImgSelectionProperty(widgets, name, value, lineKindImgNames);
                }
                else if(name == "lengthKind"){
                    property = new NumberProperty(widgets, name, value, 1, 0, 3);
                }
                else if(name == "id" || name == "order"){
                    makeConstantProperty(grid, nest + 1, name, `${value}`);
                    continue;
                }
                else{
                    property = new NumberProperty(widgets, name, value, 0.1, -100, 100);
                }
                break;
                
            case "boolean":
                property = new BooleanProperty(widgets, name, value);
                break;
                
            case "object":
                if( isWidget(value)){
                    showProperty(value, nest + 1);
                }
                else if(value instanceof Vec2){
                    const text = `x:${value.x.toFixed(1)} y:${value.y.toFixed(1)}`;
                    makeConstantProperty(grid, nest + 1, name, text);
                }
                else{
                    msg(`unknown property:${value.constructor.name}`);
                }

                continue;

            default:
                throw new MyError();
            }
        }

        try{
            const ui = property.ui();
            appendRow(grid, nest + 1, property.name, ui);
        }
        catch(e){
            msg(`no property:${property.name}`);
        }        

        usedPropertyNames.add(property_name);
    }

    if(appMode == AppMode.play){
        return;
    }

    if(nest == 0 &&  isMathEntity(widget)){
//++++++++++        appendDelete(tbl, widget);
    }

    Layout.root.updateRootLayout();
}

export async function showPropertyDlg(widget : Widget, operation :PropertySetting | undefined) : Promise<void>{
    const basic_names = [ "name", "lineKind", "angleMark"  ]
    const names = widget.getProperties().filter(x => basic_names.includes(x));

    const grid = $grid({
        columns  : "50% 50%",
        children : [],
    });

    const propertyMap = new Map<string, Property>();

    for(const name of names){
        const value = (widget as any)[name];
        if(value == undefined){
            continue;
        }

        let property : InputProperty | TextAreaProperty | SelectProperty | ImgSelectionProperty | ShapesProperty;

        switch(name){
        case "name":
            property = new StringProperty([widget], name, value);
            break;

        case "lineKind":
            property = new ImgSelectionProperty([widget], name, value, lineKindImgNames);
            break;

        case "angleMark":{
                const img_names = range(Angle__numMarks).map(i => `angle_${i}`);
                property = new ImgSelectionProperty([widget], name, value, img_names);
            }
            break;

        default:
            continue;
        }

        propertyMap.set(name, property);

        const ui = property.ui();
        appendRow(grid, 1, property.name, ui);
    }

    const dlg = $dialog({
        content : grid
    });

    dlg.showModal();

    if(GlobalState.View__isPlayBack){
        if( isPropertySetting(operation)){
            // View.current.addOperation(operation);

            const text = propertySettingText.get(operation.name)!;
            assert(text != undefined);

            const speech = AbstractSpeech.one;
            await speech.speak(text);
            // msg(`opr ${operation.id} ${operation.toString()}`);

            const property = propertyMap.get(operation.name)!;
            assert(property != undefined);

            let item : HTMLElement;
            switch(operation.name){
            case "angleMark":
            case "lineKind":{
                    const value = operation.value as number;

                    const all_buttons = Array.from(dlg.html().getElementsByTagName("button")) as HTMLButtonElement[];
                    const buttons = all_buttons.filter(x => x.dataset.property_name == operation.name);
                    item  = buttons.find(x => x.dataset.operation_value == `${operation.value}`)!;
                    assert(item != undefined);
                    await movePointerAndHighlight(item);

                    if(operation.name == "angleMark"){
                        (widget as Angle).setAngleMark(value);
                    }
                    else{
                        (widget as AbstractLine).lineKind = value;
                    }
                }

                break;

            case "name":{
                    const input = (property as StringProperty).input.html() as HTMLInputElement;

                    await movePointerToElement(input);
                    await typeIntoInput(input, operation.value as string);
                    (widget as Shape).setName(operation.value as string);
                }
                break;
            
            default:
                throw new MyError();
            }

            await speech.waitEnd();
        }
        else{
            throw new MyError();
        }
    }
    else{

        await waitForClick(dlg.html());

        // View.current.addOperation(new EnumSelection(value));
    }

    dlg.close();
}

export function makeLineSegment(pointA: Point, pointB: Point) : LineByPoints {
    return new LineByPoints({ lineKind : LineKind.line_segment, pointA, pointB });
}

export function makeRay(pointA: Point, pointB: Point) : LineByPoints{
    return new LineByPoints({ lineKind : LineKind.ray, pointA, pointB });
}

export function makeAngleEqualityByCongruentTriangles(angleA : Angle, angleB : Angle) : AngleEquality | undefined {
    const triangleAB = findTrianglePairByAngles(angleA, angleB, congruentTriangles);
    if(triangleAB != undefined){
        const [triangleA, triangleB] = triangleAB;

        // msg(`equal angle:congruent triangles`);
        return new AngleEquality({
            reason : AngleEqualityReason.congruent_triangles,
            auxiliaryShapes : [
                triangleA, triangleB
            ],
            shapes : [
                angleA, angleB
            ]
        });        
    }
    else{

        msg(`can not find congruent triangles`);

        return undefined;
    }
}

export function makeAngleEqualityBySimilarTriangles(angleA : Angle, angleB : Angle) : AngleEquality | undefined {
    const triangleAB = findTrianglePairByAngles(angleA, angleB, similarTriangles);
    if(triangleAB != undefined){
        const [triangleA, triangleB] = triangleAB;
        return new AngleEquality({
            reason : AngleEqualityReason.similar_triangles,
            auxiliaryShapes : [ triangleA, triangleB ],
            shapes : [ angleA, angleB ]
        });
    }
    else{

        msg(`can not find similar triangles`);

        return undefined;
    }
}

export function makeAngleEqualityByIsoscelesTriangleBaseAngles(angleA : Angle, angleB : Angle) : AngleEquality | undefined {
    for(const [angle1, angle2] of permutation([angleA, angleB])){
        if(angle1.lineA == angle2.lineB && angle1.directionA == - angle2.directionB){
            const triangle = isoscelesTriangle.find(x => x.points[1] == angle1.intersection && x.points[2] == angle2.intersection);
            if(triangle == undefined){
                return undefined;
            }

            const vertex = getCommonPointOfLines(angle1.lineB, angle2.lineA);
            if(vertex != triangle.points[0]){
                return undefined;
            }

            return new AngleEquality({
                reason : AngleEqualityReason.isosceles_triangle_base_angles,
                auxiliaryShapes : [ triangle ],
                shapes : [ angleA, angleB ]
            });
        }
    }

    return undefined;
}

export function makeAngleEqualityByVertical_angles(angleA : Angle, angleB : Angle) : AngleEquality | undefined {
    if(angleA.intersection == angleB.intersection){
        // msg("intersectionA == intersectionB");
        if(angleA.lineA == angleB.lineA && angleA.lineB == angleB.lineB){
            // msg("lineAA == lineBB & lineAB == lineBB");

            const [ e_AA, e_AB, e_BA, e_BB ] = getAngleUnitVectors(angleA, angleB);
            if(Math.sign(e_AA.dot(e_BA)) == -1 && Math.sign(e_AB.dot(e_BB)) == -1){
                // msg(`equal angle:vertical angle`);
                return new AngleEquality({
                    reason : AngleEqualityReason.vertical_angles,
                    auxiliaryShapes : [
                        angleA.lineA, angleA.lineB
                    ],
                    shapes : [
                        angleA, angleB
                    ]
                });
            }
            else{
                msg(`AA.BA = ${(e_AA.dot(e_BA)).toFixed(1)} : AB.BB = ${(e_AB.dot(e_BB)).toFixed(1)}`)                
            }
        }
        return undefined;
    }

    return undefined;
}

export function makeAngleEqualityByParallelLines(angleA : Angle, angleB : Angle) : AngleEquality | undefined {

    let angle_lines = unique([ angleA.lineA, angleA.lineB, angleB.lineA, angleB.lineB  ]);
    if(angle_lines.length != 3){
        msg("no cross line.");
        return undefined;
    }

    const cross_line = angle_lines.find(x => [ angleA.lineA, angleA.lineB ].includes(x) && [angleB.lineA, angleB.lineB].includes(x));
    assert(cross_line != undefined);

    const parallel_lines = angle_lines.filter(x => x != cross_line);
    assert(parallel_lines.length == 2);

    if(! isParallel(parallel_lines[0], parallel_lines[1])){
        msg("not parallel");
        return undefined;
    }

    let cross_sign : number;
    let parallel_sign : number;

    const [ e_AA, e_AB, e_BA, e_BB ] = getAngleUnitVectors(angleA, angleB);

    if(angleA.lineA == angleB.lineA && angleA.lineA == cross_line && areSetsEqual(parallel_lines, [angleA.lineB, angleB.lineB])){
        // msg("lineA == lineA");
    
        cross_sign    = Math.sign(e_AA.dot(e_BA));
        parallel_sign = Math.sign(e_AB.dot(e_BB));
    }
    else if(angleA.lineB == angleB.lineB && angleA.lineB == cross_line && areSetsEqual(parallel_lines, [angleA.lineA, angleB.lineA])){
        // msg("lineB == lineB");

        cross_sign    = Math.sign(e_AB.dot(e_BB));
        parallel_sign = Math.sign(e_AA.dot(e_BA));
    }
    else{
        msg("illegal angle");
        return undefined;
    }

    if(cross_sign * parallel_sign == 1){
        // msg(`equal angle:parallel lines`);
        return new AngleEquality({
            reason : AngleEqualityReason.parallel_line_angles,
            auxiliaryShapes : parallel_lines.concat(cross_line),
            shapes : [
                angleA, angleB
            ]
        });
    }
    else{
        msg("make-Equal-Angle:cross_sign * parallel_sign != 1");
        return undefined;
    }
}

export function makeAngleEqualityByAngleBisector(angleA : Angle, angleB : Angle, angle_bisector : AngleBisector) : AngleEquality {
    const [ lineA, lineB ] = [ angleA.lineA, angleB.lineB ];

    return new AngleEquality({
        reason          : AngleEqualityReason.angle_bisector,
        auxiliaryShapes : [ lineA, lineB, angle_bisector ],
        shapes          : [ angleA, angleB ]
    });
}

export function makeAngleEqualityByParallelogramOppositeAngles(angleA : Angle, angleB : Angle, parallelogram : Quadrilateral) : AngleEquality | undefined {
    if(! parallelogram.isParallelogram()){
        return undefined;
    }

    const intersections = [angleA.intersection, angleB.intersection];
    const [pt0, pt1, pt2, pt3] = parallelogram.points;

    if( areSetsEqual([pt0, pt2], intersections) || areSetsEqual([pt1, pt3], intersections ) ){

        const points = toClockwisePoints(parallelogram.points);
        let triad_pair : Point[][];
        if(intersections.includes(points[0])){
            triad_pair = [[points[3], points[0], points[1]], [points[1], points[2], points[3]]]
        }
        else{
            triad_pair = [[points[0], points[1], points[2]], [points[2], points[3], points[0]]]
        }

        const angles = [angleA, angleB];
        if(triad_pair[0][1] == angleB.intersection){
            triad_pair.reverse();
        }
        for(const [idx, triad] of triad_pair.entries()){
            const angle = angles[idx];
            assert(triad[1] == angle.intersection);
            if(angle.lineA.includesPoint(triad[2]) && angle.lineB.includesPoint(triad[0])){
                // msg(`equal angle:parallelogram`);
                return new AngleEquality({
                    reason : AngleEqualityReason.parallelogram_opposite_angles,
                    auxiliaryShapes : [parallelogram],
                    shapes : [
                        angleA, angleB
                    ]
                });        
            }
        }
    }

    return undefined;
}

// ts\deduction\expr_transform.ts

export async function makeExprTransformByTransposition(term : Term, textBlock : TextBlock, speech : Speech) : Promise<ExprTransform>{
    const [equation, term_cp] = term.cloneRoot();
    await transpose(equation, term_cp, textBlock.div, speech);

    const exprTransform = new ExprTransform({
        reason   : ExprTransformReason.transposition,
        equation : equation, 
        terms : [term_cp]
    });

    return exprTransform;
}

/*
    a = e , b = e ⇒ a = b
*/
export async function makeExprTransformByEquality(terms : Term[], textBlocks : TextBlock[], speech : Speech) : Promise<ExprTransform | undefined> {
    const refvars : RefVar[] = [];
    let   eq_expr : Term | undefined;    
    let   roots : App[] = [];

    for(const term of terms){
        const [equation, term_cp] = term.cloneRoot();
        if(!(term_cp instanceof RefVar)){
            return undefined;
        }

        if(!equation.isEq() || equation.args.length != 2){
            return undefined;
        }

        const term_idx = equation.args.indexOf(term_cp);
        if(term_idx == -1){
            return undefined;
        }

        const expr = equation.args[1 - term_idx];
        if(eq_expr == undefined){
            eq_expr = expr;
        }
        else{
            if(!eq_expr.equal(expr)){
                return undefined;
            }
        }

        refvars.push(term_cp);
        roots.push(term.getRoot());
    }

    for(const [idx, term] of terms.entries()){
        term.colorName = "blue";
        renderKatexSub(textBlocks[idx].div, roots[idx].tex());
    }
    await sleep(1000);
    refvars.forEach(x => x.colorName = undefined);

    const text = refvars.map(x => x.name).join(" = ");
    const equation = parseMath(text) as App;

    setEqualShapes(refvars);

    const exprTransform = new ExprTransform({
        reason   : ExprTransformReason.equality,
        equation : equation, 
        terms : refvars
    });

    return exprTransform;
}

export async function makeExprTransformByAddEquation(terms : Term[], textBlocks : TextBlock[], speech : Speech) : Promise<ExprTransform | undefined> {
    const divs = textBlocks.map(x => x.div);
    const equation = await addEquations(terms, divs, speech);

    const exprTransform = new ExprTransform({
        reason   : ExprTransformReason.add_equation,
        equation : equation, 
        terms
    });

    return exprTransform;
}

export async function makeExprTransformBySubstitution(terms : Term[], textBlocks : TextBlock[], speech : Speech) : Promise<ExprTransform | undefined> {
    const equation = await substitute(terms[0], terms[1], textBlocks[0].div, textBlocks[1].div, speech);

    const exprTransform = new ExprTransform({
        reason   : ExprTransformReason.substitution,
        equation : equation, 
        terms
    });

    return exprTransform;
}

export async function makeExprTransformByDividingEquation(root : App, mathText : string, textBlock : TextBlock, speech : Speech) : Promise<ExprTransform | undefined> {
    const term = parseMath(mathText);
    const equation = await divideEquation(root, term, textBlock.div, speech);

    const exprTransform = new ExprTransform({
        reason   : ExprTransformReason.dividing_equation,
        equation, 
        terms    : [root, term]
    });

    return exprTransform;
}


export async function makeExprTransformByArgShift(term : Term, shift : number, textBlock : TextBlock, speech : Speech) : Promise<ExprTransform | undefined> {
    const equation = term.getRoot();

    const exprTransform = new ExprTransform({
        reason   : ExprTransformReason.arg_shift,
        equation : equation, 
        terms    : [term]
    });

    return exprTransform;
}

export function makeEqualLengthByCongruentTriangles(lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol) : LengthEquality | undefined {
    const triangleAB = findTrianglePairByLengthSymbols(lengthSymbolA, lengthSymbolB, congruentTriangles);
    if(triangleAB != undefined){
        const [triangleA, triangleB] = triangleAB;

        // msg(`equal length:congruent triangles`);
        return new LengthEquality({
            reason          : LengthEqualityReason.congruent_triangles,
            auxiliaryShapes : [ triangleA, triangleB ],
            shapes          : [ lengthSymbolA, lengthSymbolB ]
        });
    }
    else{

        msg(`can not find congruent triangles`);

        return undefined;
    }
}

export function makeEqualLengthByRadiiEqual(lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol) : LengthEquality | undefined {
    if(lengthSymbolA.circle != undefined && lengthSymbolB.circle != undefined && areEqualCircleArcs(lengthSymbolA.circle, lengthSymbolB.circle)){
        // msg(`radii-equal`);
        return new LengthEquality({
            reason : LengthEqualityReason.radii_equal,
            auxiliaryShapes : [ lengthSymbolA.circle, lengthSymbolB.circle ],
            shapes : [ lengthSymbolA, lengthSymbolB ]                
        });
    }

    return undefined;
}

export function makeEqualLengthByCommonCircle(lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol, circle : CircleArc) : LengthEquality | undefined {
    const ABC = getCommonPoint(lengthSymbolA, lengthSymbolB);
    if(ABC != undefined){
        const [A, B, C] = ABC;

        if(circle.center == A && circle.includesPoint(B) && circle.includesPoint(C)){

            // msg(`common-circle`);
            return new LengthEquality({
                reason : LengthEqualityReason.common_circle,
                auxiliaryShapes : [ circle ],
                shapes : [ lengthSymbolA, lengthSymbolB ]
            });
        }
    }

    return undefined;
}

export function makeEqualLengthByParallelLines(lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol, parallel_lines : AbstractLine[]) : LengthEquality | undefined {
    if(!isParallel(parallel_lines[0], parallel_lines[1])){
        return undefined;
    }

    if(lengthSymbolA.line != undefined && lengthSymbolB.line != undefined && isParallel(lengthSymbolA.line, lengthSymbolB.line)){
    }
    else{
        return undefined;
    }

    const [line1, line2] = parallel_lines;
    for(const lengthSymbol of [lengthSymbolA, lengthSymbolB] ){
        const [A, B] = [ lengthSymbol.pointA, lengthSymbol.pointB ];
        if(line1.includesPoint(A) && line2.includesPoint(B) || line1.includesPoint(B) && line2.includesPoint(A)){        
            continue;    
        }

        return undefined;
    }

    msg(`parallel-lines`);
    return new LengthEquality({
        reason : LengthEqualityReason.parallel_lines_distance,
        auxiliaryShapes : parallel_lines,
        shapes : [ lengthSymbolA, lengthSymbolB ]            
    });
}

export function makeEqualLengthByParallelLinesAuto(lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol) : LengthEquality | undefined {
    const parallel_lines = findParallelLinesOfLengthSymbols(lengthSymbolA, lengthSymbolB);
    if(parallel_lines != undefined){
        msg(`parallel-lines`);
        return new LengthEquality({
            reason : LengthEqualityReason.parallel_lines_distance,
            auxiliaryShapes : parallel_lines,
            shapes : [ lengthSymbolA, lengthSymbolB ]            
        });
    }

    return undefined;
}

export function makeEqualLengthByParallelogramOppositeSides(lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol) : LengthEquality | undefined {
    let points = [ lengthSymbolA.pointA, lengthSymbolA.pointB, lengthSymbolB.pointA, lengthSymbolB.pointB];
    points = toClockwisePoints(points);

    const parallelogramClassifier =  getParallelogramClassifier(points);
    if(parallelogramClassifier == undefined){
        msg(`no parallelogram`);
        return undefined;
    }

    const parallelogram = new Quadrilateral({
        points,
        lines : []
    });

    // msg(`parallelogram-sides`);
    return new LengthEquality({
        reason : LengthEqualityReason.parallelogram_opposite_sides,
        auxiliaryShapes : [parallelogram],
        shapes : [ lengthSymbolA, lengthSymbolB ]            
    });
}

export function makeEqualLengthByParallelogramDiagonalBisection(lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol) : LengthEquality | undefined {
    const parallelograms = getParallelogramsByDiagonalLengthSymbols(lengthSymbolA, lengthSymbolB);
    for(const parallelogram of parallelograms){
        const diagonal_intersection = parallelogram.diagonalIntersection();
        if(diagonal_intersection != undefined){
            let lengthSymbol_points_pair = [lengthSymbolA.points(), lengthSymbolB.points()];
            if(lengthSymbol_points_pair.every(x => x.includes(diagonal_intersection))){

                let lengthSymbol_vertices = lengthSymbol_points_pair.map(x=> x[0] == diagonal_intersection ? x[1] : x[0]);

                if(areSetsEqual(lengthSymbol_vertices, [parallelogram.points[0], parallelogram.points[2]]) ||
                   areSetsEqual(lengthSymbol_vertices, [parallelogram.points[1], parallelogram.points[3]]) ){

                    // msg(`parallelogram-diagonal-bisection`);
                    return new LengthEquality({
                        reason : LengthEqualityReason.parallelogram_diagonal_bisection,
                        auxiliaryShapes : [parallelogram],
                        shapes : [ lengthSymbolA, lengthSymbolB ]            
                    });
                }
            }
        }
    }

    return undefined;
}

export function makeEqualLengthByEquivalenceClass(lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol) : LengthEquality | undefined {
    if(lengthSymbolA.isEqual(lengthSymbolB)){
        return new LengthEquality({
            reason : LengthEqualityReason.equivalence_class,
            shapes : [ lengthSymbolA, lengthSymbolB ]                
        });
    }

    return undefined;
}

export function makeParallelDetectorByParallelogram(lineA : AbstractLine, lineB : AbstractLine) : ParallelDetector | undefined {
    const lines = [lineA, lineB];

    for(const classifier of parallelogramClassifiers){
        const parallelogram = classifier.quadrilateral();
        if(isSubSet(lines, parallelogram.lines)){

            // msg(`Parallel-Detector-By-Parallelogram`);
            return new ParallelDetector({
                reason : ParallelReason.parallelogram,
                auxiliaryShapes : [parallelogram],
                shapes : [lineA, lineB]
            });
        }
    }

    return undefined;
}

export function makeParallelDetectorByCorrespondingAlternateAnglesEqual(angleA : Angle, angleB : Angle) : ParallelDetector | undefined {
    if(angleA.intersection != angleB.intersection && isEqualAngle(angleA, angleB)){
        let lineA : AbstractLine;
        let lineB : AbstractLine;

        if(angleA.lineA == angleB.lineA){
            lineA = angleA.lineB;
            lineB = angleB.lineB;
        }
        else if(angleA.lineB == angleB.lineB){
            lineA = angleA.lineA;
            lineB = angleB.lineA;
        }
        else{
            return undefined;
        }

        // msg(`Parallel-Detector-By-Corresponding-Alternate-Angles-Equal`);
        return new ParallelDetector({
            reason : ParallelReason.corresponding_angles_or_alternate_angles_are_equal,
            auxiliaryShapes : [angleA, angleB],
            shapes : [lineA, lineB]
        });
    }

    return undefined;
}

export function makeParallelDetectorBySupplementaryAngles(angleA : Angle, angleB : Angle) : ParallelDetector | undefined {
    for(const [angle1, angle2] of permutation([angleA, angleB])){
        if(angle1.lineB == angle2.lineA && angle1.directionB == - angle2.directionA){
            const lines = [angle1.lineA, angle2.lineB];

            // msg(`Parallel-Detector-By-Supplementary-Angles`);
            return new ParallelDetector({
                reason : ParallelReason.supplementary_angles,
                auxiliaryShapes : [angle1, angle2],
                shapes : lines
            });
        }    
    }

    return undefined;
}

// ts\deduction\proposition.ts

export function makeShapeProposition(reason : PropositionReason, shapes: (Angle | LengthSymbol)[]) : ShapeProposition {
    return new ShapeProposition({
        reason,
        auxiliaryShapes : [],
        shapes,
    });
}


export function makeEquationProposition(reason : PropositionReason, mathText : string) : EquationProposition | undefined {
    const equation = parseMath(mathText) as App;
    assert(equation.isRootEq());

    return new EquationProposition({
        reason,
        auxiliaryShapes : [],
        shapes : [],
        equation
    });
}

// ts\deduction\quadrilateral.ts

export function makeQuadrilateralClassifier(points : Point[], reason : ParallelogramReason | RhombusReason ) : ParallelogramClassifier | RhombusClassifier | undefined{
    let equalSideLengthSymbolsA : LengthSymbol[] | undefined;
    let equalSideLengthSymbolsB : LengthSymbol[] | undefined;

    let parallelLinesA : AbstractLine[] | undefined;
    let parallelLinesB : AbstractLine[] | undefined;

    let equalAnglesA : Angle[] | undefined;
    let equalAnglesB : Angle[] | undefined;

    let diagonalBisectionLengthSymbolsA : LengthSymbol[] | undefined;
    let diagonalBisectionLengthSymbolsB : LengthSymbol[] | undefined;

    equalSideLengthSymbolsA = findEqualLengthsByPointsPair([points[0], points[1]], [points[2], points[3]]);
    equalSideLengthSymbolsB = findEqualLengthsByPointsPair([points[1], points[2]], [points[3], points[0]]);

    parallelLinesA = getParallelLinesByPointsPair([points[0], points[1]], [points[2], points[3]]);
    parallelLinesB = getParallelLinesByPointsPair([points[1], points[2]], [points[3], points[0]]);

    equalAnglesA = findEqualAnglesBy3pointsPair([points[0], points[1], points[2]], [points[2], points[3], points[0]]);
    equalAnglesB = findEqualAnglesBy3pointsPair([points[1], points[2], points[3]], [points[3], points[0], points[1]]);

    diagonalBisectionLengthSymbolsA = undefined;
    diagonalBisectionLengthSymbolsB = undefined;

    const diagonalA = getCommonLineOfPoints(points[0], points[2]);
    const diagonalB = getCommonLineOfPoints(points[1], points[3]);
    if(diagonalA != undefined && diagonalB != undefined){
        const intersection = getCommonPointOfLines(diagonalA, diagonalB);
        if(intersection != undefined){
            diagonalBisectionLengthSymbolsA = findEqualLengthsByPointsPair([points[0], intersection], [points[2], intersection]);
            diagonalBisectionLengthSymbolsB = findEqualLengthsByPointsPair([points[1], intersection], [points[3], intersection]);
        }
    }

    const lines = range(4).map(i => getCommonLineOfPoints(points[i], points[(i + 1) % 4])) as AbstractLine[];
    if(lines.some(x => x == undefined)){
        throw new MyError();
    }

    const quadrilateral = new Quadrilateral({points, lines});

    switch(reason){
    case ParallelogramReason.each_opposite_sides_are_equal:
        if(equalSideLengthSymbolsA != undefined && equalSideLengthSymbolsB != undefined){
            return new ParallelogramClassifier({
                reason : reason,
                auxiliaryShapes : equalSideLengthSymbolsA.concat(equalSideLengthSymbolsB),
                shapes : [ quadrilateral ]
            });
        }
        break;

    case ParallelogramReason.each_opposite_sides_are_parallel:
        if(parallelLinesA != undefined && parallelLinesB != undefined){
            return new ParallelogramClassifier({
                reason : reason,
                auxiliaryShapes : parallelLinesA.concat(parallelLinesB),
                shapes : [ quadrilateral ]
            });
        }
        break;

    case ParallelogramReason.each_opposite_angles_are_equal:
        if(equalAnglesA != undefined && equalAnglesB != undefined){

            return new ParallelogramClassifier({
                reason : reason,
                auxiliaryShapes : equalAnglesA.concat(equalAnglesB),
                shapes : [ quadrilateral ]
            });
        }

    case ParallelogramReason.one_opposite_sides_are_parallel_and_equal:{
            let auxiliaryShapes : MathEntity[];

            if(parallelLinesA != undefined && equalSideLengthSymbolsA != undefined){
                assert(range(2).every(i => parallelLinesA[i] == equalSideLengthSymbolsA[i].line));

                auxiliaryShapes = equalSideLengthSymbolsA;
            }
            else if(parallelLinesB != undefined && equalSideLengthSymbolsB != undefined){
                assert(range(2).every(i => parallelLinesB[i] == equalSideLengthSymbolsB[i].line));

                auxiliaryShapes = equalSideLengthSymbolsB;
            }
            else{
                break;
            }
            return new ParallelogramClassifier({
                reason,
                auxiliaryShapes,
                shapes : [ quadrilateral ]
            });
        }

    case ParallelogramReason.each_diagonal_bisections:
        if(diagonalBisectionLengthSymbolsA != undefined && diagonalBisectionLengthSymbolsB != undefined){
            return new ParallelogramClassifier({
                reason,
                auxiliaryShapes : diagonalBisectionLengthSymbolsA.concat(diagonalBisectionLengthSymbolsB),
                shapes : [ quadrilateral ]
            });
        }
        break;
    
    case RhombusReason.all_sides_are_equal:
        if(equalSideLengthSymbolsA != undefined && equalSideLengthSymbolsB != undefined){
            if(isEqualLength(equalSideLengthSymbolsA[0], equalSideLengthSymbolsB[0])){
                return new RhombusClassifier({
                    reason : reason,
                    auxiliaryShapes : equalSideLengthSymbolsA.concat(equalSideLengthSymbolsB),
                    shapes : [ quadrilateral ]
                });    
            }
        }
        break;
    
    }

    return undefined;
}

export function makeEquationTextBlock(parent : EquationTextBlockClass, equation : App) : TextBlock {
    const view = GlobalState.View__current!;

    const text_block = new TextBlock( {
        parent,
        text : equation.tex(),
        isTex : true,
        offset : Vec2.zero(),
    });

    text_block.setTextPosition(view.textBase.x, view.textBase.y);
    text_block.updateTextDiv();

    const rect = text_block.div.children[0].getBoundingClientRect();
    view.textBase.y -= view.fromYPixScale(rect.height + 10);

    return text_block;
}

export async function makeShapeEquationByEquationText(reason : ShapeEquationReason, auxiliaryShapes : MathEntity[], text : string) : Promise<ShapeEquation | undefined> {
    // msg(`angles eq: ${text}`);

    const equation = parseMath(text) as App;
    if(! equation.isEq()){
        msg(`can not make an equation: ${text}`);
        return undefined;
    }

    if(GlobalState.View__isPlayBack){
        const speech = AbstractSpeech.one;
        await speakReason(speech, reason);
        await showAuxiliaryShapes(reason, auxiliaryShapes);
        await speech.waitEnd();
    }
    
    return new ShapeEquation({
        reason,
        auxiliaryShapes,
        shapes : [],
        equation
    });

}

export function makeTriangleCongruence(A : Triangle, B : Triangle) : TriangleCongruence | undefined {
    const sidesA = range(3).map(i => [ A.points[i], A.points[(i+1) % 3]]);
    const sidesB = range(3).map(i => [ B.points[i], B.points[(i+1) % 3]]);

    const auxiliaryShapes : Shape[] = [];
    const equal_side = [ false, false, false ];
    for(const idx of range(3)){
        const sideA = sidesA[idx];
        const sideB = sidesB[idx];

        const keyA = pairKey(sideA[0], sideA[1]);
        const keyB = pairKey(sideB[0], sideB[1]);

        const lengthSymbolA = pointsToLengthSymbol.get(keyA);
        const lengthSymbolB = pointsToLengthSymbol.get(keyB);

        if(lengthSymbolA != undefined && lengthSymbolB != undefined){
            if(isEqualLength(lengthSymbolA, lengthSymbolB)){

                auxiliaryShapes.push(lengthSymbolA, lengthSymbolB);
                equal_side[idx] = true;
            }
        }
    }

    const equal_side_count = equal_side.filter(x => x).length;
    // msg(`equal side count:${equal_side_count}`);

    if(equal_side_count == 3){
        return new TriangleCongruence({ shapes:[A, B], reason : TriangleCongruenceReason.side_side_side, auxiliaryShapes : auxiliaryShapes })
    }
    else if(equal_side_count == 2){
        const idx = equal_side.indexOf(false);
        const angle_pointsA = [A.points[(idx + 1) % 3], A.points[(idx + 2) % 3], A.points[idx] ];
        const angle_pointsB = [B.points[(idx + 1) % 3], B.points[(idx + 2) % 3], B.points[idx] ];

        const angleA = findAngle(angle_pointsA);
        const angleB = findAngle(angle_pointsB);
    
        if(angleA != undefined && angleB != undefined && isEqualAngle(angleA, angleB)){
            auxiliaryShapes.push(angleA, angleB);
            return new TriangleCongruence({ shapes : [A, B], reason : TriangleCongruenceReason.side_angle_side, auxiliaryShapes : auxiliaryShapes });
        }
    }
    else if(equal_side_count == 1){
        const eq_idx = equal_side.indexOf(true);
        for(const idx of [eq_idx, (eq_idx + 2) % 3]){

            const angle_pointsA = [ A.points[idx], A.points[(idx + 1) % 3], A.points[(idx + 2) % 3] ];
            const angle_pointsB = [ B.points[idx], B.points[(idx + 1) % 3], B.points[(idx + 2) % 3] ];

            const angleA = findAngle(angle_pointsA);
            if(angleA == undefined){
                return undefined;
            }

            const angleB = findAngle(angle_pointsB);
            if(angleB == undefined){
                return undefined;
            }
                
            if(isEqualAngle(angleA, angleB)){
                auxiliaryShapes.push(angleA, angleB);
            }                
            else{
                return undefined;
            }
        }

        return new TriangleCongruence({ shapes : [A, B], reason : TriangleCongruenceReason.angle_side_angle, auxiliaryShapes : auxiliaryShapes });
    }

    return undefined;
}

// ts\deduction\triangle_detector.ts

export function makeIsoscelesTriangleDetector(points : Point[], reason : IsoscelesTriangleReason ) : TriangleDetector | undefined {
    switch(reason){
    case IsoscelesTriangleReason.two_sides_are_equal:
        for(const length_symbol_set of equalLengths){
            const length_symbols = Array.from(length_symbol_set).filter(x => points.includes(x.pointA) && points.includes(x.pointB));
            if(length_symbols.length == 3){
                const triangle = Triangle__fromPoints(points);

                return new TriangleDetector({
                    reason : reason,
                    auxiliaryShapes : length_symbols,
                    shapes : [ triangle ]
                });    
            }
            else if(length_symbols.length == 2){
                const points_list = length_symbols.map(x => [x.pointA, x.pointB]);

                const vertex_idx = range(3).find(i => points_list.every(pts => pts.includes(points[i])))!;
                assert(vertex_idx != undefined);
                const points2 = [points[vertex_idx], points[(vertex_idx + 1) % 3], points[(vertex_idx + 2) % 3]]
                const triangle = Triangle__fromPoints(points2);

                return new TriangleDetector({
                    reason : reason,
                    auxiliaryShapes : length_symbols,
                    shapes : [ triangle ]
                });    
            }
        }    
        break;

    default:
        throw new MyError();
    }


    return undefined;
}

// ts\deduction\triangle_similarity.ts

export function makeTriangleSimilarity(A : Triangle, B : Triangle) : TriangleSimilarity | undefined {

    const equal_angle_pairs : Angle[] = [];

    for(const idx of range(3)){

        const angle_pointsA = [ A.points[idx], A.points[(idx + 1) % 3], A.points[(idx + 2) % 3] ];
        const angle_pointsB = [ B.points[idx], B.points[(idx + 1) % 3], B.points[(idx + 2) % 3] ];

        const angleA = findAngle(angle_pointsA);
        if(angleA != undefined){
            const angleB = findAngle(angle_pointsB);
            if(angleB != undefined){
                    
                if(isEqualAngle(angleA, angleB)){
                    equal_angle_pairs.push(angleA, angleB);
                }                
            }
        }
    }

    if(equal_angle_pairs.length == 4){

        return new TriangleSimilarity({
            reason : TriangleSimilarityReason.two_equal_angle_pairs,
            shapes : [A, B], 
            auxiliaryShapes : equal_angle_pairs
        })
    }

    return undefined;
}

export function Point__fromArgs(position : Vec2) : Point {
    return new Point( { position } );
}

export function Triangle__fromPoints(points : Point[]) : Triangle {
    const lines = range(3).map(i => getCommonLineOfPoints(points[i], points[(i + 1) % 3])) as AbstractLine[];
    if(lines.some(x => x == undefined)){
        throw new MyError();
    }

    const triangle = new Triangle({points, lines});
    return triangle;
}

export async function Builder__setToolByName(tool_name : string, record_operation : boolean){
    GlobalState.Builder__toolName = tool_name;
    GlobalState.Builder__tool = makeToolByType(tool_name);

    if(record_operation){
        if(tool_name != "SelectionTool" && tool_name != "RangeTool"){
            GlobalState.View__current!.addOperation(new ToolSelection(tool_name))
        }    
    }

    await GlobalState.Builder__tool.init();
    if(tool_name == "RangeTool"){
        msg(`dump:\n${GlobalState.View__current!.operations.map(x => x.dump()).join("\n")}`);
    }
}

export function Builder__setToolByShape(shape : Statement) : void {
    if( isTriangleCongruence(shape)){

        msg("set Triangle Congruence Builder");
        GlobalState.Builder__tool = new TriangleCongruenceBuilder(shape);
    }
    else if( isLengthEquality(shape)){

        msg("set Equal Length Builder");
        GlobalState.Builder__tool = new LengthEqualityBuilder(shape);
    }
    else{

        msg("set Statement Builder");
        GlobalState.Builder__tool = new StatementBuilder(shape);
    }
}

console.log(`Loaded: factories`);
