# ESP32のWi-Fi設定・制御・カメラ

2026-10-30更新: 現行ファームウェアは別リポジトリーの[diagram-control](../../../esp32/app/diagram-control/README.md)。uroa内の旧`esp32/`と`esp32-ble-lab/`は廃止対象。ファイル名は既存リンクのため維持し、以下の操作・構成の参照先は現行リポジトリーへ更新する。仕様・配線・ビルド・送受信タイミングの入口は[ESP32連携ガイド](esp32-integration.md)を参照する。

## 実装時の経緯と確認範囲

以下の日付付きの実装・ユーザー報告は当時の構成の記録であり、現行diagram-controlを今回再検証した結果ではない。

実装日: 2026-10-14。今回はユーザー指定によりソース実装とビルドまで。テスト・Upload・ブラウザー／実機確認は行っていない。以下は実装した操作手順で、実機での成功記録ではない。

2026-10-17更新: 教材用としてWi-Fi接続キーを全基板共通の固定値に変更した。入力欄・識別名・表示切替・Chromeへの接続キー保存要求を削除し、初回・次回とも入力不要とした。diagramとESP32の両方を更新し、ファームウェアを再Uploadする。テストはユーザーが行う。

同日の追加変更で保存済み機器の選択・削除・専用接続画面を廃止した。現在BLE接続しているESP32に対し、SSIDとパスワードを入力して「Wi-Fiへ接続」を押す。次回もBLEから設定画面を開く。追加変更はWeb側だけで、ファームウェアの再変更はない。

2026-10-19のユーザー確認: タブレットからBLE・Wi-Fi接続が成功。PCのSerial Monitorは起動・RESET・BLE接続後も無表示だったが、`--dtr 1 --rts 0`を明示するとペアリングコードが表示された。XIAO環境の`monitor_dtr = 1`・`monitor_rts = 0`へ反映した。Monitorを開き直して使用し、再ビルド・再Uploadは不要。これはユーザーによる通信・シリアル受信の報告であり、エージェントによる実機テストではない。PCからのBLE接続失敗の原因はまだ特定していない。

同日の追加変更: 教材用にBluetooth Passkeyを全基板共通の`123456`へ固定した。更新したファームウェアを再Uploadすると、再起動後も同じコードを使う。OSのペアリング要求にはこの6桁を入力し、Serial Monitorでコードを調べる手順は不要。BLE暗号化・MITM認証の処理は継続する。後続のユーザー報告ではPCからもBLE接続できており、Wi-Fi設定時のPasskey要求まで進んでいる。固定Passkey化の動作テストはユーザーが行う。

さらに同日のユーザー報告でPCからWi-Fi接続も成功した。SSIDの再入力を減らすため、接続成功後のSSID名をブラウザーに保存し、「以前接続したSSID」から選べるようにした。履歴は変更後に接続成功したものから作成し、パスワードを含めない。この追加はWeb側だけで、ファームウェアの再Uploadは不要。履歴選択の動作テストはユーザーが行う。

現状の入力欄・ボタンの意味、初回／次回の操作、保存・削除の違いは [diagramのESP32 BLE／Wi-Fi接続画面](diagram-esp32-connection-ui.md) を参照する。上記の確認範囲は実装時のエージェントの作業範囲であり、その後のユーザーによるWi-Fi接続・カメラ表示の報告は画面説明の末尾に区別して記録する。

## ソースと構成

現行diagram-controlはDevKit V1・XIAO ESP32-S3 Sense・SuperMiniでサーボ・IMU・BLE設定・Wi-Fi通信を共通化する。カメラはSenseだけ。

