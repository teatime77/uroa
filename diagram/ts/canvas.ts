/**
 * diagramのキャンバス操作・再描画とブロックの配置・選択を管理する。ブロックはblock.tsとprocedure.ts、保存対象の編集器参照はjson-util.tsで共有する。
 */
import { assert, msg, MyError, range, Vec2 } from "@i18n";
import { AbstractCanvas } from "@plane";
import { Button, textColor, UI } from "./ui";
import { Block, InputRangeBlock } from "./block";
import { ActionBlock, NestBlock } from "./procedure";
import { Port } from "./port";
import { incRepaintCount, PortType, setCanvas, theCanvas } from "./diagram_util";
import { setEditor, theEditor } from "./json-util";
import { BlockClassCount, geBlockName, makeBlock, stopDiagram } from "./index"

/**
 * 重複する再描画要求をまとめるrequestAnimationFrameの予約ID。
 */
let animationFrameId : number | null = null;

/**
 * 編集器に配置されたアクションブロックだけを集める。
 */
export function allActions() : ActionBlock[] {
    return theEditor.blocks.filter(x => x instanceof ActionBlock);
}

/**
 * 全アクションの依存先となる実行ポートを集める。
 */
export function allDependentPorts() : Port[] {
    const action_blocks = allActions();
    return action_blocks.map(x => x.dependentPorts()).flat();
}

/**
 * 上側の実行ポートに接続元がない実行列の先頭を集める。
 */
export function getTopActions() : ActionBlock[] {
    const action_blocks = allActions();

    const top_blocks : ActionBlock[] = [];
    for(const block of action_blocks){
        const top_port = block.ports.find(x => x.type == PortType.top)!;
        assert(top_port != undefined);
        if(top_port.sources.length == 0){
            top_blocks.push(block);
        }
    }

    return top_blocks;
}

/**
 * 各実行列の先頭から接続状態を診断出力する。
 */
function dumpActions(){
    getTopActions().forEach(x => x.dump(0));
}

/**
 * diagramのポインター操作と再描画を管理するキャンバス。
 */
export class Canvas extends AbstractCanvas {
    /**
     * 現在ドラッグしているツール・ブロック・ポート等の参照。
     */
    draggedUI? : ToolItem | Block | Port | Button;
    /**
     * ドラッグ中のアクションの上側へ接続できる候補ポート。
     */
    prevPortOfDraggedUI : Port | undefined;
    /**
     * クリック確定を待っている押下中のボタン。
     */
    private pressedButton?: Button;
    /**
     * 許容距離を超える移動等でボタンクリックを取り消した状態。
     */
    private buttonCancelled = false;
    /**
     * ボタン押下開始時のクライアント座標。移動量の判定に使う。
     */
    private buttonDownClient = Vec2.zero();

    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(canvas_html : HTMLCanvasElement){
        super(canvas_html);
        setCanvas(this);

        theEditor.setContext2D(this.ctx);
        this.canvas.style.touchAction = "none";
        this.canvas.addEventListener("pointercancel", () => this.resetPointer(), { signal: this.eventSignal });
        this.canvas.addEventListener("lostpointercapture", () => this.resetPointer(), { signal: this.eventSignal });
        this.canvas.addEventListener("pointerleave", () => this.canvas.removeAttribute("title"), { signal: this.eventSignal });
    }

    /**
     * 基底クラスの消去入口。diagram側では未実装として例外を投げる。
     */
    clearCanvas() : void {
        throw new MyError("not implemented");
    }

    /**
     * CSS表示倍率を補正し、クライアント座標をキャンバス座標へ変換する。
     *
     * @param event ブラウザーまたは通信元のイベント。
     */
    getPositionInCanvas(event : MouseEvent) : Vec2 {
        // Get the bounding rectangle of the canvas
        const rect = this.canvas.getBoundingClientRect();

        // Calculate the scaling factors if the canvas is styled differently from its internal resolution
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;

        // Calculate the canvas coordinates
        const canvasX = (event.clientX - rect.left) * scaleX;
        const canvasY = (event.clientY - rect.top) * scaleY;

        return new Vec2(canvasX, canvasY);
        // Now you have the canvas coordinates!
        // console.log(`Canvas X: ${canvasX}, Canvas Y: ${canvasY}`);
    }

