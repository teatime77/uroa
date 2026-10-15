import { registerFunctionBlock } from "../block";
import { PortType } from "../diagram_util";
import { TextPort } from "../port";
import type { Attr } from "../ui";
import { CameraAIBlock } from "./camera-ai-block";
import { captionGeminiImage } from "./gemini-vision-client";

/** Captions the original image rather than summarizing the detection labels. */
export class ImageCaptionBlock extends CameraAIBlock<string> {
    readonly outputPort = new TextPort(this, PortType.outputPort, "説明文");

    constructor(data: Attr) {
        super(data, { title: "Gemini画像説明", action: "説明", buttonText: "画像を説明", outputLabel: "出力：説明文", resultHeight: 120 });
        this.ports = [this.cameraPort, this.outputPort];
    }
    protected sendImage(apiKey: string, model: string, jpeg: string, signal: AbortSignal): Promise<string> {
        return captionGeminiImage(apiKey, model, jpeg, signal);
    }
    protected publishResult(caption: string): { message: string; text: string } {
        this.outputPort.setPortValue(caption);
        return { message: "説明文を取得しました", text: caption };
    }
    caption(signal?: AbortSignal): Promise<void> { return this.analyze(signal); }
    copy(): ImageCaptionBlock {
        const block = new ImageCaptionBlock({}); block.model = this.model;
        this.copyUI(block); block.setBoxSize(); block.setBlockPortPosition(this.position.copy()); return block;
    }
}

registerFunctionBlock(ImageCaptionBlock.name, () => new ImageCaptionBlock({}));
