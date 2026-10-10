import { T1, T2, T3, T4 } from "./inference";
import { AngleEqualityConstraint } from "./constraint";
import { ExprTransform } from "./deduction/expr_transform";
import { LengthEquality } from "./deduction/length_equality";
import { ShapeProposition } from "./deduction/proposition";
import { ShapeEquation } from "./deduction/shape_equation";
import { TriangleCongruence } from "./deduction/triangle_congruence";
import { Angle, LengthSymbol } from "./dimension_symbol";
import { Motion } from "./geometry";
import { Widget, MathEntity, TextBlock } from "./json";
import { ClickShape, EnumSelection, PropertySetting, TextPrompt, ToolSelection } from "./operation";
import { AbstractLine, Circle, CircleArc, Point, Polygon, Shape, Triangle } from "./shape";
import { Assumption, Statement } from "./statement";
import { ExprTransformBuilder, MotionBuilder, ShapeEquationBuilder } from "./tool";

export function isTriangle(obj : any) : obj is Triangle {
    return obj instanceof Triangle;
}


export function isTextBlock(obj : any) : obj is TextBlock {
    return obj instanceof TextBlock;
}

export function isToolSelection(obj : any) : obj is ToolSelection {
    return obj instanceof ToolSelection;
}
export function isEnumSelection(obj : any) : obj is EnumSelection {
    return obj instanceof EnumSelection;
}
export function isTextPrompt(obj : any) : obj is TextPrompt {
    return obj instanceof TextPrompt;
}
export function isShapeEquationBuilder(obj : any) : obj is ShapeEquationBuilder {
    return obj instanceof ShapeEquationBuilder;
}
export function isExprTransformBuilder(obj : any) : obj is ExprTransformBuilder {
    return obj instanceof ExprTransformBuilder;
}
export function isT1(obj : any) : obj is T1 {
    return obj instanceof T1;
}
export function isT2(obj : any) : obj is T2 {
    return obj instanceof T2;
}
export function isT3(obj : any) : obj is T3 {
    return obj instanceof T3;
}
export function isT4(obj : any) : obj is T4 {
    return obj instanceof T4;
}
export function isPoint(obj : any) : obj is Point {
    return obj instanceof Point;
}
export function isWidget(obj : any) : obj is Widget {
    return obj instanceof Widget;
}
export function isExprTransform(obj : any) : obj is ExprTransform {
    return obj instanceof ExprTransform;
}
export function isShapeEquation(obj : any) : obj is ShapeEquation {
    return obj instanceof ShapeEquation;
}
export function isStatement(obj : any) : obj is Statement {
    return obj instanceof Statement;
}
export function isMotion(obj : any) : obj is Motion {
    return obj instanceof Motion;
}
export function isAngle(obj : any) : obj is Angle {
    return obj instanceof Angle;
}
export function isMathEntity(obj : any) : obj is MathEntity {
    return obj instanceof MathEntity;
}
export function isPropertySetting(obj : any) : obj is PropertySetting {
    return obj instanceof PropertySetting;
}
export function isPolygon(obj : any) : obj is Polygon {
    return obj instanceof Polygon;
}
export function isShape(obj : any) : obj is Shape {
    return obj instanceof Shape;
}
export function isShapeProposition(obj : any) : obj is ShapeProposition {
    return obj instanceof ShapeProposition;
}
export function isLengthSymbol(obj : any) : obj is LengthSymbol {
    return obj instanceof LengthSymbol;
}
export function isTriangleCongruence(obj : any) : obj is TriangleCongruence {
    return obj instanceof TriangleCongruence;
}
export function isLengthEquality(obj : any) : obj is LengthEquality {
    return obj instanceof LengthEquality;
}
export function isAngleEqualityConstraint(obj : any) : obj is AngleEqualityConstraint {
    return obj instanceof AngleEqualityConstraint;
}
export function isAssumption(obj : any) : obj is Assumption {
    return obj instanceof Assumption;
}
export function isAbstractLine(obj : any) : obj is AbstractLine {
    return obj instanceof AbstractLine;
}
export function isCircleArc(obj : any) : obj is CircleArc {
    return obj instanceof CircleArc;
}
export function isClickShape(obj : any) : obj is ClickShape {
    return obj instanceof ClickShape;
}
export function isCircle(obj : any) : obj is Circle {
    return obj instanceof Circle;
}
export function isMotionBuilder(obj : any) : obj is MotionBuilder {
    return obj instanceof MotionBuilder;
}
// export function is(obj : any) : obj is  {
//     return obj instanceof ;
// }
// export function is(obj : any) : obj is  {
//     return obj instanceof ;
// }
// export function is(obj : any) : obj is  {
//     return obj instanceof ;
// }
// export function is(obj : any) : obj is  {
//     return obj instanceof ;
// }
// export function is(obj : any) : obj is  {
//     return obj instanceof ;
// }
// export function is(obj : any) : obj is  {
//     return obj instanceof ;
// }
// export function is(obj : any) : obj is  {
//     return obj instanceof ;
// }
// export function is(obj : any) : obj is  {
//     return obj instanceof ;
// }






console.log(`Loaded: type-guards`);
