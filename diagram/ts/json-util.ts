import { downloadJson } from "@i18n";
import type { Editor } from "./canvas";

export let theEditor : Editor;

export function setEditor(editor : Editor){
    theEditor = editor;
}

export function saveJson(){
    let port_idx = 0;

    const blocks = theEditor.blocks;
    for(const [idx, block] of blocks.entries()){
        block.idx = idx;

        for(const port of block.ports){
            port.idx = port_idx++;
        }
    }

    const json = blocks.map(x => x.makeObj());
    downloadJson("diagram", json);
}

/** Select a published diagram JSON; the caller owns block restoration and drawing. */
export function initDiagramOpen(load: (data: any[]) => Promise<void>, signal: AbortSignal): void {
    const dialog = document.getElementById('diagram-open-dialog') as HTMLDialogElement;
    const status = document.getElementById('diagram-open-status')!;
    const list = document.getElementById('diagram-file-list')!;
    let pending: AbortController | undefined;

    const cancel = () => { pending?.abort(); pending = undefined; };
    const close = () => { cancel(); if (dialog.open) dialog.close(); };
    dialog.addEventListener('close', cancel, { signal });
    dialog.addEventListener('cancel', close, { signal });
    document.getElementById('diagram-open-close')!.addEventListener('click', close, { signal });
    document.getElementById('clear-btn')!.addEventListener('click', close, { signal });
    window.addEventListener('pagehide', close, { signal });
    signal.addEventListener('abort', close, { once: true });

    document.getElementById('open-btn')!.addEventListener('click', async () => {
        if (dialog.open || signal.aborted) return;
        cancel();
        const request = pending = new AbortController();
        const current = () => pending === request && !request.signal.aborted && dialog.open && !signal.aborted;
        list.replaceChildren();
        status.textContent = 'ファイル一覧を取得中…';
        dialog.showModal();
        try {
            const response = await fetch('/diagram/data-list.json', { signal: request.signal, cache: 'no-store' });
            if (!response.ok) throw new Error();
            const files: unknown = await response.json();
            if (!Array.isArray(files) || !files.every(name => typeof name === 'string' &&
                /\.json$/i.test(name) && !/[\/\\\u0000-\u001f]/.test(name))) throw new Error();
            if (!current()) return;
            status.textContent = files.length ? 'ファイルを選択してください。現在の図を置き換えます。' : 'JSONファイルがありません。';
            for (const name of files as string[]) {
                const button = document.createElement('button');
                button.type = 'button'; button.textContent = name;
                button.addEventListener('click', async () => {
                    if (!current()) return;
                    const buttons = [...list.querySelectorAll('button')];
                    buttons.forEach(item => { item.disabled = true; });
                    status.textContent = `${name} を読み込み中…`;
                    try {
                        const response = await fetch(`/diagram/data/${encodeURIComponent(name)}`,
                            { signal: request.signal, cache: 'no-store' });
                        if (!response.ok) throw new Error();
                        const data: unknown = await response.json();
                        if (!Array.isArray(data)) throw new Error();
                        if (!current()) return;
                        await load(data);
                        if (current()) close();
                    } catch {
                        if (current()) status.textContent = `${name} を読み込めませんでした。JSONの形式や通信状態を確認してください。`;
                    } finally {
                        if (current()) buttons.forEach(item => { item.disabled = false; });
                    }
                }, { signal: request.signal });
                list.appendChild(button);
            }
        } catch {
            if (current()) status.textContent = 'ファイル一覧を取得できませんでした。閉じてから再度Openを押してください。';
        }
    }, { signal });
}