| ソース | 役割 |
|---|---|
| [main.cpp](../../../esp32/app/diagram-control/src/main.cpp) | 共通指令キュー、機器クラス呼び出し、停止・接続世代・期限監視 |
| [network.cpp](../../../esp32/app/diagram-control/src/network.cpp) | WifiNetworkの教材設定・カメラコールバックを接続 |
| [uroa_wifi.cpp](../../../esp32/lib/wifi/src/uroa_wifi.cpp) | WifiNetwork: Wi-Fi検索／接続、NVS・mDNS、HTTP／WebSocket・認証 |
| [uroa_ble.cpp](../../../esp32/lib/ble/src/uroa_ble.cpp) | BleTransport: BLEサービス・通知と、認証済みWi-Fi設定JSONの分割転送 |
| [camera.cpp](../../../esp32/app/diagram-control/src/camera.cpp) | SenseのPSRAMを使う320×240 JPEG。DevKitとSuperMiniはカメラなし |
| [ble.ts](../../diagram/ts/ble-wifi/ble.ts) | 共有接続、既存ブロックのBLE／Wi-Fi通信、切り替え・取消 |
| [robot-wifi.ts](../../diagram/ts/ble-wifi/robot-wifi.ts) | BLE設定、Wi-Fi認証・通知、SSID名だけの接続履歴保存 |
| [robot-wifi-dialog.ts](../../diagram/ts/ble-wifi/robot-wifi-dialog.ts) | SSID一覧／手入力、Wi-Fiパスワード入力・Chrome保存要求、BLE接続中の基板への設定送信 |
| [camera-feed.ts](../../diagram/ts/camera/camera-feed.ts) | CameraBlock配置中の画像取得、取消・URL破棄・再描画 |

制御指令は10バイト、Statusは12バイト。IMUのTelemetryはBLEと同じversion=3で、8バイトのヘッダーに13バイトのIMUレコードを登録数だけ連結する（最大268バイト）。BLEで登録したDeviceInfoはWi-Fi制御権の取得時に引き継ぐ。形式は[連携ガイド](esp32-integration.md)を参照する。ネットワークタスクはI²Cを操作せず、コールバックから指令キューへ渡す。カメラHTTPサーバーは制御サーバーとは別ポート・タスク。

## 初回の操作

1. PC／AndroidとESP32が同じLANで通信できるようにする。ESP32には2.4GHzのSSIDを指定する。PC／Androidは同じルーターの5GHzでも、端末間通信が許可されていればよい。XIAOへ付属アンテナを取り付ける。別リポジトリーのdiagram-controlを対象ボード環境でUploadする。XIAOは`xiao_esp32s3`、DevKitは`esp32dev`、SuperMiniは`supermini_esp32s3`とし、実際のCOMポートを指定する。Serial Monitorは診断でログが必要な場合に115200bpsで開く。
2. diagramにBLEConnectionBlockを配置し、「接続」で機器を選ぶ。サーボを有効化せず「Wi-Fi設定／接続」を押す。
3. OSがBLEペアリングを要求したら、固定コード`123456`を入力する。Serial Monitorでの確認は不要。BLE開始時と`BLE connected`の直後にも`BLE setup pairing code: 123456`を表示し、再起動後も同じ値を使う。Wi-Fi設定Characteristicは暗号化・MITM認証済み接続でのみアクセスできる。この教材用コードは全基板共通で、基板ごとの秘密情報ではない。Wi-Fiパスワード・接続キーはシリアルへ出力しない。
4. 「以前接続したSSID」から選ぶか、「Wi-Fiを検索」でSSIDを選択するか手入力し、パスワードを入力する。オープンネットワークは「パスワードなし」を明示する。
5. 「Wi-Fiへ接続」を押す。機器の選択は不要で、BLE接続中の基板へ設定を送る。Wi-Fi接続とサーバー開始の成功後、SSID・パスワードをNVSへ保存する。失敗時は以前の保存値を上書きしない。
6. 基板固有ID、mDNS名、現在のIP、ポートをBLEで取得し、教材用固定キーに対応したファームウェアか確認する。接続キーの入力は不要。diagramはWi-Fi側の認証・INFO ACKを確認し、ESP32はBLE接続・広告を停止する。
7. ServoMotorBlockでモードに応じて改めて「90°で有効化」または「0%で有効化」を押す。切り替え前の有効状態は引き継がない。IMUBlockがあれば共有10Hz通知を再開する。
8. CameraBlockを配置すると、既定の取得元「XIAO」でJPEG取得・表示を開始する。実装時の追加待ち1秒は、後続のユーザー変更により現在0ms。実際の更新間隔は撮影・通信・画像読み込みなどの時間に依存する。XIAOを選択した複数CameraBlockは1台の共通画像を表示する。「端末のカメラ」を選び「開始」を押すとPC／Android自身のカメラへ切り替えられる。端末カメラはESP32への接続不要で、HTTPS／localhostとブラウザーのカメラ許可が必要。選択設定だけを保存し、読込では端末カメラを起動しない。操作・停止条件は[diagram実装ガイド](diagram-implementation.md)を参照する。2026-10-15の追加はビルドまでの確認で、ブラウザー・Android・実機確認はユーザーが行う。顔検出処理は追加していない。

