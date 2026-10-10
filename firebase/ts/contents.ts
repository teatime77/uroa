import { Firestore, WriteBatch, writeBatch, doc } from 'firebase/firestore';

import { $dlg, MyError, msg, remove, TT } from "@i18n";
import { $button, $popup, PopupMenu } from "@layout";
import { batchWrite, writeDB, getDB, user, refId, getUserData, setUserData, getDbData, updateIndex, putDoc, makeRootFolder, getDocRef, urlOrigin, rootFolder, setRootFolder } from "./firebase";
import { dateString } from "./firebase_util";
import { getDocObj } from "./graph/graph";

export abstract class DbItem {
    parent : DbFolder | null = null;
    id : number;
    name : string;

    constructor(parent : DbFolder | null, id : number, name : string){
        this.parent = parent;
        this.id   = id;
        this.name = name;
    }

    makeIndex() : any {
        return {
            parent : (this.parent == null ? -1 : this.parent.id),
            id : this.id,
            name : this.name
        };
    }

    getAll(items : DbItem[]){
        items.push(this);
    }
}

export class DbDoc extends DbItem {
    text : string;
    nameChanged : boolean = false;

    constructor(parent : DbFolder | null, id : number, name : string, text : string){
        super(parent, id, name);
        this.text = text;
    }

    makeObj() : any {
        let obj = Object.assign(super.makeIndex(), {
            text : this.text
        });

        return obj;
    }

    setName(name : string){
        if(this.name != name){
            this.name = name;
            this.nameChanged = true;
        }
    }

    async updateDocDB(){
        let doc_obj = this.makeObj();

        if(this.nameChanged){

            await batchWrite(this, doc_obj);
            this.nameChanged = false;
        }
        else{

            await writeDB(`${this.id}`, doc_obj);
        }
    }
}

export class DbFolder extends DbItem {
    children : DbItem[] = [];
    expanded : boolean = false;

    constructor(parent : DbFolder | null, id : number, name : string){
        super(parent, id, name);
    }

    copy(parent : DbFolder | null) : DbFolder {
        const folder_copy = new DbFolder(parent, this.id, this.name);

        for(const [idx, item] of this.children.entries()){
            let item_copy;

            if(item instanceof DbFolder){
                item_copy = item.copy(folder_copy);
            }
            else if(item instanceof DbDoc){
                item_copy = new DbDoc(folder_copy, item.id, item.name, item.text);
            }
            else{
                throw new MyError();
            }

            folder_copy.addItem(item_copy);
        }

        return folder_copy;
    }

    makeIndex() : any {
        let obj = Object.assign(super.makeIndex(), {
            children : this.children.map(x => x.makeIndex())
        });

        return obj;
    }

    addItem(item : DbItem){
        this.children.push(item);
        item.parent = this;
    }

    getAll(items : DbItem[]){
        super.getAll(items);
        this.children.forEach(x => x.getAll(items));
    }

    findDoc(id : number){
        const items : DbItem[] = [];
        this.getAll(items);
        const doc = items.find(x => x.id == id);
        if(doc instanceof DbDoc){
            return doc;
        }
        else{
            undefined;
        }

    }
}

export class BackUp {
    db : Firestore;
    batch : WriteBatch;
    date_str : string;
    docIds : number[] = [];

    constructor(){
        this.db = getDB();
        try{

            // this.db.batch();
            this.batch = writeBatch(this.db);
        }
        catch(e){
            throw new MyError(`BackUp error: ${e}`);
        }

        this.date_str = dateString();
    }

    async writeBackUp(doc_id : number, doc_name : string, json_text : string){
        if(user == null || refId == undefined){
            throw new MyError();
        }
    
        const doc_obj = getDocObj(doc_id, doc_name, json_text);

        try{
            const doc_id_str = `${doc_id}`;
            // this.db.collection('users').doc(user.uid).collection('backup').doc(this.date_str).collection('docs').doc(doc_id_str);
            const doc_ref = doc(this.db, 'users', user.uid, 'backup', this.date_str, 'docs', doc_id_str);
            await this.batch.set(doc_ref, doc_obj);
        }
        catch(e){
            msg(`write BackUp error: ${user.email} ref:${refId} ${e}`);
        }

        this.docIds.push(doc_id);
    }

