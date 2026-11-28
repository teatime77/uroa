/**
 * CHごとの角度・連続回転速度の明示的な有効化と指令UIを提供する。
 * 通信はdevice.protoから生成したRPC APIへ渡し、ACKと機器固有の入力検査はdevice-connection.tsへ委譲する。
 */
import * as wire from "../ble-wifi/device-wire.generated";
import { Vec2 } from "@i18n";
import { DeviceType, FunctionBlock, registerFunctionBlock } from "../block";
import { diagramDevice, type ServoMode } from "../ble-wifi/device-connection";
import { PortType, theCanvas } from "../diagram_util";
import { NumberPort } from "../port";
import { Button, type Attr, type UI } from "../ui";

/**
 * 角度（度）と連続回転速度（%）を選択する。PWMの有効化は明示操作で行う。
 * 角度の表示範囲はdevice-connection.tsのmoveAngle()と合わせ、入力検査・送信を同APIへ委譲する。
 */
export class ServoMotorBlock extends FunctionBlock {
    /**
     * ブロックの処理に渡す値の入力ポート。
     */
    readonly inputPort = new NumberPort(this, PortType.inputPort);
    /**
     * サーボCH0〜15を選ぶ数値入力欄。
     */
    readonly input: HTMLInputElement;
    /**
     * 角度モードで使用する移動時間（ms）の入力欄。
     */
    readonly durationInput: HTMLInputElement;
    /**
     * 角度と連続回転速度を切り替える選択欄。
     */
    readonly modeInput: HTMLSelectElement;
    /**
     * 角度90度または速度0%でCHを明示的に有効化するボタン。
     */
    readonly armButton: Button;
    /**
     * 現在の入力値を選択した制御モードで送るボタン。
     */
    readonly moveButton: Button;
    /**
     * このCHのPWMを無効にするボタン。
     */
    readonly disableButton: Button;
    /**
     * 全サーボのPWMを停止するボタン。
     */
    readonly stopButton: Button;
    /**
     * 速度モードでPWM有効状態を保ち、速度0%を指令するボタン。
     */
    readonly zeroButton: Button;
    /**
     * 現在選択したサーボの角度または速度の制御モード。
     */
    mode: ServoMode = "angle";
    /**
     * 受付結果または入力・通信の失敗を表示する文字列。
     */
    message = "";
    /**
     * 機器の接続・CH状態の購読を解除する関数。
     */
    private unsubscribe?: () => void;
    /**
     * 入力ポートの接続変更通知を解除する関数。
     */
    private releaseConnection?: () => void;
    /**
     * 削除済みの部品に非同期結果を反映しないための状態。
     */
    private removed = false;
    /**
     * 接続・CH変更後に古い有効化や停止操作の結果を反映しないための世代。
     */
    private actionVersion = 0;
    /**
     * 入力と接続の変更後に古い移動要求を採用しないための世代。
     */
    private moveVersion = 0;
    /**
     * 現在このブロックが操作対象として選んでいるCH番号。
     */
    private configuredChannel = 0;
    /**
     * 有効化・停止等の操作結果を待っている状態。
     */
    private busy = false;

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param data 初期属性または処理対象のデータ。
     */
    constructor(data: Attr) {
        super(data);
        this.deviceType = DeviceType.ServoMotor;
        this.ports = [this.inputPort];
        this.releaseConnection = this.inputPort.subscribeConnections(change => {
            this.moveVersion++;
            if (change.connected && this.inputPort.sources.includes(change.peer)) {
                // Restore the displayed angle without starting motion on connection.
                this.inputPort.setPortValue(change.peer.value);
            } else if (!this.inputPort.sources.length) {
                this.inputPort.setPortValue(undefined);
            }
            this.refresh();
        });
        this.input = this.makeInput("チャンネル", 0, 15, 0, 54);
        this.durationInput = this.makeInput("移動時間ms", 0, 10000, 1000, 76);
        this.modeInput = document.createElement("select");
        this.modeInput.setAttribute("aria-label", "サーボの制御モード");
        this.modeInput.style.cssText = "position:absolute;width:134px;height:26px;z-index:100";
        for (const [value, label] of [["angle", "角度（°）"], ["speed", "速度（%）"]]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            this.modeInput.appendChild(option);
        }
        this.modeInput.hidden = this.inToolbox;
        if (!this.inToolbox) {
            (document.getElementById("layer-diagram") || document.body).appendChild(this.modeInput);
        }
        this.modeInput.addEventListener("change", () => { void this.changeMode(); });
        this.input.addEventListener("change", () => {
            const previous = this.configuredChannel;
            this.configuredChannel = this.input.valueAsNumber;
            this.actionVersion++; this.moveVersion++;
            this.busy = false; this.message = "";
            if (Number.isInteger(previous) && previous >= 0 && previous < 16 && previous !== this.configuredChannel) {
                void diagramDevice.rpc.call("servo.disable", { channel: previous }).catch(error => this.showError(error));
            }
            this.refresh();
        });
        this.armButton = new Button({ text: "90°で有効化", click: () => this.arm() });
        this.moveButton = new Button({ text: "入力角度へ移動", click: () => this.valueChanged() });
        this.disableButton = new Button({ text: "このCHを停止", click: () => this.disable() });
        this.stopButton = new Button({ text: "全サーボ停止", click: () => this.stop() });
        this.zeroButton = new Button({ text: "速度0で停止", fontSize: "14px", click: () => this.zeroSpeed() });
        this.setBoxSize();
        if (!this.inToolbox) this.unsubscribe = diagramDevice.rpc.subscribe("device.state", state => {
            if (state.phase !== "connected") {
                this.actionVersion++; this.moveVersion++;
                this.busy = false;
            }
            this.refresh();
        });
        this.refresh();
    }

