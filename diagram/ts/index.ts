/**
 * diagramの初期化・破棄、ツール番号とブロックの対応、Start操作と保存図の復元を担当する。実行状態はruntime.ts、キャンバスはcanvas.tsが管理する。
 */
import { msg, assert, $, sleep, MyError } from "@i18n";
import { InputTextBlock, InputNumberBlock, CompareBlock, InputRangeBlock, CameraBlock, FaceDetectionBlock, CalcBlock, ConditionGate, InputBlock } from "./block";
import { Canvas, Editor, getTopActions } from "./canvas";
import { fetchImage, initUI, repaintCount, sendData, startButton, theCanvas, urlOrigin } from "./diagram_util";
import { saveJson, theEditor, initDiagramOpen } from "./json-util";
import { IfBlock, InfiniteLoop, TTSBlock, SleepBlock, TriggerGate, ActionBlock, makeBlockByTypeName, PlayMovieBlock, PlayGameBlock, PlayWebGPUBlock } from "./procedure";
import { Block } from "./block"
import { Port } from "./port";
import { DeviceConnectionBlock, diagramDevice, initDeviceConnection } from "./ble-wifi/device-connection";
import { IMUBlock } from "./hardware/imu";
import { UltrasonicDistanceSensorBlock } from "./hardware/ultrasonic";
import { PlotBlock } from "./plot/plot";
import { ServoMotorBlock } from "./hardware/servo";
import { AIChatBlock } from "./ai/ai-chat";
import { SpeechRecognitionBlock } from "./ai/speech-recognition";
import { ObjectDetectionBlock } from "./ai/object-detection";
import { ImageCaptionBlock } from "./ai/image-caption";
import { PIDBlock } from "./control/pid";
import { PythonBlock } from "./python/python-block";
export { Variable, Field, Struct, DataType } from "./data_type";

import { isRunning, runBlockChain, runProcedures, runStartFunctions, stopDiagram as stopProcedures, stopFlag } from "./runtime";
import { testPython } from "./python/parser";

/**
 * diagramの実行停止を通知し、接続中の機器へサーボ停止も要求する。
 */
export function stopDiagram(): void {
    stopProcedures();
    if (diagramDevice.state.phase === "connected") {
        void diagramDevice.stopServos().catch(error => console.error("Servo stop failed", error));
    }
}

/**
 * 初期化で登録した画面イベントを破棄時に解除する取消元。
 */
const listeners = new AbortController();
/**
 * 旧HTTPセンサーの定期取得を止めるために保持するタイマー。
 */
let periodicTimer: ReturnType<typeof setTimeout> | undefined;

// 既存の型番号を維持し、PythonBlockは末尾へ追加する。
export const BlockClassCount = 27;

/**
 * 保存・ツール表示で使う固定番号から対応するブロックを作る。
 */
export function makeBlock(idx : number) : Block {
    switch(idx){
    case  0: return new DeviceConnectionBlock({});
    case  1: return new IMUBlock({});
    case  2: return new PlotBlock({});
    case  3: return new IfBlock({});
    case  4: return new InfiniteLoop({});
    case  5: return new TTSBlock({});
    case  6: return new SleepBlock({});
    case  7: return new TriggerGate({});
    case  8: return new InputTextBlock({});
    case  9: return new InputNumberBlock({});
    case 10: return new CompareBlock({});
    case 11: return new InputRangeBlock({});
    case 12: return new ServoMotorBlock({});
    case 13: return new CameraBlock({});
    case 14: return new FaceDetectionBlock({});
    case 15: return new CalcBlock({});
    case 16: return new UltrasonicDistanceSensorBlock({});
    case 17: return new ConditionGate({});
    case 18: return new PlayMovieBlock({});
    case 19: return new PlayGameBlock({});
    case 20: return new PlayWebGPUBlock({});
    case 21: return new AIChatBlock({});
    case 22: return new SpeechRecognitionBlock({});
    case 23: return new ObjectDetectionBlock({});
    case 24: return new ImageCaptionBlock({});
        case 25:
            return new PIDBlock({});
        case 26:
            return new PythonBlock({});
    default: throw new MyError();
    }
}

/**
 * 固定ツール番号に対応するブロックの型名を返す。
 */
export function geBlockName(idx : number) : string {
    switch(idx){
    case  0: return "DeviceConnectionBlock";
    case  1: return "IMUBlock";
    case  2: return "PlotBlock";
    case  3: return "IfBlock";
    case  4: return "InfiniteLoop";
    case  5: return "TTSBlock";
    case  6: return "SleepBlock";
    case  7: return "TriggerGate";
    case  8: return "InputTextBlock";
    case  9: return "InputNumberBlock";
    case 10: return "CompareBlock";
    case 11: return "InputRangeBlock";
    case 12: return "ServoMotorBlock";
    case 13: return "CameraBlock";
    case 14: return "FaceDetectionBlock";
    case 15: return "CalcBlock";
    case 16: return "UltrasonicDistanceSensorBlock";
    case 17: return "ConditionGate";
    case 18: return "PlayMovieBlock";
    case 19: return "PlayGameBlock";
    case 20: return "PlayWebGPUBlock";
    case 21: return "AIChatBlock";
    case 22: return "SpeechRecognitionBlock";
    case 23: return "ObjectDetectionBlock";
    case 24: return "ImageCaptionBlock";
        case 25:
            return "PIDBlock";
        case 26:
            return "PythonBlock";
    default: throw new MyError();
    }
}

