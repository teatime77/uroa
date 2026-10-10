import { initI18n, msg, parseURL } from "@i18n";
import { $popup, $button, $grid, $block, $checkbox, $radio, Layout } from "./main";

export function makeTestUI(){
    const [ origin, , , url_base] = parseURL();

    const img_menu = $popup({
        children : [
            $button({
                width : "24px",
                height : "24px",
                url : `${url_base}/../plane/images/line-segment.png`
            })
            ,
            $button({
                width : "24px",
                height : "24px",
                url : `${url_base}/../plane/images/half-line.png`
            })
            ,
            $button({
                width : "24px",
                height : "24px",
                url : `${url_base}/../plane/images/line.png`
            })
        ]
    });

    const text_menu = $popup({
        direction : "column",
        children : [
            $button({
                text : "Cut"
            })
            ,
            $button({
                text : "Copy"
            })
            ,
            $button({
                text : "Paste"
            })
        ]
    });

    const root = $grid({
        rows     : "50px 50px 100%",
        children:[
            $block({
                children : [],
            })
            ,
            $grid({
                columns  : "50% 50%",
                children: [
                    $block({
                        children : [
                            $checkbox({
                                text : "Axis"
                            })
                        ],
                    })
                    ,
                    $block({
                        children : [
                            $button({
                                text : "Play",
                                click : async (ev:MouseEvent)=>{}
                            })
                        ],
                    })
                ]
            })
            ,
            $grid({
                columns  : "50px 50% 50% 300px",

                children : [
                    $block({
                        children : [
                            $radio({
                                value : "",
                                title : "",
                                width : "24px",
                                height : "24px",
                                url : `${url_base}/../plane/images/selection.png`
                            })
                            ,
                            $radio({
                                value : "",
                                title : "",
                                width : "24px",
                                height : "24px",
                                url : `${url_base}/../plane/images/point.png`
                            })
                        ],
                    })
                    ,
                    $block({
                        children : [
                            $button({
                                id : "add-statement",
                                width : "24px",
                                height : "24px",
                                url : `${url_base}/../plane/images/text.png`,
                                click : async (ev : MouseEvent)=>{
                                    msg("show text menu");
                                    text_menu.show(ev);
                                }
                            })
                            ,
                            $button({
                                width : "24px",
                                height : "24px",
                                url : `${url_base}/../plane/images/statement.png`,
                                click : async (ev : MouseEvent)=>{
                                    img_menu.show(ev);
                                }
                            })
                        ],
                    })
                    ,
                    $block({
                        children : [],
                    })
                    ,
                    $block({
                        children : [],
                    }),
                ]
            })
        ]
    });

    return root;
}

export async function bodyOnLoad(){
    await initI18n();

    const root = makeTestUI();
    Layout.initLayout(root);
}
