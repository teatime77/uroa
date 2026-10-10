import { AppMode, appMode, EngTextToId, TT, unique, MyError, msg, $, assert, remove } from "@i18n";
import { DbDoc, DbFolder } from "../contents";
import { makeRootFolder, fetchDB, rootFolder, readDocFnc } from "../firebase";
import { Section, graph, Graph, hideGraph, showGraph, setGraph } from "./graph";

let edge_Map = new Map<string, Edge>();
let selectedDoc : Doc | null = null;
let closeGraphButton : HTMLButtonElement | undefined;

export function edgeKey(doc1 : Doc, doc2 : Doc) : string {
    return `${doc1.id}:${doc2.id}`;
}

export function getEdge(edge_map : Map<string, Edge>, doc1 : Doc, doc2 : Doc) : Edge | undefined {
    const key = edgeKey(doc1, doc2);
    const edge = edge_map.get(key)!;

    return edge;
}

export function addEdge(edge_map : Map<string, Edge>, src_doc : Doc, dst_doc : Doc) : Edge {
    src_doc.dsts.push(dst_doc);
    dst_doc.srcs.push(src_doc);

    const edge = new Edge(src_doc, dst_doc);
    const key = edgeKey(src_doc, dst_doc);
    edge_map.set(key, edge);

    return edge;
}

function cancelLinkDocs(){
    if(selectedDoc != null){

        selectedDoc.setColor("black");
        selectedDoc = null;
    }
}

function makeDocsFromDbFolder(docs : Doc[], folder : DbFolder) : any {
    // const obj : { docs : }
    for(const item of folder.children){
        if(item instanceof DbFolder){
            makeDocsFromDbFolder(docs, item);
        }
        else if(item instanceof DbDoc){
            const doc = new Doc(item.id, item.name, undefined);
            docs.push(doc);
        }
        else{
            throw new MyError();
        }
    }
}

async function initGraph() {
    const docs : Doc[] = [];
    makeDocsFromDbFolder(docs, rootFolder!);

    const sections : Section[] = [];
    const edge_map = new Map<string, Edge>();

    return [docs, sections, edge_map];
    
}

async function loadGraph() : Promise<[Doc[], Section[], Map<string, Edge>]>{
    if(rootFolder == null){
        await makeRootFolder();
    }

    let graph_obj = await fetchDB("graph");
    if(graph_obj == undefined){
        return [[], [], new Map<string, Edge>()];
    }

    const doc_map = new Map<number, Doc>();
    const section_map = new Map<number, Section>();

    const parent_items : [number, MapItem][] = [];

    for(const doc_obj of graph_obj.docs){
        const doc = new Doc(doc_obj.id, doc_obj.title, doc_obj.imgURL);
        doc_map.set(doc.id, doc);

        if(doc_obj.parent != -1){
            parent_items.push([doc_obj.parent, doc]);
        }
    }

    for(const sec_obj of graph_obj.sections){
        const section = new Section(sec_obj.id, sec_obj.title, undefined);
        section_map.set(section.id, section);

        if(sec_obj.parent != -1){
            parent_items.push([sec_obj.parent, section]);
        }
    }

    for(const [parent_id, item] of parent_items){
        const parent = section_map.get(parent_id);
        if(parent == undefined){
            msg(`unknown parent:${parent_id}`);
            continue;
        }

        item.parent = parent;
    }

    const edge_map = new Map<string, Edge>();
    for(const edge_obj of graph_obj.edges){
        const src = doc_map.get(edge_obj.src);
        const dst = doc_map.get(edge_obj.dst);
        if(src == undefined || dst == undefined){
            msg(`unknown src:${edge_obj.src} dst:${edge_obj.dst}`)
            continue;
        }

        const edge = new Edge(src, dst);
        const key = edge.key();
        edge_map.set(key, edge);
    }

    const docs = Array.from(doc_map.values());
    const sections = Array.from(section_map.values());

    const titles = unique((docs as (Doc | Section)[]).concat(sections).map(x => x.title));
    let   idx = Math.max(... EngTextToId.values()) + 1;
    msg("==============================> titles")
    for(const title of titles){
        const id = EngTextToId.get(title);
        if(id == undefined){
            msg(`${idx}:${title}`);
            idx++;
        }
    }
    msg("==============================< titles")

    return [docs, sections, edge_map];
}

