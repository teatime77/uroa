/**
 * キャンバス上のUI部品の矩形・余白・文字・ボタン描画を実装する。ブロックとポートの意味や実行処理は各モジュールへ委ねる。
 */
import { assert, MyError, msg, Vec2 } from "@i18n";
import { Canvas } from "./canvas";

/**
 * 文字の計測サイズへ加える描画上の余裕（pixel）。
 */
const TextSizeFill = 8;
/**
 * キャンバス上の文字に使用する既定色。
 */
export const textColor = "black";

/**
 * 末尾が百分率の長さ指定を0〜1を基準とする比率へ変換する。
 */
function ratio(width : string) : number {
    width = width.trim();
    assert(width.endsWith("%"));
    const num_str = width.substring(0, width.length - 1);

    const num = parseFloat(num_str);

    return num / 100;
}

/**
 * px指定または残り寸法に対する百分率をpixel値へ変換する。不正な指定は例外にする。
 */
function pixel(length : string,  remaining_length? : number) : number {
    if(length != undefined){
        if(length.endsWith("px")){
            const num_str = length.substring(0, length.length - 2);

            return parseFloat(num_str);
        }
        else if(length.endsWith("%")){
            if(remaining_length != undefined){
                return ratio(length) * remaining_length;
            }
        }
    }
    
    throw new MyError();
}

/**
 * キャンバス上のUIに渡す表示・配置・操作状態の属性。
 */
export interface Attr {
    /**
     * 部品の種類を識別する属性値。
     */
    className? : string;
    /**
     * 部品の復元などで呼出し元が渡す関連オブジェクト。
     */
    obj? : any;
    /**
     * 表示・保存・名前解決に使用する名前。
     */
    name? : string;
    /**
     * キャンバス上の部品の基準座標。配置処理が更新する。
     */
    position? : string;
    /**
     * 外側余白。左・右・上・下の順でpixel値を保持する。
     */
    margin? : number[];
    /**
     * 部品に指定する表示色。
     */
    color? : string;
    /**
     * 部品の背景色。
     */
    backgroundColor? : string;
    /**
     * 属性として受け取る枠線の表示指定。
     */
    borderStyle? : string;
    /**
     * 枠線の太さ（pixel）。
     */
    borderWidth? : number;
    /**
     * 枠と内容の間の余白。左・右・上・下の順で保持する。
     */
    padding? : number[];
    /**
     * 垂直方向の配置指定。
     */
    verticalAlign? : string;
    /**
     * 水平方向の配置指定。
     */
    horizontalAlign? : string;
    /**
     * レイアウトで使用する幅の指定。
     */
    width? : string;
    /**
     * レイアウトで使用する高さの指定。
     */
    height? : string;
    /**
     * ボタン操作を受け付けない状態。
     */
    disabled? : boolean;
    /**
     * 属性として受け取る表示状態の指定。
     */
    visibility? : string;
    /**
     * 実配置された部品とツールボックス上の見本を区別するフラグ。
     */
    inToolbox?   : boolean;
}

/**
 * 文字列・文字サイズ・揃え方を含むテキスト部品の属性。
 */
export interface TextAttr extends Attr {
    /**
     * 部品に表示する文字列。
     */
    text? : string;
    /**
     * 描画時に使用する文字サイズの指定。
     */
    fontSize? : string;
    /**
     * 文字の水平方向の揃え方。
     */
    textAlign? : string;
}

/**
 * テキスト表示とクリック処理を持つボタンの属性。
 */
export interface ButtonAttr extends TextAttr {
    /**
     * ボタンの操作確定時に実行する処理。
     */
    click : ()=>void | Promise<void>;
}


/**
 * キャンバス上の部品に共通する座標・矩形・余白と描画処理。
 */
export abstract class UI {
    /**
     * 部品の識別番号を採番するための連番。
     */
    static count : number = 0;

