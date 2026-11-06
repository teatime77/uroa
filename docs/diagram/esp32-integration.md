# diagramとESP32の連携

更新日: 2026-11-05（日本時間）。ブラウザー側はuroa、ESP32側は別リポジトリーの`D:\usr\prj\esp32`で管理する。現行ファームウェアは`app/diagram-control/`。

## Pythonプログラム・VM・デバッグのBLE／Wi-Fi通信

PythonBlockと接続ブロックの「a.pyを送信」は現在の通信経路を利用する。フレーム・Result照合・認証・取消・保持と実行の境界は[bytecode-transfer.ts](../../diagram/ts/ble-wifi/bytecode-transfer.ts)、開始・停止との連携は[python-block.ts](../../diagram/ts/python/python-block.ts)と[main.cpp](../../../esp32/app/diagram-control/src/main.cpp)を正本とする。

ブレークポイント一覧・停止Event・Snapshot取得の両経路の通信APIは[debug-protocol.ts](../../diagram/ts/ble-wifi/debug-protocol.ts)、呼出し例は[device-connection.tsのsendBreakpoints()](../../diagram/ts/ble-wifi/device-connection.ts)、受信元の識別・配送は[ControlTransport](../../../esp32/app/diagram-control/include/control_transport.h)を参照する。実機での送受信はビルドとは別に確認する。

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
| 機器ライブラリー | [Servo](../../../esp32/lib/servo/README.md)、[IMU](../../../esp32/lib/imu/README.md)、[超音波距離](../../../esp32/lib/ultrasonic/README.md) |
| ブラウザー側の接続・サーボ・センサー | [device-connection.ts](../../diagram/ts/ble-wifi/device-connection.ts)、[servo.ts](../../diagram/ts/hardware/servo.ts)、[imu.ts](../../diagram/ts/hardware/imu.ts) |
| Wi-Fi画面・保存・カメラ | [接続画面](diagram-esp32-connection-ui.md)、[Wi-Fiガイド](esp32-ble-lab-wifi.md) |

仕様と実装が食い違う場合は両側の現行ソースを照合する。特に既定環境はREADMEだけで判断せず`platformio.ini`を確認し、コマンドでは環境を明示する。

## DeviceInfoのBLE／Wi-Fi登録

diagramとESP32で既存Service内のDeviceInfo UUIDを`f3641406-00b0-4240-ba50-05ca45bf8abc`に揃える。Write with responseで、1回の書込上限は20バイト。Commandのopcodeや10バイト形式とは独立したCharacteristicである。

BLE接続時のINFO応答後に`sendDeviceInfo()`を呼び、`writeDeviceInfo()`が返すセンサー、アクチュエータのレコードを順に連結して送る。IMU6Axis=0・IMU9Axis=1・UltrasonicDistanceSensor=2・Camera=3は種別の1バイト、ServoMotor=128は種別・CH 0〜15・モード（0=角度、1=速度）の3バイト。先頭の版番号や件数は付けず、使用した分だけを送る。末尾の0はIMU6Axisとして解釈されるため、未使用領域を付け足さない。空の図は0バイトで一覧を消去し、20バイト超や不正な書込位置は送信前に拒否する。既存の指令と送信待ち列を共有し、GATT書込は最大2.5秒待つ。

ESP32では`Callbacks::deviceInfo`から内容と接続世代を通常指令のキューへコピーし、`loop()`で現在の接続世代・種別・レコード長・サーボCH／モードを検証する。全件が正しい場合だけ受信順の`deviceInfos`・`deviceInfoCount`へ置き換え、STREAMと旧測定を停止する。不正な場合は以前の一覧を保持する。新しい一覧ではSTREAMを再要求する。結果はシリアルの`DeviceInfo accepted`／`DeviceInfo rejected`で確認する。通常のBLE接続・切断、Wi-Fi制御権解除、キュー飽和では一覧を消去する。BLEからWi-Fi制御権を取得するときは一覧を引き継ぐ。機器の存在確認・ドライバー追加・ARM・STREAM開始は行わない。詳細は[現行protocol.md](../../../esp32/app/diagram-control/docs/protocol.md)を参照する。

切断・Wi-Fi切替時にはCharacteristicの参照を解除する。この窓口を持たない旧ファームウェアへのBLE接続は取得段階で失敗するため、両側の対応版を使う。分割転送・DeviceInfo専用のアプリ側ACKは未実装。BLE・Wi-Fiの配送、接続時の再登録、書込成功と内容検証の区別は[control-connection.tsのsendDeviceInfo()](../../diagram/ts/ble-wifi/control-connection.ts)と[device-connection.ts](../../diagram/ts/ble-wifi/device-connection.ts)を正本とする。

