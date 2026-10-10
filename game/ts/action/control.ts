import { LogicalExpression } from "../function/function";
import { Action } from "./action";
import { CompositeAction } from "./sequencer";

export class IfAction extends CompositeAction {
    conditions : LogicalExpression[] = [];

    *exec() : Generator<any> {        
    }
}

