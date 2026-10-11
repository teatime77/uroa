// Relation registration, queries and undo/redo. Runtime dependencies stay below shape/UI classes.
import { msg, areSetsEqual, assert, intersection, MyError, range, remove, TT } from "@i18n";
import type { Vec2 } from "@i18n";
import type { RefVar } from "@parser";
import { PropositionReason } from "./enums";
import { MyArray, MyMap, MySet, angleMap, centerOfCircleArcs, congruentTriangles, equalLengths, GlobalState, isoscelesTriangle, parallelogramClassifiers, pointOnCircleArcs, pointOnLines, pointsToLengthSymbol, propositions, rightAngles, similarTriangles, supplementaryAngles, AppServices } from "./inference";
import type { RelationLog } from "./inference";
import type { AbstractLine, CircleArc, Point, Quadrilateral, Shape, Triangle } from "./shape";
import type { View } from "./view";
import type { MathEntity } from "./json";
import type { Angle, LengthSymbol } from "./dimension_symbol";
import type { ParallelogramClassifier } from "./deduction/quadrilateral";
import type { ShapeProposition } from "./deduction/proposition";
import { isClockwise, toClockwisePoints } from "./geometry_order";

// Registration, initialization and queries for points, lines, circles and triangles.
function addMySetMap<T, V>(a : T, b : V, map:MyMap<T, MySet<V>>){
    let set = map.get(a);
    if(set == undefined){
        set = new MySet<V>();
        map.set(a, set);
    }
    set.add(b);
}

function addSetMap<T, V>(a : T, b : V, map:Map<T, MySet<V>>){
    let set = map.get(a);
    if(set == undefined){
        set = new MySet<V>();
        map.set(a, set);
    }
    set.add(b);
}

let perpendicularPairs = new MyArray<[MySet<AbstractLine>, MySet<AbstractLine>]>();

let equalCircleArcs = new MyArray<MySet<CircleArc>>();

export function initRelations(){
    perpendicularPairs.clear();
    supplementaryAngles.clear();
    rightAngles.clear();

    pointsToLengthSymbol.clear();
    centerOfCircleArcs.clear();
    pointOnCircleArcs.clear();
    pointOnLines.clear();
    angleMap.clear();

    parallelogramClassifiers.clear();

    equalLengths.clear();
    equalCircleArcs.clear();
    congruentTriangles.clear();
    similarTriangles.clear();
    isoscelesTriangle.clear();

    propositions.clear();

    GlobalState.View__current!.relationLogs = [];
}

export function recalcRelations(view : View){
    initRelations();
    view.shapes.forEach(x => x.setRelations());
}

export function addCenterOfCircleArcs(point : Point, circle : CircleArc){
    addMySetMap<Point,CircleArc>(point, circle, centerOfCircleArcs);
    assert(centerOfCircleArcs.get(point) != undefined);
}

export function addPointOnCircleArcs(point : Point, circle : CircleArc){
    addMySetMap<Point,CircleArc>(point, circle, pointOnCircleArcs);
    assert(pointOnCircleArcs.get(point) != undefined);
}

export function addPointOnLines(point : Point, line : AbstractLine){
    addMySetMap<Point,AbstractLine>(point, line, pointOnLines);
    // msg(`add-Point-On-Lines point${point.id} line:${line.id}`);
    assert(pointOnLines.get(point) != undefined);
}

export function getLinesByPoint(point : Point) : AbstractLine[] {
    const lines = pointOnLines.get(point);
    if(lines == undefined){
        return [];
    }
    else{
        return lines.toArray();
    }
}

export function getCircleArcsByPoint(point : Point) : CircleArc[] {
    const circles = pointOnCircleArcs.get(point);
    if(circles == undefined){
        return [];
    }
    else{
        return circles.toArray();
    }
}