    /**
     * 主ボタンの押下を受け、UIの選択・ドラッグ・ボタン操作を開始する。
     *
     * @param ev 操作を開始したブラウザーイベント。
     */
    pointerdown(ev:PointerEvent) : void {
        this.canvas.removeAttribute("title");
        if (ev.button !== 0 || this.draggedUI || this.pressedButton) return;
        this.moved = false;
        this.prevPortOfDraggedUI = undefined;

        const pos = this.getPositionInCanvas(ev);
        const target = theEditor.getPortBlockFromPosition(pos);
        if (target instanceof Button) {
            if (target.disabled) return;
            this.pressedButton = target;
            this.buttonCancelled = false;
            this.buttonDownClient = new Vec2(ev.clientX, ev.clientY);
            target.pressed = true;
            this.pointerId = ev.pointerId;
            this.canvas.setPointerCapture(ev.pointerId);
            this.requestUpdateCanvas();
            return;
        }
        if(target != undefined){
            msg(`down:${target.constructor.name}`);
            this.downPos   = pos;
            this.movePos   = pos;

            if(target instanceof Block){
                if(target instanceof InputRangeBlock){
                    msg(`range: box${target.boxSize.x.toFixed()} out:${target.boxSize!.x}`);
                }

                if(target.inToolbox){

                    const block = target.copy();
                    theEditor.addBlock(block);

                    this.draggedUI = block
                }
                else{

                    this.draggedUI = target;
                }
            }
            else if(target instanceof Port){

                msg(`down port:${target.str()}`);
                this.draggedUI = target;
            }
            else if(target instanceof ToolItem){

                msg(`down tool item:${target.str()}`);
                this.draggedUI = target;
            }
            else{
                return;
            }


            this.uiOrgPos  = this.draggedUI.getPosition().copy();
            this.pointerId = ev.pointerId;

            this.canvas.setPointerCapture(this.pointerId);
            this.canvas.classList.add('dragging');
        }
    }

    /**
     * ドラッグ差分でブロックを動かし、アクションの実行列を追従させる。
     */
    dragBlock(block : Block) : void {
        const diff = this.movePos.sub(this.downPos);
        const dragged_block_pos = this.uiOrgPos.add(diff);
        if(block instanceof ActionBlock){
            block.adjustActionPosition(dragged_block_pos);
        }
        else{
            block.setBlockPortPosition( dragged_block_pos );
        }
    }

    /**
     * ドラッグ位置・接続候補・押下取消とツールのツールチップを更新する。
     *
     * @param ev 操作を開始したブラウザーイベント。
     */
    pointermove(ev:PointerEvent) : void {
        if (ev.pointerType === "mouse" && !this.draggedUI && !this.pressedButton) {
            const target = theEditor.getPortBlockFromPosition(this.getPositionInCanvas(ev));
            const title = target instanceof ToolItem ? geBlockName(target.toolIdx) : "";
            if (this.canvas.title !== title) this.canvas.title = title;
        } else {
            this.canvas.removeAttribute("title");
        }
        if (this.pressedButton) {
            if (ev.pointerId !== this.pointerId) return;
            if (this.buttonDownClient.distance(new Vec2(ev.clientX, ev.clientY)) > 8) this.buttonCancelled = true;
            this.pressedButton.pressed = !this.buttonCancelled && this.pressedButton.inMarginBox(this.getPositionInCanvas(ev));
            this.requestUpdateCanvas();
            return;
        }
        this.moved = true;

        if(this.draggedUI == undefined){
            return;
        }

        const pos = this.getPositionInCanvas(ev);
        const target = theEditor.getPortBlockFromPosition(pos);
        const s = (target == undefined ? "" : `target:[${target.str()}]`);

        this.movePos = pos;


        if(this.draggedUI instanceof Block){

            this.dragBlock(this.draggedUI);

            if(this.draggedUI instanceof ActionBlock){

                this.prevPortOfDraggedUI = this.draggedUI.checkTopPortConnection();
            }
        }

        this.requestUpdateCanvas();
    }

