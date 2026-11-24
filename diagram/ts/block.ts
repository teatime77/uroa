/**
 * データを受け渡すブロックと、入力・カメラ・計算ブロックを実装する。ポート接続はport.ts、配置と操作はcanvas.ts、実行の停止はruntime.tsが担当する。
 */
///<reference path="ui.ts" />

import { assert, msg, MyError, sum, Vec2 } from "@i18n";
import { Term, Rational, ConstNum, RefVar, App, parseMath, SyntaxError } from "@parser";
import { cameraIcon, cameraImg, notchRadius, PortType, theCanvas } from "./diagram_util";
import { nest_h1, sendData } from "./diagram_util";
import { tab, UI, Attr, Button } from "./ui";
import { NumberPort, Port, TextPort } from "./port";
import { theEditor } from "./json-util";
import { isRunning, stopDiagram, subscribeDiagramStop } from "./runtime";
import { subscribeCamera } from "./camera/camera-feed";
import { DeviceCameraFeed } from "./camera/device-camera";

// export const inputHeight = 21;

const blockLineColor = "brown";

/**
 * 範囲入力スライダーの表示幅（pixel）。
 */
const rangeWidth  = 150;
/**
 * 数値入力欄の表示幅（pixel）。
 */
const numberWidth = 45;

/**
 * 機器種別でセンサーとアクチュエーターを分ける境界値。
 */
const ActuatorBase = 128;

/**
 * WebとESP32で共有するセンサー・アクチュエーターの種別番号。
 */
export enum DeviceType { 
    IMU6Axis = 0,
    IMU9Axis = 1,
    UltrasonicDistanceSensor = 2,
    Camera = 3,

    ServoMotor = ActuatorBase,
 }

/**
 * 入出力ポート・描画・保存・実行を持つdiagramブロックの基底。
 */
export abstract class Block extends UI {
    /**
     * このブロックが所有する実行・データ・条件ポート。
     */
    ports : Port[] = [];
    /**
     * ブロックの輪郭色の設定。
     */
    outlineColor : string = "green";
    /**
     * 下側に実行接続の切欠きを設けるための表示指定。
     */
    notchBottom : boolean = true;
    /**
     * 右側に切欠きを設けるための表示指定。
     */
    notchRight  : boolean = true;
    /**
     * 実配置された部品とツールボックス上の見本を区別するフラグ。
     */
    inToolbox   : boolean = false;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
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

    /**
     * 同じ種類のブロックを作成し、複製対象の設定をコピーする。
     */
    abstract copy() : Block;

    /**
     * 図の保存に必要な設定をJSON化可能なオブジェクトへ変換する。
     */
    makeObj() : any{
        return {
            idx: this.idx,
            typeName: this.constructor.name,
            x : this.position.x,
            y : this.position.y,
            ports : this.ports.map(x => x.makeObj())
        };
    }

    /**
     * 接続・イベント・所有資源を解放してブロックを削除可能にする。
     */
    clearBlock() : void {        
        if (isRunning) stopDiagram();
        this.ports.forEach(port => port.disconnectAll());
    }

    /**
     * 派生ブロックが保存設定を復元するための入口。基底では設定を変更しない。
     *
     * @param obj 復元する保存オブジェクト。
     */
    loadObj(obj : any ){        
    }

    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    abstract setBoxSize() : void;

    /**
     * ブロックの描画に必要な高さを求める。
     */
    calcHeight() : number {
        return this.boxSize!.y;
    }

    /**
     * 指定した差分だけブロックとポートを移動する。
     */
    moveDiff(diff : Vec2) : void {
        const new_position = this.position.add(diff);
        this.setBlockPortPosition(new_position);
    }

    /**
     * 後続ブロックへ値を渡す出力ポートを返す。
     */
    outputPorts() : Port[] {
        return this.ports.filter(x => x.type == PortType.outputPort);
    }

    /**
     * 描画と当たり判定に使う矩形の一覧を返す。
     */
    drawBoxes() : [number, number, number, number][] {
        return [ this.drawBox() ];
    }

