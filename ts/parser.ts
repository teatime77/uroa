import { TokenType, isLetter, isLetterOrAt, Token, lexicalAnalysis, TokenSubType } from "./lex.js";
import { assert, MyError, msg, range, $ } from "./parser_util.js";

export let isProof : boolean = false;
export let termDic : { [id : number] : Term } = {};

export const pathSep = ":";
export let variables : Variable[] = [];
let attachFactor : boolean = true;

export function setIsProof(is_proof : boolean) : void {
    isProof = is_proof;
    if(isProof){
        attachFactor = false;
    }
}

export function isShapeName(name : string) : boolean {
    const names = [
        "Point", "Circle", "Arc", "Triangle", 
        "LineByPoints", "HalfLine", "Line",
        "Intersection", "Foot", "Angle", "Parallel", "Thumb"
    ];
    return names.includes(name);
}

export function isSystemName(name : string) : boolean {
    const names = [
        "range",
        "sqrt",
        "length"
    ];
    return isShapeName(name) || names.includes(name);
}

export function isRelationToken(text : string){
    return [ "==", "=", "!=", "<", ">", "<=", ">=", "in", "notin", "subset" ].includes(text);
}

function isArithmeticToken(text : string){
    return ["cup", "cap"].includes(text);
}

export function getVariable(name : string) : Variable {
    const va = variables.find(x => x.name == name)!;
    assert(va != undefined);
    return va;
}
export function Zero() : ConstNum {
    return new ConstNum(0);
}


export function actionRef(name : string) : RefVar {
    return new RefVar(name);
}

export function parseMath(text: string) : Term {
    // msg(`parse-Math:[${text}]`);
    const parser = new Parser(text);
    const trm = parser.RootExpression();
    if(parser.token.typeTkn != TokenType.eot){
        throw new MyError();
    }

    trm.setParent(null);

    return trm;
}

export function parseMathDetachFactor(text: string) : Term {
    attachFactor = false;
    const trm = parseMath(text)
    attachFactor = true;

    return trm;
}

export function isGreek(text : string) : boolean {
    assert(typeof text == "string");
    if(text.length == 0){
        return false;
    }

    const greeks = [
        "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", 
        "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "varpi", "rho", "varrho", 
        "sigma", "varsigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega"
    ];

    if(greeks.includes(text)){
        return true;
    }

    const lower_case = text[0].toLowerCase() + text.substring(1);    
    if(greeks.includes(lower_case)){
        return true;
    }

    return false;
}

export function texName(text : string){
    switch(text){
    case "=="     : return "=";
    case "!="     : return "\\ne";
    case "<"      : return "\\lt";
    case ">"      : return "\\gt";
    case "<="     : return "\\le";
    case ">="     : return "\\ge";
    case "*"      : return "\\cdot";
    case "=>"     : return "\\implies";
    case "&&"     : return "\\land";
    case "||"     : return "\\lor";
    case "hbar"   : return "\\hbar";
    case "nabla"  : return "\\nabla";
    case "nabla2" : return "\\nabla^2";
    case "subset" : return "\\subseteq";
    case "infty"  : return "\\infty";
    case "cup":
    case "cap":
    case "sin":
    case "cos":
    case "tan":
    case "in"   :
    case "notin":
        return `\\${text}`;
    }

    if(isGreek(text)){
        return `\\${text}`;
    }

    return text;
}

let termId : number = 0;

export class Rational{
    numerator : number = 1;
    denominator : number = 1;
    parent : Term | null = null;

    constructor(numerator : number, denominator : number = 1){
        this.numerator = numerator;
        this.denominator = denominator;
    }

    eq(r : Rational) : boolean {
        return(this.numerator == r.numerator && this.denominator == r.denominator);
    }

    is(numerator : number, denominator : number = 1) : boolean{
        return(this.numerator == numerator && this.denominator == denominator);
    }

    set(numerator : number, denominator : number = 1){
        this.numerator   = numerator;
        this.denominator = denominator;
    }

    clone() : Rational {
        return new Rational(this.numerator, this.denominator);
    }

    toString() : string {
        if(this.denominator == 1){

            return `${this.numerator}`;
        }
        else{

            return `${this.numerator} / ${this.denominator}`;
        }
    }

    tex() : string {
        if(this.denominator == 1){

            return `${this.numerator}`;
        }
        else{

            return `\\frac{${this.numerator}}{${this.denominator}}`;
        }
    }

    addRational(r : Rational){
        const old_fval = this.fval();

        this.numerator = this.numerator * r.denominator + r.numerator * this.denominator;
        this.denominator *= r.denominator;

        assert(Math.abs(old_fval + r.fval() - this.fval()) < 0.00000001);
    }

    setmul(... rs : Rational[]){
        this.numerator   *= rs.reduce((acc, cur) => acc * cur.numerator,   1);
        this.denominator *= rs.reduce((acc, cur) => acc * cur.denominator, 1);
    }

    setdiv(r : Rational){
        this.numerator   *= r.denominator;
        this.denominator *= r.numerator;
    }

    fval() : number {
        return this.numerator / this.denominator;
    }

    abs() : number {
        return Math.abs(this.fval());
    }

    setAbs() {
        this.numerator   = Math.abs(this.numerator);
        this.denominator = Math.abs(this.denominator);
    }

    isInt() : boolean {
        return this.denominator == 1;
    }

