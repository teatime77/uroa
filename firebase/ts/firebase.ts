// https://github.com/firebase/firebase-js-sdk をクローン

// パッケージ名を直接指定する（これが標準的な方法）

import { FirebaseApp, initializeApp } from 'firebase/app';
import { getFirestore, Firestore, writeBatch, doc, getDoc, setDoc, DocumentReference, DocumentData } from 'firebase/firestore';
import { getAuth, User, createUserWithEmailAndPassword, Auth, signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";

import firebase from 'firebase/compat/app';

import { MyError, msg, $dlg, $inp, sleep, parseURL, appMode, AppMode } from "@i18n";
// import firebase from "./@types/firebase";
import { DbFolder, makeContents, DbDoc, inputDocName, makeDoc } from "./contents";
import { setEvent } from "./firebase_event";
import { generateRandomString } from "./firebase_util";
import { initStorage } from "./storage";

// firebase-js-sdk/packages/firebase/index.d.ts を firebase.d.tsにリネームする。
let db: Firestore;
let auth : Auth;

// let app  : firebase.app.App;
export let app: FirebaseApp;

export let user : User | null = null;
export const defaultRefId = "KDxW7CoFYGYpmlON"; // "ZsPosM7CtPqEYgWz" "rts6BilvSSyWqLwD"; // "aNv8XFLZddFpYNoB";
export let refId : string | undefined = defaultRefId;
export let urlOrigin : string;
export let urlBase   : string;
export let rootFolder : DbFolder | null;
export let readDocFnc : (id : number) => Promise<void>;

let default_user_id = "1";

export function setRootFolder(root_folder : DbFolder){
    rootFolder = root_folder;
}

export async function makeRootFolder(){
    let obj = await fetchDB("index");
    if(obj == undefined){

        if(window.confirm("No index data.\nDo you want to initialize index data?")){

            const initial_data = {
                version : 1.0,
                root : {
                    id   : 0,
                    name : "root",
                    children : [],
                    parent : -1
                }
            };
        
            await writeDB("index", initial_data);

            obj = await fetchDB("index");
            if(obj == undefined){
                throw new MyError("no index in DB");
            }
        }

        throw new MyError("no index in DB");
    }

    const root_folder = makeContents(null, obj.root) as DbFolder;
    if(!(root_folder instanceof DbFolder)){
        throw new MyError();
    }

    // msg(`fetch index: ver.${obj.version}  ${JSON.stringify(root_folder.makeIndex(), null, "\t")}`);

    rootFolder = root_folder;
}

async function setUser(user_arg : User | null){
    if(user_arg == null){
        throw new MyError();
    }

    user = user_arg;

    msg(`sign in: ${user.email} uid:[${user.uid}]`);
}

export function SignUpOk(){
    const email = $inp("sign-up-e-mail").value.trim();
    const password = $inp("sign-up-password").value.trim();

    msg(`email:${email} password:${password}`)

    createUserWithEmailAndPassword(auth, email, password)
    .then((userCredential:any) => {
        // Signed in 
        setUser(userCredential.user);
        $dlg('sign-up').close();
    })
    .catch((error:any) => {
        msg(`sign up err:${error.code} ${error.message}`);
        $dlg('sign-up').close();
    });
}

export function SignInOk(){
    const email    = $inp("sign-in-e-mail").value.trim();
    const password = $inp("sign-in-password").value.trim();

    msg(`email:${email} password:${password}`)

    signInWithEmailAndPassword(auth, email, password)
    .then((userCredential:any) => {
        // Signed in
        setUser(userCredential.user);
        $dlg('sign-in').close();
    })
    .catch((error:any) => {
        msg(`sign in err:${error.code} ${error.message}`);
        $dlg('sign-in').close();
    });    
}


export function resetPassword() {
    const email   = $inp("sign-in-e-mail").value.trim();
    sendPasswordResetEmail(auth, email)
    .then(() => {
        msg("Password reset email sent!")
    })
    .catch((error:any) => {
        msg(`reset password err:${error.code} ${error.message}`);
        $dlg('sign-in').close();
    });
}

export function SignUp(){
    $dlg("sign-up").showModal();
}

export function SignIn(){
    $dlg("sign-in").showModal();
}

export async function SignOut(){
    msg(`auth:${auth}`);
    await auth.signOut();
    msg("sign out done");
}

export async function initFirebase() {
    [ urlOrigin, , , urlBase] = parseURL();

    setEvent();

    // Your web app's Firebase configuration
    // For Firebase JS SDK v7.20.0 and later, measurementId is optional
    const firebaseConfig = {
        apiKey: "AIzaSyA8nwVjTKGsSoIrgbcFYfYHqTpaQO_rxX0",
        authDomain: "uroadb.firebaseapp.com",
        projectId: "uroadb",
        storageBucket: "uroadb.firebasestorage.app",
        messagingSenderId: "930380386712",
        appId: "1:930380386712:web:a8b3b5e6a9236c80095bed",
        measurementId: "G-0ZXZKCWJ2Z"
    };

    app = initializeApp(firebaseConfig);
    auth = getAuth();

    db = getFirestore(app);

    console.log(app);

    let db_is_ready = false;
    getAuth().onAuthStateChanged((user_arg : User | null) => {
        if(user_arg != null){
            setUser(user_arg);
        }
        else{
            msg("not log in");
        }

        db_is_ready = true;
    });

    while(! db_is_ready){
        await sleep(10);
    }

    if(user != null){

        let data = await getUserData();
        if(data == undefined){
            if(window.confirm("No user data.\nDo you want to initialize user data?")){

                const user_data = {
                    refId : generateRandomString(16)
                };

                await setUserData(user_data);

                data = await getUserData();
                if(data == undefined){
                    throw new MyError("can not initialize user data");
                }
            }
            else{
                return;
            }

        }

        if(typeof data.refId == "string"){
            refId = data.refId;
            msg(`ref Id:[${refId}]`);
        }
        else{

            throw new MyError("no ref Id");
        }
    }

    initStorage();
}

export function initForMovie(fnc : (id : number) => Promise<void>){
    readDocFnc = fnc;


    if(appMode == AppMode.lessonPlay){
        refId = "wutfxujVE0GGD5YW";
        msg(`set ref-ID:[${refId}]`);
    }
}

export function getDocRef(id : string, ref_id = refId){
    if(ref_id == undefined){
        throw new MyError();
    }

    return doc(db, 'public', ref_id, 'docs', id);
    // return db.collection('public').doc(ref_id).collection('docs').doc(id);
}


export async function writeDB(id: string, doc_obj: any){
    if(user == null || refId == undefined){
        throw new MyError();
    }

    try{
        // msg(`text:${doc_obj.text}`);
        const doc_ref = getDocRef(id);
        await setDoc(doc_ref, doc_obj);
        msg(`write DB :id:${doc_obj.id} name:${doc_obj.name}`);
    }
    catch(e){
        msg(`write DB error: ${user.email} ref:${refId} ${e}`);
    }
}


export async function setUserData(user_data: any){
    if(user == null){
        throw new MyError();
    }

    try{
        // db.collection('users').doc(user.uid).set(user_data);
        const doc_ref = doc(db, 'users', user.uid);
        await setDoc(doc_ref, user_data);
        msg(`set user data : ${JSON.stringify(user_data, null, 4)}`);
    }
    catch(e){
        msg(`set user data error: ${user.email} [${user.uid}] [${user_data}] ${e}`);
    }
}


export async function getUserData() {
    if(user == null){

        throw new MyError();        
    }

    try{
        // db.collection('users').doc(user.uid).get()
        let user_data = await getDoc(doc(db, 'users', user.uid));
        if(user_data.exists()){

            const data = user_data.data();
            msg(`get user data OK:${JSON.stringify(data, null, 4)}`);
            return data;
        }
        else{

            msg(`no user data: ${user.email} [${user.uid}]`);

            return undefined;
        }
    }
    catch(e){
        msg(`get user data error: ${user.email} [${user.uid}] ${e}`);

        throw new MyError();        
    }
}


export async function fetchDB(id: string, ref_id = refId) {
    try{
        // getDocRef(id, ref_id).get();
        let doc_data = await getDoc( getDocRef(id, ref_id) );
        if(doc_data.exists()){
            const data = doc_data.data();
            // msg(`read DB OK:${data}`);
            return data;
        }
        else{

            msg(`no data:${id}`);
            return undefined;
        }
    }
    catch(e){
        if(user != null){
            msg(`read DB error: ${user.email} [${user.uid}] ${e}`);
        }
        else{
            msg(`read DB error: ${e}`);
        }

        throw new MyError();        
    }
}

export async function getMyDoc(id : number, ref_id = refId){
    const json = await fetchDB(`${id}`, ref_id);
    if(json == undefined){
        msg(`no doc:${id}`);
        return undefined;
    }
    else{
        if(rootFolder == null){
            return undefined;
        }
        const doc = rootFolder.findDoc(id);
        if(doc == undefined){
            return new DbDoc(null, json.id, json.name, json.text);
        }

        doc.text = json.text;
        return doc;
    }
}

export function batchWrite(doc : DbDoc, doc_obj: any) : Promise<DbDoc> {
    return new Promise((resolve) => {
        if(user == null || refId == undefined){
            throw new MyError("not log in");
        }
        else if(rootFolder == null){
            throw new MyError("no root folder");
        }
        else{

            try{
                    // db.batch()
                    let batch = writeBatch(db);


                    // FirebaseError: Function WriteBatch.set() called with invalid data. Data must be an object, but it was: a custom object
                    //  https://stackoverflow.com/questions/48156234/function-documentreference-set-called-with-invalid-data-unsupported-field-val
                    let docRef = getDocRef(`${doc.id}`);
                    batch.set(docRef, doc_obj);


                    const index_obj = {
                        version : 1.0,
                        root : rootFolder.makeIndex()
                    };
                    let idxRef = getDocRef("index");
                    batch.set(idxRef, index_obj);

                    batch.commit().then(function () {
                        msg(`text:${doc_obj.text}`);
                        msg(`write DB :id:${doc_obj.id} name:${doc_obj.name}`);
                        resolve(doc);
                    });
            }
            catch(e){
                throw new MyError(`${e}`);
            }        
        }            

    });
}

export async function updateIndex() {
    if(user == null || rootFolder == null || refId == undefined){
        throw new MyError();
    }

    const index_obj = {
        version : 1.0,
        root : rootFolder.makeIndex()
    };

    try{
        // getDocRef("index").set(index_obj);
        await setDoc(getDocRef("index"), index_obj);
        msg(`update index [${JSON.stringify(index_obj, null, 4)}]`);
    }
    catch(e){
        msg(`update index error: ${user.email} ref:${refId} ${e}`);
    }
    
}

export async function putDoc(parent : DbFolder, text : string) : Promise<DbDoc | undefined> {
    const name = inputDocName("");
    if(name == ""){
        return undefined;
    }

    const doc = makeDoc(parent, name, text);
    let doc_obj = doc.makeObj();

    await batchWrite(doc, doc_obj);
    return doc;
}

export function getDB() : Firestore {
    return db;
}

export function getUser() : User | null {
    return user;
}

export async function getDbData(doc_ref : DocumentReference<DocumentData, DocumentData>){
    const doc_data = await getDoc(doc_ref);
    if(doc_data.exists()){
        const data = doc_data.data();
        if(data != undefined){
            return data;
        }
    }

    throw new MyError();
}