    async commitBackUp(){
        if(user == null || refId == undefined){
            throw new MyError();
        }

        const index_obj = {
            docIds : this.docIds
        };

        try{
            // this.db.collection('users').doc(user.uid).collection('backup').doc(this.date_str).collection('docs').doc("index");
            const index_ref = doc(this.db, 'users', user.uid, 'backup', this.date_str, 'docs', "index");
            await this.batch.set(index_ref, index_obj);

            await this.batch.commit();
        }
        catch(e){
            msg(`commit BackUp error: ${e}`);
        }

        const user_data = await getUserData();
        if(user_data == undefined){
            throw new MyError(`no user data`);
        }
        else{
            user_data.latestBackup = this.date_str;
            await setUserData(user_data);

            msg("commit BackUp");
        }
    }
}

export async function* getBackUp(){
    if(user == null){
        throw new MyError();
    }

    const db = getDB();

    const user_data = await getUserData();
    if(user_data == undefined){
        throw new MyError();
    }

    const date_str = user_data.latestBackup as string;
    if(date_str == undefined){
        throw new MyError();
    }

    // db.collection('users').doc(user.uid).collection('backup').doc(date_str).collection('docs').doc("index")
    const index_ref = doc(db, 'users', user.uid, 'backup', date_str, 'docs', "index");
    const index_obj = await getDbData(index_ref);
    if(index_obj == undefined){
        throw new MyError();
    }

    const docIds = index_obj.docIds as number[];
    if(docIds == undefined){
        throw new MyError();
    }

    for(const doc_id of docIds){
        msg(`doc-Ids : ${docIds}`);

        const doc_id_str = `${doc_id}`;
        // db.collection('users').doc(user.uid).collection('backup').doc(date_str).collection('docs').doc(doc_id_str);
        const doc_ref = doc(db, 'users', user.uid, 'backup', date_str, 'docs', doc_id_str);
        const doc_obj = await getDbData(doc_ref);

        yield doc_obj;
    }

}

export function getNewId() : number {
    if(rootFolder == null){
        throw new MyError();
    }

    const items : DbItem[] = [];
    rootFolder.getAll(items);
    const ids = items.map(x => x.id);
    if(ids.length == 0){
        return 1;
    }
    return Math.max(...ids) + 1;
}


export function makeDoc(parent : DbFolder, name : string, text : string) : DbDoc {
    const id = getNewId();
    const db_doc = new DbDoc(parent, id, name, text);
    parent.addItem(db_doc);

    return db_doc;
}

export async function addFolder(parent : DbFolder, name : string){
    const id = getNewId();
    const folder = new DbFolder(parent, id, name);
    parent.children.push(folder);

    await updateIndex();
}

export function makeContents(parent : DbFolder | null, obj : any) : DbItem {
    if(obj.children != undefined){
        const folder = new DbFolder(parent, obj.id, obj.name);
        for(const child_obj of obj.children){
            const child = makeContents(folder, child_obj);
            folder.children.push(child);
        }

        return folder;
    }
    else{
        const doc = new DbDoc(parent, obj.id, obj.name, obj.text);
        return doc;
    }
}


export function inputDocName(default_name : string) : string {
    let name = prompt("Enter the document name.", default_name);
    if(name == null || name.trim() == ""){
        return "";
    }

    return name.trim();
}


let DbItemId = 0;
let selectedFileItems : HTMLLIElement[] = [];
let IdtoItem : Map<string, DbItem>;
let rootUL : HTMLUListElement;

function clearFileItemBorder(){
    const insertion_points = document.getElementsByClassName("file-item");
    for(const ele of insertion_points){
        (ele as HTMLElement).style.borderStyle = "none";
    }
}

function setFileItemSelection(lis : HTMLLIElement[]){
    clearFileItemSelection();

    selectedFileItems = lis.slice();
    selectedFileItems.forEach(x => x.style.backgroundColor = "DeepSkyBlue");
}

