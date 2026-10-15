import { Vec2 } from "@i18n";
import type { Data, Layout } from "plotly.js";
import { FunctionBlock, registerFunctionBlock } from "../block";
import { PortType, theCanvas } from "../diagram_util";
import { Port } from "../port";
import { PlotHistory, type PlotScale } from "./plot_data";
import type { Attr } from "../ui";

type PlotlyAPI = typeof import("plotly.js");
let plotlyPromise: Promise<PlotlyAPI> | undefined;
function loadPlotly(): Promise<PlotlyAPI> {
    return plotlyPromise ??= import("plotly.js-gl3d-dist-min").then(module => module.default);
}

/** A generic time-series sink. All panels and series come from the input's DataType. */
export class PlotBlock extends FunctionBlock {
    readonly inputPort = new Port(this, PortType.inputPort, "a");
    readonly plotElement?: HTMLDivElement;
    private history?: PlotHistory;
    private scales: PlotScale[] = [];
    private releaseConnection?: () => void;
    private observer?: ResizeObserver;
    private statisticsTimer?: ReturnType<typeof setInterval>;
    private frame?: number;
    private plotly?: PlotlyAPI;
    private rendering = false;
    private dirty = false;
    private removed = false;
    private status = "入力を接続してください";

    constructor(data: Attr) {
        super(data);
        this.ports = [this.inputPort];
        this.setBoxSize();
        if (this.inToolbox) return;
        const div = this.plotElement = document.createElement("div");
        div.className = "diagram-plot";
        div.setAttribute("aria-label", "Plotグラフ");
        Object.assign(div.style, { position: "absolute", zIndex: "1", overflow: "hidden", background: "cornsilk" });
        (document.getElementById("layer-diagram") || document.body).appendChild(div);
        this.releaseConnection = this.inputPort.subscribeConnections(() => this.connectionChanged());
        this.observer = new ResizeObserver(() => this.requestPlot());
        this.observer.observe(div);
        void loadPlotly().then(plotly => {
            if (this.removed) return;
            this.plotly = plotly;
            this.requestPlot();
        }).catch(error => {
            if (this.removed) return;
            this.status = "グラフを読み込めませんでした";
            console.error("Plotly load failed", error);
            theCanvas?.requestUpdateCanvas();
        });
    }

    private connectionChanged(): void {
        this.stopStatistics();
        this.history = undefined;
        this.scales = [];
        this.inputPort.setPortValue(undefined);
        try {
            const type = this.inputPort.getDataType();
            if (type) {
                const history = new PlotHistory(type);
                if (history.groups.length) {
                    this.history = history;
                    this.scales = history.getScales();
                    this.status = "受信待ち";
                } else this.status = "数値Fieldがありません";
            } else this.status = this.inputPort.sources.length ? "入力の型を特定できません" : "入力を接続してください";
            this.setBoxSize();
            this.setPortPositions();
            this.positionPlot();
            const source = this.inputPort.prevPort();
            if (this.history && source?.value !== undefined) {
                this.inputPort.setPortValue(source.value);
                void this.valueChanged();
            }
        } catch (error) {
            this.status = error instanceof Error ? error.message : "入力の型が不正です";
        }
        this.requestPlot();
        theCanvas?.requestUpdateCanvas();
    }

    async valueChanged(): Promise<void> {
        if (this.removed || !this.history) return;
        if (this.inputPort.value === undefined) {
            this.stopStatistics();
            this.history.clear();
            this.scales = this.history.getScales();
            this.status = "受信待ち";
        } else {
            this.history.append(this.inputPort.value, performance.now());
            this.status = "表示中（直近30秒）";
            if (!this.statisticsTimer) {
                this.scales = this.history.getScales();
                this.statisticsTimer = setInterval(() => {
                    if (!this.history || this.removed) return;
                    this.scales = this.history.getScales();
                    this.requestPlot();
                }, 1000);
            }
        }
        this.requestPlot();
        theCanvas?.requestUpdateCanvas();
    }

    private stopStatistics(): void {
        clearInterval(this.statisticsTimer);
        this.statisticsTimer = undefined;
    }

