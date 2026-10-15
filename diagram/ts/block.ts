///<reference path="ui.ts" />

import { assert, msg, MyError, sum, Vec2 } from "@i18n";
import { Term, Rational, ConstNum, RefVar, App, parseMath, SyntaxError } from "@parser";
import { cameraIcon, cameraImg, distanceSensorIcon, notchRadius, PortType, theCanvas } from "./diagram_util";
import { nest_h1, sendData } from "./diagram_util";
import { tab, UI, Attr, Button } from "./ui";
import { NumberPort, Port, TextPort } from "./port";
import { theEditor } from "./json-util";
import { isRunning, stopDiagram, subscribeDiagramStop } from "./runtime";
import { subscribeCamera } from "./camera/camera-feed";
import { DeviceCameraFeed } from "./camera/device-camera";

// export const inputHeight = 21;

const blockLineColor = "brown";

const rangeWidth  = 150;
const numberWidth = 45;

export abstract class Block extends UI {
    ports : Port[] = [];
    outlineColor : string = "green";
    notchBottom : boolean = true;
    notchRight  : boolean = true;
    inToolbox   : boolean = false;

    constructor(data : Attr){
        super(data);
        if(this.backgroundColor == undefined){
            this.backgroundColor = "cornsilk";
        }
        this.padding = [5, 5, 5, 5];

        if(data.inToolbox != undefined){
            this.inToolbox = data.inToolbox;
        }
    }

    abstract copy() : Block;

    makeObj() : any{
        return {
            idx: this.idx,
            typeName: this.constructor.name,
            x : this.position.x,
            y : this.position.y,
            ports : this.ports.map(x => x.makeObj())
        };
    }

    clearBlock() : void {        
        if (isRunning) stopDiagram();
        this.ports.forEach(port => port.disconnectAll());
    }

    loadObj(obj : any ){        
    }

    abstract setBoxSize() : void;

    calcHeight() : number {
        return this.boxSize!.y;
    }

    moveDiff(diff : Vec2) : void {
        const new_position = this.position.add(diff);
        this.setBlockPortPosition(new_position);
    }

    outputPorts() : Port[] {
        return this.ports.filter(x => x.type == PortType.outputPort);
    }

    drawBoxes() : [number, number, number, number][] {
        return [ this.drawBox() ];
    }

    inDrawBoxes(pos : Vec2) : boolean {
        for(const [xa, ya, xb, yb] of this.drawBoxes()){
            if(xa <= pos.x && pos.x < xb && ya <= pos.y && pos.y < yb){
                return true;
            }
        }

        return false;
    }

    nextDataflowBlocks() : Block[] {
        const blocks : Block[] = [];

        const output_ports = this.outputPorts();
        for(const port of output_ports){
            for(const dst of port.destinations){
                blocks.push(dst.parent);
            }
        }

        return blocks;
    }

    propergateCalc(){
        const next_dataflow_blocks = this.nextDataflowBlocks();
        next_dataflow_blocks.forEach(x => x.calc());
    }

    connectBlock(ports : Port[]){
        let [port1, port2] = ports;
        assert(port1.parent == this);

        if(port1.type == PortType.bottom){
            assert(port2.type == PortType.top);
        }
        else if(port1.type == PortType.top){
            assert(port2.type == PortType.bottom);
            [port1, port2] = [port2, port1];
        }
        else{
            return;
        }
        port1.connect(port2);

        theEditor.layoutRoot();
        msg(`connect block`);
    }

    setPortPositions(){     
        const [xa, ya, xb, yb] = this.drawBox();

        const condition_port = this.ports.find(x => x.type == PortType.condition);
        if(condition_port != undefined){
            const y2 = ya + nest_h1;

            condition_port.setPortPositionXY(xb - Port.radius, 0.5 * (ya + y2));
        }

        const input_ports  = this.ports.filter(x => x.type == PortType.inputPort);
        const output_ports = this.ports.filter(x => x.type == PortType.outputPort);

        for(const ports of [ input_ports, output_ports]){
            const y = (ports == input_ports ? ya + notchRadius: yb - notchRadius);
            for(const [i, port] of ports.entries()){
                const p = (i + 1) / (ports.length + 1);
                const x = xa * (1 - p) + xb * p;
                port.setPortPositionXY(x, y)
            }
        }
    }

