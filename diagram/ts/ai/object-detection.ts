/**
 * 固定画像の物体ラベル・個数・先頭物体を出力し、検出矩形を描画する。画像要求と取消はCameraAIBlockへ委譲する。
 */
import { registerFunctionBlock } from "../block";
import { Field, Struct, numberType, stringType } from "../data_type";
import { PortType } from "../diagram_util";
import { NumberPort, StructPort, TextPort } from "../port";
import type { Attr } from "../ui";
import { CameraAIBlock, type SnapshotBounds } from "./camera-ai-block";
import { detectGeminiObjects, type DetectedObject } from "./gemini-vision-client";

/**
 * 物体のラベルと正規化矩形を出力する構造体の登録定義。
 */
const detectionStruct = new Struct("ObjectDetection", [new Field("label", stringType),
    ...["x", "y", "width", "height"].map(name => new Field(name, numberType))]);

/**
 * CameraBlockの固定画像を一回検出し、ラベル・個数・矩形を表示とポートへ渡す。
 */
export class ObjectDetectionBlock extends CameraAIBlock<readonly DetectedObject[]> {
    /**
     * 重複を除いた日本語ラベルを文字列で渡す出力。
     */
    readonly labelsPort = new TextPort(this, PortType.outputPort, "ラベル");
    /**
     * 検出した物体の個数を渡す数値出力。
     */
    readonly countPort = new NumberPort(this, PortType.outputPort, "個数");
    /**
     * 検出結果の先頭物体をラベルと矩形の構造体で渡す出力。
     */
    readonly objectPort = new StructPort(this, PortType.outputPort, detectionStruct, "先頭の物体");

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data: Attr) {
        super(data, { title: "Gemini物体検出", action: "検出", buttonText: "1回検出", outputLabel: "出力：ラベル／個数／先頭の物体" });
        this.ports = [this.cameraPort, this.labelsPort, this.countPort, this.objectPort];
    }
    /**
     * 固定したJPEG画像を送信し、派生ブロックが必要とする解析結果を返す。
     *
     * @param apiKey 要求中だけ使用するAPIキー。
     * @param model 利用するモデル名。
     * @param jpeg Base64化したJPEG画像データ。
     * @param signal 処理を取り消すシグナル。
     */
    protected sendImage(apiKey: string, model: string, jpeg: string, signal: AbortSignal): Promise<readonly DetectedObject[]> {
        return detectGeminiObjects(apiKey, model, jpeg, signal);
    }
    /**
     * 解析結果を出力ポートへ反映し、状態表示と結果欄の文字列を返す。
     */
    protected publishResult(objects: readonly DetectedObject[]): { /** 接続・処理中・完了・エラーを画面へ示す状態メッセージ。 */ message: string; /** 処理結果として表示する文字列。 */ text: string } {
        const labels = [...new Set(objects.map(object => object.label))].join("、");
        this.labelsPort.setPortValue(labels); this.countPort.setPortValue(objects.length);
        this.objectPort.setPortValue(objects[0]);
        return { message: `${objects.length}個検出`, text: labels || "検出した物体はありません。" };
    }
    /**
     * 共通の画像解析処理を物体検出の入口として呼び出す。
     *
     * @param signal 処理を取り消すシグナル。
     */
    detect(signal?: AbortSignal): Promise<void> { return this.analyze(signal); }
    /**
     * 同じ種類のブロックを作成し、複製対象の設定をコピーする。
     */
    copy(): ObjectDetectionBlock {
        const block = new ObjectDetectionBlock({}); block.model = this.model;
        this.copyUI(block); block.setBoxSize(); block.setBlockPortPosition(this.position.copy()); return block;
    }
    /**
     * 固定画像の表示矩形へ解析結果を重ねるための描画入口。
     *
     * @param ctx 描画先の2Dコンテキスト。
     */
    protected drawResult(ctx: CanvasRenderingContext2D, bounds: SnapshotBounds, objects: readonly DetectedObject[]): void {
        const { left, top, width, height } = bounds;
        ctx.strokeStyle = "#dc2626"; ctx.lineWidth = 2;
        for (const object of objects) {
            const bx = left + object.x * width, by = top + object.y * height;
            ctx.strokeRect(bx, by, object.width * width, object.height * height);
            const textWidth = Math.min(width, ctx.measureText(object.label).width + 8);
            const tx = Math.max(left, Math.min(bx, left + width - textWidth));
            const ty = Math.max(top, by - 18);
            ctx.fillStyle = "#b91c1c"; ctx.fillRect(tx, ty, textWidth, 18);
            ctx.fillStyle = "white"; ctx.fillText(object.label, tx + 4, ty + 1, textWidth - 8);
        }
    }
}

registerFunctionBlock(ObjectDetectionBlock.name, () => new ObjectDetectionBlock({}));
