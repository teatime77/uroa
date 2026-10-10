///<reference path="movie_util.ts" />

import { Speech, assert, AppMode, getPlayMode, PlayMode, msg, TT, MyError, $div, setPlayMode, appMode, $dlg, cancelSpeech } from "@i18n";
import { $img, $textbox, $input_range, $textarea, ImgDiv, Img, TextBox, $grid, Flex, $label, $flex, $button, Grid, UI, $imgdiv } from "@layout";
import { parseObject, Widget } from "@plane";
import { urlOrigin, urlBase, theDoc, playStopButton, urlParams, setDoc } from "./index";
import { getMyDoc, getRootFolder, getStorageDownloadURL, showContents, uploadImgFile } from "@uroa-firebase";

let root : Grid;
let thumbnails : Grid;
let thumbnails_content : Grid;
let slide_ui : Grid;
let quiz_ui : Grid;
let theLesson : Lesson;
let current : Slide | Quiz | undefined;
let speech : Speech;

let slide_play_ui : Grid;

async function sliderChanged(ev : Event){
    assert(appMode == AppMode.lessonPlay);

    const idx = Slide.ui.input_range.getValue();
    assert(idx == Math.floor(idx));

    if(theLesson != undefined && 0 <= idx && idx < theLesson.materials.length){
        const material = theLesson.materials[idx];
        if(material instanceof Slide){

            Slide.ui.img.setImgUrl(material.downloadURL);
        }
    }
}

class Slide extends Widget {
    static ui = { 
        img : $img({ imgUrl : ""}),
        textbox : $textbox({
            text : "ダウンロードが始まるまで<br/>お待ちください・・・",
            fontSize : "xxx-large",
            textAlign : "center",
        }),
        input_range : $input_range({
            value : 0,
            step : 1,
            min : 0,
            max : 20,
            change : sliderChanged
        }),
        explanation : $textarea({
            id : "slide-text",
        }),
    };

    imgPath : string = "";
    explanation : string = "";
    downloadURL : string = "";

    constructor(data : { imgPath? : string, explanation? : string }){
        super(data);
        if(data.imgPath != undefined){

            this.imgPath = data.imgPath;
        }

        if(data.explanation != undefined){

            this.explanation = data.explanation;
        }
    }

    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            imgPath     : this.imgPath,
            explanation : this.explanation
        });

        return obj;
    }

    async getDownloadURL(){
        let url = this.imgPath;
        if(url.startsWith("users/")){
            
            url = await getStorageDownloadURL(url);
        }

        return url;
    }

    async addThumbnail(file? : File){
        this.downloadURL = await this.getDownloadURL();

        const img = $img({
            imgUrl : this.downloadURL,
            file   : file,
            width : "100px",
            height : "100px",
            click : async (ev : MouseEvent)=>{
                updateDataByUI();
                current = this;
                this.show();
            }
        });
    
        thumbnails.addChild(img);    
    }

    show(){
        setEditUI(slide_ui);

        (slide_ui.$("slide-img") as ImgDiv).setImgUrl(this.downloadURL);
        Slide.ui.explanation.setValue(this.explanation);

        root.updateRootLayout();
    }

    async play(speech : Speech, img : Img, textbox : TextBox){
        img.setImgUrl(this.downloadURL);
        textbox.setText("");
        root.updateRootLayout();


        const lines = this.explanation.split("\n").map(x => x.trim()).filter(x => x != "");
        for(const line of lines){
            if(getPlayMode() == PlayMode.stop){
                msg("break lines by flag");
                break;
            }
    
            textbox.setText(TT(line));
            await speech.speak_waitEnd(TT(line));
        }
    }
}

class Quiz extends Widget {
    static ui = {
        question : $textarea({
            cols : 80,
            rows : 5,
        })
        ,
        choices : $textarea({
            cols : 80,
            rows : 5,
            placeholder : 
`1st choice. This choice should be the correct answer.
            
2nd choice. Each choice must be separated by a blank line.

3rd choice. There is no limit to the number of choices.`
        })
        ,
        commentary : $textarea({
            cols : 80,
            rows : 5,
        })

    };

    question : string;
    choices : string[];
    commentary : string;

    constructor( data : { question : string, choices : string[], commentary : string }){
        super(data);
        this.question   = data.question;
        this.choices    = data.choices;
        this.commentary = data.commentary;
    }

    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            question   : this.question,
            choices    : this.choices,
            commentary : this.commentary
        });

        return obj;
    }

    async addThumbnail(){
        const img = $img({
            imgUrl : `${urlOrigin}/lib/movie/img/quiz.png`,
            width : "100px",
            height : "100px",
            click : async (ev : MouseEvent)=>{
                updateDataByUI();
                current = this;
                this.show();
            }
        });
    
        thumbnails.addChild(img);    
    }

    show(){
        setEditUI(quiz_ui)

        Quiz.ui.question.setValue(this.question);
        Quiz.ui.choices.setValue(this.commentary);
        Quiz.ui.commentary.setValue(this.commentary);

        root.updateRootLayout();
    }

    async play(speech : Speech){
    }
}