function clearFileItemSelection(){
    selectedFileItems.forEach(x => x.style.backgroundColor = "");
    selectedFileItems = [];
}

function setDragDrop(li : HTMLLIElement){
    li.draggable = true;
    // li.style.cursor = "move";

    li.addEventListener('dragstart', (ev : DragEvent)=>{
        clearFileItemBorder();
        msg(`drag start`);

        if(ev.dataTransfer != null && ev.target instanceof HTMLElement){
            if(selectedFileItems.length == 0){

                setFileItemSelection([ li ]);
            }

            ev.dataTransfer.setData('text/plain', ev.target.id);
        }
    });

    li.addEventListener('dragover', (ev : DragEvent)=>{
        ev.preventDefault();
        clearFileItemBorder();

        msg(`drag over`);
        const rc = li.getBoundingClientRect();
        const center_y = rc.y + 0.5 * rc.height;

        if(center_y < ev.clientY){

            li.style.borderBottomStyle = "solid";
        }
        else{
            const prev = li.previousElementSibling;
            if(prev instanceof HTMLLIElement){

                prev.style.borderBottomStyle = "solid";
            }
            else{

                li.style.borderTopStyle = "solid";
            }
        }
    });

    li.addEventListener('dragleave', (ev : DragEvent)=>{
        clearFileItemBorder();
        msg(`drag leave`);
    });

    li.addEventListener("dragend", (ev : DragEvent)=>{
        msg(`drag end`);
        clearFileItemBorder();
        clearFileItemSelection();
    });

    li.addEventListener('drop', (ev : DragEvent)=>{
        ev.preventDefault();
        msg("drop")

        if(selectedFileItems.length != 0){

            const target = IdtoItem.get(li.id);
            if(target == undefined){
                throw new MyError();                
            }

            const items : DbItem[] = [];
            for(const li2 of selectedFileItems){
                const item = IdtoItem.get(li2.id);
                if(item == undefined){
                    throw new MyError();
                }
                items.push(item);
            }
            const items_parent = items[0].parent!;
            items.forEach(item => remove(items_parent.children, item));

            const target_idx = target.parent!.children.indexOf(target);
            if(target_idx == -1){
                throw new MyError();
            }

            target.parent!.children.splice(target_idx, 0, ...items);
            items.forEach(x => x.parent = target.parent);

            rootUL.innerHTML = "";
            makeFolderHtml(rootFolder!, rootUL, undefined, undefined);
        }

        clearFileItemBorder();
        clearFileItemSelection();
    });

    li.addEventListener("click", (ev : MouseEvent)=>{
        msg(`click`);
        if(ev.shiftKey){
            if(selectedFileItems.length == 1 && selectedFileItems[0].parentElement == li.parentElement){
                const children = Array.from(li.parentElement!.children) as HTMLLIElement[];
                let i1 = children.indexOf(li);
                let i2 = children.indexOf(selectedFileItems[0]);
                if(i2 < i1){
                    [i1, i2] = [i2, i1];
                }

                setFileItemSelection(children.slice(i1, i2 + 1))
            }
        }
        else{

            setFileItemSelection([ li ]);
        }
    });    

}

