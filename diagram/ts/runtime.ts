import { cancelSpeech } from "@i18n";
import type { ActionBlock } from "./procedure";
import type { Block, FunctionBlock } from "./block";

export let stopFlag = false;
export let isRunning = false;
let controller = new AbortController();
let stopChildren: () => void = () => {};
const stopListeners = new Set<() => void>();

export function subscribeDiagramStop(listener: () => void): () => void {
    stopListeners.add(listener);
    return () => { stopListeners.delete(listener); };
}

export function setStopChildren(stop: () => void): void { stopChildren = stop; }
export function getProcedureSignal(): AbortSignal { return controller.signal; }

/** Await Start functions in data dependency order before any action can speak. */
export async function runStartFunctions(blocks: readonly Block[]): Promise<void> {
    const functions = blocks.filter((block): block is FunctionBlock =>
        "runOnStart" in block && block.runOnStart === true);
    functions.forEach(block => block.resetForRun());
    const done = new Set<Block>(), visiting = new Set<Block>();
    const visit = async (block: Block): Promise<void> => {
        if (done.has(block) || stopFlag) return;
        if (visiting.has(block)) throw new Error("データ入力の接続が循環しています。");
        visiting.add(block);
        for (const port of block.ports) {
            for (const source of port.sources) {
                // Data sources have outputPorts; action-chain ports are excluded.
                if (source.parent.outputPorts().includes(source)) await visit(source.parent);
            }
        }
        if (!stopFlag && functions.includes(block as FunctionBlock)) await block.run();
        visiting.delete(block);
        done.add(block);
    };
    for (const block of functions) await visit(block);
}

export function stopDiagram(): void {
    stopFlag = true;
    controller.abort();
    for (const listener of stopListeners) listener();
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
