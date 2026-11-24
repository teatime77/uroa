/**
 * ブロック間の実行接続・データ接続と値の配送を担当する。データ型の検証と構造体コピーはdata_type.tsへ委譲する。
 */
import { msg, MyError, assert, remove, $, parseURL, Vec2, append } from "@i18n";
import { tab } from "./ui";
import { Block } from "./block";
import { notchRadius, PortType, theCanvas } from "./diagram_util";
import { Canvas } from "./canvas";
import { DataType, numberType, stringType, type Struct, type StructValue } from "./data_type";

/**
 * 一方のポートから見た接続・切断の通知内容。
 */
export interface PortConnectionChange {
    /**
     * 接続変更が起きた側のポート。
     */
    readonly port: Port;
    /**
     * 接続または切断した相手側のポート。
     */
    readonly peer: Port;
    /**
     * 接続の成立ならtrue、解除ならfalse。
     */
    readonly connected: boolean;
}

/**
 * 親ブロックとの位置関係、接続、値とその変更通知を管理するポート。
 */
export class Port {
    /**
     * ポートの描画と近接判定に使う半径（pixel）。
     */
    static radius = 10;        
    /**
     * ポートの識別番号を採番するための連番。
     */
    static Count = 0;

    /**
     * 画面内で部品や接続を識別する番号。
     */
    idx : number = 0;
    /**
     * 表示・保存・名前解決に使用する名前。
     */
    name : string;
    /**
     * この要素を所有する親の参照。
     */
    parent : Block;
    /**
     * このポートから値または実行を渡す接続先。
     */
    destinations : Port[]  = [];
    /**
     * このポートへ値または実行を渡す接続元。
     */
    sources : Port[]  = [];
    /**
     * 対象の種別またはデータ型。
     */
    type : PortType;
    /**
     * 明示的な値の型。未指定なら単一接続元から型を解決する。
     */
    dataType?: DataType;
    /**
     * 接続・切断を監視する購読者の集合。
     */
    private connectionListeners = new Set<(change: PortConnectionChange) => void>();
    /**
     * 親ブロックの基準座標からポート中心までの差分。
     */
    offset : Vec2 = Vec2.zero();
    /**
     * キャンバス上の部品の基準座標。配置処理が更新する。
     */
    private position : Vec2 = Vec2.zero();

    /**
     * 直前に保持していた値。setPortValue()が更新する。
     */
    prevValue : any | undefined;
    /**
     * 現在このポートまたは処理が保持する値。
     */
    value : any | undefined;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param type 検証または配置するデータ型。
     * @param name 対象を識別する名前。
     */
    constructor(parent : Block, type : PortType, name : string = "", dataType?: DataType){
        this.idx    = Port.Count++;
        this.parent = parent;
        this.type   = type;
        this.name   = name;
        this.dataType = dataType;
    }

    /**
     * 診断表示に使う部品の状態文字列を返す。
     */
    str() : string {
        return `port idx:${this.idx} type:${PortType[this.type]} pos:${this.position.toString()}`;
    }

    /**
     * ポートの種類・識別番号・座標を診断出力する。
     *
     * @param nest 診断出力の字下げの深さ。
     */
    dumpPort(nest : number){
        msg(`${tab(nest)}${this.str()}`);
    }

    /**
     * 図の保存に必要な設定をJSON化可能なオブジェクトへ変換する。
     */
    makeObj() : any{
        return {
            idx : this.idx,
            destinations : this.destinations.map(dst => dst.idx),
            ...(this.dataType ? { dataType: this.dataType.makeObj() } : {})
        };
    }

