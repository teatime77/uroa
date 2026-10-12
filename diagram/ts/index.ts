import { msg, assert, $, sleep } from "@i18n";
import { InputTextBlock, InputNumberBlock, CompareBlock, InputRangeBlock, ServoMotorBlock, CameraBlock, FaceDetectionBlock, CalcBlock, UltrasonicDistanceSensorBlock, ConditionGate, InputBlock } from "./block";
import { Canvas, Editor, getTopActions } from "./canvas";
import { fetchImage, initUI, repaintCount, sendData, startButton, theCanvas, urlOrigin } from "./diagram_util";
import { saveJson, theEditor } from "./json-util";
import { IfBlock, InfiniteLoop, TTSBlock, SleepBlock, TriggerGate, ActionBlock, makeBlockByTypeName, PlayMovieBlock, PlayGameBlock, PlayWebGPUBlock } from "./procedure";
import { Block } from "./block"
import { Port } from "./port";
import { BLEConnectionBlock, diagramBLE, initBLE } from "./ble";
import { IMUBlock } from "./imu";
export { Variable, Field, Struct, DataType } from "./data_type";

import { isRunning, runBlockChain, runProcedures, stopDiagram, stopFlag } from "./runtime";
export { stopDiagram } from "./runtime";

const listeners = new AbortController();
let periodicTimer: ReturnType<typeof setTimeout> | undefined;


export class Main {
    static one : Main;
    canvas : Canvas;

    constructor(){
        Main.one = this;

        const tools : Block[] = [
            new BLEConnectionBlock({ inToolbox : true })
            ,
            new IMUBlock({ inToolbox : true })
            ,
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

        window.addEventListener('resize', this.canvas.resizeCanvas.bind(this.canvas), { signal: listeners.signal });

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

    if (!listeners.signal.aborted) periodicTimer = setTimeout(periodicTask, 100);
}

async function startProcedures() {
    startButton.innerText = "Stop";

    try {
        await runProcedures(async () => {
            const input_blocks = theEditor.blocks.filter(x => x instanceof InputBlock);
            input_blocks.forEach(x => x.updatePort());
            for (const top_block of getTopActions()) {
                if (stopFlag) break;
                msg(`top proc:${top_block.constructor.name}`);
                await runBlockChain(top_block);
            }
            msg("procedures complete.");
        });
    } finally {
        startButton.innerText = "Start";
    }
}

export async function initDiagram(_signal?: AbortSignal){
    initUI();
    initBLE(listeners.signal);
    
    $("clear-btn").addEventListener("click", (ev : MouseEvent)=>{
        theEditor.clearBlock();
    }, { signal: listeners.signal });

    startButton.addEventListener("click", async(ev : MouseEvent)=>{
        if(isRunning){

            stopDiagram();
        }
        else{
            try { await startProcedures(); }
            catch (error) { console.error("diagram procedure failed", error); }
        }
    }, { signal: listeners.signal });

    const downloadBtn = $("download-btn") as HTMLButtonElement;
    downloadBtn.addEventListener("click", async(ev : MouseEvent)=>{
        saveJson();
    }, { signal: listeners.signal });


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
            port.loadObj(port_obj);
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
    }, { signal: listeners.signal });

    canvas.addEventListener("dragover", (ev : DragEvent)=>{
        preventDefaults(ev);
        canvas.classList.add('dragover')

        msg("drag over");
    }, { signal: listeners.signal });

    canvas.addEventListener("dragleave", (ev : DragEvent)=>{
        preventDefaults(ev);
        canvas.classList.remove('dragover');
        msg("drag leave");
    }, { signal: listeners.signal });

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
                if (listeners.signal.aborted) return;
                const json = reader.result as string;
                const obj  = JSON.parse(json);

                assert(Array.isArray(obj));

                // msg(`dropped:[${JSON.stringify(data, null, 2)}]`);
                loadJson(obj as any[]);

                const repaint_count = repaintCount;
                theCanvas.requestUpdateCanvas();

                // port positions are set on paing.
                // edges can be drawn after port position settings.
                while(repaint_count == repaintCount && !listeners.signal.aborted){
                    await sleep(100);
                }
                if (listeners.signal.aborted) return;

                // draw input elements in blocks.
                theEditor.blocks.forEach(x => x.setBlockPortPosition(x.position));
                theCanvas.requestUpdateCanvas();
            };

            reader.readAsText(file);        


        }
    }, { signal: listeners.signal });
}

export function disposeDiagram(): void {
    stopDiagram();
    diagramBLE.disconnect();
    theEditor?.clearBlock();
    listeners.abort();
    clearTimeout(periodicTimer);
    Main.one?.canvas.dispose();
}