Wi-Fi設定中はサーボ停止・STREAM=0を送信し、BLEハートビートを一時停止する。設定を閉じてBLEに戻る場合はハートビートとIMU購読を再開する。サーボは自動有効化しない。

## 保存と次回

ESP32のNVS名前空間`uroa-net`へ基板IDとWi-Fi設定を保存する。SSIDとパスワードは1つのJSON値として置き換える。接続キーはファームウェアの`config.h`の`TEACHING_CONNECTION_KEY`とブラウザーの`teachingConnectionKey`に同じ64文字の教材用固定値を定義し、WifiNetworkのConfigへ渡す。NVSへ保存しない。更新後の起動時に旧NVSの`key`を削除するが、基板ID・SSID・パスワードは保持する。NVS暗号化・Flash Encryptionは今回追加していない。

固定キーはソースに公開された全基板共通値で、基板ごとの秘密情報ではない。HMACの処理は引き続き使用するが、固定キーを知る端末間を区別する認証にはならない。BLEペアリングコードも教材用の共通値`123456`に固定し、ルーターのWi-Fiパスワードは従来どおり入力する。

diagramは接続先をlocalStorageへ保存せず、BLEで得た情報を接続中だけ使う。旧版の`uroa-robot-endpoints-v1`は読み書きせず、既存の値も利用しない。Wi-Fiパスワード・接続キー・Gemini APIキーをlocalStorage・図JSON・コピー・ログへ含めない。

SSIDの履歴は別のlocalStorageキー`uroa-wifi-ssids-v1`へSSID名の配列として保存する。Wi-Fi制御接続まで成功したSSIDだけを新しい順に最大20件、重複なしで保存する。大文字・小文字・空白はそのまま保ち、SSIDの制限は1～32バイト。パスワード・基板ID・IPは履歴へ含めない。ブラウザー・プロファイル・オリジンごとの保存で、PCとタブレットでは共有しない。サイトデータ削除で履歴が消えるが、ESP32のWi-Fi設定消去では消えない。

| Chromeでの識別名 | パスワード欄 |
|---|---|
| `wifi:SSID名` | Wi-Fiパスワード |
| AIChatBlockで入力した識別名 | Gemini APIキー。既存の別フォーム |

ChromeへのWi-Fiパスワード保存はチェック欄で選ぶ。保存要求の承認・拒否・自動入力はChromeの機能であり、保存成功は保証しない。接続キーの入力・Chrome保存要求は行わない。旧版で保存した`robot:基板ID`の項目は不要になり、削除する場合はChrome側で行う。画面を閉じると入力欄と待機を解除する。Gemini APIキーはESP32へ送らない。

次回はESP32がNVSからWi-Fiへ接続し、復旧用BLEも有効にする。diagramからBLE接続し、「Wi-Fi設定／接続」で「以前接続したSSID」から選ぶか手入力し、パスワードを指定して「Wi-Fiへ接続」を押す。保存済み機器の選択は行わず、教材用固定キーを自動使用する。BLEで取得したmDNS名を先に試し、失敗時は取得した現在のIPを試す。基板IDと認証応答を確認する。配置・図JSON復元だけでは接続やサーボ有効化を始めない。

接続できなければBLEから現在の接続情報を再取得する。ESP32を再起動するとBLEが有効になる。Wi-Fi制御セッション終了・ハートビート期限超過時もBLEを再開する。「ESP32の保存済みWi-Fi設定を消去」はNVSのWi-Fi設定だけを消し、基板IDと固定接続キーを維持する。Chromeの保存項目はChrome側で削除する。

## 通信・停止・ブラウザー制約

