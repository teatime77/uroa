import { Vec2 } from "@i18n";
import { FunctionBlock, registerFunctionBlock } from "../block";
import { imuStruct, imuType, type IMUValue } from "../data_type";
import { PortType, theCanvas } from "../diagram_util";
import { NumberPort, StructPort } from "../port";
import { stopFlag, subscribeDiagramStop } from "../runtime";
import type { Attr } from "../ui";

/** 保存対象のゲインと、モータごとの停止範囲。速度の単位は%。 */
interface PIDSettings {
    kp: number;
    ki: number;
    kd: number;
    motor1StopMin: number;
    motor1StopMax: number;
    motor2StopMin: number;
    motor2StopMax: number;
}

/** 初版ではP項だけを計算し、Ki・Kdは設定・保存のみ行う。 */
const defaultSettings: PIDSettings = {
    kp: 1,
    ki: 0,
    kd: 0,
    motor1StopMin: 0,
    motor1StopMax: 0,
    motor2StopMin: 0,
    motor2StopMax: 0
};

const settingLabels: Record<keyof PIDSettings, string> = {
    kp: "Kp",
    ki: "Ki（未使用）",
    kd: "Kd（未使用）",
    motor1StopMin: "モータ1 停止最小（%）",
    motor1StopMax: "モータ1 停止最大（%）",
    motor2StopMin: "モータ2 停止最小（%）",
    motor2StopMax: "モータ2 停止最大（%）"
};

/** IMUの加速度Yによる傾きをP制御し、2個のモータへ速度を出力する。 */
export class PIDBlock extends FunctionBlock {
    readonly runOnStart = true;
    readonly inputPort = new StructPort(this, PortType.inputPort, imuStruct, "imu");
    readonly motor1Port = new NumberPort(this, PortType.outputPort, "M1");
    readonly motor2Port = new NumberPort(this, PortType.outputPort, "M2");
    readonly settingInputs = new Map<keyof PIDSettings, HTMLInputElement>();
    private settings: PIDSettings = { ...defaultSettings };
    private referenceTilt?: number;
    private active = false;
    private removed = false;
    private status = "Startで垂直基準を取得";
    private completion = Promise.resolve();
    private finish?: () => void;
    private releaseStop?: () => void;
    private releaseConnection?: () => void;
    private readonly events = new AbortController();

