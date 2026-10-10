import { downloadJson } from "@i18n";
import type { Editor } from "./canvas";

export let theEditor : Editor;

export function setEditor(editor : Editor){
    theEditor = editor;
}

export function saveJson(){
    let port_idx = 0;

    const blocks = theEditor.blocks;
    for(const [idx, block] of blocks.entries()){
        block.idx = idx;

        for(const port of block.ports){
            port.idx = port_idx++;
        }
    }

    const json = blocks.map(x => x.makeObj());
    downloadJson("diagram", json);
}
