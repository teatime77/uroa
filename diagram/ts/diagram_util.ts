import { $, msg, parseURL } from "@i18n";
import type { Canvas } from "./canvas";

export let theCanvas : Canvas;

export let urlOrigin : string;
export let pathName  : string;

export const notchRadius = 10;        
export const nest_h1 = 35;

export let startButton : HTMLButtonElement;
export let cameraIcon : HTMLImageElement;
export let motorIcon  : HTMLImageElement;
export let cameraImg : HTMLImageElement;
export let distanceSensorIcon : HTMLImageElement;
export let ttsIcon : HTMLImageElement;
export let sleepIcon : HTMLImageElement;


export let repaintCount = 0;

export enum PortType {
    unknown,
    bottom,
    top,

    inputPort,
    outputPort,
    condition,
}

export function incRepaintCount(){
    repaintCount++;
}

export function setCanvas(canvas : Canvas){
    theCanvas = canvas;
}

export function initURL(){
    let params    : Map<string, string>;
    [ urlOrigin, pathName, params,] = parseURL();
    msg(`origin:[${urlOrigin}] path:[${pathName}]`);
}

export function initUI(){
    startButton = $("start-btn") as HTMLButtonElement;
    cameraIcon = document.getElementById("camera-icon") as HTMLImageElement;
    motorIcon  = document.getElementById("motor-icon") as HTMLImageElement;
    distanceSensorIcon  = document.getElementById("distance-sensor-icon") as HTMLImageElement;
    ttsIcon    = document.getElementById("tts-icon") as HTMLImageElement;
    sleepIcon    = document.getElementById("sleep-icon") as HTMLImageElement;
}

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

export function switchActiveModule(moduleId: string) {
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
