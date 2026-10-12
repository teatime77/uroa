import { msg, MyError, assert, remove, $, parseURL, Vec2, append } from "@i18n";
import { tab } from "./ui";
import { Block } from "./block";
import { notchRadius, PortType, theCanvas } from "./diagram_util";
import { Canvas } from "./canvas";
import { DataType, numberType, stringType, type Struct, type StructValue } from "./data_type";

export interface PortConnectionChange {
    readonly port: Port;
    readonly peer: Port;
    readonly connected: boolean;
}

export class Port {
    static radius = 10;        
    static Count = 0;

    idx : number = 0;
    name : string;
    parent : Block;
    destinations : Port[]  = [];
    sources : Port[]  = [];
    type : PortType;
    dataType?: DataType;
    private connectionListeners = new Set<(change: PortConnectionChange) => void>();
    offset : Vec2 = Vec2.zero();
    private position : Vec2 = Vec2.zero();

    prevValue : any | undefined;
    value : any | undefined;

    constructor(parent : Block, type : PortType, name : string = "", dataType?: DataType){
        this.idx    = Port.Count++;
        this.parent = parent;
        this.type   = type;
        this.name   = name;
        this.dataType = dataType;
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
            destinations : this.destinations.map(dst => dst.idx),
            ...(this.dataType ? { dataType: this.dataType.makeObj() } : {})
        };
    }

    loadObj(obj: { dataType?: unknown }): void {
        if (obj.dataType === undefined) return; // Older diagrams have no value type metadata.
        const type = DataType.fromObj(obj.dataType);
        if (this.dataType && !this.dataType.equals(type)) throw new Error("ブロックと保存されたポートのデータ型が一致しません。");
        this.dataType = type;
    }

    /** Explicit type wins; an untyped port resolves a single source without caching it. */
    getDataType(visited = new Set<Port>()): DataType | undefined {
        if (this.dataType) return this.dataType;
        if (visited.has(this) || this.sources.length !== 1) return undefined;
        visited.add(this);
        return this.sources[0].getDataType(visited);
    }

    subscribeConnections(listener: (change: PortConnectionChange) => void): () => void {
        this.connectionListeners.add(listener);
        return () => { this.connectionListeners.delete(listener); };
    }

    private notifyConnection(peer: Port, connected: boolean): void {
        const change = { port: this, peer, connected };
        for (const listener of this.connectionListeners) {
            try { listener(change); }
            catch (error) { console.error("Port connection handler failed", error); }
        }
    }

    setPortValue(value : any | undefined){
        const dataType = this.getDataType();
        if (value !== undefined && dataType) {
            dataType.validateValue(value);
            if (dataType.struct) value = dataType.copyValue(value);
        }
        this.prevValue = this.value;
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

        const dataType = this.getDataType();
        if (dataType?.struct) {
            ctx.save();
            ctx.font = "14px sans-serif";
            ctx.fillStyle = "black";
            ctx.fillText(`${this.name ? this.name + ": " : ""}${dataType.typeName}`, this.position.x + Port.radius + 6, this.position.y + 5);
            ctx.restore();
            return;
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

        if (!pairs.some(pair => pair[0] == this.type && pair[1] == dst.type)) return false;
        const sourceType = this.getDataType(), destinationType = dst.getDataType();
        return !sourceType || !destinationType || sourceType.equals(destinationType);
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

        if (src.destinations.includes(dst)) return;
        append(src.destinations, dst);
        append(dst.sources, src);
        src.notifyConnection(dst, true);
        dst.notifyConnection(src, true);

        msg(`connect port:${this.idx}=>${port.idx}`);
    }

    disconnect(port : Port) : void {   
        const [src, dst] = this.destinations.includes(port) ? [this, port] : [port, this];
        if (!src.destinations.includes(dst)) return;
        remove(src.destinations, dst, true);
        remove(dst.sources, src, true);
        src.notifyConnection(dst, false);
        dst.notifyConnection(src, false);
    }

    disconnectAll(): void {
        for (const peer of [...this.sources, ...this.destinations]) this.disconnect(peer);
    }
}

export class NumberPort extends Port {
    constructor(parent: Block, type: PortType, name = "") {
        super(parent, type, name, numberType);
    }
    numberValue() : number {
        if(typeof this.value == "number"){
            return this.value;
        }

        throw new MyError();
    }
}

export class TextPort extends Port {
    constructor(parent: Block, type: PortType, name = "") {
        super(parent, type, name, stringType);
    }
    stringValue() : string {
        if(typeof this.value == "string"){
            return this.value;
        }

        throw new MyError();
    }
}

/** A struct input or output shares the same Port wiring and notification mechanism. */
export class StructPort extends Port {
    declare value: StructValue | undefined;

    constructor(parent: Block, type: PortType, struct: Struct, name = "") {
        super(parent, type, name, new DataType(struct.name));
    }

    structValue(): StructValue {
        if (this.value === undefined) throw new Error("構造体データをまだ取得していません。");
        this.getDataType()!.validateValue(this.value);
        return this.value;
    }
}
