import { BLEWifiSetup, endpoint, rememberWifiSSID, savedWifiSSIDs, savePassword, type RobotEndpoint } from "./robot-wifi";

/** Dialog owns temporary credentials and cancellation; the diagram JSON never owns them. */
export class RobotWifiDialog {
    private dialog = document.createElement("dialog");
    private controller = new AbortController();
    private busy = false;
    constructor(private connect: (target: RobotEndpoint, signal: AbortSignal) => Promise<void>,
        private closed: () => void, private setup: BLEWifiSetup) {}
    open(): void {
        const dialog = this.dialog, signal = this.controller.signal;
        dialog.setAttribute("aria-label", "ESP32のWi-Fi設定と接続");
        dialog.style.cssText = "box-sizing:border-box;width:min(540px,calc(100vw - 32px));max-height:90vh;overflow:auto;border:2px solid #35658a;border-radius:8px;padding:20px;font:16px sans-serif";
        const title = document.createElement("h3"); title.textContent = "ESP32のWi-Fi接続";
        const status = document.createElement("p"); status.setAttribute("role", "status");
        status.textContent = "BLEペアリング（Bluetooth Passkey）を求められたら、教材用の固定コード 123456 を入力してください。";
        const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "閉じる";
        dialog.append(title, status);
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
        const wifiForm = document.createElement("form"); wifiForm.method = "post"; wifiForm.name = "uroa-wifi-credentials";
        const heading = document.createElement("h4"); heading.textContent = "アクセスポイントを設定する"; wifiForm.appendChild(heading);
        const networks = document.createElement("select"); networks.setAttribute("aria-label", "SSID一覧（履歴・検索結果）"); networks.style.cssText = "width:100%;font:inherit";
        const manual = document.createElement("option"); manual.value = ""; manual.textContent = "SSIDを手入力"; networks.appendChild(manual);
        const ssid = document.createElement("input"); ssid.setAttribute("aria-label", "SSID"); ssid.placeholder = "SSID（2.4GHz）"; ssid.required = true; ssid.autocomplete = "off";
        const wifiUser = document.createElement("input"); wifiUser.name = "username"; wifiUser.autocomplete = "username"; wifiUser.readOnly = true; wifiUser.setAttribute("aria-label", "Wi-Fi保存の識別名");
        const password = document.createElement("input"); password.type = "password"; password.name = "password"; password.autocomplete = "current-password";
        password.placeholder = "Wi-Fiパスワード"; password.setAttribute("aria-label", "Wi-Fiパスワード");
        const noPassword = document.createElement("input"); noPassword.type = "checkbox"; const openLabel = document.createElement("label"); openLabel.append(noPassword, " パスワードなしのネットワーク");
        const passwordChanged = () => { password.required = !noPassword.checked; password.disabled = noPassword.checked; if (noPassword.checked) password.value = ""; };
        noPassword.onchange = passwordChanged; passwordChanged();
        [ssid, wifiUser, password].forEach(element => { element.style.cssText = "display:block;box-sizing:border-box;width:100%;font:inherit;margin:8px 0"; element.spellcheck = false; element.autocapitalize = "none"; });
        ssid.oninput = () => { networks.value = ""; wifiUser.value = `wifi:${ssid.value}`; password.value = ""; };
        let choices: { ssid: string; open: boolean }[] = [];
        const history = savedWifiSSIDs();
        const refreshNetworks = () => {
            networks.replaceChildren(manual);
            const group = (label: string, names: string[]) => {
                if (!names.length) return;
                const options = document.createElement("optgroup"); options.label = label;
                names.forEach(name => { const option = document.createElement("option"); option.value = name; option.textContent = name; options.appendChild(option); });
                networks.appendChild(options);
            };
            group("以前接続したSSID", history);
            group("周囲のSSID", choices.map(item => item.ssid).filter(name => !history.includes(name)));
            networks.value = history.includes(ssid.value) || choices.some(item => item.ssid === ssid.value) ? ssid.value : "";
        };
        refreshNetworks();
        networks.onchange = () => {
            const selected = choices.find(x => x.ssid === networks.value); ssid.value = networks.value;
            wifiUser.value = `wifi:${ssid.value}`; password.value = ""; noPassword.checked = selected?.open || false; passwordChanged();
        };
        const scan = document.createElement("button"); scan.type = "button"; scan.textContent = "Wi-Fiを検索";
        scan.onclick = () => { void work(async () => {
            status.textContent = "周囲の2.4GHz Wi-Fiを検索しています…";
            choices = await this.setup.scan(signal); refreshNetworks();
            status.textContent = "SSIDを選択するか手入力してください。PC／Androidも同じアクセスポイントへ接続します。";
        }); };
        const configure = document.createElement("button"); configure.type = "submit"; configure.textContent = "Wi-Fiへ接続";
        const wifiSave = document.createElement("input"); wifiSave.type = "checkbox"; wifiSave.checked = true;
        const wifiSaveLabel = document.createElement("label"); wifiSaveLabel.append(wifiSave, " ChromeへWi-Fiパスワードの保存を要求する");
        const clear = document.createElement("button"); clear.type = "button"; clear.textContent = "ESP32の保存済みWi-Fi設定を消去";
        clear.onclick = () => { void work(async () => {
            await this.setup.request({ op: "forget" }, signal); password.value = ""; status.textContent = "ESP32のWi-Fi設定を消去しました。基板IDと接続キーは維持します。";
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
                    const info = await this.setup.configure(networkName, secret, signal);
                    await this.connect(endpoint(info), signal);
                    if (signal.aborted) return;
                    rememberWifiSSID(networkName);
                    if (storeWifiPassword && secret) savePassword(`wifi:${networkName}`, secret);
                    this.close();
                } finally { password.value = ""; secret = ""; }
            });
        };
        dialog.appendChild(wifiForm);
        void work(async () => {
            await this.setup.info(signal);
            status.textContent = "SSIDを履歴から選択するか入力し、パスワードを指定して「Wi-Fiへ接続」を押してください。";
        });
        const note = document.createElement("p"); note.textContent = "BLE接続中のESP32へWi-Fi設定を送ります。接続に成功したSSIDの履歴だけをこのブラウザーに保存します。Wi-Fi接続キーは教材用の固定値を使うため入力不要です。Wi-Fiパスワード・接続キーは図のJSONやlocalStorageへ保存しません。";
        cancel.onclick = () => this.close(); dialog.oncancel = event => { event.preventDefault(); this.close(); };
        dialog.append(note, cancel); (document.getElementById("layer-diagram") || document.body).appendChild(dialog); dialog.showModal();
    }
    close(): void {
        this.controller.abort(); this.dialog.querySelectorAll("input").forEach(input => { input.value = ""; });
        if (this.dialog.open) this.dialog.close(); this.dialog.remove(); this.closed();
    }
}
