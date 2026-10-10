///<reference path="plane_util.ts" />
///<reference path="statement.ts" />
///<reference path="deduction/triangle_congruence.ts" />

import { MyError, parseURL, Speech, TT, Vec2 } from "@i18n";
import { App, Term } from "@parser";
import { Dialog, fgColor } from "@layout";

import { AngleEqualityReason, ExprTransformReason, IsoscelesTriangleReason, LengthEqualityReason, ParallelogramReason, ParallelReason, PropositionReason, RhombusReason, ShapeEquationReason, ShapeMode, ShapeType, TriangleCongruenceReason, TriangleQuadrilateralClass, TriangleSimilarityReason } from "./enums";

import type { Widget, MathEntity, TextBlock } from "./json";
import type { AbstractLine, CircleArc, Triangle, Point, LineByPoints, Quadrilateral, Polygon, Shape } from "./shape";
import type { ParallelogramClassifier, RhombusClassifier } from "./deduction/quadrilateral";
import type { Angle, LengthSymbol } from "./dimension_symbol";
import type { Assumption, menuDialogType, Statement } from "./statement";
import type { Plane } from "./plane_ui";
import type { ShapesProperty } from "./property";
import type { Builder, ExprTransformBuilder } from "./tool";
import type { View } from "./view";
import type { ClickTerm, EnumSelection, PlayBack, PropertySetting, ToolSelection } from "./operation";
import type { EquationProposition, Proposition, ShapeProposition } from "./deduction/proposition";
import type { EquationTextBlockClass, ShapeEquation } from "./deduction/shape_equation";
import type { AngleEquality } from "./deduction/angle_equality";
import type { AngleBisector, Motion } from "./geometry";
import type { LengthEquality } from "./deduction/length_equality";
import type { TriangleCongruence } from "./deduction/triangle_congruence";
import type { TriangleSimilarity } from "./deduction/triangle_similarity";
import type { ParallelDetector } from "./deduction/parallel_detector";
import type { TriangleDetector } from "./deduction/triangle_detector";
import type { ExprTransform } from "./deduction/expr_transform";
import type { AngleEqualityConstraint } from "./constraint";

export class T1 { 
    set   : Set<any>; 
    value : any;

    constructor(set : Set<any>, value : any){
        this.set   = set;
        this.value = value;
    }
}

export class T2 { 
    array : Array<any>;
    value : any;

    constructor(array : Array<any>, value  : any){
        this.array = array;
        this.value = value;
    }
}

export class T3 { 
    array : Array<any>;
    value : any;
    index : number;

    constructor(array : Array<any>, value : any, index : number){
        this.array = array;
        this.value = value;
        this.index = index;
    }
}

export class T4 { 
    map   : Map<any,any>;
    key   : any;
    value : any;

    constructor(map : Map<any,any>, key : any, value : any){
        this.map   = map;
        this.key   = key;
        this.value = value;
    }
}

export type RelationLog = T1|T2|T3|T4;

export class MySet<T> {
    protected data: Set<T> = new Set<T>();

    constructor(data: T[] = []){
        this.data = new Set<T>(data);
    }

    clear(){
        this.data.clear();
    }
  
    add(value: T): void {
        if(!this.data.has(value)){
            this.data.add(value);

            GlobalState.View__current!.relationLogs.push(new T1(this.data, value));
        }
    }
  
    has(item: T): boolean {
      return this.data.has(item);
    }

    values(){
        return this.data.values();
    }
  
    forEach(callback: (value: T, value2: T, set: Set<T>) => void, thisArg?: any): void {
      this.data.forEach(callback, thisArg);
    }
  
    toArray(): T[] {
      return Array.from(this.data);
    }

    [Symbol.iterator](): Iterator<T>{
        return this.data.values();
    }
}

export class MyArray<T> {
    private data: T[] = [];
  
    constructor(initialData: T[] = []) {
      this.data = initialData;
    }

    clear(){
        this.data = [];
    }
    
    filter(callback: (item: T, index: number, array: T[]) => boolean): MyArray<T> {
      const filteredArray = this.data.filter(callback);
      return new MyArray<T>(filteredArray);
    }

    toArray(): T[] {
        return this.data;
    }

    some(fnc : (x:T)=>boolean){
        return this.data.some(fnc);
    }

    find(fnc : (x:T)=>boolean){
        return this.data.find(fnc);
    }

    push(value : T){
        this.data.push(value);

        GlobalState.View__current!.relationLogs.push(new T2(this.data, value));
    }

    flat(){
        return this.data.flat();
    }

