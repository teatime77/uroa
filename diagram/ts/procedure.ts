/**
 * 順番に実行するアクションと、条件分岐・繰返し・他アプリ再生を実装する。停止可能な実行待機と連鎖実行はruntime.tsを利用する。
 */
import { msg, Speech, sleep, MyError, assert, setVoiceLanguageCode, Vec2 } from "@i18n";
import { runBlockChain, stopFlag, waitProcedure } from "./runtime";
import { tab, Attr } from "./ui";
import { Block, makeFunctionBlockByTypeName } from "./block";
import { NumberPort, Port, TextPort } from "./port";
import { nest_h1, notchRadius, PortType, sleepIcon, ttsIcon } from "./diagram_util";
import { allActions } from "./canvas";
import { switchActiveModule } from "./diagram_util";
import { playAllGraph } from "@movie";
import { playGameWorld } from "@game";
import { playWebGPUPackage } from "@webgpu";

/**
 * 入れ子ブロックの内部領域に加える高さ（pixel）。
 */
const nest_h2 = 30;
/**
 * 入れ子ブロックの下部帯の高さ（pixel）。
 */
const nest_h3 = 20;

/**
 * 上下の実行ポートを持つアクションの共通処理。
 */
export abstract class ActionBlock extends Block {
    /**
     * 直前のアクションから実行を受け取る上側ポート。
     */
    topPort       = new Port(this, PortType.top);
    /**
     * 次のアクションへ実行を渡す下側ポート。
     */
    bottomPort    = new Port(this, PortType.bottom);

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : Attr){
        super(data);

        this.ports = [ 
            this.topPort, 
            this.bottomPort 
        ];
    }

    /**
     * 同じ種類のブロックを作成し、複製対象の設定をコピーする。
     */
    copy() : Block {
        const block = makeActionBlockByTypeName(this.constructor.name)!;
        this.copyUI(block);

        return block;
    }

    /**
     * 後続と入れ子をたどるための実行出力ポートを返す。
     */
    dependentPorts() : Port[] {
        return [ this.bottomPort ];
    }

    /**
     * 依存するアクションを深さ優先でたどり、後続を先に列挙する。
     */
    *dependantActions() : Generator<ActionBlock> {
        for(const src_port of this.dependentPorts()){
            for(const dst_port of src_port.destinations){
                const action = dst_port.parent as ActionBlock;
                yield* action.dependantActions();
            }
        }

        yield this;
    }

    /**
     * 接続元が一つの場合に、その直前のポートを返す。
     */
    prevPort() : Port | undefined {
        return this.topPort.prevPort();
    }

    /**
     * 上側ポートに接続された直前のアクションを返す。
     */
    prevBlock() : ActionBlock | undefined {        
        const prev_port = this.prevPort();
        if(prev_port != undefined){
            return prev_port.parent as ActionBlock;
        }

        return undefined;
    }

    /**
     * 下側ポートに一つだけ接続された次のアクションを返す。
     */
    nextBlock() : ActionBlock | undefined {        
        const dst_port = this.bottomPort.nextPort();
        if(dst_port != undefined){
            return dst_port.parent as ActionBlock;
        }

        return undefined;
    }

    /**
     * 上側ポートへ接続できる近傍の実行ポートを探す。
     */
    checkTopPortConnection(){
        const ports = allActions().filter(x => x != this).map(x => x.ports).flat();
        const port = ports.find(x => x.canConnect(this.topPort));
        
        return port;
    }

    /**
     * 移動で離れた上側の実行接続を解除し、解除したかを返す。
     */
    disconnectSeperatedPort() : boolean {
        if(this.topPort.sources.length == 1){
            const src_port = this.topPort.sources[0];
            if(! src_port.isNearPort(this.topPort)){
                src_port.disconnect(this.topPort);
                msg(`dis-connect:${src_port.parent.constructor.name} ${this.constructor.name}`);

                return true;
            }
        }

        return false;
    }

    /**
     * ブロックの現在位置と大きさに合わせてポートを配置する。
     */
    setPortPositions(){    
        super.setPortPositions();

        const [xa, ya, xb, yb] = this.drawBox();
        const x2 = xa + 35;

        this.topPort.setPortPositionXY(x2, ya)

        this.bottomPort.setPortPositionXY(x2, yb);
    }

    /**
     * このアクションを移動し、依存する実行列を接続位置へ追従させる。
     *
     * @param position 基準となる座標またはソース内の位置。
     */
    adjustActionPosition(position : Vec2) : void {
        this.setBlockPortPosition(position);
        
        for(const port of this.dependentPorts()){
            const dst_port = port.nextPort();
            if(dst_port != undefined){
                const dst_action_position = port.getPosition().sub(dst_port.offset);

                const dst_action = dst_port.parent as ActionBlock;
                dst_action.adjustActionPosition(dst_action_position);
            }
        }
    }

    /**
     * 内容の描画と当たり判定に使う矩形を返す。
     */
    drawBox() : [number, number, number, number] {
        const [xa, ya, xb, yb] = this.borderInnerBox();

        if(this instanceof ActionBlock && !(this instanceof InfiniteLoop)){
            return [xa, ya, xb, yb - notchRadius];
        }
        else{
            return [xa, ya, xb, yb];
        }
    }

    /**
     * この部品の枠・内容・操作状態をキャンバスへ描く。
     */
    draw(){
        const [x1, y1, x2, y2] = this.drawBox();

        this.drawOutline([
            [x1, y1],
            [x1, y2],
            this.bottomPort,
            [x2, y2],
            [x2, y1],
            this.topPort
        ]);

        this.drawIOPorts();
    }

    /**
     * 現在の状態を指定した深さで字下げして診断出力する。
     *
     * @param nest 診断出力の字下げの深さ。
     */
    dump(nest : number){
        super.dump(nest);

        if(this instanceof NestBlock){
            const inner_block = this.innerBlock();
            if(inner_block != undefined){
                msg(`${tab(nest)}→`);
                inner_block.dump(nest + 1)
            }
        }

        const next_block = this.nextBlock();
        if(next_block != undefined){
            msg(`${tab(nest)}↓`);
            next_block.dump(nest)
        }
    }

}

