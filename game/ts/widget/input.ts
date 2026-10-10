import { msg } from "@i18n";
import { Label } from "./text";

let chars : string[] = [];
let inputFocus : Label | undefined;
let onEnter : undefined | ((n: number) => void);

export function setInputFocus(input_focus : Label, on_enter : (n: number) => void){
    inputFocus = input_focus;
    onEnter    = on_enter;
}

export function inputByNumpad(target : Label){
    if(target.text == "Enter"){
        const n = parseInt(chars.join(""));
        if(isNaN(n)){
            msg(`illegal number:${chars}`);
        }
        else{
            msg(`input number:${n}`)
        }

        if(onEnter != undefined){
            onEnter(n);
        }

        chars = [];
    }
    else if(target.text == "⌫"){
        if(chars.length != 0){
            chars.pop();
        }
    }
    else{
        msg(`num-pad:${target.text}`);
        chars.push(target.text);
    }

    if(inputFocus != undefined){
        inputFocus.text = chars.join("");
    }

}
