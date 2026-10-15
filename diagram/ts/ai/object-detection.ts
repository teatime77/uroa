import { registerFunctionBlock } from "../block";
import { Field, Struct, numberType, stringType } from "../data_type";
import { PortType } from "../diagram_util";
import { NumberPort, StructPort, TextPort } from "../port";
import type { Attr } from "../ui";
import { CameraAIBlock, type SnapshotBounds } from "./camera-ai-block";
import { detectGeminiObjects, type DetectedObject } from "./gemini-vision-client";

const detectionStruct = new Struct("ObjectDetection", [new Field("label", stringType),
    ...["x", "y", "width", "height"].map(name => new Field(name, numberType))]);

export class ObjectDetectionBlock extends CameraAIBlock<readonly DetectedObject[]> {
    readonly labelsPort = new TextPort(this, PortType.outputPort, "ラベル");
    readonly countPort = new NumberPort(this, PortType.outputPort, "個数");
    readonly objectPort = new StructPort(this, PortType.outputPort, detectionStruct, "先頭の物体");

    constructor(data: Attr) {
        super(data, { title: "Gemini物体検出", action: "検出", buttonText: "1回検出", outputLabel: "出力：ラベル／個数／先頭の物体" });
        this.ports = [this.cameraPort, this.labelsPort, this.countPort, this.objectPort];
    }
    protected sendImage(apiKey: string, model: string, jpeg: string, signal: AbortSignal): Promise<readonly DetectedObject[]> {
        return detectGeminiObjects(apiKey, model, jpeg, signal);
    }
    protected publishResult(objects: readonly DetectedObject[]): { message: string; text: string } {
        const labels = [...new Set(objects.map(object => object.label))].join("、");
        this.labelsPort.setPortValue(labels); this.countPort.setPortValue(objects.length);
        this.objectPort.setPortValue(objects[0]);
        return { message: `${objects.length}個検出`, text: labels || "検出した物体はありません。" };
    }
    detect(signal?: AbortSignal): Promise<void> { return this.analyze(signal); }
    copy(): ObjectDetectionBlock {
        const block = new ObjectDetectionBlock({}); block.model = this.model;
        this.copyUI(block); block.setBoxSize(); block.setBlockPortPosition(this.position.copy()); return block;
    }
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
