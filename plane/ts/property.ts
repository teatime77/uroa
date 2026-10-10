import { msg, assert, MyError } from "@i18n";
import { $checkbox, $grid, $input_number, $label, $radio, $selection, $textarea, bgColor, CheckBox, fgColor, InputColor, InputNumber, RadioButton, TextArea, UI } from "@layout";
import { InputText, $input_text, $input_color, SelectionList } from "@layout";

import { GlobalState, urlBase } from "./inference";
import { Widget, MathEntity, TextBlock } from "./json";
import { makeShapeButton, setProperty } from "./all_functions";

import { Motion } from "./geometry";
import { PropertySetting } from "./operation";
import { isMotionBuilder } from "./type_guards";

export abstract class Property {
    widgets : Widget[];
    name   : string;

    constructor(widgets : Widget[], name : string){
        this.widgets = widgets;
        this.name   = name;
    }

    setValue(newValue : any){
        msg(`set value:${this.name} ${newValue}`);

        for(const widget of this.widgets){

            const obj = widget as any;
            const oldValue = obj[this.name];
            setProperty(widget, this.name, newValue);

            if(isMotionBuilder(GlobalState.Builder__tool) && !(widget instanceof Motion)){
                GlobalState.Builder__tool.animation.addPropertyChange(widget, this.name, oldValue, newValue);
            }
        }

        GlobalState.View__current!.dirty = true;
    }

    abstract ui() : UI;
}

export class TextAreaProperty extends Property {
    textArea : TextArea;

    constructor(widgets : Widget[], name : string, value : string){
        super(widgets, name);
        this.textArea = $textarea({
            id   : "text-block-text-area",
            cols : 20,
            rows : name == "mathText" ? 6 : 10,
            value : value,
            change : async (ev : Event)=>{
                this.setValue(this.textArea.getValue());
                for(const widget of this.widgets){

                    if(widget instanceof TextBlock && !widget.isTex){

                        widget.div.innerText = this.textArea.getValue();
                    }
                }
            }
        });
    }

    ui() : UI {
        return this.textArea;
    }
}

export abstract class InputProperty extends Property {
    abstract getInput()  : HTMLInputElement;

    constructor(widgets : Widget[], name : string, input_type : string){
        super(widgets, name);
    }

    valueChanged(widget_id : string, name : string, new_value : string | number) : void {
        this.setValue(new_value);

        const operation = GlobalState.View__current!.operations.find(x => x instanceof PropertySetting && x.id == widget_id && x.name == name) as PropertySetting;
        if(operation != undefined){
            operation.value = new_value;
        }
        else{
            GlobalState.View__current!.addOperation( new PropertySetting(widget_id, name, new_value) );
        }
    }
}

export class StringProperty extends InputProperty {
    input : InputText;
    value : string = "";

    constructor(widgets : Widget[], name : string, value : string){
        super(widgets, name, "text");
        this.value = value;
        this.input = $input_text({
            text : value,
            change : async (ev : Event)=>{
                const new_value = this.input.input.value;
                msg(`change:${this.value}=>${new_value}`)

                this.valueChanged(widgets[0].id, name, new_value);
            }
        });
    }

    getInput()  : HTMLInputElement {
        return this.input.input;
    }

    ui() : UI {
        return this.input;
    }
}

export class NumberProperty extends InputProperty {
    input : InputNumber;

    constructor(widgets : Widget[], name : string, value : number, step : number, min : number, max : number){
        super(widgets, name, "number");
        this.input = $input_number({
            step : step,
            value : value,
            min : min,
            max : max,
            change : async (ev : Event)=>{
                const new_value = this.input.getValue();
                this.valueChanged(widgets[0].id, name, new_value);
            }
        })
    }

    getInput()  : HTMLInputElement {
        return this.input.input;
    }

    ui() : UI {
        return this.input;
    }
}


export class SelectProperty extends Property {
    select : HTMLSelectElement;

    constructor(widgets : Widget[], name : string, value : number, option_texts:string[]){
        super(widgets, name);
        this.select = document.createElement("select");
        this.select.style.color = fgColor;
        this.select.style.backgroundColor = bgColor;

        for(const text of option_texts){
            const option = document.createElement("option");
            option.innerText = text;
            option.style.color = fgColor;
            option.style.backgroundColor = bgColor;

            this.select.append(option);
        }

        assert(0 <= value && value < option_texts.length);
        this.select.selectedIndex = value;

        this.select.addEventListener("change", (ev : Event)=>{
            const idx = this.select.selectedIndex;
            this.setValue(idx);
            msg(`select ${idx} ${option_texts[idx]}`);
        });
    }

    ui() : UI {
        throw new MyError();
    }
}


export class BooleanProperty extends InputProperty {
    input : CheckBox;

    constructor(widgets : Widget[], name : string, value : boolean){
        super(widgets, name, "checkbox");
        this.input = $checkbox({
            text : name,
            change : async (ev : Event)=>{
                this.BooleanValueChanged();
            }
        });

        this.input.input.checked = value;
    }

    getInput()  : HTMLInputElement {
        return this.input.input;
    }

    BooleanValueChanged() : void {
        this.setValue(this.input.input.checked);
    }

    ui() : UI {
        return this.input;
    }
}

export class ColorProperty extends InputProperty {
    input : InputColor;

    constructor(widgets : Widget[], name : string, value : string){
        super(widgets, name, "color");
        this.input = $input_color({
            text : value
        });
    }

    getInput()  : HTMLInputElement {
        return this.input.input;
    }

    ui() : UI {
        return this.input;
    }
}

export class ImgSelectionProperty extends Property {
    selectionList : SelectionList;

    constructor(widgets : Widget[], name : string, value : number, img_names : string[]){
        super(widgets, name);

        const img_urls = img_names.map(x => `${urlBase}/../plane/images/${x}.png`) as string[];
        const buttons : RadioButton[] = [];
        for(const [idx, url] of img_urls.entries()){
            const radio = $radio({
                value : `${idx}`,
                url,
                width  : "36px",
                height : "36px",    
            });
            radio.html().dataset.operation_value = `${idx}`;
            radio.html().dataset.property_name   = name;

            buttons.push(radio);
        }

        this.selectionList = $selection({
            children : buttons,
            selectedIndex : value,
            selectionChanged : (index : number)=>{
                this.setValue(index);
            }
        });
    }

    ui() : UI {
        return this.selectionList;
    }
}

export class ShapesProperty extends Property {

    buttonsUI : UI;

    constructor(widgets : Widget[], name : string, value : MathEntity[]){
        super(widgets, name);

        if(name == "selectedShapes"){

            GlobalState.ShapesProperty__one = this;
        }

        const buttons = value.map(x => makeShapeButton(x, false));
        for(const button of buttons){
            button.button.style.position = "";
        }

        if(buttons.length == 0){
            this.buttonsUI = $label({ text : "" });
        }
        else{
            this.buttonsUI = $grid({
                columns : buttons.map(x => "auto").join(" "),
                children : buttons
            });    
        }
    }

    ui() : UI {
        return this.buttonsUI;
    }
}

console.log(`Loaded: property`);
