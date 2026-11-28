import * as wire from "../ble-wifi/device-wire.generated";
/**
 * ESP32のIMU通知から時刻・角速度・加速度を構造体ポートへ出力する。
 * 状態・共有STREAMはdevice.protoのRPC購読APIへ渡し、登録と配送はdevice-connection.tsへ委譲する。
 */
import { assert, Vec2, Vec3 } from "@i18n";
import { DeviceType, FunctionBlock, registerFunctionBlock } from "../block";
import { diagramDevice, type DeviceConnectionState } from "../ble-wifi/device-connection";
import { imuStruct, type IMUValue, Vec3Value } from "../data_type";
import { PortType, theCanvas } from "../diagram_util";
import { StructPort } from "../port";
import type { Attr } from "../ui";

/** Like the distance sensor block, this block pushes one received measurement. */
export class IMUBlock extends FunctionBlock {
    /**
     * 通知時刻・角速度・加速度をまとめて渡すIMU構造体出力。
     */
    readonly outputPort = new StructPort(this, PortType.outputPort, imuStruct, "imu");
    /**
     * 機器接続状態の購読を解除する関数。
     */
    private releaseState?: () => void;
    /**
     * 共有センサーSTREAMの保持要求を解放する関数。
     */
    private releaseStream?: () => void;
    /**
     * 削除済みの部品に非同期結果を反映しないための状態。
     */
    private removed = false;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data: Attr) {
        super(data);
        this.deviceType = DeviceType.IMU6Axis;
        this.ports = [this.outputPort];
        this.setBoxSize();
        if (!this.inToolbox) {
            this.releaseState = diagramDevice.rpc.subscribe("device.state", state => this.connectionChanged(state));
            this.releaseStream = diagramDevice.rpc.subscribe("sensors.stream", this);
        }
    }

    /**
     * DeviceInfoへセンサーとして登録することを示す。
     */
    isSensor() : boolean {
        return true;
    }

    /**
     * DeviceInfoへIMU6Axisの種別を書き込み、次の位置を返す。
     *
     * @param bytes 読み書きするバイト列。
     * @param offset バイト列内の開始位置。
     */
    writeDeviceInfo(bytes : Uint8Array, offset : number) : number {
        return wire.writeDeviceInfoRecordsRecord(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset,
            { deviceType: this.deviceType! });
    }

    /**
     * IMUレコードを物理量へ変換し、Telemetryの時刻とともに出力する。
     * @param time ESP32起動後の経過時間。単位はミリ秒。
     * @param data Telemetry全体のバイナリ。
     * @param offset IMUレコードの開始位置。
     * @returns 次のレコードの開始位置。
     */
    readStatus(time: number, data: DataView, offset: number): number {
        const record = wire.readImuRecord(data, offset);
        assert(record.deviceType == this.deviceType);

        const value = {
            time: time,
            acc:{
                x: record.accX / 16384 * 9.80665, 
                y: record.accY / 16384 * 9.80665, 
                z: record.accZ / 16384 * 9.80665
            }
            , 
            gyro:{
                x: record.gyroX  / 131, 
                y: record.gyroY  / 131, 
                z: record.gyroZ / 131
            }
        } as IMUValue;

        this.setIMU(value);

        // return the offset of the next status.
        return offset + wire.wireLayouts.ImuRecord.byteLength;
    }

    /**
     * 切断または通知停止時の古い出力を消去し、接続表示を更新する。
     */
    private connectionChanged(state: DeviceConnectionState): void {
        if (state.phase !== "connected" || !state.imuAvailable || !state.streaming) {
            this.outputPort.setPortValue(undefined);
        }
        theCanvas?.requestUpdateCanvas();
    }

    /**
     * 時刻・3軸角速度・3軸加速度を型検証し、現在のサンプルとして出力する。
     *
     * @param value 検証または反映する値。
     */
    setIMU(value: IMUValue): void {
        if (this.removed || this.inToolbox) return;
        this.outputPort.setPortValue(value);
        // console.log("IMU", this.outputPort.structValue());
        theCanvas?.requestUpdateCanvas();
    }

    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize(): void { this.boxSize = new Vec2(this.inToolbox ? 240 : 440, this.inToolbox ? 60 : 160); }

    /**
     * 同じ種類のブロックを作成し、複製対象の設定をコピーする。
     */
    copy(): IMUBlock {
        const block = new IMUBlock({});
        this.copyUI(block);
        block.setBoxSize();
        return block;
    }

    /**
     * この部品の枠・内容・操作状態をキャンバスへ描く。
     */
    draw(): void {
        super.draw();
        const ctx = this.ctx;
        ctx.save();
        ctx.font = "18px sans-serif";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#17384f";
        ctx.fillText("IMU", this.position.x + 16, this.position.y + 14);
        if (!this.inToolbox) {
            const state = diagramDevice.state;
            let label: string;
            if (state.phase !== "connected") {
                label = "機器未接続";
            }
            else if (!diagramDevice.isSensorRegistered(this)) {
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

    /**
     * 接続・イベント・所有資源を解放してブロックを削除可能にする。
     */
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
