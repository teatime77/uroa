# ESP32のWi-Fi設定・制御・カメラ

実装日: 2026-10-14。今回はユーザー指定によりソース実装とビルドまで。テスト・Upload・ブラウザー／実機確認は行っていない。以下は実装した操作手順で、実機での成功記録ではない。

現状の入力欄・ボタンの意味、初回／次回の操作、保存・削除の違いは [diagramのESP32 BLE／Wi-Fi接続画面](diagram-esp32-connection-ui.md) を参照する。上記の確認範囲は実装時のエージェントの作業範囲であり、その後のユーザーによるWi-Fi接続・カメラ表示の報告は画面説明の末尾に区別して記録する。

## ソースと構成

DevKit V1とXIAOでサーボ・IMU・BLE設定・Wi-Fi通信を共通化する。カメラはXIAOだけ。

| ソース | 役割 |
|---|---|
| [main.cpp](../esp32-ble-lab/firmware/src/main.cpp) | 共通指令キュー、I²C・PWM・IMU、停止・接続世代 |
| [network.cpp](../esp32-ble-lab/firmware/src/network.cpp) | BLE設定、Wi-Fi検索／接続、NVS・mDNS、HTTP／WebSocket・認証 |
| [camera.cpp](../esp32-ble-lab/firmware/src/camera.cpp) | XIAOのPSRAMを使う320×240 JPEG。DevKitはカメラなし |
| [ble.ts](../diagram/ts/ble.ts) | 共有接続、既存ブロックのBLE／Wi-Fi通信、切り替え・取消 |
| [robot-wifi.ts](../diagram/ts/robot-wifi.ts) | BLE設定、Wi-Fi認証・通知、接続先保存 |
| [robot-wifi-dialog.ts](../diagram/ts/robot-wifi-dialog.ts) | SSID一覧／手入力、パスワード・接続キー、Chrome保存要求 |
| [camera-feed.ts](../diagram/ts/camera-feed.ts) | CameraBlock配置中の画像取得、取消・URL破棄・再描画 |

制御指令・Status・Telemetryは既存の10／12／20バイトを維持する。ネットワークタスクはI²Cを操作せず、コールバックから指令キューへ渡す。カメラHTTPサーバーは制御サーバーとは別ポート・タスク。

## 初回の操作

1. PC／AndroidとXIAOが同じLANで通信できるようにする。XIAOには2.4GHzのSSIDを指定する。PC／Androidは同じルーターの5GHzでも、端末間通信が許可されていればよい。XIAOへ付属アンテナを取り付ける。新しいファームウェアを対象ボード環境でUploadし、Serial Monitorを115200bpsで開く。XIAOは`xiao_esp32s3`（COM4）、DevKitは`esp32dev`。
2. diagramにBLEConnectionBlockを配置し、「接続」で機器を選ぶ。サーボを有効化せず「Wi-Fi設定／接続」を押す。
3. OSがBLEペアリングを要求したら、Serial Monitorの`BLE setup pairing code: XXXXXX`に表示される6桁のコードを入力する。BLE開始時と`BLE connected`の直後に表示し、ESP32の再起動ごとに生成し直す。起動ログを見逃しても、Monitorを開いたままdiagramからBLEへ再接続すれば再表示する。Wi-Fi設定Characteristicは暗号化・MITM認証済み接続でのみアクセスできる。このローカル表示はペアリング用で、Wi-Fiパスワード・接続キーをシリアルへ出力しない。
4. 「Wi-Fiを検索」でSSIDを選択するか手入力し、パスワードを入力する。オープンネットワークは「パスワードなし」を明示する。
5. 「XIAOに設定してWi-Fiへ切り替え」を押す。Wi-Fi接続とサーバー開始の成功後、SSID・パスワードをNVSへ保存する。失敗時は以前の保存値を上書きしない。
6. 基板固有ID、mDNS名、現在のIP、ポート、接続キーをBLEで取得する。diagramはWi-Fi側の認証・INFO ACKを確認してから接続先を保存する。ESP32はBLE接続・広告を停止する。
7. ServoMotorBlockで改めて「90°で有効化」を押す。切り替え前の有効状態は引き継がない。IMUBlockがあれば共有10Hz通知を再開する。
8. CameraBlockを配置すると、既定の取得元「XIAO」でJPEG取得・表示を開始する。実装時の追加待ち1秒は、後続のユーザー変更により現在0ms。実際の更新間隔は撮影・通信・画像読み込みなどの時間に依存する。XIAOを選択した複数CameraBlockは1台の共通画像を表示する。「端末のカメラ」を選び「開始」を押すとPC／Android自身のカメラへ切り替えられる。端末カメラはESP32への接続不要で、HTTPS／localhostとブラウザーのカメラ許可が必要。選択設定だけを保存し、読込では端末カメラを起動しない。操作・停止条件は[diagram実装ガイド](diagram-implementation.md)を参照する。2026-10-15の追加はビルドまでの確認で、ブラウザー・Android・実機確認はユーザーが行う。顔検出処理は追加していない。

Wi-Fi設定中はサーボ停止・STREAM=0を送信し、BLEハートビートを一時停止する。設定を閉じてBLEに戻る場合はハートビートとIMU購読を再開する。サーボは自動有効化しない。

## 保存と次回

ESP32のNVS名前空間`uroa-net`へ基板ID、ランダムな64桁の接続キー、Wi-Fi設定を保存する。SSIDとパスワードは1つのJSON値として置き換える。NVS暗号化・Flash Encryptionは今回追加していない。

