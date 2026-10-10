import { msg, getPlayMode, PlayMode, MyError, range, sleep, assert, parseURL, langCodeList, setTextLanguageCode, voiceLanguageCode, initI18n, appMode, AppMode, initSpeech, $dlg, setVoiceLanguageCode, downloadJson, fetchJson } from "@i18n";
import { DbDoc, getMyDoc, getRootFolder, initFirebase, initForMovie, makeDocsGraph, uploadCanvasImg, writeGraphDocDB, addGraphSection, addGraphItem, changeDisplay, updateGraph, renameDoc, deleteDoc, renameSection } from "@uroa-firebase";
import { $button, $flex, bgColor, Button, fgColor, getPhysicalSize, Grid, Layout } from "@layout";
import { getOperationsText, GlobalState, initPlane, initRelations, loadData, loadOperationsText, Plane, playBack, removeDiv } from "@plane";
import { stopPlay, playAllGraph, convert, backup, playBackUp, newDocs, isJson, allData, fetchAllData } from "./flow";
import { playLesson, initLesson, makeLessonPlayGrid, makeLessonEditGrid, initLessonPlay } from "./lesson";
import { getCookie, showLangDlg, makePlayEditGrid, langButtonClicked } from "./movie_ui";
import { includeDialog } from "./movie_util";
import { loadOperationsJSON } from "../../plane/ts/factories";
import { Operation } from "../../plane/ts/operation";

export let theDoc : DbDoc | undefined;
export let root : Grid;
export let urlOrigin : string;
export let urlParams : Map<string, string>;
export let urlBase : string;
export let playStopButton : Button;

export function setDoc(doc : DbDoc | undefined){
    theDoc = doc;
}

function setupEventListeners() {
    document.getElementById('play-all-graph')?.addEventListener('click', async () => {
        await playAllGraph();
    });
    document.getElementById('convert-movie')?.addEventListener('click', async () => {
        await convert();
    });
    document.getElementById('backup-movie')?.addEventListener('click', async () => {
        await backup();
    });
    document.getElementById('play-backup')?.addEventListener('click', async () => {
        await playBackUp();
    });
    document.getElementById('add-graph-section')?.addEventListener('click', async () => {
        await addGraphSection();
    });
    document.getElementById('add-graph-item')?.addEventListener('click', async () => {
        await addGraphItem();
    });
    document.getElementById('change-display')?.addEventListener('click', async () => {
        await changeDisplay();
    });
    document.getElementById('update-graph')?.addEventListener('click', async () => {
        await updateGraph();
    });
    document.getElementById('rename-doc')?.addEventListener('click', async () => {
        await renameDoc();
    });
    document.getElementById('delete-doc')?.addEventListener('click', async () => {
        await deleteDoc();
    });
    document.getElementById('rename-section')?.addEventListener('click', async () => {
        await renameSection();
    });
}

export async function initMovie(){
    setupEventListeners();

    let pathname: string;
    [ urlOrigin, pathname, urlParams, urlBase ] = parseURL();
    if (pathname.includes("diagram")) {
        urlBase = "../movie";
    }
    msg(`params:${JSON.stringify(urlParams) }`);

    await fetchAllData();

    document.body.style.color = fgColor;
    document.body.style.backgroundColor = bgColor;

    let voice_lang = getCookie("VoiceLanguage");
    let text_lang  = getCookie("TextLanguage");

    if(voice_lang == undefined || text_lang == undefined){
        const code_pair = langCodeList.find(x => x[1] == navigator.language);
        if(code_pair != undefined){
            if(voice_lang == undefined){
                voice_lang = code_pair[0];
            }

            if(text_lang == undefined){
                text_lang = code_pair[0];
            }
        }
    }

    if(voice_lang != undefined){
        setVoiceLanguageCode(voice_lang);
    }
    if(urlParams.get("lesson") != undefined || urlParams.get("mode") == "lesson"){

        setVoiceLanguageCode("jpn");
    }

    if(text_lang != undefined){
        setTextLanguageCode(text_lang);
    }

    msg(`lang voice:${voiceLanguageCode} text:${text_lang} nav:${navigator.language}`);

    await initI18n();

    const plane = new Plane();
    let root : Grid;

    const button_size = window.innerHeight / 16;

    playStopButton = $button({
        id : "play-stop-button",
        click : async (ev : MouseEvent)=>{
            if(getPlayMode() == PlayMode.stop){

                playStopButton.setImgUrl(`${urlBase}/../plane/images/pause.png`);

                switch(appMode){
                case AppMode.edit:
                case AppMode.play:
                    await playBack(PlayMode.normal);
                    playStopButton.setImgUrl(`${urlBase}/../plane/images/play.png`);
                    break;

                case AppMode.lessonPlay:
                case AppMode.lessonEdit:
                    await playLesson();
                    break;

                default:
                    throw new MyError();
                }
            }
            else{
                switch(appMode){
                case AppMode.edit:
                case AppMode.play:
                    stopPlay();
                    break;

                case AppMode.lessonPlay:
                case AppMode.lessonEdit:
                    stopPlay();
                    // await stopLesson();
                    break;

                default:
                    throw new MyError();
                }

                playStopButton.setImgUrl(`${urlBase}/../plane/images/play.png`);
            }
        },
        url    : `${urlBase}/../plane/images/play.png`,
        // position : "static",
        margin : "auto 5px",
        width  : `${button_size}px`,
        height : `${button_size}px`,
    });

    const play_buttons = $flex({
        children : [
            playStopButton
            ,
            $button({
                click : async (ev : MouseEvent)=>{
                    showLangDlg(true);
                },
                url    : `${urlBase}/../plane/images/volume.png`,
                margin : "auto 5px",
                width  : `${button_size}px`,
                height : `${button_size}px`,
            })
            ,
            $button({
                click : async (ev : MouseEvent)=>{
                    showLangDlg(false);
                },
                url    : `${urlBase}/../plane/images/subtitle.png`,
                margin : "auto 5px",
                width  : `${button_size}px`,
                height : `${button_size}px`,
            })
        ]
    });

    play_buttons.div.style.display = "flex";
    play_buttons.div.style.alignItems = "center";
    play_buttons.div.style.justifyContent = "center";


    switch(appMode){
    case AppMode.lessonPlay:
        initLesson();
        root = makeLessonPlayGrid(button_size);
        playStopButton.button.style.visibility = "hidden";
        break;
    
    case AppMode.lessonEdit:
        initLesson();
        root = makeLessonEditGrid(play_buttons, button_size);
        break;

    case AppMode.edit:
    case AppMode.play:
    default:
        root = makePlayEditGrid(plane, play_buttons, button_size);
        break;
    }

    const layerMovie = document.getElementById("layer-movie");
    Layout.initLayout(root, layerMovie || document.body);

    await initPlane(plane, root);
    
    await includeDialog(`${urlBase}/../firebase/dialog.html`);
    await includeDialog(`${urlBase}/dialog.html`);

    // await asyncInitSpeech();
    initSpeech();

    await initFirebase();

    initForMovie(readDoc);

    const size = getPhysicalSize();
    msg(`size:${size.width_cm.toFixed(1)} ${size.height_cm.toFixed(1)}`);
    msg(`navigator:${navigator.appVersion}`);

    initRelations();

    const doc_id = urlParams.get("id");
    if(doc_id != undefined){

        await getRootFolder();

        await readDoc(parseInt(doc_id));
    }

    const buttons = document.getElementsByClassName("lang_button") as HTMLCollectionOf<HTMLButtonElement>;
    for(const button of buttons){
        button.addEventListener("click", langButtonClicked);
    }

    if(appMode == AppMode.lessonPlay){
        await initLessonPlay();
    }
    else if(appMode != AppMode.lessonEdit){

        await makeDocsGraph();
    }
}

