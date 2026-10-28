# ESP32教材と共通ライブラリー

ESP32教材のC++コードを共有する。利用例は [ESP32 BLE Lab](../esp32-ble-lab/README.md)と[FS90R 2輪倒立ロボット](app/inverted-pendulum/README.md)。既存のPlatformIOプロジェクトは移動せず、`esp32/lib/`を参照する構成にした。

## 配置

```text
esp32/
├─ README.md
├─ LICENSE
├─ lib/
│  ├─ ble/         # BleTransport: BLEと認証済み設定JSONの分割転送
│  ├─ wifi/        # WifiNetwork: Wi-Fi設定・NVS・mDNS・HTTP/WebSocket
│  ├─ protocol/    # Protocol: 共通バイナリ形式
│  ├─ servo/       # Pca9685Servos: サーボ出力・補間
│  ├─ imu/         # Mpu6050: IMU初期化・取得
│  └─ plot/        # PlotTelemetry: 6系列の20byteプロット通知
└─ app/
   └─ inverted-pendulum/ # Supermini・GY-521・PCA9685・FS90Rの倒立教材
```

各ライブラリーは`library.json`、`README.md`、`src/uroa_*.h`、`src/uroa_*.cpp`を持つ。ここでの`lib/`は編集するC++ソースであり、Webモジュールの生成物`lib/`とは異なる。

教材と共有ライブラリーのC++ソース・ヘッダーは[コーディング規約](../docs/coding-style.md)に従う。[.clang-format](.clang-format)でブロック・インデント等を揃え、Doxygenコメントと1行1変数宣言も確認する。`.pio/`の外部依存・生成物は整形対象に含めない。

| ライブラリー | 公開クラス・詳細 |
|---|---|
| [ble](lib/ble/README.md) | `uroa::BleTransport`。BLE接続世代、指令受付、Status/Telemetry通知、Wi-Fi設定窓口 |
| [wifi](lib/wifi/README.md) | `uroa::WifiNetwork`。設定・制御権・認証・通信と専用タスク |
| [protocol](lib/protocol/README.md) | `uroa::Protocol`。指令検査、StatusとTelemetryの組み立て |
| [servo](lib/servo/README.md) | `uroa::Pca9685Servos`。PCA9685の16CH、明示ARM、時間補間、停止 |
| [imu](lib/imu/README.md) | `uroa::Mpu6050`。0x68/0x69探索、設定、14バイトの生データ取得 |
| [plot](lib/plot/README.md) | `uroa::PlotTelemetry`。6数値の符号付き0.01単位、送信周期、BLE既定MTUに収まる20byte通知 |

カメラの基板固有処理は既存の[camera.cpp](../esp32-ble-lab/firmware/src/camera.cpp)に残し、`WifiNetwork`へコールバックで渡す。倒立教材は起動時の静止姿勢を目標に自動制御し、BLEで観測・停止する。実車の倒立成立は未確認。超音波・DCモーターと、rover・アーム・レーダー・二足歩行の教材本体は未実装。

## 教材側とライブラリー側の境界

教材側はピン・可動範囲・名前・通信UUID・教材用認証値を設定し、I²Cバスを開始する。ライブラリーは教材の`config.h`や`hardware_config.h`をincludeしない。サーボには`Config`、IMUには`TwoWire&`、通信には`Config`とコールバックを渡す。

通信コールバックでは指令をコピーしてキューへ送り、停止フラグを設定する。サーボ・IMUのI²C操作は制御ループへ集約する。キュー、5秒期限監視、STREAM周期、STOPと接続断の扱いは教材側の判断として [main.cpp](../esp32-ble-lab/firmware/src/main.cpp)に残した。機器クラスから通信のStatusを直接送信しない。

BLEとWi-Fi/mDNSは基板共通資源のため、それぞれ稼働するインスタンスは1個。通信オブジェクトはグローバルまたはstaticに置き、稼働中ずっと保持する。Wi-Fiタスク・HTTPサービスを終了してオブジェクトを破棄するAPIは今回の対象外。BLEの`stop()`/`start()`はWi-Fi切り替え時の停止・再開に使う。

## 開発・ビルド

新教材の作成手順は [app/README.md](app/README.md)。既存の利用例は、uroaルートから次でビルドする。

```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" run --project-dir esp32-ble-lab/firmware -e esp32dev -e xiao_esp32s3
```

共有ライブラリーは`lib_deps`の`symlink://../../esp32/lib/...`で参照する。外部依存のバージョンは各`library.json`に宣言する。共有ソースの変更は利用する教材の次回ビルドへ反映されるため、影響する基板環境を明示してビルドする。npmの`verify`はESP32のビルドを含まない。

Labの`firmware/`だけをコピーすると共有ライブラリーが不足する。開発環境はuroaリポジトリー全体を取得し、上記の相対配置を保つ。

既存Labの通信形式・NVS形式・ポート・UUIDは[プロトコル](../esp32-ble-lab/docs/protocol.md)と[Wi-Fiガイド](../docs/esp32-ble-lab-wifi.md)を維持する。倒立教材は同じTelemetry UUIDへ[plotのversion=2通知](lib/plot/README.md)も送るため、対応したdiagramを使う。ビルド・静的確認と、Upload・ブラウザー・実機での動作確認は区別し、[検証記録](../docs/build-and-test.md)へ記録する。
