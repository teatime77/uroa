# 配線表

今回確認した`ESP32-PCA9685-IMU.fzz`のSDA/SCL・3.3V・GNDの構成に合わせています。

| 接続元 | 接続先 | 備考 |
|---|---|---|
| ESP32 GPIO21 | PCA9685 SDA / GY-521 SDA | I²Cデータ共通 |
| ESP32 GPIO22 | PCA9685 SCL / GY-521 SCL | I²Cクロック共通 |
| ESP32 3V3 | PCA9685 VCC / GY-521 VCC | 制御用3.3V |
| ESP32 GND | PCA9685 GND / GY-521 GND / 外部電源− | 共通GND |
| 外部安定化5V電源＋ | PCA9685端子台 V+ | サーボ用。VCCにはつながない |
| 外部電源− | PCA9685端子台 GND | サーボ電流の戻りは直接配線推奨 |
| PCA9685 CH0 PWM | SG90信号線（通常橙／黄） | 実物の配線色を確認 |
| PCA9685 CH0 V+ | SG90電源線（通常赤） | 5V |
| PCA9685 CH0 GND | SG90GND線（通常茶／黒） | コネクターの向きを確認 |
| USB | ESP32 | PCまたはUSB電源から給電 |

- OEは基板上でLOWにプルダウンされるAdafruitタイプなら未接続で利用可能。互換基板の仕様を確認してください。
- GY-521のXDA・XCL・INTは未使用。一般的な基板はAD0がLOWで0x68。ソフトは0x68と0x69を検出します。
- PCA9685のアドレスジャンパーは初期状態（0x40）を想定。
- PCA9685側のI²Cプルアップも3.3Vにします。5VでSDA/SCLをプルアップしないでください。
- GY-521の基板上レギュレーターの個体差で3.3V入力時に不安定な場合は、実基板の回路・IC電源を確認してください。単純に5Vへ変更してI²Cを5Vにしないでください。
- ブレッドボードの電源レールが途中で分断されていないか、電源OFFで導通確認。
- ESP32の3V3やUSB経由でサーボ電源を供給しないでください。
- サーボを増やすときは電源容量と配線を確認し、まず1個ずつ追加してください。

ソフト上のPWM停止とは別に、サーボ用5V電源を切れるスイッチがあると扱いやすくなります。

## XIAO ESP32S3 Senseで使う場合

I²Cの配線を次のように置き換える。D4/D5は基板の表記、GPIO5/6はESP32-S3の番号である。[Seeed公式ピン表](https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/)を参照する。

| DevKit V1の接続元 | XIAO ESP32S3 Senseの接続元 | 接続先 |
|---|---|---|
| GPIO21（SDA） | D4／GPIO5 | PCA9685 SDA / GY-521 SDA |
| GPIO22（SCL） | D5／GPIO6 | PCA9685 SCL / GY-521 SCL |
| 3V3 | 3V3 | PCA9685 VCC / GY-521 VCC |
| GND | GND | PCA9685 GND / GY-521 GND / 外部5V電源− |

PCA9685のV+とSG90には引き続き外部5V電源を使う。I²Cのプルアップは3.3V。サーボ用5VはXIAOの3V3へ接続しない。外部MPU-6050／GY-521をそのまま使う。Senseのカメラ・マイク・SDカードは今回のファームウェアでは初期化しない。

`platformio.ini`の`xiao_esp32s3`環境を選ぶと、`config.h`がI²CをGPIO5/6へ切り替える。`esp32dev`環境はGPIO21/22のまま。

BLE利用時は付属アンテナをXIAOのWiFi/BTアンテナ端子へ取り付ける。[Seeed公式の取り付け説明](https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/#installation-of-antenna)を参照する。
