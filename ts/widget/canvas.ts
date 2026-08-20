///<reference path="core.ts" />

import { AbstractUI, assert, getDocumentSize, msg, range, remove, Vec2 } from "@i18n";
import { AbstractCanvas } from "@plane";
import { Sequencer } from "../action/sequencer";
import { drawIsometric } from "../isometric/isometric";
import { UI, targetUI, setTargetUI, worldCanvas } from "./core";
import { ImageUI } from "./image";
import { inputByNumpad } from "./input";
import { PopupMenu, showPopupMenu } from "./menu";
import { Thumb } from "./slider";
import { Label, TextUI } from "./text";
import { ContainerUI } from "./container";
import { selectTerms } from "../math/equation/equation";

let animationFrameId : number | null = null;

function isTransparent(ctx : CanvasRenderingContext2D, position : Vec2) {
    try {
        // 1x1ピクセルの領域のImageDataを取得
        const imageData = ctx.getImageData(position.x, position.y, 1, 1);
        
        // data配列のインデックス3（4番目）がAlpha値 (0-255)
        // Alpha値が0であれば完全に透明
        return imageData.data[3] === 0;

    } catch (e) {
        // セキュリティ制限 (Tainted Canvas) などでエラーが発生した場合の処理
        console.error("getImageData エラー:", e);
        return false; // またはエラー処理に応じた値を返す
    }
}

function includedRight(ui: UI, x:number) : boolean {
    return  ui.getRightUI() - AbstractUI.nearMargin <= x;
}

function getSelectedUIs(startSelectText : TextUI, pos: Vec2) : TextUI[]{
    let selectedUI : UI | undefined;

    for(let ui : TextUI | ContainerUI | undefined = startSelectText; ui != undefined && ui.parent != undefined; ui = ui.parent){
        if(! includedRight(ui, pos.x)){
            break;
        }

        selectedUI = ui;

        const uiIdx = ui.getChildIdx();
        if(uiIdx == 0 && includedRight(ui.parent.lastUI(), pos.x)){

            selectedUI = ui.parent;
            msg(`select all:${ui.parent}`)
            continue;
        }

        const middles = ui.parent.children.slice(uiIdx).filter(x => includedRight(x, pos.x));
        assert(middles.length != 0);

        const middleTextUIs = middles.map(x => x.getAllUI()).flat().filter(x => x instanceof TextUI);
        return middleTextUIs;
    }

    if(selectedUI == undefined){
        return [];
    }
    else{
        return selectedUI.getAllUI().filter(x => x instanceof TextUI);
    }
}

export class Canvas extends AbstractCanvas {
    isReady : boolean = false;

    private uis: UI[] = [];
    private allUIs:UI[] = [];
    private startSelectText?: TextUI;
    
    selectedUIs : UI[] = [];

    isIsometric : boolean = false;

    constructor(canvas_html : HTMLCanvasElement){
        super(canvas_html);
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width  = rect.width;
        this.canvas.height = rect.height;

        this.canvas.addEventListener("contextmenu", this.contextmenu.bind(this));
        this.canvas.addEventListener('keydown', this.keydown.bind(this));

        msg(`canvas w:${canvas_html.width} h:${canvas_html.height}`);
    }

    clearCanvas() : void {
        this.uis = [];
    }

    getUIs() : UI[] {
        return this.uis.slice();
    }

    getUIMenus() : UI[]{
        const ui_menus = this.uis.slice();
        if(PopupMenu.one != undefined && PopupMenu.one.canvas == this){
            ui_menus.push(PopupMenu.one);
        }

        return ui_menus;
    }

    addUI(ui : UI){
        this.uis.push(ui);
    }

    removeUIs(...uis : UI[]){
        uis.slice().forEach(x => remove(this.uis, x))
    }

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