    setBlockPortPosition(position : Vec2) : void {
        this.setPosition(position);
        this.setPortPositions();
    }

    drawOutline(points : ([number, number] | Port | null)[], color : string = blockLineColor){
        if(this == theCanvas.draggedUI){

            this.ctx.globalAlpha = 0.5;
        }
        else if(theCanvas.prevPortOfDraggedUI != undefined && theCanvas.prevPortOfDraggedUI.parent == this){

            this.ctx.globalAlpha = 0.5;
            color = "red";
        }

        this.ctx.fillStyle   = this.backgroundColor!;
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth   = this.borderWidth;

        this.ctx.beginPath();

        for(const [idx, data] of points.entries()){
            if(data == null){
                continue;
            }
            else if(data instanceof Port){
                data.drawNotch(this.ctx);
            }
            else{
                const [x, y] = data;
                if(idx == 0){

                    this.ctx.moveTo(x, y);
                }
                else{
                    this.ctx.lineTo(x, y);
                }
            }
        }

        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();

        if(this.ctx.globalAlpha != 1.0){
            this.ctx.globalAlpha = 1.0;
        }
    }

    IOPorts(){
        return this.ports.filter(x =>  x.type == PortType.inputPort || x.type == PortType.outputPort || x.type == PortType.condition);
    }

    drawIOPorts(){
        this.IOPorts().forEach(x => x.drawIOPort(this.ctx));
    }

    drawIcon(img : HTMLImageElement){
        const [x1, y1, x2, y2] = this.borderInnerBox();


        const img_height = y2 - y1;
        const img_width  = img_height * img.width / img.height;

        const img_x = x2 - img_width;
        const img_y = y1;

        this.ctx.drawImage(img, img_x, img_y, img_width, img_height);
    }

    draw(){
        const [x1, y1, x2, y2] = this.drawBox();

        this.drawOutline([
            [x1, y1],
            [x1, y2],
            [x2, y2],
            [x2, y1],
        ]);

        this.drawIOPorts();
    }

    canConnectNearPortPair(block : Block) : Port[] {
        for(const port1 of this.ports){
            for(const port2 of block.ports){
                if(port1.canConnect(port2)){
                    return [port1, port2];
                }
            }
        }

        return [];
    }

    async valueChanged(){
        msg(`changed : ${this.constructor.name}`);
    }

    makeInputValueMap() : Map<string, number> {
        const map = new Map<string, number>();
        for(const port of this.ports){
            if(port.type == PortType.inputPort){
                assert(port.name != "" && typeof port.value === 'number' && ! isNaN(port.value));
                map.set(port.name, port.value);
            }
        }

        return map;
    }

    calc(){
        throw new MyError();
    }

    async run(){
        throw new MyError();
    }

    drawDebug(){
        const x = this.position.x;
        const y = this.position.y;

        this.ctx.save();
        this.ctx.lineWidth = 1;

        this.ctx.strokeStyle = "green";
        this.ctx.strokeRect(x, y, this.boxSize.x, this.boxSize.y);

        this.ctx.strokeStyle = "blue";
        this.ctx.strokeRect(x, y, this.boxSize.x, this.boxSize.y);

        {
            const [xa, ya, xb, yb] = this.marginBox();
            this.ctx.strokeStyle = "red";
            this.ctx.strokeRect(xa, ya, xb - xa, yb - ya);
        }

        {
            const [xa, ya, xb, yb] = this.borderCenterBox();
            this.ctx.strokeStyle = "cyan";
            this.ctx.strokeRect(xa, ya, xb - xa, yb - ya);
        }

        {
            const [xa, ya, xb, yb] = this.borderInnerBox();
            this.ctx.strokeStyle = "magenta";
            this.ctx.strokeRect(xa, ya, xb - xa, yb - ya);
        }

        this.ctx.restore();
    }

    str() : string {
        return `${this.constructor.name} idx:${this.idx} pos:${this.position.toString()}`
    }

    dump(nest : number){
        msg(`${tab(nest)}${this.str()}`);
        this.ports.forEach(x => x.dumpPort(nest + 1));
    }
}