/**
 * TextPortの文字列を日本語音声で読み上げるアクション。
 */
export class TTSBlock extends ActionBlock {
    /**
     * ブロックの処理に渡す値の入力ポート。
     */
    inputPort = new TextPort(this, PortType.inputPort);
    /**
     * 読み上げ処理と完了待ちを担当する音声インスタンス。
     */
    speech : Speech;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : Attr){
        super(data);
        this.ports.push(this.inputPort);

        setVoiceLanguageCode("jpn");
        this.speech = new Speech();
    }

    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize() : void {
        // const h = inputHeight + 2 * notchRadius + 4 * this.borderWidth;
        this.boxSize = new Vec2(200, 60);
    }

    /**
     * この部品の枠・内容・操作状態をキャンバスへ描く。
     */
    draw(): void {
        super.draw();
        this.drawIcon(ttsIcon);
    }

    /**
     * 入力文字列の読み上げが完了するまで待つ。
     */
    async run(){
        const text = this.inputPort.stringValue().trim();
        await this.speech.speak_waitEnd(text);
    }
}


/**
 * 入力した秒数だけ、diagram停止で取消可能な待機を行うアクション。
 */
export class SleepBlock extends ActionBlock {
    /**
     * ブロックの処理に渡す値の入力ポート。
     */
    inputPort = new NumberPort(this, PortType.inputPort);

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : Attr){
        super(data);
        this.ports.push(this.inputPort);
    }

    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize() : void {
        this.boxSize = new Vec2(200, 60);
    }

    /**
     * この部品の枠・内容・操作状態をキャンバスへ描く。
     */
    draw(): void {
        super.draw();
        this.drawIcon(sleepIcon);
    }

    /**
     * 入力値を秒からミリ秒へ変換し、停止で取消可能な待機を行う。
     */
    async run(){
        const second = this.inputPort.numberValue();
        await waitProcedure(second * 1000);
    }
}

/**
 * 実行ポートに加えてデータ入出力を持つアクション。
 */
export class TriggerGate extends ActionBlock {
    /**
     * ブロックが所有するデータ入力ポートの一覧。
     */
    inPorts  : Port[] = [ new Port(this, PortType.inputPort) ];
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
        this.ports.push(...this.inPorts, ...this.outPorts);
    }

    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize() : void {
        this.boxSize = new Vec2(200, 80);
    }
}

/**
 * 条件分岐や繰返しの内側に実行列を配置するアクションの基底。
 */
export abstract class NestBlock extends ActionBlock {
    /**
     * 条件分岐または繰返しの入れ子開始ポートを返す。
     */
    innerPort() : Port {
        if(this instanceof IfBlock){
            return this.truePort;
        }
        else if(this instanceof InfiniteLoop){
            return this.loopPort;
        }
        else{
            throw new MyError();
        }
    }

