import { $dlg, TT, AppMode, msg, appMode, setTextLanguageCode, loadTranslationMap, setVoiceLanguageCode } from "@i18n";
import { Flex, $grid, $flex, $button, Grid, Log } from "@layout";
import { updateGraphDoc, root } from "./index";
import { Plane } from "@plane";
import { copyAllGraph, showContents } from "@uroa-firebase";

let isVoiceLang : boolean;

export function makePlayEditGrid(plane : Plane, play_buttons : Flex, button_size : number) : Grid {
    const margin = 10;
    const canvas_narration_height = window.innerHeight - margin - 25 - button_size;

    const edit_menu_grid = $grid({
        columns  : "50% 50%",
        children: [
            plane.menu_block
            ,
            $flex({
                children : [
                    $button({
                        text : "update doc",
                        click : async (ev:MouseEvent)=>{
                            await updateGraphDoc();
                        }
                    })
                    ,
                    $button({
                        text : "edit contents",
                        click : async (ev:MouseEvent)=>{
                            await showContents(undefined, undefined);
                        }
                    })
                    ,
                    $button({
                        text : "firebase",
                        click : async (ev:MouseEvent)=>{
                            $dlg("firebase-menu").showModal();        
                        }
                    })
                    ,
                    $button({
                        text : "log",
                        click : async (ev:MouseEvent)=>{
                            Log.show(ev);
                        }
                    })
                    ,
                    $button({
                        text : "copy all",
                        click : async (ev:MouseEvent)=>{
                            if(window.confirm(TT("Do you want to copy all data?"))){

                                await copyAllGraph();
                            }
                        }
                    })
                ],
            })
        ]
    });

    const main_grid = $grid({
        columns  : "72px 960px 40px 300px",

        children : [
            plane.tool_block
            ,
            $grid({
                id : "canvas-narration",
                rows  : "480px 378px",
                children : [
                    plane.canvas_block
                    ,
                    plane.narration_box        
                ]
            })
            ,
            plane.shapes_block
            ,
            plane.property_block
        ]
    });

    if(appMode == AppMode.edit){

        return $grid({
            rows     : `25px ${canvas_narration_height}px ${button_size}px`,
            children:[
                edit_menu_grid            
                ,
                main_grid
                ,
                play_buttons
            ]
        });
    }
    else{

        return $grid({
            rows     : `${canvas_narration_height}px ${button_size}px`,
            children:[
                main_grid
                ,
                play_buttons
            ]
        });
    }

    return root;    
}

export function showLangDlg(is_voice_lang : boolean){
    isVoiceLang = is_voice_lang;
    $dlg("lang-dlg").showModal();
}

export function langButtonClicked(ev:MouseEvent){
    const button = ev.target as HTMLButtonElement;
    const code3 = button.value;
    msg(`lang:${code3}`);
    if(isVoiceLang){
        setVoiceLanguageCode(code3);
        setCookie("VoiceLanguage", code3);
    }
    else{
        setTextLanguageCode(code3)
        loadTranslationMap();

        setCookie("TextLanguage", code3);
    }
    $dlg("lang-dlg").close();
}

export function setCookie(name : string, value : string) {
    var expires = "";
    var date = new Date();
    // Set the expiration date to 20 years from now
    date.setTime(date.getTime() + (20 * 365 * 24 * 60 * 60 * 1000));
    expires = "; expires=" + date.toUTCString();
    document.cookie = name + "=" + (value || "") + expires + "; path=/";
}

// Function to get a cookie value by name
export function getCookie(name : string) : string | undefined {
    var nameEQ = name + "=";
    var cookiesArray = document.cookie.split(';');
    for (var i = 0; i < cookiesArray.length; i++) {
        var cookie = cookiesArray[i];
        while (cookie.charAt(0) == ' ') {
            cookie = cookie.substring(1, cookie.length);
        }
        if (cookie.indexOf(nameEQ) == 0) {
            return cookie.substring(nameEQ.length, cookie.length);
        }
    }

    return undefined;
}
