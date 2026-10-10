import { assert, msg, MyError, Vec2 } from "@i18n";
import { AbstractCanvas } from "@plane";
import { Button } from "./ui";
import { Block, InputRangeBlock } from "./block";
import { ActionBlock, NestBlock } from "./procedure";
import { Port } from "./port";
import { incRepaintCount, PortType, setCanvas, theCanvas } from "./diagram_util";
import { setEditor, theEditor } from "./json-util";

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
    draggedUI? : Block | Port | Button;
    prevPortOfDraggedUI : Port | undefined;

    constructor(canvas_html : HTMLCanvasElement){
        super(canvas_html);
        setCanvas(this);

        theEditor.setContext2D(this.ctx);
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
        this.moved = false;
        this.prevPortOfDraggedUI = undefined;

        const pos = this.getPositionInCanvas(ev);
        const target = theEditor.getPortBlockFromPosition(pos);
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
        if (animationFrameId == null) {

            animationFrameId = requestAnimationFrame(()=>{
                animationFrameId = null;
                this.repaint();
            });

        }        
    }

    async pointerup(ev:PointerEvent) : Promise<void> {
        if(this.draggedUI == undefined){
            return;
        }

        const pos = this.getPositionInCanvas(ev);
        const target = theEditor.getPortBlockFromPosition(pos);

        if(this.moved){
            msg("dragged");
            if(this.draggedUI instanceof Port && target instanceof Port){
                this.draggedUI.connect(target);
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


export class Editor {
    tools  : Block[];
    blocks : Block[] = [];

    constructor(tools : Block[]){
        setEditor(this);

        this.tools = tools.slice();

        let x = 10;
        let y = 60;
        for(const block of this.tools){
            block.setBoxSize();
            block.setBlockPortPosition(new Vec2(x, y));

            y += block.boxSize!.y + 10;
        }

        this.tools.forEach(x => x.setPortPositions());
    }

    allBlocks() : Block[] {
        return this.tools.concat(this.blocks);
    }

    clearBlock() : void {        
        this.blocks.forEach(x => x.clearBlock());
        this.blocks = [];
    }

    addBlock(block : Block){
        this.blocks.push(block);
    }

    setContext2D(ctx : CanvasRenderingContext2D){
        this.allBlocks().forEach(x => x.ctx = ctx);
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

    getPortBlockFromPosition(pos : Vec2) : Port | Block | undefined {
        const blocks = this.allBlocks().filter(x => x.inMarginBox(pos));

        for(const block of blocks){
            const port = block.ports.find(x => x.isNear(pos));
            if(port != undefined){
                return port;
            }
        }

        for(const block of blocks){
            if(block.inDrawBoxes(pos)){
                return block;
            }
        }

        return undefined;
    }
}