    /**
     * DeviceInfoへアクチュエーターとして登録することを示す。
     */
    isActuator() : boolean {
        return true;
    }

    /**
     * サーボ種別・CH・操作モードの3バイトを書き込み、次の位置を返す。
     *
     * @param bytes 読み書きするバイト列。
     * @param offset バイト列内の開始位置。
     */
    writeDeviceInfo(bytes : Uint8Array, offset : number) : number {
        return wire.writeDeviceInfoRecordsRecord(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset,
            { deviceType: this.deviceType!, channel: this.configuredChannel, mode: this.mode === "angle" ? 0 : 1 });
    }

    /**
     * ラベル・上下限・初期値・表示幅を持つ数値入力欄を作る。
     *
     * @param value 検証または反映する値。
     */
    private makeInput(label: string, min: number, max: number, value: number, width: number): HTMLInputElement {
        const input = document.createElement("input");
        input.type = "number";
        input.min = `${min}`; input.max = `${max}`; input.step = "1"; input.value = `${value}`;
        input.setAttribute("aria-label", label);
        input.style.cssText = `position:absolute;width:${width}px;z-index:100`;
        input.hidden = this.inToolbox;
        if (!this.inToolbox) (document.getElementById("layer-diagram") || document.body).appendChild(input);
        return input;
    }

    /**
     * この部品が所有する、描画や操作の対象となる子UIを返す。
     */
    children(): UI[] {
        return [this.armButton, this.moveButton, this.disableButton, this.stopButton,
            ...(this.mode === "speed" ? [this.zeroButton] : [])];
    }
    /**
     * 描画コンテキストを設定し、子要素にも共有する。
     *
     * @param ctx 描画先の2Dコンテキスト。
     */
    setContext2D(ctx: CanvasRenderingContext2D): void {
        super.setContext2D(ctx);
        // 初期モードでchildren()に含まれないボタンにも描画先を渡す。
        this.zeroButton.setContext2D(ctx);
    }
    /**
     * 部品の内容に必要な描画サイズをboxSizeへ設定する。
     */
    setBoxSize(): void { this.boxSize = new Vec2(320, this.inToolbox ? 60 : 280); }

    /**
     * 図の保存に必要な設定をJSON化可能なオブジェクトへ変換する。
     */
    makeObj(): any {
        return { ...super.makeObj(), channel: this.input.valueAsNumber, duration: this.durationInput.valueAsNumber, mode: this.mode };
    }

    /**
     * 保存オブジェクトからこの要素の設定を復元する。
     *
     * @param obj 復元する保存オブジェクト。
     */
    loadObj(obj: any): void {
        super.loadObj(obj);
        this.input.value = `${obj.channel ?? 0}`;
        this.configuredChannel = this.input.valueAsNumber;
        this.durationInput.value = `${obj.duration ?? 1000}`;
        this.mode = obj.mode === "speed" ? "speed" : "angle";
        this.modeInput.value = this.mode;
        this.refresh();
    }

    /**
     * 同じ種類のブロックを作成し、複製対象の設定をコピーする。
     */
    copy(): ServoMotorBlock {
        const block = new ServoMotorBlock({});
        this.copyUI(block);
        block.loadObj(this.makeObj());
        block.setBoxSize();
        block.setPosition(this.position.copy());
        return block;
    }

    /**
     * 部品の基準座標を更新する。
     *
     * @param position 基準となる座標またはソース内の位置。
     */
    setPosition(position: Vec2): void { super.setPosition(position); this.positionControls(); }
    /**
     * ブロックの現在位置と大きさに合わせてポートを配置する。
     */
    setPortPositions(): void { super.setPortPositions(); this.positionControls(); }