    /**
     * 再描画を次のアニメーションフレームへ一度だけ予約する。
     */
    requestUpdateCanvas(){
        if (!this.disposed && animationFrameId == null) {

            animationFrameId = requestAnimationFrame(()=>{
                animationFrameId = null;
                this.repaint();
            });

        }        
    }

    /**
     * イベント・描画予約など、この部品が所有する資源を解放する。
     */
    override dispose(): void {
        this.resetPointer();
        theEditor.tools.forEach(tool => tool.dispose());
        super.dispose();
        if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    /**
     * ポインター所有権を解放し、接続・ツール追加またはボタン操作を確定する。
     *
     * @param ev 操作を開始したブラウザーイベント。
     */
    async pointerup(ev:PointerEvent) : Promise<void> {
        if (this.pressedButton) {
            if (ev.pointerId !== this.pointerId) return;
            const button = this.pressedButton;
            const activate = !this.buttonCancelled && !button.disabled && button.inMarginBox(this.getPositionInCanvas(ev))
                && theEditor.blocks.some(block => block.children().includes(button));
            // Release the pointer before asynchronous work, while retaining this user gesture.
            this.resetPointer();
            if (activate) {
                try { await button.click(); }
                catch (error) { console.error("diagram button failed", error); }
            }
            return;
        }
        if(this.draggedUI == undefined){
            return;
        }

        const pos = this.getPositionInCanvas(ev);
        const target = theEditor.getPortBlockFromPosition(pos);

        if(this.moved){
            msg("dragged");
            if(this.draggedUI instanceof Port && target instanceof Port){
                if (this.draggedUI.fitPortType(target)) this.draggedUI.connect(target);
            }
            else if(this.draggedUI instanceof Block){
                this.dragBlock(this.draggedUI);

                if(this.draggedUI instanceof ActionBlock){

                    this.prevPortOfDraggedUI = this.draggedUI.checkTopPortConnection();

                    const top_port  = this.draggedUI.topPort;
                    const prev_port = this.draggedUI.prevPort();
                    if(prev_port != this.prevPortOfDraggedUI){
                        if(prev_port != undefined){
                            prev_port.disconnect(top_port);
                        }

                        if(this.prevPortOfDraggedUI != undefined){
                            this.prevPortOfDraggedUI.connect(top_port);
                        }

                        theEditor.layoutRoot();
                    }
                }
            }
            else if(this.draggedUI instanceof ToolItem){
                const block = makeBlock(this.draggedUI.toolIdx);
                block.setBoxSize();
                if(block instanceof ActionBlock){
                    block.adjustActionPosition(pos);
                }
                else{
                    block.setBlockPortPosition(pos );
                }

                theEditor.addBlock(block);
            }
        }
        else{
            msg(`click:${this.draggedUI.constructor.name}`);

            if(this.draggedUI instanceof Button){
                await this.draggedUI.click();
            }
        }

        this.canvas.releasePointerCapture(this.pointerId);
        this.canvas.classList.remove('dragging');

        this.draggedUI = undefined;
        this.prevPortOfDraggedUI = undefined;
        this.pointerId = NaN;

        this.requestUpdateCanvas();

        this.moved = false;

        dumpActions();
    }

    /**
     * ポインターの捕捉とドラッグ・押下状態を解除する。
     */
    private resetPointer(): void {
        this.canvas.removeAttribute("title");
        if (this.pressedButton) this.pressedButton.pressed = false;
        const pointerId = this.pointerId;
        this.pressedButton = undefined;
        this.draggedUI = undefined;
        this.prevPortOfDraggedUI = undefined;
        this.pointerId = NaN;
        this.moved = false;
        if (Number.isFinite(pointerId) && this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
        this.canvas.classList.remove("dragging");
        this.requestUpdateCanvas();
    }

    /**
     * 表示領域に合わせてキャンバスサイズと部品の配置を更新する。
     */
    resizeCanvas() : void {
        // Set the canvas's internal drawing dimensions to match its display size
        // window.innerWidth/Height give the viewport dimensions.
        this.canvas.width  = window.innerWidth;
        this.canvas.height = window.innerHeight;

        // If you're drawing something, you might want to redraw it here
        if (this.ctx) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); // Clear the canvas
            // Example drawing
            this.ctx.fillStyle = 'blue';
            this.ctx.fillRect(50, 50, 100, 100);
            this.ctx.font = '30px Arial';
            this.ctx.fillStyle = 'white';
            this.ctx.fillText('Hello Canvas!', this.canvas.width / 2 - 100, this.canvas.height / 2);
        }

        theEditor.layoutRoot();

        this.requestUpdateCanvas();
    }

