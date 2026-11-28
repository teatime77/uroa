/**
 * 機器一覧とセンサー通知の共通定数、および通知全件の検証を担当する。ブロックへの反映は呼出し元が登録順を照合してから行う。
 * 固定長ヘッダーとレコード長はdevice.protoから生成した配置を使う。登録順・変換・検証は本層が担当する。
 */
import { packetLayouts } from "./device-rpc.generated";
/**
 * ESP32と共有する機器一覧の最大バイト数。
 * DeviceInfoは版番号・件数を付けず、センサー→アクチュエータの順にレコードを連結する。
 * IMU6Axis=0、IMU9Axis=1、距離=2、Camera=3は種別1バイト。
 * ServoMotor=128は種別・CH(0〜15)・mode(0角度/1速度)の3バイト。
 * 空一覧は0バイト。未使用領域の0埋めはIMUとして解釈されるため送らない。
 * BLEとWi-Fiで同じ内容を使う。配送・完了の範囲はcontrol-connection.tsのsendDeviceInfo()を参照。
 */
export const DeviceInfoMaxLength = 20;
/**
 * 現在の機器別センサー通知で受け付ける版番号。
 */
export const DeviceTelemetryVersion = 3;
/**
 * 通知の版・状態・連番・時刻が占めるヘッダーのバイト長。
 */
export const DeviceTelemetryHeaderLength = packetLayouts.TelemetryHeader.byteLength;
/**
 * 種別と加速度・角速度の生値を含むIMUレコードのバイト長。
 */
export const IMU6AxisRecordLength = packetLayouts.ImuRecord.byteLength;
/**
 * 種別と距離uint16を含む超音波レコードのバイト長。
 */
export const UltrasonicRecordLength = packetLayouts.DistanceRecord.byteLength;
/**
 * 全機器が最大長のIMUレコードだった場合の通知上限。
 */
export const DeviceTelemetryMaxLength = DeviceTelemetryHeaderLength + DeviceInfoMaxLength * IMU6AxisRecordLength;
/**
 * 未測定・測定失敗を表す距離の予約値。
 */
export const InvalidDistanceMm = 0xFFFF;
/**
 * 有効な距離として受け付ける下限（mm）。
 */
export const MinDistanceMm = 20;
/**
 * 有効な距離として受け付ける上限（mm）。
 */
export const MaxDistanceMm = 4000;

/** 検証済みのレコード種別と、DataView内の開始位置。 */
export interface DeviceTelemetryRecord {
    /**
     * 検証済みレコードの機器種別番号。
     */
    readonly deviceType: number;
    /**
     * 通知全体のDataView内でレコードが始まるバイト位置。
     */
    readonly offset: number;
}

/** 通知の時刻とレコード一覧。ブロックへの反映は呼出側が全件照合後に行う。 */
export interface DeviceTelemetry {
    /**
     * ESP32起動からの経過時間millisを復号した値。
     */
    readonly time: number;
    /**
     * 全件検証済みのレコード種別と開始位置を受信順に保持する一覧。
     */
    readonly records: readonly DeviceTelemetryRecord[];
}

/**
 * 可変長のIMU・超音波距離通知を、ポートへ反映せずに全件検証する。
 * @param data 通知全体のDataView。byteOffsetを持つビューもそのまま扱う。
 * @returns ESP32のmillisと、受信順のレコード位置。
 */
export function parseDeviceTelemetry(data: DataView): DeviceTelemetry {
    if (data.byteLength < DeviceTelemetryHeaderLength || data.byteLength > DeviceTelemetryMaxLength ||
        data.getUint8(0) !== DeviceTelemetryVersion) {
        throw new Error("機器別Telemetryのヘッダーまたは長さが不正です。");
    }
    const records: DeviceTelemetryRecord[] = [];
    let offset = DeviceTelemetryHeaderLength;
    while (offset < data.byteLength) {
        if (records.length >= DeviceInfoMaxLength) {
            throw new Error("機器別Telemetryのセンサー数が上限を超えています。");
        }
        const deviceType = data.getUint8(offset);
        let length: number;
        // DeviceTypeの定義と同じ値。ブロック・UIへ依存させず、両通信経路で使う。
        if (deviceType === 0) {
            length = IMU6AxisRecordLength;
        }
        else if (deviceType === 2) {
            length = UltrasonicRecordLength;
        }
        else {
            throw new Error(`未対応のTelemetryセンサー種別です：${deviceType}`);
        }
        if (offset + length > data.byteLength) {
            throw new Error("機器別Telemetryのレコードが途中で切れています。");
        }
        if (deviceType === 2) {
            const distanceMm = data.getUint16(offset + 1, true);
            if (distanceMm !== InvalidDistanceMm && (distanceMm < MinDistanceMm || distanceMm > MaxDistanceMm)) {
                throw new Error("超音波距離の測定値が範囲外です。");
            }
        }
        records.push({ deviceType, offset });
        offset += length;
    }
    return { time: data.getUint32(4, true), records };
}
