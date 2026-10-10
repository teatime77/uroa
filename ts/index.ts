/// <reference types="vite/client" />

import { parseMath, setIsProof } from "@parser";
import { initTexTest } from "./tex.js";
import { testProof, saveProofOutput } from "./math_file_parser.js";
import { msg, Speech } from "@i18n";
import { simplify } from "./simplifier.js";
import { initSysVars } from "./formula.js";

export { transpose, addEquations, divideEquation, substitute } from "./algebra.js";
export { initHashTerm, setHashTerm } from "./algebra_util.js";
export { simplify } from "./simplifier.js";
export { testGalois } from "./galois.js";

export async function initAlgebra(){
    setIsProof(true);
    initSysVars();
    initTexTest();
    await testProof();

    // Exporting the parsed sample is a development convenience, not a startup requirement.
    if(import.meta.env.DEV){
        try {
            await saveProofOutput();
        }
        catch(error){
            console.warn("Could not save development proof output:", error);
        }
    }

    const pre = document.getElementById("eqs") as HTMLPreElement;
    const text = pre.innerText.split("\n");
    const eqs  = text.map(x => x.trim()).filter(x => x != "")

    const speech = new Speech();
    // setPlayMode(PlayMode.fastForward);
    for(const eq of eqs){
        const term = parseMath(eq);

        const span = document.createElement("span");
        span.style.height = "30px";
        span.style.cursor = "default";
        span.style.userSelect = "none";
    
        document.body.appendChild(span);
    
        await simplify(speech, span, term);

        const hr = document.createElement("hr");
        document.body.appendChild(hr);
    }

    msg("algebra OK");
}