// Parallel and perpendicular groups share the same relation store.
export function addPerpendicularPairs(line1 : AbstractLine, line2 : AbstractLine){
    if(perpendicularPairs.some(x => x[0].has(line1) && x[1].has(line2) || x[0].has(line2) && x[1].has(line1)) ){
        return;
    }
    const pair = perpendicularPairs.find(x => x[0].has(line1) || x[0].has(line2) || x[1].has(line1) || x[1].has(line2));
    if(pair != undefined){
        const lines = [line1, line2];
        for(const [i, line_set] of pair.entries()){
            for(const [j, line] of lines.entries()){
                if(line_set.has(line)){
                    pair[1 - i].add( lines[1 - j] );
                    return;
                }
            }
        }
    }

    perpendicularPairs.push([ new MySet<AbstractLine>([line1]), new MySet<AbstractLine>([line2])  ])    
}

export function addParallelLines(line1 : AbstractLine, line2 : AbstractLine){
    const line_sets = perpendicularPairs.flat().filter(x => x.has(line1) || x.has(line2));

    let line_set : MySet<AbstractLine>; 

    switch(line_sets.length){
    case 0 : 
        line_set = new MySet<AbstractLine>(); 
        perpendicularPairs.push([line_set, new MySet<AbstractLine>()]);
        break;

    case 1 : 
        line_set = line_sets[0]; 
        break;
    default : 
        throw new MyError();
    }

    line_set.add(line1);
    line_set.add(line2);
}

export function getPerpendicularLines(line : AbstractLine) : MySet<AbstractLine> | undefined {
    for(const [lines1, lines2] of perpendicularPairs){
        if(lines1.has(line)){
            return lines2;
        }
        else if(lines2.has(line)){
            return lines1;
        }
    }

    return undefined;
}

export function getParallelLines(line : AbstractLine) : MySet<AbstractLine> | undefined {
    return perpendicularPairs.flat().find(x => x.has(line));
}

export function isParallel(lineA : AbstractLine, lineB : AbstractLine) : boolean {
    const line_set = getParallelLines(lineA);
    return line_set != undefined && line_set.has(lineB);
}

export function isPerpendicular(lineA : AbstractLine, lineB : AbstractLine) : boolean {
    const perpendicular_lines = getPerpendicularLines(lineA);
    
    if(perpendicular_lines == undefined){
        return false;
    }
    else{
        return perpendicular_lines.has(lineB);
    }
}

export function areEqualCircleArcs(circle1 : CircleArc, circle2 : CircleArc) : boolean {
    if(circle1 == circle2){
        return true;
    }
    
    const circle_set1 = equalCircleArcs.find(x => x.has(circle1));
    const circle_set2 = equalCircleArcs.find(x => x.has(circle2));

    return circle_set1 != undefined && circle_set1 == circle_set2;
}

export function addEqualCircleArcs(circle1 : CircleArc, circle2 : CircleArc){
    const circle_set1 = equalCircleArcs.find(x => x.has(circle1));
    const circle_set2 = equalCircleArcs.find(x => x.has(circle2));

    if(circle_set1 != undefined){
        if(circle_set2 != undefined){
            if(circle_set1 != circle_set2){

                Mylist(circle_set2).forEach(x => circle_set1.add(x));
                equalCircleArcs.remove(circle_set2);
            }
        }
        else{
            circle_set1.add(circle2);
        }
    }
    else{
        if(circle_set2 != undefined){
            circle_set2.add(circle1);
        }
        else{
            const new_set = new MySet<CircleArc>([ circle1, circle2 ]);
            equalCircleArcs.push(new_set);
        }
    }
}

export function getCommonLineOfPoints(pointA : Point, pointB : Point) : AbstractLine | undefined {
    const linesA = pointOnLines.get(pointA);
    const linesB = pointOnLines.get(pointB);
    if(linesA == undefined || linesB == undefined){
        return undefined;
    }

    const common_lines = MyIntersection<AbstractLine>(linesA, linesB);
    switch(common_lines.length){
    case 0: return undefined;
    case 1: return common_lines[0];
    default : throw new MyError();
    }
}

