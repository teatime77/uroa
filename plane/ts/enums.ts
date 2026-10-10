
export enum ShapeMode {
    none,
    depend,
    depend1,
    depend2,
    target,
    target1,
    target2,
}

export enum LineKind {
    line = 0,
    ray  = 1,
    ray_reverse = 2,
    line_segment = 3
}

export enum TriangleCongruenceReason {
    none,
    side_side_side,
    side_angle_side,
    angle_side_angle,
};

export enum ShapeEquationReason {
    none = 50,
    sum_of_angles_is_pi,
    sum_of_angles_is_equal,
    sum_of_lengths_is_equal,
    sum_of_interior_angles_of_triangle_is_pi,
    sum_of_interior_angles_of_quadrilateral_is_2pi,
    exterior_angle_theorem,
}

export enum LengthEqualityReason {
    none = 100,
    radii_equal,
    common_circle,
    parallel_lines_distance,
    not_used,
    congruent_triangles,
    parallelogram_opposite_sides,
    parallelogram_diagonal_bisection,
    equivalence_class,
    midpoint,
};

export enum ExprTransformReason {
    none = 150,
    transposition,
    equality,
    add_equation,
    substitution,
    dividing_equation,
    arg_shift,
}

export enum AngleEqualityReason {
    none = 200,
    vertical_angles,
    parallel_line_angles,
    angle_bisector,
    congruent_triangles,
    parallelogram_opposite_angles,
    similar_triangles,
    isosceles_triangle_base_angles,
}

export enum PropositionReason {
    none = 250,
    angle_equality,
    length_equality,
    equation,
}

export enum TriangleQuadrilateralClass {
    none = 300,
    trapezoid,
    parallelogram,
    rhombus,
    isoscelesTriangle,
}

export enum ParallelogramReason {
    none = 400,
    each_opposite_sides_are_equal,
    each_opposite_sides_are_parallel,
    each_opposite_angles_are_equal,
    one_opposite_sides_are_parallel_and_equal,
    each_diagonal_bisections,
}

export enum RhombusReason {
    none = 500,
    all_sides_are_equal,
}

export enum IsoscelesTriangleReason {
    none = 520,
    two_sides_are_equal,
}

export enum ParallelReason {
    none = 600,
    parallelogram,
    corresponding_angles_or_alternate_angles_are_equal,
    supplementary_angles,
}

export enum TriangleSimilarityReason {
    none = 700,
    two_equal_angle_pairs,
};

export enum ShapeType {
    parallelogram = 800,
    rhombus,
    isosceles_triangle,
}

console.log(`Loaded: enums`);
