/**
 * diagramの機器接続UI・機器登録・サーボ状態とPythonプログラムの通信窓口をまとめる。
 * 呼出元はdevice-rpc.tsの型付きRPC APIを使う。通常指令は生成した呼出し表へサービス単位で状態検査を接続する。
 * opcode・単位・Status結果の対応はdevice.proto、配送・ACKはControlConnectionを参照する。
 * 経路別通信はBLEControlTransportとRobotWifi、共通の待ち列とACK照合はControlConnectionへ委譲する。
 * 通常StatusはControlConnectionが生成codecで復号・検査した値を使い、生バイトの再解釈を行わない。
 */
import { readTransferResult } from "./device-wire.generated";
import { gattUuids as BLE_UUID } from "./device-wire.generated";
import { Vec2 } from "@i18n";
import { DeviceType, FunctionBlock, registerFunctionBlock } from "../block";
import { Button, type Attr, type UI } from "../ui";
import { theCanvas } from "../diagram_util";
import { BLEWifiSetup, RobotWifi, type RobotEndpoint } from "./robot-wifi";
import { RobotWifiDialog } from "./robot-wifi-dialog";
import { setCameraProvider } from "../camera/camera-feed";
import { theEditor } from "../json-util";
import { DeviceInfoMaxLength, type DeviceTelemetry } from "./device-telemetry";
import { ControlConnection, type ControlCallContext } from "./control-connection";
import { createControlCalls, type ServoControlInvocation, type ProgramControlInvocation } from "./device-control.generated";
import { BLEControlTransport, type ControlCharacteristic } from "./ble-control-transport";
import { checkBytecodeTransfer, type BytecodeReceipt, type BytecodeProgress, type BytecodeDeployment } from "./bytecode-transfer";
import { PythonDebugTransport, type DebugSnapshot, type DebugEvent, type DebugAction } from "./debug-protocol";
import type { RpcChannel } from "./rpc-protocol";
import { RpcTransport } from "./rpc-protocol";
import { RpcClient, RpcCode, RpcError, rpcSignal } from "./rpc-client";
import type { DeviceRpcCalls, DeviceRpcClient, DeviceRpcSubscriptions, RemoteRpcCalls } from "./device-rpc";
import { StatusCode, type StatusPacket } from "./device-rpc.generated";

// GATT service shared with esp32/app/diagram-control.
/**
 * @remarks
 * ## GATT
 *
 * Serviceは`f3641400-00b0-4240-ba50-05ca45bf8abc`。UUIDの残り部分はServiceと同じ。
 *
 * | Characteristic | UUID先頭 | Properties | サイズ |
 * |---|---|---|---|
 * | Bytecode | f3641407 | Write with response | 10〜244 bytes（合意MTU以下） |
 * | Bytecode Result | f3641408 | Read | 20 bytes |
 * | Debug Control / Result / Event / Data | f3641409 / 140a / 140b / 140c | Write / Read / Read+Notify / Read | 最大20 bytes |
 *
 * Command・Status・Telemetry・DeviceInfoとは別の窓口。Writeは合意ATT MTU-3以下・最大244バイトで必ずresponse付きにする。GATTの受付だけではプログラムの受信完了とせず、一括転送のCOMMIT後に専用ResultをReadして、ESP32のloop()による検証・必要な開始の結果を確認する。
 * デバッグ通信の完全な形式・停止値・一覧確定の仕様はdebug-protocol.tsを参照する。
 */
export { gattUuids as BLE_UUID } from "./device-wire.generated";


// Structural types keep this browser-only module independent of the robot build.
type BLECharacteristic = ControlCharacteristic;
/**
 * 制御に必要なGATT特性を取得する最小サービス型。
 */
interface BLEService { /** 指定UUIDのGATT特性を取得する。 */ getCharacteristic(uuid: string): Promise<BLECharacteristic>; }
/**
 * GATT接続・切断・サービス取得に使うブラウザーAPIの構造型。
 */
interface BLEServer {
    /**
     * 通信経路が現在利用できる接続状態。
     */
    connected: boolean;
    /**
     * GATTサーバーへ接続し、利用可能になったサーバーを返す。
     */
    connect(): Promise<BLEServer>;
    /**
     * 現在のGATT接続を切断する。
     */
    disconnect(): void;
    /**
     * 指定UUIDの主GATTサービスを取得する。
     */
    getPrimaryService(uuid: string): Promise<BLEService>;
}
/**
 * 接続名とGATTサーバーを持つ選択済みBLE機器の構造型。
 */
interface BLEDevice extends EventTarget { /** 表示・保存・名前解決に使用する名前。 */ name?: string; /** Web Bluetoothが提供する、この機器のGATTサーバー参照。 */ gatt?: BLEServer; }
/**
 * ブラウザーのBLE機器選択に必要な最小API。
 */
interface BLEAdapter {
    /**
     * 利用者の選択操作でBLE機器へのアクセス許可を要求する。
     */
    requestDevice(options: { /** 利用者が選ぶBLE機器を名前で限定しない選択条件。 */ acceptAllDevices: true; /** 選択後にアクセスを許可してもらうGATTサービスのUUID一覧。 */ optionalServices: string[] }): Promise<BLEDevice>;
}
/**
 * 機器選択・接続中・接続済み・失敗等のUI上の接続段階。
 */
export type DeviceConnectionPhase = "idle" | "selecting" | "connecting" | "connected" | "error" | "unavailable";
/**
 * ブロックが参照する接続名・表示メッセージと機器の利用状態。
 */
export interface DeviceConnectionState { /** 接続または転送の進行段階。 */ phase: DeviceConnectionPhase; /** 現在の接続先を画面に表示する名前。 */ deviceName: string; /** 接続・操作・失敗の状態を利用者へ伝える文字列。 */ message: string; /** 機器側StatusでPCA9685が利用可能と報告された状態。 */ pcaAvailable: boolean; /** 機器側StatusでIMUが利用可能と報告された状態。 */ imuAvailable: boolean; /** 機器側Statusでセンサー通知が有効と報告された状態。 */ streaming: boolean; /** 現在採用しているBLEまたはWi-Fiの経路名。 */ transport?: "ble" | "wifi"; }
/**
 * CHを有効化するときに固定する角度または連続回転速度の操作モード。
 */
export type ServoMode = "angle" | "speed";

/**
 * 図の接続UI・機器登録・機器状態・プログラム通信の窓口。GATT参照は保存しない。
 * 呼出しと購読の公開APIはdiagramDevice.rpc。型と操作定義はdevice.protoから生成する。
 * DeviceConnectionStateと状態判定は通信を起こさないローカル参照として公開する。
 * BLEControlTransport・BLEのGATT型・UUID・BLEWifiSetupは実際にBLE固有の処理なので区別する。
 * index.tsの型番号0とアイコンはDeviceConnectionBlock。旧保存型名BLEConnectionBlockは
 * 読込み用の別名だけを登録し、Block.makeObj()による新規保存・コピーは新しい型名を使う。
 * 通常指令・ACK・通知検証・PING・共通待ち列はcontrol-connection.tsへ委譲する。
 * BLE/Wi-Fiの切替・プログラム・デバッグ窓口とブロックへの反映を担当する。
 */
