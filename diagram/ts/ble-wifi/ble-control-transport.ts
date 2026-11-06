/** GATTの通常指令・機器一覧・通知をcontrol-connection.tsの共通通信経路へ接続する。 */
import type { ControlPacketKind, ControlTransport } from "./control-connection";
import type { BytecodeChannel } from "./bytecode-transfer";
import type { DebugChannel } from "./debug-protocol";

/** Web Bluetoothの通常通信に使う構造型。GATT参照は保存データへ含めない。 */
export interface ControlCharacteristic extends EventTarget {
    value?: DataView;
    startNotifications(): Promise<ControlCharacteristic>;
    readValue(): Promise<DataView>;
    writeValueWithResponse(value: Uint8Array): Promise<void>;
}

/**
 * Commandをresponse付きで書き、Status/Telemetryを実際のCharacteristicで区別して渡す。
 * 接続・通知開始・初期Read・切断はdevice-connection.tsが担当する。ここではパケットを解釈しない。
 */
export class BLEControlTransport implements ControlTransport {
    readonly kind = "ble";

    constructor(private command: ControlCharacteristic, private status: ControlCharacteristic,
        private telemetry: ControlCharacteristic, private deviceInfo: ControlCharacteristic,
        private isConnected: () => boolean, private loadBytecode: () => Promise<BytecodeChannel>,
        private loadDebug: () => Promise<DebugChannel>) {
    }

    /** ネイティブGATTの現在の接続状態を照合する。 */
    get connected(): boolean {
        return this.isConnected();
    }

    /** GATTの受付までを待つ。機器のACKは共通層が別に照合する。 */
    write(bytes: Uint8Array): Promise<void> {
        return this.command.writeValueWithResponse(bytes);
    }

    /** 既存DeviceInfo窓口へ一覧を送る。内容検証ACKはなく、契約は共通層のsendDeviceInfo()を参照。 */
    writeDeviceInfo(bytes: Uint8Array): Promise<void> {
        return this.deviceInfo.writeValueWithResponse(bytes);
    }

    /** 通常接続は追加UUIDを要求せず、プログラム送信時だけ既存のWrite/Result窓口を取得する。 */
    openBytecode(): Promise<BytecodeChannel> {
        return this.loadBytecode();
    }

    /** 4個のデバッグCharacteristicは利用時だけ遅延取得する。 */
    openDebug(): Promise<DebugChannel> {
        return this.loadDebug();
    }

    /** 通知購読の解除関数を返す。Wi-Fi切替後は旧GATT通知を共通層へ渡さない。 */
    subscribePackets(listener: (data: DataView | undefined, kind?: ControlPacketKind) => void): () => void {
        const status = (event: Event) => {
            listener((event.target as ControlCharacteristic).value, "status");
        };
        const telemetry = (event: Event) => {
            listener((event.target as ControlCharacteristic).value, "telemetry");
        };
        this.status.addEventListener("characteristicvaluechanged", status);
        this.telemetry.addEventListener("characteristicvaluechanged", telemetry);
        return () => {
            this.status.removeEventListener("characteristicvaluechanged", status);
            this.telemetry.removeEventListener("characteristicvaluechanged", telemetry);
        };
    }
}