export function getPointsFromLine(line : AbstractLine) : Set<Point>{
    const points = Array.from(pointOnLines.entries()).filter(x => x[1].has(line)).map(x => x[0]);
    return new Set<Point>(points);
}

export function getCommonPointOfLines(lineA : AbstractLine, lineB : AbstractLine) : Point | undefined {
    const pointsA = getPointsFromLine(lineA);
    const pointsB = getPointsFromLine(lineB);
    const common_points = intersection<Point>(pointsA, pointsB);
    if(common_points.length == 1){
        return common_points[0];
    }

    return undefined;
}

export function getLineFromPoints(lines : AbstractLine[], pointA : Point, pointB : Point) : AbstractLine | undefined {
    return lines.find(x => x.includesPoint(pointA) && x.includesPoint(pointB));
}

export function addCongruentSimilarTriangles(is_congruent : boolean, triangle1 : Triangle, triangle2 : Triangle){
    if(!(AppServices.isTriangle(triangle1) &&  AppServices.isTriangle(triangle2))){
        msg("old Congruent Triangles")
        return;
    }

    const triangles_list = is_congruent ? congruentTriangles : similarTriangles;

    for(const triangles of triangles_list){
        let equal_triangle1 = triangles.find(x => x.isEqual(triangle1));
        let equal_triangle2 = triangles.find(x => x.isEqual(triangle2));

        let indexes1 : number[] | undefined;
        let indexes2 : number[] | undefined;
        if(equal_triangle1 != undefined){
            indexes1 = triangle1.points.map(p => equal_triangle1.points.indexOf(p)) ;
        }

        if(equal_triangle2 != undefined){
            indexes2 = triangle2.points.map(p => equal_triangle2.points.indexOf(p)) ;
        }

        if(indexes1 != undefined){
            if(indexes2 != undefined){
                if(range(3).every(i => indexes1[i] == indexes2[i])){
                    return;
                }
                else{
                    throw new MyError();
                }
            }
            else{
                if(range(3).every(i => indexes1[i] == i)){
                    triangles.push(triangle2);
                    return;
                }
                else{
                    throw new MyError();
                }
            }
        }
        else if(indexes2 != undefined){
            if(range(3).every(i => indexes2[i] == i)){
                triangles.push(triangle1);
                return;
            }
            else{
                throw new MyError();
            }

        }
    }

    triangles_list.push(new MyArray<Triangle>([triangle1, triangle2]));
}

export function addCongruentTriangles(triangle1 : Triangle, triangle2 : Triangle){
    return addCongruentSimilarTriangles(true, triangle1, triangle2);
}

export function addSimilarTriangles(triangle1 : Triangle, triangle2 : Triangle){
    return addCongruentSimilarTriangles(false, triangle1, triangle2);
}

export function findEqualLengthsByPointsPair(As : [Point, Point], Bs : [Point, Point]) : [LengthSymbol, LengthSymbol] | undefined {
    for(const length_symbol_set of equalLengths){
        const length_symbols = Array.from(length_symbol_set);

        const length_symbolA = length_symbols.find(x => areSetsEqual<Point>([x.pointA, x.pointB], [As[0], As[1]]));
        if(length_symbolA != undefined){

            const length_symbolB = length_symbols.find(x => areSetsEqual<Point>([x.pointA, x.pointB], [Bs[0], Bs[1]]));
            if(length_symbolB != undefined){
                return [length_symbolA, length_symbolB];
            }
            else{
                return undefined;
            }
        }
    }

    return undefined;
}

export function getParallelogramClassifier(points : Point[]) : ParallelogramClassifier | undefined {
    return Mylist(parallelogramClassifiers).find(x => areSetsEqual(x.quadrilateral().points, points) );
}