    /**
     * 画面内で部品や接続を識別する番号。
     */
    idx : number;
    /**
     * 部品と子要素の描画に使う2Dコンテキスト。
     */
    ctx! : CanvasRenderingContext2D;
    /**
     * キャンバス上の部品の基準座標。配置処理が更新する。
     */
    position : Vec2 = Vec2.zero();
    /**
     * 余白・枠を含む部品の描画サイズ（pixel）。
     */
    boxSize  : Vec2 = Vec2.zero();
    /**
     * レイアウトで使用する幅の指定。
     */
    width? : string;
    /**
     * レイアウトで使用する高さの指定。
     */
    height? : string;
    margin : number[] = [ 4, 4, 4, 4 ];     // left, right, top, bottom
    /**
     * 枠線の太さ（pixel）。
     */
    borderWidth : number = 3;
    padding : number[] = [ 0, 0, 0, 0 ];    // left, right, top, bottom

    /**
     * 水平方向の配置指定。
     */
    horizontalAlign? : string;
    /**
     * 部品の背景色。
     */
    backgroundColor? : string;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : Attr){
        this.idx = ++UI.count;
        this.backgroundColor = data.backgroundColor;
    }

    /**
     * 基準座標・描画サイズ・描画コンテキストを複製先へコピーする。
     */
    copyUI(ui : UI){
        ui.position = this.position.copy();
        ui.boxSize  = this.boxSize.copy();
        ui.ctx      = this.ctx;
    }

    /**
     * この部品が所有する、描画や操作の対象となる子UIを返す。
     */
    children() : UI[] {
        return [];
    }    

    /**
     * 描画コンテキストを設定し、子要素にも共有する。
     *
     * @param ctx 描画先の2Dコンテキスト。
     */
    setContext2D(ctx: CanvasRenderingContext2D): void {
        this.ctx = ctx;
        this.children().forEach(child => child.setContext2D(ctx));
    }

    /**
     * 現在の基準座標を返す。
     */
    getPosition() : Vec2 {
        return this.position;
    }

    /**
     * 左右の外側余白の合計を返す。
     */
    marginWidth() : number {
        return this.margin[0] + this.margin[1];
    }

    /**
     * 上下の外側余白の合計を返す。
     */
    marginHeight() : number {
        return this.margin[2] + this.margin[3];
    }

    /**
     * 左右の外側余白・枠線・内側余白の合計を返す。
     */
    marginBorderPaddingWidth() : number {
        return this.margin[0] + this.margin[1] + 2 * this.borderWidth + this.padding[0] + this.padding[1];
    }

    /**
     * 上下の外側余白・枠線・内側余白の合計を返す。
     */
    marginBorderPaddingHeight() : number {
        return this.margin[2] + this.margin[3] + 2 * this.borderWidth + this.padding[2] + this.padding[3];
    }

    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize() : void {
        this.boxSize = Vec2.zero();
        msg(`set-min-size:${this.constructor.name}`);
    }

    /**
     * boxSizeに設定済みの横幅を返す。
     */
    getMinWidth() : number {       
        assert(this.boxSize != undefined);
        return this.boxSize!.x;
    }

    /**
     * boxSizeに設定済みの高さを返す。
     */
    getMinHeight() : number {
        assert(this.boxSize != undefined);
        return this.boxSize!.y;
    }

    /**
     * 部品の基準座標を更新する。
     *
     * @param position 基準となる座標またはソース内の位置。
     */
    setPosition(position : Vec2) : void {
        this.position = position;
    }

    /**
     * 外側余白を除いた矩形を、左上・右下の座標で返す。
     */
    marginBox() : [number, number, number, number] {
        const xa = this.position.x + this.margin[0];
        const ya = this.position.y + this.margin[2];
        const xb = xa + this.boxSize.x - this.marginWidth();
        const yb = ya + this.boxSize.y - this.marginHeight();

        return [ xa, ya, xb, yb ];
    }

    /**
     * 枠線の中心を通る矩形を返す。
     */
    borderCenterBox() : [number, number, number, number] {
        const [xa, ya, xb, yb] = this.marginBox();

        const x1 = xa + this.borderWidth / 2;
        const y1 = ya + this.borderWidth / 2;

        const x2 = xb - this.borderWidth / 2;
        const y2 = yb - this.borderWidth / 2;

        return [x1, y1, x2, y2];

    }

    /**
     * 枠線の内側に残る内容領域の矩形を返す。
     */
    borderInnerBox() : [number, number, number, number] {
        const [xa, ya, xb, yb] = this.marginBox();

        const x1 = xa + this.borderWidth;
        const y1 = ya + this.borderWidth;

        const x2 = xb - this.borderWidth;
        const y2 = yb - this.borderWidth;

        return [x1, y1, x2, y2];
    }

    /**
     * 内容の描画と当たり判定に使う矩形を返す。
     */
    drawBox() : [number, number, number, number] {
        return this.borderInnerBox();
    }

    /**
     * 座標が内容の描画矩形に含まれるかを調べる。
     */
    inDrawBox(pos : Vec2) : boolean {
        const [ xa, ya, xb, yb ] = this.drawBox();
        return xa <= pos.x && pos.x < xb && ya <= pos.y && pos.y < yb;
    }

    /**
     * 座標が外側余白を除いた部品矩形に含まれるかを調べる。
     */
    inMarginBox(pos : Vec2) : boolean {
        const [ xa, ya, xb, yb ] = this.marginBox();
        return xa <= pos.x && pos.x < xb && ya <= pos.y && pos.y < yb;
    }

    /**
     * この部品の枠・内容・操作状態をキャンバスへ描く。
     */
    draw(){
        const [xa, ya, xb, yb] = this.marginBox();
        const w = xb - xa;
        const h = yb - ya;
        this.drawRidgeRect(this.ctx, xa, ya, w, h, this.borderWidth);
    }

    /**
     * 診断表示に使う部品の状態文字列を返す。
     */
    str() : string {
        if(this.boxSize == undefined){
            throw new MyError();
        }

        const width  = (this.width  != undefined ? `width:${this.width} `  : "");
        const height = (this.height != undefined ? `height:${this.height} ` : "");
        const minSize = (this.boxSize!= undefined ? `min-size:${this.boxSize.x.toFixed()}, ${this.boxSize.y.toFixed()} ` : "");
        const position = `pos:(${this.position.x},${this.position.y}) `;
        const boxSize = `box:(${this.boxSize.x},${this.boxSize.y}) `;

        return `${this.constructor.name} ${width}${height}${minSize}${position}${boxSize}`;
    }

    /**
     * 現在の状態を指定した深さで字下げして診断出力する。
     *
     * @param nest 診断出力の字下げの深さ。
     */
    dump(nest : number){
        msg(`${tab(nest)}${this.str()}`);
    }

    /**
     * 背景と明暗の枠線を描き、部品の立体的な縁を表す。
     *
     * @param ctx 描画先の2Dコンテキスト。
     */
    drawRidgeRect(ctx : CanvasRenderingContext2D, x : number, y : number, width : number, height : number, ridgeWidth : number, isInset = false) {
        // Define light and dark colors
        // const lightColor = isInset ? '#888' : '#eee'; // Darker for inset top/left
        // const darkColor = isInset ? '#eee' : '#888';  // Lighter for inset bottom/right

        const lightColor = "#ffffff";
        const darkColor = "#888888";
        const backgroundColor = (this.backgroundColor != undefined ? this.backgroundColor : "#cccccc");

        // Optionally, draw the inner rectangle (fill or another stroke)
        ctx.fillStyle = backgroundColor; // Example inner color
        ctx.fillRect(x + ridgeWidth, y + ridgeWidth, width - 2 * ridgeWidth, height - 2 * ridgeWidth);

        // Draw the "light" sides (top and left)
        ctx.strokeStyle = lightColor;
        ctx.lineWidth = ridgeWidth;
        ctx.beginPath();
        ctx.moveTo(x + ridgeWidth / 2, y + height - ridgeWidth / 2); // Bottom-left corner
        ctx.lineTo(x + ridgeWidth / 2, y + ridgeWidth / 2);     // Top-left corner
        ctx.lineTo(x + width - ridgeWidth / 2, y + ridgeWidth / 2); // Top-right corner
        ctx.stroke();

        // Draw the "dark" sides (bottom and right)
        ctx.strokeStyle = darkColor;
        ctx.lineWidth = ridgeWidth;
        ctx.beginPath();
        ctx.moveTo(x + width - ridgeWidth / 2, y + ridgeWidth / 2);     // Top-right corner
        ctx.lineTo(x + width - ridgeWidth / 2, y + height - ridgeWidth / 2); // Bottom-right corner
        ctx.lineTo(x + ridgeWidth / 2, y + height - ridgeWidth / 2); // Bottom-left corner
        ctx.stroke();
    }
}

