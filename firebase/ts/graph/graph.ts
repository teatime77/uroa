///<reference path="edge.ts" />

import { getFirestore, Firestore, writeBatch, doc, getDoc, setDoc, DocumentReference, DocumentData } from 'firebase/firestore';

import { msg, TT, $, $dlg, assert, remove, MyError, appMode, AppMode } from "@i18n";
import { getDB, getDocRef, user, refId, writeDB, fetchDB, defaultRefId, rootFolder } from "../firebase";
import { MapItem, Doc, Edge, getEdge, addEdge } from "./edge";
import { getThumbnailDownloadURL } from "../storage";

declare var Viz: any;

export const dataVersion = 2.1;

let focusedItem : MapItem | undefined;

let dlgSet = new Set<string>();



export function setGraph(graph_arg : Graph){
    graph = graph_arg;
}

function showDlg(ev : MouseEvent, dlg_id : string){    
    const dlg = $dlg(dlg_id);

    dlg.style.left = `${ev.pageX}px`;
    dlg.style.top  = ev.pageY + "px";

    dlg.showModal();

    if(!dlgSet.has(dlg_id)){
        dlgSet.add(dlg_id);
        dlg.addEventListener("click", (ev : MouseEvent)=>{
            dlg.close();
        });
    }

    // const rc = dlg.getBoundingClientRect();
    // if(document.documentElement.scrollWidth < ev.pageX + rc.width){
    //     dlg.style.left = `${document.documentElement.scrollWidth - rc.width}px`;
    // }
}


let langList : string[] = [ "ja", "en", "ko", "zh" ];
export let langIdx : number = 1;

let showSubgraph : boolean = true;

function makeImgFromNode(map_div : HTMLElement, doc : Doc){
    if(doc.img == undefined){

        doc.img = document.createElement("img");
        doc.img.style.position = "absolute";

        doc.img.addEventListener("click", async (ev : MouseEvent)=>{
            await doc.onVizClick(ev);
        });

        doc.img.addEventListener("contextmenu", (ev:MouseEvent)=>{
            ev.preventDefault();
            ev.stopPropagation();

            focusedItem = doc;
            showDlg(ev, "graph-doc-menu-dlg");
        });

        doc.img.addEventListener("mouseenter", (ev : MouseEvent)=>{
            msg(`tooltip:${doc.id} ${TT(doc.title)}`);
        });

        if(doc.imgURL != ""){
            doc.img!.src = doc.imgURL;
        }
        else{

            getThumbnailDownloadURL(doc.id).then((url:string)=>{
                doc.imgURL = url;
                doc.img!.src = url;
            });
        }
    }

    doc.tooltip = document.createElement("span");
    doc.tooltip.className = "tooltip";
    if(appMode == AppMode.edit){
        doc.tooltip.innerText = `${doc.id}:${TT(doc.title)}`;
    }
    else{
        doc.tooltip.innerText = `${TT(doc.title)}`;
    }

    doc.setImgPos();

    map_div.append(doc.img);
    map_div.append(doc.tooltip);
}

export class Graph {
    docs : Doc[];
    edgeMap = new Map<string, Edge>();
    sections : Section[];
    selections : Doc[] = [];

    constructor(docs : Doc[], sections : Section[], edge_map : Map<string, Edge>){
        this.docs  = docs;
        this.sections = sections;
        this.edgeMap = edge_map;

        window.addEventListener("resize", (ev : UIEvent)=>{
            this.docs.forEach(doc => doc.setImgPos())
        });
    }

    edges() : Edge[]{
        return Array.from(this.edgeMap.values());
    }

