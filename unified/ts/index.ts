export {
    UNIFIED_LESSON_TYPE,
    SUPPORTED_SCHEMA_VERSIONS,
    type SchemaVersion,
    type ModuleName,
    type ModuleFlags,
    type ResourceRef,
    type TimelineStep,
    type ModulePayloads,
    type UnifiedLesson,
} from "./schema.js";

export { validateUnifiedLesson, parseUnifiedLesson, type ValidationIssue } from "./validate.js";

export { UnifiedRuntime, type RuntimePhase, type StepResult, type DryRunOptions } from "./runtime.js";

export { detectJsonFormat, type DetectedFormat } from "./migration/detect-format.js";

export { LEGACY_MAPPING_VERSION } from "./migration/legacy-mapping.js";
