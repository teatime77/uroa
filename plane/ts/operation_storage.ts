import { msg } from "@i18n";
import { saveBlob } from "@layout";
import type { Anchor } from "@layout";
import { GlobalState } from "./inference";

export function saveJson(anchor : Anchor){
    const text = getOperationsText();

    const blob = new Blob([text], { type: 'application/json' });

    saveBlob(anchor, "movie", blob);
}

export function getOperationsText(){
    const data = {
        version : 3,
        operations : GlobalState.View__current!.operations.map(x => x.toJson())
    };

    const doc_text = JSON.stringify(data, null, 4);
    msg(`operations-text : \n${doc_text}\n`);
    
    return doc_text;
}
