import { assert, msg, MyError, getPlayMode, PlayMode, sleep, setPlayMode, Speech, unique } from "@i18n";
import { ShapeMode } from "./enums";
import { AppServices, GlobalState, idMap } from "./inference";
import { ClickShape, ClickTerm, ToolSelection, ToolFinish, EnumSelection, PropertySetting } from "./operation";
import type { Operation } from "./operation";
import type { MathEntity } from "./json";
import type { Shape } from "./shape";
import type { View } from "./view";
import { isExprTransformBuilder, isShape, isTextBlock } from "./type_guards";
import { movePointer, moveToolSelectionPointer } from "./playback_pointer";
// Existing presentation and property helpers remain until their separate refactor.
import { playShape, setProperty } from "./all_functions";

export async function playBack(play_mode : PlayMode){
    const view : View = GlobalState.View__current!;

    const operations_copy = view.operations.slice();
    view.restoreView();
    view.clearCanvas();

    if(!isNaN(GlobalState.PlayBack__startIndex)){
        play_mode = PlayMode.fastForward;
    }
    
    setPlayMode(play_mode);

    GlobalState.playBackOperations = new PlayBack(view, operations_copy);

    assert(view.shapes.length == 0);

    await GlobalState.playBackOperations.play();

    view.restoreView();

    view.dirty = true;
    view.updateShapes();
}

export class PlayBack {


    private view : View;
    private operations : Operation[];
    private index : number;
    shapeToIndex = new Map<MathEntity,number>();
    private viewShapesLength : number;

    constructor(view : View, operations : Operation[]){
        this.view = view;
        this.operations = operations.slice();
        this.index = 0;
        this.viewShapesLength = view.shapes.length;
    }

    done() : boolean {
        return this.operations.length == this.index;
    }

    next() : Operation {
        if(this.index == GlobalState.PlayBack__startIndex && getPlayMode() == PlayMode.fastForward){
            GlobalState.PlayBack__startIndex = NaN;
            setPlayMode(PlayMode.normal);
        }

        const shapes = this.view.shapes.slice(this.viewShapesLength);
        for(const shape of shapes){
            this.shapeToIndex.set(shape, this.index);
        }

        this.viewShapesLength = this.view.shapes.length;

        return this.operations[this.index++];
    }

    peek() : Operation {
        return this.operations[this.index];
    }

    async play(){
        GlobalState.View__isPlayBack = true;

        const view : View = GlobalState.View__current!;
        let start_shape_idx = view.shapes.length;

        const speech = new Speech();

        let new_shapes : MathEntity[] = view.shapes.slice();
        const named_all_shape_map = new Map<string, Shape>();

        while(!this.done()){
            if(getPlayMode() == PlayMode.stop){
    
                // view.operations = operations_copy;
                break;
            }
    
            while(this.peek() instanceof EnumSelection){
                msg(`wait for show menu`);
                await sleep(100);
            }
    
            const operation = this.next();
            view.addOperation(operation);
            if(operation instanceof ClickShape){
                await movePointer(operation.position);
                let shape : Shape | undefined;
                if(operation.shapeId != undefined){
                    shape = idMap.get(operation.shapeId) as Shape;
                    if( isTextBlock(shape)){
                        shape = undefined;
                    }
                    else if( isShape(shape)){
                    }
                    else{
                        msg(`no shape: ${operation.shapeId}`)
                        const ids = Array.from(idMap.keys()).sort();
                        for(const id of ids){
                            msg(`  ${id} ${idMap.get(id)!.constructor.name}`);
                        }

                        throw new MyError();
                    }
                }
                await GlobalState.Builder__tool!.click(view, operation.position, shape);
            }
            else if(operation instanceof ClickTerm){
                if( isExprTransformBuilder(GlobalState.Builder__tool)){
                    const [textBlock, term] = operation.getTextBlockTerm();
                    await GlobalState.Builder__tool.termClick(term, textBlock);
                }
                else{
                    throw new MyError();
                }
            }
            else if(operation instanceof ToolSelection){
                await moveToolSelectionPointer(operation);
                await AppServices.Builder__setToolByName(operation.toolName, false);
            }
            else if(operation instanceof ToolFinish){
                assert(GlobalState.Builder__toolName == operation.toolName);
                await GlobalState.Builder__tool!.finish(view);
            }
            else if(operation instanceof PropertySetting){
                const shape = view.allShapes().find(x => x.id == operation.id)!;
                if(shape == undefined){
                    msg(`no shape for Property-Setting:${operation.id}`);
                    throw new MyError();
                }

                if([ "name", "lineKind", "angleMark" ].includes(operation.name)){
                    await AppServices.showPropertyDlg(shape, operation);
                }
                else{
                    setProperty(shape, operation.name, operation.value);
                }
            }
            else{
                throw new MyError();
            }
    
            if(GlobalState.Builder__tool!.done){
                GlobalState.Builder__tool!.done = false;
    
                const shapes = view.shapes.slice(start_shape_idx);
                for(const shape of shapes){
                    let sub_shapes : Shape[] = [];
                    shape.getAllShapes(sub_shapes);
                    sub_shapes = unique(sub_shapes);
    
                    sub_shapes.forEach(x => x.show());
                    new_shapes = unique(new_shapes.concat(sub_shapes));
    
                    const named_sub_shapes = sub_shapes.filter(x => isShape(x) && x.name != "") as Shape[];
                    named_sub_shapes.forEach(x => named_all_shape_map.set(x.name, x));
            
                    // shape.allShapes().forEach(x => x.show());
    
                    shape.setRelations();
            
                    if(shape.mute){
                        continue;
                    }
    
                    await playShape(speech, new_shapes, named_all_shape_map, shape);
                }
    
                start_shape_idx = view.shapes.length;
                await speech.waitEnd();
            }
    
            view.dirty = true;
        }
    
        new_shapes.forEach(x => {x.show(); x.setMode(ShapeMode.none); });

        GlobalState.View__isPlayBack = false;

        setPlayMode(PlayMode.stop);
        GlobalState.PlayBack__startIndex = NaN;    
    }
}
