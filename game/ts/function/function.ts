import { MyError, range2 } from "@i18n";
import { Term } from "@parser";
import { UI, UIAttr } from "../widget/core";
import { Label } from "../widget/text";

type PrimitiveValueType = Term | boolean | number | UI | RuntimeFunction;
type ValueType = PrimitiveValueType | ValueType[];

function makeTermFromObj(obj : any) : Term {
    throw new MyError();
}

function makeTermFromObjs(... objs : any[]) : Term[] {
    throw objs.map(x => makeTermFromObj(x));
}

export abstract class RuntimeFunction {
    constructor(data : any){        
    }

    abstract eval() : ValueType;
    apply(... args:ValueType[]) : ValueType {
        throw new MyError();
    }
}

class randomInt extends RuntimeFunction {
    min : Term;
    max : Term;

    constructor(data : { min : any, max : any }){
        super(data);
        [this.min, this.max] = makeTermFromObjs(data.min, data.max);
    }

    eval() : ValueType {
        const min = this.min.int();
        const max = this.max.int();

        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}


class Range extends RuntimeFunction {
    min : Term;
    max : Term;

    constructor(data : { min : any, max : any }){
        super(data);
        [this.min, this.max] = makeTermFromObjs(data.min, data.max);
    }

    eval() : ValueType {
        const min = this.min.int();
        const max = this.max.int();

        return range2(min, max + 1);
    }
}

class ViewFactory {
    constructor(data : any){        
    }
}

class LabelFactory extends ViewFactory {
    text : string;

    constructor(data : { text : number | string}){
        super(data);
        if(typeof data.text == "number"){
            this.text = data.text.toString();
        }
        else{
            this.text = data.text
        }
    }

    eval() : ValueType {
        return new Label({ text : this.text} as UIAttr);
    }
}

class MapFunction extends RuntimeFunction {
    list     : ValueType[];
    function : RuntimeFunction;

    constructor(data: { list:any[], function : RuntimeFunction}){
        super(data);
        this.list     = data.list.map(x => makeTermFromObj(x));
        this.function = data.function;
    }

    eval() : ValueType {
        const values = this.list.map(x => this.function.apply(x));
        return values;
    }
}

class FilterFunction extends RuntimeFunction {
    list     : ValueType[];
    function : LogicalExpression;

    constructor(data: { list:any[], function : LogicalExpression}){
        super(data);
        this.list     = data.list.map(x => makeTermFromObj(x));
        this.function = data.function;
    }

    eval() : ValueType {
        const values = this.list.filter(x => this.function.apply(x));
        return values;
    }
}

export abstract class LogicalExpression extends RuntimeFunction {
    apply(... args:ValueType[]) : boolean {
        throw new MyError();
    }

    eval(): boolean {
        throw new MyError();
    }
}