    isDivisor(r : Rational) : boolean {
        const numerator   = r.numerator * this.denominator;
        const denominator = r.denominator * this.numerator;

        return numerator % denominator == 0;
    }

    int() : number {
        assert(this.denominator == 1);
        return this.numerator;
    }

    sign() : number {
        return Math.sign(this.fval());
    }

    changeSign(){
        this.numerator *= -1;
    }
}

export abstract class Term {
    static tabIdxCnt : number = 0;
    id : number;
    tabIdx : number = 0;
    parent : App | null = null;
    cloneFrom : Term | undefined;

    // 係数
    value : Rational = new Rational(1);

    canceled : boolean = false;
    colorName  : string | undefined;
    hash : bigint = 0n;
    hash2:string = "";

    constructor(){
        this.id = termId++;
        this.value.parent = this;
    }

    abstract tex2() : string;
    abstract clone() : Term;
    abstract strid() : string;

    uncolor(){
        this.colorName = undefined;
    }

    red(){
        this.colorName = "red";
    }

    blue(){
        this.colorName = "blue";
    }

    colored(){
        return this.colorName != undefined;
    }

    eq(trm : Term) : boolean {
        return this.str() == trm.str();
    }

    equal(trm : Term) : boolean {
        return this.value.eq(trm.value);
    }

    copy(dst : Term){
        dst.cloneFrom = this;
        dst.value  = this.value.clone();
        dst.value.parent = dst;

        dst.canceled = this.canceled;
        dst.colorName  = this.colorName;
    }


    changeSign(){
        this.value.changeSign();
    }

    /**
     * 
     * @returns コピーしたルートと、thisと同じ位置の項を返す。
     */
    cloneRoot() : [ App, Term] {
        // ルートからthisに至るパスを得る。
        const path = this.getPath();

        // ルートを得る。
        const root = this.getRoot();
        assert(path.getTerm(root) == this);

        // ルートをコピーする。
        const root_cp = root.clone();

        // コピーしたルートから同じパスを辿って項を得る。
        const this_cp = path.getTerm(root_cp);

        const [this_cp_str, this_str] = [this_cp.str(), this.str()];
        if(this_cp_str != this_str){
            msg(`clone-root:[${this_cp_str}][${this_str}]`);
            assert(false);
        }

        // コピーしたルートと、thisと同じ位置の項を返す。
        return [root_cp, this_cp];
    }

    getPath(path : Path = new Path([])) : Path {
        if(this.parent == null){

            return path;
        }
        let idx : number;
        if(this.parent.fnc == this){
            idx = -1;
        }
        else{

            idx = this.argIdx();
        }

        path.indexes.unshift(idx);
        return this.parent.getPath(path);
    }

    getRoot() : App {
        if(this.parent == null){
            if(this instanceof App){
                return this;
            }
            assert(false);
        }

        return this.parent!.getRoot();
    }

    getRootEqSideIdx() : number {
        for(let term : Term = this; term.parent != null; term = term.parent){
            if(term.parent.isRootEq()){
                return term.argIdx();
            }
        }

        throw new MyError();
    }

    getEqSide() : Term | null {
        for(let term : Term = this; term.parent != null; term = term.parent!){
            if(term.parent.isRootEq()){
                return term;
            }
        }

        return null;
    }

    setParent(parent : App | null){
        this.parent = parent;
        this.value.parent = this;
    }

    setTabIdx(){
        this.tabIdx = ++Term.tabIdxCnt;
    }

    verifyParent(parent : App | null){
        assert(this.parent == parent);
        assert(this.value.parent == this)
    }

    verifyParent2(){
        this.verifyParent(this.parent);
    }

    replaceTerm(target : Term){
        const app : App = this.parent!;
        assert(app != null, "replace");

        if(app.fnc == this){
            app.fnc = target;
        }
        else{
            const idx = app.args.findIndex(x => x == this);
            assert(idx != -1, "replace idx");
            app.args[idx] = target;
        }

        target.parent = app;
    }

    argIdx() : number {
        if(this.parent == null){
            throw new MyError();
        }

        const idx = this.parent.args.indexOf(this);
        assert(idx != -1, "arg idx");

        return idx;
    }

    argShift(diff : number){
        const idx = this.argIdx();
        const parent = this.parent as App;
        parent.args.splice(idx, 1);
        parent.args.splice(idx + diff, 0, this);
    }

    remArg() {
        if(this.parent == null){
            throw new MyError();
        }

        const idx = this.argIdx();
        this.parent.args.splice(idx, 1);

        if(this.parent.args.length == 1){
            // this.parent.oneArg();
        }
    }

    putValue(text : string, in_tex : boolean) : string {
        let val : string;

        if(this instanceof ConstNum){

            val = text;
        }
        else{

            assert(this.value instanceof Rational);
            if(this.value.fval() == 1){
                val = text;
            }
            else if(this.value.fval() == -1){
                if(this.isAdd()){

                    val = `- (${text})`;
                }
                else{

                    val = `- ${text}`;
                }
            }
            else if(this.value.denominator == 1){

                const opr = (in_tex ? "\\cdot" : "*");
                if(this.isAdd()){
                    val = `${this.value.numerator} ${opr} (${text})`
                }
                else{
                    val = `${this.value.numerator} ${opr} ${text}`
                }
            }
            else{
                throw new MyError();
            }
        }

        if(in_tex){

            if(this.colored()){
                return `{\\color{${this.colorName}} ${val}}`;
            }

            if(this.canceled){
                return `\\cancel{${val}}`
            }
        }

        return val;
    }

