import { Vec2 } from "@i18n";
import { FunctionBlock, registerFunctionBlock } from "../block";
import { diagramBLE, type ServoMode } from "../ble-wifi/ble";
import { PortType, theCanvas } from "../diagram_util";
import { NumberPort } from "../port";
import { Button, type Attr, type UI } from "../ui";

/** 角度（度）と連続回転速度（%）を選択する。PWMの有効化は明示操作で行う。 */
export class ServoMotorBlock extends FunctionBlock {
    readonly inputPort = new NumberPort(this, PortType.inputPort);
    readonly input: HTMLInputElement;
    readonly durationInput: HTMLInputElement;
    readonly modeInput: HTMLSelectElement;
    readonly armButton: Button;
    readonly moveButton: Button;
    readonly disableButton: Button;
    readonly stopButton: Button;
    readonly zeroButton: Button;
    mode: ServoMode = "angle";
    message = "";
    private unsubscribe?: () => void;
    private releaseConnection?: () => void;
    private removed = false;
    private actionVersion = 0;
    private moveVersion = 0;
    private configuredChannel = 0;
    private busy = false;

    constructor(data: Attr) {
        super(data);
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
                void diagramBLE.disableServo(previous).catch(error => this.showError(error));
            }
            this.refresh();
        });
        this.armButton = new Button({ text: "90°で有効化", click: () => this.arm() });
        this.moveButton = new Button({ text: "入力角度へ移動", click: () => this.valueChanged() });
        this.disableButton = new Button({ text: "このCHを停止", click: () => this.disable() });
        this.stopButton = new Button({ text: "全サーボ停止", click: () => this.stop() });
        this.zeroButton = new Button({ text: "速度0で停止", fontSize: "14px", click: () => this.zeroSpeed() });
        this.setBoxSize();
        if (!this.inToolbox) this.unsubscribe = diagramBLE.subscribe(state => {
            if (state.phase !== "connected") {
                this.actionVersion++; this.moveVersion++;
                this.busy = false;
            }
            this.refresh();
        });
        this.refresh();
    }

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

    children(): UI[] {
        return [this.armButton, this.moveButton, this.disableButton, this.stopButton,
            ...(this.mode === "speed" ? [this.zeroButton] : [])];
    }
    setContext2D(ctx: CanvasRenderingContext2D): void {
        super.setContext2D(ctx);
        // 初期モードでchildren()に含まれないボタンにも描画先を渡す。
        this.zeroButton.setContext2D(ctx);
    }
    setBoxSize(): void { this.boxSize = new Vec2(320, this.inToolbox ? 60 : 280); }

    makeObj(): any {
        return { ...super.makeObj(), channel: this.input.valueAsNumber, duration: this.durationInput.valueAsNumber, mode: this.mode };
    }

    loadObj(obj: any): void {
        super.loadObj(obj);
        this.input.value = `${obj.channel ?? 0}`;
        this.configuredChannel = this.input.valueAsNumber;
        this.durationInput.value = `${obj.duration ?? 1000}`;
        this.mode = obj.mode === "speed" ? "speed" : "angle";
        this.modeInput.value = this.mode;
        this.refresh();
    }

    copy(): ServoMotorBlock {
        const block = new ServoMotorBlock({});
        this.copyUI(block);
        block.loadObj(this.makeObj());
        block.setBoxSize();
        block.setPosition(this.position.copy());
        return block;
    }

    setPosition(position: Vec2): void { super.setPosition(position); this.positionControls(); }
    setPortPositions(): void { super.setPortPositions(); this.positionControls(); }

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

    private refresh(): void {
        if (!this.armButton) return;
        const channel = this.input.valueAsNumber;
        const validChannel = Number.isInteger(channel) && channel >= 0 && channel < 16;
        const connected = !this.removed && !this.inToolbox && diagramBLE.state.phase === "connected";
        const ready = connected && diagramBLE.state.pcaAvailable && validChannel;
        this.armButton.disabled = !ready || this.busy;
        this.moveButton.disabled = !ready || this.busy || !diagramBLE.isServoArmed(channel, this.mode);
        this.zeroButton.disabled = this.mode !== "speed" || !ready || this.busy || !diagramBLE.isServoArmed(channel, "speed");
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
            await diagramBLE.disableServo(this.input.valueAsNumber);
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

    private showError(error: unknown): void {
        if (this.removed) return;
        this.message = error instanceof Error ? error.message : "サーボ操作に失敗しました。";
        console.error("Servo error", { channel: this.input.valueAsNumber, message: this.message });
        this.refresh();
    }

    async arm(): Promise<void> {
        if (this.removed || this.inToolbox || this.busy) return;
        const channel = this.input.valueAsNumber, version = ++this.actionVersion;
        const current = () => !this.removed && version === this.actionVersion && channel === this.input.valueAsNumber;
        this.busy = true; this.message = ""; this.refresh();
        try {
            await diagramBLE.armServo(channel, current, this.mode);
            if (current()) this.message = this.mode === "speed" ? "0%の指令で有効化しました。" : "90°の指令を受け付けました。";
        } catch (error) { if (current()) this.showError(error); }
        finally { if (current()) { this.busy = false; this.refresh(); } }
    }

    async valueChanged(): Promise<void> {
        const version = ++this.moveVersion;
        if (this.removed || this.inToolbox) return;
        if (!diagramBLE.isServoArmed(this.input.valueAsNumber, this.mode)) return;
        const channel = this.input.valueAsNumber, angle = this.inputPort.value, mode = this.mode;
        const current = () => !this.removed && version === this.moveVersion && channel === this.input.valueAsNumber;
        try {
            if (typeof angle !== "number") {
                throw new Error(mode === "speed" ? "入力ポートへ速度（−100～100%）を接続してください。" : "入力ポートへ角度（60～120°）を接続してください。");
            }
            if (mode === "speed") {
                await diagramBLE.setSpeed(channel, angle, current);
            }
            else {
                await diagramBLE.moveAngle(channel, angle, this.durationInput.valueAsNumber, current);
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
            await diagramBLE.setSpeed(channel, 0, current);
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

    async disable(): Promise<void> {
        if (this.removed || this.inToolbox) return;
        this.actionVersion++; this.moveVersion++; this.busy = false; this.message = "";
        try { await diagramBLE.disableServo(this.input.valueAsNumber); }
        catch (error) { this.showError(error); }
        this.refresh();
    }

    async stop(): Promise<void> {
        if (this.removed || this.inToolbox) return;
        this.actionVersion++; this.moveVersion++; this.busy = false; this.message = "";
        try { await diagramBLE.stopServos(); }
        catch (error) { this.showError(error); }
        this.refresh();
    }

    draw(): void {
        super.draw();
        const ctx = this.ctx, { x, y } = this.position;
        ctx.save();
        ctx.font = "18px sans-serif"; ctx.textBaseline = "top"; ctx.fillStyle = "#17384f";
        ctx.fillText("サーボ", x + 16, y + 22);
        if (!this.inToolbox) {
            const state = diagramBLE.state;
            ctx.font = "14px sans-serif";
            const label = state.phase !== "connected" ? "未接続" : !state.pcaAvailable ? "PCA9685未検出"
                : diagramBLE.isServoArmed(this.input.valueAsNumber, this.mode) ? "PWM有効" : "PWM停止中";
            ctx.fillText(label, x + 170, y + 254);
            ctx.fillText("CH", x + 16, y + 64);
            if (this.mode === "angle") {
                ctx.fillText("時間ms", x + 144, y + 64);
            }
            const angle = this.inputPort.value;
            const unit = this.mode === "speed" ? "%" : "°";
            const range = this.mode === "speed" ? "−100～100%" : "60～120°";
            ctx.fillText(`入力${this.mode === "speed" ? "速度" : "角度"}：${typeof angle === "number" ? angle + unit : "未入力"}（${range}）`, x + 16, y + 92, 292);
            this.positionControls();
            this.children().forEach(button => button.draw());
            ctx.fillStyle = "#555555";
            ctx.fillText(this.message, x + 16, y + 232, 292);
            ctx.fillText(this.mode === "speed" ? "速度は指令値です。" : "角度は指令値です。", x + 16, y + 254);
        }
        ctx.restore();
    }

    clearBlock(): void {
        if (this.removed) return;
        this.removed = true;
        this.actionVersion++; this.moveVersion++;
        this.children().forEach(button => { (button as Button).disabled = true; });
        const channel = this.input.valueAsNumber;
        if (!this.inToolbox && Number.isInteger(channel) && channel >= 0 && channel < 16) {
            void diagramBLE.disableServo(channel).catch(error => console.error("Servo removal failed", error));
        }
        this.unsubscribe?.(); this.unsubscribe = undefined;
        this.releaseConnection?.(); this.releaseConnection = undefined;
        this.input.remove(); this.durationInput.remove(); this.modeInput.remove();
        super.clearBlock();
    }
}

registerFunctionBlock(ServoMotorBlock.name, () => new ServoMotorBlock({}));