    makeViz(){
        let doc_map = new Map<string, Doc>();
        this.docs.forEach(doc => doc_map.set(`${doc.id}`, doc));

        let sec_map = new Map<string, Section>();
        this.sections.forEach(sec => sec_map.set(`s${sec.id}`, sec));

        let docLines  : string[] = [];
        let secLines  : string[] = [];
        let edgeLines : string[] = [];

        if(showSubgraph){
            this.docs.filter(doc => doc.parent == undefined).forEach(doc => doc.makeDot(docLines));
            this.sections.filter(sec => sec.parent == undefined).forEach(sec => sec.makeDot(secLines));
        }
        else{
            this.docs.forEach(doc => doc.makeDot(docLines));
        }

        this.edges().forEach(edge => edge.makeDot(edgeLines));

        const ranks : string[] = [];

        let dot = `
        digraph graph_name {
            graph [
                rankdir = "TB";
                charset = "UTF-8";
            ];
            ${docLines.join('\n')}
            ${secLines.join('\n')}
            ${edgeLines.join('\n')}
            ${ranks.join('\n')}
        }
        `;

        Viz.instance().then(async function(viz:any) {

            var svg = viz.renderSVGElement(dot) as SVGSVGElement;

            svg.addEventListener("contextmenu", onMenu);
            svg.addEventListener("click", graph.onClick.bind(graph));

            svg.style.width = `100vw`;
            svg.style.height = `100vh`;
        

            const map_div = $("map-div");
            map_div.innerHTML = "";

            map_div.appendChild(svg);

            const nodes = Array.from(svg.getElementsByClassName("node doc")) as SVGGElement[];
            for(const g of nodes){
                const doc = doc_map.get(g.id);
                if(doc == undefined){

                    msg(`node NG: ${g.id} [${g.textContent}]`);
                }
                else{

                    const polygons = g.getElementsByTagName("polygon");
                    if(polygons.length == 1){
                        doc.polygon = polygons.item(0)!;
                    }

                    makeImgFromNode(map_div, doc);
                }

                g.setAttribute("cursor", "pointer");
            }


            const edges = Array.from(svg.getElementsByClassName("edge")) as SVGGElement[];
            for(const g of edges){
                const edge = graph.edgeMap.get(g.id);
                if(edge == undefined){

                    msg(`edge NG: ${g.id} [${g.textContent}]`);
                }
                else{
                    g.addEventListener("click", edge.onEdgeClick.bind(edge));
                    g.addEventListener("contextmenu", edge.onEdgeMenu.bind(edge));

                    const paths = g.getElementsByTagName("path");
                    if(paths.length == 1){
                        edge.path = paths.item(0)!;
                    }
                    else{
                        msg(`edge no path: ${g.id} ${paths.length} [${g.textContent}]`);                        
                    }
                }

                g.setAttribute("cursor", "crosshair");
            }

            if(showSubgraph){

                for(const [id, sec] of sec_map.entries()){
                    const g = svg.getElementById(id) as SVGGElement;
                    assert(g != undefined);
                    g.addEventListener("click", sec.onSectionClick.bind(sec));
                    g.addEventListener("contextmenu", sec.onSectionMenu.bind(sec));

                    const polygons = g.getElementsByTagName("polygon");
                    if(polygons.length == 1){
                        sec.polygon = polygons.item(0)!;
                    }

                    g.setAttribute("cursor", "pointer");
                }
            }
        });
    }


    async onKeyDown(ev : KeyboardEvent){        
        if(ev.key == "Escape"){
            this.clearSelections();
        }
        else if(ev.key == "Delete"){
            await this.deleteEdges();
        }
    }

    async deleteEdges(){
        const selected_edges = this.edges().filter(edge => edge.selected);
        if(selected_edges.length != 0){

            if(window.confirm("Do you really want to delete?")) {
                selected_edges.forEach(edge => this.edgeMap.delete(edge.key()));

                this.clearSelections();

                await updateGraph();
            }
        }
    }

    async deleteDoc(doc : Doc){
        remove(this.docs, focusedItem);
        const edges = this.edges().filter(x => x.src != doc && x.dst != doc);
        this.edgeMap = new Map<string, Edge>();
        for(const edge of edges){
            const key = edge.key();
            this.edgeMap.set(key, edge);
        }
        
        const graph_obj = getGraphObj();

        const db = getDB();

        try{
            let batch = writeBatch(db);
    
            const doc_ref = getDocRef(`${doc.id}`);
            batch.delete(doc_ref);

            const graph_ref = getDocRef("graph");
            batch.set(graph_ref, graph_obj);
    
            await batch.commit();
                
            msg("delete doc OK");
        }
        catch(e){
            throw new MyError(`${e}`);
        }        
    }

    clearSelections(){
        this.docs.filter(doc => doc.selected).forEach(doc => doc.select(false));
        this.selections = [];
        
        this.edges().filter(edge => edge.selected).forEach(edge => edge.select(false));
    }

    getDocById(doc_id : number) : Doc | undefined {
        return this.docs.find(x => x.id == doc_id);
    }

    addDoc(title : string, wiki : string | undefined) : Doc {        
        const max_id = (this.docs.length == 0 ? 0 : Math.max(... this.docs.map(x => x.id)));
        const doc = new Doc(max_id + 1, title, wiki);
        this.docs.push(doc);

        this.docs.sort((a:Doc, b:Doc) => a.id - b.id);

        return doc;
    }

