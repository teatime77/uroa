import {
    SUPPORTED_SCHEMA_VERSIONS,
    UNIFIED_LESSON_TYPE,
    type ModuleName,
    type TimelineStep,
    type UnifiedLesson,
} from "./schema.js";

export interface ValidationIssue {
    path: string;
    message: string;
}

const MODULE_NAMES: ModuleName[] = ["diagram", "game", "movie", "webgpu"];

const STEP_MODULES: Partial<Record<TimelineStep["step"], ModuleName>> = {
    runDiagram: "diagram",
    runGameWorld: "game",
    runMovieDoc: "movie",
    runWebgpuPackage: "webgpu",
};

function isObject(x: unknown): x is Record<string, unknown> {
    return x !== null && typeof x === "object" && !Array.isArray(x);
}

function isNonEmptyString(x: unknown): x is string {
    return typeof x === "string" && x.trim().length > 0;
}

function isTimelineStep(x: unknown): x is TimelineStep {
    if (!isObject(x)) return false;
    if (!isNonEmptyString(x.id)) return false;
    const step = x.step;
    if (typeof step !== "string") return false;
    switch (step) {
        case "runDiagram":
        case "runGameWorld":
        case "runMovieDoc":
        case "runWebgpuPackage":
            return true;
        case "wait":
            return typeof x.durationMs === "number" && x.durationMs >= 0;
        case "branch":
            return true;
        case "setState":
            return isNonEmptyString(x.key);
        default:
            return false;
    }
}

/** Returns issues; empty array means the document is structurally valid for v0.1. */
export function validateUnifiedLesson(raw: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!isObject(raw)) {
        issues.push({ path: "", message: "Root must be an object" });
        return issues;
    }

    if (raw.type !== UNIFIED_LESSON_TYPE) {
        issues.push({ path: "type", message: `Expected "${UNIFIED_LESSON_TYPE}"` });
    }

    const sv = raw.schemaVersion;
    if (
        typeof sv !== "string" ||
        !(SUPPORTED_SCHEMA_VERSIONS as readonly string[]).includes(sv)
    ) {
        issues.push({
            path: "schemaVersion",
            message: `Must be one of: ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}`,
        });
    }

    if (!isNonEmptyString(raw.lessonId)) {
        issues.push({ path: "lessonId", message: "Non-empty string required" });
    }

    if (typeof raw.title !== "string") {
        issues.push({ path: "title", message: "String required" });
    }

    const modules = raw.modules;
    if (!isObject(modules)) {
        issues.push({ path: "modules", message: "Object required" });
    } else {
        let anyEnabled = false;
        for (const m of MODULE_NAMES) {
            const v = modules[m];
            if (v === true) anyEnabled = true;
            if (v !== undefined && typeof v !== "boolean") {
                issues.push({ path: `modules.${m}`, message: "Must be boolean if present" });
            }
        }
        if (!anyEnabled) {
            issues.push({ path: "modules", message: "At least one module flag must be true" });
        }
    }

    if (!Array.isArray(raw.resources)) {
        issues.push({ path: "resources", message: "Array required" });
    } else {
        raw.resources.forEach((r, i) => {
            if (!isObject(r) || !isNonEmptyString(r.id) || !isNonEmptyString(r.uri)) {
                issues.push({
                    path: `resources[${i}]`,
                    message: "Each resource needs id and uri (non-empty strings)",
                });
            }
        });
    }

    if (!Array.isArray(raw.timeline)) {
        issues.push({ path: "timeline", message: "Array required" });
    } else if (raw.timeline.length === 0) {
        issues.push({ path: "timeline", message: "At least one step required" });
    } else {
        const ids = new Set<string>();
        raw.timeline.forEach((step, i) => {
            const p = `timeline[${i}]`;
            if (!isTimelineStep(step)) {
                issues.push({ path: p, message: "Invalid timeline step shape" });
                return;
            }
            if (ids.has(step.id)) {
                issues.push({ path: `${p}.id`, message: `Duplicate step id: ${step.id}` });
            }
            ids.add(step.id);

            const mod = STEP_MODULES[step.step];
            if (mod !== undefined) {
                const payloads = raw.modulePayloads;
                if (!isObject(payloads) || payloads[mod] === undefined || payloads[mod] === null) {
                    issues.push({
                        path: `modulePayloads.${mod}`,
                        message: `Required for step "${step.step}"`,
                    });
                }
                const mf = raw.modules;
                if (isObject(mf) && mf[mod] !== true) {
                    issues.push({
                        path: `modules.${mod}`,
                        message: `Must be true when timeline contains "${step.step}"`,
                    });
                }
            }
        });
    }

    if (raw.modulePayloads !== undefined && !isObject(raw.modulePayloads)) {
        issues.push({ path: "modulePayloads", message: "Must be an object if present" });
    }

    if (raw.limits !== undefined) {
        if (!isObject(raw.limits)) {
            issues.push({ path: "limits", message: "Must be an object if present" });
        } else {
            const lim = raw.limits;
            if (
                lim.maxTimelineSteps !== undefined &&
                (typeof lim.maxTimelineSteps !== "number" || lim.maxTimelineSteps < 1)
            ) {
                issues.push({ path: "limits.maxTimelineSteps", message: "Must be a number >= 1" });
            }
            if (
                lim.maxLessonWallClockMs !== undefined &&
                (typeof lim.maxLessonWallClockMs !== "number" || lim.maxLessonWallClockMs < 1)
            ) {
                issues.push({
                    path: "limits.maxLessonWallClockMs",
                    message: "Must be a number >= 1",
                });
            }
        }
    }

    return issues;
}

export function parseUnifiedLesson(raw: unknown): UnifiedLesson {
    const issues = validateUnifiedLesson(raw);
    if (issues.length > 0) {
        const msg = issues.map((e) => `${e.path}: ${e.message}`).join("; ");
        throw new Error(`Invalid UnifiedLesson: ${msg}`);
    }
    return raw as UnifiedLesson;
}
