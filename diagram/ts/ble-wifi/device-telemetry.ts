/** ESP32と共有する機器種別付きTelemetry version=3の形式。 */
export const DeviceInfoMaxLength = 20;
export const DeviceTelemetryVersion = 3;
export const DeviceTelemetryHeaderLength = 8;
export const IMU6AxisRecordLength = 13;
export const UltrasonicRecordLength = 3;
export const DeviceTelemetryMaxLength = DeviceTelemetryHeaderLength + DeviceInfoMaxLength * IMU6AxisRecordLength;
export const InvalidDistanceMm = 0xFFFF;
export const MinDistanceMm = 20;
export const MaxDistanceMm = 4000;

/** 検証済みのレコード種別と、DataView内の開始位置。 */
export interface DeviceTelemetryRecord {
    readonly deviceType: number;
    readonly offset: number;
}

/** 通知の時刻とレコード一覧。ブロックへの反映は呼出側が全件照合後に行う。 */
export interface DeviceTelemetry {
    readonly time: number;
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