    /** 入出力、設定欄、停止・接続変更の購読を作成する。 */
    constructor(data: Attr) {
        super(data);
        this.ports = [this.inputPort, this.motor1Port, this.motor2Port];
        this.setBoxSize();
        if (this.inToolbox) {
            return;
        }
        for (const key of Object.keys(defaultSettings) as (keyof PIDSettings)[]) {
            const input = document.createElement("input");
            input.type = "number";
            input.step = "any";
            input.value = `${this.settings[key]}`;
            input.setAttribute("aria-label", settingLabels[key]);
            input.style.cssText = "position:absolute;width:90px;box-sizing:border-box;z-index:100";
            if (key !== "kp" && key !== "ki" && key !== "kd") {
                input.min = "-100";
                input.max = "100";
            }
            input.addEventListener("input", () => this.settingsChanged(), { signal: this.events.signal });
            (document.getElementById("layer-diagram") || document.body).appendChild(input);
            this.settingInputs.set(key, input);
        }
        this.releaseStop = subscribeDiagramStop(() => this.stop());
        this.releaseConnection = this.inputPort.subscribeConnections(() => {
            this.stop("IMU接続変更：Startで再開");
            this.inputPort.setPortValue(undefined);
        });
        window.addEventListener("pagehide", () => this.stop(), { signal: this.events.signal });
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                this.stop();
            }
        }, { signal: this.events.signal });
        this.positionInputs();
    }

    /** 入力欄・JSONの値を検証し、欠けた保存設定には既定値を与える。 */
    private readSettings(obj: Partial<PIDSettings>): PIDSettings {
        const settings = { ...defaultSettings };
        for (const key of Object.keys(defaultSettings) as (keyof PIDSettings)[]) {
            const value = obj[key] === undefined ? defaultSettings[key] : obj[key];
            if (typeof value !== "number" || !Number.isFinite(value)) {
                throw new Error(`${settingLabels[key]}には有限の数値が必要です。`);
            }
            settings[key] = value;
        }
        for (const [min, max] of [
            [settings.motor1StopMin, settings.motor1StopMax],
            [settings.motor2StopMin, settings.motor2StopMax]
        ]) {
            if (min < -100 || max > 100 || min > max) {
                throw new Error("停止範囲は−100～100%で、最小≦最大にしてください。");
            }
        }
        return settings;
    }

    /** 現在の入力欄を検証し、保存・実行に使う設定を返す。 */
    private currentSettings(): PIDSettings {
        const values: Partial<PIDSettings> = {};
        for (const [key, input] of this.settingInputs) {
            values[key] = input.valueAsNumber;
        }
        return this.readSettings(this.inToolbox ? this.settings : values);
    }

    /** 有効な設定変更を即時反映し、不正な入力では制御を停止する。 */
    private settingsChanged(): void {
        try {
            this.settings = this.currentSettings();
            if (this.active && this.inputPort.value !== undefined) {
                this.updateControl();
            }
            else if (!this.active) {
                this.status = "Startで垂直基準を取得";
            }
        }
        catch (error) {
            this.stop(error instanceof Error ? error.message : "設定が不正です。");
        }
        theCanvas?.requestUpdateCanvas();
    }

    /** Startごとに前回の垂直基準を破棄する。 */
    resetForRun(): void {
        this.stop();
        this.referenceTilt = undefined;
    }

    /** Start後の最初の新しいIMU計測を待ち、連続制御を開始する。 */
    async run(): Promise<void> {
        if (this.removed || this.inToolbox || stopFlag) {
            return;
        }
        this.settings = this.currentSettings();
        if (this.inputPort.sources.length !== 1) {
            throw new Error("PIDの入力にはIMUを1個接続してください。");
        }
        this.referenceTilt = undefined;
        this.inputPort.setPortValue(undefined);
        this.active = true;
        this.completion = new Promise(resolve => {
            this.finish = resolve;
        });
        this.writeSpeeds(0);
        this.status = "開始時のIMU計測待ち";
        theCanvas?.requestUpdateCanvas();
    }

    /** 全体のStartを実行中に保ち、Stopまたは制御中断を待つ。 */
    waitUntilStopped(): Promise<void> {
        return this.completion;
    }

    /** IMU受信ごとにP制御を更新する。 */
    async valueChanged(): Promise<void> {
        this.updateControl();
    }

    /** 明示的な計算呼出しでも同じP制御を行う。 */
    calc(): void {
        this.updateControl();
    }

    /** 加速度Yの角度と開始時の角度との差から、共通のP出力を計算する。 */
    private updateControl(): void {
        if (!this.active || this.removed) {
            return;
        }
        try {
            if (this.inputPort.sources.length !== 1 || this.inputPort.value === undefined) {
                throw new Error("IMU入力なし：Startで再開");
            }
            imuType.validateValue(this.inputPort.value);
            const value = this.inputPort.value as IMUValue;
            const acc = value.acc;
            if (Math.hypot(acc.x, acc.y, acc.z) === 0) {
                throw new Error("加速度が0のため傾きを計算できません。");
            }
            const tilt = Math.atan2(acc.y, Math.hypot(acc.x, acc.z)) * 180 / Math.PI;
            if (this.referenceTilt === undefined) {
                this.referenceTilt = tilt;
            }
            const error = this.referenceTilt - tilt;
            const output = this.settings.kp * error;
            if (!Number.isFinite(output)) {
                throw new Error("P制御の計算結果が範囲外です。");
            }
            this.writeSpeeds(output);
            this.status = `P制御中：傾き差 ${(tilt - this.referenceTilt).toFixed(2)}°`;
        }
        catch (error) {
            this.stop(error instanceof Error ? error.message : "IMU入力が不正です。");
        }
        theCanvas?.requestUpdateCanvas();
    }

    /** 停止範囲を避ける補正を行い、速度を−100～100%に収める。 */
    private motorSpeed(output: number, min: number, max: number): number {
        let speed = (min + max) / 2;
        if (output > 0) {
            speed = max + output;
        }
        else if (output < 0) {
            speed = min + output;
        }
        return Math.max(-100, Math.min(100, speed));
    }

    /** 同じP出力を、各モータの停止範囲で補正して伝播する。 */
    private writeSpeeds(output: number): void {
        this.motor1Port.setPortValue(this.motorSpeed(output, this.settings.motor1StopMin, this.settings.motor1StopMax));
        this.motor2Port.setPortValue(this.motorSpeed(output, this.settings.motor2StopMin, this.settings.motor2StopMax));
    }

    /** 制御を止め、各モータの停止範囲中央を出力する。 */
    stop(message = "停止：Startで垂直基準を取得"): void {
        const wasActive = this.active;
        this.active = false;
        this.referenceTilt = undefined;
        if (wasActive) {
            this.writeSpeeds(0);
        }
        this.finish?.();
        this.finish = undefined;
        this.status = message;
        theCanvas?.requestUpdateCanvas();
    }

    /** 設定だけを保存し、基準角・計測値・出力速度・実行状態は保存しない。 */
    makeObj(): any {
        return { ...super.makeObj(), ...this.currentSettings() };
    }

    /** 設定だけを復元する。制御は自動開始しない。 */
    loadObj(obj: Partial<PIDSettings>): void {
        const settings = this.readSettings(obj);
        this.stop();
        this.settings = settings;
        for (const [key, input] of this.settingInputs) {
            input.value = `${settings[key]}`;
        }
    }

    /** 未接続・停止状態の複製へ設定を移す。 */
    copy(): PIDBlock {
        const settings = this.currentSettings();
        const block = new PIDBlock({});
        this.copyUI(block);
        block.loadObj(settings);
        block.setBoxSize();
        block.setPosition(this.position.copy());
        return block;
    }

    /** 設定欄と状態表示の領域を確保する。 */
    setBoxSize(): void {
        this.boxSize = new Vec2(420, this.inToolbox ? 60 : 320);
    }

    /** ブロック移動に設定欄を追従させる。 */
    setPosition(position: Vec2): void {
        super.setPosition(position);
        this.positionInputs();
    }

    /** ポート再配置に設定欄を追従させる。 */
    setPortPositions(): void {
        super.setPortPositions();
        this.positionInputs();
    }

    /** Canvas上のラベルに合わせて設定欄を並べる。 */
    private positionInputs(): void {
        const positions: [keyof PIDSettings, number, number][] = [
            ["kp", 16, 80],
            ["ki", 154, 80],
            ["kd", 292, 80],
            ["motor1StopMin", 154, 170],
            ["motor1StopMax", 292, 170],
            ["motor2StopMin", 154, 206],
            ["motor2StopMax", 292, 206]
        ];
        for (const [key, dx, dy] of positions) {
            const input = this.settingInputs.get(key);
            if (input) {
                input.style.left = `${this.position.x + dx}px`;
                input.style.top = `${this.position.y + dy}px`;
            }
        }
    }

    /** ゲイン、停止範囲、現在の制御状態を描画する。 */
    draw(): void {
        super.draw();
        const ctx = this.ctx;
        const x = this.position.x;
        const y = this.position.y;
        ctx.save();
        ctx.fillStyle = "#17384f";
        ctx.textBaseline = "top";
        ctx.font = "18px sans-serif";
        ctx.fillText("PID（P制御）", x + 16, y + 22);
        if (!this.inToolbox) {
            ctx.font = "14px sans-serif";
            ctx.fillText("Kp（%/°）", x + 16, y + 58);
            ctx.fillText("Ki（未使用）", x + 154, y + 58);
            ctx.fillText("Kd（未使用）", x + 292, y + 58);
            ctx.fillText("acc Yの開始角を垂直とする", x + 16, y + 114);
            ctx.fillText("停止範囲（%）", x + 16, y + 146);
            ctx.fillText("最小", x + 154, y + 146);
            ctx.fillText("最大", x + 292, y + 146);
            ctx.fillText("モータ1", x + 16, y + 174);
            ctx.fillText("モータ2", x + 16, y + 210);
            ctx.fillText("正：最大＋P ／ 負：最小＋P ／ 0：中央", x + 16, y + 246);
            ctx.fillText(this.status, x + 16, y + 272, this.boxSize.x - 32);
        }
        ctx.restore();
    }

    /** 停止、購読解除、DOM除去、配線解除を行う。 */
    clearBlock(): void {
        if (this.removed) {
            return;
        }
        this.stop();
        this.removed = true;
        this.releaseStop?.();
        this.releaseConnection?.();
        this.events.abort();
        for (const input of this.settingInputs.values()) {
            input.remove();
        }
        super.clearBlock();
        this.motor1Port.setPortValue(undefined);
        this.motor2Port.setPortValue(undefined);
    }
}

registerFunctionBlock(PIDBlock.name, () => new PIDBlock({}));
