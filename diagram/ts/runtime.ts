import { cancelSpeech } from "@i18n";
import type { ActionBlock } from "./procedure";

export let stopFlag = false;
export let isRunning = false;
let controller = new AbortController();
let stopChildren: () => void = () => {};

export function setStopChildren(stop: () => void): void { stopChildren = stop; }

export function stopDiagram(): void {
    stopFlag = true;
    controller.abort();
    cancelSpeech();
    stopChildren();
}

export async function runBlockChain(top: ActionBlock): Promise<void> {
    for (let block: ActionBlock | undefined = top; block && !stopFlag; block = block.nextBlock()) {
        await block.run();
    }
}

export async function runProcedures(run: () => Promise<void>): Promise<void> {
    if (isRunning) return;
    isRunning = true;
    stopFlag = false;
    controller = new AbortController();
    try { await run(); }
    finally { isRunning = false; }
}

/** Cancel a Sleep block immediately, including an infinite-loop delay. */
export function waitProcedure(ms: number): Promise<void> {
    const signal = controller.signal;
    if (signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
        const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
        };
        const timer = setTimeout(done, ms);
        signal.addEventListener("abort", done, { once: true });
    });
}