    /**
     * 指定座標がブロックを構成するいずれかの矩形内にあるかを調べる。
     */
    inDrawBoxes(pos : Vec2) : boolean {
        for(const [xa, ya, xb, yb] of this.drawBoxes()){
            if(xa <= pos.x && pos.x < xb && ya <= pos.y && pos.y < yb){
                return true;
            }
        }

        return false;
    }

    /**
     * 全出力ポートの接続先から後続の計算ブロックを集める。
     */
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

    /**
     * 直接接続された後続のデータフローブロックに再計算を要求する。
     */
    propergateCalc(){
        const next_dataflow_blocks = this.nextDataflowBlocks();
        next_dataflow_blocks.forEach(x => x.calc());
    }

    /**
     * 上下の実行ポートを接続し、ルート配置を調整する。
     */
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

    /**
     * ブロックの現在位置と大きさに合わせてポートを配置する。
     */
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

    /**
     * ブロックの基準座標とポート位置をまとめて更新する。
     *
     * @param position 基準となる座標またはソース内の位置。
     */
    setBlockPortPosition(position : Vec2) : void {
        this.setPosition(position);
        this.setPortPositions();
    }

    /**
     * 直線とポートの切欠きから輪郭を描き、ドラッグ時の透過表示も反映する。
     */
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

    /**
     * 値の入出力と条件入力に使うポートだけを取り出す。
     */
    IOPorts(){
        return this.ports.filter(x =>  x.type == PortType.inputPort || x.type == PortType.outputPort || x.type == PortType.condition);
    }

    /**
     * データ入出力と条件ポートを描画する。
     */
    drawIOPorts(){
        this.IOPorts().forEach(x => x.drawIOPort(this.ctx));
    }

    /**
     * この部品の表示領域へアイコンを描く。
     */
    drawIcon(img : HTMLImageElement){
        const [x1, y1, x2, y2] = this.borderInnerBox();


        const img_height = y2 - y1;
        const img_width  = img_height * img.width / img.height;

        const img_x = x2 - img_width;
        const img_y = y1;

        this.ctx.drawImage(img, img_x, img_y, img_width, img_height);
    }

    /**
     * この部品の枠・内容・操作状態をキャンバスへ描く。
     */
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

    /**
     * 相手ブロックとの間で型と距離が合う最初のポート対を返す。
     */
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

    /**
     * 入力変更を診断出力する。具体的な更新処理は派生ブロックが追加する。
     */
    async valueChanged(){
        msg(`changed : ${this.constructor.name}`);
    }

    /**
     * 名前を持つ数値入力を集め、数式評価用の名前と値の対応表を作る。
     */
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

    /**
     * 派生ブロック向けの計算入口。基底のまま呼ばれた場合は未実装の例外を投げる。
     */
    calc(){
        throw new MyError();
    }

    /**
     * 派生ブロック向けの実行入口。基底のまま呼ばれた場合は未実装の例外を投げる。
     */
    async run(){
        throw new MyError();
    }

    /**
     * ブロックの診断情報を現在の描画位置へ表示する。
     */
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

    /**
     * 診断表示に使う部品の状態文字列を返す。
     */
    str() : string {
        return `${this.constructor.name} idx:${this.idx} pos:${this.position.toString()}`
    }

    /**
     * 現在の状態を指定した深さで字下げして診断出力する。
     *
     * @param nest 診断出力の字下げの深さ。
     */
    dump(nest : number){
        msg(`${tab(nest)}${this.str()}`);
        this.ports.forEach(x => x.dumpPort(nest + 1));
    }
}

/**
 * 値の計算や機器操作を担う機能ブロックの基底。
 */