    str2() : string {
        assert(false, "str2");
        return "";
    }

    str() : string {
        const text = this.str2();
        return this.putValue(text, false);
    }

    toString() : string {
        return this.str();
    }


    htmldata(text : string) : string {
        termDic[this.id] = this;
        return `\\htmlData{id=${this.id}, tabidx=${this.tabIdx}}{${text}}`;
    }
    
    tex() : string {
        let text = this.tex2();

        if(this.colored()){

            text = `{\\color{${this.colorName}} ${this.putValue(text, true)}}`;
            // return this.htmldata(this.putValue(text, true));
        }
        else{

            text = this.putValue(text, true);
        }

        if(this instanceof ConstNum || this instanceof RefVar || this instanceof App){
            text = `\\htmlId{tex-term-${this.id}}{${text}}`;
        }

        return text;
    }

    isApp(fnc_name : string) : boolean {
        return this instanceof App && this.fncName == fnc_name;
    }

    isOperator() : boolean {
        return this instanceof App && this.precedence() != -1;
    }

    isNamedFnc() : boolean {
        return this instanceof RefVar && isLetter(this.name[0]);
    }

    isOprFnc() : boolean {
        return this instanceof RefVar && ! isLetter(this.name[0]);
    }

    isEq() : boolean {
        return this instanceof App && (this.fncName == "==" || this.fncName == "=");
    }

    isRootEq() : boolean {
        return this.isEq() && this.parent == null;
    }

    isList() : boolean {
        return this instanceof App && this.fncName == "[]";
    }

    isAdd() : boolean {
        return this instanceof App && this.fncName == "+";
    }

    isSub() : boolean {
        return this instanceof App && this.fncName == "-";
    }

    isMul() : boolean {
        return this instanceof App && this.fncName == "*";
    }

    isDiv() : boolean {
        return this instanceof App && this.fncName == "/";
    }

    isDot() : boolean {
        return this instanceof App && this.fncName == ".";
    }

    isSqrt() : boolean {
        return this instanceof App && this.fncName == "sqrt";
    }

    isZero() : boolean {
        return this.value.numerator == 0;
    }

    isValue(n : number) : boolean {
        return this instanceof ConstNum && this.value.fval() == n;
    }

    isOne() : boolean {
        return this.isValue(1);
    }

    isValueOne() : boolean {
        return this.value.is(1);
    }

    isInt() : boolean {
        return this instanceof ConstNum && this.value.isInt();
    }

    isE() : boolean {
        return this instanceof RefVar && this.name == "e";
    }

    isI() : boolean {
        return this instanceof RefVar && this.name == "i";
    }

    isDiff() : boolean {
        return this instanceof App && (this.fncName == "diff" || this.fncName == "pdiff");
    }

    isLim() : boolean {
        return this instanceof App && this.fncName == "lim";
    }

    leftSide() : Term {
        assert(this.isEq());
        return (this as unknown as App).args[0];
    }

    rightSide() : Term {
        assert(this.isEq());
        return (this as unknown as App).args[1];
    }

    dividend() : Term {
        assert(this.isDiv());
        return (this as any as App).args[0];
    }

    divisor() : Term {
        assert(this.isDiv());
        return (this as any as App).args[1];
    }

    int() : number {
        throw new MyError();
    }


    depend(dvar : RefVar) : boolean {
        return allTerms(this).some(x => dvar.eq(x));
    }

    calc() : number {
        if(this instanceof Rational){
            return this.fval();
        }
        else if(this instanceof ConstNum){
            return this.value.fval();
        }
        else if(this instanceof RefVar){
            const data = this.refVar!.expr;
            if(data instanceof Term){
                return data.calc();
            }
            else{
                throw new MyError("unimplemented");
            }
        }
        else if(this instanceof App){
            const app = this;
            if(app.isApp("sqrt")){
                assert(app.args.length == 1);
                return Math.sqrt(app.args[0].calc());
            }
            else{
                throw new MyError("unimplemented");
            }
        }
        throw new MyError("unimplemented");
    }

    copyValue(cns : ConstNum){
        assert(this instanceof ConstNum);
        this.value.set(cns.value.numerator, cns.value.denominator);
    }

    dmpTerm(nest : string){
        if(this instanceof App){

            msg(`${nest}${this.id}`);
            this.fnc.dmpTerm(nest + "\t");
            this.args.forEach(x => x.dmpTerm(nest + "\t"));
        }
        else{

            msg(`${nest}${this.id}:${this.str()}`);
        }
    }

    getAllTerms(terms : Term[]){
        terms.push(this);
        if(this instanceof App){
            this.fnc.getAllTerms(terms);
            this.args.forEach(x => x.getAllTerms(terms));
        }
    }

    includesTerm(term : Term) : boolean {
        if(this instanceof App){
            return this.allTerms().includes(term);
        }
        else{
            return this == term;
        }
    }
}

export class Path extends Term {
    indexes : number[] = [];

    constructor(indexes : number[]){
        super();
        this.indexes = indexes.slice();
    }

    equal(trm : Term) : boolean {
        return super.equal(trm) && trm instanceof Path && range(this.indexes.length).every(i => this.indexes[i] == trm.indexes[i]);
    }

    strid() : string{
        throw new MyError();
    }

