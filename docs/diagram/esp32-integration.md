# diagramとESP32の連携

更新日: 2026-10-30（日本時間）。ブラウザー側はuroa、ESP32側は別リポジトリーの`D:\usr\prj\esp32`で管理する。現行ファームウェアは`app/diagram-control/`。

## 現行の参照先

以下の別リポジトリーへのリンクは、uroaとesp32を同じ親フォルダーに配置した場合に有効。uroaだけを取得してもESP32側のソースは含まれない。

| 内容 | 参照先 |
|---|---|
| ESP32側の作業案内・構成 | [AGENTS.md](../../../esp32/AGENTS.md)、[README](../../../esp32/README.md)、[設計](../../../esp32/docs/architecture.md) |
| 基板・ビルド・書き込み・操作・停止条件 | [diagram-control README](../../../esp32/app/diagram-control/README.md)、[platformio.ini](../../../esp32/app/diagram-control/platformio.ini) |
| BLE／Wi-Fiのバイナリ通信形式 | [protocol.md](../../../esp32/app/diagram-control/docs/protocol.md) |
| 配線 | [wiring.md](../../../esp32/app/diagram-control/docs/wiring.md) |
| 指令キュー・機器操作・周期・期限監視 | [main.cpp](../../../esp32/app/diagram-control/src/main.cpp)、[config.h](../../../esp32/app/diagram-control/include/config.h) |
| 通信ライブラリー | [BLE](../../../esp32/lib/ble/README.md)、[Wi-Fi](../../../esp32/lib/wifi/README.md)、[Protocol](../../../esp32/lib/protocol/README.md) |
| 機器ライブラリー | [Servo](../../../esp32/lib/servo/README.md)、[IMU](../../../esp32/lib/imu/README.md) |
| ブラウザー側の接続・サーボ・センサー | [ble.ts](../../diagram/ts/ble-wifi/ble.ts)、[servo.ts](../../diagram/ts/hardware/servo.ts)、[imu.ts](../../diagram/ts/hardware/imu.ts) |
| Wi-Fi画面・保存・カメラ | [接続画面](diagram-esp32-connection-ui.md)、[Wi-Fiガイド](esp32-ble-lab-wifi.md) |

仕様と実装が食い違う場合は両側の現行ソースを照合する。特に既定環境はREADMEだけで判断せず`platformio.ini`を確認し、コマンドでは環境を明示する。

## ビルドの分担

ブラウザー側はuroaルートで`npm.cmd run verify`を実行する。ESP32のビルドは含まない。

ESP32側は別リポジトリーを作業ディレクトリーにして、使用する基板のコマンドを選ぶ。

```powershell
Set-Location D:\usr\prj\esp32
pio run --project-dir app/diagram-control -e esp32dev
pio run --project-dir app/diagram-control -e xiao_esp32s3
pio run --project-dir app/diagram-control -e supermini_esp32s3
```

`pio`がPATHにない場合は、PlatformIO IDE付属のCLIを使う。Upload・Monitorでは基板と実際のCOMポートを指定する。詳しい手順は上表のアプリREADME、検証記録は[ESP32側のbuild-and-test.md](../../../esp32/docs/build-and-test.md)を参照する。

## 送受信のタイミング

以下は現行の`ble.ts`とdiagram-controlの`main.cpp`・`config.h`に基づく。周期は設定・実装上の値であり、実機で測った通信遅延や描画周期ではない。

| 処理 | タイミングと責任 |
|---|---|
| ブラウザーからの通常指令 | 操作や入力変更に応じて送信。共有接続で書き込みとACK待ちを直列化し、ACK待ちは最大2.5秒 |
| 接続維持 | ブラウザーは1.5秒周期のタイマーでPINGを要求する。ほかの指令と同じ送信待ち列を通るため、厳密な送信間隔の保証ではない |
| ESP32での受信 | 通信コールバックは指令をコピーしてキューへ渡す。STOPは優先フラグへ渡す。I²Cと指令への応答は`loop()`で行う |
| ESP32のループ | 接続変更等の停止→優先STOP→通常指令最大4件→期限監視→サーボ更新→IMU通知→ネットワーク処理→`delay(2)`。2ms周期の保証ではない |
| IMU計測開始・停止 | 配置されたIMUBlockの購読で共有STREAMを10Hzに設定。ファームウェアは0／5／10／20Hzを受け付け、0で停止 |
| ESP32からのIMU通知 | STREAM指定後、前回の読取時刻から`1000 / streamHz`ms以上経過したループで読み取り・通知する。10Hzなら約100ms間隔 |
| ブラウザーでのBLE受信 | Notifyの`characteristicvaluechanged`イベントで解析し、IMUBlockの構造体出力へ渡す。サンプルごとの取得要求は送らない |
| Wi-Fiでの受信 | WebSocketでは受信イベント、HTTP方式では約100ms間隔で通知を取得する。通信経路の選択はWi-Fiガイドを参照する |
| 指令途絶 | ESP32は接続中に有効形式の指令から5秒を超えると出力・STREAMを停止する。通常のSTOPでは出力と待機指令を止め、IMU通知は維持する |

指令のACKは受付結果であり、サーボの実角度・動作完了を示さない。通知APIの成功もブラウザーの受信・描画を保証しない。ESP32の取得時刻とブラウザーの到着時刻は別であり、両者を同期した時計として扱わない。

## 旧フォルダーの廃止と残る互換機能

2026-10-30にユーザーがuroa内の`esp32/`と`esp32-ble-lab/`を削除する方針を決定した。この文書更新は削除前の準備で、フォルダーの削除そのものは行わない。以後、現行のビルド・書き込み・通信仕様の参照先には使わない。

旧BLE Labと倒立アプリのビルド・書き込みは運用対象外。倒立アプリは別リポジトリーへ移行しておらず、diagram-controlにも含まれない。削除前のソースや当時の仕様が必要な場合は、uroaのGit履歴で該当時点を参照する。旧ファームウェアの構造の説明は[履歴資料](esp32-ble-lab-firmware.md)、当時の確認結果は[build-and-test.md](../build-and-test.md)に残す。

ブラウザー側のBalance型・version=2/schema=1受信パーサー・IMUBlockの第2出力・模擬テスト・サンプル図は、この文書更新では削除しない。通信形式は別リポジトリーの[PlotTelemetry](../../../esp32/lib/plot/README.md)を参照する。**現行diagram-controlはgyro・accのIMU通知を送り、Balance通知は送らない**ため、balance出力は未取得のままとなる。ブラウザーに互換処理が残っていることは、倒立アプリの提供・運用や実車の倒立成立を意味しない。

## 確認範囲

uroa側の文書更新ではリンク・記述・差分を確認する。過去のビルド・模擬BLE・ユーザーによる実機報告を、現在のdiagram-controlで再検証した結果へ読み替えない。ビルド、Upload、BLE／Wi-Fi、ブラウザー、実機動作の証拠はそれぞれ区別する。
