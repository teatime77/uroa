import type { DataType } from "../data_type";

export interface PlotSeries { readonly name: string; readonly path: readonly string[]; readonly color: string; }
export interface PlotGroup { readonly name: string; readonly series: readonly PlotSeries[]; }
export interface PlotSample { readonly time: number; readonly values: readonly number[]; }
export interface PlotStatistics { readonly mean: number; readonly sigma: number; }
export interface PlotScale { readonly range: [number, number]; readonly dtick: number; }

const colors = ["red", "green", "blue", "orange", "purple", "cyan"];
const axisColors: Record<string, string> = { x: "red", y: "green", z: "blue" };

/** Discover panels from metadata, including structs other than IMU/vec3. */
export function getPlotGroups(type: DataType): PlotGroup[] {
    const groups: PlotGroup[] = [];
    const visit = (type: DataType, path: string[]) => {
        if (type.dimensions.length) throw new Error("配列のグラフはまだ対応していません。");
        if (type.typeName === "number") {
            groups.push({ name: path.join(".") || "number", series: [{ name: path.at(-1) || "value", path, color: "red" }] });
            return;
        }
        const struct = type.struct;
        if (!struct) return;
        const fields = struct.members.filter(field => field.type.typeName === "number" && !field.type.dimensions.length);
        if (fields.length) groups.push({
            name: path.join(".") || struct.name,
            series: fields.map((field, index) => ({ name: field.name, path: [...path, field.name], color: axisColors[field.name] || colors[index % colors.length] })),
        });
        for (const field of struct.members) if (field.type.struct) visit(field.type, [...path, field.name]);
    };
    visit(type, []);
    return groups;
}

/** Population standard deviation; Welford avoids subtracting two large squared sums. */
export function getStatistics(values: readonly number[]): PlotStatistics {
    let mean = 0, m2 = 0, n = 0;
    for (const value of values) {
        const delta = value - mean;
        mean += delta / ++n;
        m2 += delta * (value - mean);
    }
    return { mean, sigma: n ? Math.sqrt(Math.max(0, m2 / n)) : 0 };
}

export function getThreeSigmaScale(statistics: readonly PlotStatistics[]): PlotScale {
    if (!statistics.length) return { range: [-1, 1], dtick: 0.5 };
    let lower = Math.min(...statistics.map(s => s.mean - 3 * s.sigma));
    let upper = Math.max(...statistics.map(s => s.mean + 3 * s.sigma));
    const minimumSpan = Math.max(1e-6, Math.abs(lower + (upper - lower) / 2) * 0.02);
    if (upper - lower < minimumSpan) {
        const center = lower + (upper - lower) / 2;
        lower = center - minimumSpan / 2;
        upper = center + minimumSpan / 2;
    }
    const rawTick = (upper - lower) / 5;
    const base = 10 ** Math.floor(Math.log10(rawTick));
    const dtick = [1, 2, 5, 10].map(factor => factor * base).find(step => step >= rawTick)!;
    return { range: [Math.floor(lower / dtick) * dtick, Math.ceil(upper / dtick) * dtick], dtick };
}

export class PlotHistory {
    readonly groups: readonly PlotGroup[];
    readonly series: readonly PlotSeries[];
    readonly samples: PlotSample[] = [];
    private origin?: number;

    constructor(readonly type: DataType, readonly windowSeconds = 30, readonly maximumSamples = 6000) {
        this.groups = getPlotGroups(type);
        this.series = this.groups.flatMap(group => [...group.series]);
    }

    append(value: unknown, now: number): void {
        this.type.validateValue(value);
        this.origin ??= now;
        const time = (now - this.origin) / 1000;
        const values = this.series.map(series => {
            let current: unknown = value;
            for (const name of series.path) current = (current as Record<string, unknown>)[name];
            return current as number;
        });
        this.samples.push({ time, values });
        this.prune(time);
    }

    prune(time: number): void {
        const first = this.samples.findIndex(sample => sample.time >= time - this.windowSeconds);
        if (first < 0) this.samples.length = 0;
        else if (first) this.samples.splice(0, first);
        if (this.samples.length > this.maximumSamples) this.samples.splice(0, this.samples.length - this.maximumSamples);
    }

    clear(): void { this.samples.length = 0; this.origin = undefined; }

    getScales(): PlotScale[] {
        let index = 0;
        return this.groups.map(group => getThreeSigmaScale(group.series.map(() => {
            const seriesIndex = index++;
            return getStatistics(this.samples.map(sample => sample.values[seriesIndex]));
        })));
    }
}
