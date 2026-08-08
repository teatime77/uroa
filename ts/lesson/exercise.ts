import { MyError, getRandomInt, msg, range2, shuffle, Vec2 } from "@i18n";
import { App, parseMath } from "@parser";
import { Action, ActionAttr } from "../action/action";
import { Digit, VariableUI } from "../math/arithmetic/arithmetic";
import { MathExprLayout, makeMathExprLayout } from "../math/math-expr-layout";
import { ContainerUI } from "../widget/container";
import { registerAction, UI, worldCanvas } from "../widget/core";
import { Grid } from "../widget/grid";
import { ImageUI } from "../widget/image";
import { setInputFocus } from "../widget/input";
import { Stage } from "../widget/stage";
import { currentLesson, Label, PlaceHolder } from "../widget/text";
import { ConfettiManager, ParticleManager, HanamaruDrawer } from "./confetti";
import { SoundGenerator } from "./sound";
import { getUIFromId } from "../game_util";

export type  MathExprUI = Digit | VariableUI | MathExprLayout;

const trialCount = 5;
const additionWithin10s    : [number, number][] = [];
const subtractionWithin10s : [number, number][] = [];
const additionSum11To19    : [number, number][] = [];

let mathExLayout : MathExprUI;

let lessonMap = new Map<string, (...arg:any)=>CalcEx[]>();

function getAnsLabel(ui : UI) : VariableUI | undefined {
    if(ui instanceof VariableUI){
        return ui.value.name == "ans" ? ui : undefined;
    }
    else if(ui instanceof ContainerUI){
        const target = ui.children.map(x => getAnsLabel(x)).find(x => x != undefined);
        if(target != undefined){
            return target;
        }
    }

    return undefined;
}

export class ArithmeticFormulaExercise extends Action {
    positions : Vec2[];

    constructor(data : ActionAttr & {positions : [number, number][]}){
        super(data);
        if(data.positions == undefined || data.positions.length != 2){
            throw new MyError();
        }
        this.positions = data.positions.map(x => Vec2.fromXY(x[0], x[1]));



    }

    *exec() : Generator<any> {        
        msg("Arithmetic-Formula-Exercise");
        const stage = Stage.mainStage;
        if(stage == undefined || currentLesson == undefined){
            throw new MyError();
        }

        const fnc = lessonMap.get(currentLesson.lesson!);
        if(fnc == undefined){
            throw new MyError();
        }

        const results = getUIFromId("results") as Grid;
        const question = getUIFromId("question") as Label;
        const imageExprPlaceHolder = getUIFromId("imageExpr") as PlaceHolder;
        const mathExprPlaceHolder  = getUIFromId("mathExpr") as PlaceHolder;

        if([results, question, imageExprPlaceHolder, mathExprPlaceHolder].some(x => x == undefined)){
            throw new MyError();
        }

        const exs = fnc(trialCount, ...currentLesson.args);
        for(const [idx, ex] of exs.entries()){

            if(mathExLayout != undefined && stage.children.includes(mathExLayout)){
                stage.removeChild(mathExLayout);
            }

            mathExLayout = makeMathExprLayout(ex.expr);
            stage.addChildren(mathExLayout);
            mathExLayout.setPosition(this.positions[1]);
            mathExLayout.setMinSizeUpdateLayout();

            const ansLabel = getAnsLabel(mathExLayout);
            if(ansLabel == undefined){
                throw new MyError();
            }

            let num : number = NaN;

            setInputFocus(ansLabel, (n: number) => {
                num = n;
            });

            worldCanvas.requestUpdateCanvas();


            while(isNaN(num)){
                yield;
            }

            let img : ImageUI;
            const imgSize = 64;
            if(num == ex.ans){
                msg(`OK:${ex.expr} ${ex.ans} = ${num}`);
                img = new ImageUI({ imageFile:"good.png", size:[imgSize, imgSize], backgroundColor:"white"});
                let confetti : ConfettiManager | ParticleManager | HanamaruDrawer;
                switch(idx % 3){
                case 0:
                    SoundGenerator.play("correct");
                    confetti = new ConfettiManager({});
                    break;
                case 1:
                    SoundGenerator.play("wrong");
                    confetti = new ParticleManager({});
                    break;
                case 2:
                    SoundGenerator.play("perfect");
                    confetti = new HanamaruDrawer({ position:[500,500], radius : 50});
                    break;
                default:
                    throw new MyError();
                }

                stage.addChildren(confetti);
                while(confetti.isRunning){
                    yield;
                }
                stage.removeChild(confetti);
            }
            else{
                msg(`NG:${ex.expr} ${ex.ans} <> ${num}`);
                img = new ImageUI({ imageFile:"ng.png", size:[imgSize,imgSize], backgroundColor:"white"});
            }

            img.setPosition(this.positions[0].add(Vec2.fromXY(idx * (imgSize + 10), 0)));
            stage.addChildren(img);
            img.setMinSize();
        }

        const label = new Label({ text:"よくできました。", fontSize:"60px"});
        stage.addChildren(label);
        label.setMinSize();
        const x = stage.netSize.x / 2 - label.netSize.x / 2;
        const y = stage.netSize.y / 2;
        label.setPosition(Vec2.fromXY(x, y));
    }
}