BLEサービスのUUIDは既存のまま。設定Write `f3641404`、結果Read `f3641405`を追加する。文字列JSONは先頭1バイトの0（初期化）・1（続き）・2（確定）を使い、各Writeを20バイト以下に分割する。要求は384バイト未満、結果は512バイト以下。`scan`、`list`（ページ）、`configure`、`info`、`forget`を扱う。結果Readの`key`には教材用固定キーを返し、diagramが対応ファームウェアかを確認する。設定の読み書きには従来どおり暗号化・MITM認証済みBLE接続が必要。通常のサーボBLE通信とは別のCharacteristicを使う。

HTTPポート80は`/info`、`/claim`、`/command`、`/events`、`/release`、WebSocketは81、JPEGの`/capture`は82。接続キーはWi-Fi上で送らず、Web Crypto／mbedTLSのHMAC-SHA256でchallenge・基板ID・Originを認証する。セッションID、要求番号と署名で指令・画像取得要求を検証し、要求番号の再使用を拒否する。制御応答・IMU通知も署名を検証する。1台につきWi-Fi制御は1セッション。

localhostのHTTP開発版はWebSocketを先に試し、接続失敗時はHTTPへ切り替える。HTTPS画面はローカルHTTPを使用する。HTTPでは通知を100ms間隔で取得し、IMUは新しいサンプルだけを出力する。CORSはHTTPSまたはlocalhost／127.0.0.1のOriginへ返す。Chromeのローカルネットワークアクセス権限によるHTTPのmixed-content例外を使い、`ws://`へ同じ例外が適用されるとは扱わない。[Chrome公式説明](https://developer.chrome.com/blog/local-network-access)。ブラウザーがローカルHTTPを許可しない場合、この直接接続方式は利用できない。mDNS・端末間通信も利用環境で確認する。

通信全体のTLS暗号化は今回実装していない。HMACは認証・指令の改変／再送防止に使い、JPEG自体の暗号化は行わない。NVS暗号化とTLSは別途対応する。

CORS応答では、`Access-Control-Allow-Origin`の値をHTTP送信完了まで要求ごとの`CorsHeaders`オブジェクトに保持する。ESP-IDFの`httpd_resp_set_hdr()`は送信時にも値の文字列が有効であることを要求するため、設定用の関数だけで一時的に保持しない。[ESP-IDFのAPI説明](https://docs.espressif.com/projects/esp-idf/en/v4.4.7/esp32/api-reference/protocols/esp_http_server.html#_CPPv418httpd_resp_set_hdrP11httpd_req_tPKcPKc)。`Access-Control-Allow-Origin`が空というエラーが出た場合、修正版ファームウェアをUploadしてからdiagramへ再接続する。

diagramは1.5秒周期のPING、個別ACKを最大2.5秒待つ。ESP32は5秒の指令期限超過・接続世代変更・切断・キュー飽和でサーボ／IMUを停止する。全体Stopはサーボ停止でIMU通知を維持する。古いARM/MOVEを新しい接続へ適用せず、再接続で手動ARMを要求する。Clear・図読込・最後の接続所有ブロック削除・タブ非表示・pagehide・破棄で設定画面・待機・接続・カメラ取得を解除する。カメラ未検出・画像取得失敗は画像の表示へ通知し、制御接続とは別に扱う。

## ビルドと検証記録

現行の依存は別リポジトリーの各`lib/*/library.json`と`app/diagram-control/platformio.ini`を参照する。以下はuroaルートからESP32の3環境をビルドする例。通常の作業では対象基板の`-e`だけを指定する。npmのビルドにESP32のビルドは含まれない。

```powershell
npm.cmd run build
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" run --project-dir ../esp32/app/diagram-control -e esp32dev -e xiao_esp32s3 -e supermini_esp32s3
```

ブラウザー側の結果は[uroaのbuild-and-test.md](../build-and-test.md)、ファームウェア側の結果は[ESP32の検証記録](../../../esp32/docs/build-and-test.md)に記録する。2026-10-30の参照先整理では文書のみを変更し、ビルド・Upload・通信・実機確認を再実行していない。OSペアリング・Chrome保存／自動入力・Wi-Fi・mDNS・切り替え・サーボ停止・IMU・カメラ・Android・公開HTTPSの過去の報告は実施時点を区別する。