export function getParallelogramsByDiagonalLengthSymbols(lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol) : Quadrilateral[]{
    if(lengthSymbolA.line == undefined || lengthSymbolA.line != lengthSymbolB.line){
        msg(TT("length symbols are not on the same line."));
        return [];
    }

    const connection_point = lengthSymbolA.points().find(x => lengthSymbolB.points().includes(x));
    if(connection_point == undefined){
        msg(TT("no connection point of two length symbols"));
        return [];
    }

    const pointA = lengthSymbolA.points().find(x => x != connection_point);
    const pointB = lengthSymbolB.points().find(x => x != connection_point);

    const parallelograms : Quadrilateral[] = [];
    for(const parallelogramClassifier of parallelogramClassifiers){
        const parallelogram = parallelogramClassifier.quadrilateral();
        const points = parallelogram.points;
        if(areSetsEqual([points[0], points[2]], [pointA, pointB]) || areSetsEqual([points[1], points[3]], [pointA, pointB]) ){
            parallelograms.push(parallelogram);
        }
    }

    return parallelograms;
}

export function isParallelogramPoints(points : Point[]) : boolean {
    return getParallelogramClassifier(points) != undefined;
}

export function getTrianglesByAngle(angle : Angle, triangles : MyArray<Triangle>) : Triangle[] {
    const triangles_with_inner_angle : Triangle[] = [];

    LA : for(const triangle of triangles){
        const angle_points : Point[] = [ angle.intersection ];

        for(const line of [angle.lineA, angle.lineB]){
            const points = triangle.points.filter(point => line.includesPoint(point));
            if(points.length != 2){
                continue LA;
            }

            if(points[0] == angle.intersection){
                angle_points.push(points[1]);
            }
            else if(points[1] == angle.intersection){
                angle_points.push(points[0]);
            }
            else{
                continue LA;
            }
        }
        assert(angle_points.length == 3);

        if(isClockwise(angle_points)){
            triangles_with_inner_angle.push(triangle);
        }
    }

    return triangles_with_inner_angle;
}

export function getTrianglesByLengthSymbol(length_symbol : LengthSymbol, triangles : MyArray<Triangle>) : Triangle[] {
    const triangles_with_length_symbol : Triangle[] = [];

    const Length_symbol_points = [ length_symbol.pointA, length_symbol.pointB ];

    for(const triangle of triangles){
        const points = triangle.points.filter(point => Length_symbol_points.includes(point) );
        if(points.length == 2){
            triangles_with_length_symbol.push(triangle);
        }
    }

    return triangles_with_length_symbol;
}

// Replay existing relation logs without creating separate relation stores.
export function undoRelations(relationLogs : RelationLog[]){
    for(const x of relationLogs.slice().reverse()){
        if(AppServices.isT1(x)){
            assert(x.set.has(x.value));
            x.set.delete(x.value);
        }
        else if(AppServices.isT2(x)){
            assert(x.array.includes(x.value));
            remove(x.array, x.value);
        }
        else if(AppServices.isT3(x)){
            x.array.splice(x.index, 0, x.value);
            
        }
        else if(AppServices.isT4(x)){
            assert(x.map.get(x.key) == x.value);
            x.map.delete(x.key);
        }
        else{
            throw new MyError();
        }
    }
}

export function redoRelations(relationLogs : RelationLog[]){
    for(const x of relationLogs){
        if(AppServices.isT1(x)){
            assert(!x.set.has(x.value));
            x.set.add(x.value);
        }
        else if(AppServices.isT2(x)){
            assert(!x.array.includes(x.value));
            x.array.push(x.value);
        }
        else if(AppServices.isT3(x)){
            remove(x.array, x.value);            
        }
        else if(AppServices.isT4(x)){
            assert(!x.map.has(x.key));
            x.map.set(x.key, x.value);
        }
        else{
            throw new MyError();
        }

        GlobalState.View__current!.relationLogs.push(x);
    }
}

