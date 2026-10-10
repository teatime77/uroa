import { $div, fetchText, last, msg, MyError, parseURL } from "@i18n";
import { Term, SyntaxError, parseMath, renderKatexSub } from "@parser";

function renderTex(ele : HTMLElement, text : string){
    if(text.startsWith("$") || text.includes(" $")){
        (window as any).renderMathInElement(ele, {
            delimiters : [
                {left: "$$", right: "$$", display: true},
                {left: "$", right: "$", display: false},                        
            ]
        });
    }
}

abstract class ContentBlock{
    parent : HeaderContent | null;
    level : number;

    constructor(parent : HeaderContent | null){
        this.parent = parent;
        if(this.parent == null){
            this.level = 0;
        }
        else{
            this.level = this.parent.level + 1;
            this.parent.addChild(this);
        }
    }

    abstract makeHTML(parent_element : HTMLElement) : void;
}

class HeaderContent extends ContentBlock {
    title : string;
    childContents : ContentBlock[] = [];

    constructor(parent : HeaderContent | null, title : string){
        super(parent);
        this.title = title;
    }

    addChild(child : ContentBlock){
        this.childContents.push(child);
    }

    makeHTML(parent_element : HTMLElement) : void {
        const details = document.createElement("details");
        details.style.marginLeft = `${this.level * 10}px`;

        const has_text_contents = this.childContents.length != 0 && this.childContents.some(x => x instanceof MathContent || x instanceof TextContent);

        const summary = document.createElement("summary");
        const text = this.title + (has_text_contents ? "+" : "")
        let span : HTMLSpanElement | undefined;
        if(this.title.startsWith("$") || this.title.includes(" $")){
            span = document.createElement("span");            
            span.textContent = text;
            summary.append(span);
        }
        else{
            summary.textContent = text;
        }
        
        const div     = document.createElement("div");

        details.appendChild(summary);
        details.appendChild(div);

        parent_element.appendChild(details);

        if(span != undefined){
            renderTex(span, this.title);
        }

        for(const child of this.childContents){
            child.makeHTML(div);
        }

        details.open = ! has_text_contents;
    }
}

class MathContent extends ContentBlock {
    terms : Term[] = [];

    addTerm(term : Term){
        this.terms.push(term);
    }

    readMathLine(line : string){
        try{
            const root = parseMath(line);
            this.addTerm(root);
        }
        catch(e){
            if(e instanceof SyntaxError){
                msg(`syntax err:[${line}]`);
            }
            else{
                throw e;
            }
        }

    }

    makeHTML(parent_element : HTMLElement) : void {
        for(const term of this.terms){
            const tex_div = document.createElement("div");
            parent_element.appendChild(tex_div);
            renderKatexSub(tex_div, term.tex());
        }
    }
}

class TextContent extends ContentBlock {
    texts : string[];

    constructor(parent : HeaderContent | null, texts : string[]){
        super(parent);
        this.texts = texts.slice();
    }

    makeHTML(parent_element : HTMLElement) : void {
        for(const text of this.texts){
            const div = document.createElement("div");
            div.textContent = text;
            div.style.marginLeft = `${this.level * 10}px`;
            parent_element.appendChild(div);

            renderTex(div, text);
        }
    }
}

class LessonReader {
    lines : string[];
    lineIdx : number = 0;
    contents : HeaderContent[] = [];

    constructor(text : string){
        const root = new HeaderContent(null, "");
        this.contents.push(root);
        this.lines = text.split("\n").map(x => x.trim());
    }

    makeH(level : number, text : string){
        while(level < this.contents.length){
            this.contents.pop();
        }

        const header = new HeaderContent(last(this.contents), text);
        this.contents.push(header);
    }

    readTheorem(header : string){
        const title = header.substring("@theorem".length).trim();

        const tex = new MathContent(last(this.contents));
        for(const line of this.readNonEmptyLines()){
            if(line == "@end"){
                break;
            }
            else{
                tex.readMathLine(line);
            }
        }

    }

    readLet(){
        throw new Error();
    }

    readDefinition(){
        const tex = new MathContent(last(this.contents));
        for(const line of this.readNonEmptyLines()){
            if(line == "@end"){
                break;
            }
            tex.readMathLine(line);
        }
    }

    readIf(){
        const tex = new MathContent(last(this.contents));
        // msg("start if");
        for(const line of this.readNonEmptyLines()){
            switch(line){
            case "@theorem":
            case "@lemma":
            case "@corollary":
                break;
            }
            if(line.startsWith("@then")){
                // msg("start then");

            }
            else if(line.startsWith("@end")){
                // msg("end if");

                break;
            }
            else{
                // msg(`parse:[${line}]`);
                tex.readMathLine(line);
            }
        }
    }

    *readLine(){
        while(this.lineIdx < this.lines.length){
            const line = this.lines[this.lineIdx++];
            yield line;
        }
    }

    *readNonEmptyLines(){
        while(this.lineIdx < this.lines.length){
            const line = this.lines[this.lineIdx++];
            if(line != ""){
                yield line;
            }
        }
    }

    makeParagraph(texts : string[]){
        if(texts.length != 0){
            new TextContent(last(this.contents), texts);
            texts.length = 0;
        }
    }

    readLesson(){
        let texts : string[] = [];
        for(const line of this.readLine()){
            if(line == ""){
                this.makeParagraph(texts);
            }
            else if(line[0] == "#"){
                this.makeParagraph(texts);

                const k = line.indexOf(" ");
                if(k != -1 && "#".repeat(k) == line.substring(0, k)){
                    this.makeH(k, line.substring(k + 1).trim());
                }
            }
            else if(line[0] == "@"){
                this.makeParagraph(texts);

                if(line == "@definition"){
                    this.readDefinition();
                }
                else if(line.startsWith("@let")){
                    this.readLet();
                }
                else if(line.startsWith("@if")){
                    this.readIf();
                }
                else if(["@theorem", "@corollary"].some(x => line.startsWith(x))){
                    this.readTheorem(line);
                }
                else{
                    throw new MyError();
                }
            }
            else{
                texts.push(line);
            }
        }

        this.makeParagraph(texts);
    }


}
  
export async function bodyOnLoad(){
    console.log("hello world");
    const [ origin, pathname, params, ] = parseURL();
    msg(`[${origin}][${pathname}]`);
    const text = await(fetchText(`lib/lesson/lesson.txt?ver=${Math.random()}`));

    const lesson = new LessonReader(text);
    lesson.readLesson();

    const div = $div("lessons-div");
    div.innerHTML = "";
    lesson.contents[0].makeHTML(div);
}
