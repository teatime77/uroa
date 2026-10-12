import { assert, getPlayMode, PlayMode, range, sleep, Vec2 } from "@i18n";
import { linear } from "@layout";
import { GlobalState } from "./inference";
import type { ToolSelection } from "./operation";

let pointerMove : HTMLImageElement;
let pointer : HTMLImageElement;

let pointerPix : Vec2 = Vec2.zero();

export function initPlay(){
    pointerMove = document.getElementById("pointer_move_img") as HTMLImageElement;
    pointer = document.getElementById("pointer_img") as HTMLImageElement;
}

export async function movePointerPix(pix : Vec2){
    if(getPlayMode() != PlayMode.fastForward){
        pointerMove.style.visibility = "visible";

        const step = 20;
        for(const i of range(step)){
            const x = linear(0, i, step - 1, pointerPix.x, pix.x);
            const y = linear(0, i, step - 1, pointerPix.y, pix.y);
    
            pointerMove.style.left = `${x}px`;
            pointerMove.style.top  = `${y}px`;
            await sleep(10);
        }

        pointerMove.style.visibility = "hidden";
    }
    
    pointer.style.left = `${pix.x}px`;
    pointer.style.top  = `${pix.y}px`;
    pointer.style.visibility     = "visible";
    await sleep(500);
    pointer.style.visibility     = "hidden";

    pointerPix = pix;
}

export async function movePointer(pos : Vec2){
    const pix = GlobalState.View__current!.toPixPosition(pos);
    const rect = GlobalState.View__current!.canvas.getBoundingClientRect();
    const new_pix = new Vec2(rect.x + pix.x, rect.y + pix.y);

    await movePointerPix(new_pix);
}

export async function movePointerToElement(ele : HTMLElement){
    const rect = ele.getBoundingClientRect();
    const x = rect.x + 0.5 * rect.width;
    const y = rect.y + 0.5 * rect.height;

    await movePointerPix(new Vec2(x, y));
}

export async function moveToolSelectionPointer(operation : ToolSelection){
    const id = `${operation.toolName}-radio`;
    const radio = document.getElementById(id)!;
    assert(radio != null);

    await movePointerToElement(radio);
}