export abstract class FunctionBlock extends Block {
    /** Functions that must finish before the action chains start. */
    readonly runOnStart: boolean = false;
    resetForRun(): void {}

    copy() : Block {
        const block = makeFunctionBlockByTypeName(this.constructor.name)!;
        this.copyUI(block);

        return block;
    }
}


export abstract class InputBlock extends FunctionBlock {
    input : HTMLInputElement;

    abstract updatePort() : void;

    constructor(data : Attr){
        super(data);

        this.input = document.createElement("input");
        this.input.style.position = "absolute";
        this.input.style.zIndex = "100";

        const parent = document.getElementById("layer-diagram") || document.body;
        parent.appendChild(this.input);
    }

    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            text : this.input.value
        });

        return obj;
    }

    loadObj(obj : any ){        
        super.loadObj(obj);
        this.input.value = obj.text;
    }

    clearBlock(): void {
        super.clearBlock();
        this.input.parentElement?.removeChild(this.input);
    }

    getInputPosition() : [number, number]{
        const [x1, y1, x2, y2] = this.borderInnerBox();

        const rect = this.input.getBoundingClientRect();
        msg(`input h:${rect.height} ${this.input.type}`);

        const input_x = x1 + 0.5 * ((x2 - x1) - rect.width);
        const input_y = y1 + 0.5 * ((y2 - y1) - rect.height);

        return [input_x, input_y];
    }

    setPosition(position : Vec2) : void {
        super.setPosition(position);

        const [x1, y1] = this.getInputPosition();

        this.input.style.left = `${x1}px`;
        this.input.style.top  = `${y1}px`;
    }
}


export class InputRangeBlock extends InputBlock {
    minInput : HTMLInputElement;
    maxInput : HTMLInputElement;

    constructor(data : Attr){
        super(data);

        this.input.type = "range";
        this.input.style.width = `${rangeWidth}px`;
        this.input.min = "0";
        this.input.max = "100";

        this.minInput = document.createElement("input");
        this.minInput.type = "number";
        this.minInput.value = "0";
        this.minInput.style.position = "absolute";
        this.minInput.style.width = `${numberWidth}px`;

        this.maxInput = document.createElement("input");
        this.maxInput.type = "number";
        this.maxInput.value = "100";
        this.maxInput.style.position = "absolute";
        this.maxInput.style.width = `${numberWidth}px`;

        document.body.appendChild(this.minInput);
        document.body.appendChild(this.maxInput);

        this.input.addEventListener("input", async (ev : Event) => {
            this.updatePort();
            
            theCanvas.requestUpdateCanvas();
        });

        this.minInput.addEventListener('change', (ev : Event) => {
            this.input.min = this.minInput.value;
            msg(`min : [${this.input.min}]`);
        });

        this.maxInput.addEventListener('change', (ev : Event) => {
            this.input.max = this.maxInput.value;
            msg(`max : [${this.input.max}]`);
        });

        this.ports = [ new Port(this, PortType.outputPort) ];
    }

    clearBlock(): void {
        super.clearBlock();
        
        document.body.removeChild(this.minInput);
        document.body.removeChild(this.maxInput);
    }

    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            value : this.input.value,
            min   : this.minInput.value,
            max   : this.maxInput.value
        });

        return obj;
    }

    loadObj(obj : any ){        
        super.loadObj(obj);

        this.input.value    = `${obj.value}`;
        this.minInput.value = `${obj.min}`;
        this.maxInput.value = `${obj.max}`;
    }

    updatePort() : void {        
        const value = parseFloat(this.input.value);
        for(const src of this.ports){
            src.setPortValue(value);
        }
    }

    setBoxSize() : void {
        this.boxSize = new Vec2(200, 80);
    }

    setPosition(position : Vec2) : void {
        super.setPosition(position);

        const [xa, ya, xb, yb] = this.borderInnerBox();
        const height = yb - ya;

        const rc1 = this.input.getBoundingClientRect();
        const rc2 = this.minInput.getBoundingClientRect();

        const gap = (height - (rc1.height + rc2.height + 2 * Port.radius + this.borderWidth)) / 3;

        const x1 = xa + this.borderWidth + 2 * Port.radius;
        const y1 = ya + gap;
        const y2 = y1 + rc1.height + gap;

        this.input.style.left = `${x1}px`;
        this.input.style.top  = `${y1}px`;

        this.minInput.style.left = `${x1}px`;
        this.minInput.style.top  = `${y2}px`;

        this.maxInput.style.left = `${x1 + rc1.width - rc2.width}px`;
        this.maxInput.style.top  = `${y2}px`;
    }
}