    str() : string {
        return `#${this.indexes.join(pathSep)}`;
    }

    tex2() : string {
        assert(false, "path:tex2");
        return "";
    }

    clone() : Term {
        const path = new Path(this.indexes);
        this.copy(path);

        return path;
    }

    getTerm(root : App, get_parent : boolean = false) : Term {
        if(this.indexes.length == 0){
            return root;
        }
    
        let app = root;

        const last_i = (get_parent ? this.indexes.length - 2 : this.indexes.length - 1);

        for(const [i, idx] of this.indexes.entries()){
            if(i == last_i){
    
                return (idx == -1 ? app.fnc : app.args[idx]);
            }
            else{
                app = (idx == -1 ? app.fnc : app.args[idx]) as App;
                assert(app instanceof App, "pass:get term");
            }
        }
        throw new MyError("get term");
    }
}


export class Variable {
    name : string;
    type : Term | undefined;
    init : Term | undefined;
    expr : Term | undefined;

    constructor(name : string, type : Term | undefined, init : Term | undefined){
        variables.push(this);
        this.name = name;
        if(type != undefined){

            this.type = type.clone();
        }

        if(init != undefined){

            this.init = init.clone();
        }
    }

    clone() : Variable {
        const type = this.type != undefined ? this.type.clone() : undefined;
        const init = this.init != undefined ? this.init.clone() : undefined;

        const va = new Variable(this.name, type, init);
        va.expr = this.expr != undefined ? this.expr.clone() : undefined;
        
        return va;
    }

    toString() : string {
        let s = this.name;
        if(this.type != undefined){
            s += ` : ${this.type}`;
        }
        if(this.init != undefined){
            s += ` = ${this.init}`;
        }

        return s;
    }
}

export class RefVar extends Term{
    name: string;
    refVar! : Variable | undefined;

    constructor(name: string){
        super();
        this.name = name;
    }

    equal(trm : Term) : boolean {
        return super.equal(trm) && trm instanceof RefVar && this.name == trm.name;
    }

    strid() : string{
        if(this.value.is(1)){

            return `${this.name}`;
        }
        else{

            return `${this.value} ${this.name}`;
        }
    }

    clone() : RefVar {
        const ref = new RefVar(this.name);
        this.copy(ref);

        return ref;
    }

    str2() : string {
        return this.name;
    }

    tex2() : string {
        return texName(this.name);
    }
}


export class ConstNum extends Term{
    text : string;
    static zero() : ConstNum {
        return new ConstNum(0);
    }

    constructor(numerator : number, denominator : number = 1, text : string = ""){
        super();
        this.value = new Rational(numerator, denominator);
        this.text = text;
    }

    equal(trm : Term) : boolean {
        return super.equal(trm);
    }

    strid() : string{
        return `${this.value}`;
    }

    static fromRational(r : Rational) : ConstNum {
        return new ConstNum(r.numerator, r.denominator);
    }

    clone() : ConstNum {
        const cns = new ConstNum(this.value.numerator, this.value.denominator);
        this.copy(cns);

        return cns;
    }

    str() : string {
        return this.value.toString();        
    }

    tex2() : string {
        return this.value.tex();
    }

    isInt() : boolean {
        return this.value.isInt();
    }

    int() : number {
        return this.value.int();
    }
}


export class Str extends Term{
    text : string;

    constructor(text : string){
        super();
        this.text = text;
    }

    equal(trm : Term) : boolean {
        return trm instanceof Str && trm.text == this.text;
    }

    strid() : string{
        return `"${this.text}"`;
    }

    clone() : Str {
        return new Str(this.text);
    }

    str() : string {
        return this.strid();        
    }

    tex2() : string {
        return this.strid();
    }
}

export class App extends Term{
    fnc : Term;
    args: Term[];
    remParentheses : boolean = false;

    static startEnd : { [start : string] : string } = {
        "(" : ")",
        "[" : "]",
        "{" : "}",
    }

    get refVar() : RefVar | null {
        if(this.fnc != null && this.fnc instanceof RefVar){
            return this.fnc;
        }
        else{
            return null;
        }
    }

    get fncName() : string {
        if(this.fnc instanceof RefVar){
            return this.fnc.name;
        }
        else{
            return `no-fnc-name`;
        }
    }


    constructor(fnc: Term, args: Term[]){
        super();
        this.fnc    = fnc;
        this.fnc.parent = this;

        this.args   = args.slice();

        this.args.forEach(x => x.parent = this);
    }

    equal(trm : Term) : boolean {
        if(super.equal(trm) && trm instanceof App){
            if(this.fnc.equal(trm.fnc)){
                if(this.args.length == trm.args.length){
                    return range(this.args.length).every(i => this.args[i].equal(trm.args[i]));
                }
            }
        }

        return false;
    }


    strid() : string{
        let s : string;
        if(this.fnc.isOprFnc()){
            s = "(" + this.args.map(x => x.strid()).join(this.fncName) + ")";
        }
        else{
            s = `${this.fncName}(${this.args.map(x => x.strid()).join(", ")})`;

        }
        if(this.value.is(1)){

            return s;
        }
        else{

            return `${this.value} ${s}`;
        }
    }

    clone() : App {
        const app = new App(this.fnc.clone(), this.args.map(x => x.clone()));

        this.copy(app);

        return app;
    }

    setParent(parent : App | null){
        super.setParent(parent);

        this.fnc.setParent(this);

        this.args.forEach(x => x.setParent(this));
    }