export abstract class FunctionBlock extends Block {
    /** Functions that must finish before the action chains start. */
    readonly runOnStart: boolean = false;
    /**
     * DeviceInfoへ書き込む機器の種別。非機器ブロックでは未指定。
     */
    deviceType? : DeviceType;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : Attr){
        super(data);
    }

    /**
     * 機器種別がアクチュエーター境界より前のセンサーであるかを調べる。
     */
    isSensor() : boolean {
        return false;
    }

    /**
     * 機器種別がアクチュエーターの範囲にあるかを調べる。
     */
    isActuator() : boolean {
        return false;
    }

    /**
     * DeviceInfo用の機器種別を書き込み、次の書込み位置を返す。
     *
     * @param bytes 読み書きするバイト列。
     * @param offset バイト列内の開始位置。
     */
    writeDeviceInfo(bytes : Uint8Array, offset : number) : number {
        throw new MyError();
    }

    /**
     * この機能ブロックの通常指令を書き込むための派生型向け入口。
     *
     * @param bytes 読み書きするバイト列。
     * @param offset バイト列内の開始位置。
     */
    writeCommand(bytes : Uint8Array, offset : number) : number {
        throw new MyError();
    }

    /**
     * Telemetry内のセンサーレコードを読み取り、次のレコード位置を返す。
     * @param time 機器起動後の経過時間。単位はミリ秒。
     * @param data Telemetry全体のバイナリ。
     * @param offset このセンサーのレコード開始位置。
     * @returns 次のレコードの開始位置。
     */
    readStatus(time: number, data: DataView, offset: number): number {
        throw new MyError();
    }

    /**
     * Start前に実行ごとの状態を初期化するための派生型向け入口。
     */
    resetForRun(): void {}

    /**
     * 同じ種類のブロックを作成し、複製対象の設定をコピーする。
     */
    copy() : Block {
        const block = makeFunctionBlockByTypeName(this.constructor.name)!;
        this.copyUI(block);

        return block;
    }
}


/**
 * DOM入力欄からポートへ値を渡すブロックの共通処理。
 */
export abstract class InputBlock extends FunctionBlock {
    /**
     * ブロックに重ねる値入力用のDOM要素。
     */
    input : HTMLInputElement;

    /**
     * 入力UIの現在値を対応する出力ポートへ反映する。
     */
    abstract updatePort() : void;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : Attr){
        super(data);

        this.input = document.createElement("input");
        this.input.style.position = "absolute";
        this.input.style.zIndex = "100";

        const parent = document.getElementById("layer-diagram") || document.body;
        parent.appendChild(this.input);
    }

    /**
     * 図の保存に必要な設定をJSON化可能なオブジェクトへ変換する。
     */
    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            text : this.input.value
        });

        return obj;
    }

    /**
     * 保存オブジェクトからこの要素の設定を復元する。
     *
     * @param obj 復元する保存オブジェクト。
     */
    loadObj(obj : any ){        
        super.loadObj(obj);
        this.input.value = obj.text;
    }

    /**
     * 接続・イベント・所有資源を解放してブロックを削除可能にする。
     */
    clearBlock(): void {
        super.clearBlock();
        this.input.parentElement?.removeChild(this.input);
    }

    /**
     * ブロックの枠内でDOM入力欄を配置する基準座標を返す。
     */
    getInputPosition() : [number, number]{
        const [x1, y1, x2, y2] = this.borderInnerBox();

        const rect = this.input.getBoundingClientRect();
        msg(`input h:${rect.height} ${this.input.type}`);

        const input_x = x1 + 0.5 * ((x2 - x1) - rect.width);
        const input_y = y1 + 0.5 * ((y2 - y1) - rect.height);

        return [input_x, input_y];
    }

    /**
     * 部品の基準座標を更新する。
     *
     * @param position 基準となる座標またはソース内の位置。
     */
    setPosition(position : Vec2) : void {
        super.setPosition(position);

        const [x1, y1] = this.getInputPosition();

        this.input.style.left = `${x1}px`;
        this.input.style.top  = `${y1}px`;
    }
}


/**
 * 最小・最大を指定できる数値スライダー入力。
 */
export class InputRangeBlock extends InputBlock {
    /**
     * 範囲入力の最小値を編集する数値欄。
     */
    minInput : HTMLInputElement;
    /**
     * 範囲入力の最大値を編集する数値欄。
     */
    maxInput : HTMLInputElement;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
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