    /**
     * 入れ子の開始ポートに接続された先頭アクションを返す。
     */
    innerBlock() : ActionBlock | undefined {
        const port = this.innerPort();

        assert(port.type == PortType.bottom);

        if(port.destinations.length == 0){
            return undefined;
        }
        else{
            return port.destinations[0].parent as ActionBlock;
        }
    }

    /**
     * 入れ子内部の実行列が占める高さを合計する。
     */
    innerBlocksHeight() : number {
        let height = 0;

        for(let block = this.innerBlock(); block != undefined; ){
            const next_block = block.nextBlock();
            if(next_block == undefined){

                const [xa, ya, xb, yb] = block.borderInnerBox();
                height += yb - ya;
                break;
            }
            else{
                const [xa, ya, xb, yb] = block.drawBox();
                height += yb - ya;
                
                block = next_block;
            }
        }
        if(height != 0){
            msg(`inner blocks id:${this.idx} h:${height}`);
        }

        return height;
    }

    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize() : void {
        this.boxSize = new Vec2(200, this.calcHeight());
    }

    /**
     * ブロックの描画に必要な高さを求める。
     */
    calcHeight() : number {
        let height : number;

        if(this instanceof IfBlock){
            height = nest_h1 + nest_h2 + nest_h3 + notchRadius;
        }
        else if(this instanceof InfiniteLoop){
            height = nest_h1 + nest_h2 + nest_h3;            
        }
        else{
            throw new MyError();
        }

        msg(`height:${this.constructor.name} ${height + this.innerBlocksHeight()} = ${height} + ${this.innerBlocksHeight()}`)
        return height + this.innerBlocksHeight();
    }

    /**
     * 後続と入れ子をたどるための実行出力ポートを返す。
     */
    dependentPorts() : Port[] {
        return [ this.innerPort(), this.bottomPort ];
    }

    /**
     * ブロックの現在位置と大きさに合わせてポートを配置する。
     */
    setPortPositions(){    
        super.setPortPositions();

        const [xa, ya, xb, yb] = this.drawBox();
        const port = this.innerPort();
        port.setPortPositionXY(xa + 35 + 35, ya + nest_h1);
    }


    /**
     * 描画と当たり判定に使う矩形の一覧を返す。
     */
    drawBoxes() : [number, number, number, number][] {
        const [xa, ya, xb, yb] = this.drawBox();

        const x2 = xa + 35;

        const y2 = ya + nest_h1;
        const y3 = yb - nest_h3;

        return [ 
            [xa, ya, xb, y2],
            [xa, y2, x2, y3],
            [xa, y3, xb, yb]
         ];
    }

    /**
     * この部品の枠・内容・操作状態をキャンバスへ描く。
     */
    draw(){
        const [xa, ya, xb, yb] = this.drawBox();

        const x2 = xa + 35;

        const y2 = ya + nest_h1;
        const y3 = yb - nest_h3;

        const bottom_port = (this instanceof InfiniteLoop ? null : this.bottomPort);
        this.drawOutline([
            [xa, ya],

            [xa, yb],
            bottom_port,
            [xb, yb],

            [xb, y3],
            [x2, y3],

            [x2, y2],
            this.innerPort(),
            [xb, y2],

            [xb, ya],
            this.topPort
        ]);

        this.drawIOPorts();
    }
}

/**
 * 条件値が1のときに入れ子の実行列を開始するアクション。
 */
export class IfBlock extends NestBlock {   
    /**
     * 条件が成立したときに実行する入れ子の開始ポート。
     */
    truePort      = new Port(this, PortType.bottom);

    /**
     * 条件判定に使用する値の入力ポート。
     */
    conditionPort = new Port(this, PortType.condition);

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : Attr){
        super(data);
        this.ports = [ 
            this.topPort, 
            this.bottomPort, 
            this.truePort,
            this.conditionPort
        ];
    }

    /**
     * 条件ポートの現在値が1であるかを判定する。
     */
    isTrue() : boolean {
        return this.conditionPort.value == 1;
    }

    /**
     * 条件成立時に実行する入れ子の先頭ブロックを返す。
     */
    trueBlock() : ActionBlock | undefined {
        return this.innerBlock();
    }

    /**
     * 条件が成立し、接続先がある場合だけ入れ子の実行列を開始する。
     */
    async run(){
        const true_block = this.trueBlock();
        if(true_block != undefined && this.isTrue()){
            await runBlockChain(true_block);
        }
    }
}

/**
 * 停止要求まで入れ子の実行列を繰り返すアクション。
 */
