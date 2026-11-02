# 超音波距離センサーブロック

`UltrasonicDistanceSensorBlock`はESP32のHC-SR04測定値を受信し、1個のNumberPortへ**mm単位**で出力する。[実装](../../diagram/ts/hardware/ultrasonic.ts)は`hardware/ultrasonic.ts`、通信形式の検証は[device-telemetry.ts](../../diagram/ts/ble-wifi/device-telemetry.ts)に置く。

## 使い方

1. 距離の混在Telemetryに対応した[diagram-control](../../../esp32/app/diagram-control/README.md)を書き込む。DOIT ESP32 DEVKIT V1は`esp32dev`環境を使う。
2. HC-SR04を配線する。現行設定はTRIG=GPIO25、ECHO=GPIO26。ECHOは分圧またはレベル変換して接続する。[配線表](../../../esp32/app/diagram-control/docs/wiring.md#hc-sr04doit-esp32-devkit-v1)を参照する。
3. BLE接続ブロックと超音波距離ブロックを配置してからESP32へ接続する。接続時に図のセンサー・アクチュエータ一覧をDeviceInfoとして登録する。
4. 登録された距離ブロックがあれば共有STREAMを10Hzで要求する。Startを押す必要はない。枠に接続・登録・測定状態を表示し、下部の出力はmm単位の数値となる。
5. PlotBlockへ配線すると距離の推移を表示できる。距離ポートは数値だけを出すため、Plotの横軸にはブラウザーでの受信時刻を使う。

IMUBlockと距離ブロックは`retainSensorStream(this)`で同じ10Hz STREAMを共有する。距離だけの構成ではIMUの検出を必要としない。どちらかの登録済みブロックが残る間はSTREAMを維持し、最後の利用ブロックを削除するとSTREAM=0を要求する。BLEからWi-Fiへ切り替えた場合も同じ機器一覧を使い、共有STREAMを再開する。サーボを自動有効化する処理は追加していない。

DeviceInfoは接続時の一覧を固定して使う。接続後に追加・コピーしたブロックは「再接続して機器を登録」と表示し、追加しただけでは測定値を受信しない。一覧を変更するにはBLEで再接続する。削除済みブロックのレコード位置は次の登録まで保持して通知全体の順序を検証するが、そのブロックの出力は更新しない。

## 距離レコードと無効値

Telemetryはversion=3の共通ヘッダー8バイトに、DeviceInfoのセンサー順でIMU（13バイト）と距離（3バイト）を連結する。サーボは通知に含めない。

| レコード内Offset | 型 | 内容 |
|---|---|---|
| 0 | uint8 | 種別2：UltrasonicDistanceSensor |
| 1 | uint16 | 距離mm、little endian。有効値20〜4000 |

`0xFFFF`は未測定・測定失敗であり、ポートを`undefined`にする。距離0や65535mmとして出力せず、以前の距離を有効値として保持しない。切断・計測停止でも出力と接続先の入力を消去する。距離の無効値だけでは接続を切らず、次の有効な測定で出力を再開する。

通知全体の版・長さ・種別・距離範囲・センサー件数を検証し、DeviceInfoの件数と順序を全件照合してからポートへ反映する。未対応種別、途中で切れたレコード、余分なデータ、不正な距離値は接続エラーとして扱う。BLEとWi-Fiは同じ検証処理を使う。

同種別の複数ブロックは同じ物理HC-SR04の測定値を共有する。ESP32側は専用タスクで測定後に既定100ms待機し、最新結果を送信する。通知の10Hzは通信設定であり、実機の測定・描画周期の保証ではない。共通ヘッダーのmillisは通知を組み立てる時刻であり、距離を測定した時刻そのものではない。

## 保存・コピー・終了

クラス名`UltrasonicDistanceSensorBlock`、ツール番号16、1出力の構成は維持する。型メタデータのない従来JSONも読み込める。出力はNumberPortで、mmの単位はブロックに表示する。測定値・接続・STREAM状態はJSONへ保存せず、コピーでも引き継がない。

ブロック削除で状態購読とSTREAM利用を解除する。Clear・図の読み込み・最後の接続所有ブロックの削除・非表示・pagehide・diagram破棄では共有接続を終了し、測定値を消去する。通常のStopはサーボを止め、IMUと距離の通知は継続する。

旧HTTP `POST /send_data`による定期取得は`diy_sbc=false`で無効のまま。現行ESP32との通信はBLE／Wi-FiのTelemetryを使う。CalcBlock等の旧式の明示的な計算スケジューラーは今回変更していない。

## 確認範囲

2026-11-01: `npm.cmd run verify`による型・公開ビルド・成果物の静的確認が成功した。ユーザー指定によりテストは作成・実行していない。ブラウザー操作、実BLE／Wi-Fi、JSON往復操作、ESP32との実距離測定・失敗時の表示・切断時の動作は未確認。[検証記録](../build-and-test.md)も参照する。