// Helpers for the relation collections in inference.ts.
export function Mylist<T>(set : MySet<T> | undefined) : T[] {
    if(set == undefined){
        return [];
    }
    else{

        return set.toArray();
    }
}

export function MyIntersection<T>(set1 : MySet<T> | undefined, set2 : MySet<T> | undefined) : T[] {
    if(set1 == undefined || set2 == undefined){
        return [];
    }

    return Array.from(set1.values()).filter(x => set2.has(x));
}

export function addShapeSetRelations(view : View, shape : MathEntity){
    view.addShape(shape);
    shape.setRelations();
}

export function isEqualLength(lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol) : boolean {
    if(lengthSymbolA == lengthSymbolB){
        return true;
    }

    return equalLengths.find(x => x.has(lengthSymbolA) && x.has(lengthSymbolB)) != undefined;
}

// Angle registration and lookup using line directions and point ordering.
export function angleKey(lineA : AbstractLine, directionA : number, lineB : AbstractLine, directionB : number, intersection : Point) : string {
    return `${lineA.id}:${directionA}:${lineB.id}:${directionB}:${intersection.id}`;
}

export function angleMatches3points(angle : Angle, points : Point[]) : boolean {
    if(angle.intersection == points[1] && angle.lineA.includesPoint(points[2]) && angle.lineB.includesPoint(points[0])){

        const vB = points[0].sub(points[1]);   // a vector form point1 to point0
        const vA = points[2].sub(points[1]);   // a vector form point1 to point2

        if(0 < vB.dot(angle.eB) && 0 < vA.dot(angle.eA)){
            return true;
        }
    }

    return false;
}

export function findAngleBy3points(angles : Angle[], points : Point[]) : Angle | undefined {
    const matched_angles = angles.filter(x => angleMatches3points(x, points));
    if(matched_angles.length == 0){
        return undefined;
    }
    assert(matched_angles.length == 1);
    return matched_angles[0];
}

export function findEqualAnglesBy3pointsPair(points1 : Point[], points2 : Point[]) : [Angle, Angle] | undefined {
    assert(isClockwise(points1));
    assert(isClockwise(points2));

    const angles_list = supplementaryAngles.flat();
    angles_list.push(rightAngles);
    
    for(const angle_set of angles_list){
        const angles = angle_set.toArray();
        const angle1 = findAngleBy3points(angles, points1);
        if(angle1 != undefined){
            const angle2 = findAngleBy3points(angles, points2);
            if(angle2 != undefined){
                return [angle1, angle2];
            }
            else{
                return undefined;
            }
        }
    }

    return undefined;
}

export function findAnglesInPolygon(points_arg: Point[]) : Angle[] {
    const all_angles = Array.from(angleMap.values());
    const points = toClockwisePoints(points_arg);
    const angles : Angle[] = [];

    for(const idx of range(points.length)){
        const pts = [0, 1, 2].map(i => points[(idx + i) % points.length]);
        const angle = findAngleBy3points(all_angles, pts)!;
        assert(angle != undefined);

        angles.push(angle);
    }

    return angles;
}

export function findAngle(angle_points_arg : Point[]) : Angle | undefined {
    let angle_points =angle_points_arg.slice();
    if(! isClockwise(angle_points)){
        angle_points = [2, 1, 0].map(i => angle_points_arg[i]);
    }

    const [B, C, A] = angle_points;
    const lineA = getCommonLineOfPoints(C, A);
    const lineB = getCommonLineOfPoints(C, B);
    if(lineA == undefined || lineB == undefined){
        return undefined;
    }
    const CA = A.sub(C);
    const CB = B.sub(C);
    const directionA = Math.sign(CA.dot(lineA.e));
    const directionB = Math.sign(CB.dot(lineB.e));

    const key = angleKey(lineA, directionA, lineB, directionB, C);
    const angle = angleMap.get(key);
    if(angle == undefined){
        const point_ids = angle_points.map(x => `${x.id}`).join(", ");
        // msg(`point ids:${point_ids}  key:${key}`);
        for(const map_key of angleMap.keys()){
            // msg(`map key:${map_key}`);
        }
    }

    return angle;
}