/**
 * 配置領域を確保するための空のUI部品。
 */
export class Filler extends UI {
}

/**
 * 文字の寸法を計測して枠内へ表示する部品。
 */
export class TextUI extends UI {
    /**
     * 描画時に使用する文字サイズの指定。
     */
    fontSize? : string;
    /**
     * 文字の水平方向の揃え方。
     */
    textAlign? : string;
    /**
     * 部品に表示する文字列。
     */
    text : string;
    /**
     * 描画コンテキストで計測した文字列の寸法。
     */
    metrics!: TextMetrics;
    /**
     * 文字の実際の上端から下端までの計測高さ（pixel）。
     */
    actualHeight!: number;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : TextAttr){
        super(data);
        this.fontSize  = data.fontSize;
        this.textAlign = data.textAlign;
        this.text = (data.text != undefined ? data.text : "");
    }


    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize() : void {
        this.metrics = this.ctx.measureText(this.text);
      
        this.actualHeight = this.metrics.actualBoundingBoxAscent + this.metrics.actualBoundingBoxDescent;
      
        msg(`idx:[${this.idx}]  font :[${this.fontSize}]  w:[${this.metrics.width}] h:[${this.actualHeight}] [${this.text}]`);

        const width  = this.metrics.width + this.marginBorderPaddingWidth() + TextSizeFill;
        const height = this.actualHeight  + this.marginBorderPaddingHeight() + TextSizeFill;

        this.boxSize = new Vec2(width, height);
    }

    /**
     * この部品の枠・内容・操作状態をキャンバスへ描く。
     */
    draw(){
        super.draw();

        const x = this.position.x + this.margin[0] + this.borderWidth + this.padding[0];
        const y = this.position.y + this.margin[2] + this.borderWidth + this.padding[2]
                  + this.actualHeight;

        this.ctx.strokeStyle = textColor;
        this.ctx.strokeText(this.text, x, y);
    }

    /**
     * 診断表示に使う部品の状態文字列を返す。
     */
    str() : string {
        return `${super.str()} text:${this.text}`;
    }

}