export class InfiniteLoop extends NestBlock {
    /**
     * 繰返し本体の先頭アクションへ接続するポート。
     */
    loopPort = new Port(this, PortType.bottom);

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : Attr){
        super(data);
        this.ports = [ 
            this.topPort, 
            this.loopPort 
        ];
    }

    /**
     * 繰返し本体の先頭ブロックを返す。
     */
    loopBlock() : ActionBlock | undefined {
        return this.innerBlock();
    }

    /**
     * 本体の実行と100msの待機を繰り返し、停止要求で終了する。
     */
    async run(){
        const loop_block = this.loopBlock();
        if(loop_block != undefined){
            while(true){
                await runBlockChain(loop_block);

                if(stopFlag){
                    break;
                }

                await waitProcedure(100);
            }
        }
    }
}

/**
 * movieの再生中だけ表示レイヤーを切り替えるアクション。
 */
export class PlayMovieBlock extends ActionBlock {
    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : Attr){
        super(data);
    }
    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize() : void {
        this.boxSize = new Vec2(200, 60);
    }
    /**
     * movieの再生を待ち、終了時にdiagramのレイヤーへ戻す。
     */
    async run(){
        switchActiveModule("layer-movie");
        try {
            await playAllGraph(() => stopFlag);
        } finally {
            switchActiveModule("layer-diagram");
        }
    }
}

/**
 * 指定したゲームを表示して完了まで待つアクション。
 */
export class PlayGameBlock extends ActionBlock {
    /**
     * ブロックの処理に渡す値の入力ポート。
     */
    inputPort = new TextPort(this, PortType.inputPort);
    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : Attr){
        super(data);
        this.ports.push(this.inputPort);
    }
    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize() : void {
        this.boxSize = new Vec2(200, 60);
    }
    /**
     * 入力したゲーム名で再生を開始し、終了時にdiagramへ戻す。
     */
    async run(){
        const target = this.inputPort.stringValue().trim();
        switchActiveModule("layer-game");
        try {
            await playGameWorld(target, () => stopFlag);
        } finally {
            switchActiveModule("layer-diagram");
        }
    }
}

/**
 * 指定したWebGPUパッケージを表示して再生するアクション。
 */
export class PlayWebGPUBlock extends ActionBlock {
    /**
     * ブロックの処理に渡す値の入力ポート。
     */
    inputPort = new TextPort(this, PortType.inputPort);
    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : Attr){
        super(data);
        this.ports.push(this.inputPort);
    }
    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize() : void {
        this.boxSize = new Vec2(200, 60);
    }
    /**
     * 入力したパッケージ名でWebGPUを再生し、終了時にdiagramへ戻す。
     */
    async run(){
        const pkgName = this.inputPort.stringValue().trim();
        switchActiveModule("layer-webgpu");
        try {
            await playWebGPUPackage(pkgName);
        } finally {
            switchActiveModule("layer-diagram");
        }
    }
}

/** 外部ActionBlockはここへ登録し、procedure.tsから派生モジュールへの循環importを避ける。 */
const actionBlockFactories = new Map<string, () => ActionBlock>();

/**
 * 派生モジュールのアクションを型名と生成関数で登録する。
 */
export function registerActionBlock(typeName: string, factory: () => ActionBlock): void {
    actionBlockFactories.set(typeName, factory);
}

/**
 * 登録表または組込み型名からアクションを作る。未知の型はundefined。
 */
export function makeActionBlockByTypeName(typeName : string) : ActionBlock | undefined {
    const factory = actionBlockFactories.get(typeName);
    if (factory !== undefined) {
        return factory();
    }
    switch(typeName){

    case IfBlock.name:                       return new IfBlock({});
    case InfiniteLoop.name:                  return new InfiniteLoop({});
    case TTSBlock.name:                      return new TTSBlock({});
    case SleepBlock.name:                    return new SleepBlock({});
    case TriggerGate.name:                   return new TriggerGate({});
    case PlayMovieBlock.name:                return new PlayMovieBlock({});
    case PlayGameBlock.name:                 return new PlayGameBlock({});
    case PlayWebGPUBlock.name:               return new PlayWebGPUBlock({});
    }
}

/**
 * 機能ブロックとアクションの型名を順に照合し、復元用のブロックを作る。
 */
export function makeBlockByTypeName(typeName : string) : Block {
    let block: Block | undefined = makeFunctionBlockByTypeName(typeName);
    if(block == undefined){
        block = makeActionBlockByTypeName(typeName);
        if(block == undefined){
            throw new MyError();
        }
    }

    return block;
}
