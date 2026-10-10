///<reference path="core.ts" />

import { sum, msg, MyError, Vec2 } from "@i18n";
import { VisibleArea, UIAttr, UI, registerUI, makeUIFromJSON } from "./core";
import { updateRoot } from "../game_util";
import { ContainerUI } from "./container";
import { ImageUI } from "./image";
import { Label } from "./text";

export class TreeNode extends ContainerUI {
    static indent = 20;
    static nodeGap = 5;
    static padding = 5;
    static openedFile = "tree-opened.png";
    static closedFile = "tree-closed.png";
    static noneFile   = "none.png";
    openClose : ImageUI;
    icon  : ImageUI;
    label : Label;
    childNodes : TreeNode[];
    isOpen: boolean = false;

    constructor(data : UIAttr & { icon?: string, label: string, childNodes? : any[] }) {
        (data as any).children = [];
        super(data as any as (UIAttr & { children : any[] }));

        if(data.icon == undefined){
            data.icon = "tree-3.png";
        }
        this.openClose = new ImageUI({imageFile: TreeNode.closedFile, size:[20,20], borderWidth:0, padding:0});
        this.icon  = new ImageUI({imageFile: data.icon, size:[20,20], borderWidth:0, padding:0 });
        this.label = new Label({text:data.label, fontSize:"10px", borderWidth:0});

        if(data.childNodes == undefined){

            this.childNodes = []
        }
        else{

            this.childNodes = data.childNodes.map(x => makeUIFromJSON(x)) as TreeNode[];
        }

        this.children = [this.openClose, this.icon, this.label, ...this.childNodes];
        this.children.forEach(x => x.setParent(this));

        this.openClose.clickHandler = this.onOpenClose.bind(this);
    }

    addChild(child: TreeNode){
        this.childNodes.push(child);
        this.children = [this.openClose, this.icon, this.label, ...this.childNodes];
        child.parent = this;
    }

    async onOpenClose(){
        this.isOpen = !this.isOpen;
        this.openClose.setImageFile(this.isOpen ? TreeNode.openedFile : TreeNode.closedFile)

        updateRoot(this);
    }

    setMinSize() : void {
        this.children.forEach(x => x.setMinSize());

        const padding_border_size = this.getPaddingBorderSize();

        let size : Vec2;

        const header_width  = sum( [this.openClose, this.icon, this.label].map(x => x.minSize.x) ) + 2 * TreeNode.padding;
        const header_height = Math.max(... [this.openClose, this.icon, this.label].map(x => x.minSize.y));

        let nodes_width  = 0;
        let nodes_height = 0;

        if(this.childNodes.length != 0 && this.isOpen){

            nodes_width = TreeNode.indent + Math.max(... this.childNodes.map(x => x.minSize.x));

            const sum_nodes_height = sum(this.childNodes.map(x => x.minSize.y));
            const nodes_gap    = TreeNode.nodeGap * this.childNodes.length;
            nodes_height       = sum_nodes_height + nodes_gap;
        }

        this.minSize.x = Math.max(header_width, nodes_width)  + padding_border_size.x;
        this.minSize.y = header_height + nodes_height         + padding_border_size.y;
        this.netSize.copyFrom(this.minSize);
    }

    layout(position : Vec2, size : Vec2) : void {
        super.layout(position, size);

        let x = 0;
        let y = 0;

        this.openClose.layoutXY(x, y);
        // msg(`open-close x:${x.toFixed()} size:${this.openClose.size}`);
        x += this.openClose.netSize.x + TreeNode.padding;

        this.icon.layoutXY(x, y);
        // msg(`icon x:${x.toFixed()} size:${this.openClose.size}`);
        x += this.icon.netSize.x + TreeNode.padding;

        this.label.layoutXY(x, y);
        // msg(`label x:${x.toFixed()} size:${this.openClose.size}`);

        const header_height = Math.max(... [this.openClose, this.icon, this.label].map(x => x.minSize.y));

        y += header_height + TreeNode.nodeGap;

        for(const node of this.childNodes){
            node.layoutXY(TreeNode.indent, y);

            y += node.netSize.y;
        }
    }

    draw(ctx : CanvasRenderingContext2D, offset : Vec2, visibleArea : VisibleArea | undefined) : void {
        if(! this.isVisible(offset, visibleArea)){
            return;
        }
        
        this.drawBorder(ctx, offset);

        const content_position = this.getContentPosition();
        const offset2 = offset.add(this.position).add(content_position);

        const visible_children : (ImageUI | Label | TreeNode)[] = [this.openClose, this.icon, this.label];
        if(this.isOpen){
            visible_children.push(...this.childNodes);
        }


        if(all_children.has(this) || 10000 < all_children.size){
            msg(`too many:${all_children.size} ${UI.count}`);
            throw new MyError();
        }

        all_children.add(this);
        visible_children.forEach(x => x.draw(ctx, offset2, visibleArea));
        all_children.delete(this);
    }
}

registerUI(TreeNode.name, (obj) => new TreeNode(obj));

const all_children = new Set<UI>();


export function makeTreeNodeFromObject(parent : TreeNode, name : string, data : any, done : Set<any>) {
    const node = new TreeNode({ label:name, childNodes:[] });
    parent.addChild(node);

    for (const [key, value] of Object.entries(data)) {
        let child : TreeNode;
        
        if(Array.isArray(value)){
            child = new TreeNode({ label:`${key}:array` });
            for(const [i, element] of value.entries()){
                makeTreeNodeFromObject(child, key,  element, done);
            }
        }
        else if(value == undefined){

            // msg(`${tab}${key} : undefined`);
            continue;
        }
        else if(value == null){

            child = new TreeNode({ label:`${key}:null` });
        }
        else if (typeof value == "object"){
            if(done.has(value)){

                child = new TreeNode({ label:`${key} : ${value.constructor.name} *` });
            }
            else{
                done.add(value);

                child = new TreeNode({ label:`${key} : ${value.constructor.name}` });
                makeTreeNodeFromObject(child, key,  value, done);
            }
        }
        else{
            child = new TreeNode({ label:`${key} : ${typeof value} = ${value}` });
        }

        node.addChild(child);
    }    
}
