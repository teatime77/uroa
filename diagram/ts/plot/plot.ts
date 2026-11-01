/**
 * 入力の型情報から時系列グラフを構成し、履歴・描画予約・DOMの寿命を管理する。
 */
import { Vec2 } from "@i18n";
import type { Data, Layout } from "plotly.js";
import { FunctionBlock, registerFunctionBlock } from "../block";
import { PortType, theCanvas } from "../diagram_util";
import { Port } from "../port";
import { PlotHistory, type PlotScale } from "./plot_data";
import type { Attr } from "../ui";

type PlotlyAPI = typeof import("plotly.js");

/** 複数のPlotBlockで共有するPlotlyの読み込み結果。 */
let plotlyPromise: Promise<PlotlyAPI> | undefined;

/**
 * Plotlyを必要になった時点で読み込み、同じPromiseを再利用する。
 * @returns PlotlyのAPIを返すPromise。
 */
function loadPlotly(): Promise<PlotlyAPI> {
    return plotlyPromise ??= import("plotly.js-gl3d-dist-min").then(module => module.default);
}

/** 入力のDataTypeからパネルと系列を決める、汎用の時系列グラフブロック。 */
export class PlotBlock extends FunctionBlock {
    /** グラフに表示する値を受け取る入力ポート。 */
    readonly inputPort = new Port(this, PortType.inputPort, "a");
    /** Canvasに重ねて配置するPlotlyの描画先。ツールボックスでは作成しない。 */
    readonly plotElement?: HTMLDivElement;
    /** 現在の入力型に対応する系列と受信履歴。 */
    private history?: PlotHistory;
    /** パネルごとに統計から求めた縦軸の範囲と目盛り。 */
    private scales: PlotScale[] = [];
    /** 入力ポートの接続変更の購読を解除する関数。 */
    private releaseConnection?: () => void;
    private observer?: ResizeObserver;
    /** 縦軸の統計を1秒間隔で更新するタイマー。 */
    private statisticsTimer?: ReturnType<typeof setInterval>;
    /** 次の描画フレームの予約ID。 */
    private frame?: number;
    private plotly?: PlotlyAPI;
    /** Plotlyの非同期描画中かどうか。重複した描画を防ぐ。 */
    private rendering = false;
    /** 最後に描画を始めてから再描画要求があったかどうか。 */
    private dirty = false;
    /** 削除後の遅延コールバックによる更新を抑止するフラグ。 */
    private removed = false;
    private status = "入力を接続してください";

    /**
     * 入力ポートとグラフ用DOMを作成し、接続変更・サイズ変更を監視する。
     * @param data ブロックの初期属性。
     */
    constructor(data: Attr) {
        super(data);
        this.ports = [this.inputPort];
        this.setBoxSize();
        if (this.inToolbox) {
            return;
        }
        const div = this.plotElement = document.createElement("div");
        div.className = "diagram-plot";
        div.setAttribute("aria-label", "Plotグラフ");
        Object.assign(div.style, {
            position: "absolute",
            zIndex: "1",
            overflow: "hidden",
            background: "cornsilk"
        });
        (document.getElementById("layer-diagram") || document.body).appendChild(div);
        this.releaseConnection = this.inputPort.subscribeConnections(() => this.connectionChanged());
        this.observer = new ResizeObserver(() => this.requestPlot());
        this.observer.observe(div);
        void loadPlotly().then(plotly => {
            if (this.removed) {
                return;
            }
            this.plotly = plotly;
            this.requestPlot();
        }).catch(error => {
            if (this.removed) {
                return;
            }
            this.status = "グラフを読み込めませんでした";
            console.error("Plotly load failed", error);
            theCanvas?.requestUpdateCanvas();
        });
    }

