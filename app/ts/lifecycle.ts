export type AppState = "idle" | "initializing" | "ready" | "stopped" | "failed" | "disposing" | "disposed";

export interface AppModule {
    init(signal: AbortSignal): Promise<void>;
    stop(): void;
    dispose(): void | Promise<void>;
}

/** One instance belongs to one document. A disposed document must be reloaded. */
export class AppLifecycle {
    state: AppState = "idle";
    error: unknown;
    private controller = new AbortController();
    private startup?: Promise<void>;
    private teardown?: Promise<void>;
    private entered: AppModule[] = [];

    constructor(private modules: AppModule[], private onReady: () => void = () => {}) {}

    start(): Promise<void> {
        if (this.state === "disposing" || this.state === "disposed") {
            return Promise.reject(new Error("The application was disposed. Reload the page to start again."));
        }
        // Share the pending promise, including its failure, rather than adding listeners twice.
        if (this.startup) return this.startup;
        this.state = "initializing";
        this.startup = this.initialize();
        return this.startup;
    }

    private async initialize(): Promise<void> {
        try {
            for (const module of this.modules) {
                if (this.controller.signal.aborted) return;
                this.entered.push(module);
                await module.init(this.controller.signal);
            }
            if (this.controller.signal.aborted) return;
            this.state = "ready";
            this.onReady();
        } catch (error) {
            this.error = error;
            if (!this.controller.signal.aborted) this.state = "failed";
            this.stop();
            // Include the module whose initialization only partly succeeded.
            await this.release();
            throw error;
        }
    }

    stop(): void {
        if (this.state === "initializing") {
            this.controller.abort();
            this.state = "stopped";
        }
        const errors: unknown[] = [];
        for (const module of this.entered.slice().reverse()) {
            try { module.stop(); }
            catch (error) { errors.push(error); }
        }
        if (errors.length) console.error(new AggregateError(errors, "Application stop failed."));
    }

    dispose(): Promise<void> {
        if (this.teardown) return this.teardown;
        this.state = "disposing";
        this.controller.abort();
        this.stop();
        this.teardown = (async () => {
            // Initialization can acquire resources after an await; release them afterwards.
            await this.startup?.catch(() => {});
            try { await this.release(); }
            finally { this.state = "disposed"; }
        })();
        return this.teardown;
    }

    private async release(): Promise<void> {
        const modules = this.entered.splice(0).reverse();
        const errors: unknown[] = [];
        for (const module of modules) {
            try { await module.dispose(); }
            catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, "Application cleanup failed.");
    }
}