export class InputTextBlock extends InputBlock {
    textPort : TextPort;

    constructor(data : Attr){
        super(data);
        this.input.type = "text";

        this.textPort = new TextPort(this, PortType.outputPort);
        this.ports    = [ this.textPort ];

        this.input.addEventListener("input", async (ev : Event) => {
            this.updatePort();
            
            theCanvas.requestUpdateCanvas();
        });
    }

    updatePort() : void {        
        this.textPort.setPortValue(this.input.value);
    }

    setBoxSize() : void {
        this.boxSize = new Vec2(200, 20 + 2 * 2 * notchRadius);
    }
}

export class InputNumberBlock extends InputBlock {
    numberPort : NumberPort;

    constructor(data : Attr){
        super(data);
        this.input.type = "number";
        this.input.value = "0";

        this.numberPort = new NumberPort(this, PortType.outputPort);
        this.numberPort.setPortValue(this.input.valueAsNumber);

        this.ports    = [ this.numberPort ];

        this.input.addEventListener("input", async (ev : Event) => {
            this.updatePort();
            
            theCanvas.requestUpdateCanvas();
        });
    }

    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            value : this.input.valueAsNumber
        });

        return obj;
    }

    loadObj(obj : any ){        
        super.loadObj(obj);
        this.input.value = obj.value;
        this.updatePort();
    }

    updatePort() : void {        
        const value = this.input.valueAsNumber;
        this.numberPort.setPortValue(Number.isFinite(value) ? value : undefined);
    }

    setBoxSize() : void {
        this.boxSize = new Vec2(200, 20 + 2 * 2 * notchRadius);
    }
}

export class CameraBlock extends FunctionBlock {
    private releaseCamera?: () => void;
    private cameraMessage = "Wi-Fiカメラ未接続";
    private cameraSource: "xiao" | "device" = "xiao";
    private readonly deviceCamera: DeviceCameraFeed;
    private readonly deviceButton: Button;
    private readonly xiaoButton: Button;
    private readonly captureButton: Button;
    private readonly events = new AbortController();
    private readonly releaseStop: () => void;
    private removed = false;

