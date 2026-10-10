import { $, $div, $dlg, assert, cancelSpeech, downloadJson, fetchJson, fetchText, getEngTexts, loadTranslationMap, msg, MyError, PlayMode, setPlayMode, setTextLanguageCode, setVoiceLanguageCode, sleep, Speech, TT } from "@i18n";
import { getOperationsText, MathEntity, playBack, reasonToDoc, ShapeMode, Statement, usedReasons } from "@plane"
import { BackUp, Edge, getBackUp, getGraph, graph, hideGraph, showGraph } from "@uroa-firebase"
import { readDoc, theDoc, updateGraphDoc, loadOperationsAndPlay, readDocJson, urlBase } from "./index";
import { setCookie } from "./movie_ui";
import { stopAudio } from "./timeline";

export let allData : { type:string, version:number, docs:any[]};
export const newDocs : any[] = [];
export let isJson = true;

export async function fetchAllData(){
    allData = await fetchJson(`${urlBase}/all-kyozai.json`);
    // バージョン3以上を新しいJSON配列フォーマットとして扱う
    if (3 <= allData.version && Array.isArray(allData.docs)) {
    } else {
        msg(`data is empty or invalid format.`);
        return [];
    }
}

function addTexDiv(){
    const div = document.createElement("div");
    // div.style.width = `${this.texWidth()}px`;
    $div("katex-div").style.display = "";
    $div("katex-div").appendChild(div);

    return div;
}

export async function playStatement(statement : Statement, speech : Speech) {
}

export async function speakAndHighlight(shape : MathEntity, speech : Speech, lines : string[]){
    await speech.speak(lines.shift()!.trim());

    for(const dep of shape.dependencies()){
        
        dep.setMode(ShapeMode.depend);

        await sleep(0.5 * 1000 * shape.interval);
    }


    shape.setMode(ShapeMode.target);

    while(lines.length != 0){
        const line = lines.shift()!.trim();
        if(line != ""){
            await speech.waitEnd();
            await speech.speak(line);
        }
    }

    await sleep(1000 * shape.interval);
}

export async function playLangs(){
    const langs = [
        "ara",
        "chi",
         "eng",
         "fre", 
         "ger",
         "hin",
         "ind",
         "jpn",
         "kor",
         "rus",
         "spa",
         "por",    
    ]

    for(const code3 of langs){

        setVoiceLanguageCode(code3);
        setCookie("VoiceLanguage", code3);
        setTextLanguageCode(code3)
        loadTranslationMap();

        setCookie("TextLanguage", code3);

        await playBack(PlayMode.normal);
    }
}

export function stopPlay(){
    msg("stop play");
    cancelSpeech();
    stopAudio();
    setPlayMode(PlayMode.stop);
}

export async function playAllGraph(){
    hideGraph();

    const graph = getGraph();

    const edge_map = new Map<string, Edge>();

    graph.docs.forEach(x => msg(`${x.id}:${x.title}`));

    setPlayMode(PlayMode.fastForward);
    for(const doc of graph.docs){
        // msg(`graph-doc ${doc.id}:${doc.title}`);
        
        usedReasons.clear();

        await readDoc(doc.id);

        for(const reason of usedReasons){
            const reason_doc_id = reasonToDoc.get(reason);
            if(reason_doc_id != undefined){
                const reason_doc = graph.getDocById(reason_doc_id)!;
                assert(reason_doc != undefined);

                const edge = new Edge(reason_doc, doc);
                edge_map.set(edge.key(), edge);
            }        
        }
    }
    setPlayMode(PlayMode.stop);

    const predifned_edges : [number,number][] = [
/*        
        [7, 8],     // 8 : AngleEqualityReason.vertical_angles
        [50, 52],   // Angle bisector => The bisector of the apex angle of an isosceles triangle bisects the base perpendicularly.
*/        
    ];
    
    for(const [src_id, dst_id] of predifned_edges){
        const src_doc = graph.getDocById(src_id)!;
        const dst_doc = graph.getDocById(dst_id)!;
        assert(src_doc != undefined && dst_doc != undefined);

        const edge = new Edge(src_doc, dst_doc);
        edge_map.set(edge.key(), edge);
    }

    graph.edgeMap = edge_map;
    graph.makeViz();

    showGraph();

    const eng_texts = getEngTexts();
    if(eng_texts != ""){

        msg(`==================== eng-texts:[${eng_texts}] ====================`);
    }

    if(!isJson){
        const data = {
            type    : "uroa-stem",
            version : 3.0,
            docs    : newDocs
        };

        downloadJson("all-kyozai", data);
    }

    msg("play all done.");
}

export async function convert(){
    if(! confirm(TT("Do you want to start the conversion?"))){
        return;
    }
    
    for(const doc of graph.docs){
        await readDoc(doc.id);
        if(theDoc == undefined){
            throw new MyError();
        }

        await updateGraphDoc();
    }

    msg("convert finished.")
}

export async function backup(){
    if(! confirm(TT("Do you want to start the backup?"))){
        return;
    }

    hideGraph();

    const graph = getGraph();

    const backup = new BackUp();
    for(const doc of graph.docs){
        
        await readDoc(doc.id);

        if(theDoc == undefined){
            throw new MyError("doc is undefined.");
        }
    
        const text = getOperationsText();

        await backup.writeBackUp(theDoc.id, theDoc.name, text);
        
        msg(`back-up ${doc.id}:${doc.title}`);
    }

    backup.commitBackUp();

    showGraph();
}

export async function playBackUp(){
    hideGraph();

    for await(const doc_obj of getBackUp()){
        msg(`play backup:${doc_obj.name}`)
        const data = JSON.parse(doc_obj.text);
        await loadOperationsAndPlay(NaN, "", NaN, data);
    }

    showGraph();
}