export class DeviceConnection {
    /**
     * 機器またはVMが報告した状態番号・状態値。
     */
    state: DeviceConnectionState = { phase: "idle", deviceName: "", message: "", pcaAvailable: false, imuAvailable: false, streaming: false };
    /**
     * 接続と機器状態の変更を購読するブロック等の集合。
     */
    private listeners = new Set<(state: DeviceConnectionState) => void>();
    /**
     * 共有センサーSTREAMを必要とする配置済みブロックの集合。
     */
    private sensorStreamUsers = new Set<FunctionBlock>();
    /**
     * 直前に要求した共有STREAMの通知周波数（Hz）。
     */
    private requestedRate = 0;
    /**
     * 現在選択・接続しているWeb Bluetooth機器。
     */
    private device?: BLEDevice;
    /**
     * 切断や経路変更の前に開始した非同期処理を失効させる接続世代。
     */
    private generation = 0;
    /**
     * 接続準備に設けた期限のタイマー。
     */
    private connectTimer?: ReturnType<typeof setTimeout>;
    /**
     * 有効化のACKが得られたCHと角度・速度モードの対応。
     */
    private armedChannels = new Map<number, ServoMode>();
    /**
     * CHごとの操作世代。無効化や切断後の古い操作結果を拒否する。
     */
    private servoVersions = Array<number>(16).fill(0);
    /**
     * 現在のGATT制御サービス。切断時に参照を失効させる。
     */
    private service?: BLEService;
    /**
     * 現在のWi-Fi制御経路の所有インスタンス。
     */
    private wifi?: RobotWifi;
    /**
     * 現在開いているWi-Fi設定・接続の入力ダイアログ。
     */
    private wifiDialog?: RobotWifiDialog;
    /** 開いているダイアログのBLE設定窓口。終了時に破棄し、RPC APIからのみ利用する。 */
    private wifiSetup?: BLEWifiSetup;
    /**
     * BLE経由のWi-Fi設定または接続準備を行っている状態。
     */
    private provisioning = false;
    /**
     * 切断処理の再入を防ぐ状態。
     */
    private closing = false;
    /**
     * 通常指令・ACK・PING・センサー通知と共通待ち列を管理する所有窓口。
     */
    private control = new ControlConnection({
        status: data => this.hardwareStatus(data),
        telemetry: (data, telemetry) => this.sampleChanged(data, telemetry),
        failed: error => this.close("error", error.message),
    });
    /** 更新はsendBytecode()だけが行う。別転送とWi-Fi設定の開始を抑止する。 */
    bytecodeSending = false;
    /** 現接続で最後に保持完了した転送。同一オブジェクトの間だけ再送を省略できる。切替で失効する。 */
    bytecodeReceipt?: BytecodeReceipt;
    /** 現接続の転送進捗。計測・表示の共通契約はbytecode-transfer.tsのuploadBytecode()を参照する。 */
    bytecodeProgress?: BytecodeProgress;
    /**
     * 現在の接続とプログラムの停止監視・デバッグ要求を担当する通信単位。
     */
    private debugger?: PythonDebugTransport;
    /**
     * デバッグ一覧の送信等で別操作の開始を抑止する状態。
     */
    private debuggerSending = false;
    /**
     * 接続内で再利用しないデバッグ要求IDの採番状態。
     */
    private debugRequestId = 0;
    /**
     * 停止値・取得エラー・VM状態を購読する処理の集合。
     */
    private debugListeners = new Set<(snapshot?: DebugSnapshot, error?: Error, event?: DebugEvent) => void>();
    /** 最新の検証済み停止値。更新はデバッグ受信とStart/Stop/切断だけが行い、呼出元は参照する。 */
    debugSnapshot?: DebugSnapshot;
    /**
     * 最後に受け取った停止値取得またはデバッグ通信のエラー。
     */
    debugError?: Error;
    /**
     * 停止値とは独立して保持する、最新の検証済みVM状態。
     */
    debugEvent?: DebugEvent;
    /**
     * DeviceInfoへ登録したセンサーブロックを受信レコード順に並べた一覧。
     */
    private sensors   : FunctionBlock[] = [];
    /**
     * DeviceInfoへ登録したアクチュエーターブロックの一覧。
     */
    private actuators : FunctionBlock[] = [];

    /**
     * 通常指令の生成表へServo・Program単位で機能状態のフックを接続する。
     * 数値変換・送信・結果処理は生成側、ACK・世代・待ち列はControlConnectionが所有する。
     */
    private readonly commandCalls = createControlCalls(this.control, {
        Servo: invocation => this.prepareServoCommand(invocation),
        Program: invocation => this.prepareProgramCommand(invocation),
    });

    /** 通常指令は生成した表、未移行の転送・設定等は既存アダプターへ接続する。 */
    readonly rpc: DeviceRpcClient = new RpcClient<DeviceRpcCalls, DeviceRpcSubscriptions>({
        "connection.connect": async () => {
            await this.connect();
            if (this.state.phase !== "connected") {
                throw new RpcError(RpcCode.Unavailable, this.state.message || "ESP32へ接続できませんでした。");
            }
        },
        "connection.disconnect": request => this.disconnect(request.reason),
        "device.register": () => this.sendDeviceInfo(),
        ...this.commandCalls,
        "program.upload": (request, options) => this.sendBytecode(request.code, options?.signal, request.deployment),
        "debug.breakpoints": (request, options) => this.sendBreakpoints(request.receipt, request.pcs, options?.signal, request.stepPcs),
        "debug.observe": (request, options) => this.observeDeployment(request.receipt, options?.signal),
        "debug.execute": (request, options) => {
            if (request.action !== "continue" && request.action !== "over" && request.action !== "in" && request.action !== "out") {
                throw new RpcError(RpcCode.InvalidArgument, "デバッグ操作が不正です。");
            }
            return this.executeDebug(request.receipt, request.snapshot, request.action, options?.signal);
        },
        "remote.open": request => this.openRemote(request.nonce),
        "wifi.open": async () => {
            await this.openWifi();
            if (!this.wifiDialog) {
                throw new RpcError(RpcCode.Unavailable, this.state.message || "Wi-Fi設定を開けませんでした。");
            }
        },
        "wifi.close": () => this.cancelWifiSetup(),
        "wifi.info": options => this.requireWifiSetup().info(rpcSignal(options)),
        "wifi.scan": async options => ({ networks: await this.requireWifiSetup().scan(rpcSignal(options)) }),
        "wifi.configure": (request, options) => this.requireWifiSetup().configure(request.ssid, request.password, rpcSignal(options)),
        "wifi.forget": options => this.requireWifiSetup().request({ op: "forget" }, rpcSignal(options)),
        "wifi.connect": (target, options) => this.connectWifi(target, rpcSignal(options)),
        "camera.capture": options => this.captureImage(rpcSignal(options)),
    }, {
        "device.state": listener => this.subscribe(listener),
        "debug.state": listener => this.subscribeDebugSnapshots((snapshot, error, event) => listener({ snapshot, error, event })),
        "sensors.stream": sensor => this.retainSensorStream(sensor),
    }, () => this.state.phase === "connected" ? this.state.transport : undefined);