    /**
     * 接続・イベント・所有資源を解放してブロックを削除可能にする。
     */
    clearBlock(): void {
        super.clearBlock();
        
        document.body.removeChild(this.minInput);
        document.body.removeChild(this.maxInput);
    }

    /**
     * 図の保存に必要な設定をJSON化可能なオブジェクトへ変換する。
     */
    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            value : this.input.value,
            min   : this.minInput.value,
            max   : this.maxInput.value
        });

        return obj;
    }

    /**
     * 保存オブジェクトからこの要素の設定を復元する。
     *
     * @param obj 復元する保存オブジェクト。
     */
    loadObj(obj : any ){        
        super.loadObj(obj);

        this.input.value    = `${obj.value}`;
        this.minInput.value = `${obj.min}`;
        this.maxInput.value = `${obj.max}`;
    }

    /**
     * 入力UIの現在値を対応する出力ポートへ反映する。
     */
    updatePort() : void {        
        const value = parseFloat(this.input.value);
        for(const src of this.ports){
            src.setPortValue(value);
        }
    }

    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize() : void {
        this.boxSize = new Vec2(200, 80);
    }

    /**
     * 部品の基準座標を更新する。
     *
     * @param position 基準となる座標またはソース内の位置。
     */
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


/**
 * 文字列を入力してTextPortへ出力するブロック。
 */
export class InputTextBlock extends InputBlock {
    /**
     * 入力した文字列を後続へ渡す出力ポート。
     */
    textPort : TextPort;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
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

    /**
     * 入力UIの現在値を対応する出力ポートへ反映する。
     */
    updatePort() : void {        
        this.textPort.setPortValue(this.input.value);
    }

    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize() : void {
        this.boxSize = new Vec2(200, 20 + 2 * 2 * notchRadius);
    }
}

/**
 * 数値を入力してNumberPortへ出力するブロック。
 */
export class InputNumberBlock extends InputBlock {
    /**
     * 入力した数値を後続へ渡す出力ポート。
     */
    numberPort : NumberPort;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
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

    /**
     * 図の保存に必要な設定をJSON化可能なオブジェクトへ変換する。
     */
    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            value : this.input.valueAsNumber
        });

        return obj;
    }

    /**
     * 保存オブジェクトからこの要素の設定を復元する。
     *
     * @param obj 復元する保存オブジェクト。
     */
    loadObj(obj : any ){        
        super.loadObj(obj);
        this.input.value = obj.value;
        this.updatePort();
    }

    /**
     * 入力UIの現在値を対応する出力ポートへ反映する。
     */
    updatePort() : void {        
        const value = this.input.valueAsNumber;
        this.numberPort.setPortValue(Number.isFinite(value) ? value : undefined);
    }

    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize() : void {
        this.boxSize = new Vec2(200, 20 + 2 * 2 * notchRadius);
    }
}

/**
 * 端末またはXIAOの画像を取得し、AIブロック等へフレームを提供する。
 */