    addSection(title : string, wiki : string | undefined) : Section{
        let next_id = 1;
        for(const sec of this.sections){
            if(next_id < sec.id){
                break;
            }
            next_id++;
        }

        const section = new Section(next_id, title, wiki);
        this.sections.push(section);

        this.docs.filter(x => x.selected).forEach(x => x.parent = section);
        this.clearSelections();

        return section;
    }

    async removeFromSection(ev : MouseEvent){
        this.docs.filter(x => x.selected).forEach(x => x.parent = undefined);
        this.clearSelections();

        await updateGraph();
    }

    async connectEdge(ev : MouseEvent){
        if(this.selections.length < 2){
            return;
        }

        for(let i = 0; i + 1 < this.selections.length; i++){
            const [src, dst] = this.selections.slice(i, i + 2);

            if(getEdge(this.edgeMap, src, dst) == undefined){
                addEdge(this.edgeMap, src, dst);
            }
        }

        this.clearSelections();

        await updateGraph();
    }

    onClick(ev : MouseEvent){
        this.docs.filter(x => x.selected).forEach(x => x.select(false));
    }
}

export let graph : Graph;

export function getGraph() : Graph {
    return graph;
}

export function hideGraph(){
    $("map-div").style.display = "none";
}

export function showGraph(){
    $("map-div").style.display = "inline-block";    
}

export class Section extends MapItem {
    polygon : SVGPolygonElement | undefined;

    constructor(id: number, title : string, wiki : string | undefined){
        super(id, title, wiki);
    }

    select(selected : boolean){
        this.selected = selected;

        let color = (this.selected ? "red" : "black");

        if(this.polygon != undefined){
            this.polygon.setAttribute("stroke", color);
        }
    }

    onSectionClick(ev : MouseEvent){
        ev.stopPropagation();
        ev.preventDefault();

        if(ev.ctrlKey){

            this.select(!this.selected);
            msg(`section : ${this.title}`);
        }
    }

    onSectionMenu(ev : MouseEvent){
        ev.stopPropagation();
        ev.preventDefault();

        $("add-section-to-section").onclick = this.addSectionToSection.bind(this);
        $("add-item-to-section").onclick = this.addItemToSection.bind(this);
        $("append-to-section").onclick = this.appendToSection.bind(this);

        focusedItem = this;
        showDlg(ev, "graph-section-menu-dlg");
    }

    async addItemToSection(ev : MouseEvent){
        const title = prompt();
        if(title == null){
            return;
        }

        const doc = graph.addDoc(title, undefined);
        doc.parent = this;

        await updateGraph();
    }

    async addSectionToSection(ev : MouseEvent){
        const title = prompt();
        msg(`input ${title}`);
        if(title == null){
            return;
        }
        const sec = graph.addSection(title, undefined);
        sec.parent = this;

        await updateGraph();
    }

    async appendToSection(ev : MouseEvent){
        msg(`append To Section`);
        allMapItems().filter(x => x.selected).forEach(x => x.parent = this);
        graph.clearSelections();

        await updateGraph();
    }

    makeDot(lines : string[]){
        lines.push(`subgraph cluster_${this.id} {`);
        lines.push(`    id = "s${this.id}";`);
        lines.push(`    label = "${TT(this.title)}";`);
        lines.push(`    labelloc  = "b";`);
        lines.push(`    labeljust = "l";`);
        lines.push(`    bgcolor   = "cornsilk";`);
        lines.push(`    color     = "green";`);
        lines.push(`    penwidth  = 2;`);

        graph.sections.filter(sec => sec.parent == this).forEach(sec => sec.makeDot(lines));
        const docs = graph.docs.filter(sec => sec.parent == this);
        if(docs.length == 0){
            // If there is no children, subgraph is not created.
            
            lines.push(`b${this.id}dummy [ label="dummy" style="invis" ];` );
        }
        else{
            docs.forEach(doc => doc.makeDot(lines));
        }

        lines.push(`}`);
    }
}


async function onMenu(ev : MouseEvent){
    ev.preventDefault();
    ev.stopPropagation();

    showDlg(ev, "graph-menu-dlg");
}

function setLangHandler(){
    const lang_buttons = Array.from(document.getElementsByClassName("lang")) as HTMLButtonElement[];
    for(const lang_button of lang_buttons){
        lang_button.addEventListener("click", (ev: MouseEvent)=>{
            const lang = lang_button.id.substring(5);
            langIdx = langList.indexOf(lang);
            msg(`lang:${langIdx} ${lang}`);
            if(langIdx == undefined){
                throw new MyError();
            }

            graph.makeViz();
        })

    }

}

function getSearchParams(){
    const url = new URL(window.location.href);
    const params = url.searchParams;

    const lang = params.get("lang");
    if(lang != undefined){
        const lang_idx = langList.indexOf(lang);
        if(lang_idx != -1){
            langIdx = lang_idx;
        }
    }
}

