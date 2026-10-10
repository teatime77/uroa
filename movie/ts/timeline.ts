import { msg, sleep, Speech, voiceLanguageCode } from "@i18n";
import { urlOrigin } from "./index";

let audio : HTMLAudioElement | undefined;

function getAudioPath(lang_code: string, speech_id : number) : string {
    return `${urlOrigin}/lib/i18n/audio/${lang_code}/${speech_id}.mp3`;
}

export async function playAudio(speech : Speech, speech_id : number){

    audio = document.createElement("audio");
    document.body.append(audio);
    
    let can_play_through = false;
    let audio_error = false;

    audio.addEventListener("error", (ev : ErrorEvent)=>{
        msg(`audio error:${ev.message}`);
        audio_error = true;
    });

    audio.addEventListener("canplaythrough", (ev:Event)=>{
        msg("can play");
        can_play_through = true;
    });

    audio.addEventListener("ended", (ev : Event)=>{
        msg("audio ended");

        const charIndex = speech.text.length;
        speech.onBoundary({ charIndex } as SpeechSynthesisEvent);
        speech.onEnd({} as SpeechSynthesisEvent);

        document.body.removeChild(audio!);
        audio = undefined;
    });

    const audio_path = getAudioPath(voiceLanguageCode, speech_id);
    msg(`${audio_path}`);
    audio.src = audio_path;

    while(! can_play_through){
        if(audio_error){
            return false;
        }
        await sleep(10);
    }

    audio.play();
    msg(`audio play:${speech_id}`);

    speech.speaking = true;

    return true;
}

export function stopAudio(){
    if(audio != undefined){
        audio.pause();

        document.body.removeChild(audio);
        audio = undefined;
    }
}