    [Symbol.iterator](): Iterator<T> {
        let index = 0;
        const array = this.data;

        return {
            next(): IteratorResult<T> {
                if (index < array.length) {
                    return { value: array[index++], done: false };
                } else {
                    return { value: undefined, done: true };
                }
            },
        };
    }

    remove(x : T){
        const index = this.data.indexOf(x);
        if(index == -1){
            throw new MyError();
        }
        else{
            this.data.splice(index, 1);

            const value = this.data[index];
            GlobalState.View__current!.relationLogs.push(new T3(this.data, value, index));
        }
    }
}

export class MyMap<K, V> {
    private map: Map<K, V> = new Map<K, V>();
  
    constructor() {}
  
    set(key: K, value: V): void {
        if(!this.map.has(key)){

            this.map.set(key, value);

            GlobalState.View__current!.relationLogs.push(new T4(this.map, key, value));
        }
    }
  
    get(key: K): V | undefined {
      return this.map.get(key);
    }
  
    clear(){
        this.map.clear();
    }

    entries() {
        return this.map.entries();
    }

    keys(){
        return this.map.keys();
    }

    values(){
        return this.map.values();
    }
}

export const GlobalState = {
    Widget__maxId : 0,
    Operation__maxId : 0,
    PlayBack__startIndex : NaN,
    View__isPlayBack : false,
    Widget__refMap : new Map<number, any>(),
    Widget__isLoading : false,
    Plane__one : undefined as undefined | Plane,
    ShapesProperty__one : undefined as undefined | ShapesProperty,
    Statement__idTimeout : undefined as number | undefined,
    Builder__toolName : undefined as undefined | string,
    Builder__tool : undefined as undefined | Builder,
    View__nearThreshold : 8,
    View__current : undefined as undefined | View,
    Point__radius : undefined as undefined | number,
    Angle__radius1 : undefined as undefined | number,
    MathEntity__orderSet : new Set<MathEntity>(),
    Polygon__colorIndex : 0,
    Point__tempPoints : [] as Point[],
    Angle__RightAngleMark : 0,
    Angle__DefaultAngleMark : 1,
    LengthSymbol__DefaultLengthKind : 0,
    playBackOperations : undefined as undefined | PlayBack,
};

export const supplementaryAngles = new MyArray<[MySet<Angle>, MySet<Angle>]>();
export const rightAngles = new MySet<Angle>();

export const pointsToLengthSymbol = new MyMap<string, LengthSymbol>();
export const centerOfCircleArcs = new MyMap<Point,MySet<CircleArc>>();
export const pointOnCircleArcs = new MyMap<Point,MySet<CircleArc>>();
export const pointOnLines = new MyMap<Point,MySet<AbstractLine>>();
export const angleMap = new MyMap<string,Angle>();

export const parallelogramClassifiers = new MySet<ParallelogramClassifier>();

export const equalLengths = new MyArray<MySet<LengthSymbol>>();
export const congruentTriangles = new MyArray<MyArray<Triangle>>();
export const similarTriangles = new MyArray<MyArray<Triangle>>();
export const isoscelesTriangle = new MyArray<Triangle>();

export const propositions = new MyArray<Proposition>();

export const reasonToDoc = new Map<number, number>([
    [ ShapeEquationReason.sum_of_interior_angles_of_triangle_is_pi, 18 ],
    [ ShapeEquationReason.sum_of_interior_angles_of_quadrilateral_is_2pi, 21 ],
    [ ShapeEquationReason.sum_of_interior_angles_of_quadrilateral_is_2pi, 23 ],

    [ AngleEqualityReason.vertical_angles, 17 ],
    [ AngleEqualityReason.parallelogram_opposite_angles, 10 ],
    [ AngleEqualityReason.angle_bisector, 2 ],
    [ AngleEqualityReason.isosceles_triangle_base_angles, 3 ],

    [ LengthEqualityReason.parallel_lines_distance, 16 ],
    [ LengthEqualityReason.parallelogram_opposite_sides, 10 ],
    [ LengthEqualityReason.parallelogram_diagonal_bisection, 11 ],

    [ ParallelogramReason.each_opposite_sides_are_equal, 1],
    [ ParallelogramReason.each_opposite_angles_are_equal, 22],
    [ ParallelogramReason.one_opposite_sides_are_parallel_and_equal, 12],
    [ ParallelogramReason.each_diagonal_bisections, 9],
]);

export const usedReasons = new Set<number>();

export const idMap = new Map<string, Widget>();

