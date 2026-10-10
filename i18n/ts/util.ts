import { latinLetters } from "./reading.js";

export enum PlayMode {
    stop,
    normal,
    fastForward,
}

let thePlayMode : PlayMode  = PlayMode.stop;

const $dic = new Map<string, HTMLElement>();

export function setPlayMode(play_mode : PlayMode){
    thePlayMode = play_mode;
}

export function getPlayMode(){
    return thePlayMode;
}

export function $(id : string) : HTMLElement {
    let ele = $dic.get(id);
    if(ele == undefined){
        ele = document.getElementById(id)!;
        $dic.set(id, ele);
    }

    return ele;
}

export function $div(id : string) : HTMLDivElement {
    return $(id) as HTMLDivElement;
}

export function $dlg(id : string) : HTMLDialogElement {
    return $(id) as HTMLDialogElement;
}

export function $inp(id : string) : HTMLInputElement {
    return $(id) as HTMLInputElement;
}

export function $sel(id : string) : HTMLSelectElement {
    return $(id) as HTMLSelectElement;
}
        
export class MyError extends Error {
    static visited : boolean = false;
    constructor(text : string = ""){
        super(text);
        if(! MyError.visited){
            MyError.visited = true;
            if(text != ""){
                alert(`${text}\n\n${this.stack}`);
            }
            else{
                alert(this.stack);
            }
        }
    }
}

export function assert(b : boolean, msg : string = ""){
    if(!b){
        throw new MyError(msg);
    }
}    

export function check(b : boolean, msg : string = ""){
    if(!b){
        throw new MyError(msg);
    }
}    

export function msg(txt : string){
    console.log(txt);
}

export async function sleep(milliseconds : number, fast_sleep : number = 1) : Promise<void> {
    if(thePlayMode == PlayMode.fastForward){
        assert(fast_sleep == 1);
        milliseconds = fast_sleep;
    }
    if(1 < milliseconds){
        // msg(`sleep:[${milliseconds}]`);
    }

    return new Promise((resolve) => {
        setTimeout(()=>{
            resolve();
        }, milliseconds);
    });
}

export function range(n: number) : number[]{
    return [...Array(n).keys()];
}

export function range2(start: number, end : number) : number[]{
    return range(end - start).map(x => start + x);
}

export function last<T>(v : Array<T>) : T {
    assert(v.length != 0);
    return v[v.length - 1];
}


export function arrayFill<T>(size : number, value : T) : T[] {
    return new Array<T>(size).fill(value);
}

export function unique<T>(v : Array<T>) : T[] {
    let set = new Set<T>();
    const ret : T[] = [];
    for(const x of v){
        if(!set.has(x)){
            set.add(x);
            ret.push(x);
        }
    }
    return ret;
}

export function remove<T>(v : Array<T>, x : T, existence_check : boolean = true){
    const idx = v.indexOf(x);
    if(idx == -1){
        if(existence_check){
            throw new MyError();
        }
    }
    else{
        v.splice(idx, 1);
    }
}

export function replace<T>(v : Array<T>, old_element : T, new_element : T){
    const idx = v.indexOf(old_element);
    if(idx == -1){
        throw new MyError();
    }

    v[idx] = new_element;
}

export function append<T>(v : Array<T>, x : T){
    if(! v.includes(x)){
        v.push(x);
    }
}

export function sum(v : number[]) : number {
    assert(v != undefined);
    if(v.length == 0){
        return 0;
    }
    
    return v.reduce((acc, cur) => acc + cur, 0);
}

export function list<T>(set : Set<T> | undefined) : T[] {
    if(set == undefined){
        return [];
    }
    else{

        return Array.from(set);
    }
}

export function* zip<T, U>(arr1: T[], arr2: U[]): Generator<[number, T, U]> {
    const length = Math.min(arr1.length, arr2.length);
    for (let i = 0; i < length; i++) {
        yield [i, arr1[i], arr2[i]];
    }
}

/**
 * min以上 max以下の整数の乱数を返す
 */