export async function makeDocsGraph(){
    const map_div = document.createElement("div");
    map_div.id = "map-div";

    map_div.style.position = "absolute";
    map_div.style.left = `0`;
    map_div.style.top  = `0`;
    map_div.style.width = `100vw`;
    map_div.style.height = `100vh`;
    map_div.style.backgroundColor = "rgba(0, 0, 0, 0.5)";

    document.body.append(map_div);

    const [docs, sections, edge_map] = await loadGraph();

    setGraph(new Graph(docs, sections, edge_map));

    $("remove-from-section").onclick = graph.removeFromSection.bind(graph);
    $("connect-edge").addEventListener("click", graph.connectEdge.bind(graph));
    document.body.addEventListener("keydown", graph.onKeyDown.bind(graph));

    graph.makeViz();        
}

export function makeDocsFromJson(data : any) : [Doc[], Section[], Map<string, Edge>] {
    const sec_map = new Map<number, Section>();

    const sections : Section[] = [];
    if(data["sections"] != undefined){

        const sec_to_parent_id : [Section, number][] = [];
        for(const obj of data["sections"]){
            const section = new Section(obj["id"], obj["title"], obj["wiki"]);
            sections.push(section);
            sec_map.set(section.id, section);

            const parent_id = obj["parent"];
            if(parent_id != undefined){

                sec_to_parent_id.push([section, parent_id])
            }
        }

        for(const [sec, parent_id] of sec_to_parent_id){
            sec.parent = sec_map.get(parent_id);
            if(sec.parent == undefined){

                msg(`section parent is invalid:${sec.id} ${sec.title} parent:${parent_id}`);
            }
        }
    }

    const doc_map = new Map<number, Doc>();
    for(const obj of data["docs"]){
        const doc = new Doc(obj["id"], obj["title"], obj["wiki"]);

        const parent_id = obj["parent"];
        if(parent_id != undefined){
            doc.parent = sec_map.get(parent_id);
            if(doc.parent == undefined){

                msg(`doc parent is invalid:${doc.id} ${doc.title} parent:${parent_id}`);
            }
        }

        doc_map.set(doc.id, doc);
    }
    const docs = Array.from(doc_map.values());

    const edge_map = new Map<string, Edge>();
    for(const obj of data["edges"]){
        const src_doc = doc_map.get(obj["src"])!;
        const dst_doc = doc_map.get(obj["dst"])!;

        assert(src_doc != undefined && dst_doc != undefined);

        addEdge(edge_map, src_doc, dst_doc);
    }    

    const orphaned_docs = docs.filter(x => x.srcs.length == 0 && x.dsts.length == 0);
    for(const doc of orphaned_docs){
        msg(`orphaned doc:${doc.id} ${doc.title}`);
        // remove(docs, doc);
    }
    for(const doc of docs){
        const words = doc.title.split(":");
        if(words.length < 4 || !words.every(x => x.length != 0)){
            msg(`翻訳:${doc.title}`);
        }
    }

    return [docs, sections, edge_map];
}



export class MapItem {
    id       : number;
    parent   : Section | undefined;
    title    : string;
    wiki     : string | undefined = undefined;
    selected : boolean = false;

    constructor(id : number, title : string, wiki : string | undefined){
        this.id    = id;
        this.title = title;
        this.wiki  = wiki;
    }

    makeObj() : any {
        const parent = (this.parent != undefined ? this.parent.id : -1);
        return {
            id : this.id,
            parent,
            title : this.title
        };
    }