    /**
     * 保存オブジェクトからこの要素の設定を復元する。
     *
     * @param obj 復元する保存オブジェクト。
     */
    loadObj(obj: { /** 明示的な値の型。未指定なら単一接続元から型を解決する。 */ dataType?: unknown }): void {
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

    /**
     * 接続変更の購読を登録し、解除関数を返す。
     *
     * @param listener 変更通知を受け取る処理。
     */
    subscribeConnections(listener: (change: PortConnectionChange) => void): () => void {
        this.connectionListeners.add(listener);
        return () => { this.connectionListeners.delete(listener); };
    }

    /**
     * 接続変更を購読者へ通知し、購読者側の例外は診断に留める。
     */
    private notifyConnection(peer: Port, connected: boolean): void {
        const change = { port: this, peer, connected };
        for (const listener of this.connectionListeners) {
            try { listener(change); }
            catch (error) { console.error("Port connection handler failed", error); }
        }
    }

    /**
     * 値を型検証して保持し、全接続先へ配送して入力変更を通知する。構造体はコピーする。
     *
     * @param value 検証または反映する値。
     */
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

    /**
     * 現在の基準座標を返す。
     */
    getPosition() : Vec2 {
        return this.position;
    }

    /**
     * ポート中心と親ブロックからの差分を更新する。
     */
    setPortPositionXY(x : number, y : number){
        this.position.x = x;
        this.position.y = y;

        this.offset.x = x - this.parent.position.x;
        this.offset.y = y - this.parent.position.y;
    }

    /**
     * 指定座標がポート半径内にあるかを調べる。
     */
    isNear(pos : Vec2){
        return this.position.distance(pos) < Port.radius;
    }

    /**
     * 相手ポートが接続候補となる距離にあるかを調べる。
     */
    isNearPort(port : Port){
        return this.position.distance(port.position) < Port.radius;
    }

    /**
     * 相手の中心からこのポートの中心への座標差を返す。
     */
    diffPosition(port : Port) : Vec2 {
        return this.position.sub(port.position);
    }

    /**
     * 接続元が一つの場合に、その直前のポートを返す。
     */
    prevPort() : Port | undefined {
        if(this.sources.length == 1){
            return this.sources[0];
        }

        return undefined;
    }

    /**
     * 接続先が一つの場合に、その直後のポートを返す。
     */
    nextPort() : Port | undefined {
        if(this.destinations.length == 1){
            return this.destinations[0];
        }

        return undefined;
    }
    
    /**
     * 実行連鎖の上下ポートを切欠きの円弧として描く。
     *
     * @param ctx 描画先の2Dコンテキスト。
     */
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

    /**
     * ポート本体・接続線・名前・現在値または構造体型名を描く。
     *
     * @param ctx 描画先の2Dコンテキスト。
     */
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
            ctx.font = typeof this.value === "string" ? '14px Arial' : '24px Arial';
            ctx.fillStyle = "black";
            const x = this.position.x - 7 + Port.radius;
            const y = this.position.y + 7;
            let label = `${this.value}`;
            if (typeof this.value === "string") {
                const text = this.value.replace(/\s+/g, " ");
                const chars = Array.from(text).slice(0, 64);
                let suffix = chars.length < Array.from(text).length ? "…" : "";
                const width = Math.max(0, this.parent.drawBox()[2] - x - Port.radius);
                while (chars.length && ctx.measureText(chars.join("") + suffix).width > width) {
                    chars.pop(); suffix = "…";
                }
                label = chars.join("") + suffix;
            }
            ctx.fillText(label, x, y);
            ctx.restore();
        }
    }

    /**
     * このポートからドラッグ位置までの仮の接続線を描く。
     */
    drawDraggedPort(move_pos : Vec2){       
        theCanvas.drawLine(this.position, move_pos, "blue") ;
    }

    /**
     * 接続方向と解決済みのデータ型が組み合わせ可能かを調べる。
     */
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

    /**
     * ポートの方向・データ型・近接距離をまとめて照合する。
     */
    canConnect(dst : Port) : boolean {
        return this.fitPortType(dst) && this.isNearPort(dst);
    }

    /**
     * 向きを判定して接続元・接続先の両方に登録し、重複を避けて接続通知を行う。
     */
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

    /**
     * 接続元・接続先の両方から相手を除き、接続解除を通知する。
     */
    disconnect(port : Port) : void {   
        const [src, dst] = this.destinations.includes(port) ? [this, port] : [port, this];
        if (!src.destinations.includes(dst)) return;
        remove(src.destinations, dst, true);
        remove(dst.sources, src, true);
        src.notifyConnection(dst, false);
        dst.notifyConnection(src, false);
    }

    /**
     * 現在接続されている全ての相手との接続を解除する。
     */
    disconnectAll(): void {
        for (const peer of [...this.sources, ...this.destinations]) this.disconnect(peer);
    }
}

/**
 * 数値型を明示する入出力ポート。
 */
export class NumberPort extends Port {
    /**
     * この型の状態と依存先を初期化する。
     *
     * @param type 検証または配置するデータ型。
     * @param name 対象を識別する名前。
     */
    constructor(parent: Block, type: PortType, name = "") {
        super(parent, type, name, numberType);
    }
    /**
     * 現在値を数値として返す。未取得または数値以外なら例外を投げる。
     */
    numberValue() : number {
        if(typeof this.value == "number"){
            return this.value;
        }

        throw new MyError();
    }
}

/**
 * 文字列型を明示する入出力ポート。
 */
export class TextPort extends Port {
    /**
     * この型の状態と依存先を初期化する。
     *
     * @param type 検証または配置するデータ型。
     * @param name 対象を識別する名前。
     */
    constructor(parent: Block, type: PortType, name = "") {
        super(parent, type, name, stringType);
    }
    /**
     * 現在値を文字列として返す。未取得または文字列以外なら例外を投げる。
     */
    stringValue() : string {
        if(typeof this.value == "string"){
            return this.value;
        }

        throw new MyError();
    }
}

/** A struct input or output shares the same Port wiring and notification mechanism. */
export class StructPort extends Port {
    /**
     * 現在このポートまたは処理が保持する値。
     */
    declare value: StructValue | undefined;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param type 検証または配置するデータ型。
     * @param name 対象を識別する名前。
     */
    constructor(parent: Block, type: PortType, struct: Struct, name = "") {
        super(parent, type, name, new DataType(struct.name));
    }

    /**
     * 現在の構造体値を検証して返す。未取得なら例外を投げる。
     */
    structValue(): StructValue {
        if (this.value === undefined) throw new Error("構造体データをまだ取得していません。");
        this.getDataType()!.validateValue(this.value);
        return this.value;
    }
}