    /** 現ダイアログが所有する設定窓口だけを返す。BLE認証と取消はBLEWifiSetupが検査する。 */
    private requireWifiSetup(): BLEWifiSetup {
        if (!this.wifiSetup) {
            throw new RpcError(RpcCode.Unavailable, "BLE接続先のWi-Fi設定を開いてください。");
        }
        return this.wifiSetup;
    }

    /** 認証済みJPEGの既存HTTP取得へ渡す。画像の共有と反復取得はcamera-feed.tsが所有する。 */
    private captureImage(signal: AbortSignal): Promise<Blob> {
        if (!this.wifi) {
            return Promise.reject(new Error("Wi-Fiカメラへ接続してください。"));
        }
        return this.wifi.image(signal);
    }

    /** Python Remoteの実行ごとに窓口を束縛し、専用プロトコルの操作も共通のcall()で公開する。 */
    private async openRemote(nonce: number): Promise<RpcClient<RemoteRpcCalls>> {
        const generation = this.generation;
        const transport = new RpcTransport(await this.openRpc(), nonce);
        return new RpcClient<RemoteRpcCalls>({
            "registry.configure": (request, options) => transport.configure(request.config, rpcSignal(options)),
            "request.read": () => transport.read(),
            "request.acknowledge": request => transport.acknowledge(request.id),
            "registry.end": () => transport.end(),
        }, {}, () => this.generation === generation && this.state.phase === "connected" ? this.state.transport : undefined);
    }

    /**
     * 指定CHの有効化ACKがあり、指定時はモードも一致するかを調べる。
     *
     * @param channel 操作対象のサーボCH番号。
     */
    isServoArmed(channel: number, mode?: ServoMode): boolean {
        return this.armedChannels.has(channel) && (mode === undefined || this.armedChannels.get(channel) === mode);
    }

    /**
     * 現在の接続状態を登録済み購読者へ通知する。
     */
    private notify(): void { this.listeners.forEach(listener => listener(this.state)); }

    /**
     * 全CHの有効化状態を消し、進行中のCH操作の世代を失効させる。
     */
    private resetServos(): void {
        this.armedChannels.clear();
        this.servoVersions = this.servoVersions.map(version => version + 1);
    }

    /**
     * CHが0〜15の整数かを検査する。
     *
     * @param channel 操作対象のサーボCH番号。
     */
    private checkChannel(channel: number): void {
        if (!Number.isInteger(channel) || channel < 0 || channel > 15) {
            throw new RpcError(RpcCode.InvalidArgument, "チャンネルは0～15の整数で指定してください。");
        }
    }

    /**
     * 現在の機器接続とPCA9685の利用可否を検査する。
     */
    private checkServoConnection(): void {
        if (this.state.phase !== "connected") {
            throw new RpcError(RpcCode.Unavailable, "機器接続ブロックでESP32へ接続してください。");
        }
        if (!this.state.pcaAvailable) {
            throw new RpcError(RpcCode.Device, "PCA9685が見つかりません。", StatusCode.CODE_HARDWARE);
        }
    }

    /** 停止操作の未接続時の省略と、現接続での失敗時だけ閉じる処理を共用する。 */
    private stopContext(message: string): ControlCallContext {
        const generation = this.generation;
        return {
            skip: this.state.phase !== "connected",
            failed: () => {
                if (generation === this.generation) {
                    this.close("error", message);
                }
            },
        };
    }

    /**
     * サーボの機能状態だけを検査・更新する。要求の数値変換と送信は生成呼出し表が担当する。
     * armのmodeは生成側のselectorで検査済み。角度は0〜180度、移動時間0〜10000ms、速度−100〜100%。
     * 範囲はdiagram-control/include/config.hと共有ドライバーに合わせる。有効化は現世代のACK後だけ記録する。
     */
    private prepareServoCommand(invocation: ServoControlInvocation): ControlCallContext {
        if (invocation.name === "servo.stop") {
            this.debugger?.invalidateSnapshot();
            this.resetServos();
            this.notify();
            return this.stopContext("サーボの停止を確認できません。再接続してください。");
        }
        const channel = invocation.request.channel;
        this.checkChannel(channel);
        if (invocation.name === "servo.disable") {
            this.servoVersions[channel]++;
            this.armedChannels.delete(channel);
            this.notify();
            return this.stopContext("サーボの停止を確認できません。再接続してください。");
        }
        this.checkServoConnection();
        if (invocation.name === "servo.arm") {
            const mode = invocation.request.mode as ServoMode;
            const version = ++this.servoVersions[channel];
            return {
                isCurrent: () => version === this.servoVersions[channel],
                accepted: () => {
                    this.armedChannels.set(channel, mode);
                    this.notify();
                },
            };
        }
        const mode = invocation.name === "servo.move" ? "angle" : "speed";
        if (invocation.name === "servo.move") {
            const angle = invocation.request.angle;
            const duration = invocation.request.duration;
            if (!Number.isFinite(angle) || angle < 0 || angle > 180) {
                throw new RpcError(RpcCode.InvalidArgument, "角度は0～180°で指定してください。");
            }
            if (!Number.isInteger(duration) || duration < 0 || duration > 10000) {
                throw new Error("移動時間は0～10000msの整数で指定してください。");
            }
        }
        else {
            const percent = invocation.request.percent;
            if (!Number.isFinite(percent) || percent < -100 || percent > 100) {
                throw new Error("速度は−100～100%で指定してください。");
            }
        }
        if (!this.isServoArmed(channel, mode)) {
            throw new Error(mode === "angle" ? "先に角度モードで90°の有効化を行ってください。" : "先に速度モードで0%の有効化を行ってください。");
        }
        const version = this.servoVersions[channel];
        return { isCurrent: () => version === this.servoVersions[channel] && this.isServoArmed(channel, mode) };
    }

    /**
     * Web Bluetoothや動作環境の利用可否を案内するメッセージを返す。
     */
    availabilityMessage(): string {
        if (!window.isSecureContext) return "HTTPS、またはこのPCのlocalhostで開いてください。";
        if (!(navigator as Navigator & { /** ブラウザーが公開するWeb Bluetoothの機器選択入口。 */ bluetooth?: BLEAdapter }).bluetooth) return "このブラウザーではBLEを利用できません。";
        return "";
    }

    /**
     * 接続状態の購読を登録し、現在値を通知して解除関数を返す。
     *
     * @param listener 変更通知を受け取る処理。
     */
    private subscribe(listener: (state: DeviceConnectionState) => void): () => void {
        this.listeners.add(listener);
        listener(this.state);
        return () => {
            this.listeners.delete(listener);
            if (!this.listeners.size) this.disconnect();
        };
    }

    /** 配置されたセンサーブロックの共有10Hz STREAM利用を登録し、解除関数を返す。 */
    private retainSensorStream(sensor: FunctionBlock): () => void {
        this.sensorStreamUsers.add(sensor);
        this.updateStream();
        let released = false;
        return () => {
            if (released) {
                return;
            }
            released = true;
            this.sensorStreamUsers.delete(sensor);
            this.updateStream();
        };
    }

    /** 接続時に送ったDeviceInfoの受信先として登録されているか調べる。 */
    isSensorRegistered(sensor: FunctionBlock): boolean {
        return this.sensors.includes(sensor);
    }