registerAction(ArithmeticFormulaExercise.name, (obj) => new ArithmeticFormulaExercise(obj));


class CalcEx {
    expr: App;
    ans : number;

    constructor(expr: string, ans: number) {
        this.expr = parseMath(expr, true) as App;
        this.ans  = ans;
    }

    toString() : string {
        return `${this.expr.str()} : ${this.ans}`;
    }
}

lessonMap.set("AdditionWithin10", function(count : number) : CalcEx[] {
    if(additionWithin10s.length == 0){
        for(const i of range2(1, 10)){
            for(const j of range2(1, 11 - i)){
                additionWithin10s.push([i, j]);
                // msg(`add 10 ${i} ${j}`);
            }
        }
    }

    const nums = shuffle(additionWithin10s).slice(0, count);
    return nums.map(x => new CalcEx(`${x[0]} + ${x[1]} = ans`, x[0] + x[1]));
});

lessonMap.set("SubtractionWithin10", function(count : number) : CalcEx[] {
    if (subtractionWithin10s.length == 0) {
        for (const num1 of range2(2, 11)) {
            // num2（引く数）は 0 から num1 未満まで (答えが1以上になるように)
            // ※ もし答えに 0 を含めたいなら num2 <= num1 にする
            for (const num2 of range2(1, num1)) {
                subtractionWithin10s.push([num1, num2]);
            }
        }
    }

    const nums = shuffle(subtractionWithin10s).slice(0, count);
    return nums.map(x => new CalcEx(`${x[0]} - ${x[1]} = ans`, x[0] - x[1]));
});

lessonMap.set("AdditionSum11To19", function(count : number) : CalcEx[] {
    if(additionSum11To19.length == 0){
        // 1桁の足し算で和が11〜19になる組み合わせ
        // num1, num2 ともに 2〜9 の範囲（1+9などは最大10なので除外される）
        for (const n1 of range2(2, 10)) {
            for (let n2 of range2(2, 10)) {
                const sum = n1 + n2;
                if (sum >= 11 && sum <= 19) {
                    additionSum11To19.push([n1, n2]);
                }
            }
        }    
    }

    const nums = shuffle(additionSum11To19).slice(0, count);
    return nums.map(x => new CalcEx(`${x[0]} + ${x[1]} = ans`, x[0] + x[1]));
});

lessonMap.set("SubtractionFrom11to19", function(count : number) : CalcEx[] {
    const exs : CalcEx[] = [];

    const num1s = shuffle(range2(11, 19)).slice(0, count);
    for(const n1 of num1s){
        const n2 = getRandomInt(n1 - 10 + 1, 9);
        exs.push(new CalcEx(`${n1} - ${n2} = ans`, n1 - n2));
    }

    return exs;
});

lessonMap.set("MultiplicationTable", function(count : number, num : number) : CalcEx[] {
    const nums = shuffle(range2(2, 10)).slice(0, count);
    return nums.map(x => new CalcEx(`${x} * ${num} = ans`, x * num));
});

lessonMap.set("FriendsOfTen", function(count : number) : CalcEx[] {
    const nums = shuffle(range2(1, 10)).slice(0, count);
    return nums.map(x => new CalcEx(Math.random() < 0.5 ? `${x} + ans = 10` : `ans + ${x} = 10`, 10 - x));
});

lessonMap.set("SubtractionFrom10", function(count : number) : CalcEx[] {
    const nums = shuffle(range2(1, 10)).slice(0, count);
    return nums.map(x => new CalcEx(`10 - ${x} = ans`, 10 - x));
});

export function testEx(){
    for(const [name, fnc] of lessonMap.entries()){
        const exs = fnc(trialCount);
        exs.forEach(x => msg(`${name}: ${x}`));        
    }
}

interface MathProblem {
  num1: number;
  num2: number;
  answer: number;
}

class AdditionGenerator {
  /**
   * 和が10以下になる全パターンのリストを作成し、そこからランダムに抽出する
   */
  static generate(count: number, includeZero: boolean = false): MathProblem[] {
    const allPatterns: MathProblem[] = [];
    const startNum = includeZero ? 0 : 1;

    // 1. 和が10以下になる組み合わせを全網羅
    for (let i = startNum; i <= 10; i++) {
      for (let j = startNum; j <= 10 - i; j++) {
        allPatterns.push({
          num1: i,
          num2: j,
          answer: i + j
        });
      }
    }

    // 2. 配列をシャッフル（フィッシャー・イェーツの手法）
    for (let i = allPatterns.length - 1; i > 0; i--) {
      const r = Math.floor(Math.random() * (i + 1));
      [allPatterns[i], allPatterns[r]] = [allPatterns[r], allPatterns[i]];
    }

    // 3. 必要な数だけ返す
    return allPatterns.slice(0, count);
  }
}

// export class Exercise extends Lesson {

// }