    /**
     * 背景・編集ブロック・ツールとドラッグ中の仮表示を描き直す。
     */
    repaint() : void {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);        
        theEditor.draw();
        if(this.draggedUI instanceof Port){
            this.draggedUI.drawDraggedPort(this.movePos);
        }
        else if(this.draggedUI instanceof ToolItem){
            this.draggedUI.drawDraggedTool(this.movePos);
        }

        incRepaintCount();
    }

    /**
     * 指定した端点・色・太さでキャンバスへ線を描く。
     */
    drawLine(start : Vec2, end : Vec2, color : string, lineWidth : number = 2){
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth   = lineWidth;

        this.ctx.beginPath();
        this.ctx.moveTo(start.x, start.y);
        this.ctx.lineTo(end.x, end.y);

        this.ctx.stroke();
    }
}

/**
 * 実ブロックを生成せずにアイコンで表示するツール項目。
 */
class ToolItem extends UI {
    /**
     * makeBlock()/geBlockName()と対応するツールの固定番号。
     */
    toolIdx : number;
    /**
     * ツールのSVG画像を読み込む所有Image。破棄時にイベントを解除する。
     */
    private readonly icon = new Image();

    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(idx : number){
        super({});
        this.toolIdx = idx;
        this.boxSize = new Vec2(32, 32);
        // The SVG includes its own border. Match the image and hit area exactly.
        this.margin = [0, 0, 0, 0];
        this.borderWidth = 0;
        this.icon.onload = this.icon.onerror = () => theCanvas?.requestUpdateCanvas();
        this.icon.src = `/diagram/images/toolbox/${geBlockName(idx)}.svg`;
    }

    /**
     * この部品の枠・内容・操作状態をキャンバスへ描く。
     */
    draw(){
        this.drawIcon(this.position.x, this.position.y);
    }

    /**
     * この部品の表示領域へアイコンを描く。
     */
    private drawIcon(x: number, y: number): void {
        this.ctx.save();
        if (this.icon.complete && this.icon.naturalWidth > 0) {
            this.ctx.drawImage(this.icon, x, y, this.boxSize.x, this.boxSize.y);
        } else {
            this.ctx.fillStyle = "white";
            this.ctx.fillRect(x, y, this.boxSize.x, this.boxSize.y);
            this.ctx.fillStyle = textColor;
            this.ctx.font = "bold 18px sans-serif";
            this.ctx.textAlign = "center";
            this.ctx.textBaseline = "middle";
            this.ctx.fillText("?", x + this.boxSize.x / 2, y + this.boxSize.y / 2);
        }
        this.ctx.restore();
    }

    /**
     * ドラッグ中のツールの仮表示を指定座標へ描く。
     */
    drawDraggedTool(move_pos : Vec2){
        this.drawIcon(move_pos.x, move_pos.y);
    }

    /**
     * イベント・描画予約など、この部品が所有する資源を解放する。
     */
    dispose(): void {
        this.icon.onload = this.icon.onerror = null;
    }
}

/**
 * ツール一覧と配置済みブロックを所有し、配置・描画・探索をまとめる編集器。
 */
