import { assert, msg, Reading, TT } from "@i18n";
import { ShapeMode, TriangleQuadrilateralClass } from "../enums";
import { GlobalState, parallelogramClassifiers } from "../inference";
import { registerEntity } from "../json";
import { Point, AbstractLine, Quadrilateral, Shape } from "../shape";
import { LengthSymbol } from "../dimension_symbol";
import { Statement } from "../statement";

export abstract class TriangleQuadrilateralDetector extends Statement {
    shapeClass! : TriangleQuadrilateralClass;
}

abstract class QuadrilateralClassifier extends TriangleQuadrilateralDetector {
    quadrilateral() : Quadrilateral {
        assert(this.selectedShapes.length == 1 && this.selectedShapes[0] instanceof Quadrilateral);
        return this.selectedShapes[0] as Quadrilateral;
    }

    isParallelogram() : boolean {
        return this.shapeClass == TriangleQuadrilateralClass.parallelogram || this.shapeClass == TriangleQuadrilateralClass.rhombus;
    }

    setRelations(): void {
        super.setRelations();

        parallelogramClassifiers.add(this);
    }

    draw() : void {
        assert(this.selectedShapes.length == 1 && this.selectedShapes[0] instanceof Quadrilateral);
        const quadrilateral = this.selectedShapes[0] as Quadrilateral;

        const shapes = this.auxiliaryShapes.filter(x => x.mode != ShapeMode.none) as Shape[];
        for(const shape of shapes){
            let p1 : Point;
            let p2 : Point;

            if(shape instanceof LengthSymbol){

                [p1, p2] = [ shape.pointA, shape.pointB ];
            }
            else if(shape instanceof AbstractLine){
                const line = shape;

                const idx = quadrilateral.lines.indexOf(line);
                if(idx == -1){
                    msg(`Quadrilateral-Classifier error:${this.id} shape:${shape.id}:${shape.constructor.name}`);
                    continue;
                }
                assert(idx != -1);
                [p1, p2] = [quadrilateral.points[idx], quadrilateral.points[(idx + 1) % quadrilateral.points.length]];
            }
            else{
                shape.draw();
                continue;
            }

            const color = shape.modeColor();
            const line_width = shape.modeLineWidth();
            GlobalState.View__current!.drawLineRaw(p1.position, p2.position, color, line_width);
        }
    }
}

export class ParallelogramClassifier extends QuadrilateralClassifier {   
    reading(): Reading {
        return this.textReading(TT("this is a parallelogram."));
    }
}

registerEntity(ParallelogramClassifier.name, (obj: any) => new ParallelogramClassifier(obj));

export class RhombusClassifier extends ParallelogramClassifier {    
    reading(): Reading {
        return this.textReading(TT("this is a rhombus."));
    }
}

registerEntity(RhombusClassifier.name, (obj: any) => new RhombusClassifier(obj));

console.log(`Loaded: quadrilateral`);