    jsonStr() : string {
        let wiki = this.wiki == undefined ? "" : `, "wiki":"${this.wiki}"`;

        if(this.parent == undefined){

            return `{ "id" : ${this.id}, "title" : "${this.title}"${wiki} }`;
        }
        else{

            return `{ "id" : ${this.id}, "title" : "${this.title}", "parent" : ${this.parent.id}${wiki} }`;
        }
    }
}

export class Doc extends MapItem {
    dsts  : Doc[] = [];
    srcs  : Doc[] = [];

    text! : SVGTextElement;
    rect! : SVGRectElement;
    polygon : SVGPolygonElement | undefined;
    textBox! : DOMRect;

    width  : number = NaN;
    height : number = NaN;

    imgURL : string = "";
    img : HTMLImageElement | undefined;
    tooltip : HTMLSpanElement | undefined;

    constructor(id : number, title : string, imgURL : string | undefined){
        super(id, title, undefined);
        if(imgURL != undefined){
            if(imgURL.includes("blank.png")){
                msg("blank png:${imgURL}");
                this.imgURL = `../plane/images/blank.png`;
            }
            else{

                this.imgURL = imgURL;
            }
        }
    }
    
    makeObj() : any {
        return Object.assign(super.makeObj(), {
            imgURL  : this.imgURL,
        });
    }

    setColor(color : string){
        this.rect.setAttribute("stroke", color);
        this.text.setAttribute("stroke", color);
    }

    select(selected : boolean){
        this.selected = selected;

        let color = (this.selected ? "red" : "black");


        if(this.text != undefined){
            this.text.setAttribute("stroke", color);
        }

        if(this.rect != undefined){
            this.rect.setAttribute("stroke", color);
        }

        if(this.polygon != undefined){
            this.polygon.setAttribute("stroke", color);
        }
    }

    selectSrcs(done:Doc[]){
        if(done.includes(this)){
            return;
        }
        done.push(this);
        this.select(true);
        for(const doc of this.srcs){
            getEdge(edge_Map, doc, this)!.select(true);
            doc.selectSrcs(done);
        }
    }

    selectDsts(done:Doc[]){
        if(done.includes(this)){
            return;
        }
        done.push(this);
        this.select(true);
        for(const doc of this.dsts){
            getEdge(edge_Map, this, doc)!.select(true);
            doc.selectDsts(done);
        }
    }

    onClick(ev : MouseEvent){        
        msg("click doc");
        if(ev.ctrlKey){
        }
        else{

            this.selectSrcs([]);
            this.selectDsts([]);
        }
    }

    async onVizClick(ev : MouseEvent){
        ev.stopPropagation();
        ev.preventDefault();

        msg(`img : ${this.id} ${TT(this.title)}`);

        if(ev.ctrlKey){

            this.select(!this.selected);
            if(this.selected && !graph.selections.includes(this)){
                graph.selections.push(this);
            }
            else if(!this.selected && graph.selections.includes(this)){
                remove(graph.selections, this);
            }

            msg(`viz: ${this.title}`);
        }
        else if(ev.shiftKey){
            const new_url = `./movie.html?id=${this.id}`
            msg(`open movie: ${this.id} ${this.title} url:${new_url}`);
            window.open(new_url, "_blank");
        }
        else{
            if(this.wiki != undefined){

                const new_url = `https://en.wikipedia.org/wiki/${this.wiki}`;
                msg(`open wiki: ${this.id} ${this.title} url:${new_url}`);
                window.open(new_url, "_blank");
            }
            else{
                graph.selections = [this];
                this.select(true);

                hideGraph();
                if(closeGraphButton == undefined){

                    closeGraphButton = $("close-graph") as HTMLButtonElement;
                    closeGraphButton.addEventListener("click", (ev:MouseEvent)=>{
                        closeGraphButton!.style.display = "none";
                        showGraph();
                    });
                }
                closeGraphButton.style.display = "inline-block";
                await readDocFnc(this.id)
            }
        }
    }

