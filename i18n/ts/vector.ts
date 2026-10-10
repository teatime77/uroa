import { assert } from "./util";

export class Vec2 {
    static nan() : Vec2 {
        return new Vec2(NaN, NaN);
    }

    static zero() : Vec2 {
        return new Vec2(0, 0);
    }

    static fromXY(x : number, y : number) : Vec2 {
        return new Vec2(x, y);
    }

    typeName: string = "Vec2";
    x: number;
    y: number;

    constructor(x:number, y: number){
        this.x = x;
        this.y = y;
    }

    getProperties(){
        return [ "x", "y" ];
    }

    toString() : string {
        return `(${this.x.toFixed(1)}, ${this.y.toFixed(1)})`;
    }

/*+++
    app() : App {
        return new App(operator("vec"), [new ConstNum(this.x), new ConstNum(this.y)]);
    }
*/

    copy(){
        return new Vec2(this.x, this.y);
    }

    copyFrom(pt : Vec2) : void {
        this.x = pt.x;
        this.y = pt.y;
    }

    setXY(x : number, y : number){
        this.x = x;
        this.y = y;
    }

    isNaN() : boolean {
        return isNaN(this.x) || isNaN(this.y);
    }

    equals(pt: Vec2): boolean {
        return this.x == pt.x && this.y == pt.y;
    }

    add(pt: Vec2) : Vec2{
        return new Vec2(this.x + pt.x, this.y + pt.y);
    }

    sub(pt: Vec2) : Vec2{
        return new Vec2(this.x - pt.x, this.y - pt.y);
    }

    mul(cx: number, cy : number | undefined = undefined) : Vec2 {
        if(cy == undefined){
            cy = cx;
        }

        return new Vec2(cx * this.x, cy * this.y);
    }

    len2(): number {
        return this.x * this.x + this.y * this.y;
    }

    len(): number {
        return Math.hypot(this.x, this.y);
    }

    distance(pt:Vec2) : number {
        return Math.hypot( pt.x - this.x, pt.y - this.y );
    }

    dot(pt:Vec2) : number{
        return this.x * pt.x + this.y * pt.y;
    }

    unit() : Vec2{
        const d = this.len();

        if(d == 0){

            return new Vec2(0, 0);
        }

        return new Vec2(this.x / d, this.y / d);
    }

    divide(t: number, pt: Vec2) : Vec2 {
        const x = (1 - t) * this.x + t * pt.x;
        const y = (1 - t) * this.y + t * pt.y;

        return new Vec2(x, y);
    }

    cross(a : Vec2) : number {
        return this.x * a.y - this.y * a.x;
    }

    project(a : Vec2) : Vec2 {
        return this.mul(this.dot(a));
    }

    rot(th : number) : Vec2 {
        const cs = Math.cos(th);
        const sn = Math.sin(th);

        return new Vec2(this.x * cs - this.y * sn, this.x * sn + this.y * cs);
    }

    rot90() : Vec2 {
        return new Vec2(- this.y, this.x);
    }

    rot45() : Vec2 {
        const cs = Math.cos(Math.PI / 4);

        return new Vec2(cs * (this.x - this.y), cs * (this.x + this.y));
    }

    static interpolate(p1 : Vec2, p2 : Vec2, rate : number){
        assert(0 <= rate && rate <= 1);
        const x = (1 - rate) * p1.x + rate * p2.x;
        const y = (1 - rate) * p1.y + rate * p2.y;

        return new Vec2(x, y);
    }
}


export class Vec3 {
    x: number;
    y: number;
    z: number;

    static fromXYZ(x : number, y : number, z : number){
        return new Vec3(x, y, z);
    }

    constructor(x: number, y: number, z: number){
        this.x = x;
        this.y = y;
        this.z = z;
    }

    len(){
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }

    unit() : Vec3 {
        const len = this.len();

        if(len == 0){
            return new Vec3(0, 0, 0);
        }
        else{
            return new Vec3(this.x / len, this.y / len, this.z / len);
        }
    }

    mul(n: number){
        return new Vec3(n * this.x, n * this.y, n * this.z);
    }

    add(v: Vec3) {
        return new Vec3( this.x + v.x, this.y + v.y, this.z + v.z );
    }

    sub(v: Vec3) {
        return new Vec3( this.x - v.x, this.y - v.y, this.z - v.z );
    }
    
    dot(v: Vec3) {
        return this.x * v.x + this.y * v.y + this.z * v.z;
    }
    
    cross(v: Vec3) {
        return new Vec3(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x);
    }

    toString() : string {
        return `(${Math.round(this.x)}, ${Math.round(this.y)}, ${Math.round(this.z)})`
    }
}
