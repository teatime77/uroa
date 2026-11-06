/**
 * bytecode.tsが同一コンパイルから作る、diagram内だけの名前・型・最終命令PCの対応。
 * python-block.tsが転送Receiptと一緒に保持し、編集・再送・切断で失効させる。
 * debugger-view.tsが停止SnapshotのBPチェーンとCALL命令を検証してフレームを復元する。
 * バイナリとデバッグ情報は保存・コピーしない。送信する停止点は文を評価する前のPCだけ。
 */
import type { DeviceApi, PythonVariable } from "./semantic";

export interface PythonDebugFunction {
    name: string;
    entryPc: number;
    endPc: number;
    slots: number;
    variables: readonly PythonVariable[];
}

export interface PythonDebugInfo {
    source: string;
    api: DeviceApi;
    globals: readonly PythonVariable[];
    functions: readonly PythonDebugFunction[];
    stops: readonly { pc: number; line: number; charPos: number; owner?: string }[];
    instructions: Map<number, { charPos: number; owner?: string; opcode: string; operand?: string }>;
}

export interface PythonDebugBuild {
    bytes: Uint8Array;
    info: PythonDebugInfo;
}

/** 設定不可の行を別行へ移さず拒否する。同じ行の複数停止点は全件送信する。 */
export function resolveBreakpoints(info: PythonDebugInfo, lines: readonly number[]): number[] {
    const unavailable = lines.filter(line => !info.stops.some(point => point.line === line));
    if (unavailable.length !== 0) {
        throw new Error(`ブレークポイントを設定できない行: ${unavailable.join(", ")}。実行する文の行を選んでください。`);
    }
    return [...new Set(info.stops.filter(point => lines.includes(point.line)).map(point => point.pc))]
        .sort((left, right) => left - right);
}
