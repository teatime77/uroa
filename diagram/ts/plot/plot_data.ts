/** 入力型からの系列構成、時系列履歴の保持、縦軸用の統計計算を行う。 */
import type { DataType, StructValue } from "../data_type";

/** 1本の折れ線に対応する名前・入力値内の参照経路・表示色。 */
export interface PlotSeries {
    readonly name: string;
    /** 入力値から数値へたどるフィールド名の列。数値入力では空になる。 */
    readonly path: readonly string[];
    readonly color: string;
}

/** 同じパネルと縦軸を共有する系列のまとまり。 */
export interface PlotGroup {
    readonly name: string;
    readonly series: readonly PlotSeries[];
}

/** 1回の受信で記録する経過時間と全系列の値。 */
export interface PlotSample {
    /** 最初のサンプルからの経過秒数。入力のtimeがあれば、その時刻を基準にする。 */
    readonly time: number;
    /** PlotHistory.seriesと同じ順序で並ぶ数値。 */
    readonly values: readonly number[];
}

/** 系列の平均と母標準偏差。 */
export interface PlotStatistics {
    readonly mean: number;
    readonly sigma: number;
}

/** 縦軸の表示範囲と目盛り間隔。 */
export interface PlotScale {
    readonly range: [number, number];
    readonly dtick: number;
}

/** 軸名以外の系列へ順番に割り当てる色。 */
const colors = ["red", "green", "blue", "orange", "purple", "cyan"];
/** x・y・zの系列には、パネルが違っても同じ色を割り当てる。 */
const axisColors: Record<string, string> = { x: "red", y: "green", z: "blue" };

/**
 * 入力型を再帰的にたどり、数値フィールドを構造体ごとのパネルへまとめる。
 * 最上位の数値型timeは横軸用のミリ秒時刻として扱い、系列から除く。
 * @param type グラフへ入力する値の型。
 * @returns パネル名と各系列の参照経路を持つグループ一覧。
 * @throws 配列型を走査した場合。
 */
export function getPlotGroups(type: DataType): PlotGroup[] {
    const groups: PlotGroup[] = [];
    /**
     * 現在の型の数値系列を登録し、入れ子の構造体へ進む。
     * @param type 現在走査している型。
     * @param path 入力値から現在の型までのフィールド名の列。
     */
    const visit = (type: DataType, path: string[]) => {
        if (type.dimensions.length) {
            throw new Error("配列のグラフはまだ対応していません。");
        }
        if (type.typeName === "number") {
            groups.push({
                name: path.join(".") || "number",
                series: [{ name: path.at(-1) || "value", path, color: "red" }]
            });
            return;
        }
        const struct = type.struct;
        if (!struct) {
            return;
        }
        const fields = struct.members.filter(field => field.type.typeName === "number" &&
            !field.type.dimensions.length && (path.length > 0 || field.name !== "time"));
        if (fields.length) {
            groups.push({
                name: path.join(".") || struct.name,
                series: fields.map((field, index) => ({
                    name: field.name,
                    path: [...path, field.name],
                    color: axisColors[field.name] || colors[index % colors.length]
                })),
            });
        }
        for (const field of struct.members) {
            if (field.type.struct) {
                visit(field.type, [...path, field.name]);
            }
        }
    };
    visit(type, []);
    return groups;
}

/**
 * Welford法で桁落ちを抑えながら平均と母標準偏差を求める。
 * @param values 統計の対象となる数値列。
 * @returns 平均と母標準偏差。空の数値列ではどちらも0。
 */
export function getStatistics(values: readonly number[]): PlotStatistics {
    let mean: number = 0;
    // 平均からの偏差平方和を、値を1つ取り込むごとに更新する。
    let m2: number = 0;
    let n: number = 0;
    for (const value of values) {
        const delta = value - mean;
        mean += delta / ++n;
        m2 += delta * (value - mean);
    }
    return { mean, sigma: n ? Math.sqrt(Math.max(0, m2 / n)) : 0 };
}

/**
 * 各系列の平均±3σを含む縦軸範囲と、読みやすい目盛り間隔を求める。
 * @param statistics 同じパネルに表示する各系列の統計。
 * @returns 目盛りに合わせた表示範囲と間隔。系列がなければ既定の範囲。
 */