diagramのlocalStorageキー`uroa-robot-endpoints-v1`へ保存するのは基板ID・表示名・mDNS名・IP・ポート・カメラ対応だけ。Wi-Fiパスワード・接続キー・Gemini APIキーをlocalStorage・図JSON・コピー・ログへ含めない。

| Chromeでの識別名 | パスワード欄 |
|---|---|
| `wifi:SSID名` | Wi-Fiパスワード |
| `robot:基板ID` | ESP32の接続キー |
| AIChatBlockで入力した識別名 | Gemini APIキー。既存の別フォーム |

Chrome保存はチェック欄で選ぶ。保存要求の承認・拒否・自動入力はChromeの機能であり、保存成功は保証しない。「接続キーの表示／非表示」で初回のキーを手元でも確認できる。画面を閉じると入力欄と待機を解除する。Gemini APIキーはESP32へ送らない。

次回はESP32がNVSからWi-Fiへ接続し、復旧用BLEも有効にする。diagramの「Wi-Fi設定／接続」で保存済み機器を選び、`robot:基板ID`の接続キーをChromeで自動入力するか手入力し、「保存済みWi-Fiへ接続」を押す。mDNS名を先に試し、失敗時は保存済みIPを試す。基板IDと認証応答を確認する。配置・図JSON復元だけでは接続やサーボ有効化を始めない。

接続できなければBLEから現在の接続情報を再取得する。ESP32を再起動するとBLEが有効になる。Wi-Fi制御セッション終了・ハートビート期限超過時もBLEを再開する。別端末・別Chromeプロファイル・別オリジン・localStorage消去時はBLEから登録し直す。「このブラウザーから削除」は接続先だけ、「ESP32の保存済みWi-Fi設定を消去」はNVSのWi-Fi設定だけを消し、基板IDと接続キーを維持する。Chromeの保存項目はChrome側で削除する。

## 通信・停止・ブラウザー制約

BLEサービスのUUIDは既存のまま。設定Write `f3641404`、結果Read `f3641405`を追加する。文字列JSONは先頭1バイトの0（初期化）・1（続き）・2（確定）を使い、各Writeを20バイト以下に分割する。要求は384バイト未満、結果は512バイト以下。`scan`、`list`（ページ）、`configure`、`info`、`forget`を扱う。結果Readは暗号化・認証済みの接続キーを含められる。通常のサーボBLE通信とは別のCharacteristicを使う。

HTTPポート80は`/info`、`/claim`、`/command`、`/events`、`/release`、WebSocketは81、JPEGの`/capture`は82。接続キーはWi-Fi上で送らず、Web Crypto／mbedTLSのHMAC-SHA256でchallenge・基板ID・Originを認証する。セッションID、要求番号と署名で指令・画像取得要求を検証し、要求番号の再使用を拒否する。制御応答・IMU通知も署名を検証する。1台につきWi-Fi制御は1セッション。

localhostのHTTP開発版はWebSocketを先に試し、接続失敗時はHTTPへ切り替える。HTTPS画面はローカルHTTPを使用する。HTTPでは通知を100ms間隔で取得し、IMUは新しいサンプルだけを出力する。CORSはHTTPSまたはlocalhost／127.0.0.1のOriginへ返す。Chromeのローカルネットワークアクセス権限によるHTTPのmixed-content例外を使い、`ws://`へ同じ例外が適用されるとは扱わない。[Chrome公式説明](https://developer.chrome.com/blog/local-network-access)。ブラウザーがローカルHTTPを許可しない場合、この直接接続方式は利用できない。mDNS・端末間通信も利用環境で確認する。

通信全体のTLS暗号化は今回実装していない。HMACは認証・指令の改変／再送防止に使い、JPEG自体の暗号化は行わない。NVS暗号化とTLSは別途対応する。

CORS応答では、`Access-Control-Allow-Origin`の値をHTTP送信完了まで要求ごとの`CorsHeaders`オブジェクトに保持する。ESP-IDFの`httpd_resp_set_hdr()`は送信時にも値の文字列が有効であることを要求するため、設定用の関数だけで一時的に保持しない。[ESP-IDFのAPI説明](https://docs.espressif.com/projects/esp-idf/en/v4.4.7/esp32/api-reference/protocols/esp_http_server.html#_CPPv418httpd_resp_set_hdrP11httpd_req_tPKcPKc)。`Access-Control-Allow-Origin`が空というエラーが出た場合、修正版ファームウェアをUploadしてからdiagramへ再接続する。

diagramは1.5秒周期のPING、個別ACKを最大2.5秒待つ。ESP32は5秒の指令期限超過・接続世代変更・切断・キュー飽和でサーボ／IMUを停止する。全体Stopはサーボ停止でIMU通知を維持する。古いARM/MOVEを新しい接続へ適用せず、再接続で手動ARMを要求する。Clear・図読込・最後の接続所有ブロック削除・タブ非表示・pagehide・破棄で設定画面・待機・接続・カメラ取得を解除する。カメラ未検出・画像取得失敗は画像の表示へ通知し、制御接続とは別に扱う。

## ビルド・今回の確認範囲

依存にArduinoJson 6.21.5とWebSockets 2.7.1を追加し、既存のEspressif32 6.10.0・NimBLE 2.3.6・PCA9685ライブラリーを維持する。

```powershell
npm.cmd run build
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" run --project-dir esp32-ble-lab/firmware -e esp32dev -e xiao_esp32s3
```

ビルド結果は [build-and-test.md](build-and-test.md) に記録する。テストファイルは変更していない。OSペアリング・Chrome保存／自動入力・Wi-Fi・mDNS・切り替え・サーボ停止・IMU・カメラ・Android・公開HTTPSはユーザーによる確認範囲。
