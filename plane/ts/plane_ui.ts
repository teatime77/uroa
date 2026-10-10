import { setOnSpeak } from "@i18n";
import { $anchor, $block, $button, $checkbox, $flex, $grid, $textbox, Block, CheckBox, Grid, TextBox, fgColor } from "@layout";

import { GlobalState, setUrlOriginParams, urlBase, urlParams } from "./inference";
import { makeToolButtons, saveJson } from "./all_functions";

export class Plane {
    menu_block : Block;
    tool_block : Block;
    text_block : Block;
    canvas_block : Block;
    property_block : Grid;
    shapes_block : Block;
    narration_box : TextBox;
    editMode : boolean;

    show_axis! : CheckBox;
    show_grid! : CheckBox;
    snap_to_grid! : CheckBox;

    constructor(){
        GlobalState.Plane__one = this;
        
        setUrlOriginParams();
        this.editMode = (urlParams.get("mode") == "edit");
        
        const tool_buttons = makeToolButtons();
        
        GlobalState.Plane__one.show_axis = $checkbox({
            text : "Axis",
            change : async (ev : Event)=>{
                GlobalState.View__current!.dirty = true;
            }
        });

        GlobalState.Plane__one.show_grid = $checkbox({
            text : "Grid",
            change : async (ev : Event)=>{
                GlobalState.View__current!.dirty = true;                
            }
        });

        GlobalState.Plane__one.snap_to_grid = $checkbox({
            text : "Snap to Grid",
        });

        const save_anchor = $anchor({
        });
        
        this.menu_block = $flex({
            children : [
                GlobalState.Plane__one.show_axis
                ,
                GlobalState.Plane__one.show_grid
                ,
                GlobalState.Plane__one.snap_to_grid
                ,
                $button({
                    width : "24px",
                    height : "24px",
                    url : `${urlBase}/../plane/images/undo.png`,
                    click : async(ev : MouseEvent)=>{
                        await GlobalState.View__current!.undo();
                    }
                })
                ,
                $button({
                    width : "24px",
                    height : "24px",
                    url : `${urlBase}/../plane/images/redo.png`,
                    click : async(ev : MouseEvent)=>{
                        await GlobalState.View__current!.redo();
                    }
                })
                ,
                $button({
                    text : "Save",
                    click : async(ev : MouseEvent)=>{
                        saveJson(save_anchor);
                    }
                })
                ,
                save_anchor
            ],
        });
    
        this.tool_block = $grid({
            id : "tool-block",
            columns  : "36px 36px",
            children : tool_buttons,
        });
    
        this.text_block = $flex({
            id : "text-block",
            children : [],
        });
    
        this.canvas_block = $block({
            width:"960px",
            height:"480px",
            children : [],
            color : fgColor,
            // backgroundColor : "cornsilk"
        });
    
        this.property_block = $grid({
            id : "property-div",
            columns  : "50% 50%",
            children : [],
        });
    
        this.shapes_block = $flex({
            id : "shapes-block",
            direction : "column",
            children : [],
        });       
        
        this.narration_box = $textbox({
            id : "narration-box",
            text : "",
            color : fgColor,
            padding : 20,
            textAlign : "center",
            fontSize : "48px",
        });

        setOnSpeak( (text : string)=>{
            this.narration_box.setText(text);
        });
    }

    clearPlane(){    
        this.text_block.div.innerHTML = "";
        this.narration_box.div.innerHTML = "";
    }
}

console.log(`Loaded: plane-ui`);
