///<reference path="core.ts" />

import { msg } from "@i18n";
import { Firework } from "./misc";


export function dumpObj(data : any, nest : number, done : Set<any>){
    const tab = " ".repeat(4 * nest);
    for (const [key, value] of Object.entries(data)) {
        if(Array.isArray(value)){
            msg(`${tab}${key} : [`);
            for(const [i, element] of value.entries()){
                if(data instanceof Firework){
                    msg(`${tab}    ・・・`);
                    break;
                }

                msg(`${tab}    ${i}`);
                dumpObj(element, nest + 2, done);
            }
            msg(`${tab}]`);
        }
        else if(value == undefined){

                // msg(`${tab}${key} : undefined`);
        }
        else if(value == null){

                msg(`${tab}${key} : null`);
        }
        else if (typeof value == "object"){
            if(done.has(value)){

                msg(`${tab}${key} : ${value.constructor.name} *`);
            }
            else{
                done.add(value);

                msg(`${tab}${key} : ${value.constructor.name}`);
                dumpObj(value, nest + 1, done);
            }
        }
        else if (typeof value == "function"){
            msg(`${tab}${key} : ${typeof value} ${value.name}`);
        }
        else{
            msg(`${tab}${key} : ${typeof value} = ${value}`);
        }
    }    
}
