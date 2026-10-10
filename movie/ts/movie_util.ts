import { fetchText } from "@i18n";

export async function includeDialog(url : string){
    const dialog_html = await fetchText(url);

    const div = document.createElement("div");
    div.innerHTML = dialog_html;
    document.body.append(div);
}
