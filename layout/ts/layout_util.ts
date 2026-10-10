import { assert, MyError } from "@i18n";


export function pseudoColor(n : number) : [number, number, number] {
    n = Math.max(0, Math.min(1, n));

    let r:number, g:number, b:number;

    if(n < 0.25){
        b = 1;
        g = n * 4;
        r = 0;
    }
    else if(n < 0.5){
        b = (0.5 - n) * 4;
        g = 1;
        r = 0;
    }
    else if(n < 0.75){
        b = 0;
        g = 1;
        r = (n - 0.5) * 4;
    }
    else{
        b = 0;
        g = (1 - n) * 4;
        r = 1;
    }

    return [r, g, b];
}

export function toRadian(degree : number) : number {
    return degree * Math.PI / 180;
}

export function toDegree(radian : number) : number {
    return radian * 180 / Math.PI;
}

export function inRange(start : number, theta : number, end : number) : boolean {
    const f = (x:number)=>{ return 0 <= x ? x : 180 + x };

    [start , theta, end] = [ f(start), f(theta), f(end)];
    [ theta, end ] = [ theta - start, end - start ];

    const g = (x:number)=>{ return 0 <= x ? x : 360 + x };
    [theta, end] = [ g(theta), g(end)];

    assert(0 <= theta && 0 <= end);
    return theta <= end;
}

export function linear(src_min : number, src_val : number, src_max : number, dst_min : number, dst_max : number) : number {
    const ratio = (src_val - src_min) / (src_max - src_min);    
    const dst_val = dst_min + ratio * (dst_max - dst_min);

    return dst_val;
}

export function getPhysicalSize() {
    const width = window.screen.width; // screen width in pixels
    const height = window.screen.height; // screen height in pixels
    const dpi = window.devicePixelRatio * 96; // approximate DPI

    const width_cm  = (width  / dpi) * 2.54;
    const height_cm = (height / dpi) * 2.54;

    return { width_cm, height_cm };
}


export function setImgFile(img : HTMLImageElement, file : File){
    const reader = new FileReader();

    reader.addEventListener("load", (ev : ProgressEvent<FileReader>)=>{
        if(ev.target != null){

            if(typeof ev.target.result == "string"){

                img.src = ev.target.result;
            }
            else{

                throw new MyError(`load img error: ${file.name} result:${typeof ev.target.result}`);
            }
        }
        else{

            throw new MyError(`load img error: ${file.name}`);
        }
    });

    reader.readAsDataURL(file);

}