    setTabIdx(){
        super.setTabIdx();
        this.fnc.setTabIdx();
        this.args.forEach(x => x.setTabIdx());
    }


    verifyParent(parent : App | null){
        super.verifyParent(parent);

        this.fnc.verifyParent(this);

        this.args.forEach(x => x.verifyParent(this));
    }

    str2() : string {
        const args = this.args.map(x => x.str());
        
        let text : string;
        if(this.fnc instanceof App){
            const args_s = args.join(", ");
            text = `(${this.fnc.str()})(${args_s})`;
        }
        else if(isLetterOrAt(this.fncName)){
            const args_s = args.join(", ");
            text = `${this.fncName}(${args_s})`;
        }
        else{
            if(this.fncName == "+"){
                text = "";
                for(const [i, arg] of this.args.entries()){
                    if(i == 0){
                        text = args[0];
                    }
                    else{

                        if(arg.value.fval() < 0){

                            text += ` ${args[i]}`;
                        }
                        else{

                            text += ` + ${args[i]}`;
                        }
                    }
                }
            }
            else{

                text = args.join(` ${this.fncName} `);
            }

        }

        if(this.isOperator() && this.parent != null && this.parent.isOperator()){
            if(this.parent.precedence() <= this.precedence()){
                return `(${text})`;
            }            
        }

        return text;
    }

    tex2() : string {
        const args = this.args.map(x => x.tex());

        let text : string;
        if(this.fnc instanceof App){

            const args_s = args.join(", ");
            text = `(${this.fnc.tex()})(${args_s})`;
        }
        else if(this.fncName == "lim"){
            switch(args.length){
            case 1:
                text = `\\lim ${args[0]}`;
                break;
            case 3:
                text = `\\lim_{${args[1]} \\to ${args[2]}} ${args[0]}`;
                break;
            default:
                throw new MyError();
            }
        }
        else if(this.fncName == "sum"){
            switch(args.length){
            case 1:
                text = `\\sum ${args[0]}`;
                break;
            case 3:
                text = `\\sum_{${args[1]}}^{${args[2]}} ${args[0]}`;
                break;
            case 4:
                text = `\\sum_{${args[1]}=${args[2]}}^{${args[3]}} ${args[0]}`;
                break;
            default:
                throw new MyError();
            }
        }
        else if(this.fncName == "log"){
            if(args.length == 1){
                text = `\\log ${args[0]}`;
            }
            else if(args.length == 2){
                text = `\\log_{${args[1]}} ${args[0]}`;
            }
            else{
                throw new MyError();
            }
        }
        else if(this.fncName == "{|}"){
            text = `\\{${args[0]} \\mid ${args[1]} \\}`;
        }
        else if(this.fncName == "in"){
            let ids : string;
            if(this.args[0].isApp(",")){

                ids = (this.args[0] as App).args.map(x => x.tex()).join(" , ");
            }
            else{
                ids = args[0];
            }
            text = `${ids} \\in ${args[1]}`;
        }
        else if(this.fncName == "complement"){
            text = `{ ${args[0]} }^c`;
        }
        else if(this.isDiff()){
            const n = (this.args.length == 3 ? `^{${args[2]}}`:``);

            const d = (this.fncName == "diff" ? "d" : "\\partial");

            if(this.args.length == 1){
                text = `(${args[0]})'`;
            }
            else if(args[0].indexOf("\\frac") == -1){

                text = `\\frac{ ${d} ${n} ${args[0]}}{ ${d}  ${args[1]}${n}}`;
            }
            else{

                text = `\\frac{ ${d} ${n} }{ ${d}  ${args[1]}${n}} (${args[0]})`;
            }
        }
        else if(isLetterOrAt(this.fncName)){
            if(["sin", "cos", "tan"].includes(this.fncName) && ! (this.args[0] instanceof App)){

                text = `${texName(this.fncName)} ${args[0]}`;
            }
            else if(this.fncName == "abs"){
                assert(args.length == 1, "tex2");
                text = `\\lvert ${args[0]} \\rvert`;
            }
            else if(this.fncName == "sqrt"){
                assert(args.length == 1, "tex2");
                text = `\\sqrt{${args[0]}}`;
            }
            else if(this.fncName == "nth_root"){
                assert(args.length == 2, "tex2");
                text = `\\sqrt[${args[1]}]{${args[0]}}`;
            }
            else if(isArithmeticToken(this.fncName) ){
                text = `${args[0]} ${texName(this.fncName)} ${args[1]}`;
            }

            else if(isRelationToken(this.fncName) || isArithmeticToken(this.fncName) ){
                text = `${args[0]} ${texName(this.fncName)} ${args[1]}`;
            }
            else{

                const args_s = args.join(", ");
                text = `${texName(this.fncName)}(${args_s})`;
            }
        }
        else{

            switch(this.fncName){
            case "+":
                switch(args.length){
                case 0: return " +[] ";
                case 1: return ` +[${args[0]}] `;
                }
                text = args.join(` `);
                break

            case "/":
                if(this.args.length != 2){
                    throw new MyError();
                }
                text = `\\frac{${args[0]}}{${args[1]}}`;
                break

            case "^":
                if(this.args[0] instanceof App && ["sin","cos","tan"].includes(this.args[0].fncName)){

                    const app = this.args[0];
                    text = `${texName(app.fncName)}^{${args[1]}} ${app.args[0].tex()}`;
                }
                else{

                    text = `${args[0]}^{${args[1]}}`;
                }
                break

            default:
                if(args.length == 1){
                    text = `${texName(this.fncName)} ${args[0]}`;
                }
                else{
                    text = args.join(` ${texName(this.fncName)} `);
                }
                break
            }
        }

        if(this.parent != null){

            if(this.remParentheses){
                return `\\textbf{ {\\color{red} (} } ${text} \\textbf{ {\\color{red} )} }`;
            }
            else if((this.isAdd() || this.isMul()) && this.parent.fncName == "lim"){

                return `(${text})`;
            }
            else if(this.isOperator() && this.parent.isOperator() && !this.parent.isDiv()){
                if(this.parent.fncName == "^" && this.parent.args[1] == this){
                    return text;
                }

                if(this.parent.precedence() <= this.precedence()){
                    return `(${text})`;
                }            
            }

        }

        return text;
    }

