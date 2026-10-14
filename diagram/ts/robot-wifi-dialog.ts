import { BLEWifiSetup, endpoint, forgetRobot, savedRobots, savePassword, type ProvisionInfo, type RobotEndpoint } from "./robot-wifi";

/** Dialog owns temporary credentials and cancellation; the diagram JSON never owns them. */
export class RobotWifiDialog {
    private dialog = document.createElement("dialog");
    private controller = new AbortController();
    private busy = false;
    constructor(private connect: (target: RobotEndpoint, key: string, signal: AbortSignal) => Promise<void>,
        private closed: () => void, private setup?: BLEWifiSetup) {}
    open(): void {
        const dialog = this.dialog, signal = this.controller.signal;
        dialog.setAttribute("aria-label", "ESP32のWi-Fi設定と接続");
        dialog.style.cssText = "box-sizing:border-box;width:min(540px,calc(100vw - 32px));max-height:90vh;overflow:auto;border:2px solid #35658a;border-radius:8px;padding:20px;font:16px sans-serif";
        const title = document.createElement("h3"); title.textContent = "ESP32のWi-Fi接続";
        const status = document.createElement("p"); status.setAttribute("role", "status");
        status.textContent = this.setup ? "BLEペアリングを求められたら、ESP32のSerial Monitorに表示される6桁のコードを入力してください。" : "初回BLE設定で保存した接続キーを、Chromeの自動入力から選んでください。";
        const form = document.createElement("form"); form.method = "post"; form.name = "uroa-robot-connection";
        const input = (labelText: string, type: string, name: string, complete: HTMLInputElement["autocomplete"]) => {
            const label = document.createElement("label"); label.textContent = labelText; label.style.cssText = "display:block;margin:12px 0";
            const element = document.createElement("input"); element.type = type; element.name = name; element.autocomplete = complete;
            element.spellcheck = false; element.autocapitalize = "none"; element.setAttribute("aria-label", labelText);
            element.style.cssText = "display:block;box-sizing:border-box;width:100%;font:inherit;margin-top:4px";
            label.appendChild(element); form.appendChild(label); return element;
        };
        const select = document.createElement("select"); select.setAttribute("aria-label", "保存済み機器"); select.style.cssText = "width:100%;font:inherit";
        const robots = savedRobots();
        const blank = document.createElement("option"); blank.textContent = "保存済み機器を選択"; blank.value = ""; select.appendChild(blank);
        robots.forEach(robot => { const option = document.createElement("option"); option.value = robot.id; option.textContent = `${robot.name} (${robot.host})`; select.appendChild(option); });
        form.appendChild(select);
        const user = input("接続キーの識別名", "text", "username", "username"); user.readOnly = true;
        const key = input("Wi-Fi接続キー", "password", "password", "current-password"); key.required = true;
        let target: RobotEndpoint | undefined;
        const choose = (robot: RobotEndpoint) => { target = robot; user.value = `robot:${robot.id}`; key.value = ""; };
        select.addEventListener("change", () => { const robot = robots.find(x => x.id === select.value); if (robot) choose(robot); });
        if (robots.length && !this.setup) { select.value = robots[0].id; choose(robots[0]); }
        const saveLabel = document.createElement("label"), save = document.createElement("input"); save.type = "checkbox"; save.checked = true;
        saveLabel.append(save, " 接続成功後、Chromeへ接続キーの保存を要求する");
        const submit = document.createElement("button"); submit.type = "submit"; submit.textContent = "保存済みWi-Fiへ接続";
        const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "閉じる";
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "選択した機器をこのブラウザーから削除";
        remove.onclick = () => { if (target) { forgetRobot(target.id); target = undefined; key.value = user.value = ""; status.textContent = "接続先を削除しました。ESP32のWi-Fi設定やChromeの保存済みキーは残ります。"; } };
        const show = document.createElement("button"); show.type = "button"; show.textContent = "接続キーの表示／非表示";
        show.onclick = () => { key.type = key.type === "password" ? "text" : "password"; };
        form.append(saveLabel, document.createElement("br"), submit, show, remove);
        dialog.append(title, status, form);
        const work = async (operation: () => Promise<void>) => {
            if (this.busy) return; this.busy = true;
            dialog.querySelectorAll<HTMLButtonElement>("button").forEach(button => { if (button !== cancel) button.disabled = true; });
            try { await operation(); }
            catch (error) { if (!signal.aborted) status.textContent = error instanceof Error ? error.message : "接続に失敗しました。"; }
            finally {
                this.busy = false;
                if (!signal.aborted) dialog.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.disabled = false);
            }
        };
        const completed = async (robot: RobotEndpoint, secret: string) => {
            await this.connect(robot, secret, signal);
            if (signal.aborted) return;
            if (save.checked) savePassword(`robot:${robot.id}`, secret);
            this.close();
        };
        form.onsubmit = event => {
            event.preventDefault();
            void work(async () => {
                if (!target || user.value !== `robot:${target.id}`) throw new Error("接続先の機器を選び、その機器の接続キーを入力してください。");
                status.textContent = "Wi-Fiの制御接続を確認しています…";
                await completed(target, key.value.trim());
            });
        };
        if (this.setup) {
            const wifiForm = document.createElement("form"); wifiForm.method = "post"; wifiForm.name = "uroa-wifi-credentials";
            const heading = document.createElement("h4"); heading.textContent = "アクセスポイントを設定する"; wifiForm.appendChild(heading);
            const networks = document.createElement("select"); networks.setAttribute("aria-label", "周囲のSSID一覧"); networks.style.cssText = "width:100%;font:inherit";
            const manual = document.createElement("option"); manual.value = ""; manual.textContent = "SSIDを手入力"; networks.appendChild(manual);
            const ssid = document.createElement("input"); ssid.setAttribute("aria-label", "SSID"); ssid.placeholder = "SSID（2.4GHz）"; ssid.required = true; ssid.autocomplete = "off";
            const wifiUser = document.createElement("input"); wifiUser.name = "username"; wifiUser.autocomplete = "username"; wifiUser.readOnly = true; wifiUser.setAttribute("aria-label", "Wi-Fi保存の識別名");
            const password = document.createElement("input"); password.type = "password"; password.name = "password"; password.autocomplete = "current-password";
            password.placeholder = "Wi-Fiパスワード"; password.setAttribute("aria-label", "Wi-Fiパスワード");
            const noPassword = document.createElement("input"); noPassword.type = "checkbox"; const openLabel = document.createElement("label"); openLabel.append(noPassword, " パスワードなしのネットワーク");
            const passwordChanged = () => { password.required = !noPassword.checked; password.disabled = noPassword.checked; if (noPassword.checked) password.value = ""; };
            noPassword.onchange = passwordChanged; passwordChanged();
            [ssid, wifiUser, password].forEach(element => { element.style.cssText = "display:block;box-sizing:border-box;width:100%;font:inherit;margin:8px 0"; element.spellcheck = false; element.autocapitalize = "none"; });
            ssid.oninput = () => { wifiUser.value = `wifi:${ssid.value}`; password.value = ""; };
            let choices: { ssid: string; open: boolean }[] = [];
            networks.onchange = () => {
                const selected = choices.find(x => x.ssid === networks.value); ssid.value = selected?.ssid || "";
                wifiUser.value = `wifi:${ssid.value}`; password.value = ""; noPassword.checked = selected?.open || false; passwordChanged();
            };
            const scan = document.createElement("button"); scan.type = "button"; scan.textContent = "Wi-Fiを検索";
            scan.onclick = () => { void work(async () => {
                status.textContent = "周囲の2.4GHz Wi-Fiを検索しています…";
                choices = await this.setup!.scan(signal); networks.replaceChildren(manual);
                choices.forEach(item => { const option = document.createElement("option"); option.value = item.ssid; option.textContent = item.ssid; networks.appendChild(option); });
                status.textContent = "SSIDを選択するか手入力してください。PC／Androidも同じアクセスポイントへ接続します。";
            }); };
            const configure = document.createElement("button"); configure.type = "submit"; configure.textContent = "XIAOに設定してWi-Fiへ切り替え";
            const wifiSave = document.createElement("input"); wifiSave.type = "checkbox"; wifiSave.checked = true;
            const wifiSaveLabel = document.createElement("label"); wifiSaveLabel.append(wifiSave, " ChromeへWi-Fiパスワードの保存を要求する");
            const clear = document.createElement("button"); clear.type = "button"; clear.textContent = "ESP32の保存済みWi-Fi設定を消去";
            clear.onclick = () => { void work(async () => {
                await this.setup!.request({ op: "forget" }, signal); password.value = ""; status.textContent = "ESP32のWi-Fi設定を消去しました。基板IDと接続キーは維持します。";
            }); };
            wifiForm.append(scan, networks, ssid, wifiUser, password, openLabel, document.createElement("br"), wifiSaveLabel, document.createElement("br"), configure, clear);
            wifiForm.onsubmit = event => {
                event.preventDefault();
                void work(async () => {
                    if (wifiUser.value !== `wifi:${ssid.value}`) throw new Error("SSIDと保存したWi-Fiパスワードの識別名を確認してください。");
                    status.textContent = "Wi-Fiへ接続し、設定保存を確認しています…";
                    let secret = noPassword.checked ? "" : password.value;
                    const networkName = ssid.value, storeWifiPassword = wifiSave.checked;
                    try {
                        const info = await this.setup!.configure(networkName, secret, signal);
                        target = endpoint(info); user.value = `robot:${info.id}`; key.value = info.key || "";
                        await completed(target, key.value);
                        if (storeWifiPassword && secret) savePassword(`wifi:${networkName}`, secret);
                    } finally { password.value = ""; secret = ""; }
                });
            };
            dialog.appendChild(wifiForm);
            void work(async () => {
                const info: ProvisionInfo = await this.setup!.info(signal); target = endpoint(info);
                user.value = `robot:${info.id}`; key.value = info.key || "";
                status.textContent = info.state === "connected" ? "保存済みWi-Fiへ接続済みです。上のボタンで制御接続を確認できます。" : "初回のSSID・パスワードを設定してください。";
            });
        }
        const note = document.createElement("p"); note.textContent = "接続先だけをこのブラウザーに保存します。Wi-Fiパスワード・接続キーは図のJSONやlocalStorageへ保存しません。Gemini APIキーとは別の項目です。";
        cancel.onclick = () => this.close(); dialog.oncancel = event => { event.preventDefault(); this.close(); };
        dialog.append(note, cancel); (document.getElementById("layer-diagram") || document.body).appendChild(dialog); dialog.showModal();
    }
    close(): void {
        this.controller.abort(); this.dialog.querySelectorAll("input").forEach(input => { input.value = ""; });
        if (this.dialog.open) this.dialog.close(); this.dialog.remove(); this.closed();
    }
}