// クラスごとの通し番号を管理するグローバルなマップをファイル上部に追加
export const classCounters = new Map<string, number>();

export const lineKindImgNames = [ "line", "half_line_1", "half_line_2", "line_segment" ];
export const propertySettingText = new Map<string, string>([
    [ "angleMark", TT("Set the angle mark.")],
    [ "lineKind" , TT("Set the line kind.")],
    [ "name"     , TT("Set the name.")],
])


export const dependColor = "blue";
export const targetColor = "red";
export const defaultLineWidth = 3;
export const OverLineWidth = 5;

export const enumSelectionClassName = "enum_selection_item";
export const menuDialogs = new Map<menuDialogType, Dialog>();

export const modeColorMap = new Map<ShapeMode,string>([
    [ ShapeMode.none   , fgColor ],
    [ ShapeMode.depend , dependColor ],
    [ ShapeMode.depend1, "Aqua" ],
    [ ShapeMode.depend2, "lime" ],
    [ ShapeMode.target , targetColor ],
    [ ShapeMode.target1, "orange" ],
    [ ShapeMode.target2, "magenta" ],
]);

export let urlOrigin : string;
export let urlParams : Map<string, string>;
export let urlBase   : string;
export let capturedShape : MathEntity | undefined;

export function setUrlOriginParams(){
    [ urlOrigin, , urlParams, urlBase ] = parseURL();
}

export function setCapturedShape(captured_shape : MathEntity | undefined){
    capturedShape = captured_shape;
}

export let Angle__radius1Pix = 20;
export let Angle__numMarks = 5;
export let Angle__outerAngleScale = 2;

export let Widget__processed : Set<string>;

export let Point__radiusPix = 4;


export const enumToImgName = new Map<number, string>([
    [ TriangleCongruenceReason.side_side_side, "side_side_side" ],
    [ TriangleCongruenceReason.side_angle_side, "side_angle_side" ],
    [ TriangleCongruenceReason.angle_side_angle, "angle_side_angle" ],

    [ ShapeEquationReason.sum_of_angles_is_pi, "sum_of_angles_is_pi" ],
    [ ShapeEquationReason.sum_of_angles_is_equal, "sum_of_angles_is_equal" ],
    [ ShapeEquationReason.sum_of_lengths_is_equal, "sum_of_lengths_is_equal" ],
    [ ShapeEquationReason.sum_of_interior_angles_of_triangle_is_pi, "sum_of_interior_angles_of_triangle_is_pi" ],
    [ ShapeEquationReason.sum_of_interior_angles_of_quadrilateral_is_2pi, "sum_of_interior_angles_of_quadrilateral_is_2pi" ],
    [ ShapeEquationReason.exterior_angle_theorem, "exterior_angle_theorem" ],

    [ LengthEqualityReason.radii_equal, "radii_equal" ],
    [ LengthEqualityReason.common_circle, "common_circle" ],
    [ LengthEqualityReason.parallel_lines_distance, "parallel_lines_distance" ],
    [ LengthEqualityReason.congruent_triangles, "triangle_congruence" ],
    [ LengthEqualityReason.parallelogram_opposite_sides, "each_opposite_sides_are_equal" ],
    [ LengthEqualityReason.parallelogram_diagonal_bisection, "each_diagonal_bisections" ],
    [ LengthEqualityReason.equivalence_class, "equivalence_class" ],
    [ LengthEqualityReason.midpoint, "midpoint" ],

    [ ExprTransformReason.transposition, "transposition" ],
    [ ExprTransformReason.equality, "equality" ],
    [ ExprTransformReason.add_equation, "add_equation" ],
    [ ExprTransformReason.substitution, "substitution" ],
    [ ExprTransformReason.dividing_equation, "dividing_equation" ],
    [ ExprTransformReason.arg_shift, "arg_shift" ],

    [ AngleEqualityReason.vertical_angles, "vertical_angles" ],
    [ AngleEqualityReason.parallel_line_angles, "parallel_line_angles" ],
    [ AngleEqualityReason.angle_bisector, "angle_bisector" ],
    [ AngleEqualityReason.congruent_triangles, "triangle_congruence" ],
    [ AngleEqualityReason.parallelogram_opposite_angles, "each_opposite_angles_are_equal" ],
    [ AngleEqualityReason.similar_triangles, "triangle_similarity" ],
    [ AngleEqualityReason.isosceles_triangle_base_angles, "isosceles_triangle_base_angles" ],

    [ TriangleQuadrilateralClass.trapezoid, "" ],
    [ TriangleQuadrilateralClass.parallelogram, "quadrilateral_classifier" ],
    [ TriangleQuadrilateralClass.rhombus, "all_sides_are_equal" ],

    [ ParallelogramReason.each_opposite_sides_are_equal, "each_opposite_sides_are_equal" ],
    [ ParallelogramReason.each_opposite_sides_are_parallel, "each_opposite_sides_are_parallel" ],
    [ ParallelogramReason.each_opposite_angles_are_equal, "each_opposite_angles_are_equal" ],
    [ ParallelogramReason.one_opposite_sides_are_parallel_and_equal, "one_opposite_sides_are_parallel_and_equal" ],
    [ ParallelogramReason.each_diagonal_bisections, "each_diagonal_bisections" ],

    [ RhombusReason.all_sides_are_equal, "all_sides_are_equal" ],

    [ IsoscelesTriangleReason.two_sides_are_equal, "isosceles_triangle" ],

    [ ParallelReason.parallelogram, "quadrilateral_classifier" ],
    [ ParallelReason.corresponding_angles_or_alternate_angles_are_equal, "parallel_line_angles" ],
    [ ParallelReason.supplementary_angles, "parallel_by_supplementary_angles" ],

    [ TriangleSimilarityReason.two_equal_angle_pairs, "two_equal_angle_pairs" ],

    [ ShapeType.parallelogram, "quadrilateral_classifier" ],
    [ ShapeType.rhombus, "all_sides_are_equal" ],
    [ ShapeType.isosceles_triangle, "isosceles_triangle"],

    [ PropositionReason.angle_equality, "equal_angle" ],
    [ PropositionReason.length_equality, "equal_length" ],
    [ PropositionReason.equation, "expr_transform" ],
]);

