import { assert, msg, MyError, getPlayMode, PlayMode, sleep, setPlayMode, Speech, Vec2, unique } from "@i18n";
import { Path, Term } from "@parser";

import { ShapeMode } from "./enums";
import { AppServices, GlobalState, idMap } from "./inference";
import { MathEntity, TextBlock } from "./json";
import { movePointer, moveToolSelectionPointer, playShape, setProperty } from "./all_functions";

import type { Point, Shape } from "./shape";
import type { View } from "./view";
import { isExprTransformBuilder, isShape, isShapeEquation, isTextBlock } from "./type_guards";

export abstract class Operation {
    operationId : number;
    shapesLength = NaN;
    relationLogsLength = NaN;

    abstract toString() : string;
    abstract toJson() : any;

    constructor(){
        this.operationId = GlobalState.Operation__maxId++;
    }

    dump() : string {
        return this.toString();
    }
}

export class ClickShape extends Operation {
    position : Vec2;
    shapeId : string | undefined;
    createdPoint? : Point;

    constructor(position : Vec2, shapeId : string | undefined){
        super();
        this.position = position;
        this.shapeId    = shapeId;
    }

    toString() : string {
        let shape_str = "";

        if(this.shapeId != undefined){
            const shape = idMap.get(this.shapeId) as Shape;
            assert( isShape(shape));
            shape_str = `${this.shapeId} ${shape.constructor.name}`;
        }

        const fnc = (n:number)=>(10 < Math.abs(n) ? n.toFixed(1) : n.toFixed(2));

        const x = fnc(this.position.x);
        const y = fnc(this.position.y);

        return `click ${x} ${y} ${shape_str}`;
    }

    toJson() : any {
        const result: any = {
            op: "click",
            x: Number(this.position.x.toFixed(2)),
            y: Number(this.position.y.toFixed(2)),
        };

        if(this.shapeId != undefined){
            result.shapeId = this.shapeId;
        }

        return result;
    }

    dump() : string {
        if(this.createdPoint == undefined){
            return this.toString();
        }
        else{
            return this.toString() + `point:${this.createdPoint.id} ${this.createdPoint.position}`;
        }
    }
}

export class ClickTerm extends Operation {
    textBlock_id : string;
    indexes : number[];

    constructor(textBlock_id : string, indexes : number[]){
        super();
        this.textBlock_id = textBlock_id;
        this.indexes = indexes.slice();
    }

    getTextBlockTerm() : [TextBlock, Term] {
        let textBlock = GlobalState.View__current!.allShapes().find(x => x.id == this.textBlock_id) as TextBlock;
        if(!( isTextBlock(textBlock)) || textBlock.getEquation() == undefined){
            if( isShapeEquation(textBlock)){
                // !!!!!!!!!!!!!!!!!!!!!!!! ソース修正の副作用の経過措置 !!!!!!!!!!!!!!!!!!!!!!!!!!!!
                textBlock = textBlock.textBlock;
                assert(textBlock.getEquation() != undefined);
            }
            else{
                throw new MyError();
            }
        }

        const path = new Path(this.indexes);
        const term  = path.getTerm(textBlock.getEquation()!);

        return [textBlock, term];
    }

    toString() : string {
        if(this.indexes.length == 0){
            msg(`no indexes:term ${this.textBlock_id}`);
        }
        return `term ${this.textBlock_id}  ${this.indexes.join(":")}`;
    }

    toJson() : any {
        const result: any = {
            op: "term",
            textBlock_id: this.textBlock_id,
            indexes: this.indexes.slice()
        };

        return result;
    }
}

export function makeClickTerm(textBlock_id : string, indexes : number[]) : ClickTerm {
    return new ClickTerm(textBlock_id, indexes);
}

export class ToolSelection extends Operation {
    toolName : string;

    constructor(tool_name : string){
        super();
        this.toolName = tool_name;
    }

    toString() : string {
        return `tool  ${this.toolName}`;
    }

    toJson() : any {
        return { op: "tool", name: this.toolName };
    }
}

export class ToolFinish extends Operation {
    toolName : string;

    constructor(tool_name : string){
        super();
        this.toolName = tool_name;
    }

    toString() : string {
        return `finish  ${this.toolName}`;
    }

    toJson() : any {
        return { op: "finish", name: this.toolName };
    }
}

export class EnumSelection extends Operation {
    value     : number;

    constructor(value : number){
        super();
        this.value = value;
    }

    toString() : string {
        return `enum  ${this.value}`;
    }

    toJson() : any {
        return { op: "enum", value: this.value };
    }
}

export class TextPrompt extends Operation {
    text : string;

    constructor(text : string){
        super();
        this.text = text;
    }

    toString() : string {
        return `text  '${this.text}'`;
    }

    toJson() : any {
        return { op: "text", text: this.text };
    }
}

export class PropertySetting extends Operation {
    id    : string;
    name  : string;
    value : string | number;

    constructor(id : string, name : string, value : string | number){
        super();
        this.id    = id;
        this.name  = name;
        this.value = value;
        // msg(`========== Property-Setting:${name} [${value}] ==================================================`)
    }

    toString() : string {
        if(typeof this.value == "string"){

            return `property ${this.id} ${this.name} '${this.value}'`;
        }
        else{

            return `property ${this.id} ${this.name} ${this.value}`;
        }
    }

    toJson() : any {
        const result: any = {
            op: "property",
            id: this.id,
            name: this.name,
            value: this.value
        };

        return result;
    }
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

console.log(`Loaded: operation`);