    /**
     * 登録済みセンサーブロックの需要に合わせて共有STREAMを開始・停止する。
     */
    private updateStream(): void {
        if (this.state.phase !== "connected" || this.provisioning) return;
        const available = this.sensors.some(sensor => this.sensorStreamUsers.has(sensor) &&
            (sensor.deviceType === DeviceType.UltrasonicDistanceSensor ||
                (sensor.deviceType === DeviceType.IMU6Axis && this.state.imuAvailable)));
        const rate = available ? 10 : 0;
        if (rate === this.requestedRate) return;
        this.requestedRate = rate;
        const generation = this.generation;
        void this.control.internalCalls["control.stream"]({ rate }).catch(error => {
            if (generation === this.generation) this.close("error", error.message);
        });
    }

    /**
     * 現在の接続状態を更新し、UI等の購読者へ通知する。
     *
     * @param message 画面または診断に表示する説明。
     */
    private publish(phase: DeviceConnectionPhase, deviceName = "", message = ""): void {
        const active = phase === "connected" || phase === "connecting";
        this.state = { phase, deviceName, message, pcaAvailable: active && this.state.pcaAvailable, imuAvailable: active && this.state.imuAvailable, streaming: active && this.state.streaming,
            transport: this.wifi?.connected ? "wifi" : "ble" };
        this.notify();
    }

    /**
     * 検証済みStatusからPCA・IMU・STREAMの状態を反映する。
     *
     * @param data 生成codecで検証・復号済みのStatus値。
     */
    private hardwareStatus(data: StatusPacket): void {
        const flags = data.flags;
        const pcaAvailable = !!(flags & 1), imuAvailable = !!(flags & 2), streaming = !!(flags & 8);
        const stopped = !pcaAvailable || (!(flags & 4) && (this.armedChannels.size > 0 || data.sequence === 0));
        if (stopped) this.resetServos();
        const channel = data.channel;
        const mode: ServoMode = flags & 0x10 ? "speed" : "angle";
        if (channel < 16 && this.armedChannels.has(channel) && this.armedChannels.get(channel) !== mode) {
            this.armedChannels.delete(channel);
            this.servoVersions[channel]++;
            this.notify();
        }
        const channelStopped = data.code === StatusCode.CODE_NOT_ARMED && channel < 16 && this.armedChannels.delete(channel);
        if (channelStopped) this.servoVersions[channel]++;
        if (stopped || channelStopped || this.state.pcaAvailable !== pcaAvailable || this.state.imuAvailable !== imuAvailable || this.state.streaming !== streaming) {
            this.state = { ...this.state, pcaAvailable, imuAvailable, streaming };
            this.notify();
            this.updateStream();
        }
    }

    /** 共通層で検証した通知を、登録センサーの全件・順序を照合してから反映する。 */
    private sampleChanged(value: DataView, telemetry: DeviceTelemetry): void {
        if (this.state.phase !== "connected" || !this.state.streaming || !this.requestedRate) {
            return;
        }
        const sensors = this.sensors;
        if (telemetry.records.length !== sensors.length) {
            throw new Error("機器別Telemetryと登録センサー数が一致しません。");
        }
        for (let index = 0; index < sensors.length; index++) {
            if (telemetry.records[index].deviceType !== sensors[index].deviceType) {
                throw new Error("機器別Telemetryの種別と登録センサー順が一致しません。");
            }
        }
        for (let index = 0; index < sensors.length; index++) {
            sensors[index].readStatus(telemetry.time, value, telemetry.records[index].offset);
        }
    }

    /**
     * GATT切断時に現在の通信・機器状態を失効させるイベントハンドラー。
     */
    private lost = (): void => {
        if (this.wifi?.connected) return;
        this.close("idle", "BLE接続が切れました。");
    };
    /**
     * 接続世代・通信・有効CH・停止監視・機器一覧を失効させ、終了状態を公開する。
     *
     * @param message 画面または診断に表示する説明。
     */
    private close(phase: DeviceConnectionPhase, message = ""): void {
        if (this.state.phase !== "idle" || this.device || this.wifi) {
            console.info("[Device connection] close", {
                transport: this.state.transport ?? "ble", phase: this.state.phase,
                reason: message || "接続終了", bytecodeSending: this.bytecodeSending,
            });
        }
        this.closing = true;
        this.resetDebugger();
        this.debugRequestId = 0;
        this.bytecodeReceipt = undefined;
        this.bytecodeProgress = undefined;
        this.generation++;
        this.control.close();
        this.wifiDialog?.close(); this.wifiDialog = undefined;
        this.wifiSetup = undefined;
        this.provisioning = false;
        this.wifi?.close(); this.wifi = undefined; this.service = undefined;
        setCameraProvider();
        this.state.transport = "ble";
        this.resetServos();
        clearTimeout(this.connectTimer);
        this.connectTimer = undefined;
        this.requestedRate = 0;
        this.sensors = [];
        this.actuators = [];
        this.device?.removeEventListener("gattserverdisconnected", this.lost);
        const device = this.device;
        this.device = undefined;
        try { device?.gatt?.disconnect(); } catch { /* Already disconnected. */ }
        this.publish(phase, "", message);
        this.closing = false;
    }

    /** 明示切断と画面のライフサイクルによる切断の理由を表示・コンソールへ残す。 */
    private disconnect(reason = "切断要求"): void {
        this.close("idle", reason);
    }
    /**
     * 現在のWi-Fi設定ダイアログと進行中の設定を終了する。
     */
    private cancelWifiSetup(): void { this.wifiDialog?.close(); }

