import { assert, msg } from "@i18n";
import { saveBlob } from "@layout";
import type { Anchor } from "@layout";
import { AppServices, GlobalState } from "./inference";
import type { Operation } from "./operation";

export function saveJson(anchor : Anchor){
    const text = getOperationsText();

    const blob = new Blob([text], { type: 'application/json' });

    saveBlob(anchor, "movie", blob);
}

export function convertOperations(version : number, operations : Operation[]) : Operation[] {
    if(version == 2.0){

        const new_operations : Operation[] = [];
        let idx = 0;
        while(idx < operations.length){
            const operation = operations[idx];
            new_operations.push(operation);
        
            if(AppServices.isToolSelection(operation) && [ "LengthEqualityBuilder", "AngleEqualityBuilder", "ParallelDetectorBuilder"].includes(operation.toolName)){
                assert(AppServices.isEnumSelection(operations[idx + 3]));

                new_operations.push(operations[idx + 3]);
                new_operations.push(operations[idx + 1]);
                new_operations.push(operations[idx + 2]);

                idx += 4;
            }
            else if( AppServices.isToolSelection(operation) && operation.toolName ==  "QuadrilateralClassifierBuilder"){
                assert( AppServices.isEnumSelection(operations[idx + 5]) && AppServices.isEnumSelection(operations[idx + 6]));

                new_operations.push(operations[idx + 5]);
                new_operations.push(operations[idx + 6]);

                new_operations.push(operations[idx + 1]);
                new_operations.push(operations[idx + 2]);
                new_operations.push(operations[idx + 3]);
                new_operations.push(operations[idx + 4]);

                idx += 7;
            }
            else{
                idx++;
            }
        }
        return new_operations;
    }

    return operations;
}

export function getOperationsText(){
    const data = {
        version : 2.1,
        operations : GlobalState.View__current!.operations.map(x => x.toString())
    };

    const doc_text = JSON.stringify(data, null, 4);
    msg(`operations-text : \n${doc_text}\n`);
    
    return doc_text;
}