export class Editor {
    /**
     * ツールボックスに表示する軽量なToolItemの一覧。
     */
    tools  : ToolItem[];
    /**
     * 編集・保存・実行対象として配置されたブロックの一覧。
     */
    blocks : Block[] = [];

    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(){
        setEditor(this);

        this.tools = range(BlockClassCount).map(x => new ToolItem(x));
        // PIDをIMUの直後へ置き、画面上部から配置できるようにする。
        const pidIndex = this.tools.findIndex(tool => geBlockName(tool.toolIdx) === "PIDBlock");
        if (pidIndex >= 0) {
            this.tools.splice(2, 0, this.tools.splice(pidIndex, 1)[0]);
        }
        // Keep AI tools visible without depending on the last type index.
        for (const [offset, name] of ["AIChatBlock", "SpeechRecognitionBlock", "ObjectDetectionBlock", "ImageCaptionBlock"].entries()) {
            const idx = this.tools.findIndex(tool => geBlockName(tool.toolIdx) === name);
            if (idx >= 0) this.tools.splice(3 + offset, 0, this.tools.splice(idx, 1)[0]);
        }

        // 左端のツールは既存の順序で左から右、上から下へ2列に配置する。
        // 32×32のアイコン間に縦横2pxの間隔を置き、描画とヒット判定で同じ座標を使う。
        const columnCount = 2;
        for (const [index, tool] of this.tools.entries()) {
            const column = index % columnCount;
            const row = Math.floor(index / columnCount);
            const x = 10 + column * (tool.boxSize.x + 2);
            const y = 60 + row * (tool.boxSize.y + 2);
            tool.setPosition(new Vec2(x, y));
        }
    }

    /**
     * ツールと配置済みブロックを描画・当たり判定用の一覧へまとめる。
     */
    allToolBlocks() : UI[] {
        return (this.tools as UI[]).concat(this.blocks);
    }

    /**
     * 接続・イベント・所有資源を解放してブロックを削除可能にする。
     */
    clearBlock() : void {        
        stopDiagram();
        this.blocks.forEach(x => x.clearBlock());
        this.blocks = [];
        theCanvas?.requestUpdateCanvas();
    }

    /**
     * ブロックを編集対象へ追加し、描画コンテキストを接続する。
     */
    addBlock(block : Block){
        this.blocks.push(block);
        if (theCanvas) block.setContext2D(theCanvas.ctx);
    }

    /**
     * 描画コンテキストを設定し、子要素にも共有する。
     *
     * @param ctx 描画先の2Dコンテキスト。
     */
    setContext2D(ctx : CanvasRenderingContext2D){
        this.allToolBlocks().forEach(x => x.setContext2D(ctx));
    }

    /**
     * 入れ子の依存関係をたどって各ブロックの必要サイズを更新する。
     */
    setNestBoxSize() : void {
        const top_nest_actions = getTopActions().filter(x => x instanceof NestBlock);
        for(const top_action of top_nest_actions){
            const nest_blocks = Array.from(top_action.dependantActions()).filter(x => x instanceof NestBlock);
            for(const block of nest_blocks){
                block.setBoxSize();
            }
        }
    }

    /**
     * 実行列の先頭を基準として、接続されたアクションの位置をそろえる。
     */
    layoutRoot(){
        theEditor.setNestBoxSize();
        const top_actions = getTopActions();
        top_actions.forEach(x => x.adjustActionPosition(x.position));
    }

    /**
     * この部品の枠・内容・操作状態をキャンバスへ描く。
     */
    draw(){
        this.tools.forEach(x => x.draw());
        this.blocks.forEach(x => x.draw());
    }

    /**
     * 座標に重なるボタン・ポート・ブロック・ツールを探す。
     */
    getPortBlockFromPosition(pos : Vec2) : ToolItem | Port | Button | Block | undefined {
        const blocks = this.allToolBlocks().filter(x => x.inMarginBox(pos)).reverse();
        for(const block of blocks){
            if(block instanceof ToolItem){
                if(block.inDrawBox(pos)){
                    return block;
                }
            }
            else if(block instanceof Block){

                const port = block.ports.find(x => x.isNear(pos));
                if(port != undefined){
                    return port;
                }
                if (!block.inToolbox) {
                    const button = block.children().find(child => child instanceof Button && child.inMarginBox(pos));
                    if (button instanceof Button) return button;
                }
                if(block.inDrawBoxes(pos)){
                    return block;
                }
            }
            else{
                throw new MyError();
            }
        }

        return undefined;
    }
}
