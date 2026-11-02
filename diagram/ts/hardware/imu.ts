import { assert, Vec2, Vec3 } from "@i18n";
import { DeviceType, FunctionBlock, registerFunctionBlock } from "../block";
import { diagramBLE, type BLEConnectionState } from "../ble-wifi/ble";
import { imuStruct, type IMUValue, Vec3Value } from "../data_type";
import { PortType, theCanvas } from "../diagram_util";
import { StructPort } from "../port";
import type { Attr } from "../ui";

/** Like the distance sensor block, this block pushes one received measurement. */
export class IMUBlock extends FunctionBlock {
    readonly outputPort = new StructPort(this, PortType.outputPort, imuStruct, "imu");
    private releaseState?: () => void;
    private releaseStream?: () => void;
    private removed = false;

    constructor(data: Attr) {
        super(data);
        this.deviceType = DeviceType.IMU6Axis;
        this.ports = [this.outputPort];
        this.setBoxSize();
        if (!this.inToolbox) {
            this.releaseState = diagramBLE.subscribe(state => this.connectionChanged(state));
            this.releaseStream = diagramBLE.retainSensorStream(this);
        }
    }

    isSensor() : boolean {
        return true;
    }

    writeDeviceInfo(bytes : Uint8Array, offset : number) : number {
        bytes[offset] = this.deviceType!;

        return offset + 1;
    }

    /**
     * IMUレコードを物理量へ変換し、Telemetryの時刻とともに出力する。
     * @param time ESP32起動後の経過時間。単位はミリ秒。
     * @param data Telemetry全体のバイナリ。
     * @param offset IMUレコードの開始位置。
     * @returns 次のレコードの開始位置。
     */
    readStatus(time: number, data: DataView, offset: number): number {
        assert(data.getInt8(offset) == this.deviceType);

        const value = {
            time: time,
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
            let label: string;
            if (state.phase !== "connected") {
                label = "機器未接続";
            }
            else if (!diagramBLE.isSensorRegistered(this)) {
                label = "再接続して機器を登録";
            }
            else if (!state.imuAvailable) {
                label = "IMU未検出";
            }
            else {
                label = state.streaming ? `計測中：10 Hz (${state.transport === "wifi" ? "Wi-Fi" : "BLE"})` : "計測開始中";
            }
            ctx.fillText(label, this.position.x + 16, this.position.y + 40);
            ctx.font = "14px sans-serif";
            ctx.fillText("gyro：角速度 °/s", this.position.x + 16, this.position.y + 66);
            ctx.fillText("acc：加速度 m/s²", this.position.x + 16, this.position.y + 86);
        }
        ctx.restore();
    }

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

registerFunctionBlock(IMUBlock.name, () => new IMUBlock({}));