従来の確認記録: `node --test tests/device-info-transfer.test.mjs`の8件はソースをメモリー内で評価する模擬BLE試験で、順序・0埋めなし・空一覧・長さ境界・不正な書込位置・送信待ち・旧接続の取消・直列化・タイムアウトを確認した。当時は公開ビルド、C++ビルド、ブラウザー操作、Upload、実BLE／実機動作を確認していない。今回のWi-Fi対応の検証結果は[検証記録](../build-and-test.md)を参照する。

## 機器種別付きTelemetry（version=3）

BLE・Wi-Fiとも、8バイトのヘッダー（version=3・flags・sequence・millis）の後へ、DeviceInfo順にIMU6Axis（種別0・13バイト）と超音波距離（種別2・3バイト）を連結する。サーボは除外し、同種別の複数ブロックは同じ物理センサーの値を共有する。IMU9Axis・Cameraを含むSTREAMは未対応。DeviceInfo未受信の開始要求はFORMATエラー、未対応種別・登録機器の利用不可はHARDWAREエラー。

IMUは種別に続いて加速度x/y/zのi16、角速度x/y/zのi16をlittle endianで送る。加速度はraw / 16384 × 9.80665 m/s²、角速度はraw / 131 °/s。距離は種別に続くuint16 little endianのmm値（20〜4000）で、未測定・失敗は0xFFFF。UltrasonicDistanceSensorBlockはmm単位のNumberPortへ出し、0xFFFFではundefinedにする。距離0や65535mmとして扱わない。[超音波距離ガイド](diagram-ultrasonic.md)を参照する。

通知長は`8 + 13 × IMU数 + 3 × 距離数`。距離だけなら11バイト、IMU1個と距離1個なら24バイト。ESP32の通知容量は268バイト、希望ATT MTUは271を維持し、実際には通知長＋3以上の合意MTUを必要とする。IMU1個は最低24、IMU1個と距離1個は最低27。不足時はSTREAMをRANGEエラーで拒否し、必要値をシリアルへ出す。Web BluetoothからMTUを指定する処理・分割通知は追加していない。

`device-telemetry.ts`の`parseDeviceTelemetry()`をBLE・Wi-Fiで共有する。版・全長・最大20件・種別・レコード長・距離範囲を検査し、`sampleChanged()`で接続時のDeviceInfoの件数・順序も全件照合してから各ブロックの`readStatus(time, data, offset)`へ渡す。不正な通知はポートへ部分反映せず接続エラーにする。IMUだけの通知のバイト形式は維持する。

IMUBlockと距離ブロックは`retainSensorStream(this)`で共有10Hz STREAMを利用し、最後の登録済み利用者を削除するとSTREAM=0を要求する。距離だけの場合はIMUの検出フラグを必要としない。接続後の追加・コピーではDeviceInfoを自動更新せず、「再接続して機器を登録」と表示する。削除済みレコードの位置は次の登録まで保持するが、削除したブロックの出力は更新しない。切断・計測停止・0xFFFFでは距離の出力と接続先入力を消去する。通常のStopは通知を維持する。

ヘッダーのmillisは`getUint32(4, true)`で読み、IMUBlockは`{ time, gyro, acc }`を出力する。PlotBlockはStructのtimeを横軸へ使い、機器時刻の巻き戻りで履歴を消去する。距離ブロックの出力は数値だけなので、Plotはブラウザーの受信時刻を横軸へ使う。ESP32の距離測定は専用タスクで行い、各処理後に既定100ms待機する。通知では最新値を再利用し、ヘッダー時刻は距離の測定時刻そのものではない。

Wi-Fiも最大268バイトの同じ混在通知を扱い、HTTPは最新のセンサー通知を1件保持する。機器一覧の再登録とSTREAMの連携は[device-connection.tsのconnectWifi()](../../diagram/ts/ble-wifi/device-connection.ts)を参照する。旧IMU version=1・旧Balance version=2は受信しない。

2026-11-01の今回の変更では型・公開ビルド・成果物の静的確認が成功した。テストはユーザー指定により作成・実行していない。ブラウザー・実BLE／Wi-Fi・実距離測定は未確認。ESP32のビルド結果は別リポジトリーの[検証記録](../../../esp32/docs/build-and-test.md)を参照し、今回のブラウザー変更の検証結果とは区別する。

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

## 通常通信の共通層