    constructor(data : Attr){
        super(data);
        this.ports = [ new Port(this, PortType.outputPort) ];
        this.deviceButton = new Button({ text: "端末のカメラ", fontSize: "16px", click: () => this.selectSource("device") });
        this.xiaoButton = new Button({ text: "XIAO", fontSize: "16px", click: () => this.selectSource("xiao") });
        this.captureButton = new Button({ text: "開始", fontSize: "16px", click: () => {
            if (this.removed || this.inToolbox || this.cameraSource !== "device") return;
            if (this.deviceCamera.active) this.deviceCamera.stop();
            else this.deviceCamera.start();
        } });
        this.deviceCamera = new DeviceCameraFeed(message => {
            if (this.removed || this.cameraSource !== "device") return;
            this.cameraMessage = message; this.refreshControls();
        });
        this.releaseStop = subscribeDiagramStop(() => this.deviceCamera.stop());
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) this.deviceCamera.stop();
        }, { signal: this.events.signal });
        window.addEventListener("pagehide", () => this.deviceCamera.stop(), { signal: this.events.signal });
        this.setBoxSize();
        this.refreshControls();
    }

    children(): UI[] { return this.inToolbox ? [] : [this.deviceButton, this.xiaoButton, this.captureButton]; }
    setContext2D(ctx: CanvasRenderingContext2D): void {
        super.setContext2D(ctx);
        this.subscribeXiao();
    }
    private subscribeXiao(): void {
        if (this.removed || this.inToolbox || !this.ctx || this.cameraSource !== "xiao" || this.releaseCamera) return;
        this.releaseCamera = subscribeCamera(message => {
            this.cameraMessage = message; this.refreshControls();
        });
    }
    private selectSource(source: "xiao" | "device"): void {
        if (this.removed || this.inToolbox) return;
        this.releaseCamera?.(); this.releaseCamera = undefined;
        this.deviceCamera.stop();
        this.cameraSource = source;
        this.cameraMessage = source === "device" ? "「開始」で端末カメラを使います。" : "Wi-Fiカメラ未接続";
        this.subscribeXiao();
        this.refreshControls();
    }
    private refreshControls(): void {
        const disabled = this.removed || this.inToolbox;
        this.deviceButton.disabled = disabled || this.cameraSource === "device";
        this.xiaoButton.disabled = disabled || this.cameraSource === "xiao";
        this.captureButton.disabled = disabled || this.cameraSource !== "device";
        this.captureButton.text = this.deviceCamera?.active ? "停止" : "開始";
        theCanvas?.requestUpdateCanvas();
    }
    setPosition(position: Vec2): void { super.setPosition(position); this.positionControls(); }
    setPortPositions(): void { super.setPortPositions(); this.positionControls(); }
    private positionControls(): void {
        if (!this.deviceButton) return;
        for (const [button, x, width] of [
            [this.deviceButton, 12, 118], [this.xiaoButton, 138, 64], [this.captureButton, 210, 96],
        ] as const) {
            button.setPosition(this.position.add(new Vec2(x, 24)));
            button.boxSize = new Vec2(width, 44);
        }
    }
    makeObj(): any { return { ...super.makeObj(), cameraSource: this.cameraSource }; }
    loadObj(obj: any): void {
        super.loadObj(obj);
        this.selectSource(obj.cameraSource === "device" ? "device" : "xiao");
    }
    copy(): CameraBlock {
        const block = new CameraBlock({});
        block.loadObj(this.makeObj());
        this.copyUI(block);
        block.setBoxSize();
        block.setBlockPortPosition(this.position.copy());
        return block;
    }
    getFrame(): { image: HTMLImageElement | HTMLVideoElement; width: number; height: number } | undefined {
        if (this.removed) return;
        if (this.cameraSource === "device") {
            const video = this.deviceCamera.image;
            if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
                return { image: video, width: video.videoWidth, height: video.videoHeight };
            }
        } else if (cameraImg) {
            return { image: cameraImg, width: cameraImg.naturalWidth || cameraImg.width, height: cameraImg.naturalHeight || cameraImg.height };
        }
    }

    setBoxSize() : void {
        if(this.inToolbox){

            this.boxSize = new Vec2(200, 50 + 2 * notchRadius);
        }
        else{

            this.boxSize = new Vec2(320, 380);
        }
    }


    draw(){
        super.draw();

        const [x1, y1, x2, y2] = this.borderInnerBox();

        if(this.inToolbox){
            this.drawIcon(cameraIcon);
            return;
        }
        this.children().forEach(child => child.draw());
        this.ctx.save();
        this.ctx.font = "14px sans-serif"; this.ctx.textBaseline = "top"; this.ctx.fillStyle = "#555";
        let line = "", row = 0;
        for (const char of this.cameraMessage) {
            if (line && this.ctx.measureText(line + char).width > x2 - x1 - 16) {
                this.ctx.fillText(line, x1 + 8, this.position.y + 78 + row * 18);
                line = ""; row++;
            }
            line += char;
        }
        if (line) this.ctx.fillText(line, x1 + 8, this.position.y + 78 + row * 18);
        const frame = this.getFrame();
        if (frame && frame.width > 0 && frame.height > 0) {
            const top = this.position.y + 132;
            const height = y2 - notchRadius - 8 - top;
            const scale = Math.min((x2 - x1 - 16) / frame.width, height / frame.height);
            const width = frame.width * scale, imageHeight = frame.height * scale;
            this.ctx.drawImage(frame.image, x1 + (x2 - x1 - width) / 2, top + (height - imageHeight) / 2, width, imageHeight);
        }
        this.ctx.restore();
    }
    clearBlock(): void {
        if (this.removed) return;
        this.removed = true;
        this.releaseCamera?.(); this.releaseCamera = undefined;
        this.deviceCamera.stop();
        this.releaseStop(); this.events.abort();
        super.clearBlock();
    }
}

