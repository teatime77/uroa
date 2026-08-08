///<reference path="core.ts" />

import { MyError, Vec2 } from "@i18n";
import { ContainerUI } from "./container";
import { VisibleArea, TextUIAttr, UIAttr, registerUI, UI, worldCanvas } from "./core";
import { Label, getTextBoxSize } from "./text";

declare const dagre: any;

const nodeMap = new Map<string, GraphNode>();

// 1. ノードの基本定義
interface GraphNodeAttr extends TextUIAttr {
    // クラスターの場合、このIDが他のノードのparentIdになる
    isCluster?: boolean;
    // 親ノードのID。undefinedならルート階層
    parentId?: string;
}

export class GraphNode extends Label {
    width?: number;
    height?: number;

    // クラスターの場合、このIDが他のノードのparentIdになる
    isCluster: boolean = false;
    // 親ノードのID。undefinedならルート階層
    parentId?: string;

    constructor(data : GraphNodeAttr){
        super(data);
        Object.assign(this, data);

        nodeMap.set(this.id!, this);
    }


    draw(ctx : CanvasRenderingContext2D, offset : Vec2, visibleArea : VisibleArea | undefined) : void {
        if(! this.isVisible(offset, visibleArea)){
            return;
        }

        const leftTop = offset.add(this.position);

        // ボックスの描画
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "white"; // "#333";
        ctx.lineWidth = 2;
        // ctx.fillRect(x, y, node.width, node.height);
        ctx.strokeRect(leftTop.x, leftTop.y, this.netSize.x, this.netSize.y);

        // テキストの描画
        ctx.fillStyle = "white"; // "#333";
        const x2 = leftTop.x + this.netSize.x / 2;
        const y2 = leftTop.y + this.netSize.y / 2;
        ctx.fillText(this.text, x2, y2);
    }
}

// 2. エッジの定義
interface GraphEdgeAttr {
    source: string;
    target: string;
    label?: string;
}

// 2. エッジの定義
class GraphEdge {
    source!: string;
    target!: string;
    label?: string;

    constructor(data : GraphEdgeAttr){
        Object.assign(this, data);
    }

    draw(ctx : CanvasRenderingContext2D, offset : Vec2, visibleArea : VisibleArea | undefined) : void {

    }
}

export function makeGraph(obj : UIAttr) : Graph {
    const data  = obj as UIAttr & { nodes:GraphNodeAttr[], edges:GraphEdgeAttr[] };
    const nodes = data.nodes.map(x => new GraphNode(x));
    const edges = data.edges.map(x => new GraphEdge(x));
    const graph = new Graph(data, nodes, edges);

    return graph;
}

export class Graph extends ContainerUI {
    nodes: GraphNode[];
    edges: GraphEdge[];
    g : any;

    constructor(data : UIAttr, nodes: GraphNode[], edges: GraphEdge[]){
        super(data);

        this.nodes = nodes;
        this.edges = edges;

        this.addChildren(...nodes);

        // 1. グラフの初期化と設定
        this.g = new dagre.graphlib.Graph({ compound: true });
        // グラフ全体のレイアウト方向などを設定
        this.g.setGraph({ rankdir: 'BT', nodesep: 50, ranksep: 50 });
        this.g.setDefaultEdgeLabel(() => ({}));

        this.initGraph();
    }

    initGraph(){
        for(const node of this.nodes){
            if(node.isCluster){

                this.g.setNode(node.id, { label: node.text, clusterLabelPos: 'top' });
            }
            else{
                if(node.width == undefined){
                    const font = `${UI.fontSize} ${UI.fontFamily}`;
                    const size = getTextBoxSize(worldCanvas.ctx, node.text, font);

                    node.width  = size.width;
                    node.height = size.height;
                }

                // this.g.setNode(node.id, { label: node.label, width: node.width, height: node.height });
                this.g.setNode(node.id, { label: node.text, width: node.width, height: node.height });
            }

            if(node.parentId != undefined){
                this.g.setParent(node.id, node.parentId);
            }
        }

        for(const edge of this.edges){
            this.g.setEdge(edge.source, edge.target);
        }
    }

    layout(position : Vec2, size : Vec2) : void {
        super.layout(position, size);

        // 4. レイアウト計算の実行 (これで各要素に x, y が割り当てられる)
        dagre.layout(this.g);
    }

    draw(ctx : CanvasRenderingContext2D, offset : Vec2, visibleArea : VisibleArea | undefined) : void {
        const content_position = this.getContentPosition();
        const offset2 = offset.add(this.position).add(content_position);

        ctx.save();

        ctx.font = "14px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.save();
        ctx.translate(offset2.x, offset2.y);
        // エッジの描画
        this.g.edges().forEach((e:any) => {
            const edge = this.g.edge(e);
            const points = edge.points; // 折れ線の配列

            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                ctx.lineTo(points[i].x, points[i].y);
            }
            ctx.strokeStyle = "#999";
            ctx.stroke();

            // 簡易的な矢印の描画（終点）
            const last = points[points.length - 1];
            const prev = points[points.length - 2];
            const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
            ctx.beginPath();
            ctx.moveTo(last.x, last.y);
            ctx.lineTo(last.x - 10 * Math.cos(angle - Math.PI / 6), last.y - 10 * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(last.x - 10 * Math.cos(angle + Math.PI / 6), last.y - 10 * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fillStyle = "#999";
            ctx.fill();
        });

        ctx.restore();

        // ノードの描画
        this.g.nodes().forEach((v:any) => {
            const node = this.g.node(v);
            const x = node.x - node.width / 2;
            const y = node.y - node.height / 2;

/*
            // ボックスの描画
            ctx.fillStyle = "#fff";
            ctx.strokeStyle = "#333";
            ctx.lineWidth = 2;
            // ctx.fillRect(x, y, node.width, node.height);
            ctx.strokeRect(x, y, node.width, node.height);

            // テキストの描画
            ctx.fillStyle = "#333";
            ctx.fillText(node.label as string, node.x, node.y);
*/

            const nd = nodeMap.get(v);
            if(nd == undefined){
                throw new MyError();
            }
            nd.setPosition(Vec2.fromXY(x, y));
            nd.netSize.setXY(node.width, node.height);
            // msg(`nd:${v} ${nd?.text}`);
        });

        const maxX = Math.max(...this.nodes.map(nd => nd.getRight()));
        const maxY = Math.max(...this.nodes.map(nd => nd.getBottom()));
        this.netSize.setXY(maxX, maxY);

        this.nodes.forEach(x => x.draw(ctx, offset2, undefined))

        ctx.restore();
    }
}

registerUI(Graph.name, makeGraph);
