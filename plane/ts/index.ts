import "./enums.js";
import "./inference.js";
import "./json.js";
import "./all_functions.js";
import "./statement.js";

import { setAppServices } from "./inference.js";
import { getEquationOfTextBlock, getTextOfTextBlock, isEquationTextBlock, setCaptionEvent, texClickOfTextBlock } from "./all_functions.js";

export { ShapeMode } from "./enums.js"
export { usedReasons, reasonToDoc, GlobalState, } from "./inference.js"
export { removeDiv, parseObject, loadData, getOperationsText, initRelations } from "./all_functions.js"
export { Widget, MathEntity } from "./json.js"

export { Statement } from "./statement.js";
export { Plane } from "./plane_ui.js"

import { Builder__setToolByName, Builder__setToolByShape, showProperty, makeShapeEquationByEquationText, Point__fromArgs, makeEquationTextBlock, makeLineSegment, makeAngleEqualityByVertical_angles, showPropertyDlg, makeAngleEqualityByParallelLines, makeAngleEqualityByAngleBisector, makeAngleEqualityByCongruentTriangles, makeAngleEqualityByParallelogramOppositeAngles, makeAngleEqualityBySimilarTriangles, makeEqualLengthByRadiiEqual, makeEqualLengthByCommonCircle, makeEqualLengthByParallelLines, makeEqualLengthByCongruentTriangles, makeEqualLengthByParallelogramOppositeSides, makeEqualLengthByParallelogramDiagonalBisection, makeEqualLengthByEquivalenceClass, makeRay, inputTextPrompt, makeTriangleCongruence, makeTriangleSimilarity, showMenu, makeAngleEqualityByIsoscelesTriangleBaseAngles, makeParallelDetectorByParallelogram, makeParallelDetectorByCorrespondingAlternateAnglesEqual, makeParallelDetectorBySupplementaryAngles, makeIsoscelesTriangleDetector, makeQuadrilateralClassifier, makeExprTransformByTransposition, makeExprTransformByEquality, makeExprTransformByAddEquation, makeExprTransformBySubstitution, makeExprTransformByDividingEquation, makeShapeProposition, makeEquationProposition } from "./factories.js"
import { makeClickTerm } from "./operation.js";
import { isAngle, isAngleEqualityConstraint, isAssumption, isEnumSelection, isExprTransform, isExprTransformBuilder, isLengthSymbol, isMotion, isPoint, isPolygon, isShape, isShapeEquation, isShapeProposition, isStatement, isT1, isT2, isT3, isT4, isTextBlock, isToolSelection, isTriangle, isTriangleCongruence, isWidget } from "./type_guards.js";
import { addSupplementaryAngles } from "./tool.js";

export { playBack, initPlane, loadOperationsText } from "./factories.js"
export { AbstractCanvas } from "./view.js";

setAppServices({
    Builder__setToolByName          : Builder__setToolByName,
    showProperty                    : showProperty,
    Builder__setToolByShape         : Builder__setToolByShape,
    makeShapeEquationByEquationText : makeShapeEquationByEquationText,
    Point__fromArgs                 : Point__fromArgs,
    makeEquationTextBlock           : makeEquationTextBlock,
    makeLineSegment,
    makeAngleEqualityByVertical_angles,
    showPropertyDlg,
    makeAngleEqualityByParallelLines,
    makeAngleEqualityByAngleBisector,
    makeAngleEqualityByCongruentTriangles,
    makeAngleEqualityByParallelogramOppositeAngles,
    makeAngleEqualityBySimilarTriangles,
    makeEqualLengthByRadiiEqual,
    makeEqualLengthByCommonCircle,
    makeEqualLengthByParallelLines,
    makeEqualLengthByCongruentTriangles,
    makeEqualLengthByParallelogramOppositeSides,
    makeEqualLengthByParallelogramDiagonalBisection,
    makeEqualLengthByEquivalenceClass,
    makeRay,
    inputTextPrompt,
    makeTriangleCongruence,
    makeTriangleSimilarity,
    showMenu,
    makeAngleEqualityByIsoscelesTriangleBaseAngles,
    makeParallelDetectorByParallelogram,
    makeParallelDetectorByCorrespondingAlternateAnglesEqual,
    makeParallelDetectorBySupplementaryAngles,
    makeIsoscelesTriangleDetector,
    makeQuadrilateralClassifier,
    makeExprTransformByTransposition,
    makeExprTransformByEquality,
    makeExprTransformByAddEquation,
    makeExprTransformBySubstitution,
    makeExprTransformByDividingEquation,
    makeShapeProposition,
    makeEquationProposition,
    isEquationTextBlock,
    setCaptionEvent,
    getEquationOfTextBlock,
    texClickOfTextBlock,
    getTextOfTextBlock,
    addSupplementaryAngles,
    makeClickTerm,
    isAngle,
    isAngleEqualityConstraint,
    isAssumption,
    isEnumSelection,
    isExprTransform,
    isExprTransformBuilder,
    isLengthSymbol,
    isMotion,
    isPoint,
    isPolygon, 
    isShape, 
    isShapeEquation, 
    isShapeProposition, 
    isStatement, 
    isT1, 
    isT2, 
    isT3, 
    isT4, 
    isTextBlock, 
    isToolSelection, 
    isTriangle, 
    isWidget,
    isTriangleCongruence
});
