import { msg, assert, $, sleep } from "@i18n";
import { initWebGPU } from "@webgpu";
import { initGame } from "@game";
import { initMovie } from "@movie";
import { InputTextBlock, InputNumberBlock, CompareBlock, InputRangeBlock, ServoMotorBlock, CameraBlock, FaceDetectionBlock, CalcBlock, UltrasonicDistanceSensorBlock, ConditionGate, InputBlock } from "./block";
import { Canvas, Editor, getTopActions } from "./canvas";
import { fetchImage, initUI, initURL, pathName, repaintCount, sendData, startButton, theCanvas, urlOrigin } from "./diagram_util";
import { saveJson, theEditor } from "./json-util";
import { IfBlock, InfiniteLoop, TTSBlock, SleepBlock, TriggerGate, ActionBlock, makeBlockByTypeName, PlayMovieBlock, PlayGameBlock, PlayWebGPUBlock } from "./procedure";
import { Block } from "./block"
import { Port } from "./port";
import { initAlgebra } from "@algebra";

export let stopFlag : boolean = false;
let isRunning : boolean = false;

class Variable {
    name! : string;
    type! : DataType;
}

class Field extends Variable {
    parent! : Struct;
}

export class Struct {
    members : Field[] = [];
}

export class DataType {
    dimensions : number[] = [];
    typeName! : string;

}

document.addEventListener('DOMContentLoaded', async () => {
    if ((window as any).diagramEntryInitialized) {
        console.log("duplicate load of diagram/ts/index.ts");
        return;
    }
    (window as any).diagramEntryInitialized = true;

    // msg("loaded in diagram-ts");
    console.log("loaded in diagram-ts", {
        url: import.meta.url,
        timeOrigin: performance.timeOrigin,
    });
    initURL();

    if(pathName.startsWith("/algebra")){
        await initAlgebra();
    }
    else if(pathName.startsWith("/webgpu")){
        await initWebGPU();
    }
    else if(pathName.startsWith("/game")){
        await initGame();        
    }
    else if(pathName.startsWith("/diagram")){
        await initDiagram();
        // background initialization for sub-modules
        await initGame();
        await initWebGPU();
        await initMovie();
        msg("diagram ready")
    }
    else if(pathName.startsWith("/movie")){
        await initMovie();        
    }
    else{
        msg("no project")
    }
});  


export class Main {
    static one : Main;
    canvas : Canvas;

    constructor(){
        Main.one = this;

        const tools : Block[] = [
            new IfBlock({ inToolbox : true })
            ,
            new InfiniteLoop({ inToolbox : true })
            ,
            new TTSBlock({ inToolbox : true })
            ,
            new SleepBlock({ inToolbox : true })
            ,
            new TriggerGate({ inToolbox : true })
            ,
            new InputTextBlock({ inToolbox : true })
            ,
            new InputNumberBlock({ inToolbox : true })
            ,
            new CompareBlock({ inToolbox : true })
            ,
            new InputRangeBlock({ inToolbox : true })
            ,
            new ServoMotorBlock({ inToolbox : true })
            ,
            new CameraBlock({ inToolbox : true })
            ,
            new FaceDetectionBlock({ inToolbox : true })
            ,
            new CalcBlock({ inToolbox : true })
            ,
            new UltrasonicDistanceSensorBlock({ inToolbox : true })
            ,
            new ConditionGate({ inToolbox : true })
            ,
            new PlayMovieBlock({ inToolbox : true })
            ,
            new PlayGameBlock({ inToolbox : true })
            ,
            new PlayWebGPUBlock({ inToolbox : true })
        ];

        new Editor(tools);

        const canvas_html = document.getElementById('world-diagram') as HTMLCanvasElement;
        this.canvas = new Canvas(canvas_html);

        // Initial resize when the page loads
        // Use DOMContentLoaded to ensure the canvas element exists before trying to access it
        document.addEventListener('DOMContentLoaded', this.canvas.resizeCanvas.bind(this.canvas));

        // Add an event listener to resize the canvas whenever the window is resized
        window.addEventListener('resize', this.canvas.resizeCanvas.bind(this.canvas));

        setDragDrop(this.canvas.canvas);

        this.canvas.resizeCanvas();
    }

}

function updateCameraImage(image_file_name : string){
    const blocks = theEditor.blocks;
    const cameras = blocks.filter(x => x instanceof CameraBlock);
    for(const camera of cameras){
        const image_url = `static/lib/diagram/img/${image_file_name}`;
        fetchImage(image_url);
    }
}

function updateFaceDetection(face : number[]){
    const face_detection = theEditor.blocks.find(x => x instanceof FaceDetectionBlock) as FaceDetectionBlock;
    if(face_detection != undefined){
        face_detection.setFace(face);

        face_detection.propergateCalc();
    }
}

function updateDistanceSensor(distance : number){
    const distance_sensor = theEditor.blocks.find(x => x instanceof UltrasonicDistanceSensorBlock) as UltrasonicDistanceSensorBlock;
    if(distance_sensor != undefined){
        distance_sensor.setDistance(distance);

        distance_sensor.propergateCalc();
    }
}

async function clearQueue() {
    for(let idx = 0; ; idx++){
        const result = await sendData({
            command : "status"
        });

        const queue = result["queue"]
        if(queue == null){
            break;
        }
        
        msg(`clear queue:${idx}`);
    }
}

