import { msg, MyError, $, fetchJson, parseURL } from "@i18n";
import './widget/container';
import './widget/slider';
import './widget/scroll_view';
import './widget/misc';
import './action/speech';

import { initSpeech } from "./action/speech";
import { Sequencer } from "./action/sequencer";
import { getUIFromId } from "./game_util";
import { initIsometric, clearIsometric } from "./isometric/isometric";
import { testEx } from "./lesson/exercise";
import { ArithmeticView, termToUIs } from "./math/arithmetic/arithmetic";
import { JsonData, SymbolRef } from "./registry";
import { Canvas } from "./widget/canvas";
import { makeUIFromJSON, setCanvas, worldCanvas } from "./widget/core";
import { initPopupMenus } from "./widget/menu";
import { TreeNode, makeTreeNodeFromObject } from "./widget/tree";
import './math/equation/equation';

let urlOrigin : string;
export let urlBase : string;
export let isDev : boolean = false;
export let basePath : string = ".";
let worldData : JsonData;

export async function initGame(){
    msg("loaded");
    let pathname  : string;
    let params = new Map<string, string>();

    [ urlOrigin, pathname, params, urlBase ] = parseURL();
    if (pathname.includes("diagram")) {
        urlBase = "../game";
    }
    msg(`origin:[${urlOrigin}] path:[${pathname}]`);

    for (const [key, value] of params.entries()) {
        msg(`Key: ${key}, Value: ${value}`);
        if(key == "dev" && value == "true"){
            isDev = true;
            msg("dev mode");
        }
    }

    initSpeech();

    setCanvas(new Canvas($("world-game") as HTMLCanvasElement))

    const isDiagram = pathname.includes("diagram");
    basePath = isDiagram ? "../game" : ".";

    if(isDev){
        worldData   = await fetchJson(`${basePath}/data/dev.json?id=${Math.random()}`);
    }
    else{
        worldData   = await fetchJson(`${basePath}/data/prod.json?id=${Math.random()}`);
    }

    if(worldData.target == undefined){
        throw new MyError();
    }

    // await loadWorld(worldData.target);
    // dumpObj(canvas, 0, new Set<any>());
    testEx();

    const map = await fetchJson(`${basePath}/data/map.json?id=${Math.random()}`);
    initIsometric(worldCanvas, map);
    worldCanvas.isReady = true;
}

export async function loadWorld(target : string){
    clearIsometric();

    const canvas : Canvas   = worldCanvas;
    const data   : JsonData = worldData;

    worldCanvas.isReady = false;

    SymbolRef.clearSymbolMap();
    canvas.clearCanvas();
    ArithmeticView.arithmeticViews = [];
    termToUIs.clear();

    const stageData = await SymbolRef.importLibrary(target);

    if(data.imports != undefined){
        for(const path of data.imports){
            await SymbolRef.importLibrary(path);
        }
    }

    for(const obj of data.uis){
        const ui = makeUIFromJSON(obj);
        canvas.addUI(ui);
    }

    const root = new TreeNode({label:"root"});
    // makeTreeNodeFromObject(root, "canvas", canvas, new Set<any>());
    makeTreeNodeFromObject(root, "json", data, new Set<any>());

    if(isDev){
        const inspector = getUIFromId("inspector") as TreeNode;
        inspector.addChild(root);
    }

    canvas.layoutCanvas();

    initPopupMenus(stageData.menus);

    Sequencer.init(stageData.actions);

    worldCanvas.isReady = true;
}
export { worldCanvas };

import { sleep } from "@i18n";

export async function playGameWorld(target: string, stopCallback: () => boolean) {
    await loadWorld(target);
    Sequencer.start();

    // シーケンサーが終了する、またはdiagram側からstopフラグが立つまで待機
    while (Sequencer.rootParallelAction && !Sequencer.rootParallelAction.finished) {
        if (stopCallback()) break;
        await sleep(100);
    }
}
