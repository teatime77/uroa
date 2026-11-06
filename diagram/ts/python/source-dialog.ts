/** PythonBlock用の公開Pythonファイル選択。URL・保存・読込の契約はpython-block.tsのopenSource()を参照する。 */
export interface PythonSourceFile {
    filename: string;
    source: string;
}

/** Escape・閉じる・外部取消・pagehideで取得とDOMを破棄し、取消時はundefinedを返す。 */
export function openPythonSource(signal: AbortSignal): Promise<PythonSourceFile | undefined> {
    if (signal.aborted) {
        return Promise.resolve(undefined);
    }
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "Pythonファイルを開く");
    Object.assign(dialog.style, { width: "520px", maxWidth: "90vw", maxHeight: "80vh", boxSizing: "border-box" });
    const heading = document.createElement("h2");
    heading.textContent = "Pythonファイルを開く";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.textContent = "ファイル一覧を取得中…";
    const list = document.createElement("div");
    Object.assign(list.style, { display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto", maxHeight: "50vh" });
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "閉じる";
    close.style.marginTop = "16px";
    dialog.append(heading, status, list, close);
    document.body.appendChild(dialog);
    const request = new AbortController();
    return new Promise(resolve => {
        let finished = false;
        const finish = (file?: PythonSourceFile) => {
            if (finished) {
                return;
            }
            finished = true;
            signal.removeEventListener("abort", cancel);
            request.abort();
            dialog.close();
            dialog.remove();
            resolve(file);
        };
        const cancel = () => finish();
        signal.addEventListener("abort", cancel, { once: true });
        dialog.addEventListener("cancel", cancel, { signal: request.signal });
        dialog.addEventListener("close", cancel, { signal: request.signal });
        close.addEventListener("click", cancel, { signal: request.signal });
        window.addEventListener("pagehide", cancel, { signal: request.signal });
        dialog.showModal();
        void (async () => {
            try {
                const response = await fetch("/diagram/python-list.json", { signal: request.signal, cache: "no-store" });
                if (!response.ok) {
                    throw new Error();
                }
                const files: unknown = await response.json();
                if (!Array.isArray(files) || !files.every(name => typeof name === "string"
                    && /\.py$/i.test(name) && !/[\/\\\u0000-\u001f]/.test(name))) {
                    throw new Error();
                }
                if (finished) {
                    return;
                }
                status.textContent = files.length ? "ファイルを選択すると現在のコードを置き換えます。" : "Pythonファイルがありません。";
                for (const filename of files as string[]) {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.textContent = filename;
                    Object.assign(button.style, { textAlign: "left", padding: "8px", font: "16px sans-serif" });
                    button.addEventListener("click", async () => {
                        const buttons = list.querySelectorAll("button");
                        buttons.forEach(item => {
                            item.disabled = true;
                        });
                        status.textContent = `${filename} を読み込み中…`;
                        try {
                            const response = await fetch(`/diagram/python/${encodeURIComponent(filename)}`,
                                { signal: request.signal, cache: "no-store" });
                            if (!response.ok) {
                                throw new Error();
                            }
                            const source = await response.text();
                            if (!finished) {
                                finish({ filename, source });
                            }
                        }
                        catch {
                            if (!finished) {
                                status.textContent = `${filename} を読み込めませんでした。通信状態を確認してください。`;
                            }
                        }
                        finally {
                            buttons.forEach(item => {
                                item.disabled = false;
                            });
                        }
                    }, { signal: request.signal });
                    list.appendChild(button);
                }
            }
            catch {
                if (!finished) {
                    status.textContent = "ファイル一覧を取得できませんでした。閉じてから再度Openを押してください。";
                }
            }
        })();
    });
}