export function getThreeSigmaScale(statistics: readonly PlotStatistics[]): PlotScale {
    if (!statistics.length) {
        return { range: [-1, 1], dtick: 0.5 };
    }
    let lower = Math.min(...statistics.map(s => s.mean - 3 * s.sigma));
    let upper = Math.max(...statistics.map(s => s.mean + 3 * s.sigma));
    // 定数に近い系列でも縦軸がつぶれないよう、中心値に応じた最小幅を確保する。
    const minimumSpan = Math.max(1e-6, Math.abs(lower + (upper - lower) / 2) * 0.02);
    if (upper - lower < minimumSpan) {
        const center = lower + (upper - lower) / 2;
        lower = center - minimumSpan / 2;
        upper = center + minimumSpan / 2;
    }
    // 約5区間を目安に、1・2・5・10と10の累乗から目盛り間隔を選ぶ。
    const rawTick = (upper - lower) / 5;
    const base = 10 ** Math.floor(Math.log10(rawTick));
    const dtick = [1, 2, 5, 10].map(factor => factor * base).find(step => step >= rawTick)!;
    return { range: [Math.floor(lower / dtick) * dtick, Math.ceil(upper / dtick) * dtick], dtick };
}

/** 入力型に対応する受信履歴を、保持時間と最大件数の範囲で管理する。 */
export class PlotHistory {
    /** パネルの表示順。 */
    readonly groups: readonly PlotGroup[];
    /** 全パネルの系列を表示順に並べた一覧。 */
    readonly series: readonly PlotSeries[];
    readonly samples: PlotSample[] = [];
    /** 最上位の数値型timeを横軸に使うかどうか。 */
    private readonly hasInputTime: boolean;
    /** 最初のサンプルの時刻。単位はミリ秒。 */
    private origin?: number;
    /** 時刻の巻き戻りを検出するための直前の時刻。単位はミリ秒。 */
    private previousTime?: number;

    /**
     * 入力型からパネルと系列を構成する。
     * @param type 受信値の検証と系列の構成に使う型。
     * @param windowSeconds 最新サンプルを基準にした履歴の保持秒数。
     * @param maximumSamples 保持するサンプルの最大件数。
     */
    constructor(readonly type: DataType, readonly windowSeconds = 30, readonly maximumSamples = 6000) {
        this.groups = getPlotGroups(type);
        this.series = this.groups.flatMap(group => [...group.series]);
        this.hasInputTime = type.struct?.members.some(field => field.name === "time" &&
            field.type.typeName === "number" && !field.type.dimensions.length) ?? false;
    }

    /**
     * 値を検証して各系列の数値を記録し、保持範囲外の履歴を削除する。
     * 数値型timeがあれば優先し、機器再起動や時刻の桁あふれで巻き戻ったら履歴を消す。
     * @param value 入力型に従う受信値。
     * @param now 入力に数値型timeがない場合の受信時刻。performance.now()のミリ秒値。
     * @throws 受信値が入力型に適合しない場合。
     */
    append(value: unknown, now: number): void {
        this.type.validateValue(value);
        const timestamp = this.hasInputTime ? (value as StructValue).time as number : now;
        if (this.previousTime !== undefined && timestamp < this.previousTime) {
            this.clear();
        }
        this.origin ??= timestamp;
        this.previousTime = timestamp;
        const time = (timestamp - this.origin) / 1000;
        const values = this.series.map(series => {
            let current: unknown = value;
            for (const name of series.path) {
                current = (current as Record<string, unknown>)[name];
            }
            return current as number;
        });
        this.samples.push({ time, values });
        this.prune(time);
    }

    /**
     * 指定時刻から見て古いサンプルと、最大件数を超えた古いサンプルを削除する。
     * @param time 最初のサンプルからの経過秒数。
     */
    prune(time: number): void {
        const first = this.samples.findIndex(sample => sample.time >= time - this.windowSeconds);
        if (first < 0) {
            this.samples.length = 0;
        }
        else if (first) {
            this.samples.splice(0, first);
        }
        if (this.samples.length > this.maximumSamples) {
            this.samples.splice(0, this.samples.length - this.maximumSamples);
        }
    }

    /** サンプルと時刻の起点を消去し、次の受信から計時し直す。 */
    clear(): void {
        this.samples.length = 0;
        this.origin = undefined;
        this.previousTime = undefined;
    }

    /**
     * 保持中の履歴からパネルごとの縦軸範囲と目盛りを計算する。
     * @returns groupsと同じ順序の縦軸設定。
     */
    getScales(): PlotScale[] {
        let index = 0;
        return this.groups.map(group => getThreeSigmaScale(group.series.map(() => {
            // samplesの値は全パネル共通の系列順なので、パネルをまたいで番号を進める。
            const seriesIndex = index++;
            return getStatistics(this.samples.map(sample => sample.values[seriesIndex]));
        })));
    }
}
