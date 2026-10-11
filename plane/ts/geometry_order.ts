// Point ordering only; no relation state, registration or UI dependencies.
import { assert, MyError } from "@i18n";
import type { Point } from "./shape";

export function isClockwise(points : Point[]) : boolean {
    assert(points.length == 3);
    const [A, B, C] = points.map(x => x.position);
    const AB = B.sub(A);
    const AC = C.sub(A);
    
    const cross_product = AB.cross(AC);
    assert(cross_product != 0);

    return 0 < cross_product;
}

export function toClockwisePoints(points : Point[]) : Point[] {
    if(points.length == 3){

        if(isClockwise(points)){
            return points.slice();
        }
        else{
            return [2, 1, 0].map(i => points[i]);
        }
    }

    if(points.length != 4){
        throw new MyError();
    }

    const [p1, p2, p3] = toClockwisePoints(points.slice(0, 3));
    const p4 = points[3];
    if(isClockwise([p1,p4,p2])){
        return [p1, p4, p2, p3];
    }
    else if(isClockwise([p2, p4, p3])){
        return [p1, p2, p4, p3 ];
    }
    else if(isClockwise([p3, p4, p1])){
        return [p3, p4, p1, p2];
    }
    else{

        throw new MyError();
    }
}