async function undo_redo_test(){
    const view = GlobalState.View__current!;

    for(let cnt = 1;;cnt++){
        for(const _ of range(cnt)){
            await view.undo();
            await sleep(10);
        }
        const stop = (view.shapes.length == 0);
        for(const _ of range(cnt)){
            await view.redo();
            await sleep(10);
        }

        if(stop){
            break;
        }
    }
}

export async function loadOperationsAndPlay(id:number, name: string, parent:number, data : any) {
    const view = GlobalState.View__current!;

    let operations : Operation[];
    if(isJson){
        operations = await loadOperationsJSON(data);
    }
    else{
        operations = await loadOperationsText(data);
    }

    const num_operations = operations.length;
    operations.forEach(x => view.addOperation(x));

    await playBack(PlayMode.fastForward);
    assert(num_operations == view.operations.length);

    // await undo_redo_test();
    const doc = {
        id,
        name,
        parent,
        operations : operations.map(x => x.toJson())
    };

    newDocs.push(doc);
}

export async function readDocJson(docs:any[], doc_id : number) {

    removeDiv();

    const view = GlobalState.View__current!;
    view.clearCanvas();

    const doc = docs.find(x => x.id == doc_id);
    assert(doc != undefined);

    msg(`read doc json:${doc.id} ${doc.name}`);

    await loadOperationsAndPlay(doc.id, doc.name, doc.parent != null ? doc.parent.id : NaN, doc);
}

export async function readDoc(doc_id : number) {
    if(isJson){
        await readDocJson(allData.docs, doc_id);
        return;
    }

    removeDiv();

    const view = GlobalState.View__current!;
    view.clearCanvas();
    // msg(`id:${id}`);
    theDoc = await getMyDoc(doc_id);
    if(theDoc != undefined){

        msg(`read doc:${theDoc.id} ${theDoc.name}`);
        const data = JSON.parse(theDoc.text);

        if(2 <= data.version){

            await loadOperationsAndPlay(theDoc.id, theDoc.name, theDoc.parent != null ? theDoc.parent.id : NaN, data);
        }
        else{

            loadData(data);
        }
    }
}

export async function updateGraphDoc(){
    if(theDoc == undefined){
        throw new MyError("doc is undefined.");
    }

    const text = getOperationsText();
    
    const data = JSON.parse(text);
    await loadOperationsAndPlay(theDoc.id, theDoc.name, theDoc.parent != null ? theDoc.parent.id : NaN, data);

    msg(`update Graph Doc ${theDoc.id}:${theDoc.name} \n${text}`);
    if(! window.confirm(`update doc?\n${theDoc.id}:${theDoc.name}`)){
        return;
    }

    await writeGraphDocDB(theDoc.id, theDoc.name, text);

    await uploadCanvasImg(theDoc.id, GlobalState.View__current!.canvas);
}

export function SignUp(){
    $dlg("sign-up").showModal();
}

export { playAllGraph };
