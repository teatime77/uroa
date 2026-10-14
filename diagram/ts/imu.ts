import { Vec2 } from "@i18n";
import { FunctionBlock, registerFunctionBlock } from "./block";
import { diagramBLE, type BLEConnectionState } from "./ble";
import { imuStruct, type IMUValue } from "./data_type";
import { PortType, theCanvas } from "./diagram_util";
import { StructPort } from "./port";
import type { Attr } from "./ui";

/** Like the distance sensor block, this block pushes one received measurement. */
export class IMUBlock extends FunctionBlock {
    readonly outputPort = new StructPort(this, PortType.outputPort, imuStruct, "imu");
    private releaseState?: () => void;
    private releaseSamples?: () => void;
    private removed = false;

    constructor(data: Attr) {
        super(data);
        this.ports = [this.outputPort];
        this.setBoxSize();
        if (!this.inToolbox) {
            this.releaseState = diagramBLE.subscribe(state => this.connectionChanged(state));
            this.releaseSamples = diagramBLE.subscribeSamples(sample => this.setIMU(sample.value));
        }
    }

    private connectionChanged(state: BLEConnectionState): void {
        if (state.phase !== "connected" || !state.imuAvailable || !state.streaming) this.outputPort.setPortValue(undefined);
        theCanvas?.requestUpdateCanvas();
    }

    setIMU(value: IMUValue): void {
        if (this.removed || this.inToolbox) return;
        this.outputPort.setPortValue(value);
        // console.log("IMU", this.outputPort.structValue());
        theCanvas?.requestUpdateCanvas();
    }

    setBoxSize(): void { this.boxSize = new Vec2(240, this.inToolbox ? 60 : 140); }

    copy(): IMUBlock {
        const block = new IMUBlock({});
        this.copyUI(block);
        block.setBoxSize();
        return block;
    }

    draw(): void {
        super.draw();
        const ctx = this.ctx;
        ctx.save();
        ctx.font = "18px sans-serif";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#17384f";
        ctx.fillText("IMU", this.position.x + 16, this.position.y + 14);
        if (!this.inToolbox) {
            const state = diagramBLE.state;
            const label = state.phase !== "connected" ? "機器未接続" : !state.imuAvailable ? "IMU未検出" : state.streaming ? `計測中：10 Hz (${state.transport === "wifi" ? "Wi-Fi" : "BLE"})` : "計測開始中";
            ctx.fillText(label, this.position.x + 16, this.position.y + 40);
            ctx.font = "14px sans-serif";
            ctx.fillText("gyro：角速度 °/s", this.position.x + 16, this.position.y + 66);
            ctx.fillText("acc：加速度 m/s²", this.position.x + 16, this.position.y + 86);
        }
        ctx.restore();
    }

    clearBlock(): void {
        this.removed = true;
        this.releaseSamples?.();
        this.releaseState?.();
        this.releaseSamples = this.releaseState = undefined;
        this.outputPort.setPortValue(undefined);
        super.clearBlock();
    }
}

registerFunctionBlock(IMUBlock.name, () => new IMUBlock({}));
