import { assert, Vec2, Vec3 } from "@i18n";
import { DeviceType, FunctionBlock, registerFunctionBlock } from "../block";
import { diagramBLE, type BLEConnectionState } from "../ble-wifi/ble";
import { imuStruct, balanceStruct, type IMUValue, Vec3Value } from "../data_type";
import { PortType, theCanvas } from "../diagram_util";
import { StructPort } from "../port";
import type { Attr } from "../ui";

/** Like the distance sensor block, this block pushes one received measurement. */
export class IMUBlock extends FunctionBlock {
    readonly outputPort = new StructPort(this, PortType.outputPort, imuStruct, "imu");
    readonly balancePort = new StructPort(this, PortType.outputPort, balanceStruct, "balance");
    private releaseState?: () => void;
    private releaseStream?: () => void;
    private releaseBalance?: () => void;
    private removed = false;

    constructor(data: Attr) {
        super(data);
        this.deviceType = DeviceType.IMU6Axis;
        this.ports = [this.outputPort, this.balancePort]; // 既存JSONの先頭IMUポートを維持。
        this.setBoxSize();
        if (!this.inToolbox) {
            this.releaseState = diagramBLE.subscribe(state => this.connectionChanged(state));
            this.releaseStream = diagramBLE.retainIMUStream();
            this.releaseBalance = diagramBLE.subscribeBalanceSamples(sample => {
                if (this.removed) return;
                this.balancePort.setPortValue(sample.value);
                theCanvas?.requestUpdateCanvas();
            });
        }
    }

    isSensor() : boolean {
        return true;
    }

    writeDeviceInfo(bytes : Uint8Array, offset : number) : number {
        bytes[offset] = this.deviceType!;

        return offset + 1;
    }

    readStatus(data: DataView, offset : number) : number {
        assert(data.getInt8(offset) == this.deviceType);

        const value = {
            acc:{
                x: data.getInt16(offset + 1, true) / 16384 * 9.80665, 
                y: data.getInt16(offset + 3, true) / 16384 * 9.80665, 
                z: data.getInt16(offset + 5, true) / 16384 * 9.80665
            }
            , 
            gyro:{
                x: data.getInt16(offset + 7, true)  / 131, 
                y: data.getInt16(offset + 9, true)  / 131, 
                z: data.getInt16(offset + 11, true) / 131
            }
        } as IMUValue;

        this.setIMU(value);

        // return the offset of the next status.
        return offset + 13;
    }

    private connectionChanged(state: BLEConnectionState): void {
        if (state.phase !== "connected" || !state.imuAvailable || !state.streaming) {
            this.outputPort.setPortValue(undefined);
            this.balancePort.setPortValue(undefined);
        }
        theCanvas?.requestUpdateCanvas();
    }

    setIMU(value: IMUValue): void {
        if (this.removed || this.inToolbox) return;
        this.outputPort.setPortValue(value);
        // console.log("IMU", this.outputPort.structValue());
        theCanvas?.requestUpdateCanvas();
    }

    setBoxSize(): void { this.boxSize = new Vec2(this.inToolbox ? 240 : 440, this.inToolbox ? 60 : 160); }

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
            ctx.fillText("balance：姿勢 °・角速度 °/s・速度指令 %", this.position.x + 16, this.position.y + 106);
        }
        ctx.restore();
    }

    clearBlock(): void {
        this.removed = true;
        this.releaseStream?.();
        this.releaseBalance?.();
        this.releaseState?.();
        this.releaseStream = this.releaseState = this.releaseBalance = undefined;
        this.outputPort.setPortValue(undefined);
        this.balancePort.setPortValue(undefined);
        super.clearBlock();
    }
}

registerFunctionBlock(IMUBlock.name, () => new IMUBlock({}));