    precedence() : number {
        switch(this.fncName){
        case "^": 
            return 0;

        case "/": 
            return 1;

        case "*": 
            return 2;

        case "+": 
        case "-": 
            return 3;

        case "..":
            return 4;
        }

        return -1;
    }

    getArg(idx : number){
        assert(0 <= idx && idx < this.args.length);
        return this.args[idx];
    }

    setArg(trm : Term, idx : number){
        this.args[idx] = trm;
        trm.parent = this;
    }
    
    addArg(trm : Term){
        this.args.push(trm);
        trm.parent = this;
    }

    addArgs(trms : Term[]){
        this.args.push(... trms);
        trms.forEach(x => x.parent = this);
    }

    insArg(trm : Term, idx : number){
        this.args.splice(idx, 0, trm);
        trm.parent = this;
    }

    insArgs(args : Term[], idx : number){
        assert(idx != -1, "ins parent mul 1");

        const args_cp = args.slice();
        while(args_cp.length != 0){
            const trm = args_cp.pop()!;
            this.insArg(trm, idx);
        }
    }

    /**
     * 
     * @description 引数が1個だけの加算や乗算を、唯一の引数で置き換える。
     */
    oneArg() {
        assert(this.args.length == 1, "one arg");

        // 唯一の引数
        const arg1 = this.args[0];

        // 加算や乗算を唯一の引数で置き換える。
        this.replaceTerm(arg1);

        // 唯一の引数の係数に、加算や乗算の係数をかける。
        arg1.value.setmul(this.value);
    }

    allTerms() : Term[] {
        const terms : Term[] = [];
        this.getAllTerms(terms);

        return terms;
    }

    clearHighlight(){
        const all_terms = this.allTerms();
        for(const term of all_terms){
            term.canceled = false;
            term.colorName = undefined;
        }
    }

    findTermById(id : number) : Term | undefined {
        return this.allTerms().find(x => x.id == id);
    }
}

export class Binding extends App {
    vars : Variable[] = [];

    constructor(fnc: Term, args: Term[], vars : Variable[]){
        super(fnc, args);
        this.vars = vars.slice();
    }

    tex2() : string {
        throw new MyError();
    }

    clone() : Binding {
        const bnd = new Binding(this.fnc.clone(), this.args.map(x => x.clone()), this.vars.map(x => x.clone()));

        this.copy(bnd);

        return bnd;
    }

    strid() : string {
        const strid = super.strid();
        const vars = this.vars.map(x => `${x}`).join(", ");

        return `[${vars}:${strid}]`;
    }
}

export class Parser {
    tokens: Token[];
    tokens_cp: Token[];
    token!: Token;

    constructor(text: string){
        this.tokens = lexicalAnalysis(text);
        if(this.tokens.length == 0){
            
        }
        this.tokens_cp = this.tokens.slice();

        this.next();
    }

    next(){
        if(this.tokens.length == 0){

            this.token = new Token(TokenType.eot, TokenSubType.unknown, "", 0);
        }
        else{

            this.token = this.tokens.shift()!;
        }
    }

    showError(text : string){
        const i = this.tokens_cp.length - this.tokens.length;
        const words = this.tokens_cp.map(x => x.text);

        words.splice(i, 0, `<<${text}>>`);
        msg(`token err:${words.join(" ")}`);
    }

    nextToken(text : string){
        if(this.token.text != text){
            this.showError(text);
            throw new MyError();
        }

        this.next();
    }

    current(){
        return this.token.text;
    }

    peek() : Token | null {
        return this.tokens.length == 0 ? null : this.tokens[0];
    }

    readList(terms:Term[]) : void {
        while(true){
            const trm = this.LogicalExpression();
            terms.push(trm);

            if(this.token.text == ","){
                this.nextToken(",");
            }
            else{
                break;
            }
        }
    }

    readArgs(start: string, end : string, app : App){
        this.nextToken(start);

        this.readList(app.args);
        app.args.forEach(x => x.parent = app);

        this.nextToken(end);
    }

