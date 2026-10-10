import { remove, msg } from "@i18n";
import { makeActionFromJSON, registerAction, worldCanvas } from "../widget/core";
import { Action, ActionAttr } from "./action";

export abstract class CompositeAction extends Action {
    actions : Action[] = [];

    constructor(data : ActionAttr & {actions : any[]}){
        super(data);
        this.actions = data.actions.map(x => x instanceof Action ? x : makeActionFromJSON(x));
    }
}

export class SequentialAction extends CompositeAction {
    *exec() : Generator<any> {
        this.finished = false;

        for(const action of this.actions){
            for(const ret of action.exec()){
                yield ret;
            }
        }

        this.finished = true;
        return "seq end";
    }
}

registerAction(SequentialAction.name, (obj) => new SequentialAction(obj));


export class ParallelAction extends CompositeAction {
    *exec() : Generator<any> {
        this.finished = false;

        let gens : Generator<any>[] = this.actions.map(x => x.exec());

        while(gens.length != 0){
            for(const gen of gens.slice()){
                const ret = gen.next();
                if(ret.done){
                    remove(gens, gen);
                }
                else{
                    yield ret.value;
                }
            }
        }

        this.finished = true;
        if(this == Sequencer.rootParallelAction){
            msg("root-parallel-action end")
        }
        return "para end";
    }
}

registerAction(ParallelAction.name, (obj) => new ParallelAction(obj));


export class Sequencer  {
    static rootParallelAction : ParallelAction | undefined;
    static generator : Generator<any> | undefined;

    static init(actions : Action[]){
        if(actions.length != 0){
            Sequencer.rootParallelAction = new ParallelAction({ actions });
        }
        else{
            Sequencer.rootParallelAction = undefined;
        }
    }

    static start(){
        if(Sequencer.rootParallelAction == undefined){
            msg("no actions");
            return;
        }

        Sequencer.generator = Sequencer.rootParallelAction.exec();

        const ret = Sequencer.generator.next();
        msg(`start ${ret.value}`);
        worldCanvas.requestUpdateCanvas();
    }

    static nextAction(){
        if(Sequencer.generator == undefined || Sequencer.rootParallelAction == undefined || Sequencer.rootParallelAction.finished){
            return;
        }

        const ret = Sequencer.generator.next();
        if(ret.value != undefined){
            // msg(`next ${ret.value}`);
        }

        worldCanvas.requestUpdateCanvas();
    }
}
