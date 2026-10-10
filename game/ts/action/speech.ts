import { msg, MyError, assert } from "@i18n";
import { registerAction } from "../widget/core";
import { Action, ActionAttr } from "./action";

let voiceLanguageCode : string = "jpn";// "eng";
let languageRegion : string;
let cancelSpeechFlag : boolean = false;
let onSpeak : ((text : string) => void) | undefined;
let currentVoice : SpeechSynthesisVoice;

const langCodeList : [string, string][] = [
    ["ara", "ar-EG"],
    ["chi", "zh-CN"],
    ["eng", "en-US"],
    ["fre", "fr-FR"],
    ["ger", "de-DE"],
    ["hin", "hi-IN"],
    ["ind", "id-ID"],
    ["jpn", "ja-JP"],
    ["kor", "ko-KR"],
    ["rus", "ru-RU"],
    ["spa", "es-ES"],
    ["por", "pt-PT"],
];


const voiceNamesDic : { [lang: string]: string[] } = {
    "ja-JP" : [
        "Microsoft Nanami Online (Natural) - Japanese (Japan)",
        "Google 日本語",
        "Microsoft Ayumi - Japanese (Japan)"
    ]
    ,
    "en-US" : [
        "Microsoft Ava Online (Natural) - English (United States)",
        "Google US English",
        "Microsoft Zira - English (United States)"
    ]
};


const langCodeMap = new Map<string, string>(langCodeList);

const voiceMap = new Map<string, SpeechSynthesisVoice[]>();

function setVoiceList(){
    const voices = Array.from(speechSynthesis.getVoices());
    if(voices.length == 0){
        msg("no voice");
        return;
    }

    for(const voice of voices){
        if(voice.lang == languageRegion){

            msg(`voice lang:[${voice.lang}] name:[${voice.name}]`);
        }

        let voice_lang = voice.lang.replaceAll("_", "-");
        const k = voice_lang.indexOf("-#");
        if(k != -1){
            voice_lang = voice_lang.substring(0, k);
            // msg(`lang:${voice.lang} => ${voice_lang}`);
        }

        if(voiceMap.get(voice_lang) == undefined){
            voiceMap.set(voice_lang, []);

            if(Array.from( langCodeMap.values() ).includes(voice_lang)){

                // msg(`voice lang:${voice_lang}`);
            }
        }

        voiceMap.get(voice_lang)!.push(voice);
    }

    const voice = getVoiceByLangCode(voiceLanguageCode);
    if(voice == undefined){
        throw new MyError();
    }

    currentVoice = voice;
}


function getVoiceByLangCode(lang_code : string) : SpeechSynthesisVoice | undefined {
    languageRegion = langCodeMap.get(lang_code)!;
    if(languageRegion == undefined){
        throw new MyError(`unknown lang code:${lang_code}`);
    }

    const voices = voiceMap.get(languageRegion);
    if(voices == undefined){
        msg(`no voice for ${languageRegion}`);
        return undefined;
    }

    const default_names = voiceNamesDic[languageRegion];
    if(default_names != undefined){
        for(const name of default_names){
            const voice = voices.find(x => x.name == name);
            if(voice != undefined){
                return voice;
            }
        }
    }

    const natural_voice = voices.find(x => x.name.indexOf("Online (Natural)") != -1);
    if(natural_voice != undefined){
        return natural_voice;
    }

    return voices[0];
}

export function initSpeech(){
    if ('speechSynthesis' in window) {
        msg("このブラウザは音声合成に対応しています。🎉");

    }
    else {
        msg("このブラウザは音声合成に対応していません。😭");
    }    

    speechSynthesis.onvoiceschanged = function(){
        msg("voices changed 1");
        setVoiceList();
    };

    speechSynthesis.addEventListener("voiceschanged", (ev:Event)=>{
        setVoiceList();
        msg("voices changed 2");
    })

}

export abstract class AbstractSpeech extends Action  {
    static one : AbstractSpeech;

    text!   : string;
    prevCharIndex = 0;
    speaking : boolean = false;

    abstract speak(text : string) : void;

    constructor(data : ActionAttr & { text : string }){
        super(data);
        this.text = data.text;
    }

    *exec() : Generator<any> {
        this.finished = false;

        this.speak(this.text);

        while(this.speaking){
            yield "speaking";
        }

        this.finished = true;
        return `speech end ${this.text}`;
    }

    onBoundary(ev: SpeechSynthesisEvent) : void {
        const text = this.text.substring(this.prevCharIndex, ev.charIndex).trim();
        if(ev.charIndex == 0){

            msg(`Speech start text:[${this.text}]`)
        }
        else{
    
            msg(`Speech bdr: idx:${ev.charIndex} name:${ev.name} type:${ev.type} text:[${text}]`);
        }

        this.prevCharIndex = ev.charIndex;
    }


    onEnd(ev: SpeechSynthesisEvent) : void {
        // msg(`Speech end: id:${this.id} idx:${ev.charIndex} name:${ev.name} type:${ev.type} text:[${this.text.substring(this.prevCharIndex)}]`);
        this.speaking = false;
    }
}

export class Speech extends AbstractSpeech {
    constructor(data : ActionAttr & { text : string }){ 
        super(data);
    }

    emulate(speech_id : number | undefined){
    }

    speak(text : string) : void {
        assert(currentVoice != undefined);

        cancelSpeechFlag = false;

        this.text = text.trim();
        if(this.text == ""){

            this.speaking = false;
            return;
        }

        this.speaking = true;

        if(onSpeak != undefined){
            onSpeak(this.text);
        }

/*        
        if(speech_id != undefined){
            const ok = await playAudio(this, speech_id);
            if(ok){
                return;
            }
        }
*/

        msg(`Speak [${this.text}] ${currentVoice.name}`);

        this.prevCharIndex = 0;
    
        const uttr = new SpeechSynthesisUtterance(this.text.replaceAll("○", "マル").replaceAll("×", "バツ"));

        uttr.addEventListener("end", this.onEnd.bind(this));
        uttr.addEventListener("boundary", this.onBoundary.bind(this));
        uttr.addEventListener("mark", this.onMark.bind(this));
        uttr.voice = currentVoice;
    
        //uttr.rate = 5.0;// parseFloat(speechRate.value);

        speechSynthesis.speak(uttr);
    }
    
    onMark(ev: SpeechSynthesisEvent) : void {
    }
}

registerAction(Speech.name, (obj) => new Speech(obj));


export class EmulationSpeech extends AbstractSpeech {
    speak(text : string) : void{
        let charIndex = 0;

        const id = setInterval(()=>{
            if(voiceLanguageCode == "jpn"){
                charIndex++;
            }
            else{

                charIndex = this.text.indexOf(" ", charIndex);
                if(charIndex == -1){
                    charIndex = this.text.length;
                }
                else{
                    charIndex++;
                }
            }

            const ev : any = {
                charIndex : charIndex,
            };

            this.onBoundary(ev as SpeechSynthesisEvent);

            if(this.text.length <= charIndex){
                this.onEnd(ev as SpeechSynthesisEvent);
                clearInterval(id);
            }
        }, 1);
    }
}