function makeFolderHtml(item : DbItem, ul : HTMLUListElement, read_doc?:(id:number)=>void, doc_text? : string){
    const li = document.createElement("li");
    li.id = `db-item-${++DbItemId}`;
    IdtoItem.set(li.id, item);

    if(read_doc != undefined){

        li.style.fontSize = "xxx-large";
    }
    else{

        li.style.borderWidth = "2px";
        li.className = "file-item";
        setDragDrop(li);
    }

    let img_name : string;
    if(item instanceof DbDoc){
        
        li.style.cursor = "pointer";

        if(read_doc != undefined){

            li.addEventListener("click", (ev : MouseEvent)=>{
                $dlg("file-dlg").close();
                read_doc(item.id);
            });    
        }

        img_name = "doc";
    }
    else{

        li.style.cursor = "default";

        img_name = "folder";
    }

    li.innerText = TT(item.name);
    li.style.listStyleImage = `url(${urlOrigin}/lib/firebase/img/${img_name}.png)`

    li.addEventListener("contextmenu", (ev:MouseEvent)=>{
        ev.preventDefault();

        let menu : PopupMenu;
        
        if(doc_text != undefined){

            menu = $popup({
                children : [
                    $button({
                        text : TT("new document"),
                        fontSize : "large",
                        click : async (ev : MouseEvent)=>{                                
                            const parent = (item instanceof DbFolder ? item : item.parent!);
                            putDoc(parent, doc_text);
                        }
                    })
                ]
            });
        }
        else{

            menu = $popup({
                children : [
                    $button({
                        text : TT("add folder"),
                        fontSize : "large",
                        disabled : !(item instanceof DbFolder),
                        click : async (ev : MouseEvent)=>{                                
                            msg("add folder");

                            const name = window.prompt("enter a folder name.");
                            if(name == null || name.trim() == ""){
                                return;
                            }
                    
                            if(item instanceof DbFolder){

                                await addFolder(item, name.trim());                    
                            }
                        }
                    })
                    ,
                    $button({
                        text : TT("rename"),
                        fontSize : "large",
                        click : async (ev : MouseEvent)=>{                                
                            msg("add folder");

                            const name = window.prompt("enter a new name.", item.name);
                            if(name == null || name.trim() == ""){
                                return;
                            }
                    
                            item.name = name.trim();
                            await updateIndex();
                        }
                    })
                    ,
                    $button({
                        text : TT("delete"),
                        fontSize : "large",
                        click : async (ev : MouseEvent)=>{                                
                            msg("delete");
                            if(item instanceof DbDoc){
                                await deleteDocDB(item);
                            }
                            else{

                            }
                        }
                    })
                ]
            });
        }

        menu.show(ev);
    });

    ul.append(li);

    if(item instanceof DbFolder){

        const children_ul = document.createElement("ul");
        item.children.forEach(x => makeFolderHtml(x, children_ul, read_doc, doc_text));
        ul.append(children_ul);
    }

}

export async function showContents(read_doc?:(id:number)=>void, doc_text? : string){
    if(rootFolder == null){
        await makeRootFolder();
    }

    const dlg = $dlg("file-dlg");

    dlg.innerHTML = "";

    rootUL = document.createElement("ul");

    IdtoItem = new Map<string, DbItem>();
    makeFolderHtml(rootFolder!, rootUL, read_doc, doc_text);
    dlg.append(rootUL);

    dlg.showModal();

}

export async function getRootFolder() : Promise<DbFolder> {
    if(rootFolder == null){
        await makeRootFolder();
    }

    return rootFolder!;
}


export async function deleteDocDB(doc : DbDoc){
    if(! window.confirm(`Are you sure you want to delete ${doc.name}?`)){
        return;
    }

    if(refId == undefined){
        throw new MyError();
    }

    if(rootFolder == null){
        await makeRootFolder();
    }

    const root_folder_copy = rootFolder!.copy(null);
    const doc_copy = root_folder_copy.findDoc(doc.id);
    if(doc_copy == undefined){
        throw new MyError(`invalid doc id:${doc.id}`);
    }
    if(doc_copy.parent == null){
        throw new MyError(`orphaned doc id:${doc.id} name:${doc_copy.name}`);
    }

    remove(doc_copy.parent.children, doc_copy);
    
    const db = getDB();

    try{
        let batch = writeBatch(db);

        const doc_ref = getDocRef(`${doc_copy.id}`);
        batch.delete(doc_ref);

        const index_obj = {
            version : 1.0,
            root : root_folder_copy.makeIndex()
        };
        msg(`index:${JSON.stringify(index_obj.root, null, 4)}`);

        let idxRef = getDocRef("index");
        batch.set(idxRef, index_obj);

        await batch.commit();
        
        setRootFolder(root_folder_copy);

        msg("write doc OK");
    }
    catch(e){
        throw new MyError(`${e}`);
    }        

}
