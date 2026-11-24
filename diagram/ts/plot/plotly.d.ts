/**
 * Plotlyの配布バンドルを、plotly.jsのAPI型として参照するためのモジュール宣言。実行時の読込みはplot.tsが行う。
 */
declare module "plotly.js-gl3d-dist-min" {
    import * as Plotly from "plotly.js";
    export = Plotly;
}