    /** 入力の接続変更時に履歴と軸を作り直し、接続元の既存値も取り込む。 */
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
                }
                else {
                    this.status = "数値Fieldがありません";
                }
            }
            else {
                this.status = this.inputPort.sources.length ? "入力の型を特定できません" : "入力を接続してください";
            }
            this.setBoxSize();
            this.setPortPositions();
            this.positionPlot();
            const source = this.inputPort.prevPort();
            if (this.history && source?.value !== undefined) {
                this.inputPort.setPortValue(source.value);
                void this.valueChanged();
            }
        }
        catch (error) {
            this.status = error instanceof Error ? error.message : "入力の型が不正です";
        }
        this.requestPlot();
        theCanvas?.requestUpdateCanvas();
    }

    /**
     * 受信値を履歴へ追加する。未定義値では履歴と統計更新をリセットする。
     * @returns 受信値の反映が完了したことを示すPromise。
     */
    async valueChanged(): Promise<void> {
        if (this.removed || !this.history) {
            return;
        }
        if (this.inputPort.value === undefined) {
            this.stopStatistics();
            this.history.clear();
            this.scales = this.history.getScales();
            this.status = "受信待ち";
        }
        else {
            this.history.append(this.inputPort.value, performance.now());
            this.status = "表示中（直近30秒）";
            if (!this.statisticsTimer) {
                this.scales = this.history.getScales();
                this.statisticsTimer = setInterval(() => {
                    if (!this.history || this.removed) {
                        return;
                    }
                    this.scales = this.history.getScales();
                    this.requestPlot();
                }, 1000);
            }
        }
        this.requestPlot();
        theCanvas?.requestUpdateCanvas();
    }

    /** 縦軸の統計を更新するタイマーを停止する。 */
    private stopStatistics(): void {
        clearInterval(this.statisticsTimer);
        this.statisticsTimer = undefined;
    }

    /** 再描画要求を次のフレームへまとめ、描画中の要求はdirtyに記録する。 */
    private requestPlot(): void {
        if (this.removed) {
            return;
        }
        this.dirty = true;
        if (this.frame !== undefined || this.rendering || !this.plotly) {
            return;
        }
        this.frame = requestAnimationFrame(() => {
            this.frame = undefined;
            void this.renderPlot();
        });
    }

    /**
     * 現在の履歴からパネル・軸・系列を構成し、Plotlyへ反映する。
     * @returns 描画と、削除または追加の描画要求に応じた後処理が完了するPromise。
     */
    private async renderPlot(): Promise<void> {
        if (this.removed || !this.plotElement || !this.plotly) {
            return;
        }
        this.rendering = true;
        this.dirty = false;
        const div = this.plotElement;
        const history = this.history;
        const groups = history?.groups ?? [];
        const samples = history?.samples ?? [];
        const end = samples.at(-1)?.time ?? 0;
        const layout: Partial<Layout> = {
            width: Math.max(100, div.clientWidth),
            height: Math.max(100, div.clientHeight),
            paper_bgcolor: "cornsilk",
            plot_bgcolor: "white",
            font: { size: 13 },
            margin: { l: 52, r: 24, t: 38, b: 80 },
            grid: { rows: 1, columns: Math.max(1, groups.length), pattern: "independent", xgap: 0.18 },
            legend: { orientation: "h", y: -0.32, yanchor: "top" },
            dragmode: false,
            annotations: groups.map((group, index) => ({
                text: group.name,
                showarrow: false,
                xref: "paper",
                yref: "paper",
                x: (index + 0.5) / groups.length,
                y: 1.15
            })),
        };
        const traces: Data[] = [];
        let seriesIndex = 0;
        const names = new Set<string>();
        groups.forEach((group, groupIndex) => {
            // Plotlyでは最初の軸だけ番号を付けず、2組目以降はx2・y2などを使う。
            const suffix = groupIndex ? String(groupIndex + 1) : "";
            const scale = this.scales[groupIndex] ?? { range: [-1, 1], dtick: 0.5 };
            Object.assign(layout, {
                [`xaxis${suffix}`]: {
                    title: { text: "時間 (s)" },
                    range: [Math.max(0, end - 30), Math.max(30, end)],
                    anchor: `y${suffix}`
                },
                [`yaxis${suffix}`]: {
                    range: scale.range,
                    dtick: scale.dtick,
                    autorange: false,
                    anchor: `x${suffix}`
                },
            });
            for (const series of group.series) {
                // 履歴の値は全パネルの系列順で並ぶため、通し番号で参照する。
                const index = seriesIndex++;
                traces.push({
                    type: "scatter",
                    mode: "lines",
                    name: series.name,
                    legendgroup: series.name,
                    showlegend: !names.has(series.name),
                    line: { color: series.color, width: 2 },
                    xaxis: `x${suffix}` as "x",
                    yaxis: `y${suffix}` as "y",
                    x: samples.map(sample => sample.time),
                    y: samples.map(sample => sample.values[index]),
                });
                names.add(series.name);
            }
        });
        try {
            await this.plotly.react(div, traces, layout, { displayModeBar: false, responsive: false, scrollZoom: false });
        }
        catch (error) {
            if (!this.removed) {
                this.status = "グラフを描画できませんでした";
                console.error("Plotly render failed", error);
            }
        }
        finally {
            this.rendering = false;
            // 描画の完了を待つ間に削除や更新が起きた場合も、ここで処理する。
            if (this.removed) {
                this.plotly.purge(div);
            }
            else if (this.dirty) {
                this.requestPlot();
            }
        }
    }

    /** ツールボックス表示またはパネル数に合わせてブロックの大きさを決める。 */
    setBoxSize(): void {
        this.boxSize = new Vec2(
            this.inToolbox ? 200 : Math.max(440, (this.history?.groups.length || 2) * 330 + 30),
            this.inToolbox ? 60 : 390
        );
    }

    /**
     * 表示属性を複製する。接続・履歴・描画状態は新しいブロックへ引き継がない。
     * @returns 複製した未接続のグラフブロック。
     */
    copy(): PlotBlock {
        const block = new PlotBlock({});
        this.copyUI(block);
        block.setBoxSize();
        return block;
    }

    /**
     * ブロックを移動し、グラフ用DOMも追従させる。
     * @param position Canvas上のブロック位置。
     */
    setPosition(position: Vec2): void {
        super.setPosition(position);
        this.positionPlot();
    }

    /** Canvas座標を親DOM内のCSS座標へ変換し、グラフを枠内に配置する。 */
    private positionPlot(): void {
        if (!this.plotElement || !this.ctx) {
            return;
        }
        const canvas = this.ctx.canvas;
        const rect = canvas.getBoundingClientRect();
        const parent = this.plotElement.parentElement!.getBoundingClientRect();
        const sx: number = rect.width / canvas.width;
        const sy: number = rect.height / canvas.height;
        const [xa, ya, xb, yb] = this.drawBox();
        Object.assign(this.plotElement.style, {
            left: `${rect.left - parent.left + (xa + 8) * sx}px`,
            top: `${rect.top - parent.top + (ya + 54) * sy}px`,
            width: `${(xb - xa - 16) * sx}px`,
            height: `${(yb - ya - 66) * sy}px`,
        });
    }

    /** Canvasへブロック名と状態を描画し、グラフ用DOMの位置を合わせる。 */
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

    /** 遅延更新を無効化し、購読・監視・タイマー・Plotly・DOM・履歴を解放する。 */
    clearBlock(): void {
        this.removed = true;
        this.releaseConnection?.();
        this.observer?.disconnect();
        this.stopStatistics();
        if (this.frame !== undefined) {
            cancelAnimationFrame(this.frame);
        }
        if (this.plotElement) {
            this.plotly?.purge(this.plotElement);
            this.plotElement.remove();
        }
        this.history?.clear();
        super.clearBlock();
    }
}

registerFunctionBlock(PlotBlock.name, () => new PlotBlock({}));