    PrimaryExpression() : Term {
        let trm : Term;

        if(this.token.typeTkn == TokenType.identifier){
            let refVar = new RefVar(this.token.text);
            this.next();

            if(this.token.text == '('){

                if(["limit", "diff", "integrate"].includes(refVar.name) ){
                    this.nextToken("(");

                    const terms : Term[] = [];
                    this.readList(terms);

                    this.nextToken(")");

                    let bnd : Binding;
                    if(refVar.name == "limit"){
                        assert(terms.length == 3 && terms[1] instanceof RefVar);
                        const va = new Variable((terms[1] as RefVar).name, undefined, undefined);
                        terms.splice(1, 1);
                        bnd = new Binding(refVar, terms, [va]);
                    }
                    else if(refVar.name == "diff"){
                        assert(terms.length == 2 && terms[1] instanceof RefVar);
                        const va = new Variable((terms[1] as RefVar).name, undefined, undefined);
                        terms.splice(1, 1);
                        bnd = new Binding(refVar, terms, [va]);
                        
                    }
                    else if(refVar.name == "integrate"){
                        assert(terms.length == 4 && terms[1] instanceof RefVar);
                        const va = new Variable((terms[1] as RefVar).name, undefined, undefined);
                        terms.splice(1, 1);
                        bnd = new Binding(refVar, terms, [va]);                        
                    }
                    else{
                        throw new MyError();
                    }

                    return bnd;
                }
                else{

                    let app = new App(refVar, []);
                    this.readArgs("(", ")", app);

                    return app;
                }
            }
            else if(this.token.text == '['){

                let list = this.readBracketList();
                let app = new App(refVar, [list]);

                return app;
            }
            else if(this.token.text == "."){
                let app = new App(operator("."), [refVar]);

                do {
                    this.nextToken(".");

                    if(this.token.typeTkn == TokenType.identifier){
                    }
                    else if(isProof && this.token.typeTkn == TokenType.Number && this.token.subType == TokenSubType.integer){
                    }
                    else{
                        throw new MyError();
                    }

                    app.addArg(new RefVar(this.token.text));

                    this.next();
                
                } while(this.token.text == ".");

                return app;
            }
            else{

                return refVar;
            }
        }
        else if(this.token.typeTkn == TokenType.Number){
            let n = parseFloat(this.token.text);
            if(isNaN(n)){
                throw new MyError();
            }

            trm = new ConstNum(n, 1, this.token.text);
            this.next();
        }
        else if(this.token.typeTkn == TokenType.String){
            trm = new Str(this.token.text);
            this.next();
        }
        else if(this.token.typeTkn == TokenType.path){
            assert(this.token.text[0] == "#", "parse path");
            if(this.token.text == "#"){

                trm = new Path([]);
            }
            else{

                const indexes = this.token.text.substring(1).split(pathSep).map(x => parseFloat(x));
                trm = new Path(indexes);
            }

            this.next();
        }
        else if(this.token.text == '('){

            this.next();
            trm = this.RelationalExpression();

            if(this.current() != ')'){
                throw new MyError();
            }
            this.next();

            if(this.token.text == '('){

                let app = new App(trm, []);
                this.readArgs("(", ")", app);

                return app;
            }

            return trm;
        }
        else if(this.token.text == '{'){

            this.next();
            const element = this.RelationalExpression();

            this.nextToken('|');

            const logic = this.LogicalExpression();

            this.nextToken('}');

            trm = new App(operator("{|}"), [element, logic]);
            return trm;
        }
        else{
            throw new MyError();
        }

        return trm;
    }

    PowerExpression() : Term {
        const trm1 = this.PrimaryExpression();
        if(this.token.text == "^"){

            this.nextToken("^");

            const trm2 = this.PowerExpression();

            return new App(operator("^"), [trm1, trm2]);
        }

        return trm1;
    }

    UnaryExpression() : Term {
        if (this.token.text == "-") {
            // 負号の場合

            this.nextToken("-");

            // 基本の式を読みます。
            const t1 = this.PowerExpression();

            // 符号を反転します。
            t1.value.numerator *= -1;

            return t1;
        }
        else {

            // 基本の式を読みます。
            return this.PowerExpression();
        }
    }

    
    DivExpression() : Term {
        let trm1 = this.UnaryExpression();
        while(this.token.text == "/" || this.token.text == "%"){
            let app = new App(operator(this.token.text), [trm1]);
            this.next();

            while(true){
                let trm2 = this.UnaryExpression();
                app.addArg(trm2);
                
                if(this.token.text == app.fncName){
                    this.next();
                }
                else{
                    trm1 = app;
                    break;
                }
            }
        }
    
        return trm1;
    }

    
    MultiplicativeExpression() : Term {
        let trm1 = this.DivExpression();
        if(this.current() != "*"){
            return trm1;
        }

        while(this.current() == "*"){
            let app = new App(operator(this.token.text), [trm1]);
            this.next();

            while(true){
                let trm2 = this.DivExpression();
                app.addArg(trm2);
                
                if(this.token.text == app.fncName){
                    this.next();
                }
                else{
                    trm1 = app;
                    break;
                }
            }
        }

        if(attachFactor && trm1 instanceof App && trm1.args[0] instanceof ConstNum && !(trm1.args[1] instanceof ConstNum)){
            const num = trm1.args[0];
            trm1.value.setmul(num.value);
            num.remArg();
            return trm1;
        }
    
        return trm1;
    }
    
    AdditiveExpression() : Term {
        let nagative : boolean = false;
        if(this.token.text == "-"){
            nagative = true;
            this.next();
        }

        const trm1 = this.MultiplicativeExpression();
        if(nagative){
            trm1.value.numerator *= -1;
        }

        if(this.token.text == "+" || this.token.text == "-"){
            let app = new App(operator("+"), [trm1]);

            while(this.token.text == "+" || this.token.text == "-"){
                const opr = this.token.text;
                this.next();

                const trm2 = this.MultiplicativeExpression();
                if(opr == "-"){
                    trm2.value.numerator *= -1;
                }

                app.addArg(trm2);
            }

            return app;
        }

        return trm1;
    }

