/** GATTの通常指令・機器一覧・通知をcontrol-connection.tsの共通通信経路へ接続する。 */
import type { ControlPacketKind, ControlTransport } from "./control-connection";
import type { BytecodeChannel } from "./bytecode-transfer";
import type { DebugChannel } from "./debug-protocol";
import type { RpcChannel } from "./rpc-protocol";

/** Web Bluetoothの通常通信に使う構造型。GATT参照は保存データへ含めない。 */
export interface ControlCharacteristic extends EventTarget {
    /**
     * 直前にReadまたはNotifyで得たGATT特性の値。
     */
    value?: DataView;
    /**
     * GATT特性の変更通知を開始し、通知元の特性を返す。
     */
    startNotifications(): Promise<ControlCharacteristic>;
    /**
     * 現在のGATT特性値を読み取る。
     */
    readValue(): Promise<DataView>;
    /**
     * GATTの受付応答を待ってバイト列を書き込む。
     *
     * @param value 検証または反映する値。
     */
    writeValueWithResponse(value: Uint8Array): Promise<void>;
}

/**
 * Commandをresponse付きで書き、Status/Telemetryを実際のCharacteristicで区別して渡す。
 * 接続・通知開始・初期Read・切断はdevice-connection.tsが担当する。ここではパケットを解釈しない。
 */
export class BLEControlTransport implements ControlTransport {
    /**
     * 共通通信層でBLEとWi-Fiの経路を区別する識別子。
     */
    readonly kind = "ble";

    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(/** 通常のCommandを書き込むGATT特性。 */ private command: ControlCharacteristic, /** 通常指令の受付結果をRead/Notifyで受け取るGATT特性。 */ private status: ControlCharacteristic,
        /**
         * センサー通知を受け取るGATT特性。
         */
        private telemetry: ControlCharacteristic, /** 機器一覧を書き込むGATT特性。 */ private deviceInfo: ControlCharacteristic,
        /**
         * 所有元のGATT接続が現時点で有効かを照合する処理。
         */
        private isConnected: () => boolean, /** 専用のプログラム転送窓口を遅延取得する処理。 */ private loadBytecode: () => Promise<BytecodeChannel>,
        /**
         * 専用のデバッグ窓口を遅延取得する処理。
         */
        private loadDebug: () => Promise<DebugChannel>,
        /** RPCを利用するときだけ3個の専用Characteristicを取得する。 */
        private loadRpc?: () => Promise<RpcChannel>) {
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

    /** RPC用の窓口を遅延取得する。通常接続では追加UUIDを要求しない。 */
    openRpc(): Promise<RpcChannel> {
        return this.loadRpc ? this.loadRpc() : Promise.reject(new Error("RPC窓口がありません"));
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
