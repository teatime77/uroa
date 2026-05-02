import type { TimelineStep, UnifiedLesson } from "./schema.js";
import { parseUnifiedLesson } from "./validate.js";

export type RuntimePhase = "init" | "load" | "run" | "pause" | "resume" | "stop" | "teardown";

export interface StepResult {
    stepId: string;
    ok: boolean;
    detail?: string;
}

export interface DryRunOptions {
    /** If set, `wait` steps resolve immediately (default true). */
    skipWaits?: boolean;
}

/**
 * v0.1 dry-run: validates structure then walks the timeline without touching
 * diagram/game/movie/webgpu. Real adapters are added in a later phase.
 */
export class UnifiedRuntime {
    private lesson: UnifiedLesson;
    private phase: RuntimePhase = "init";

    constructor(lesson: UnifiedLesson) {
        this.lesson = lesson;
    }

    static fromUnknown(raw: unknown): UnifiedRuntime {
        return new UnifiedRuntime(parseUnifiedLesson(raw));
    }

    getLesson(): UnifiedLesson {
        return this.lesson;
    }

    getPhase(): RuntimePhase {
        return this.phase;
    }

    async dryRun(options: DryRunOptions = {}): Promise<StepResult[]> {
        const skipWaits = options.skipWaits !== false;
        this.phase = "init";
        this.phase = "load";
        this.phase = "run";

        const results: StepResult[] = [];
        const max = this.lesson.limits?.maxTimelineSteps ?? 10_000;
        if (this.lesson.timeline.length > max) {
            results.push({
                stepId: "",
                ok: false,
                detail: `timeline length ${this.lesson.timeline.length} exceeds limits.maxTimelineSteps (${max})`,
            });
            this.phase = "stop";
            return results;
        }

        for (const step of this.lesson.timeline) {
            results.push(await this.simulateStep(step, skipWaits));
        }

        this.phase = "stop";
        this.phase = "teardown";
        return results;
    }

    private async simulateStep(step: TimelineStep, skipWaits: boolean): Promise<StepResult> {
        switch (step.step) {
            case "wait":
                if (!skipWaits && step.durationMs > 0) {
                    await new Promise((r) => setTimeout(r, Math.min(step.durationMs, 50)));
                }
                return { stepId: step.id, ok: true };
            case "branch":
                return { stepId: step.id, ok: true, detail: "branch not evaluated in dry-run" };
            case "setState":
                return { stepId: step.id, ok: true };
            case "runDiagram":
            case "runGameWorld":
            case "runMovieDoc":
            case "runWebgpuPackage":
                return {
                    stepId: step.id,
                    ok: true,
                    detail: "adapter not invoked (dry-run)",
                };
            default: {
                const _exhaustive: never = step;
                return { stepId: (_exhaustive as TimelineStep).id, ok: false };
            }
        }
    }
}