export class CameraBlock extends FunctionBlock {
    /**
     * 画像や入力元の変化を識別するフレーム世代。
     */
    private frameRevision = 0;
    /**
     * 直前に購読者へ通知した入力元・画像世代の状態文字列。
     */
    private frameState = "";
    /**
     * カメラ入力状態の変更を購読する処理の集合。
     */
    private readonly frameListeners = new Set<() => void>();
    /**
     * Wi-Fiカメラ画像の購読を解除する関数。
     */
    private releaseCamera?: () => void;
    /**
     * 画像未取得やカメラ利用状態を描画するメッセージ。
     */
    private cameraMessage = "Wi-Fiカメラ未接続";
    /**
     * 現在選択している入力元。XIAO画像または端末カメラ。
     */
    private cameraSource: "xiao" | "device" = "xiao";
    /**
     * 端末カメラの権限・ストリーム・画像固定を管理する所有インスタンス。
     */
    private readonly deviceCamera: DeviceCameraFeed;
    /**
     * 端末カメラへ切り替えるボタン。
     */
    private readonly deviceButton: Button;
    /**
     * Wi-Fi接続したXIAOカメラへ切り替えるボタン。
     */
    private readonly xiaoButton: Button;
    /**
     * 端末カメラの取得画像を固定するボタン。
     */
    private readonly captureButton: Button;
    /**
     * この部品で登録したDOMイベントをまとめて解除するための取消元。
     */
    private readonly events = new AbortController();
    /**
     * diagram停止通知の購読を解除する関数。
     */
    private readonly releaseStop: () => void;
    /**
     * 削除済みの部品に非同期結果を反映しないための状態。
     */
    private removed = false;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
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
            this.cameraMessage = message; this.refreshControls(); this.notifyFrameState();
        });
        this.releaseStop = subscribeDiagramStop(() => this.deviceCamera.stop());
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) this.deviceCamera.stop();
        }, { signal: this.events.signal });
        window.addEventListener("pagehide", () => this.deviceCamera.stop(), { signal: this.events.signal });
        this.setBoxSize();
        this.refreshControls();
    }

    /**
     * この部品が所有する、描画や操作の対象となる子UIを返す。
     */
    children(): UI[] { return this.inToolbox ? [] : [this.deviceButton, this.xiaoButton, this.captureButton]; }
    /**
     * 描画コンテキストを設定し、子要素にも共有する。
     *
     * @param ctx 描画先の2Dコンテキスト。
     */
    setContext2D(ctx: CanvasRenderingContext2D): void {
        super.setContext2D(ctx);
        this.subscribeXiao();
    }
    /**
     * Wi-Fiカメラの画像と状態を購読して描画へ反映する。
     */
    private subscribeXiao(): void {
        if (this.removed || this.inToolbox || !this.ctx || this.cameraSource !== "xiao" || this.releaseCamera) return;
        this.releaseCamera = subscribeCamera(message => {
            this.cameraMessage = message; this.refreshControls(); this.notifyFrameState();
        });
    }
    /**
     * 端末とXIAOの入力元を切り替え、旧入力の取得と購読を終了する。
     */
    private selectSource(source: "xiao" | "device"): void {
        if (this.removed || this.inToolbox) return;
        this.releaseCamera?.(); this.releaseCamera = undefined;
        this.deviceCamera.stop();
        this.cameraSource = source;
        this.frameRevision++;
        this.cameraMessage = source === "device" ? "「開始」で端末カメラを使います。" : "Wi-Fiカメラ未接続";
        this.subscribeXiao();
        this.refreshControls();
        this.notifyFrameState();
    }
    /**
     * 画像状態の変更を購読し、解除関数を返す。
     *
     * @param listener 変更通知を受け取る処理。
     */
    subscribeFrameState(listener: () => void): () => void {
        this.frameListeners.add(listener);
        return () => { this.frameListeners.delete(listener); };
    }
    /**
     * 画像の入力元・状態が変わったときだけ購読者へ通知する。
     */
    private notifyFrameState(): void {
        const frame = this.getFrame();
        const state = `${this.cameraSource}:${frame ? `${frame.width}x${frame.height}` : "none"}`;
        if (state !== this.frameState) { this.frameState = state; this.frameRevision++; }
        this.frameListeners.forEach(listener => listener());
    }
    /**
     * 実行状態と利用可能性に合わせて操作ボタンの状態を更新する。
     */
    private refreshControls(): void {
        const disabled = this.removed || this.inToolbox;
        this.deviceButton.disabled = disabled || this.cameraSource === "device";
        this.xiaoButton.disabled = disabled || this.cameraSource === "xiao";
        this.captureButton.disabled = disabled || this.cameraSource !== "device";
        this.captureButton.text = this.deviceCamera?.active ? "停止" : "開始";
        theCanvas?.requestUpdateCanvas();
    }
    /**
     * 部品の基準座標を更新する。
     *
     * @param position 基準となる座標またはソース内の位置。
     */
    setPosition(position: Vec2): void { super.setPosition(position); this.positionControls(); }
    /**
     * ブロックの現在位置と大きさに合わせてポートを配置する。
     */
    setPortPositions(): void { super.setPortPositions(); this.positionControls(); }
    /**
     * ブロックの位置に合わせて操作ボタンを配置する。
     */
    private positionControls(): void {
        if (!this.deviceButton) return;
        for (const [button, x, width] of [
            [this.deviceButton, 12, 118], [this.xiaoButton, 138, 64], [this.captureButton, 210, 96],
        ] as const) {
            button.setPosition(this.position.add(new Vec2(x, 24)));
            button.boxSize = new Vec2(width, 44);
        }
    }
    /**
     * 図の保存に必要な設定をJSON化可能なオブジェクトへ変換する。
     */
    makeObj(): any { return { ...super.makeObj(), cameraSource: this.cameraSource }; }
    /**
     * 保存オブジェクトからこの要素の設定を復元する。
     *
     * @param obj 復元する保存オブジェクト。
     */
    loadObj(obj: any): void {
        super.loadObj(obj);
        this.selectSource(obj.cameraSource === "device" ? "device" : "xiao");
    }
    /**
     * 入力元の選択を保存オブジェクト経由で複製し、映像や権限は共有しない。
     */
    copy(): CameraBlock {
        const block = new CameraBlock({});
        block.loadObj(this.makeObj());
        this.copyUI(block);
        block.setBoxSize();
        block.setBlockPortPosition(this.position.copy());
        return block;
    }
    /**
     * 現在利用できる画像・寸法・更新世代を取得する。未取得ならundefinedを返す。
     */
    getFrame(): { /** 取得済みの画像または映像フレームの参照。 */ image: HTMLImageElement | HTMLVideoElement; /** レイアウトで使用する幅の指定。 */ width: number; /** レイアウトで使用する高さの指定。 */ height: number; /** 返却する画像の更新世代。 */ revision: number } | undefined {
        if (this.removed) return;
        if (this.cameraSource === "device") {
            const video = this.deviceCamera.image;
            if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
                return { image: video, width: video.videoWidth, height: video.videoHeight, revision: this.frameRevision };
            }
        } else if (cameraImg) {
            return { image: cameraImg, width: cameraImg.naturalWidth || cameraImg.width, height: cameraImg.naturalHeight || cameraImg.height, revision: this.frameRevision };
        }
    }

    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize() : void {
        if(this.inToolbox){

            this.boxSize = new Vec2(200, 50 + 2 * notchRadius);
        }
        else{

            this.boxSize = new Vec2(320, 380);
        }
    }


    /**
     * この部品の枠・内容・操作状態をキャンバスへ描く。
     */
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
    /**
     * 接続・イベント・所有資源を解放してブロックを削除可能にする。
     */
    clearBlock(): void {
        if (this.removed) return;
        this.removed = true;
        this.notifyFrameState(); this.frameListeners.clear();
        this.releaseCamera?.(); this.releaseCamera = undefined;
        this.deviceCamera.stop();
        this.releaseStop(); this.events.abort();
        super.clearBlock();
    }
}