export class FaceDetectionBlock extends FunctionBlock {
    face : number[] = [];

    constructor(data : Attr){
        super(data);
        this.ports = [ new Port(this, PortType.inputPort), new Port(this, PortType.outputPort), new Port(this, PortType.outputPort) ];
    }

    setBoxSize() : void {
        if(this.inToolbox){

            this.boxSize = new Vec2(200, 10 + 2 * 2 * notchRadius);
        }
        else{

            this.boxSize = new Vec2(320, 240 + 2 * 2 * notchRadius);
        }
    }

    setFace(face : number[]){
        this.face = face.slice();
        const [x, y, w, h] = this.face;
        
        const cx = x + w / 2;
        const cy = y + h / 2;

        this.ports[1].setPortValue(cx);
        this.ports[2].setPortValue(cy);
    }

    getCamera() : CameraBlock | undefined {
        if(this.ports[0].sources.length != 0){
            const camera = this.ports[0].sources.map(x => x.parent).find(x => x instanceof CameraBlock);
            return camera;
        }

        return undefined;
    }

    draw(){
        super.draw();

        const camera = this.getCamera();
        if(camera != undefined){
            const [x1, y1, x2, y2] = this.borderInnerBox();

            const frame = camera.getFrame();
            if (!frame || frame.width <= 0 || frame.height <= 0) return;

            const scale = Math.min((x2 - x1) / frame.width, ((y2 - y1) - 2 * 2 * notchRadius) / frame.height);
            const img_height = frame.height * scale;
            const img_width = frame.width * scale;

            const img_x = x1 + 0.5 * ((x2 - x1) - img_width);
            const img_y = y1 + 2 * notchRadius;

            this.ctx.drawImage(frame.image, img_x, img_y, img_width, img_height);


            if(this.face.length == 4){
                this.ctx.save();

                // Set the stroke color to red
                this.ctx.strokeStyle = 'red';

                // Set the line thickness to 5 pixels
                this.ctx.lineWidth = 5;

                const [face_x, face_y, face_w, face_h] = this.face;

                const cx = img_x + img_width  / 2;
                const cy = img_y + img_height / 2;

                const img_face_x = cx + img_width  * face_x / 100;
                const img_face_y = cy + img_height * face_y / 100;
                const img_face_w = img_width  * face_w / 100;
                const img_face_h = img_height * face_h / 100;

                // Draw an outlined rectangle at (200, 50) with a size of 100x75
                this.ctx.strokeRect(img_face_x, img_face_y, img_face_w, img_face_h);            

                this.ctx.restore();
            }
        }
    }
}

export class JoyStickBlock extends FunctionBlock {
    constructor(data : Attr){
        super(data);
        this.ports = [ ];
    }

    setBoxSize() : void {
        this.boxSize = new Vec2(200, 50);
    }
}

export class UltrasonicDistanceSensorBlock extends FunctionBlock {
    constructor(data : Attr){
        super(data);
        this.ports = [ 
            new Port(this, PortType.outputPort) 
        ];
    }

    setBoxSize() : void {
        this.boxSize = new Vec2(200, 50);
    }

    setDistance(distance : number){
        this.ports[0].setPortValue(distance);
    }

    draw(): void {
        super.draw();
        this.drawIcon(distanceSensorIcon);
    }
}

function  calcTerm(map : Map<string, number>, term : Term) : number {
    let value : number;

    if(term instanceof Rational){
        return term.fval();
    }
    else if(term instanceof ConstNum){
        return term.value.fval();
    }
    else if(term instanceof RefVar){
        value = map.get(term.name)!;
        assert(value != undefined);
        return value;
    }
    else if(term instanceof App){
        const app = term;
        const arg_values = app.args.map(x => calcTerm(map, x));
        if(app.isAdd()){
            value = sum(arg_values);
        }
        else if(app.isMul()){
            value = arg_values.reduce((acc, cur) => acc * cur, 1);
        }
        else if(app.isDiv()){
            value = arg_values[0] / arg_values[1];
        }
        else if(app.fncName == "%"){
            value = arg_values[0] % arg_values[1];
        }
        else if(app.isEq()){
            value = (arg_values[0] == arg_values[1] ? 1 : 0);
        }
        else if(app.fncName == "<="){
            value = (arg_values[0] <= arg_values[1] ? 1 : 0);
        }
        else if(app.fncName == "<"){
            value = (arg_values[0] < arg_values[1] ? 1 : 0);
        }
        else{
            throw new MyError("unimplemented");
        }
    }
    else{

        throw new MyError("unimplemented");
    }

    return term.value.fval() * value;
}

