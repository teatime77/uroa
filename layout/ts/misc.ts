import { msg } from "@i18n";
import { setImgFile } from "./layout_util";
import { UI, modalDlg } from "./main";
import type { Attr } from "./main";

export class ImgDiv extends UI {
    div : HTMLDivElement;
    img : HTMLImageElement;
    uploadImgFile : (file : File)=>Promise<string>;
    imgUrl : string = "";

    constructor(data : Attr & { uploadImgFile : (file : File)=>Promise<string> }){
        super(data);
        this.uploadImgFile = data.uploadImgFile;

        this.div = document.createElement("div");
        this.div.style.display        = "flex";
        this.div.style.justifyContent = "center";
        this.div.style.alignItems     = "center";

        this.img = document.createElement("img");
        this.img.style.maxWidth  = "100%";
        this.img.style.maxHeight = "100%";

        this.div.append(this.img);

        this.div.addEventListener("dragenter", (ev : DragEvent)=>{
            preventDefaults(ev);
            msg("drag enter");
        });
    
        this.div.addEventListener("dragover", (ev : DragEvent)=>{
            preventDefaults(ev);
            this.div.classList.add('dragover')
    
            msg("drag over");
        });
    
        this.div.addEventListener("dragleave", (ev : DragEvent)=>{
            preventDefaults(ev);
            this.div.classList.remove('dragover');
            msg("drag leave");
        });
    
        this.div.addEventListener("drop", async (ev : DragEvent)=>{
            preventDefaults(ev);
            this.div.classList.remove('dragover');
    
            msg("drop");
            const dt = ev.dataTransfer;
            if(dt == null){
                return;
            }
    
            const files = Array.from(dt.files);
    
            msg(`${files}`);
    
            if(files.length == 1){
                const file = files[0];

                if(file.type == "image/png" || file.type == "image/jpeg"){

                    setImgFile(this.img, file);
    
                    this.imgUrl = await this.uploadImgFile(file);
                }
                else{    
                    msg(`File name: ${file.name}, File size: ${file.size}, File type: ${file.type}`);
                }
            }
        });
    }

    html(): HTMLElement {
        return this.div;
    }

    setImgUrl(url : string){
        this.img.src = url;
        msg(`img url 5:${this.img.src}`);
        this.imgUrl  = url;
    }

    clearImg(){
        this.img.src = "";
        this.imgUrl  = "";
    }
}

function preventDefaults(ev:DragEvent) {
    ev.preventDefault(); 
    ev.stopPropagation();
}

export function closeDlg() : boolean {
    if(modalDlg.style.display != "none"){
        modalDlg.style.display = "none";
        modalDlg.innerHTML = "";
        return true;
    }

    return false;
}

export function $imgdiv(data : Attr & { uploadImgFile : (file : File)=>Promise<string> }) : ImgDiv {
    return new ImgDiv(data).setStyle() as ImgDiv;
}