/**
 * diagramの編集器とキャンバスを作り、画面イベントを接続する初期化単位。
 */
export class Main {
    /**
     * 現在のdiagram画面を管理するMainの共有インスタンス。
     */
    static one : Main;
    /**
     * この画面が所有するdiagramキャンバス。
     */
    canvas : Canvas;

    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(){
        Main.one = this;

        new Editor();

        const canvas_html = document.getElementById('world-diagram') as HTMLCanvasElement;
        this.canvas = new Canvas(canvas_html);

        window.addEventListener('resize', this.canvas.resizeCanvas.bind(this.canvas), { signal: listeners.signal });

        setDragDrop(this.canvas.canvas);

        this.canvas.resizeCanvas();
    }

}

/**
 * 旧HTTPセンサー通知の画像名から共有カメラ画像の取得を要求する。
 */
function updateCameraImage(image_file_name : string){
    const blocks = theEditor.blocks;
    const cameras = blocks.filter(x => x instanceof CameraBlock);
    for(const camera of cameras){
        const image_url = `static/lib/diagram/img/${image_file_name}`;
        fetchImage(image_url);
    }
}

/**
 * 旧HTTPの顔矩形を対応ブロックへ設定して後続の計算を更新する。
 */
function updateFaceDetection(face : number[]){
    const face_detection = theEditor.blocks.find(x => x instanceof FaceDetectionBlock) as FaceDetectionBlock;
    if(face_detection != undefined){
        face_detection.setFace(face);

        face_detection.propergateCalc();
    }
}

/**
 * 旧HTTPの距離値を距離センサーブロックへ設定して後続へ反映する。
 */
function updateDistanceSensor(distance : number){
    const distance_sensor = theEditor.blocks.find(x => x instanceof UltrasonicDistanceSensorBlock) as UltrasonicDistanceSensorBlock;
    if(distance_sensor != undefined){
        distance_sensor.setDistance(distance);

        distance_sensor.propergateCalc();
    }
}

/**
 * 旧HTTP窓口の残留通知を、空になるまで読み捨てる。
 */
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

/**
 * 旧HTTPセンサー通知を一件処理し、終了要求がなければ次の取得を予約する。
 */
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

/**
 * 入力値を更新して開始対象の完了を待ち、先頭アクションから実行する。
 */
async function startProcedures() {
    startButton.innerText = "Stop";

    try {
        await runProcedures(async () => {
            const input_blocks = theEditor.blocks.filter(x => x instanceof InputBlock);
            input_blocks.forEach(x => x.updatePort());
            await runStartFunctions(theEditor.blocks);
            for (const top_block of getTopActions()) {
                if (stopFlag) break;
                msg(`top proc:${top_block.constructor.name}`);
                await runBlockChain(top_block);
            }
            // 連続制御が終わるまでStartを実行中に保ち、全体Stopを受け付ける。
            const controllers = theEditor.blocks.filter((block): block is PIDBlock => block instanceof PIDBlock);
            await Promise.all(controllers.map(block => block.waitUntilStopped()));
            msg("procedures complete.");
        });
    } finally {
        for (const block of theEditor.blocks) {
            if (block instanceof PIDBlock) {
                block.stop();
            }
        }
        startButton.innerText = "Start";
    }
}

/**
 * URL・UI・接続・保存図の読込みを初期化し、diagram画面を構築する。
 */
export async function initDiagram(_signal?: AbortSignal){
    await testPython()
    initUI();
    initDeviceConnection(listeners.signal);
    
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
    initDiagramOpen(loadJsonAndDraw, listeners.signal);

    const diy_sbc = false;
    if(diy_sbc){
        await clearQueue();

        if( urlOrigin != "http://127.0.0.1:5500"){
            await periodicTask();
        }
    }
}

/**
 * 保存されたブロックとポートのIDを使って図と接続を復元する。
 */
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

/**
 * 保存図を復元し、配置とキャンバス表示を更新する。
 */
async function loadJsonAndDraw(objs: any[]): Promise<void> {
    loadJson(objs);
    const repaint_count = repaintCount;
    theCanvas.requestUpdateCanvas();
    // Restore DOM positions after the first paint has positioned the ports.
    while (repaint_count === repaintCount && !listeners.signal.aborted) await sleep(100);
    if (listeners.signal.aborted) return;
    theEditor.blocks.forEach(block => block.setBlockPortPosition(block.position));
    theCanvas.requestUpdateCanvas();
}

/**
 * ファイルのドラッグ操作に伴うブラウザー既定動作を抑止する。
 *
 * @param ev 操作を開始したブラウザーイベント。
 */
function preventDefaults(ev:DragEvent) {
    ev.preventDefault(); 
    ev.stopPropagation();
}

/**
 * キャンバスへ図のJSONファイルをドロップするイベントを登録する。
 */
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
                await loadJsonAndDraw(obj as any[]);
            };

            reader.readAsText(file);        


        }
    }, { signal: listeners.signal });
}

/**
 * 実行・通信・タイマー・イベントと画面の所有資源を終了する。
 */
export function disposeDiagram(): void {
    stopDiagram();
    diagramDevice.disconnect();
    theEditor?.clearBlock();
    listeners.abort();
    clearTimeout(periodicTimer);
    Main.one?.canvas.dispose();
}