    /**
     * ブロックの位置に合わせて操作ボタンを配置する。
     */
    private positionControls(): void {
        if (!this.armButton) return;
        const { x, y } = this.position;
        this.input.style.left = `${x + 50}px`; this.input.style.top = `${y + 60}px`;
        this.durationInput.style.left = `${x + 200}px`; this.durationInput.style.top = `${y + 60}px`;
        this.modeInput.style.left = `${x + 170}px`;
        this.modeInput.style.top = `${y + 20}px`;
        this.zeroButton.boxSize = new Vec2(164, 28);
        this.zeroButton.setPosition(new Vec2(x + 140, y + 58));
        for (const [button, dx, dy] of [
            [this.armButton, 16, 116], [this.disableButton, 170, 116],
            [this.moveButton, 16, 170], [this.stopButton, 170, 170],
        ] as const) {
            button.boxSize = new Vec2(138, 46);
            button.setPosition(new Vec2(x + dx, y + dy));
        }
    }

    /**
     * 接続・CH・モード・入力値からボタンと設定欄の有効性を更新する。
     */
    private refresh(): void {
        if (!this.armButton) return;
        const channel = this.input.valueAsNumber;
        const validChannel = Number.isInteger(channel) && channel >= 0 && channel < 16;
        const connected = !this.removed && !this.inToolbox && diagramDevice.state.phase === "connected";
        const ready = connected && diagramDevice.state.pcaAvailable && validChannel;
        this.armButton.disabled = !ready || this.busy;
        this.moveButton.disabled = !ready || this.busy || !diagramDevice.isServoArmed(channel, this.mode);
        this.zeroButton.disabled = this.mode !== "speed" || !ready || this.busy || !diagramDevice.isServoArmed(channel, "speed");
        this.armButton.text = this.mode === "speed" ? "0%で有効化" : "90°で有効化";
        this.moveButton.text = this.mode === "speed" ? "入力速度を設定" : "入力角度へ移動";
        this.disableButton.text = "このCHを無効化";
        this.durationInput.hidden = this.inToolbox || this.mode === "speed";
        this.durationInput.disabled = this.mode === "speed";
        this.disableButton.disabled = !connected || !validChannel;
        this.stopButton.disabled = !connected;
        this.positionControls();
        theCanvas?.requestUpdateCanvas();
    }

    /** モード変更で旧指令を取り消し、PWMを無効化する。選択だけでは再有効化しない。 */
    private async changeMode(): Promise<void> {
        this.mode = this.modeInput.value === "speed" ? "speed" : "angle";
        const version = ++this.actionVersion;
        this.moveVersion++;
        this.busy = true;
        this.message = "";
        this.refresh();
        try {
            await diagramDevice.rpc.call("servo.disable", { channel: this.input.valueAsNumber });
        }
        catch (error) {
            if (version === this.actionVersion) {
                this.showError(error);
            }
        }
        finally {
            if (!this.removed && version === this.actionVersion) {
                this.busy = false;
                this.refresh();
            }
        }
    }

    /**
     * 通信または入力検証の失敗をブロックの状態表示へ反映する。
     */
    private showError(error: unknown): void {
        if (this.removed) return;
        this.message = error instanceof Error ? error.message : "サーボ操作に失敗しました。";
        console.error("Servo error", { channel: this.input.valueAsNumber, message: this.message });
        this.refresh();
    }

    /**
     * 選択したCHを角度90度または速度0%で明示的に有効化する。
     */
    async arm(): Promise<void> {
        if (this.removed || this.inToolbox || this.busy) return;
        const channel = this.input.valueAsNumber, version = ++this.actionVersion;
        const current = () => !this.removed && version === this.actionVersion && channel === this.input.valueAsNumber;
        this.busy = true; this.message = ""; this.refresh();
        try {
            await diagramDevice.rpc.call("servo.arm", { channel, mode: this.mode }, { isCurrent: current });
            if (current()) this.message = this.mode === "speed" ? "0%の指令で有効化しました。" : "90°の指令を受け付けました。";
        } catch (error) { if (current()) this.showError(error); }
        finally { if (current()) { this.busy = false; this.refresh(); } }
    }

    /**
     * 現世代で有効なCHへ入力値を送る。接続や型が不正な場合は送信しない。
     */
    async valueChanged(): Promise<void> {
        const version = ++this.moveVersion;
        if (this.removed || this.inToolbox) return;
        if (!diagramDevice.isServoArmed(this.input.valueAsNumber, this.mode)) return;
        const channel = this.input.valueAsNumber, angle = this.inputPort.value, mode = this.mode;
        const current = () => !this.removed && version === this.moveVersion && channel === this.input.valueAsNumber;
        try {
            if (typeof angle !== "number") {
                throw new Error(mode === "speed" ? "入力ポートへ速度（−100～100%）を接続してください。" : "入力ポートへ角度（0～180°）を接続してください。");
            }
            if (mode === "speed") {
                await diagramDevice.rpc.call("servo.speed", { channel, percent: angle }, { isCurrent: current });
            }
            else {
                await diagramDevice.rpc.call("servo.move", { channel, angle, duration: this.durationInput.valueAsNumber }, { isCurrent: current });
            }
            if (current()) {
                this.message = mode === "speed" ? `${angle}%の速度指令を受け付けました。` : `${angle}°の移動指令を受け付けました。`;
                this.refresh();
            }
        } catch (error) { if (current()) this.showError(error); }
    }