ブラウザー側の通常指令・ACK・通知検証は[control-connection.ts](../../diagram/ts/ble-wifi/control-connection.ts)、GATT配送は[ble-control-transport.ts](../../diagram/ts/ble-wifi/ble-control-transport.ts)、Wi-Fi配送は[robot-wifi.ts](../../diagram/ts/ble-wifi/robot-wifi.ts)を参照する。ESP32側の共通窓口は[control_transport.h](../../../esp32/app/diagram-control/include/control_transport.h)。担当範囲と通信契約は各ソースの仕様コメントを正本とする。

## 送受信のタイミング

以下は現行の`control-connection.ts`・`device-connection.ts`とdiagram-controlの`main.cpp`・`config.h`に基づく。周期は設定・実装上の値であり、実機で測った通信遅延や描画周期ではない。

| 処理 | タイミングと責任 |
|---|---|
| ブラウザーからの通常指令 | 操作や入力変更に応じて送信。共有接続で書き込みとACK待ちを直列化し、ACK待ちは最大2.5秒 |
| 接続維持 | ブラウザーは1.5秒周期のタイマーでPINGを要求する。ほかの指令と同じ送信待ち列を通るため、厳密な送信間隔の保証ではない |
| ESP32での受信 | 通信コールバックは指令をコピーしてキューへ渡す。STOPは優先フラグへ渡す。I²Cと指令への応答は`loop()`で行う |
| ESP32のループ | 接続変更等の停止→優先STOP→通常指令最大4件→期限監視→サーボ更新→登録センサー通知→ネットワーク処理→`delay(2)`。2ms周期の保証ではない |
| 計測開始・停止 | 接続時に登録したIMU・距離ブロックが共有STREAMを10Hzに設定。最後の利用者の解除で0。ファームウェアは0／5／10／20Hzに対応 |
| ESP32からのセンサー通知 | 前回の通知から`1000 / streamHz`ms以上で登録IMUを読み、距離の最新値と連結する。HC-SR04の同期測定は専用タスクで各処理後に既定100ms待つ |
| ブラウザーでのBLE受信 | Notifyの`characteristicvaluechanged`イベントで解析し、IMUの構造体出力・距離の数値出力へ渡す。サンプルごとの取得要求は送らない |
| Wi-Fiでの受信 | WebSocketでは受信イベント、HTTP方式では約100ms間隔で通知を取得する。通信経路の選択はWi-Fiガイドを参照する |
| 指令途絶 | ESP32は接続中に有効形式の指令から5秒を超えると出力・STREAMを停止する。通常のSTOPでは出力と待機指令を止め、センサー通知は維持する |

指令のACKは受付結果であり、サーボの実角度・動作完了を示さない。通知APIの成功もブラウザーの受信・描画を保証しない。ESP32の取得時刻とブラウザーの到着時刻は別であり、両者を同期した時計として扱わない。

## 旧フォルダーとBalance互換機能の廃止

2026-10-30にユーザーがuroa内の`esp32/`と`esp32-ble-lab/`を削除する方針を決定した。この文書更新は削除前の準備で、フォルダーの削除そのものは行わない。以後、現行のビルド・書き込み・通信仕様の参照先には使わない。

旧BLE Labと倒立アプリのビルド・書き込みは運用対象外。倒立アプリは別リポジトリーへ移行しておらず、diagram-controlにも含まれない。削除前のソースや当時の仕様が必要な場合は、uroaのGit履歴で該当時点を参照する。旧ファームウェアの構造の説明は[履歴資料](esp32-ble-lab-firmware.md)、当時の確認結果は[build-and-test.md](../build-and-test.md)に残す。

2026-11-01にブラウザー側のBalance型・version=2/schema=1受信パーサー・購読API・IMUBlockの第2出力・専用模擬テスト・`inverted-pendulum.json`を削除した。Wi-Fi側もversion=2を受け付けない。`BLE-2FS90R-IMU-PLOT.json`は未接続だったBalanceポートを除き、IMUとサーボの図として維持する。**現行diagram-controlはgyro・accのIMU通知version=3を送る**ため、この削除で現行IMUの受信経路は変更しない。旧balanceポートを含む保存JSONは非対応で、自動移行は行わない。

## 確認範囲

uroa側の文書更新ではリンク・記述・差分を確認する。過去のビルド・模擬BLE・ユーザーによる実機報告を、現在のdiagram-controlで再検証した結果へ読み替えない。ビルド、Upload、BLE／Wi-Fi、ブラウザー、実機動作の証拠はそれぞれ区別する。