export function addEqualAngles(angle1 : Angle, angle2 : Angle){
    const angle_sets = supplementaryAngles.flat().filter(x => x.has(angle1) || x.has(angle2));

    let angle_set : MySet<Angle>; 

    switch(angle_sets.length){
    case 0 : 
        angle_set = new MySet<Angle>(); 
        supplementaryAngles.push([angle_set, new MySet<Angle>()]);
        break;

    case 1 : 
        angle_set = angle_sets[0]; 
        break;
    default : 
        throw new MyError();
    }

    angle_set.add(angle1);
    angle_set.add(angle2);

    const angle_equality_propositions = propositions.filter(x => AppServices.isShapeProposition(x) && x.reason == PropositionReason.angle_equality).toArray() as ShapeProposition[];
    const proven_proposition = angle_equality_propositions.find(x => areSetsEqual(x.selectedShapes, [angle1, angle2]));
}

export function isEqualAngle(angleA : Angle, angleB : Angle) : boolean {
    if(angleA.isRightAngle() && angleB.isRightAngle()){
        return true;
    }

    for(const angle_set of supplementaryAngles.flat()){
        if(angle_set.has(angleA)){
            return angle_set.has(angleB);
        }
    }

    return false;
}

export function isEqualAnglePoints(angle_pointsA : Point[], angle_pointsB : Point[]) : boolean {
    const angleA = findAngle(angle_pointsA);
    const angleB = findAngle(angle_pointsB);

    if(angleA != undefined && angleB != undefined){
        return isEqualAngle(angleA, angleB);
    }

    return false;
}

export function findTrianglePairByAngles(angleA : Angle, angleB : Angle, triangles_list : MyArray<MyArray<Triangle>>) : [Triangle, Triangle] | undefined {
    for(const triangles of triangles_list){
        const trianglesA = getTrianglesByAngle(angleA, triangles);
        if(trianglesA.length == 0){
            continue;
        }

        const trianglesB = getTrianglesByAngle(angleB, triangles);
        if(trianglesB.length == 0){
            continue;
        }

        for(const triangleA of trianglesA){
            const idxA = triangleA.points.indexOf(angleA.intersection);
            assert(idxA != -1);

            for(const triangleB of trianglesB){
                const idxB = triangleB.points.indexOf(angleB.intersection);
                assert(idxB != -1);

                if(idxA == idxB){

                    return [triangleA, triangleB];

                }
                else{
                    msg(`make Angle Equality By Congruent Triangles : idx-A:${idxA} != idx-B:${idxB}`);
                }
            }
        }
    }

}

export function getAngleUnitVectors(angleA : Angle, angleB : Angle) : [Vec2, Vec2, Vec2, Vec2]{
    const e_AA = angleA.lineA.e.mul(angleA.directionA);
    const e_AB = angleA.lineB.e.mul(angleA.directionB);
    const e_BA = angleB.lineA.e.mul(angleB.directionA);
    const e_BB = angleB.lineB.e.mul(angleB.directionB);

    return [ e_AA, e_AB, e_BA, e_BB ];
}

export function setEqualShapes(refvars : RefVar[]){
    const map = new Map<string, Shape>();
    GlobalState.View__current!.allRealShapes().filter(x => x.name != "").forEach(x => map.set(x.name, x));
    const ref_shapes = refvars.map(x => map.get(x.name)).filter(x => x != undefined);
    if(ref_shapes.every(x => AppServices.isAngle(x))){
        // msg(`eq angles:${ref_shapes.map(x => x.name).join(" = ")}`);
        for(const i of range(ref_shapes.length - 1)){
            const angleA = ref_shapes[i] as Angle;
            const angleB = ref_shapes[i+1] as Angle;
            addEqualAngles(angleA, angleB);
        }
    }
}

