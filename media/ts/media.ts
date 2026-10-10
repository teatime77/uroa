import { msg } from "@i18n";

var html2canvas : any;

let mediaRecorder : MediaRecorder;

function saveFile(audioUrl : string){
    const downloadLink = document.createElement('a');
    downloadLink.href = audioUrl;
    downloadLink.download = 'recorded_audio.wav';   // webm 
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}

export function recordAudio() {
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            const recorder = new MediaRecorder(stream);
            const chunks: Blob[] = [];

            recorder.ondataavailable = (event) => {
                chunks.push(event.data);
            };

            recorder.onerror = (error) => {
                console.error('Error occurred during recording:', error);
                // Handle the error, e.g., display an error message to the user
            };

            recorder.start(10000); // Record for 10 seconds

            setTimeout(() => {
                recorder.stop();
            }, 10000);

            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'audio/webm' });
                // Process the recorded blob, e.g., download or upload it
                const audioUrl = URL.createObjectURL(blob);
                saveFile(audioUrl);
            };
        })
        .catch(error => {
            console.error('Error accessing microphone:', error);
        });
}

export async function startAudioRecorder(){
    msg("media start");

    const audioElement = document.getElementById('audio');
    let audioChunks : BlobPart[] = [];
    
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = event => {
        msg("media data");
        audioChunks.push(event.data);
    };

    mediaRecorder.onstop = () => {
        msg("media stopped");
        // const audioBlob = new Blob(audioChunks, { type: 'audio/ogg' }); //'audio/webm' 'audio/wav'
        const audioBlob = new Blob(audioChunks, { type: "audio/ogg; codecs=opus" });        
        const audioUrl = URL.createObjectURL(audioBlob);

        let audioElement = document.getElementById("audio") as HTMLAudioElement;
        audioElement.src = audioUrl;

        // Save the audio file
        saveFile(audioUrl);
    };

    mediaRecorder.start();    
}

export function stopAudioRecorder(){
    msg("media stop");
    mediaRecorder.stop();
}
    


/*
let audioRecorder : MediaRecorder | null = null;

abstract class Media {
    stream! : MediaStream;
    recorder : MediaRecorder | null = null;
    recordedChunks : Blob[] = [];
    blobType : string = "video/webm";
    fileExtension : string = "webm";

    setEventListener(){
        if(this.recorder == null){
            throw new MyError();
        }

        this.recorder.addEventListener("dataavailable", (ev:BlobEvent)=>{
            msg(`${this.constructor.name}: data available:${ev.data.size}`);
            if (ev.data.size > 0) {
                this.recordedChunks.push(ev.data);
            } 
        });
    
        this.recorder.addEventListener("stop", (ev:Event)=>{
            msg(`${this.constructor.name}: stopped`);
            this.download();
        });
    }

    async startRecord(){
        if(this.recorder == null){
            throw new MyError();
        }

        this.setEventListener();
        this.recordedChunks = [];
        this.recorder.start();
    }

    stopRecord(){
        msg(`${this.constructor.name}: stop record`);
        if(this.recorder != null){
    
            this.recorder.stop();
            // download();
    
            this.recorder = null;
        }
    }    

    download() {
        const blob = new Blob(this.recordedChunks, {
            type: this.blobType,
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        document.body.appendChild(a);
        a.style.display = "none";
        a.href = url;
        a.download = `test.${this.fileExtension}`;
        a.click();
        window.URL.revokeObjectURL(url);
    }
    
}

class CanvasMedia extends Media {
    canvas : HTMLCanvasElement;

    constructor(canvas : HTMLCanvasElement){
        super();
        this.canvas = canvas;
    }

    async startRecord(){


        this.setEventListener();
    }
}

class AudioMedia extends Media {
    constructor(){
        super();
    }

    async startRecord(){    
        this.recorder = new MediaRecorder(this.stream);
    
        this.setEventListener();
    }
}

class MixedMedia extends Media {
    constructor(stream : MediaStream){
        super();
        this.stream = stream;

        const options = { mimeType: "video/webm; codecs=vp9" };
        this.recorder = new MediaRecorder(stream, options);
    }
}

let mixedMedia : MixedMedia;

async function enumDevices(){
    const media_devices = navigator.mediaDevices;

    const devices = await media_devices.enumerateDevices();
    for(const device of devices){
        msg(`device id:[${device.deviceId}] group:[${device.groupId}] kind:[${device.kind}] label:[${device.label}]`);
    }

}

export async function startRecord(canvas : HTMLCanvasElement){
    await enumDevices();

    const constraints = { audio: true };
    const audio_stream = await navigator.mediaDevices.getUserMedia(constraints);

    const canvas_stream = canvas.captureStream(25);

    var mixedStream = new MediaStream();
    [audio_stream, canvas_stream].forEach((stream)=>{
        stream.getTracks().forEach((track)=> mixedStream.addTrack(track) );
    });

    mixedMedia = new MixedMedia(mixedStream);
    await mixedMedia.startRecord();
}

export function stopRecord(){
    mixedMedia.stopRecord();
}

    // canvasMedia = new CanvasMedia(canvas);
    // audioMedia  = new AudioMedia();
    // canvasMedia.startRecord();
    // audioMedia.startRecord();


export async function drawDivToCanvas(div : HTMLDivElement, canvas : HTMLCanvasElement){
    await html2canvas(div, {
        canvas : $("record-canvas")
    });

}
*/

/*
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.0.0-rc.5/dist/html2canvas.min.js"></script>

<script type="text/javascript" src="lib/media/media.js?ver=250"></script>


const record_button = $button({
    text : "record",
    click : async (ev:MouseEvent)=>{
        // media_ts.record($div("canvas-narration"));
    }
});


function play(){
    const canvas = $("main-canvas") as HTMLCanvasElement;   // "record-canvas"
    media_ts.startRecord(canvas);

    media_ts.drawDivToCanvas($div("canvas-narration"), canvas);


    media_ts.stopRecord();

}
*/
