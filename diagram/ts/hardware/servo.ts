import { Vec2 } from "@i18n";
import { FunctionBlock, registerFunctionBlock } from "../block";
import { diagramBLE } from "../ble-wifi/ble";
import { PortType, theCanvas } from "../diagram_util";
import { NumberPort } from "../port";
import { Button, type Attr, type UI } from "../ui";

/** Angle input is in degrees; enabling PWM always requires an explicit click. */
export class ServoMotorBlock extends FunctionBlock {
    readonly inputPort = new NumberPort(this, PortType.inputPort);
    readonly input: HTMLInputElement;
    readonly durationInput: HTMLInputElement;
    readonly armButton: Button;
    readonly moveButton: Button;
    readonly disableButton: Button;
    readonly stopButton: Button;
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

    children(): UI[] { return [this.armButton, this.moveButton, this.disableButton, this.stopButton]; }
    setBoxSize(): void { this.boxSize = new Vec2(320, this.inToolbox ? 60 : 280); }

    makeObj(): any {
        return { ...super.makeObj(), channel: this.input.valueAsNumber, duration: this.durationInput.valueAsNumber };
    }

    loadObj(obj: any): void {
        super.loadObj(obj);
        this.input.value = `${obj.channel ?? 0}`;
        this.configuredChannel = this.input.valueAsNumber;
        this.durationInput.value = `${obj.duration ?? 1000}`;
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
        this.moveButton.disabled = !ready || this.busy || !diagramBLE.isServoArmed(channel);
        this.disableButton.disabled = !connected || !validChannel;
        this.stopButton.disabled = !connected;
        this.positionControls();
        theCanvas?.requestUpdateCanvas();
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
            await diagramBLE.armServo(channel, current);
            if (current()) this.message = "90°の指令を受け付けました。";
        } catch (error) { if (current()) this.showError(error); }
        finally { if (current()) { this.busy = false; this.refresh(); } }
    }

    async valueChanged(): Promise<void> {
        const version = ++this.moveVersion;
        if (this.removed || this.inToolbox) return;
        console.log("Servo input", { channel: this.input.valueAsNumber, angle: this.inputPort.value,
            duration: this.durationInput.valueAsNumber, armed: diagramBLE.isServoArmed(this.input.valueAsNumber) });
        if (!diagramBLE.isServoArmed(this.input.valueAsNumber)) return;
        const channel = this.input.valueAsNumber, angle = this.inputPort.value;
        const current = () => !this.removed && version === this.moveVersion && channel === this.input.valueAsNumber;
        try {
            if (typeof angle !== "number") throw new Error("入力ポートへ角度（60～120°）を接続してください。");
            await diagramBLE.moveServo(channel, angle, this.durationInput.valueAsNumber, current);
            if (current()) { this.message = `${angle}°の移動指令を受け付けました。`; this.refresh(); }
        } catch (error) { if (current()) this.showError(error); }
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
        ctx.fillText("BLEサーボ", x + 16, y + 22);
        if (!this.inToolbox) {
            const state = diagramBLE.state;
            ctx.font = "14px sans-serif";
            const label = state.phase !== "connected" ? "BLE未接続" : !state.pcaAvailable ? "PCA9685未検出"
                : diagramBLE.isServoArmed(this.input.valueAsNumber) ? "PWM有効" : "PWM停止中";
            ctx.fillText(label, x + 170, y + 28);
            ctx.fillText("CH", x + 16, y + 64); ctx.fillText("時間ms", x + 144, y + 64);
            const angle = this.inputPort.value;
            ctx.fillText(`入力角度：${typeof angle === "number" ? angle + "°" : "未入力"}（60～120°）`, x + 16, y + 92, 292);
            this.positionControls();
            this.children().forEach(button => button.draw());
            ctx.fillStyle = "#555555";
            ctx.fillText(this.message, x + 16, y + 232, 292);
            ctx.fillText("角度は指令値です。", x + 16, y + 254);
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
        this.input.remove(); this.durationInput.remove();
        super.clearBlock();
    }
}

registerFunctionBlock(ServoMotorBlock.name, () => new ServoMotorBlock({}));