async function periodicTask() {
    const result = await sendData({
        command : "status"
    });

    const queue = result["queue"]
    if(queue != null){

        const json_str = JSON.stringify(result, null, 2);
        // msg(`status:${json_str}`);

        const image_file_name = queue["image_file_name"];
        if(image_file_name != undefined){
            updateCameraImage(image_file_name);
        }

        const face = queue["face"];
        if(face != undefined){
            assert(face.length == 4);
            updateFaceDetection(face);
        }

        const distance = queue["distance"];
        if(distance != undefined){
            assert(typeof distance == "number");
            updateDistanceSensor(distance);
        }

        theCanvas.requestUpdateCanvas();
    }

    setTimeout(periodicTask, 100);
}

export async function runBlockChain(top_block : ActionBlock){
    for(let block : ActionBlock | undefined = top_block; block != undefined; block = block.nextBlock()){
        await block.run();

        if(stopFlag){
            break;
        }
    }
}

async function startProcedures() {
    startButton.innerText = "Stop";

    isRunning = true;
    stopFlag = false;

    const input_blocks = theEditor.blocks.filter(x => x instanceof InputBlock);
    input_blocks.forEach(x => x.updatePort());


    const top_blocks = getTopActions();
    for(const top_block of top_blocks){
        msg(`top proc:${top_block.constructor.name}`);
        await runBlockChain(top_block);

        if(stopFlag){
            break;
        }
    }

    msg("procedures complete.");
    isRunning = false;
    startButton.innerText = "Start";
}

export async function initDiagram(){
    initUI();
    
    $("clear-btn").addEventListener("click", (ev : MouseEvent)=>{
        theEditor.clearBlock();
    });

    startButton.addEventListener("click", async(ev : MouseEvent)=>{
        if(isRunning){

            stopFlag = true;
        }
        else{
            await startProcedures();
        }
    });

    const downloadBtn = $("download-btn") as HTMLButtonElement;
    downloadBtn.addEventListener("click", async(ev : MouseEvent)=>{
        saveJson();
    });


    new Main();

    const diy_sbc = false;
    if(diy_sbc){
        await clearQueue();

        if( urlOrigin != "http://127.0.0.1:5500"){
            await periodicTask();
        }
    }
}

function loadJson(objs:any[]){
    theEditor.clearBlock();
    
    const block_map = new Map<number, Block>();
    const port_map = new Map<number, Port>();

    for(const obj of objs){
        msg(`block:[${obj.typeName}]`);
        const block = makeBlockByTypeName(obj.typeName);
        block.loadObj(obj);

        block.idx        = obj.idx;
        block.position.x = obj.x;
        block.position.y = obj.y;
        block.setBoxSize();

        block_map.set(block.idx, block);

        for(const [port_idx, port_obj] of obj.ports.entries()){
            const port = block.ports[port_idx];
            port.idx = port_obj.idx;

            port_map.set(port.idx, port);
        }

        theEditor.addBlock(block);
    }

    theEditor.blocks.forEach(x => x.setPortPositions());

    for(const obj of objs){
        const block = block_map.get(obj.idx)!;
        assert(block != undefined);

        for(const [port_idx, port_obj] of obj.ports.entries()){
            const port = block.ports[port_idx];

            for(const dst_port_idx of port_obj.destinations){
                const dst_port = port_map.get(dst_port_idx)!;
                assert(dst_port != undefined);

                port.connect(dst_port);
            }
        }
    }

    theEditor.setContext2D(theCanvas.ctx);
    theEditor.layoutRoot();
}

function preventDefaults(ev:DragEvent) {
    ev.preventDefault(); 
    ev.stopPropagation();
}

function setDragDrop(canvas : HTMLCanvasElement){
    canvas.addEventListener("dragenter", (ev : DragEvent)=>{
        preventDefaults(ev);
        msg("drag enter");
    });

    canvas.addEventListener("dragover", (ev : DragEvent)=>{
        preventDefaults(ev);
        canvas.classList.add('dragover')

        msg("drag over");
    });

    canvas.addEventListener("dragleave", (ev : DragEvent)=>{
        preventDefaults(ev);
        canvas.classList.remove('dragover');
        msg("drag leave");
    });

    canvas.addEventListener("drop", async (ev : DragEvent)=>{
        preventDefaults(ev);
        canvas.classList.remove('dragover');

        msg("drop");
        const dt = ev.dataTransfer;
        if(dt == null){
            return;
        }

        const files = Array.from(dt.files);

        msg(`${files}`);

        if(files.length == 1){
            const file = files[0];

            msg(`File name: ${file.name}, File size: ${file.size}, File type: ${file.type}`);

            const reader = new FileReader();

            reader.onload = async() => {
                const json = reader.result as string;
                const obj  = JSON.parse(json);

                assert(Array.isArray(obj));

                // msg(`dropped:[${JSON.stringify(data, null, 2)}]`);
                loadJson(obj as any[]);

                const repaint_count = repaintCount;
                theCanvas.requestUpdateCanvas();

                // port positions are set on paing.
                // edges can be drawn after port position settings.
                while(repaint_count == repaintCount){
                    await sleep(100);
                }

                // draw input elements in blocks.
                theEditor.blocks.forEach(x => x.setBlockPortPosition(x.position));
                theCanvas.requestUpdateCanvas();
            };

            reader.readAsText(file);        


        }
    });    
}

// uroa側のテスト用コード（起動時に読み込まれる場所に追加）
declare global {
    interface Window {
        injectTestData: (data: any) => void;
    }
}

window.injectTestData = (data: any) => {
    console.log("AI Agentからのデータを受信しました:", data);
    // TODO: ここで受け取ったJSONデータを元に、2D描画(plane)や
    // シミュレーション(webgpu)のコンポーネントを更新・再描画する処理を呼び出す
    
    // テストとして画面の背景色を変えるなど、視覚的にわかる変化をつけるのも有効です
    document.body.style.backgroundColor = data.bgColor || "white";
};