/**
 * 旧HTTP経路の顔矩形をカメラ画像へ重ねるブロック。
 */
export class FaceDetectionBlock extends FunctionBlock {
    /**
     * 旧HTTP顔検出の矩形座標を保持する配列。
     */
    face : number[] = [];

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : Attr){
        super(data);
        this.ports = [ new Port(this, PortType.inputPort), new Port(this, PortType.outputPort), new Port(this, PortType.outputPort) ];
    }

    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize() : void {
        if(this.inToolbox){

            this.boxSize = new Vec2(200, 10 + 2 * 2 * notchRadius);
        }
        else{

            this.boxSize = new Vec2(320, 240 + 2 * 2 * notchRadius);
        }
    }

    /**
     * 旧HTTP窓口から受け取った顔矩形を保持する。
     */
    setFace(face : number[]){
        this.face = face.slice();
        const [x, y, w, h] = this.face;
        
        const cx = x + w / 2;
        const cy = y + h / 2;

        this.ports[1].setPortValue(cx);
        this.ports[2].setPortValue(cy);
    }

    /**
     * 入力接続から画像の供給元となるCameraBlockを探す。
     */
    getCamera() : CameraBlock | undefined {
        if(this.ports[0].sources.length != 0){
            const camera = this.ports[0].sources.map(x => x.parent).find(x => x instanceof CameraBlock);
            return camera;
        }

        return undefined;
    }

    /**
     * この部品の枠・内容・操作状態をキャンバスへ描く。
     */
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

