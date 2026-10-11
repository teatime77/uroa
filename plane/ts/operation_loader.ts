import { MyError, Vec2 } from "@i18n";
import { AppServices, GlobalState } from "./inference";
import { ClickShape, ToolSelection, ToolFinish, EnumSelection, TextPrompt, PropertySetting } from "./operation";
import type { Operation } from "./operation";

export async function loadOperationsJSON(data: any): Promise<Operation[]> {
    if(data == null || !Array.isArray(data.operations)
        || (data.version !== undefined && (typeof data.version !== "number" || !Number.isFinite(data.version) || data.version < 3))
        || !data.operations.every((operation: any) => operation != null && typeof operation === "object" && !Array.isArray(operation) && typeof operation.op === "string")){
        throw new MyError("Expected operation objects (version 3 or later). Legacy operation strings and shape JSON are no longer supported.");
    }

    const view = GlobalState.View__current!;
    view.clearCanvas();

    let operations: Operation[] = [];

    for (const opData of data.operations) {
        let operation: Operation;

        switch (opData.op) {
            case "click": {
                const position = new Vec2(opData.x, opData.y);
                operation = new ClickShape(position, opData.shapeId);
                break;
            }

            case "term": {
                operation = AppServices.makeClickTerm(opData.textBlock_id, opData.indexes);
                break;
            }

            case "tool": {
                operation = new ToolSelection(opData.name);
                break;
            }

            case "finish": {
                operation = new ToolFinish(opData.name);
                break;
            }

            case "enum": {
                operation = new EnumSelection(opData.value);
                break;
            }

            case "text": {
                operation = new TextPrompt(opData.text);
                break;
            }

            case "property": {
                operation = new PropertySetting(opData.id, opData.name, opData.value);
                break;
            }

            default:
                throw new MyError(`Unknown operation op: ${opData.op}`);
        }

        operations.push(operation);
    }

    return operations;
}