export function getRandomInt(min: number, max: number): number {
    // Math.random() は 0以上 1未満 の小数
    // それに (範囲の個数) を掛けて、最小値を足す
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 例：1から6（サイコロ）
const dice = getRandomInt(1, 6);

export function shuffle<T>(array: T[]): T[] {
    // 元の配列を壊さないようにコピーを作成
    const result = [...array];

    for (let i = result.length - 1; i > 0; i--) {
        // 0 から i までの範囲でランダムなインデックスを選ぶ
        const j = Math.floor(Math.random() * (i + 1));

        // 要素を入れ替える（分割代入を使用）
        [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
}

export function intersection<T>(set1 : Set<T> | undefined, set2 : Set<T> | undefined) : T[] {
    if(set1 == undefined || set2 == undefined){
        return [];
    }

    return Array.from(set1.values()).filter(x => set2.has(x));
}

export function permutation<T>(v : T[]) : T[][] {
    if(v.length == 2){
        return [ [v[0], v[1]], [v[1], v[0]] ];
    }

    const vv : T[][] = [];
    for(const i of range(v.length)){
        const v1 = v.slice();
        const c = v1[i];
        v1.splice(i,  1);

        const vv1 = permutation(v1);
        for(const v2 of vv1){

            v2.unshift(c);
            vv.push(v2);
        }
    }

    return vv;
}

export function circularPermutation<T>(v : T[]) : T[][] {
    const vv = permutation(v.slice(1));
    vv.forEach(x => x.unshift(v[0]));

    return vv;
}

export function areSetsEqual<T>(A: T[], B: T[]): boolean {
    const setA = new Set<T>(A);
    const setB = new Set<T>(B);

    // Check if sizes are different
    if (setA.size !== setB.size) {
        return false;
    }

    // Check if all elements of setA are present in setB
    for (const element of setA) {
        if (!setB.has(element)) {
            return false;
        }
    }

    return true;
}

export function isSubSet<T>(A: T[], B: T[]): boolean {
    const setB = new Set<T>(B);

    return A.every(x => setB.has(x));
}

export function isIdentifierLetter(c : string) : boolean {
    return latinLetters.indexOf(c) != -1 || c == "_";
}

export async function fetchText(fileURL: string) {
    const response = await fetch(fileURL);
    const text = await response!.text();

    return text;
}

export async function fetchTextResponse(fileURL: string) : Promise<string | Response> {
    const response = await fetch(fileURL);
    if(response.ok){
        const text = await response!.text();

        return text;
    }
    else{
        return response;
    }
}

export async function fetchJson(url : string) {
    const resp = await fetchTextResponse(url);
    if(resp instanceof Response){
        msg(`fetch json error:${resp.statusText}`);
        throw new MyError();
    }
    else{
        const obj  = JSON.parse(resp);
        return obj;
    }
}


export function parseURL(): [string, string, Map<string, string>, string] {
    const url = document.location.href;
    const parser = new URL(url);
    // console.log(`href:${url} origin:${parser.origin} pathname:${parser.pathname} search:${parser.search}`)
    assert(parser.origin + parser.pathname + parser.search == url);

    const k = parser.pathname.lastIndexOf("/");
    assert(k != -1);
    const url_base = parser.origin + parser.pathname.substring(0, k);
    msg(`url-base: ${url_base}`)

    const queryString = parser.search.substring(1);
    const queries = queryString.split("&");

    const params = new Map<string, string>();
    queries.forEach(query => {
        const [key, value] = query.split("=");
        params.set(decodeURIComponent(key), decodeURIComponent(value));
    });
    
    return [ parser.origin, parser.pathname, params, url_base];
}

export function downloadJson(name : string, data : any){
    // Convert the object to a JSON string
    const jsonData = JSON.stringify(data, null, 2); // The last two arguments are for formatting (indentation)

    // Create a Blob from the JSON string
    const blob = new Blob([jsonData], { type: "application/json" });

    // Create an anchor element
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${name}.json`; // Set the filename

    // Append the link to the body (it must be in the document to be clickable)
    document.body.appendChild(link);

    // Programmatically click the link to trigger the download
    link.click();

    // Clean up: remove the link and revoke the object URL
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}
