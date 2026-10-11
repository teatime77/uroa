import type { Vec2 } from "@i18n";

// Coordinate calculations only. Shape state, registration and UI belong to callers.
// The projection formulas assume unit vectors for e and normal.
export function calcFootFrom2Pos(position : Vec2, pos1 : Vec2, e : Vec2) : Vec2 {
    const v = position.sub(pos1);
    const h = e.dot(v);

    const foot = pos1.add(e.mul(h));

    return foot;
}

export function distanceFromLine(normal : Vec2, pointA : Vec2, position : Vec2) : number {
    return Math.abs( normal.dot(position.sub(pointA)) );
}

export function calcCirclePointTangent(center : Vec2, radius : number, position : Vec2) : [Vec2, Vec2] {
    const center_point_distance = center.distance(position);
    const tangent_point_distance = Math.sqrt(center_point_distance * center_point_distance - radius * radius);

    const [a, b, c] = [ radius, tangent_point_distance, center_point_distance ];
    const cos_theta = (b*b + c*c - a*a) / (2 * b * c );
    const theta  = Math.acos(cos_theta);

    const pc = center.sub(position);
    const tangent_positions : Vec2[] = [];
    for(const th of [theta, -theta]){
        const v = pc.rot(th).unit().mul(tangent_point_distance);

        const tangent_position = position.add(v);
        tangent_positions.push(tangent_position);
    }

    return tangent_positions as [Vec2, Vec2];
}
