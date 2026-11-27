/** path-browserifyは上流wccと同じWASI依存。型はNodeのpathと互換。 */
declare module "path-browserify" {
    import path from "node:path";
    export default path;
}
