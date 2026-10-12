import { assert, msg, MyError, Vec2 } from "@i18n";
import { Path, Term } from "@parser";

import { GlobalState, idMap } from "./inference";
import type { TextBlock } from "./json";

import type { Point, Shape } from "./shape";
import { isShape, isShapeEquation, isTextBlock } from "./type_guards";

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

console.log(`Loaded: operation`);
