import { getDocumentSize, msg, MyError, Vec2 } from "@i18n";
import { UI, worldCanvas } from "./widget/core";

export function getUIFromId(id : string) : UI {
    for(const ui of worldCanvas.getUIMenus()){
        let all_uis : UI[] = [];
        ui.getAllUI(all_uis);            
        const ui2 = all_uis.find(x => x.id == id);
        if(ui2 != undefined){
            return ui2;
        }
    }

    throw new MyError();
}

export function updateRoot(ui : UI){
    const root = ui.getRootUI();
    root.setMinSize();
    root.layout(root.position, getDocumentSize());

    worldCanvas.requestUpdateCanvas();
}