export interface IShapesSelector {
    clear() : void;
}

export let ilinesSelector_2 : IShapesSelector;
export function setLinesSelector_2(line_selector_2 : IShapesSelector){
    ilinesSelector_2 = line_selector_2;
}


interface AppServicesType {
    Builder__setToolByName : (tool_name : string, record_operation : boolean)=>Promise<void>,
    showProperty : (widget : Widget | Widget[], nest : number)=>void,
    Builder__setToolByShape : (shape : Statement) => void,
    makeShapeEquationByEquationText : (reason : ShapeEquationReason, auxiliaryShapes : MathEntity[], text : string) => Promise<ShapeEquation | undefined>,
    Point__fromArgs : (position : Vec2) => Point,
    makeEquationTextBlock : (parent : EquationTextBlockClass, equation : App) => TextBlock,
    makeLineSegment : (pointA: Point, pointB: Point) => LineByPoints,
    makeAngleEqualityByVertical_angles : (angleA : Angle, angleB : Angle) => AngleEquality | undefined,
    showPropertyDlg : (widget : Widget, operation :PropertySetting | undefined) => Promise<void>,
    makeAngleEqualityByParallelLines : (angleA : Angle, angleB : Angle) => AngleEquality | undefined,
    makeAngleEqualityByAngleBisector : (angleA : Angle, angleB : Angle, angle_bisector : AngleBisector) => AngleEquality,
    makeAngleEqualityByCongruentTriangles : (angleA : Angle, angleB : Angle) => AngleEquality | undefined,
    makeAngleEqualityByParallelogramOppositeAngles : (angleA : Angle, angleB : Angle, parallelogram : Quadrilateral) => AngleEquality | undefined,
    makeAngleEqualityBySimilarTriangles : (angleA : Angle, angleB : Angle) => AngleEquality | undefined,
    makeEqualLengthByRadiiEqual : (lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol) => LengthEquality | undefined,
    makeEqualLengthByCommonCircle : (lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol, circle : CircleArc) => LengthEquality | undefined,
    makeEqualLengthByParallelLines : (lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol, parallel_lines : AbstractLine[]) => LengthEquality | undefined,
    makeEqualLengthByCongruentTriangles : (lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol) => LengthEquality | undefined,
    makeEqualLengthByParallelogramOppositeSides : (lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol) => LengthEquality | undefined,
    makeEqualLengthByParallelogramDiagonalBisection : (lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol) => LengthEquality | undefined,
    makeEqualLengthByEquivalenceClass : (lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol) => LengthEquality | undefined,
    makeRay : (pointA: Point, pointB: Point) => LineByPoints,
    inputTextPrompt : (message : string) => string | null,
    makeTriangleCongruence : (A : Triangle, B : Triangle) => TriangleCongruence | undefined,
    makeTriangleSimilarity : (A : Triangle, B : Triangle) => TriangleSimilarity | undefined,
    showMenu : (dlgType : menuDialogType) => Promise<number>,
    makeAngleEqualityByIsoscelesTriangleBaseAngles : (angleA : Angle, angleB : Angle) => AngleEquality | undefined,
    makeParallelDetectorByParallelogram : (lineA : AbstractLine, lineB : AbstractLine) => ParallelDetector | undefined,
    makeParallelDetectorByCorrespondingAlternateAnglesEqual : (angleA : Angle, angleB : Angle) => ParallelDetector | undefined,
    makeParallelDetectorBySupplementaryAngles : (angleA : Angle, angleB : Angle) => ParallelDetector | undefined,
    makeIsoscelesTriangleDetector : (points : Point[], reason : IsoscelesTriangleReason ) => TriangleDetector | undefined,
    makeQuadrilateralClassifier : (points : Point[], reason : ParallelogramReason | RhombusReason ) => ParallelogramClassifier | RhombusClassifier | undefined,
    makeExprTransformByTransposition : (term : Term, textBlock : TextBlock, speech : Speech) => Promise<ExprTransform>,
    makeExprTransformByEquality : (terms : Term[], textBlocks : TextBlock[], speech : Speech) => Promise<ExprTransform | undefined>,
    makeExprTransformByAddEquation : (terms : Term[], textBlocks : TextBlock[], speech : Speech) => Promise<ExprTransform | undefined>,
    makeExprTransformBySubstitution : (terms : Term[], textBlocks : TextBlock[], speech : Speech) => Promise<ExprTransform | undefined>,
    makeExprTransformByDividingEquation : (root : App, mathText : string, textBlock : TextBlock, speech : Speech) => Promise<ExprTransform | undefined>,
    makeShapeProposition : (reason : PropositionReason, shapes: (Angle | LengthSymbol)[]) => ShapeProposition,
    makeEquationProposition : (reason : PropositionReason, mathText : string) => EquationProposition | undefined,
    isEquationTextBlock : (x : MathEntity | undefined) => boolean,
    setCaptionEvent : (caption : TextBlock) => void,
    getEquationOfTextBlock : (self : TextBlock) => App | undefined,
    texClickOfTextBlock : (self : TextBlock, ev : MouseEvent) => Promise<void>,
    getTextOfTextBlock : (self : TextBlock) => string,
    addSupplementaryAngles : (angle1 : Angle, angle2 : Angle) => void,
    makeClickTerm : (textBlock_id : string, indexes : number[]) => ClickTerm,
    isAngle : (obj : any) => obj is Angle,
    isAngleEqualityConstraint : (obj : any) => obj is AngleEqualityConstraint,
    isAssumption : (obj : any) => obj is Assumption,
    isEnumSelection : (obj : any) => obj is EnumSelection,
    isExprTransform : (obj : any) => obj is ExprTransform,
    isExprTransformBuilder : (obj : any) => obj is ExprTransformBuilder,
    isLengthSymbol : (obj : any) => obj is LengthSymbol,
    isMotion : (obj : any) => obj is Motion,
    isPoint : (obj : any) => obj is Point,
    isPolygon : (obj : any) => obj is Polygon, 
    isShape : (obj : any) => obj is Shape, 
    isShapeEquation : (obj : any) => obj is ShapeEquation, 
    isShapeProposition : (obj : any) => obj is ShapeProposition, 
    isStatement : (obj : any) => obj is Statement, 
    isT1 : (obj : any) => obj is T1, 
    isT2 : (obj : any) => obj is T2, 
    isT3 : (obj : any) => obj is T3, 
    isT4 : (obj : any) => obj is T4, 
    isTextBlock : (obj : any) => obj is TextBlock, 
    isToolSelection : (obj : any) => obj is ToolSelection, 
    isTriangle : (obj : any) => obj is Triangle, 
    isWidget : (obj : any) => obj is Widget,
    isTriangleCongruence : (obj : any) => obj is TriangleCongruence
};

export let AppServices : AppServicesType;

export function setAppServices(app_services : AppServicesType){
    AppServices = app_services;
}

export let toolList : [typeof Builder, string, string, (typeof MathEntity)[]][];
export let editToolList : [typeof Builder, string, string, (typeof MathEntity)[]][];

export function setToolList(
    tool_list : [typeof Builder, string, string, (typeof MathEntity)[]][],
    edit_tool_list : [typeof Builder, string, string, (typeof MathEntity)[]][]) : void {

    toolList = tool_list;
    editToolList = edit_tool_list;
}



console.log(`Loaded: inference`);