/**
 * 読取り用のテキストラベル。
 */
export class Label extends TextUI {
}

/**
 * 無効・押下状態とクリック処理を持つキャンバス上のボタン。
 */
export class Button extends TextUI {
    /**
     * ボタンの操作確定時に実行する処理。
     */
    click : ()=>void | Promise<void>;
    /**
     * ボタン操作を受け付けない状態。
     */
    disabled = false;
    /**
     * ポインター操作中の押下表示に使う状態。
     */
    pressed = false;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : ButtonAttr){
        super(data);
        this.click = data.click;
        this.disabled = data.disabled ?? false;
        this.fontSize = data.fontSize ?? "18px";
        this.margin = [0, 0, 0, 0];
        this.boxSize = new Vec2(140, 48);
    }

    /**
     * この部品の枠・内容・操作状態をキャンバスへ描く。
     */
    draw(): void {
        const [x1, y1, x2, y2] = this.marginBox();
        const ctx = this.ctx;
        ctx.save();
        ctx.fillStyle = this.disabled ? "#dddddd" : this.pressed ? "#b6d4ea" : "#e8f2fa";
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.strokeStyle = this.disabled ? "#aaaaaa" : "#35658a";
        ctx.lineWidth = 2;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.font = `${this.fontSize} sans-serif`;
        ctx.fillStyle = this.disabled ? "#777777" : "#17384f";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.text, (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1 - 12);
        ctx.restore();
    }
}

/**
 * 完了判定とノード固有の描画を派生型へ委ねるUI。
 */
export abstract class Node extends UI {
    /**
     * このノードの処理が完了したかを派生型の規約で返す。
     */
    abstract done() : boolean;
    /**
     * ノード固有の表示を指定したキャンバスへ描く。
     */
    abstract drawNode(canvas : Canvas) : void;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data : Attr){
        super(data);
    }
}

/**
 * 診断出力の深さに応じた4スペース単位の字下げを返す。
 *
 * @param nest 診断出力の字下げの深さ。
 */
export function tab(nest : number) : string {
    return " ".repeat(nest * 4);
}
