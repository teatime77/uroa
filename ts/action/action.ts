import { type AbstractUI, range, Vec2 } from "@i18n";
import { getObjectById, registerAction } from "../widget/core";

export interface ActionAttr {
    args? : any;
}

export abstract class Action {
    finished : boolean = false;

    constructor(data : ActionAttr){  
    }

    abstract exec() : Generator<any>;
}

export class NumAction extends Action {
    count : number;

    constructor(data : ActionAttr & {count : number}){
        super(data);
        this.count = data.count;
    }

    *exec() : Generator<any> {
        this.finished = false;

        for(const i of range(this.count)){
            const value = `num ${i + 1}/${this.count}`;
            // msg()
            yield `gen ${i + 1}/${this.count}`;
        }

        this.finished = true;
        return `num end ${this.count}`;
    }
}

registerAction(NumAction.name, (obj) => new NumAction(obj));


export class MoveAction extends Action {
    target      : AbstractUI;
    destination : Vec2;
    duration    : number;

    constructor(data : ActionAttr & { target : string, destination : [number, number], duration : number }){
        super(data);
        this.target      = getObjectById(data.target);
        this.destination = Vec2.fromXY(... data.destination);
        this.duration    = data.duration;
    }

    *exec() : Generator<any> {
        this.finished = false;

        const start_time = Date.now();
        let   prev_time  = start_time;
        const start_position = this.target.getPosition();

        while(true){
            const elapsed_time_sec = (Date.now() - start_time) / 1000.0;
            if(this.duration <= elapsed_time_sec){
                break;
            }

            const ratio = elapsed_time_sec / this.duration;

            const next_position = start_position.mul(1 - ratio).add(this.destination.mul(ratio));

            this.target.setPosition(next_position);

            if(Date.now() - prev_time < 500){
                yield undefined;
            }
            else{

                prev_time = Date.now();
                yield `move to ${next_position} ${this.duration} ${elapsed_time_sec} ${ratio}`;
            }
        }

        this.finished = true;
    }
}


registerAction(MoveAction.name, (obj) => new MoveAction(obj));
