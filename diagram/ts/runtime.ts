/**
 * diagramの実行世代、停止通知、データ依存順の開始処理と取消可能な待機を管理する。ブロックの描画や保存は扱わない。
 */
import { cancelSpeech } from "@i18n";
import type { ActionBlock } from "./procedure";
import type { Block, FunctionBlock } from "./block";

/**
 * 現在の実行へ停止を要求する共有フラグ。停止と次の開始時に更新する。
 */
export let stopFlag = false;
/**
 * Start処理の多重起動を防ぐ実行中フラグ。
 */
export let isRunning = false;
/**
 * 現在の実行に属する待機と非同期処理を取り消す制御元。
 */
let controller = new AbortController();
/**
 * 他アプリへ委譲した再生を停止する登録済みの処理。
 */
let stopChildren: () => void = () => {};
/**
 * diagram停止時に通知する購読者の集合。
 */
const stopListeners = new Set<() => void>();

/**
 * 停止通知の購読を登録し、解除関数を返す。
 *
 * @param listener 変更通知を受け取る処理。
 */
export function subscribeDiagramStop(listener: () => void): () => void {
    stopListeners.add(listener);
    return () => { stopListeners.delete(listener); };
}

/**
 * diagram停止時に子アプリの再生を止める処理を登録する。
 */
export function setStopChildren(stop: () => void): void { stopChildren = stop; }
/**
 * 現在の実行を取り消すAbortSignalを返す。
 */
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

/**
 * 実行・待機・音声・子アプリへまとめて停止を通知する。
 */
export function stopDiagram(): void {
    stopFlag = true;
    controller.abort();
    for (const listener of stopListeners) listener();
    cancelSpeech();
    stopChildren();
}

/**
 * 接続されたアクションを順に実行し、停止要求があれば連鎖を終了する。
 */
export async function runBlockChain(top: ActionBlock): Promise<void> {
    for (let block: ActionBlock | undefined = top; block && !stopFlag; block = block.nextBlock()) {
        await block.run();
    }
}

/**
 * 多重起動を抑止し、新しい取消世代でStart処理を実行する。終了時に実行中状態を戻す。
 */
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