    getUIFromPosition(pos : Vec2) : UI | undefined {
        for(const ui of this.getUIMenus().reverse()){
            const near_ui = ui.getNearUI(pos);
            if(near_ui != undefined){
                if(near_ui instanceof ImageUI){
                    if(isTransparent(this.ctx, pos)){
                        return near_ui.parent;
                    }
                }
                return near_ui;
            }
        }

        return undefined;
    }

    dragTarget(target : UI) : void {
        const diff = this.movePos.sub(this.downPos);
        const ui_new_pos = this.uiOrgPos.add(diff);
        target.setPosition(ui_new_pos);
    }

    equationDown(pos:Vec2){        
        this.selectedUIs = [];

        this.startSelectText = this.allUIs.find(ui => ui.parent != undefined && ui instanceof TextUI && ui.nearLeft(pos)) as TextUI;
        if(this.startSelectText != undefined){
            msg(  `left:${this.startSelectText}`);
            this.canvas.style.cursor = "default";
        }
        else{
            this.canvas.style.cursor = "text";
        }

        this.requestUpdateCanvas();
    }

    equationMove(pos:Vec2){        
        this.canvas.style.cursor = "default";
        const nearLeftRight = this.allUIs.find(ui => ui instanceof TextUI && ui.nearLeftRight(pos));
        if(nearLeftRight != undefined){
            msg(`left-right:${nearLeftRight}`);

            this.canvas.style.cursor = "text";
        }

        if(this.startSelectText != undefined){
            this.selectedUIs = getSelectedUIs(this.startSelectText, pos);
            if(this.selectedUIs.length != 0){
                // msg("selected:" + this.selectedUIs.map(x => `${x}`).join(" "));
            }
        }

        this.requestUpdateCanvas();
    }

    equationUp(){        
        this.canvas.style.cursor = "default";
        this.startSelectText = undefined;
        if(this.selectedUIs.length != 0){
            selectTerms(this.selectedUIs);
        }

        this.requestUpdateCanvas();
    }

    pointerdown(ev:PointerEvent) : void {
        this.moved = false;
        const pos = this.getPositionInCanvas(ev);

        this.equationDown(pos);
        if(this.startSelectText != undefined){
            return;
        }

        const target = this.getUIFromPosition(pos);
        if(target != undefined){
            // msg(`down:${target.constructor.name}`);
            this.downPos   = pos;
            this.movePos   = pos;
            setTargetUI(target);

            this.uiOrgPos  = target.position.copy();
            this.pointerId = ev.pointerId;

            this.canvas.setPointerCapture(this.pointerId);
            this.canvas.classList.add('dragging');
        }
    }

    pointermove(ev:PointerEvent) : void {
        const pos = this.getPositionInCanvas(ev);
        this.equationMove(pos);

        if(targetUI == undefined || !(targetUI instanceof Thumb)){
            return;
        }

        this.moved = true;

        const target = this.getUIFromPosition(pos);
        const s = (target == undefined ? "" : `target:[${target}]`);

        this.movePos = pos;

        this.dragTarget(targetUI);

        this.requestUpdateCanvas();
    }

    setAllUIs(){
        const all_uis = this.uis.map(x => x.getAllUI()).flat()
        this.allUIs = [];
        this.uis.forEach(x => x.getAllUIsub(this.allUIs));
        assert(all_uis.length == this.allUIs.length);
        assert(range(all_uis.length).every(i => all_uis[i] == this.allUIs[i]));
        this.allUIs.forEach(x => x.canvas = this);
    }

    layoutCanvas(){
        this.setAllUIs();

        for(const root of this.uis){
            root.setMinSize();
            root.layout(root.position, getDocumentSize());
        }

        this.requestUpdateCanvas();
    }

    requestUpdateCanvas(){
        if (this.isReady && animationFrameId == null) {

            animationFrameId = requestAnimationFrame(()=>{
                animationFrameId = null;
                this.repaint();

                Sequencer.nextAction();
            });

        }        
    }

