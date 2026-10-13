import { assert, msg, MyError, range, Vec2 } from "@i18n";
import { AbstractCanvas } from "@plane";
import { Button, textColor, UI } from "./ui";
import { Block, InputRangeBlock } from "./block";
import { ActionBlock, NestBlock } from "./procedure";
import { Port } from "./port";
import { incRepaintCount, PortType, setCanvas, theCanvas } from "./diagram_util";
import { setEditor, theEditor } from "./json-util";
import { BlockClassCount, geBlockName, makeBlock } from "./index"

let animationFrameId : number | null = null;

export function allActions() : ActionBlock[] {
    return theEditor.blocks.filter(x => x instanceof ActionBlock);
}

export function allDependentPorts() : Port[] {
    const action_blocks = allActions();
    return action_blocks.map(x => x.dependentPorts()).flat();
}

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

function dumpActions(){
    getTopActions().forEach(x => x.dump(0));
}

export class Canvas extends AbstractCanvas {
    draggedUI? : ToolItem | Block | Port | Button;
    prevPortOfDraggedUI : Port | undefined;
    private pressedButton?: Button;
    private buttonCancelled = false;
    private buttonDownClient = Vec2.zero();

    constructor(canvas_html : HTMLCanvasElement){
        super(canvas_html);
        setCanvas(this);

        theEditor.setContext2D(this.ctx);
        this.canvas.style.touchAction = "none";
        this.canvas.addEventListener("pointercancel", () => this.resetPointer(), { signal: this.eventSignal });
        this.canvas.addEventListener("lostpointercapture", () => this.resetPointer(), { signal: this.eventSignal });
    }

    clearCanvas() : void {
        throw new MyError("not implemented");
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

    pointerdown(ev:PointerEvent) : void {
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

    pointermove(ev:PointerEvent) : void {
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

    requestUpdateCanvas(){
        if (!this.disposed && animationFrameId == null) {

            animationFrameId = requestAnimationFrame(()=>{
                animationFrameId = null;
                this.repaint();
            });

        }        
    }

    override dispose(): void {
        this.resetPointer();
        super.dispose();
        if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

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

    private resetPointer(): void {
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

    drawLine(start : Vec2, end : Vec2, color : string, lineWidth : number = 2){
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth   = lineWidth;

        this.ctx.beginPath();
        this.ctx.moveTo(start.x, start.y);
        this.ctx.lineTo(end.x, end.y);

        this.ctx.stroke();
    }
}

class ToolItem extends UI {
    toolIdx : number;

    constructor(idx : number){
        super({});
        this.toolIdx = idx;
        this.boxSize = new Vec2(32, 32);
    }

    draw(){
        super.draw();
        const [xa, ya, xb, yb] = this.marginBox();

        this.ctx.save();
        this.ctx.textBaseline = "top";
        this.ctx.font = "20px serif";
        this.ctx.strokeStyle = textColor;
        this.ctx.strokeText(geBlockName(this.toolIdx), xa, ya);
        this.ctx.restore();
    }

    drawDraggedTool(move_pos : Vec2){       
        let [xa, ya, xb, yb] = this.marginBox();

        const w = xb - xa;
        const h = yb - ya;

        xa = move_pos.x;
        ya = move_pos.y;
        this.drawRidgeRect(this.ctx, xa, ya, w, h, this.borderWidth);
    }
}

export class Editor {
    tools  : ToolItem[];
    blocks : Block[] = [];

    constructor(){
        setEditor(this);

        this.tools = range(BlockClassCount).map(x => new ToolItem(x));

        let x = 10;
        let y = 60;
        for(const tool of this.tools){
            tool.setPosition(new Vec2(x, y));

            y += tool.boxSize!.y + 2;
        }
    }

    allToolBlocks() : UI[] {
        return (this.tools as UI[]).concat(this.blocks);
    }

    clearBlock() : void {        
        this.blocks.forEach(x => x.clearBlock());
        this.blocks = [];
    }

    addBlock(block : Block){
        this.blocks.push(block);
        if (theCanvas) block.setContext2D(theCanvas.ctx);
    }

    setContext2D(ctx : CanvasRenderingContext2D){
        this.allToolBlocks().forEach(x => x.setContext2D(ctx));
    }

    setNestBoxSize() : void {
        const top_nest_actions = getTopActions().filter(x => x instanceof NestBlock);
        for(const top_action of top_nest_actions){
            const nest_blocks = Array.from(top_action.dependantActions()).filter(x => x instanceof NestBlock);
            for(const block of nest_blocks){
                block.setBoxSize();
            }
        }
    }

    layoutRoot(){
        theEditor.setNestBoxSize();
        const top_actions = getTopActions();
        top_actions.forEach(x => x.adjustActionPosition(x.position));
    }

    draw(){
        this.tools.forEach(x => x.draw());
        this.blocks.forEach(x => x.draw());
    }

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