class Lesson extends Widget {
    materials : (Slide | Quiz)[] = [];

    constructor(data : { materials : (Slide | Quiz)[] }){
        super(data);

        this.materials = data.materials;
    }

    makeObj() : any {
        let obj = Object.assign(super.makeObj(), {
            materials : this.materials.map(x => x.makeObj())
        });

        return obj;
    }

    show(){
        this.materials.forEach(x => x.show());
    }
}

function getTextsFromNewlineDelimitedString(str : string) : string[] {
    const texts : string[] = [];

    let lines = str.replaceAll("\r\n", "\n").split("\n");
    lines = lines.map(x => x.trim());

    let text = "";
    for(const line of lines){
        if(line == ""){
            if(text != ""){
                texts.push(text);
                text = "";
            }

            continue;
        }

        if(text == ""){
            text = line;
        }
        else{
            text += "\n" + line;
        }
    }

    if(text != ""){
        texts.push(text);
    }

    return texts;
}

function updateDataByUI(){
    if(current instanceof Slide){
        current.explanation = Slide.ui.explanation.getValue();
    }
    else if(current instanceof Quiz){
        current.question   = Quiz.ui.question.getValue();
        current.choices   = getTextsFromNewlineDelimitedString( Quiz.ui.choices.getValue() );
        current.commentary = Quiz.ui.commentary.getValue();
    }
}

function setEditUI(ui : UI){
    assert(thumbnails_content.children.length == 2);

    thumbnails_content.popChild();
    thumbnails_content.addChild(ui);
}

async function speakSlide() {
    const text = Slide.ui.explanation.getValue();
    speech = new Speech();
    for(const line of text.split("\n")){
        if(line.trim() == ""){
            continue;
        }
        await speech.speak(line.trim());
        await speech.waitEnd();
    }
}

async function addSlide(){
    updateDataByUI();

    current = new Slide({});
    theLesson.materials.push( current );

    setEditUI(slide_ui);

    (slide_ui.$("slide-img") as ImgDiv).clearImg();
    Slide.ui.explanation.setValue(current.explanation);

    root.updateRootLayout();
}

async function addQuiz(){
    updateDataByUI();

    setEditUI(quiz_ui)

    Quiz.ui.question.setValue("");
    Quiz.ui.choices.setValue("");
    Quiz.ui.commentary.setValue("");

    current = new Quiz({
        question : "",
        choices : [],
        commentary : ""
    });

    theLesson.materials.push(current);

    await current.addThumbnail();

    root.updateRootLayout();
}

async function newLesson() {
    updateDataByUI();

    const data = theLesson.makeObj();
    const doc_text = JSON.stringify(data, null, 4);

    showContents(undefined, doc_text);
}

async function updateLesson() {
    updateDataByUI();

    if(theDoc == undefined){
        alert("no document");
        return;
    }

    const data = theLesson.makeObj();
    theDoc.text = JSON.stringify(data, null, 4);
    await theDoc.updateDocDB();
}

async function onFileDrop(file : File){
    const path = await uploadImgFile(file);

    if(current instanceof Slide){
        current.imgPath = path;
        await current.addThumbnail(file);
    }
    else{
        throw new MyError();
    }

    root.updateRootLayout();

    return path;
}


export function makeLessonPlayGrid(button_size : number) : Grid {

    root = $grid({
        rows : `70% 30% ${button_size}px`,
        columns : "100%",
        children : [
            Slide.ui.img,
            Slide.ui.textbox,
            $grid({
                columns : `${button_size}px 100%`,
                children : [
                    playStopButton
                    ,
                    Slide.ui.input_range
                ]
            })

        ]
    })

    return root;
}