/**
 * ジョイスティック部品の表示領域を持つ機能ブロック。
 */
export class JoyStickBlock extends FunctionBlock {
    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : Attr){
        super(data);
        this.ports = [ ];
    }

    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize() : void {
        this.boxSize = new Vec2(200, 50);
    }
}

/**
 * 入力値の対応表を使って数式木の数値・変数・四則・比較等を評価する。
 *
 * @param term 処理する式の構文木。
 */
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

/**
 * テキストに記した数式を数値入力ポートの値で評価するブロック。
 */
export class CalcBlock extends InputTextBlock {
    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : Attr){
        super(data);
        this.ports = [ 
            new NumberPort(this, PortType.inputPort, "a"),
            new NumberPort(this, PortType.outputPort, "b")
        ];
    }

    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize() : void {
        // const h = inputHeight + 2 * 2 * Port.radius + 4 * this.borderWidth;
        this.boxSize = new Vec2(200, 80);
    }

    /**
     * 入力ポートの値から出力を計算する。具体的な演算は派生型が担当する。
     */
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

/**
 * 入力した比較式を評価して条件値を出すブロック。
 */
export class CompareBlock extends InputTextBlock {    
    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : Attr){
        super(data);
        this.ports = [ 
            new NumberPort(this, PortType.inputPort, "a"),
            new NumberPort(this, PortType.outputPort)
        ];

        this.input.value = "a == a";
    }

    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize() : void {
        this.boxSize = new Vec2(200, 80);
    }

    /**
     * 入力ポートの値から出力を計算する。具体的な演算は派生型が担当する。
     */
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

/**
 * データ入出力と条件入力のポートを持つ機能ブロック。
 */
export class ConditionGate extends FunctionBlock {
    /**
     * 条件判定に使用する値の入力ポート。
     */
    conditionPort : Port = new NumberPort(this, PortType.condition);
    /**
     * ブロックが所有するデータ入力ポートの一覧。
     */
    inPorts : Port[] = [ new Port(this, PortType.inputPort) ];
    /**
     * ブロックが所有するデータ出力ポートの一覧。
     */
    outPorts : Port[] = [ new Port(this, PortType.outputPort) ];

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : Attr){
        super(data);
        this.ports = [this.conditionPort].concat(this.inPorts, this.outPorts);
    }

    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize() : void {
        this.boxSize = new Vec2(200, 80);
    }
}

// External block modules register factories without an import cycle through Block.
const functionBlockFactories = new Map<string, () => FunctionBlock>();

/**
 * 派生モジュールの機能ブロックを型名と生成関数で登録する。
 */
export function registerFunctionBlock(typeName: string, factory: () => FunctionBlock): void {
    functionBlockFactories.set(typeName, factory);
}

/**
 * 登録表または組込みの型名から機能ブロックを作る。未知の型はundefined。
 */
export function makeFunctionBlockByTypeName(typeName : string) : FunctionBlock | undefined {
    switch(typeName){
    case InputRangeBlock.name:               return new InputRangeBlock({});
    case InputTextBlock.name:                return new InputTextBlock({});
    case InputNumberBlock.name:              return new InputNumberBlock({});
    case CameraBlock.name:                   return new CameraBlock({});
    case FaceDetectionBlock.name:            return new FaceDetectionBlock({});
    case JoyStickBlock.name:                 return new JoyStickBlock({});
    case CalcBlock.name:                     return new CalcBlock({});
    case CompareBlock.name:                  return new CompareBlock({});
    case ConditionGate.name:                 return new ConditionGate({});
    default: return functionBlockFactories.get(typeName)?.();
    }
}