export async function bodyOnLoadGraph(){
    getSearchParams();

    setLangHandler();

    $("map-svg").style.display = "none";

/*
    const data = await fetchJson(`../data/graph.json`);

    const [docs, sections, edge_map] = makeDocsFromJson(data);

*/
}

function getGraphObj(){
    graph.makeViz();        

    if(user == null || rootFolder == null || refId == undefined){
        throw new MyError();
    }

    const graph_obj = {
        version : 1.0,
        docs : graph.docs.map(x => x.makeObj()),
        sections : graph.sections.map(x => x.makeObj()),
        edges : graph.edges().map(x => x.makeObj())
    };

    return graph_obj;
}

export async function updateGraph(){
    const graph_obj = getGraphObj();

    msg(`update graph [${JSON.stringify(graph_obj, null, 4)}]`);

    if(! window.confirm("update DB?")){
        return;
    }

    try{
        await setDoc(getDocRef("graph"), graph_obj);
        msg(`update graph OK`);
    }
    catch(e){
        msg(`update graph error: ${user!.email} ref:${refId} ${e}`);
    }
}

export async function addGraphItem(){
    let doc_name = prompt("Enter a name for the new document.");
    msg(`input ${doc_name}`);
    if(doc_name == null){
        return;
    }

    doc_name = doc_name.trim();
    const doc = graph.addDoc(doc_name, undefined);

    const data = {
        version : dataVersion,
        operations : []
    };

    const data_text = JSON.stringify(data, null, 4);
    const doc_obj = getDocObj(doc.id, doc_name, data_text);

    const graph_obj = getGraphObj();

    const db = getDB();

    try{
        let batch = writeBatch(db);

        const doc_ref = getDocRef(`${doc.id}`);
        batch.set(doc_ref, doc_obj);

        const graph_ref = getDocRef("graph");
        batch.set(graph_ref, graph_obj);

        await batch.commit();
            
        msg("add-Graph-Item OK");
    }
    catch(e){
        throw new MyError(`${e}`);
    }        
}

export async function addGraphSection(){
    const title = prompt();
    msg(`input ${title}`);
    if(title == null){
        return;
    }
    graph.addSection(title, undefined);
    await updateGraph();
}

export async function renameDoc(){
    if(focusedItem instanceof Doc){

        const name = window.prompt("enter a new document name.", focusedItem.title);
        if(name != null && name.trim() != ""){

            focusedItem.title = name.trim();
            focusedItem.img!.title = TT(focusedItem.title);

            await updateGraph();
        }
    }

    focusedItem = undefined;
}

export async function renameSection(){
    if(focusedItem instanceof Section){

        const name = window.prompt("enter a new section name.", focusedItem.title);
        if(name != null && name.trim() != ""){

            focusedItem.title = name.trim();

            await updateGraph();
        }
    }

    focusedItem = undefined;
}

export async function deleteDoc(){
    if(focusedItem instanceof Doc && window.confirm(`Are you sure you want to delete ${TT(focusedItem.title)}?`) ){
        await graph.deleteDoc(focusedItem);
    }

    focusedItem = undefined;
}

export async function changeDisplay(){
    showSubgraph = ! showSubgraph;
    graph.makeViz();      
}

function allMapItems() : MapItem[] {
    return (graph.docs as MapItem[]).concat(graph.sections);
}

export function getDocObj(doc_id : number, doc_name : string, json_text : string) : any {
    return {
        parent : -1,
        id : doc_id,
        name : doc_name,
        text : json_text
    };
}

export async function writeGraphDocDB(doc_id : number, doc_name : string, json_text : string){
    const doc_obj = getDocObj(doc_id, doc_name, json_text);

    await writeDB(`${doc_id}`, doc_obj);
}

export async function copyAllGraph(){
    let graph_obj = await fetchDB("graph", defaultRefId);
    if(graph_obj == undefined){
        throw new MyError("no graph data");
    }

    const docs = new Map<string, DocumentData>();
    for(const doc_obj of graph_obj.docs){
        const id = `${doc_obj.id}`;
        const doc = await fetchDB(id, defaultRefId);
        if(doc == undefined){
            msg(`no doc:${id} ${doc_obj.title}`);
            continue;
        }

        // msg(`read doc:${id} ${doc.name}`);
        docs.set(id, doc);
    }

    await writeDB("graph", graph_obj);
    for(const [id, doc] of docs.entries()){
        await writeDB(id, doc);
    }

    msg("copyAllGraph completes.")
}

