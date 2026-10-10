import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

import { msg, MyError } from "@i18n";
// import firebase from "./@types/firebase";
import { refId, urlOrigin, urlBase, app } from "./firebase";
import { generateRandomString } from "./firebase_util";

declare const firebase: any;

export function initStorage(){
    const storage = getStorage(app);
    msg(`storage:${storage}`);
}

function getThumbnailPath(doc_id : number) : string {
    return `users/${refId}/images/${doc_id}/thumbnail.png`;
}

export async function uploadCanvasImg(doc_id : number, canvas : HTMLCanvasElement) {
    // Get canvas data as a Blob
    const dataURL = canvas.toDataURL('image/png'); 
    const res  = await fetch(dataURL);
    const blob = await res.blob();

    try{
        // Create a root reference
        var storageRef = getStorage(app);

        // Create a reference to 'images/mountains.jpg'
        const path = getThumbnailPath(doc_id);
        // storageRef.child(path);
        var img_ref = ref(storageRef, path);

        // img_ref.put(blob);
        const snap = await uploadBytes(img_ref, blob);
        msg(`upload canvas img OK: path:${path}`);

        return path;
    }
    catch(e){
        throw new MyError(`upload canvas img err:${e}`);
    }
}

export async function uploadImgFile(file : File) {
    const k = file.type.indexOf("/");
    const ext = file.type.substring(k + 1);
    msg(`upload File name: ${file.name}, File size: ${file.size}, File type: ${file.type} ext:${ext}`);

    try{
        // Create a root reference
        var storageRef = getStorage(app);

        const id = generateRandomString(10);
        const file_name = `${id}.${ext}`;

        // Create a reference to 'images/mountains.jpg'
        const path = `users/${refId}/images/${file_name}`;
        var img_ref = ref(storageRef, path);

        const snap = await uploadBytes(img_ref, file);
        msg(`upload OK: ${file.name}:${file_name} path:${path}`);

        return path;
    }
    catch(e){
        throw new MyError(`upload img err:${e}`);
    }
}

export async function getStorageDownloadURL(path : string){   
    let url : string;
    try{
        const file_ref = ref(getStorage(app), path);
        url = await getDownloadURL(file_ref);
        if(typeof url == "string"){
            msg(`storage url:[${url}]`);
            return url;
        }
    }
    catch(e){
        throw new MyError(`get storage download URL error:${e}`);
    }


    throw new MyError();
}

export async function getThumbnailDownloadURL(doc_id : number) : Promise<string> {
    const path = getThumbnailPath(doc_id);
    try{

        const url = await getStorageDownloadURL(path);
        return url;
    }
    catch(e){
        msg(`no thumbnail:${path} ${e}`);
        return `${urlBase}/../plane/images/blank.png`;
    }
}