    /** 入力値は書き換えず、中立パルスを出力して速度0%にする。 */
    async zeroSpeed(): Promise<void> {
        const version = ++this.moveVersion;
        if (this.removed || this.inToolbox || this.mode !== "speed") {
            return;
        }
        const channel = this.input.valueAsNumber;
        const current = () => !this.removed && version === this.moveVersion && channel === this.input.valueAsNumber && this.mode === "speed";
        try {
            await diagramDevice.rpc.call("servo.speed", { channel, percent: 0 }, { isCurrent: current });
            if (current()) {
                this.message = "速度0%（中立）の指令を受け付けました。";
            }
        }
        catch (error) {
            if (current()) {
                this.showError(error);
            }
        }
        this.refresh();
    }

    // Port value propagation already sends MOVE; calculation traversal is passive.
    calc(): void {}

    /**
     * 選択CHのPWMを無効にし、受付結果を表示する。
     */
    async disable(): Promise<void> {
        if (this.removed || this.inToolbox) return;
        this.actionVersion++; this.moveVersion++; this.busy = false; this.message = "";
        try { await diagramDevice.rpc.call("servo.disable", { channel: this.input.valueAsNumber }); }
        catch (error) { this.showError(error); }
        this.refresh();
    }

    /**
     * 全サーボ停止を要求し、このブロックの進行中の操作も失効させる。
     */
    async stop(): Promise<void> {
        if (this.removed || this.inToolbox) return;
        this.actionVersion++; this.moveVersion++; this.busy = false; this.message = "";
        try { await diagramDevice.rpc.call("servo.stop"); }
        catch (error) { this.showError(error); }
        this.refresh();
    }

    /**
     * この部品の枠・内容・操作状態をキャンバスへ描く。
     */
    draw(): void {
        super.draw();
        const ctx = this.ctx, { x, y } = this.position;
        ctx.save();
        ctx.font = "18px sans-serif"; ctx.textBaseline = "top"; ctx.fillStyle = "#17384f";
        ctx.fillText("サーボ", x + 16, y + 22);
        if (!this.inToolbox) {
            const state = diagramDevice.state;
            ctx.font = "14px sans-serif";
            const label = state.phase !== "connected" ? "未接続" : !state.pcaAvailable ? "PCA9685未検出"
                : diagramDevice.isServoArmed(this.input.valueAsNumber, this.mode) ? "PWM有効" : "PWM停止中";
            ctx.fillText(label, x + 170, y + 254);
            ctx.fillText("CH", x + 16, y + 64);
            if (this.mode === "angle") {
                ctx.fillText("時間ms", x + 144, y + 64);
            }
            const angle = this.inputPort.value;
            const unit = this.mode === "speed" ? "%" : "°";
            const range = this.mode === "speed" ? "−100～100%" : "0～180°";
            ctx.fillText(`入力${this.mode === "speed" ? "速度" : "角度"}：${typeof angle === "number" ? angle + unit : "未入力"}（${range}）`, x + 16, y + 92, 292);
            this.positionControls();
            this.children().forEach(button => button.draw());
            ctx.fillStyle = "#555555";
            ctx.fillText(this.message, x + 16, y + 232, 292);
            ctx.fillText(this.mode === "speed" ? "速度は指令値です。" : "角度は指令値です。", x + 16, y + 254);
        }
        ctx.restore();
    }

    /**
     * 接続・イベント・所有資源を解放してブロックを削除可能にする。
     */
    clearBlock(): void {
        if (this.removed) return;
        this.removed = true;
        this.actionVersion++; this.moveVersion++;
        this.children().forEach(button => { (button as Button).disabled = true; });
        const channel = this.input.valueAsNumber;
        if (!this.inToolbox && Number.isInteger(channel) && channel >= 0 && channel < 16) {
            void diagramDevice.rpc.call("servo.disable", { channel }).catch(error => console.error("Servo removal failed", error));
        }
        this.unsubscribe?.(); this.unsubscribe = undefined;
        this.releaseConnection?.(); this.releaseConnection = undefined;
        this.input.remove(); this.durationInput.remove(); this.modeInput.remove();
        super.clearBlock();
    }
}

registerFunctionBlock(ServoMotorBlock.name, () => new ServoMotorBlock({}));