    /**
     * 利用者の機器選択からGATT接続・通知・機器登録を進め、現世代の接続を公開する。
     */
    private async connect(): Promise<void> {
        if (["selecting", "connecting", "connected"].includes(this.state.phase)) return;
        const unavailable = this.availabilityMessage();
        if (unavailable) { this.publish("unavailable", "", unavailable); return; }
        const generation = ++this.generation;
        let selected: BLEDevice | undefined;
        let stage = "機器選択";
        const reportFailure = (name: string, message: string) => {
            console.error("[BLE] 接続失敗", { stage, name, message });
        };
        const check = () => {
            if (this.generation !== generation) {
                // A cancelled native connect can resolve after Clear or pagehide.
                if (selected !== this.device) selected?.gatt?.disconnect();
                throw new Error("接続を取り消しました。");
            }
        };
        this.publish("selecting");
        try {
            const bluetooth = (navigator as Navigator & { /** ブラウザーが公開するWeb Bluetoothの機器選択入口。 */ bluetooth: BLEAdapter }).bluetooth;
            // Called synchronously from the canvas button's pointerup user gesture.
            selected = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [BLE_UUID.service] });
            check();
            if (!selected.gatt) throw new Error("この機器はBLE接続に対応していません。");
            this.device = selected;
            selected.addEventListener("gattserverdisconnected", this.lost);
            this.publish("connecting", selected.name || "名前のない機器");
            // The chooser has no deadline; only GATT initialization is timed out.
            this.connectTimer = setTimeout(() => {
                if (this.generation === generation) {
                    reportFailure("TimeoutError", "接続がタイムアウトしました。");
                    this.close("error", `${stage}でタイムアウトしました。再接続してください。`);
                }
            }, 15_000);
            stage = "GATT接続";
            const server = await selected.gatt.connect();
            check();
            stage = "サービス取得";
            const service = await server.getPrimaryService(BLE_UUID.service);
            this.service = service;
            check();
            stage = "指令Characteristic取得";
            const tx = await service.getCharacteristic(BLE_UUID.command);
            check();
            stage = "状態Characteristic取得";
            const status = await service.getCharacteristic(BLE_UUID.status);
            check();
            stage = "センサーCharacteristic取得";
            const rx = await service.getCharacteristic(BLE_UUID.telemetry);
            check();
            stage = "機器情報Characteristic取得";
            const deviceInfo = await service.getCharacteristic(BLE_UUID.deviceInfo);
            check();
            this.control.bind(new BLEControlTransport(tx, status, rx, deviceInfo, () =>
                this.generation === generation && !!selected?.gatt?.connected, async () => {
                    check();
                    const write = await service.getCharacteristic(BLE_UUID.bytecode);
                    check();
                    const result = await service.getCharacteristic(BLE_UUID.bytecodeResult);
                    check();
                    const capability = await result.readValue();
                    check();
                    if (capability.byteLength !== 20) {
                        throw new Error("コード転送対応のファームウェアへ更新してください。");
                    }
                    const transfer = readTransferResult(capability);
                    if (transfer.version !== 2) {
                        throw new Error("一括転送対応のファームウェアへ更新してください。");
                    }
                    const packetLength = transfer.frame;
                    if (packetLength < 20 || packetLength > 244) {
                        throw new Error(`ESP32のBLE転送サイズが不正です: ${packetLength}バイト。`);
                    }
                    return {
                        packetLength,
                        write: bytes => write.writeValueWithResponse(bytes),
                        readResult: () => result.readValue(),
                    };
                }, async () => {
                    check();
                    const control = await service.getCharacteristic(BLE_UUID.debugControl);
                    check();
                    const result = await service.getCharacteristic(BLE_UUID.debugResult);
                    check();
                    const event = await service.getCharacteristic(BLE_UUID.debugEvent);
                    check();
                    const data = await service.getCharacteristic(BLE_UUID.debugData);
                    check();
                    return {
                        writeControl: bytes => control.writeValueWithResponse(bytes),
                        readResult: () => result.readValue(),
                        readEvent: () => event.readValue(),
                        readData: () => data.readValue(),
                        startEvents: () => event.startNotifications(),
                        subscribeEvents: listener => {
                            event.addEventListener("characteristicvaluechanged", listener);
                            return () => {
                                event.removeEventListener("characteristicvaluechanged", listener);
                            };
                        },
                    };
                }, async () => {
                    check();
                    const control = await service.getCharacteristic(BLE_UUID.rpcControl);
                    check();
                    const result = await service.getCharacteristic(BLE_UUID.rpcResult);
                    check();
                    const event = await service.getCharacteristic(BLE_UUID.rpcEvent);
                    check();
                    return { writeControl: bytes => control.writeValueWithResponse(bytes),
                        readResult: () => result.readValue(), readEvent: () => event.readValue() };
                }));
            stage = "状態通知登録";
            await status.startNotifications();
            check();
            stage = "センサー通知登録";
            await rx.startNotifications();
            check();
            stage = "初期状態取得";
            const initialStatus = await status.readValue();
            check();
            this.control.receive(initialStatus, "status");
            check();
            stage = "INFO応答確認";
            await this.commandCalls["device.info"](); // INFO ACK confirms application readiness, not motion completion.
            check();
            stage = "機器情報登録";
            await this.sendDeviceInfo();
            check();
            clearTimeout(this.connectTimer); this.connectTimer = undefined;
            this.publish("connected", selected.name || "名前のない機器");
            this.updateStream();
            this.control.startHeartbeat(() => this.commandCalls["device.ping"]());
        } catch (error) {
            if (this.generation !== generation) return;
            const name = error instanceof Error ? error.name : "";
            if (!selected && name === "NotFoundError") this.close("idle");
            else {
                const message = error instanceof Error ? error.message : "BLE接続に失敗しました。";
                reportFailure(name, message);
                this.close("error", `${stage}: ${name === "NotFoundError" ? "このデモに対応した機器ではありません。" : message}`);
            }
        }
    }

    /**
     * 現在のBLE機器から設定窓口を取得し、Wi-Fi設定・接続のダイアログを開く。
     */
    private async openWifi(): Promise<void> {
        if (this.bytecodeSending || this.debuggerSending) {
            return;
        }
        if (this.wifiDialog || ["selecting", "connecting"].includes(this.state.phase) || this.wifi?.connected) return;
        if (!this.service || !this.device?.gatt?.connected) {
            this.state = { ...this.state, message: "先に「接続」でESP32へBLE接続してから、Wi-Fi設定を開いてください。" }; this.notify();
            return;
        }
        const generation = this.generation;
        try {
            this.resetDebugger();
            this.provisioning = true;
            this.control.stopHeartbeat();
            await this.commandCalls["servo.stop"]();
            await this.control.internalCalls["control.stream"]({ rate: 0 });
            this.requestedRate = 0;
            const tx = await this.service.getCharacteristic(BLE_UUID.wifiConfig);
            const rx = await this.service.getCharacteristic(BLE_UUID.wifiResult);
            if (generation !== this.generation) return;
            this.wifiSetup = new BLEWifiSetup(tx as BLECharacteristic & { /** 現在のGATT特性値を読み取る。 */ readValue(): Promise<DataView> }, rx as BLECharacteristic & { /** 現在のGATT特性値を読み取る。 */ readValue(): Promise<DataView> });
            const dialog = this.wifiDialog = new RobotWifiDialog(
                this.rpc,
                () => {
                    if (this.wifiDialog === dialog) {
                        this.wifiDialog = undefined;
                        this.wifiSetup = undefined;
                    }
                    this.provisioning = false;
                    if (!this.closing && this.device?.gatt?.connected && this.state.phase === "connected") {
                        this.updateStream();
                        this.control.startHeartbeat(() => this.commandCalls["device.ping"]());
                    }
                });
            dialog.open();
        } catch {
            this.wifiSetup = undefined;
            this.provisioning = false;
            if (this.device?.gatt?.connected && this.state.phase === "connected") {
                this.updateStream();
                this.control.startHeartbeat(() => this.commandCalls["device.ping"]());
            }
            if (generation === this.generation) { this.state = { ...this.state, message: "Wi-Fi設定を開けません。対応するファームウェアとBLE接続を確認してください。" }; this.notify(); }
        }
    }

    /**
     * 対象機器の認証を確認して共通通信の経路をWi-Fiへ切り替える。
     *
     * @param signal 処理を取り消すシグナル。
     */
    private async connectWifi(target: RobotEndpoint, signal: AbortSignal): Promise<void> {
        const oldGeneration = this.generation, wifi = new RobotWifi();
        const originalMessage = this.state.message;
        this.state = { ...this.state, message: "Wi-Fi接続を確認しています…" }; this.notify();
        try {
            const actual = await wifi.connect(target, signal);
            signal.throwIfAborted();
            if (this.generation !== oldGeneration) throw new Error("接続を取り消しました。");
            // Remove native disconnection listener before the deliberate BLE handover.
            this.control.stopHeartbeat();
            this.resetServos();
            this.device?.removeEventListener("gattserverdisconnected", this.lost);
            this.device?.gatt?.disconnect();
            this.device = undefined;
            this.service = undefined;
            this.wifi = wifi;
            const generation = ++this.generation;
            this.bytecodeReceipt = undefined;
            this.bytecodeProgress = undefined;
            this.debugRequestId = 0;
            this.requestedRate = 0;
            this.control.bind(wifi);
            wifi.onLost = message => { if (this.generation === generation) this.close("error", message); };
            this.state = { phase: "connecting", deviceName: actual.name, transport: "wifi", message: "", pcaAvailable: false, imuAvailable: false, streaming: false };
            await this.commandCalls["device.info"]();
            signal.throwIfAborted();
            if (generation !== this.generation) throw new Error("接続を取り消しました。");
            // Wi-Fiでも現在の図を登録し、BLE接続時点の一覧だけに依存しない。
            await this.sendDeviceInfo();
            signal.throwIfAborted();
            if (generation !== this.generation) {
                throw new Error("接続を取り消しました。");
            }
            this.publish("connected", actual.name);
            this.provisioning = false;
            if (actual.camera) setCameraProvider(cameraSignal => this.rpc.call("camera.capture", { signal: cameraSignal }));
            this.updateStream();
            this.control.startHeartbeat(() => this.commandCalls["device.ping"]());
        } catch (error) {
            wifi.close();
            if (this.wifi === wifi) this.close("error", "Wi-Fiの制御接続を確認できません。再接続してください。");
            else { this.state = { ...this.state, message: originalMessage }; this.notify(); }
            throw error;
        }
    }

    /** バイナリ全体を現在のBLE／Wi-Fiで分割転送し、ESP32の検証・RAM保持の完了を待つ。
     *
     * @remarks
     * ```typescript
     * import { diagramDevice } from "./ble-wifi/device-connection.js";
     * import { parsePython } from "./python/parser.js";
     * import { analyzePython } from "./python/semantic.js";
     * import { generateBytecode } from "./python/bytecode.js";
     *
     * const module = parsePython(source);
     * const analysis = await analyzePython(module, signal);
     * const bytes = generateBytecode(analysis);
     * const receipt = await diagramDevice.rpc.call("program.upload", { code: bytes }, { signal });
     * // receipt.byteLengthとreceipt.crc32はESP32が保持完了を返した内容。
     * ```
     *
     * 接続済みでWi-Fi設定・切替中でない場合に利用できる。送信元はコピーし、同時に複数の転送は行わない。
     * 切断・ページ離脱・非表示・ブロック削除・APIのAbortSignalで取り消す。期限超過・取消・送受信エラーでは接続を閉じる。
     *
     * deployment指定時はPC一覧も送り、ESP32の検証・開始結果を待つ。通信契約はbytecode-transfer.tsのuploadBytecode()を参照する。
     * BLEの専用Characteristicは送信時に取得する。両経路の形式・Result照合・制約はbytecode-transfer.tsを参照する。
     */
    private async sendBytecode(bytes: Uint8Array, signal?: AbortSignal, deployment?: BytecodeDeployment): Promise<BytecodeReceipt> {
        if (this.bytecodeSending || this.debuggerSending) {
            throw new Error("バイトコードまたはブレークポイントを送信中です。");
        }
        checkBytecodeTransfer(bytes);
        const payload = bytes.slice();
        const generation = this.generation;
        const check = () => {
            signal?.throwIfAborted();
            if (generation !== this.generation || this.state.phase !== "connected" || this.provisioning) {
                throw new Error("バイトコード送信には現在のESP32への接続が必要です。");
            }
        };
        check();
        this.resetDebugger();
        this.bytecodeReceipt = undefined;
        this.bytecodeSending = true;
        this.bytecodeProgress = { totalBytes: payload.byteLength, sentBytes: 0, bytesPerSecond: 0, phase: "sending" };
        this.state = { ...this.state, message: "バイトコードを送信しています…" };
        this.notify();
        try {
            const receipt = await this.control.sendBytecode(payload, signal, progress => {
                check();
                this.bytecodeProgress = progress;
                this.notify();
            }, deployment);
            check();
            this.bytecodeReceipt = receipt;
            this.state = { ...this.state, message: `${receipt.byteLength}バイトをESP32で受信しました。` };
            return receipt;
        }
        catch (error) {
            if (generation === this.generation) {
                this.close("error", error instanceof Error ? error.message : "バイトコード送信に失敗しました。");
            }
            throw error;
        }
        finally {
            this.bytecodeSending = false;
            this.notify();
        }
    }

    /**
     * 現BLE接続だけで使えるRPC窓口を取得する。各Read/Writeを通常指令と同じ待ち列へ入れる。
     * 取消はプロトコル処理の境界で行い、進行中のGATT操作は最大2.5秒の既存期限で終える。
     */
    private async openRpc(): Promise<RpcChannel> {
        const generation = this.generation;
        const check = () => {
            if (generation !== this.generation || this.state.phase !== "connected" || this.state.transport !== "ble" || this.provisioning) {
                throw new Error("RPCには現在のBLE接続が必要です");
            }
        };
        check();
        const channel = await this.control.openRpc(check);
        const run = <T>(operation: () => Promise<T>) => this.control.runOperation(operation, check);
        return { writeControl: data => run(() => channel.writeControl(data)),
            readResult: () => run(() => channel.readResult()), readEvent: () => run(() => channel.readEvent()) };
    }

    /** 停止値の購読。未取得・失効ではundefined、取得失敗ではerrorを渡す。図の保存には含めない。 */
    private subscribeDebugSnapshots(listener: (snapshot?: DebugSnapshot, error?: Error, event?: DebugEvent) => void): () => void {
        this.debugListeners.add(listener);
        listener(this.debugSnapshot, this.debugError, this.debugEvent);
        return () => this.debugListeners.delete(listener);
    }

    /**
     * 最新の停止値・取得エラー・VM状態を保持し、デバッグ購読者へ通知する。
     *
     * @param snapshot 検証済みの同一停止の値。
     * @param event ブラウザーまたは通信元のイベント。
     */
    private publishDebug(snapshot?: DebugSnapshot, error?: Error, event?: DebugEvent): void {
        this.debugSnapshot = snapshot;
        this.debugError = error;
        this.debugEvent = event;
        if (event) {
            const states = ["idle", "running", "halted", "stopped", "error", "paused"];
            console.info("[Python VM]", {
                revision: event.revision, state: states[event.state], pc: event.pc,
                instructions: event.instructions, vmError: event.vmError, errorPc: event.errorPc,
                snapshotCode: event.code, stopId: event.stopId,
            });
        }
        for (const listener of this.debugListeners) {
            listener(snapshot, error, event);
        }
    }

    /**
     * 旧接続・旧プログラムの監視と停止情報を破棄する。
     */
    private resetDebugger(): void {
        this.debugger?.dispose();
        this.debugger = undefined;
        this.publishDebug();
    }

    /**
     * 最後に保持したコードへ命令PCの一覧を送る。PythonBlockのStartは同じ一覧を一括転送に含める。
     * monitorOnlyでは一覧を送らず、一括転送Resultのrevisionで状態監視だけを開始する。
     * stepPcs指定時は同じ生成のステップ用停止点も確定する。未対応ファームウェアでは開始前にエラーとする。
     * 完了後、同じ接続・同じ保持コードのPaused通知から停止値を自動取得し、購読者へ公開する。
     * 通信・フラグ・停止値の共通仕様はdebug-protocol.ts。旧ファームウェアの通常接続には影響しない。
     * ```typescript
     * const receipt = await diagramDevice.rpc.call("program.upload", { code: bytes }, { signal });
     * const release = diagramDevice.rpc.subscribe("debug.state", ({ snapshot, error }) => {
     *     // snapshot?.globals / stack / pc / bp / spを後続の変数表示で使う。
     * });
     * await diagramDevice.rpc.call("debug.breakpoints", { receipt, pcs: instructionPcs }, { signal });
     * await diagramDevice.rpc.call("program.start", { receipt });
     * // 利用終了時はrelease()で購読を解除する。
     * ```
     */
    private async sendBreakpoints(receipt: BytecodeReceipt, pcs: readonly number[], signal?: AbortSignal,
        stepPcs?: readonly number[], monitorOnly = false): Promise<void> {
        if (this.bytecodeSending || this.debuggerSending) {
            throw new Error("バイトコードまたはブレークポイントを送信中です。");
        }
        const generation = this.generation;
        const check = () => {
            if (generation !== this.generation || this.bytecodeReceipt !== receipt ||
                this.state.phase !== "connected" || this.provisioning) {
                throw new Error("現在のESP32へ送信済みのコードだけをデバッグできます。");
            }
        };
        check();
        signal?.throwIfAborted();
        const list = [...pcs];
        this.debuggerSending = true;
        try {
            if (!this.debugger) {
                // コード置換・Wi-Fi準備で受信を解除しても、進行中の通信完了を通信障害にしない。
                // receipt/所有者の照合は通信の前後にPythonDebugTransport.check()が行う。
                const checkTransport = () => {
                    if (generation !== this.generation || this.state.phase !== "connected") {
                        throw new Error("デバッグ用の接続が切れました。");
                    }
                };
                const run = <T>(operation: () => Promise<T>) => this.control.runOperation(operation, checkTransport);
                const channel = await this.control.openDebug(check);
                // プログラム再送・通信オブジェクト再作成でも、同じ接続内の要求番号を再利用しない。
                const nextRequestId = () => {
                    if (this.debugRequestId === 65535) {
                        throw new Error("デバッグ要求番号の上限です。再接続してください。");
                    }
                    return ++this.debugRequestId;
                };
                const client = new PythonDebugTransport(channel, run, check, nextRequestId, (snapshot, error, event) => {
                    if (this.debugger === client && generation === this.generation) {
                        this.publishDebug(snapshot, error, event);
                    }
                });
                this.debugger = client;
            }
            if (monitorOnly) {
                await this.debugger.observeDeployment(receipt, signal);
            }
            else {
                await this.debugger.sendBreakpoints(receipt, list, signal, stepPcs);
            }
        }
        finally {
            this.debuggerSending = false;
        }
    }

    /** 一括転送で設定済みのPCを再送せず、現在の保持世代のVM状態を監視する。 */
    private async observeDeployment(receipt: BytecodeReceipt, signal?: AbortSignal): Promise<void> {
        await this.sendBreakpoints(receipt, [], signal, undefined, true);
    }

    /** 現接続・所有Receipt・全受信した最新Snapshotを照合し、停止ID付きの再開／ステップを送る。Stopは常に優先できる。 */
    private async executeDebug(receipt: BytecodeReceipt, snapshot: DebugSnapshot, action: DebugAction, signal?: AbortSignal): Promise<void> {
        if (!this.debugger || this.bytecodeReceipt !== receipt || this.debugSnapshot !== snapshot || this.debugError
            || this.state.phase !== "connected" || this.provisioning || this.bytecodeSending || this.debuggerSending) {
            throw new Error("現在の機器・Pythonの停止情報だけを操作できます。");
        }
        this.debuggerSending = true;
        try {
            await this.debugger.execute(action, snapshot, signal);
        }
        finally {
            this.debuggerSending = false;
        }
    }

    /**
     * 保持済みコードの所有Receipt・準備状態を検査する。VM開始ACKは初期化までで、実行終了はdebug.stateで確認する。
     * 実際のVM指令は生成呼出し表が送る。上書き・取消・接続変更は共通exchangeの直前・完了後にも照合する。
     */
    private prepareProgramCommand(invocation: ProgramControlInvocation): ControlCallContext {
        if (invocation.name === "program.stop") {
            this.debugger?.invalidateSnapshot();
            this.resetServos();
            this.notify();
            return this.stopContext("VMの停止を確認できません。再接続してください。");
        }
        const receipt = invocation.request.receipt;
        const current = () => this.bytecodeReceipt === receipt && !this.bytecodeSending && !this.debuggerSending
            && !this.provisioning && this.state.phase === "connected";
        if (!current()) {
            throw new Error("現在のESP32へPythonを送信してから開始してください。");
        }
        this.debugger?.invalidateSnapshot();
        return { isCurrent: current };
    }

    /** 両経路で現在の図の一覧を送り、同じ接続の書込み完了後に通知の受信先を更新する。 */
    private async sendDeviceInfo(): Promise<void> {
        const sensors = theEditor.blocks.filter(x => x instanceof FunctionBlock && x.isSensor()) as FunctionBlock[];
        const actuators = theEditor.blocks.filter(x => x instanceof FunctionBlock && x.isActuator() && !sensors.includes(x)) as FunctionBlock[];
        const devices = sensors.concat(actuators);
        const bytes = new Uint8Array(DeviceInfoMaxLength);
        let offset = 0;
        for (const device of devices) {
            const nextOffset = device.writeDeviceInfo(bytes, offset);
            if (!Number.isInteger(nextOffset) || nextOffset <= offset || nextOffset > bytes.byteLength) {
                throw new Error(`機器情報の形式が不正か、上限の${DeviceInfoMaxLength}バイトを超えています。`);
            }
            offset = nextOffset;
        }
        // 種別0は6軸IMUなので、未使用領域を0で埋めたまま送らない。
        const payload = bytes.slice(0, offset);
        const generation = this.generation;
        await this.control.sendDeviceInfo(payload);
        if (generation !== this.generation) {
            throw new Error("機器情報の送信を取り消しました。");
        }
        this.sensors = sensors;
        this.actuators = actuators;
        // 再登録は機器側のSTREAMを止めるので、接続中なら現在の利用者で改めて要求する。
        this.requestedRate = 0;
        this.updateStream();
    }
}