    IntervalExpression() : Term {
        const trm1 = this.AdditiveExpression();
        if(this.token.text == ".."){

            this.nextToken("..");

            const trm2 = this.AdditiveExpression();

            return new App(operator(".."), [trm1, trm2]);
        }

        return trm1;
    }

    ArithmeticExpression() : Term {
        const trm1 = this.IntervalExpression();

        if(! isArithmeticToken(this.current())){
            return trm1;
        }

        const app = new App(operator(this.current()), [trm1]);
        while( isArithmeticToken(this.current()) ){
            this.next();

            const trm2 = this.IntervalExpression();
            app.addArg(trm2);
        }

        return app;
    }

    readIds() : RefVar[]{
        const ref_vars : RefVar[] = [];

        while(true){
            const id = this.token;
            assert(id.typeTkn == TokenType.identifier);

            this.next();

            ref_vars.push(new RefVar(id.text));

            if(this.token.text == ","){
                this.nextToken(",");
            }
            else{
                break;
            }
        }

        return ref_vars;
    }

    VariableDeclaration() : App {
        const ref_vars = this.readIds();
        
        const id_list = new App(operator(","), ref_vars);

        this.nextToken("in");

        const set = this.ArithmeticExpression();

        return new App(operator("in"), [id_list, set]);
    }

    readBracketList() : App {
        const ref = new RefVar("[]");
        const app = new App(ref, []);
        this.readArgs("[", "]", app as App);

        return app;
    }

    RelationalExpression(in_and : boolean = false) : Term {
        const next_token = this.peek();
        if(! isProof){

            if(in_and && this.token.typeTkn == TokenType.identifier && next_token != null && next_token.text == ","){
                return this.VariableDeclaration();
            }
        }

        let trm1 : Term;
        if(this.token.text == "["){
            trm1 = this.readBracketList();
        }
        else{

            trm1 = this.ArithmeticExpression();
        }

        while(isRelationToken(this.token.text)){
            let app = new App(operator(this.token.text), [trm1]);
            this.next();

            while(true){
                let trm2 = this.ArithmeticExpression();
                app.addArg(trm2);
                
                if(this.token.text == app.fncName){
                    this.next();
                }
                else{
                    trm1 = app;
                    break;
                }
            }
        }

        return trm1;
    }

    AndExpression() : Term {
        const trm1 = this.RelationalExpression(true);

        if(! [";", "&&"].includes(this.token.text)){

            return trm1;
        }

        const app = new App(operator("&&"), [trm1]);

        while( [";", "&&"].includes(this.token.text) ){
            this.next();

            const trm2 = this.RelationalExpression(true);
            app.addArg(trm2);
        }

        return app;
    }

    OrExpression() : Term {
        const trm1 = this.AndExpression();

        if(this.current() != "||"){

            return trm1;
        }

        const app = new App(operator("||"), [trm1]);

        while( this.current() == "||" ){
            this.next();

            const trm2 = this.AndExpression();
            app.addArg(trm2);
        }

        return app;
    }

    LogicalExpression(){
        const trm1 = this.OrExpression();

        if([ "=>", "⇔", "→" ].includes(this.token.text)){
            const opr = this.token.text;

            this.next();

            let trm2 = this.OrExpression();
            return new App(operator(opr), [trm1, trm2]);    
        }
        else{
            
            return trm1;
        }
    }

    RootExpression(){
        if(this.token.text == "let"){
            this.next();

            const app = this.VariableDeclaration();
            if(this.token.text as any != ","){
                return app;
            }

            const and = new App(operator("&&"), [app]);
            while(this.token.text as any == ","){
                this.next();

                const app2 = this.VariableDeclaration();
                and.addArg(app2);
            }

            return and;
        }
        else if(isRelationToken(this.token.text)){
            let app = new App(operator(this.token.text), []);
            this.next();

            let trm = this.ArithmeticExpression();
            app.addArg(trm);

            return app;
        }
        else{
    
            return this.LogicalExpression();
        }
    
    }
}

export function operator(opr : string) : RefVar {
    return new RefVar(opr);
}

export function getAllTerms(t : Term, terms: Term[]){
    terms.push(t);

    if(t instanceof App){
        assert(t.fnc != null, "get all terms");
        getAllTerms(t.fnc, terms);

        t.args.forEach(x => getAllTerms(x, terms));
    }
}

export function makeIdToTermMap(root : Term) : Map<number, Term>{
    const terms = allTerms(root);

    return new Map<number,Term>(terms.map(x => [x.id, x]));
}

export function getSubTerms(root : Term, target : Term) : Term[]{
    const terms : Term[] = [];
    getAllTerms(root, terms);

    const target_str = target.str2();
    return terms.filter(x => x.str2() == target_str );
}

export function allTerms(trm : Term) : Term[] {
    const terms : Term[] = [];
    getAllTerms(trm, terms);

    return terms;
}

export function bodyOnLoad(){
    const texts = ($("sample") as HTMLTextAreaElement).value.replace("\r\n", "\n").split("\n").map(x => x.trim()).filter(x => x != "");
    for(const text of texts){
        msg(text);
        parseMath(text);
    }
}
