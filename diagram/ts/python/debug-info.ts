/**
 * bytecode.tsが同一コンパイルから作る、diagram内だけの名前・型・最終命令PCの対応。
 * python-block.tsが転送Receiptと一緒に保持し、編集・再送・切断で失効させる。
 * debugger-view.tsが停止SnapshotのBPチェーンとCALL命令を検証してフレームを復元する。
 * バイナリとデバッグ情報は保存・コピーしない。行ブレークポイントは文を評価する前のPCだけ。
 */
import type { DeviceApi, PythonVariable } from "./semantic";

/**
 * 停止値と照合する関数の命令範囲・フレーム幅・変数配置。
 */
export interface PythonDebugFunction {
    /**
     * 表示・保存・名前解決に使用する名前。
     */
    name: string;
    /**
     * この関数またはモジュールの命令範囲の先頭PC。
     */
    entryPc: number;
    /**
     * この関数またはモジュールの命令範囲の末尾直後のPC。
     */
    endPc: number;
    /**
     * 管理領域・引数・局所・一時領域を含む固定フレーム幅。
     */
    slots: number;
    /**
     * 仮引数を含む変数の宣言・型・配置。
     */
    variables: readonly PythonVariable[];
}

/**
 * 元ソース・API定義と最終命令PC・停止位置・変数配置の対応。
 */
export interface PythonDebugInfo {
    /**
     * 解析・表示・位置照合に使用する元のPythonソース文字列。
     */
    source: string;
    /**
     * ネイティブAPIと、同一解析で追加したユーザークラス。型・nativeId・ABI指紋を共有する。
     */
    api: DeviceApi;
    /**
     * 全関数で共有する大域変数の型と配置。
     */
    globals: readonly PythonVariable[];
    /**
     * ユーザー関数またはAPI関数の名前と定義を管理する一覧。
     */
    functions: readonly PythonDebugFunction[];
    /**
     * 元の文の評価前に対応するPC・行番号・位置・所属関数の一覧。
     */
    stops: readonly { /** 命令列の先頭を0とする命令のバイト位置。 */ pc: number; /** 利用者へ表示する1始まりのソース行番号。 */ line: number; /** 元のPythonソース内のUTF-16位置。自動生成命令では-1を使う。 */ charPos: number; /** この命令・ラベルが属するユーザー関数名。モジュール本体ではundefined。 */ owner?: string }[];
    /**
     * stepPcsは文開始に加えて関数入口と暗黙return前を含み、VMへ別表として送る。
     */
    stepPcs: readonly number[];
    /**
     * 最終PCから命令と元ソースの位置へたどる対応表。
     */
    instructions: Map<number, { /** 元のPythonソース内のUTF-16位置。自動生成命令では-1を使う。 */ charPos: number; /** この命令・ラベルが属するユーザー関数名。モジュール本体ではundefined。 */ owner?: string; /** 内部命令列で扱う命令名。 */ opcode: string; /** 命令に付くオペランドの文字列表現。オペランドなしではundefined。 */ operand?: string }>;
}

/**
 * 同一生成のバイナリとデバッグ情報をまとめた結果。
 */
export interface PythonDebugBuild {
    /**
     * 同じ一回のコンパイルで作成した転送用バイナリ。
     */
    bytes: Uint8Array;
    /**
     * 同じbytesに対応する、diagram内だけで保持するデバッグ情報。
     */
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
