import { MyError, Vec2, fetchJson } from "@i18n";
import { registerUI, UI, UIAttr, makeUIFromJSON, makeActionFromJSON } from "./widget/core";

import type { PopupMenu } from "./widget/menu";
import type { Action } from "./action/action";

export interface JsonData {
    target?  : string;
    imports? : string[];
    uis: any[];
    menus : any[];
    actions : any[];
}

export interface StageData {
    uis: UI[];
    menus : PopupMenu[];
    actions : Action[];
}

const importedJsons = new Map<string, JsonData>();
const nameMap = new Map<string, UI>();
const pathMap = new Map<string, UI>();

function getNameFromPath(path : string) : string {
    const k = path.lastIndexOf(".");
    if(k == -1){
        return path;
    }
    else{
        return path.substring(k + 1);
    }
}

export class SymbolRef {
    static clearSymbolMap(){
        nameMap.clear();
        pathMap.clear();
    }

    static async importLibrary(url : string) : Promise<StageData> {
        const path = url.replaceAll(".", "/");

        let data : JsonData | undefined = importedJsons.get(path);
        if(data == undefined){
            const { basePath } = await import("./index");
            data = await fetchJson(`${basePath}/data/${path}.json?id=${Math.random()}`) as JsonData;
            importedJsons.set(path, data);
            // msg(`lib:${url}\n ${JSON.stringify(data, null, 4)}`);
        }

        if(data.imports != undefined){
            for(const path of data.imports){
                await SymbolRef.importLibrary(path);
            }
        }

        const uis = data.uis.map(x => makeUIFromJSON(x));

        const all_uis : UI[] = [];
        uis.forEach(x => x.getAllUIsub(all_uis));
        for(const ui of all_uis){
            if(ui.name != undefined){
                const key = `${url}.${ui.name}`;
                if(nameMap.has(ui.name)){
                    if(ui != nameMap.get(ui.name)){
                        throw new MyError();
                    }
                }
                else{

                    nameMap.set(ui.name, ui);
                }
                pathMap.set(key, ui);
            }
        }

        const menus = data.menus.map(x => makeUIFromJSON(x)) as PopupMenu[];
        const actions = data.actions.map(x => makeActionFromJSON(x));

        const stageData : StageData = {
            uis,
            menus,
            actions
        }

        return stageData;
    }

    static lookupRegistry(data : UIAttr & { className : string, path : string }){
        let ui : UI | undefined;
        ui = pathMap.get(data.path);
        if(ui == undefined){
            const name = getNameFromPath(data.path);
            ui = nameMap.get(name);

            if(ui == undefined){
                throw new MyError();
            }
        }

        if(data.position != undefined){
            ui.setPosition(Vec2.fromXY(data.position[0], data.position[1]));
        }
        ui.copyFromUIAttr(data);

        return ui;
    }
}

registerUI(SymbolRef.name, SymbolRef.lookupRegistry);
