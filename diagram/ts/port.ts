import { msg, MyError, assert, remove, $, parseURL, Vec2, append } from "@i18n";
import { tab } from "./ui";
import { Block } from "./block";
import { notchRadius, PortType, theCanvas } from "./diagram_util";
import { Canvas } from "./canvas";

export class Port {
    static radius = 10;        
    static Count = 0;

    idx : number = 0;
    name : string;
    parent : Block;
    destinations : Port[]  = [];
    sources : Port[]  = [];
    type : PortType;
    offset : Vec2 = Vec2.zero();
    private position : Vec2 = Vec2.zero();

    prevValue : any | undefined;
    value : any | undefined;

    constructor(parent : Block, type : PortType, name : string = ""){
        this.idx    = Port.Count++;
        this.parent = parent;
        this.type   = type;
        this.name   = name;
    }

    str() : string {
        return `port idx:${this.idx} type:${PortType[this.type]} pos:${this.position.toString()}`;
    }

    dumpPort(nest : number){
        msg(`${tab(nest)}${this.str()}`);
    }

    makeObj() : any{
        return {
            idx : this.idx,
            destinations : this.destinations.map(dst => dst.idx)
        };
    }

    setPortValue(value : any | undefined){
        this.value = value;

        for(const dst of this.destinations){
            dst.setPortValue(value);

            dst.parent.valueChanged()
            .then(()=>{
            })
            .catch(error => {
                console.error("Failed to value change:", error);
            });
        }
    }

    getPosition() : Vec2 {
        return this.position;
    }

    setPortPositionXY(x : number, y : number){
        this.position.x = x;
        this.position.y = y;

        this.offset.x = x - this.parent.position.x;
        this.offset.y = y - this.parent.position.y;
    }

    isNear(pos : Vec2){
        return this.position.distance(pos) < Port.radius;
    }

    isNearPort(port : Port){
        return this.position.distance(port.position) < Port.radius;
    }

    diffPosition(port : Port) : Vec2 {
        return this.position.sub(port.position);
    }

    prevPort() : Port | undefined {
        if(this.sources.length == 1){
            return this.sources[0];
        }

        return undefined;
    }

    nextPort() : Port | undefined {
        if(this.destinations.length == 1){
            return this.destinations[0];
        }

        return undefined;
    }
    
    drawNotch(ctx : CanvasRenderingContext2D){
        switch(this.type){
        case PortType.top:
            ctx.arc(this.position.x, this.position.y, notchRadius, 0, Math.PI, false);
            break;

            case PortType.bottom:
            ctx.arc(this.position.x, this.position.y, notchRadius, Math.PI, 0, true);
            break;

        default:
            throw new MyError();
        }
    }

    drawIOPort(ctx : CanvasRenderingContext2D) : void {   
        ctx.beginPath();

        ctx.arc(this.position.x, this.position.y, Port.radius, 0, 2 * Math.PI);

        ctx.fill();
        ctx.stroke();

        for(const dst of this.destinations){
            theCanvas.drawLine(this.position, dst.position, "brown", 4);
        }

        if(this.name != ""){
            // ctx.strokeText(this.name, this.position.x, this.position.y);
            ctx.save();
            ctx.font = '24px Arial';
            ctx.fillStyle = "black";
            const x = this.position.x - 7;
            const y = this.position.y + 7;
            ctx.fillText(this.name, x, y);
            ctx.restore();
        }

        if(this.value != undefined){

            ctx.save();
            ctx.font = '24px Arial';
            ctx.fillStyle = "black";
            const x = this.position.x - 7 + Port.radius;
            const y = this.position.y + 7;
            ctx.fillText(`${this.value}`, x, y);
            ctx.restore();
        }
    }

    drawDraggedPort(move_pos : Vec2){       
        theCanvas.drawLine(this.position, move_pos, "blue") ;
    }

    fitPortType(dst : Port) : boolean {
        const pairs = [
            [ PortType.bottom, PortType.top],
            [ PortType.top , PortType.bottom],

            [ PortType.inputPort, PortType.outputPort],
            [ PortType.outputPort, PortType.inputPort]
        ];

        return pairs.some(pair => pair[0] == this.type && pair[1] == dst.type);
    }

    canConnect(dst : Port) : boolean {
        return this.fitPortType(dst) && this.isNearPort(dst);
    }

    connect(port : Port) : void {   
        assert(this.fitPortType(port));

        let src : Port;
        let dst : Port;

        if(this.type == PortType.bottom || this.type == PortType.outputPort){
            [src, dst] = [this, port];
        }
        else{
            [src, dst] = [port, this];
        }

        append(src.destinations, dst);
        append(dst.sources, src);

        msg(`connect port:${this.idx}=>${port.idx}`);
    }

    disconnect(port : Port) : void {   
        remove(this.destinations, port, true);
        remove(port.sources, this, true);
    }
}

export class NumberPort extends Port {
    numberValue() : number {
        if(typeof this.value == "number"){
            return this.value;
        }

        throw new MyError();
    }
}

export class TextPort extends Port {
    stringValue() : string {
        if(typeof this.value == "string"){
            return this.value;
        }

        throw new MyError();
    }
}
