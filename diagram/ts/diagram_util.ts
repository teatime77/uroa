/**
 * diagram画面の共有参照・画像・URLと、他モジュールの表示切替を管理する。旧HTTP窓口もここに保持する。
 */
import { $, msg, parseURL } from "@i18n";
import type { Canvas } from "./canvas";

/**
 * diagram全体で共有する操作・描画用キャンバス。
 */
export let theCanvas : Canvas;

/**
 * 起動URLから読み取る、旧HTTP窓口の送信先origin。
 */
export let urlOrigin : string;
/**
 * 起動URLから読み取るパス名。
 */
export let pathName  : string;

/**
 * アクション連結部の切欠き半径（pixel）。
 */
export const notchRadius = 10;        
/**
 * 入れ子ブロックの上部帯の高さ（pixel）。
 */
export const nest_h1 = 35;

/**
 * diagram全体のStart/Stop操作を受け付けるDOMボタン。
 */
export let startButton : HTMLButtonElement;
/**
 * カメラブロックの表示に使う画像要素。
 */
export let cameraIcon : HTMLImageElement;
/**
 * モーターブロックの表示に使う画像要素。
 */
export let motorIcon  : HTMLImageElement;
/**
 * 旧HTTP経路またはWi-Fi経路で共有する最新のカメラ画像。
 */
export let cameraImg : HTMLImageElement | undefined;
/**
 * 共有カメラ画像を差し替え、キャンバスの再描画を要求する。
 */
export function setCameraImage(image?: HTMLImageElement): void {
    cameraImg = image;
    theCanvas?.requestUpdateCanvas();
}
/**
 * 距離センサーブロックのアイコン画像。
 */
export let distanceSensorIcon : HTMLImageElement;
/**
 * 読み上げブロックのアイコン画像。
 */
export let ttsIcon : HTMLImageElement;
/**
 * 待機ブロックのアイコン画像。
 */
export let sleepIcon : HTMLImageElement;


/**
 * キャンバスの再描画回数を診断用に記録するカウンター。
 */
export let repaintCount = 0;

/**
 * 実行連鎖・データ入出力・条件入力を区別するポート種別。
 */
export enum PortType {
    unknown,
    bottom,
    top,

    inputPort,
    outputPort,
    condition,
}

/**
 * 診断用の再描画回数を一つ進める。
 */
export function incRepaintCount(){
    repaintCount++;
}

/**
 * diagramで共有するキャンバスの参照を登録する。
 */
export function setCanvas(canvas : Canvas){
    theCanvas = canvas;
}

/**
 * 起動URLを解析し、originとパス名を共有状態へ設定する。
 */
export function initURL(){
    let params    : Map<string, string>;
    [ urlOrigin, pathName, params,] = parseURL();
    msg(`origin:[${urlOrigin}] path:[${pathName}]`);
}

/**
 * HTML上のStartボタンと各ブロック用の画像要素を取得する。
 */
export function initUI(){
    startButton = $("start-btn") as HTMLButtonElement;
    cameraIcon = document.getElementById("camera-icon") as HTMLImageElement;
    motorIcon  = document.getElementById("motor-icon") as HTMLImageElement;
    distanceSensorIcon  = document.getElementById("distance-sensor-icon") as HTMLImageElement;
    ttsIcon    = document.getElementById("tts-icon") as HTMLImageElement;
    sleepIcon    = document.getElementById("sleep-icon") as HTMLImageElement;
}

/**
 * 旧HTTP窓口の画像を非同期に読み、完了時に共有画像へ反映する。
 */
export function fetchImage(image_url : string){
    const image = new Image();
    image.width  = 320;
    image.height = 240;

    // 2. Set the crossOrigin attribute for security and to prevent a tainted canvas
    image.crossOrigin = 'Anonymous'; 
    
    image.src = image_url; 

    // 4. Wait for the image to load
    image.onload = () => {
        cameraImg = image;
    };
}

/**
 * 旧HTTPのsend_data窓口へJSONを送る。通信失敗時は診断を出してundefinedを返す。
 */
export async function sendData(dataToSend : any) : Promise<any> {
    const url = `${urlOrigin}/send_data`;
    // msg(`post:[${url}]`);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(dataToSend) // Convert JavaScript object to JSON string
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorData.message}`);
        }

        const result = await response.json(); // Parse the JSON response from Flask
        const json_str = JSON.stringify(result, null, 2); // Pretty print JSON
        // msg(`send data result:[${json_str}]`);

        return result;
    } catch (error: any) {
        msg(`send data error: ${error.message || error}`);

        return undefined;
    }
    
}

/**
 * 現在表示しているアプリのレイヤーID。
 */
let activeModule = "layer-diagram";
/**
 * 別レイヤーへの切替直前に、離れるアプリへ終了を通知する処理。
 */
let onLeaveModule: (moduleId: string) => void = () => {};

/**
 * レイヤー切替前の終了通知先を設定する。
 */
export function setOnLeaveModule(handler: (moduleId: string) => void): void {
    onLeaveModule = handler;
}

/**
 * 現在のレイヤーを終了通知してから、指定レイヤーだけを表示する。
 */
export function switchActiveModule(moduleId: string) {
    if (moduleId !== activeModule) onLeaveModule(activeModule);
    activeModule = moduleId;
    const ids = ["layer-diagram", "layer-game", "layer-webgpu", "layer-movie"];
    for (const id of ids) {
        const layer = document.getElementById(id);
        if (layer) {
            if (id === moduleId) {
                layer.style.display = "block";
                layer.style.zIndex = "10";
            } else {
                layer.style.display = "none";
                layer.style.zIndex = "0";
            }
        }
    }
}
