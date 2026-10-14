# ESP32 BLE Lab（uroa）

ESP32 DevKit V1またはSeeed Studio XIAO ESP32S3 Senseと、PCA9685、MPU-6050／GY-521をBLEで操作するPlatformIOプロジェクト。ブラウザー側はuroaのdiagramを使う。Wi-FiやAI APIはファームウェアでは使わない。

## 配置と取り込み元

2026-10-14（日本時間）に `D:\usr\prj\robot\esp32-ble-lab\firmware` の作業ツリーを取り込んだ。robotのHEADは `20133531e619d50b60cce71465d1e76173eb31ed`。`src/main.cpp` の未コミット変更も含み、ソース・設定・`.gitignore` はSHA256で元との一致を確認した。元のrobot側は保持し、Git履歴は今回統合していない。今後のuroa側の変更はこの通常フォルダーで管理する。

| パス | 内容 |
|---|---|
| [firmware/src/main.cpp](firmware/src/main.cpp) | BLE、指令キュー、PWM補間、IMU通知、停止 |
| [firmware/include/config.h](firmware/include/config.h) | ピン、角度範囲、パルス幅、UUID、タイムアウト |
| [firmware/platformio.ini](firmware/platformio.ini) | `esp32dev`／Arduinoと固定した依存バージョン |
| [docs/protocol.md](docs/protocol.md) | BLE protocol v1 |
| [docs/wiring.md](docs/wiring.md) | 配線・電源 |
| [docs/validation.md](docs/validation.md) | 取り込み元の2026-10-05の検証記録。旧Web画面の結果を含む |
| [LICENSE](LICENSE) | 取り込み元のMITライセンス |

`.pio/`、`.vscode/`、生成済みバイナリー、旧専用 `web/` は取り込んでいない。ブラウザー側は [ble.ts](../diagram/ts/ble.ts)、[servo.ts](../diagram/ts/servo.ts)、[imu.ts](../diagram/ts/imu.ts)、[plot.ts](../diagram/ts/plot.ts) を使う。実装解説は [esp32-ble-lab-firmware.md](../docs/esp32-ble-lab-firmware.md) を参照する。

## ビルド・書き込み

VS CodeのPlatformIO IDEでは **`esp32-ble-lab/firmware` フォルダー**を開く。現在の既定環境はXIAO用の`xiao_esp32s3`。DevKit V1を使う場合は環境`esp32dev`を明示してBuild・Uploadを実行する。CLIがPATHにある場合、uroaルートで次を実行する。

```powershell
pio run --project-dir esp32-ble-lab/firmware -e esp32dev
```

npm workspaces・TypeScript・Viteのビルドには含めない。`npm.cmd run verify` の成功だけではファームウェアのビルド成功を示さない。WindowsのPlatformIO IDE付属CLIを直接使う場合:

```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" run --project-dir esp32-ble-lab/firmware -e esp32dev
```

実際に書き込むときはESP32をUSB接続してUploadを実行し、Serial Monitorを115200bpsで開く。CLIのCOM3は実際の接続ポートに置き換える。

```powershell
pio run --project-dir esp32-ble-lab/firmware -e esp32dev -t upload --upload-port COM3
pio device monitor --project-dir esp32-ble-lab/firmware -b 115200 -p COM3
```

起動ログの `PCA9685=OK MPU6050=OK`、`BLE advertising: ESP32-BLE-Lab` を確認する。配線・電源とI²Cアドレスは [配線表](docs/wiring.md) を参照する。

### XIAO ESP32S3 Sense（COM4）

2026-10-14に`xiao_esp32s3`環境を追加した。PlatformIOのボードIDは`seeed_xiao_esp32s3`（[公式設定](https://docs.platformio.org/en/latest/boards/espressif32/seeed_xiao_esp32s3.html)）。DevKit V1と同じライブラリー・BLEプロトコル・サーボ範囲・停止処理を使い、I²CピンだけをD4／GPIO5（SDA）、D5／GPIO6（SCL）へ切り替える。[配線表](docs/wiring.md)に従ってPCA9685と外部GY-521を接続する。カメラ・マイク・SDカードは使用しない。

uroaルートで実行する。CLIがPATHにない場合は`pio`を`& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe"`へ置き換える。

```powershell
# ビルド
pio run --project-dir esp32-ble-lab/firmware -e xiao_esp32s3
# COM4へ書き込み
pio run --project-dir esp32-ble-lab/firmware -e xiao_esp32s3 -t upload
# 起動ログ
pio device monitor --project-dir esp32-ble-lab/firmware -e xiao_esp32s3
```

COM4はこの環境の`upload_port`と`monitor_port`へ設定した。USBの再接続やBOOTモードでポートが変わった場合は実際の番号へ変更する。書き込みに失敗する場合はSeeedの[BOOTモード手順](https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/)に従い、ポートを再確認する。USB CDCの設定はEspressif32 6.10.0のボード定義に含まれる。シリアルモニター起動後にRESETを押すと、起動ログを確認しやすい。

同日のUploadエラー報告を受け、`default_envs`を`xiao_esp32s3`へ変更した。環境未指定のBuild・UploadもXIAO用を選ぶ。`This chip is ESP32-S3 not ESP32. Wrong --chip argument?`は、ESP32-S3へ`esp32dev`のESP32用バイナリーを書き込もうとした場合のボード不一致である。Uploadの冒頭が`Processing xiao_esp32s3`となることを確認する。DevKit V1には引き続き`-e esp32dev`を明示する。

## diagramでの操作

uroaルートで `npm.cmd run dev` を起動し、Chromeで `http://localhost:5173/diagram/index.html` を開く。[ble-imu-pca9685.json](../public/diagram/data/ble-imu-pca9685.json) を読み込み、BLE接続ブロックから `ESP32-BLE-Lab` を選ぶ。サーボを使う場合はServoMotorBlockへ数値入力を配線し、「90°で有効化」後に60～120°の角度を送る。操作・模擬テストの詳細は [build-and-test.md](../docs/build-and-test.md) を参照する。

起動・接続・切断時と5秒のハートビート期限超過ではPWM・IMU通知を停止する。再接続で自動有効化しない。STOPは全PWMと待機指令を停止し、IMU通知は継続する。IMU停止はSTREAM=0。角度は内部指令値で、MOVEのACKは受付結果。実角度測定・姿勢推定は含まない。

## 今回の検証

取り込み時に元とのファイル一致、diagram側のUUID・パケット形式との対応、文書リンクを確認した。XIAO対応追加後もPlatformIOの`esp32dev`・`xiao_esp32s3`両環境でビルドが成功し、それぞれの`firmware.bin`を生成した。`main.cpp`の制御処理は取り込み元との一致を維持している。条件・使用量は [build-and-test.md](../docs/build-and-test.md) に記録した。2026-10-05の旧Web画面の模擬結果は今回の検証に含めない。COM4への書き込み、起動ログ、実BLE通信、実サーボ・IMU、Androidでの再確認は今回実施していない。
