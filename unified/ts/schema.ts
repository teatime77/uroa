/** UnifiedLesson JSON v0.1 — data contract only (no visual editor). */

export const UNIFIED_LESSON_TYPE = "uroa-unified-lesson" as const;

/** Supported schema versions for this package. */
export const SUPPORTED_SCHEMA_VERSIONS = ["0.1.0"] as const;

export type SchemaVersion = (typeof SUPPORTED_SCHEMA_VERSIONS)[number];

export type ModuleName = "diagram" | "game" | "movie" | "webgpu";

/** Which subsystems this lesson may touch (declarative; used by validation). */
export type ModuleFlags = Partial<Record<ModuleName, boolean>>;

export interface ResourceRef {
    id: string;
    /** Absolute URL or app-relative path (e.g. /game/data/stage-1.json). */
    uri: string;
    kind?: "json" | "image" | "audio" | "shader" | "other";
}

export interface TimelineStepBase {
    id: string;
}

export interface TimelineRunDiagram extends TimelineStepBase {
    step: "runDiagram";
}

export interface TimelineRunGameWorld extends TimelineStepBase {
    step: "runGameWorld";
}

export interface TimelineRunMovieDoc extends TimelineStepBase {
    step: "runMovieDoc";
}

export interface TimelineRunWebgpuPackage extends TimelineStepBase {
    step: "runWebgpuPackage";
}

export interface TimelineWait extends TimelineStepBase {
    step: "wait";
    durationMs: number;
}

export interface TimelineBranch extends TimelineStepBase {
    step: "branch";
    /** v0.1: opaque condition id; evaluator added in a later phase. */
    conditionRef?: string;
    thenStepId?: string;
    elseStepId?: string;
}

export interface TimelineSetState extends TimelineStepBase {
    step: "setState";
    key: string;
    value: unknown;
}

export type TimelineStep =
    | TimelineRunDiagram
    | TimelineRunGameWorld
    | TimelineRunMovieDoc
    | TimelineRunWebgpuPackage
    | TimelineWait
    | TimelineBranch
    | TimelineSetState;

/** Per-module opaque payloads (legacy JSON shapes allowed until normalized). */
export type ModulePayloads = Partial<Record<ModuleName, unknown>>;

export interface UnifiedLesson {
    type: typeof UNIFIED_LESSON_TYPE;
    schemaVersion: SchemaVersion;
    lessonId: string;
    title: string;
    modules: ModuleFlags;
    resources: ResourceRef[];
    timeline: TimelineStep[];
    modulePayloads: ModulePayloads;
    /** Optional caps for runtime (enforced by UnifiedRuntime when wired). */
    limits?: {
        maxTimelineSteps?: number;
        maxLessonWallClockMs?: number;
    };
}
