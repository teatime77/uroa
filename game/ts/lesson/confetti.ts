///<reference path="../widget/core.ts" />

import { Vec2 } from "@i18n";
import { VisibleArea, UI, UIAttr, worldCanvas } from "../widget/core";

class ConfettiPiece {
    x: number;
    y: number;
    size: number;
    color: string;
    speedX: number;
    speedY: number;
    rotation: number;
    rotationSpeed: number;

    constructor(canvasWidth: number) {
        this.x = Math.random() * canvasWidth;
        this.y = Math.random() * -50; // 画面の上からスタート
        this.size = Math.random() * 10 + 5;
        this.color = `hsl(${Math.random() * 360}, 100%, 50%)`; // カラフルな色
        this.speedX = Math.random() * 3 - 1.5; // 横揺れ
        this.speedY = Math.random() * 3 + 2;   // 落下速度
        this.rotation = Math.random() * 360;
        this.rotationSpeed = Math.random() * 10 - 5;
    }

    update() {
        this.x += this.speedX;
        this.y += this.speedY;
        this.rotation += this.rotationSpeed;
    }

    draw(ctx: CanvasRenderingContext2D) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);
        ctx.fillStyle = this.color;
        ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
        ctx.restore();
    }
}

export class ConfettiManager extends UI {
    private pieces: ConfettiPiece[] = [];
    isRunning: boolean = true;
    startTime = Date.now();

    constructor(data : UIAttr) {
        super(data);
        this.pieces = Array.from({ length: 100 }, () => new ConfettiPiece(worldCanvas.canvas.width));
    }

    draw(ctx : CanvasRenderingContext2D, offset : Vec2, visibleArea : VisibleArea | undefined) : void {
        this.pieces.forEach((p, i) => {
            p.update();
            p.draw(ctx);

            // 画面外に出た粒を削除（または再利用）
            if (p.y > worldCanvas.canvas.height) {
                this.pieces.splice(i, 1);
            }
        });

        this.isRunning = (this.pieces.length != 0);
        this.isRunning = Date.now() - this.startTime < 1000;
    }
}

class Particle {
    x: number;
    y: number;
    vx: number; // 横方向の速度
    vy: number; // 縦方向の速度
    life: number = 1.0; // 生存率（1.0から0に向かって減らす）
    color: string;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 6 + 2;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.color = `hsl(${Math.random() * 360}, 100%, 50%)`; // カラフルな色
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += 0.1; // 重力
        this.vx *= 0.98; // 空気抵抗
        this.vy *= 0.98;
        this.life -= 0.02; // 徐々に透明にする
    }

    draw(ctx: CanvasRenderingContext2D) {
        ctx.save();
        // ctx.globalAlpha = this.life;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.restore();
    }
}

export class ParticleManager extends UI {
    private pieces: Particle[] = [];
    isRunning: boolean = true;
    startTime = Date.now();

    constructor(data : UIAttr) {
        super(data);
        const canvas = worldCanvas.canvas;
        this.pieces = Array.from({ length: 100 }, () => new Particle(canvas.width / 2, canvas.height / 2));
    }

    draw(ctx : CanvasRenderingContext2D, offset : Vec2, visibleArea : VisibleArea | undefined) : void {
        this.pieces.forEach((p, i) => {
            p.update();
            p.draw(ctx);

            // 画面外に出た粒を削除（または再利用）
            const canvas = worldCanvas.canvas;
            if (p.x < 0 || canvas.width < p.x || p.y < 0 || canvas.height < p.y){
                this.pieces.splice(i, 1);
            }
        });

        this.isRunning = (this.pieces.length != 0);
        this.isRunning = Date.now() - this.startTime < 1000;
    }
}

export class HanamaruDrawer extends UI {
    // private centerX: number;
    // private centerY: number;
    private radius: number;
    speed: number = 0.02;
    private progress: number = 0; // 0から1で進行度を管理
    isRunning: boolean = true;

    constructor(data : UIAttr & { radius : number, speed?: number }) {
        super(data);
        // this.centerX = x;
        // this.centerY = y;
        this.radius = data.radius;
        if(data.speed != undefined){
            this.speed  = data.speed;
        }
    }

    // 描画のメインループ
    draw(ctx : CanvasRenderingContext2D, offset : Vec2, visibleArea : VisibleArea | undefined) : void {
        if (this.progress >= 1) {
            this.isRunning = false;
            return;
        }

        this.isRunning = true;
        this.progress += this.speed;

        ctx.save();
        ctx.strokeStyle = '#FF4500'; // 朱色（テストの丸の色）
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';

        // 1. 内側の円を描く
        const circleEnd = 0.4; // 全体の40%で円を完成させる
        if (this.progress > 0) {
            const p = Math.min(this.progress / circleEnd, 1);
            this.drawCircle(ctx, p);
        }

        // 2. 外側の花びらを描く
        if (this.progress > circleEnd) {
            const p = (this.progress - circleEnd) / (1 - circleEnd);
            this.drawPetals(ctx, p);
        }

        ctx.restore();
    }

    private drawCircle(ctx: CanvasRenderingContext2D, p: number) {
        ctx.beginPath();

        const startRadius = this.radius * 0.2; // 書き始め（内側）の半径
        const endRadius = this.radius * 0.8;   // 書き終わり（外側）の半径
        const totalRotation = Math.PI * 4.2;   // 1周（2π）より少し多めに回すと「重なり」が出てリアル

        for (let t = 0; t <= totalRotation * p; t += 0.05) {
            // 進行度に合わせて半径を徐々に大きくする
            const currentRadius = startRadius + (endRadius - startRadius) * (t / totalRotation);

            // 座標計算
            const x = this.position.x + currentRadius * Math.cos(t);
            const y = this.position.y + currentRadius * Math.sin(t);

            if (t === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
    }


    // 花びらを描画するメソッド（トロコイド曲線の応用）
    private drawPetals(ctx : CanvasRenderingContext2D, p: number) {
        ctx.beginPath();
        const numPetals = 5;
        const petalSize = this.radius * 0.3;
        const baseRadius = this.radius * 0.8;

        for (let t = 0; t <= Math.PI * 2 * p; t += 0.05) {
            // 花びらのギザギザを作る数式
            const r = baseRadius + Math.abs(Math.sin(t * (numPetals / 2))) * petalSize;
            const x = this.position.x + r * Math.cos(t);
            const y = this.position.y + r * Math.sin(t);

            if (t === 0){
                ctx.moveTo(x, y);
            }
            else{
                ctx.lineTo(x, y);
            }
        }

        ctx.stroke();
    }
}