    private requestPlot(): void {
        if (this.removed) return;
        this.dirty = true;
        if (this.frame !== undefined || this.rendering || !this.plotly) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = undefined;
            void this.renderPlot();
        });
    }

    private async renderPlot(): Promise<void> {
        if (this.removed || !this.plotElement || !this.plotly) return;
        this.rendering = true;
        this.dirty = false;
        const div = this.plotElement;
        const history = this.history;
        const groups = history?.groups ?? [];
        const samples = history?.samples ?? [];
        const end = samples.at(-1)?.time ?? 0;
        const layout: Partial<Layout> = {
            width: Math.max(100, div.clientWidth), height: Math.max(100, div.clientHeight),
            paper_bgcolor: "cornsilk", plot_bgcolor: "white", font: { size: 13 },
            margin: { l: 52, r: 24, t: 38, b: 80 },
            grid: { rows: 1, columns: Math.max(1, groups.length), pattern: "independent", xgap: 0.18 },
            legend: { orientation: "h", y: -0.32, yanchor: "top" }, dragmode: false,
            annotations: groups.map((group, index) => ({ text: group.name, showarrow: false, xref: "paper", yref: "paper", x: (index + 0.5) / groups.length, y: 1.15 })),
        };
        const traces: Data[] = [];
        let seriesIndex = 0;
        const names = new Set<string>();
        groups.forEach((group, groupIndex) => {
            const suffix = groupIndex ? String(groupIndex + 1) : "";
            const scale = this.scales[groupIndex] ?? { range: [-1, 1], dtick: 0.5 };
            Object.assign(layout, {
                [`xaxis${suffix}`]: { title: { text: "時間 (s)" }, range: [Math.max(0, end - 30), Math.max(30, end)], anchor: `y${suffix}` },
                [`yaxis${suffix}`]: { range: scale.range, dtick: scale.dtick, autorange: false, anchor: `x${suffix}` },
            });
            for (const series of group.series) {
                const index = seriesIndex++;
                traces.push({
                    type: "scatter", mode: "lines", name: series.name, legendgroup: series.name,
                    showlegend: !names.has(series.name), line: { color: series.color, width: 2 },
                    xaxis: `x${suffix}` as "x", yaxis: `y${suffix}` as "y",
                    x: samples.map(sample => sample.time), y: samples.map(sample => sample.values[index]),
                });
                names.add(series.name);
            }
        });
        try {
            await this.plotly.react(div, traces, layout, { displayModeBar: false, responsive: false, scrollZoom: false });
        } catch (error) {
            if (!this.removed) { this.status = "グラフを描画できませんでした"; console.error("Plotly render failed", error); }
        } finally {
            this.rendering = false;
            if (this.removed) this.plotly.purge(div);
            else if (this.dirty) this.requestPlot();
        }
    }

    setBoxSize(): void { this.boxSize = new Vec2(this.inToolbox ? 200 : Math.max(440, (this.history?.groups.length || 2) * 330 + 30), this.inToolbox ? 60 : 390); }

    copy(): PlotBlock {
        const block = new PlotBlock({});
        this.copyUI(block);
        block.setBoxSize();
        return block;
    }

    setPosition(position: Vec2): void { super.setPosition(position); this.positionPlot(); }

    private positionPlot(): void {
        if (!this.plotElement || !this.ctx) return;
        const canvas = this.ctx.canvas;
        const rect = canvas.getBoundingClientRect();
        const parent = this.plotElement.parentElement!.getBoundingClientRect();
        const sx = rect.width / canvas.width, sy = rect.height / canvas.height;
        const [xa, ya, xb, yb] = this.drawBox();
        Object.assign(this.plotElement.style, {
            left: `${rect.left - parent.left + (xa + 8) * sx}px`, top: `${rect.top - parent.top + (ya + 54) * sy}px`,
            width: `${(xb - xa - 16) * sx}px`, height: `${(yb - ya - 66) * sy}px`,
        });
    }

    draw(): void {
        super.draw();
        this.ctx.save();
        this.ctx.font = "18px sans-serif";
        this.ctx.textBaseline = "top";
        this.ctx.fillStyle = "#17384f";
        this.ctx.fillText("Plot", this.position.x + 16, this.position.y + 24);
        if (!this.inToolbox) {
            this.ctx.font = "14px sans-serif";
            this.ctx.fillText(this.status, this.position.x + 80, this.position.y + 28);
            this.positionPlot();
        }
        this.ctx.restore();
    }

    clearBlock(): void {
        this.removed = true;
        this.releaseConnection?.();
        this.observer?.disconnect();
        this.stopStatistics();
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        if (this.plotElement) { this.plotly?.purge(this.plotElement); this.plotElement.remove(); }
        this.history?.clear();
        super.clearBlock();
    }
}

registerFunctionBlock(PlotBlock.name, () => new PlotBlock({}));
