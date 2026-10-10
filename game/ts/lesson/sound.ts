///<reference path="../widget/core.ts" />

type SoundEffect = "correct" | "wrong" | "perfect";

export class SoundGenerator {
    private static audioCtx: AudioContext | null = null;

    // AudioContextを一度だけ作って保持する
    private static getContext(): AudioContext {
        if (!this.audioCtx) {
            this.audioCtx = new AudioContext();
        }
        return this.audioCtx;
    }

    /**
     * 指定した種類のエフェクト音を鳴らす
     */
    static play(effect: SoundEffect): void {
        const ctx = this.getContext();

        // ブラウザの自動再生制限対策（Suspend状態ならResumeする）
        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        switch (effect) {
            case "correct":
                this.playCorrect(ctx);
                break;
            case "wrong":
                this.playWrong(ctx);
                break;
            case "perfect":
                this.playFanfare(ctx);
                break;
        }
    }

    // 「ピンポン！」高い音を2回鳴らす
    private static playCorrect(ctx: AudioContext) {
        this.createTone(ctx, 523, 0.1, 0.1); // ド
        this.createTone(ctx, 659, 0.1, 0.2); // ミ
    }

    // 「ブッ」低い音
    private static playWrong(ctx: AudioContext) {
        this.createTone(ctx, 220, 0.3, 0.1); // 低いラ
    }

    private static playFanfare(ctx: AudioContext) {
        const now = ctx.currentTime;

        // リズム：タ・タ・タ・ターン！
        // 時間軸（秒）: 0, 0.1, 0.2, 0.3
        const times = [0, 0.1, 0.2, 0.3];

        // 音の高さ（周波数）: ソ(G4), ソ(G4), ソ(G4), ド(C5) 
        // 最後に和音にするために ミ(E5) と ソ(G5) も重ねる
        const notes = [392.00, 392.00, 392.00, 523.25];

        // 1〜3音目（短い音）
        for (let i = 0; i < 3; i++) {
            this.createTone(ctx, notes[i], 0.08, times[i]);
        }

        // 4音目（最後の決めポーズ：ド・ミ・ソの和音）
        this.createTone(ctx, 523.25, 0.8, 0.3); // ド(C5)
        this.createTone(ctx, 659.25, 0.8, 0.3); // ミ(E5)
        this.createTone(ctx, 783.99, 0.8, 0.3); // ソ(G5)
    }


    // 音を作る共通処理
    private static createTone(ctx: AudioContext, freq: number, duration: number, startTime: number) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.1, ctx.currentTime + startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + startTime + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + startTime);
        osc.stop(ctx.currentTime + startTime + duration);
    }
}