/**
 * diagram全体で共有する機器接続とプログラム通信の窓口。
 */
export const diagramDevice = new DeviceConnection();

/** 非表示・ページ離脱では従来どおり切断し、原因を機器接続ブロックとコンソールへ示す。 */
export function initDeviceConnection(signal: AbortSignal): void {
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            diagramDevice.rpc.call("connection.disconnect", { reason: "画面が非表示になったため切断しました。" });
        }
    }, { signal });
    window.addEventListener("pagehide", () => diagramDevice.rpc.call("connection.disconnect", { reason: "ページを離れたため切断しました。" }), { signal });
}

/**
 * 接続・切断とWi-Fi設定／接続を操作し、機器の接続状態を表示する。
 * Wi-Fiボタンの下に全体・送信済みバイト数・平均速度を3行で表示し、未転送時は「—」とする。
 * 全データの書込みAPI完了後は「検証中」、最終Result成功後は「完了」を併記する。ツールボックスには表示しない。
 * 計測・通知・消去の共通契約はbytecode-transfer.tsのuploadBytecode()を参照する。
 */
export class DeviceConnectionBlock extends FunctionBlock {
    /**
     * BLEの機器選択・接続・切断を行うボタン。
     */
    readonly button: Button;
    /**
     * 現在のBLE機器のWi-Fi設定ダイアログを開くボタン。
     */
    readonly wifiButton: Button;
    /**
     * 現在の通信状態またはパケット通知の購読を解除する関数。
     */
    private unsubscribe?: () => void;
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
        this.button = new Button({ text: "接続", click: () => {
            if (this.removed || this.inToolbox) return;
            if (diagramDevice.state.phase === "connected") diagramDevice.rpc.call("connection.disconnect", {});
            else return diagramDevice.rpc.call("connection.connect");
        } });
        this.wifiButton = new Button({ text: "Wi-Fi設定／接続", click: () => {
            if (!this.removed && !this.inToolbox) return diagramDevice.rpc.call("wifi.open");
        } });
        if (!this.inToolbox) this.unsubscribe = diagramDevice.rpc.subscribe("device.state", () => {
            this.updateButton();
            theCanvas?.requestUpdateCanvas();
        });
        this.setBoxSize();
        this.updateButton();
    }

    /**
     * この部品が所有する、描画や操作の対象となる子UIを返す。
     */
    children(): UI[] {
        return [this.button, this.wifiButton];
    }

    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize(): void {
        this.boxSize = new Vec2(280, this.inToolbox ? 60 : 318);
    }

    /**
     * 同じ種類のブロックを作成し、複製対象の設定をコピーする。
     */
    copy(): DeviceConnectionBlock {
        const block = new DeviceConnectionBlock({});
        this.copyUI(block);
        block.setBoxSize();
        block.setPosition(this.position.copy());
        return block;
    }

    /**
     * 部品の基準座標を更新する。
     *
     * @param position 基準となる座標またはソース内の位置。
     */
    setPosition(position: Vec2): void {
        super.setPosition(position);
        this.positionButton();
    }

    /**
     * ブロックの現在位置と大きさに合わせてポートを配置する。
     */
    setPortPositions(): void {
        super.setPortPositions();
        this.positionButton();
    }

    /**
     * 接続とWi-Fi設定のボタンをブロック内へ配置する。
     */
    private positionButton(): void {
        this.button.setPosition(this.position.add(new Vec2(16, 126)));
        this.button.boxSize = new Vec2(248, 48);
        this.wifiButton.setPosition(this.position.add(new Vec2(16, 182)));
        this.wifiButton.boxSize = new Vec2(248, 48);
    }

    /**
     * 接続処理・転送・切断状態に合わせてボタンの表示と操作可否を更新する。
     */
    private updateButton(): void {
        const phase = diagramDevice.state.phase;
        this.button.text = phase === "connected" ? "切断" : phase === "error" ? "再接続" : "接続";
        this.button.disabled = this.removed || this.inToolbox || (diagramDevice.state.transport !== "wifi" && !!diagramDevice.availabilityMessage()) || phase === "selecting" || phase === "connecting";
        this.wifiButton.disabled = this.removed || this.inToolbox || !window.isSecureContext || phase === "selecting" || phase === "connecting" || diagramDevice.state.transport === "wifi";
        this.wifiButton.disabled ||= diagramDevice.bytecodeSending;
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
        const title = this.inToolbox || diagramDevice.state.phase !== "connected" ? "機器接続"
            : diagramDevice.state.transport === "wifi" ? "機器接続（Wi-Fi）" : "機器接続（BLE）";
        ctx.fillText(title, this.position.x + 16, this.position.y + 16);
        if (!this.inToolbox) {
            const state = diagramDevice.state;
            const unavailable = state.transport === "wifi" ? "" : diagramDevice.availabilityMessage();
            const phase = unavailable ? "unavailable" : state.phase;
            const labels: Record<DeviceConnectionPhase, string> = {
                idle: "未接続", selecting: "機器を選択してください", connecting: "接続中", connected: "接続済み", error: "接続失敗", unavailable: "利用不可",
            };
            ctx.fillStyle = phase === "connected" ? "#176b3a" : phase === "error" || phase === "unavailable" ? "#a32121" : "#555555";
            ctx.fillText(`状態：${labels[phase]}`, this.position.x + 16, this.position.y + 46, 248);
            ctx.fillStyle = "#17384f";
            ctx.fillText(`端末：${state.deviceName || "—"}`, this.position.x + 16, this.position.y + 72, 248);
            ctx.font = "14px sans-serif";
            const message = unavailable || state.message;
            // Two readable lines; never compress a long error into a tiny font.
            const chars = [...message];
            let line = "", y = this.position.y + 98;
            for (const char of chars) {
                if (ctx.measureText(line + char).width > 248) {
                    ctx.fillText(line, this.position.x + 16, y);
                    line = ""; y += 16;
                    if (y > this.position.y + 114) break;
                }
                line += char;
            }
            if (line) ctx.fillText(line, this.position.x + 16, y);
            this.positionButton();
            this.updateButton();
            this.button.draw();
            this.wifiButton.draw();
            const progress = diagramDevice.bytecodeProgress;
            const progressState = progress?.phase === "validating" ? "（検証中）"
                : progress?.phase === "complete" ? "（完了）" : "";
            const totalBytes = progress ? `${progress.totalBytes.toLocaleString("ja-JP")} B` : "—";
            const sentBytes = progress ? `${progress.sentBytes.toLocaleString("ja-JP")} B${progressState}` : "—";
            const speed = progress ? `${progress.bytesPerSecond.toLocaleString("ja-JP", { maximumFractionDigits: 0 })} B/s` : "—";
            ctx.font = "14px sans-serif";
            ctx.fillStyle = "#17384f";
            ctx.fillText(`全体：${totalBytes}`, this.position.x + 16, this.position.y + 246, 248);
            ctx.fillText(`送信済み：${sentBytes}`, this.position.x + 16, this.position.y + 266, 248);
            ctx.fillText(`平均速度：${speed}`, this.position.x + 16, this.position.y + 286, 248);
        }
        ctx.restore();
    }

    /**
     * 接続・イベント・所有資源を解放してブロックを削除可能にする。
     */
    clearBlock(): void {
        this.removed = true;
        diagramDevice.rpc.call("wifi.close");
        this.button.disabled = true;
        this.button.pressed = false;
        this.wifiButton.disabled = true; this.wifiButton.pressed = false;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        super.clearBlock();
    }
}

registerFunctionBlock(DeviceConnectionBlock.name, () => new DeviceConnectionBlock({}));
// 既存の保存図の読込みだけに使う旧型名。通信経路と無関係な公開クラス名には再利用しない。
registerFunctionBlock("BLEConnectionBlock", () => new DeviceConnectionBlock({}));