    makeDot(lines : string[]){
        if(this.title.startsWith("@") && appMode != AppMode.edit){
            msg(`skip doc:${this.id} ${this.title}`);
            return;
        }

        const color = (this.wiki == undefined ? "black" : "blue");
        lines.push(`b${this.id} [ tooltip="${TT(this.title)}" id="${this.id}" shape = box width=0.5 height=0.5 class="doc" tooltip="　" fontsize="10" , fontcolor="${color}" ];` );
    }

    setImgPos(){
        if(this.img != undefined && this.polygon != undefined){
            const bbox = this.polygon.getBoundingClientRect();

            this.img.style.left = `${bbox.x + 2}px`;
            this.img.style.top  = `${bbox.y + 2}px`;
            this.img.style.width  = `${bbox.width  - 4}px`;
            this.img.style.height = `${bbox.height - 4}px`;       
            
            this.tooltip!.style.left = `${bbox.right}px`;
            this.tooltip!.style.top  = `${bbox.top}px`;
        }
    }
}

export class Edge {
    src : Doc;
    dst : Doc;
    path! : SVGPathElement;
    selected : boolean = false;

    constructor(src : Doc, dst : Doc){
        this.src = src;
        this.dst = dst;
    }

    makeObj() : any {
        return {
            src : this.src.id,
            dst : this.dst.id
        }
    }

    key() : string {
        return edgeKey(this.src, this.dst);
    }

    select(selected : boolean){
        this.selected = selected;
        if(this.selected){

            this.path.setAttribute("stroke", "red");
        }
        else{

            this.path.setAttribute("stroke", "black");
        }
    }

    makeDot(lines : string[]){
        let id = `${this.src.id}:${this.dst.id}`;
        lines.push(`b${this.src.id} -> b${this.dst.id} [ id="${id}" ];`);
    }

    onEdgeClick(ev : MouseEvent){
        ev.stopPropagation();
        ev.preventDefault();

        if(ev.ctrlKey){

            this.select(!this.selected);

            msg(`edge click: ${this.src.title} => ${this.dst.title}`);
        }
    }

    onEdgeMenu(ev : MouseEvent){
        ev.stopPropagation();
        ev.preventDefault();

        $("delete-edge").onclick = graph.deleteEdges.bind(graph);
        // showDlg(ev, "graph-edge-menu-dlg");
    }

}

export function makeIndexJson(docs : Doc[], sections : Section[], edges : Edge[]){
    docs = docs.slice();

    docs.sort((a:Doc, b:Doc) => a.id - b.id);

    const lines : string[] = [];
    lines.push(`{`);

    lines.push(`    "docs" : [`);

    for(const [i,doc] of docs.entries()){
        const cm = (i == docs.length - 1 ? "" : ",");
        lines.push(`        ${doc.jsonStr()}${cm}`);
    }

    lines.push(`    ]`);
    lines.push(`    ,`);

    lines.push(`    "sections" : [`);

    for(const [i,section] of sections.entries()){
        const cm = (i == sections.length - 1 ? "" : ",");
        lines.push(`        ${section.jsonStr()}${cm}`);
    }

    lines.push(`    ]`);
    lines.push(`    ,`);

    lines.push(`    "edges" : [`);

    edges.sort((a:Edge, b:Edge) => edgeKey(a.src, a.dst).localeCompare( edgeKey(b.src, b.dst) ));

    for(const [i,edge] of edges.entries()){
        const cm = (i == edges.length - 1 ? "" : ",");
        lines.push(`        { "src" : ${edge.src.id}, "dst" : ${edge.dst.id} }${cm}`);
    }

    lines.push(`    ]`);
    lines.push(`}`);

    const text = lines.join("\n");

    return text;
}
