import { UNIFIED_LESSON_TYPE } from "../schema.js";

export type DetectedFormat =
    | "unified-lesson-v0.1"
    | "diagram-blocks-array"
    | "game-root-object"
    | "movie-kyozai-bundle"
    | "webgpu-packages-array"
    | "unknown";

/** Heuristic format detection for routing legacy importers (no I/O). */
export function detectJsonFormat(raw: unknown): DetectedFormat {
    if (raw === null || typeof raw !== "object") return "unknown";

    if (!Array.isArray(raw)) {
        const o = raw as Record<string, unknown>;
        if (o.type === UNIFIED_LESSON_TYPE) return "unified-lesson-v0.1";

        if (
            typeof o.type === "string" &&
            typeof o.version === "number" &&
            Array.isArray(o.docs)
        ) {
            return "movie-kyozai-bundle";
        }

        if (
            (typeof o.uis === "object" && o.uis !== null) ||
            (typeof o.menus === "object" && o.menus !== null) ||
            (typeof o.actions === "object" && o.actions !== null)
        ) {
            return "game-root-object";
        }
    } else {
        const arr = raw as unknown[];
        if (arr.length === 0) return "unknown";
        const first = arr[0];
        if (first !== null && typeof first === "object" && !Array.isArray(first)) {
            const b = first as Record<string, unknown>;
            if (typeof b.typeName === "string" && typeof b.ports === "object") {
                return "diagram-blocks-array";
            }
            if (typeof b.name === "string" && ("computes" in b || "shapes" in b)) {
                return "webgpu-packages-array";
            }
        }
    }

    return "unknown";
}
