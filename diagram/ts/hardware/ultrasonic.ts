import { Vec2 } from "@i18n";
import { DeviceType, FunctionBlock, registerFunctionBlock } from "../block";
import { diagramDevice, type DeviceConnectionState } from "../ble-wifi/device-connection";
import { InvalidDistanceMm, MaxDistanceMm, MinDistanceMm, UltrasonicRecordLength } from "../ble-wifi/device-telemetry";
import { PortType, theCanvas } from "../diagram_util";
import { NumberPort } from "../port";
import type { Attr } from "../ui";

/** HC-SR04の距離をmm単位の数値として出力する。測定値や接続状態は保存しない。 */
export class UltrasonicDistanceSensorBlock extends FunctionBlock {
    readonly outputPort = new NumberPort(this, PortType.outputPort);
    private releaseState?: () => void;
    private releaseStream?: () => void;
    private removed = false;

    /** 出力ポートと、接続状態・共有STREAMの購読を作成する。 */
    constructor(data: Attr) {
        super(data);
        this.deviceType = DeviceType.UltrasonicDistanceSensor;
        this.ports = [this.outputPort];
        this.setBoxSize();
        if (!this.inToolbox) {
            this.releaseState = diagramDevice.subscribe(state => this.connectionChanged(state));
            this.releaseStream = diagramDevice.retainSensorStream(this);
        }
    }

    /** DeviceInfoのセンサー一覧へ登録する。 */
    isSensor(): boolean {
        return true;
    }

    /**
     * DeviceInfoへ種別だけを書き込む。
     * @param bytes DeviceInfoの出力バッファー。
     * @param offset 書込位置。
     * @returns 次の書込位置。
     */
    writeDeviceInfo(bytes: Uint8Array, offset: number): number {
        bytes[offset] = DeviceType.UltrasonicDistanceSensor;
        return offset + 1;
    }

    /**
     * 種別2と距離mmの3バイトレコードを読み取る。
     * @param time 通知のESP32 millis。数値出力には含めない。
     * @param data 検証済みのTelemetry全体。
     * @param offset 距離レコードの開始位置。
     * @returns 次のレコード位置。
     */
    readStatus(time: number, data: DataView, offset: number): number {
        const distanceMm = data.getUint16(offset + 1, true);
        this.setDistance(distanceMm === InvalidDistanceMm ? undefined : distanceMm);
        return offset + UltrasonicRecordLength;
    }

    /** 切断・計測停止では古い距離を出力先にも残さない。 */
    private connectionChanged(state: DeviceConnectionState): void {
        if (state.phase !== "connected" || !state.streaming) {
            this.setDistance(undefined);
        }
        theCanvas?.requestUpdateCanvas();
    }

    /**
     * 有効な距離だけをmm単位で出力し、未測定・失敗では出力を消去する。
     * @param distanceMm 距離mm。undefinedや範囲外の値は未取得として扱う。
     */
    setDistance(distanceMm: number | undefined): void {
        if (this.removed || this.inToolbox) {
            return;
        }
        const valid = distanceMm !== undefined && Number.isInteger(distanceMm) &&
            distanceMm >= MinDistanceMm && distanceMm <= MaxDistanceMm;
        this.outputPort.setPortValue(valid ? distanceMm : undefined);
        theCanvas?.requestUpdateCanvas();
    }

    /** 距離の単位と接続・測定状態を表示できる大きさにする。 */
    setBoxSize(): void {
        this.boxSize = new Vec2(280, this.inToolbox ? 60 : 112);
    }

    /** 位置と外観をコピーし、測定値や接続状態を引き継がない。 */
    copy(): UltrasonicDistanceSensorBlock {
        const block = new UltrasonicDistanceSensorBlock({});
        this.copyUI(block);
        block.setBoxSize();
        return block;
    }

    /** 単位と、接続・登録・測定の状態を表示する。 */
    draw(): void {
        super.draw();
        const ctx = this.ctx;
        ctx.save();
        ctx.font = "18px sans-serif";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#17384f";
        ctx.fillText("超音波距離（mm）", this.position.x + 16, this.position.y + 14);
        if (!this.inToolbox) {
            const state = diagramDevice.state;
            let label: string;
            if (state.phase !== "connected") {
                label = "機器未接続";
            }
            else if (!diagramDevice.isSensorRegistered(this)) {
                label = "再接続して機器を登録";
            }
            else if (!state.streaming) {
                label = "計測開始中";
            }
            else if (this.outputPort.value === undefined) {
                label = "未測定／測定失敗";
            }
            else {
                label = `計測中：10 Hz (${state.transport === "wifi" ? "Wi-Fi" : "BLE"})`;
            }
            ctx.font = "14px sans-serif";
            ctx.fillText(label, this.position.x + 16, this.position.y + 42);
        }
        ctx.restore();
    }

    /** 購読・STREAM利用・出力を解除してからブロックを削除する。 */
    clearBlock(): void {
        this.removed = true;
        this.releaseStream?.();
        this.releaseState?.();
        this.releaseStream = undefined;
        this.releaseState = undefined;
        this.outputPort.setPortValue(undefined);
        super.clearBlock();
    }
}

registerFunctionBlock(UltrasonicDistanceSensorBlock.name, () => new UltrasonicDistanceSensorBlock({}));
