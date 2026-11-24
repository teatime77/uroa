/**
 * CameraAIBlockの共通制御を使い、カメラ画像の日本語説明をTextPortへ出力する。
 */
import { registerFunctionBlock } from "../block";
import { PortType } from "../diagram_util";
import { TextPort } from "../port";
import type { Attr } from "../ui";
import { CameraAIBlock } from "./camera-ai-block";
import { captionGeminiImage } from "./gemini-vision-client";

/** Captions the original image rather than summarizing the detection labels. */
export class ImageCaptionBlock extends CameraAIBlock<string> {
    /**
     * 完了した結果を後続ブロックへ渡す出力ポート。中断・再実行時は消去する。
     */
    readonly outputPort = new TextPort(this, PortType.outputPort, "説明文");

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data: Attr) {
        super(data, { title: "Gemini画像説明", action: "説明", buttonText: "画像を説明", outputLabel: "出力：説明文", resultHeight: 120 });
        this.ports = [this.cameraPort, this.outputPort];
    }
    /**
     * 固定したJPEG画像を送信し、派生ブロックが必要とする解析結果を返す。
     *
     * @param apiKey 要求中だけ使用するAPIキー。
     * @param model 利用するモデル名。
     * @param jpeg Base64化したJPEG画像データ。
     * @param signal 処理を取り消すシグナル。
     */
    protected sendImage(apiKey: string, model: string, jpeg: string, signal: AbortSignal): Promise<string> {
        return captionGeminiImage(apiKey, model, jpeg, signal);
    }
    /**
     * 解析結果を出力ポートへ反映し、状態表示と結果欄の文字列を返す。
     */
    protected publishResult(caption: string): { /** 接続・処理中・完了・エラーを画面へ示す状態メッセージ。 */ message: string; /** 処理結果として表示する文字列。 */ text: string } {
        this.outputPort.setPortValue(caption);
        return { message: "説明文を取得しました", text: caption };
    }
    /**
     * 共通の画像解析処理を画像説明の入口として呼び出す。
     *
     * @param signal 処理を取り消すシグナル。
     */
    caption(signal?: AbortSignal): Promise<void> { return this.analyze(signal); }
    /**
     * 同じ種類のブロックを作成し、複製対象の設定をコピーする。
     */
    copy(): ImageCaptionBlock {
        const block = new ImageCaptionBlock({}); block.model = this.model;
        this.copyUI(block); block.setBoxSize(); block.setBlockPortPosition(this.position.copy()); return block;
    }
}

registerFunctionBlock(ImageCaptionBlock.name, () => new ImageCaptionBlock({}));