export class CalcBlock extends InputTextBlock {
    constructor(data : Attr){
        super(data);
        this.ports = [ 
            new NumberPort(this, PortType.inputPort, "a"),
            new NumberPort(this, PortType.outputPort, "b")
        ];
    }

    setBoxSize() : void {
        // const h = inputHeight + 2 * 2 * Port.radius + 4 * this.borderWidth;
        this.boxSize = new Vec2(200, 80);
    }

    calc(){
        msg(`start calc: a:${this.ports[0].value}`);
        const expr = parseMath(this.input.value.trim()) as App;
        assert(expr.isRootEq());
        const lhs = expr.args[0] as RefVar;
        const rhs = expr.args[1];

        const map = this.makeInputValueMap();

        const rhs_value = calcTerm(map, rhs);
        const lhs_port = this.ports.find(x => x.name == lhs.name && x.type == PortType.outputPort)!;
        assert(lhs_port != undefined);
        lhs_port.setPortValue(rhs_value);

        msg(`end calc: b:${this.ports[1].value}`);

        this.propergateCalc();
    }
}

export class CompareBlock extends InputTextBlock {    
    constructor(data : Attr){
        super(data);
        this.ports = [ 
            new NumberPort(this, PortType.inputPort, "a"),
            new NumberPort(this, PortType.outputPort)
        ];

        this.input.value = "a == a";
    }

    setBoxSize() : void {
        this.boxSize = new Vec2(200, 80);
    }

    calc() {
        msg(`start compare: a:${this.ports[0].value}`);
        let expr : App;

        try{
            expr = parseMath(this.input.value.trim()) as App;
        }
        catch(error){
            if(error instanceof SyntaxError){
                msg(`syntax error`);
            }
            else{
                console.error("An unexpected error occurred:", error);
            }

            this.ports[1].setPortValue(undefined);
            return;
        }

        const map = this.makeInputValueMap();
        const result = calcTerm(map, expr);

        if(result == 0 || result == 1){

            this.ports[1].setPortValue(result);
        }
        else{

            msg(`illegal compare result:${result}`);
            this.ports[1].setPortValue(undefined);
        }
    }
}

export class ConditionGate extends FunctionBlock {
    conditionPort : Port = new NumberPort(this, PortType.condition);
    inPorts : Port[] = [ new Port(this, PortType.inputPort) ];
    outPorts : Port[] = [ new Port(this, PortType.outputPort) ];

    constructor(data : Attr){
        super(data);
        this.ports = [this.conditionPort].concat(this.inPorts, this.outPorts);
    }

    setBoxSize() : void {
        this.boxSize = new Vec2(200, 80);
    }
}

// External block modules register factories without an import cycle through Block.
const functionBlockFactories = new Map<string, () => FunctionBlock>();

export function registerFunctionBlock(typeName: string, factory: () => FunctionBlock): void {
    functionBlockFactories.set(typeName, factory);
}

export function makeFunctionBlockByTypeName(typeName : string) : FunctionBlock | undefined {
    switch(typeName){
    case InputRangeBlock.name:               return new InputRangeBlock({});
    case InputTextBlock.name:                return new InputTextBlock({});
    case InputNumberBlock.name:              return new InputNumberBlock({});
    case CameraBlock.name:                   return new CameraBlock({});
    case FaceDetectionBlock.name:            return new FaceDetectionBlock({});
    case JoyStickBlock.name:                 return new JoyStickBlock({});
    case UltrasonicDistanceSensorBlock.name: return new UltrasonicDistanceSensorBlock({});
    case CalcBlock.name:                     return new CalcBlock({});
    case CompareBlock.name:                  return new CompareBlock({});
    case ConditionGate.name:                 return new ConditionGate({});
    default: return functionBlockFactories.get(typeName)?.();
    }
}