    async pointerup(ev:PointerEvent) : Promise<void> {
        this.equationUp();

        if(targetUI == undefined){
            return;
        }
        const target = targetUI;
        PopupMenu.close();


        if(this.moved){
            msg("dragged");
        }
        else{
            if(target instanceof Label && target.parent != undefined && target.parent.name == "numpad"){
                inputByNumpad(target);
            }
            else{

                const name = target.name;

                msg(`click:${target.idx} ${target.constructor.name} ${name == undefined ? "" : name} ${target.parent} pos:${target.position} size:${target.netSize} ${target}`);


                await target.click();
            }
        }

        if (this.canvas.hasPointerCapture(this.pointerId)){
            this.canvas.releasePointerCapture(this.pointerId);
        }
        this.canvas.classList.remove('dragging');

        setTargetUI(undefined);
        this.pointerId = NaN;

        this.requestUpdateCanvas();

        this.moved = false;
    }

    contextmenu(event : MouseEvent){
        msg("context menu");
        // 1. デフォルトの右クリックメニューを禁止
        event.preventDefault();

        // 2. Canvas内での相対座標を計算
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        showPopupMenu(this, x, y);
    }

    keydown(ev: KeyboardEvent){
        // 特定のキーを判定
        switch (ev.key) {
        case 'Escape':
            msg('Escキーが押されました');
            PopupMenu.close();
            this.requestUpdateCanvas();
            break;

        case 'Enter':
            msg('Enterキーが押されました');
            // 確定処理など
            break;

        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight':
            msg(`${ev.key} が押されました`);
            // 矩形の移動処理など
            ev.preventDefault(); // 矢印キーによる画面スクロールを防止
            break;
        }
    }

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
            this.ctx.font = `${UI.fontSize} ${UI.fontFamily}`;
            this.ctx.fillStyle = 'white';
            this.ctx.fillText('Hello Canvas!', this.canvas.width / 2 - 100, this.canvas.height / 2);
        }

        this.requestUpdateCanvas();
    }

    repaint() : void {
        if(this.isIsometric){
            this.ctx.save();
            this.ctx.fillStyle = "darkslategray"; // "DarkBlue"; DarkSlateBlue Teal  // "";    // "DeepSkyBlue"; //skyblue
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);        
            this.ctx.restore();

            drawIsometric(this.ctx);
        }
        else{
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);        
        }

        this.getUIMenus().forEach(ui => ui.drawTop(this.ctx));
    }

    drawCircle(pos : Vec2, radius : number, color : string){
        // パスの開始
        this.ctx.beginPath();

        // 円の定義: arc(x, y, radius, startAngle, endAngle)
        // Math.PI * 2 は 360度（一周）を意味します
        this.ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);

        // 線の色と塗りつぶしの色の設定
        this.ctx.fillStyle = color;
        this.ctx.fill(); // 塗りつぶし
        // this.ctx.strokeStyle = "blue";
        // this.ctx.stroke(); // 輪郭線
    }

    drawLine(start : Vec2, end : Vec2, color : string, lineWidth : number = 2){
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth   = lineWidth;

        this.ctx.beginPath();
        this.ctx.moveTo(start.x, start.y);
        this.ctx.lineTo(end.x, end.y);

        this.ctx.stroke();
    }

    drawPolyLines(points : Vec2[], color : string, lineWidth : number = 2, closePath : boolean = false, lineCap? : boolean){
        this.ctx.save();

        this.ctx.strokeStyle = color;
        this.ctx.lineWidth   = lineWidth;
        if(lineCap != undefined){
            this.ctx.lineCap = "round";
        }

        this.ctx.beginPath();

        for(const [idx, pt] of points.entries()){
            if(idx == 0){
                this.ctx.moveTo(pt.x, pt.y);
            }
            else{
                this.ctx.lineTo(pt.x, pt.y);
            }
        }

        if(closePath){
            this.ctx.closePath();
        }

        this.ctx.stroke();
        this.ctx.restore();
    }

    drawPolygon(points : Vec2[], color : string, lineWidth : number = 2){
        this.drawPolyLines(points, color, lineWidth, true);
    }
}