export function makeLessonEditGrid(play_buttons : Flex, button_size : number) : Grid {
    slide_play_ui = $grid({
        rows : "70% 30%",
        children : [
            Slide.ui.img,
            Slide.ui.textbox
        ]
    });

    thumbnails =$grid({
        columns : "80px 80px 80px",
        children : [
        ]
    });

    slide_ui = $grid({
        id : "slide-ui",
        rows : "50% 50%",
        children : [
            $imgdiv({
                id : "slide-img",
                backgroundColor : "cornsilk",
                uploadImgFile : onFileDrop
            })       
            ,
            Slide.ui.explanation
        ]
    });

    quiz_ui = $grid({
        id : "quiz-ui",
        columns : "100px 100%",
        rows    : "300px 100% 300px",
        children : [
            $label({ text : "question"})
            ,
            Quiz.ui.question
            ,
            $label({ text : "choices"})
            ,
            Quiz.ui.choices
            ,
            $label({ text : "explanation"})
            ,
            Quiz.ui.commentary
        ]
    })

    thumbnails_content = $grid({
        id : "thumbnails-content",
        columns : "240px 100%",
        children : [
            thumbnails,
            $label({
                text : "",
                width : "300px",
                height : "300px",
                backgroundColor : "cyan",
            })
        ]
    })
    
    root = $grid({
        id : "lesson-root",
        rows : `auto 100% ${button_size}px`,
        columns : "100%",
        children : [        
            $flex({
                children : [
                    $button({
                        text : "speak",
                        fontSize : "large",
                        click : speakSlide
                    })
                    ,
                    $button({
                        text : "add slide",
                        fontSize : "large",
                        click : addSlide
                    })
                    ,
                    $button({
                        text : "add quiz",
                        fontSize : "large",
                        click : addQuiz
                    })
                    ,
                    $button({
                        text : "update doc",
                        fontSize : "large",
                        click : updateLesson
                    })
                    ,
                    $button({
                        text : "new document",
                        fontSize : "large",
                        click : newLesson
                    })
                ]
            })
            ,
            thumbnails_content            
            ,
            play_buttons
        ]
    });

    return root;
}

function parseLessonObject(obj : any) : any {
    switch(obj.typeName){
    case Slide.name:
        return new Slide(obj);

        case Quiz.name:
        return new Quiz(obj);

        case Lesson.name:
            return new Lesson(obj);

        default:
            throw new MyError();
    }
}


export async function readLesson(id : number) {
    // msg(`id:${id}`);
    const doc = await getMyDoc(id);
    setDoc(doc)

    if(theDoc != undefined){

        // msg(`read doc:${theDoc.id} ${theDoc.name}`)
        const obj = JSON.parse(theDoc.text);

        const lesson = parseObject(obj, parseLessonObject);
        if(lesson instanceof Lesson){

            msg("lesson loaded");
            theLesson = lesson;

            if(thumbnails != undefined){
                thumbnails.clear();
            }

            Slide.ui.input_range.setMax(theLesson.materials.length - 1);

            $dlg("progress-dialog").show();
            for(const [idx, material] of theLesson.materials.entries()){
                const progress = 100 * idx / theLesson.materials.length;
                $div("progress-bar-fill").style.width = `${progress}%`;

                if(appMode == AppMode.lessonEdit){
                    await material.addThumbnail();
                }
                else{
                    if(material instanceof Slide){
                        material.downloadURL = await material.getDownloadURL();
                    }
                }
            }
            $dlg("progress-dialog").close();
        }
        else{
            throw new MyError();
        }

        if(theLesson.materials.length != 0){
            const material = theLesson.materials[0];
            if(material instanceof Slide){
                Slide.ui.img.setImgUrl(material.downloadURL);
                Slide.ui.textbox.setText("");
            }
        }

        playStopButton.button.style.visibility = "visible";

        root.updateRootLayout();
    }
}

export async function playLesson(){
    msg("play lesson start");

    setPlayMode(PlayMode.normal);

    speech = new Speech();

    let start_idx = 0;
    if(appMode == AppMode.lessonEdit){

        if(current != undefined){
            start_idx = theLesson.materials.indexOf(current);
            assert(start_idx != -1);

            current = undefined;
        }
    }
    else{
        start_idx = Slide.ui.input_range.getValue();
        assert(start_idx == Math.floor(start_idx) && 0 <= start_idx && start_idx < theLesson.materials.length);
    }

    for(const [idx, material] of theLesson.materials.entries()){
        if(idx < start_idx){
            continue;
        }
        if(getPlayMode() == PlayMode.stop){
            msg("stop by flag");
            break;
        }
        Slide.ui.input_range.setValue(idx);

        if(material instanceof Slide){

            if(appMode == AppMode.lessonEdit){
                setEditUI(slide_play_ui);
            }

            await material.play(speech, Slide.ui.img, Slide.ui.textbox);
        }
        else if(material instanceof Quiz){

        }
    }

    setPlayMode(PlayMode.stop);
    playStopButton.setImgUrl(`${urlBase}/../plane/images/play.png`);
    msg("play lesson completes");
}

export async function stopLesson(){
    cancelSpeech();
}

export async function initLessonPlay(){
    const root_folder = await getRootFolder();
    let doc_id : number;

    const lessonId = urlParams.get("lesson");
    switch(lessonId){
    case "genki-navi-1": doc_id = 3; break;
    case "genki-navi-2": doc_id = 4; break;
    default: return;
    }

    await readLesson(doc_id);
}

export function initLesson(){
    theLesson = new Lesson({
        materials : []
    });
}