// Equal lengths and corresponding sides of parallel/congruent/similar shapes.
export function addEqualLengths(lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol){
    let set = equalLengths.find(x => x.has(lengthSymbolA) || x.has(lengthSymbolB));
    if(set == undefined){
        set = new MySet<LengthSymbol>([ lengthSymbolA, lengthSymbolB ]);
        equalLengths.push(set);
    }
    else{
        set.add(lengthSymbolA);
        set.add(lengthSymbolB);
    }
}

export function getCommonPoint(lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol) : [Point, Point, Point] | undefined {
    const [AA, AB] = [ lengthSymbolA.pointA, lengthSymbolA.pointB ];
    const [BA, BB] = [ lengthSymbolB.pointA, lengthSymbolB.pointB ];

    if(AA == BA){
        return [ AA, AB, BB ];
    }
    else if(AA == BB){
        return [ AA, AB, BA ];        
    }
    else if(AB == BA){
        return [ AB, AA, BB ];
    }
    else if(AB == BB){
        return [ AB, AA, BA ];        
    }
    else{
        return undefined;
    }
}

export function getParallelLinesByPointsPair(As : [Point, Point], Bs : [Point, Point]) : [AbstractLine, AbstractLine] | undefined {
    const lineA = getCommonLineOfPoints(As[0], As[1]);
    const lineB = getCommonLineOfPoints(Bs[0], Bs[1]);
    if(lineA == undefined || lineB == undefined){
        return undefined;
    }

    if(isParallel(lineA, lineB)){
        return [lineA, lineB];
    }
    else{
        return undefined;
    }
}

export function findParallelLinesOfLengthSymbols(lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol) : [AbstractLine, AbstractLine] | undefined{
    const As : [Point, Point] = [lengthSymbolA.pointA, lengthSymbolA.pointB];
    const Bs : [Point, Point] = [lengthSymbolB.pointA, lengthSymbolB.pointB];

    const line_pair1 = getParallelLinesByPointsPair(As, Bs);
    if(line_pair1 == undefined){
        return undefined;
    }
    
    for(const idx of [0, 1]){        
        let Cs : [Point, Point];
        let Ds : [Point, Point];

        if(idx == 0){
            Cs = [As[0], Bs[0]];
            Ds = [As[1], Bs[1]];
        }
        else{
            Cs = [As[0], Bs[1]];
            Ds = [As[1], Bs[0]];
        }

        const line_pair2 = getParallelLinesByPointsPair(Cs, Ds);
        if(line_pair2 != undefined){
            return line_pair2;
        }
    }

    return undefined;
}

export function findTrianglePairByLengthSymbols(lengthSymbolA : LengthSymbol, lengthSymbolB : LengthSymbol, triangles_list : MyArray<MyArray<Triangle>>) : [Triangle, Triangle] | undefined {
    for(const triangles of triangles_list){
        const trianglesA = getTrianglesByLengthSymbol(lengthSymbolA, triangles);
        if(trianglesA.length == 0){
            continue;
        }

        const trianglesB = getTrianglesByLengthSymbol(lengthSymbolB, triangles);
        if(trianglesB.length == 0){
            continue;
        }

        for(const triangleA of trianglesA){
            const idxA = triangleA.lines.indexOf(lengthSymbolA.line!);
            assert(idxA != -1);

            for(const triangleB of trianglesB){
                const idxB = triangleB.lines.indexOf(lengthSymbolB.line!);
                assert(idxB != -1);

                if(idxA == idxB){

                    return [triangleA, triangleB];

                }
                else{
                    msg(`make Angle Equality By Congruent Triangles : idx-A:${idxA} != idx-B:${idxB}`);
                }
            }
        }
    }

}
