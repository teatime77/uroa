# FS90R 2輪倒立ロボット

ESP32-S3 Supermini、GY-521／MPU-6050、PCA9685、FS90R×2を使う。ESP32が起動直後の静止姿勢を測り、その角度を目標に100Hzで倒立制御する。BLEは観測と停止に使い、制御の計算をブラウザーへ依存させない。

**起動後、約1秒の校正が終わると車輪出力を自動で開始する。BLE接続やdiagramのStartは待たない。** 電源投入・リセット・書き込み後は車体を支え、校正中は静止させる。これは既存BLE Labの明示ARM方式とは異なる。このアプリではARM/MOVEを拒否する。

2026-10-27に追加。ビルドと模擬確認の結果は[検証記録](../../../docs/build-and-test.md)に分けて記載する。実車での倒立成立、ゲイン、サーボの中立値と回転方向は未確認で、初期値は調整の出発点。

## 配線と組立

| 接続元 | 接続先 |
|---|---|
| Supermini GPIO8 | PCA9685 SDA・GY-521 SDA |
| Supermini GPIO9 | PCA9685 SCL・GY-521 SCL |
| Supermini 3V3 | PCA9685 VCC・3.3V入力に対応するGY-521 VCC |
| GND | PCA9685 GND・GY-521 GND・外部5V電源− |
| 外部安定化5V電源＋ | PCA9685のサーボ電源V+ |
| PCA9685 CH0 | 左FS90Rの信号・V+・GND |
| PCA9685 CH1 | 右FS90Rの信号・V+・GND |

FS90Rの電源は外部5Vを使う。ESP32の3V3へサーボ電源を接続しない。PCA9685のVCCとV+を区別し、SDA/SCLのプルアップは3.3Vにする。GY-521の電源回路は製品差があるため、[共通配線資料](../../../esp32-ble-lab/docs/wiring.md)の注意も参照する。PCAは`0x40`、IMUは`0x68`または`0x69`を使う。

GY-521を車体へ固定し、X軸を左右の車軸と平行、Z軸を直立時に上向きにする。制御する姿勢は車軸周りの1軸で、加速度による角度は`atan2(ay, az)`、角速度は`gx`を使う。前後の取り付け方向とサーボの向きは、下記の方向確認で合わせる。左右の車輪は同径、車軸は同一直線に置く。

## ビルド・書き込み

uroaルートで実行する。既存Labの`firmware/include/config.h`はこのアプリから参照しない。設定は[src/hardware_config.h](src/hardware_config.h)にある。

```powershell
$pio = "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe"
& $pio run --project-dir esp32/app/inverted-pendulum -e supermini_esp32s3
# COM番号を実際のSuperminiへ合わせる。書き込み後は自動起動する。
& $pio run --project-dir esp32/app/inverted-pendulum -e supermini_esp32s3 -t upload --upload-port COM5
& $pio device monitor --project-dir esp32/app/inverted-pendulum -e supermini_esp32s3 --port COM5
```

PlatformIOは`espressif32@6.10.0`、Arduino、`esp32-s3-devkitc-1`の汎用S3定義を基に、Flash 4MB・DIO・USB CDCを指定する。PSRAMは使わない。購入したSuperminiのFlash容量・USB・書き込み条件は実基板で確認する。環境名がSupermini専用でも、基板の全仕様を自動検出するものではない。

### VS Codeからビルド・Uploadする

VS CodeのPlatformIO IDEから実行する場合は、新しいウィンドウで`esp32/app/inverted-pendulum`フォルダーを開く。左のPlatformIOアイコンから`PROJECT TASKS` → `supermini_esp32s3` → `General`を展開し、`Build`でビルド、`Upload`で書き込み、`Monitor`でログを開く。現在の設定は書き込み・モニターともCOM5。PowerShellのモニターが開いている場合はCtrl+Cで終了してからUploadする。書き込み後は校正・車輪出力が自動で始まるため車体を支える。[公式のProject Tasks案内](https://docs.platformio.org/en/latest/integration/ide/vscode.html#project-tasks)も参照する。

## 起動と制御

1. 出力を全CH OFFにし、IMUを100Hz／±2g／±250°/sへ初期化する。
2. 約100ms安定待ち後、10ms間隔の100サンプルで平均姿勢とジャイロのbiasを測る。動きが大きい、重力と整合しない、X軸が鉛直に近い場合は校正失敗として停止する。起動時の正確な1時刻ではなく、この短い静止区間を基準にする。
3. 相補フィルター（時定数0.5秒）で角度を推定し、起動時角度との差と角速度からPID速度指令を計算する。初期値は`Kp=3.0, Ki=0, Kd=0.15`、上限±60%。100Hzの専用タスクでIMU取得と車輪出力を行う。
4. 左右へ同じ進行方向の速度指令を出す。PCAは50Hz、100%は中立から500µsの変化量。初期上限60%なら中立1500µsに対し1200〜1800µs。出力はPCAの時間分解能へ丸められる。

この制御は姿勢の1軸を対象にする。エンコーダーがないため、実測回転速度、移動距離、左右の速度差、位置、旋回方向を閉ループ制御しない。重力に対して大きく傾いた姿勢を長時間保つには車輪の加速が必要になり、保持し続けられない。起動時は重心が車軸の上に来る直立付近にする。FS90Rの応答速度・不感帯・車輪径・車体の重心によって倒立が成立しない可能性もある。

## 中立・方向・ゲインの調整

車体を支え、サーボ用5Vを切れる状態で始める。最初は`Kp/Ki/Kd`をすべて0にしてビルド・書き込みし、起動後の中立パルスで左右が止まるよう、FS90Rの調整ねじまたは`LeftNeutralUs/RightNeutralUs`を調整する。1500µsは公称値で、個体差がある。[FEETECH FS90Rの仕様](https://www.pololu.com/file/0J1867/FS90R.pdf)は1500µsを中立付近、パルス幅を速度・方向指令としている。

次に`MaxCommand`を10〜20%程度へ下げ、`Kp`を小さくして車体を軽く前後へ傾ける。左右の車輪が共に倒れようとする側へ進むことを確認する。片輪だけ逆なら`LeftDirection/RightDirection`、両輪が傾きと逆なら`ControlDirection`を反転する。初期値は左+1／右−1／制御+1だが、取り付け方向次第で変更が必要。

方向が合ったら、支えた状態から`Kp`、次に振動を抑える`Kd`を少しずつ調整し、必要に応じて出力上限を上げる。`Ki`はまず0を維持する。数値を変えたら再ビルドし、毎回の再起動で基準姿勢を取り直す。パラメーターのBLE書き換えや自動調整は実装していない。

## diagramでプロット

1. `npm.cmd run dev`で起動し、localhostのdiagramを開く。Androidなど別端末ではWeb Bluetooth対応ブラウザーとHTTPSを使う。
2. Openから[inverted-pendulum.json](../../../public/diagram/data/inverted-pendulum.json)を開く。BLE接続、IMU、2個のPlotブロックを配置済み。
3. BLE接続ブロックの「接続」で`ESP32-Inverted-Pendulum`を選ぶ。初回BLE接続では制御を継続する。
4. IMU配置中は共有STREAMを10Hzで開始する。`imu`出力のグラフにgyro（°/s）・acc（m/s²）、`balance`出力のグラフに姿勢角／目標角／角速度／誤差と左右の速度指令（%）を表示する。Start操作は不要。制御は100Hz、表示は10Hz。

速度グラフは**実測速度ではなく、制御からFS90Rへ出した速度指令**。左右は進行方向で符号を統一する。右サーボへのパルスの反転とは区別する。図へ保存するのは型と配線であり、ライブ測定値やBLE接続状態を復元しない。

通知形式は[UroaPlot](../../lib/plot/README.md)を参照する。従来のIMU通知version=1と、新しいプロット通知version=2/schema=1を同じCharacteristicへ流す。CommandとStatusは既存v1を使う。古いWeb側は新しい通知に対応しないため、更新したdiagramを使う。Wi-Fi設定・カメラ・ServoMotorBlockによる速度操作はこのアプリの対象外。

## 停止と再始動

目標から25°を超える転倒、180°/sを超える回転、IMU読取エラー、PCA出力エラー、制御周期の30ms超過、コマンドキュー飽和で停止する。起動校正失敗でも開始しない。

BLE接続後は切断または5秒のハートビート途絶でも停止する。diagramのStopから送るSTOP、CH0/1のDISABLEも両輪を停止する。STOPと転倒後も、IMUが正常ならプロットを続けられる。再接続・PING・ARMでは再始動せず、車体を支えてリセットし直す。BLEへ一度も接続していない状態では自律制御を続ける。

停止はPCAのPWM全CH OFFを試みる。I²Cが断線して停止書き込み自体が届かない場合は、ソフトで出力OFFを保証できないためサーボ用5Vを切る。FS90Rに実測速度のフィードバックはない。BLE画面やグラフが止まったことを実際の車輪停止の確認に代用しない。

## ソースの役割

起動状態の切り分けにはシリアルログの`I2C ... PCA=... IMU=... target=... mode=...`と`Balance mode=...`を使う。

診断版は起動・BLE接続世代の変更・mode変更時と5秒ごとに`[balance] fw=inverted-pendulum-diag-20261027-2 ...`を表示する。起動直後のログを逃してもモニターを開いて数秒待てば現在の状態を確認できる。BLE通知修正と診断を基板へ反映するには、最新ソースで再ビルド・Uploadする。

| 診断項目 | 内容 |
|---|---|
| `fw` | 書き込み済みの診断版識別タグ。この行が出なければ版・接続先・モニターを確認する |
| `mode`・`pca`・`imu` | 制御状態と機器の利用可否（1=利用可能） |
| `stream` | 現在の通知設定Hz。diagramにIMUを配置して接続すると通常10 |
| `encode` | 現在の6系列をBalanceパケットへ変換できればOK。非有限値・範囲外ならINVALID |
| `balance=成功/試行` | Balance通知を送信APIが受理した回数／送信を試みた回数。相手の受信数ではない |
| `imuTx=成功/試行` | IMU通知の送信API受付数／試行数 |
| `angle`・`target`・`rate`・`motor` | 姿勢角、目標角、角速度、左右共通の速度指令% |
| `fault`・`detail` | 最初の異常箇所と、その検出時の値。停止後の値で上書きしない |
| `cal=受理数/100` | 起動校正で正常と判定したサンプル数。100未満なら校正未完了 |

`balance`と`imuTx`の受付数が共に増える場合は、ファームウェアが両方を送信APIへ渡している。実受信まで保証する値ではないため、Balanceが待機する場合はWeb側の受信・配線・開いているページの版を確認する。`balance`の試行だけ増えて成功数が増えなければ送信エラー、`encode=INVALID`なら値の変換条件、`stream=0`ならSTREAMの受付を切り分ける。

| mode | 意味と確認点 |
|---|---|
| 1 | 制御中。姿勢誤差・角速度が小さければ速度指令も小さくなる。指令が出ていて動かなければサーボ用5V、中立・方向・配線を確認する |
| 2 | STOP、BLE切断、ハートビート途絶、キュー飽和などで停止。再接続では再始動しない |
| 3 | 転倒角度または角速度の上限で停止 |
| 4 | 起動校正・機器初期化・I2C・制御周期などの異常。起動時のPCA/IMUと、起動直後から4か途中で4になったかを確認する |

`mode=4`の原因は次の`fault`で区別する。`detail`は表に単位を示した項目でのみ使用する。校正条件や停止条件の閾値は診断追加前と同じ。

| fault | 意味とdetail |
|---|---|
| `i2c_begin`・`pca_begin`・`imu_begin` | バス・PCA・IMUの起動失敗 |
| `cal_imu_read`・`imu_read` | 校正中・運転タスクでのIMU読み取り失敗 |
| `cal_invalid_sample`・`invalid_sample` | センサー値が非有限 |
| `cal_gravity_g` | 校正時の加速度の大きさ（g）が0.85〜1.15の範囲外 |
| `cal_axis_g` | 校正時のYZ加速度の大きさ（g）が0.7未満。X軸の取り付け方向を確認する |
| `cal_gyro_x_dps`・`cal_gyro_y_dps`・`cal_gyro_z_dps` | 校正時に該当軸の角速度（度/秒）が±5を超えた。動きまたはセンサーのオフセットを確認する |
| `cal_motion_deg` | 校正最初の姿勢からの角度変化（度）が±3を超えた |
| `control_period_ms` | 制御更新間隔（ms）が0以下・30超・非有限 |
| `motor_write` | 車輪用PWM書き込み失敗 |

校正失敗では目標角が初期値の0のままになる。`target=0`だけでは、0度で校正できた場合と区別できないため、`fault`と`cal`を併せて確認する。再試行時は車体を直立付近で支えてからリセットし、起動後約1秒は静止させる。Fault後に静止させても自動復帰しない。

IMUが正常なら、制御を停止した後も姿勢推定とBalance通知を続ける。そのため、Balanceが「受信待ち」であること自体はモーター停止理由を示さない。共有BLEはBalanceとIMUを連続で送るため、必ず[パケットを指定するnotify](../../lib/ble/README.md)を使う。2026-10-27の修正前は無引数のnotify()によって先のBalanceが後のIMUへ置き換わり得た。修正を反映するにはファームウェアを再ビルド・Uploadする。

| ファイル | 役割 |
|---|---|
| [main.cpp](src/main.cpp) | 起動、校正、100Hzタスク、BLEの指令キュー・世代・停止、スナップショットと通知 |
| [controller.h](src/controller.h)・[controller.cpp](src/controller.cpp) | 姿勢校正、相補フィルター、PID、飽和、停止状態 |
| [wheels.h](src/wheels.h)・[wheels.cpp](src/wheels.cpp) | FS90Rの速度%からPCAパルスへの変換、全CH OFF |
| [hardware_config.h](src/hardware_config.h) | ピン、CH、中立、回転方向、ゲイン、停止条件 |

通信コールバックからI²Cを操作しない。制御タスクのみが機器を操作し、loopは短いロックでコピーしたスナップショットを通知する。BLE通知は制御タスクへ持ち込まない。共通BLE・protocol・IMU・plotライブラリーを利用し、既存Labのファームウェア設定は変更しない。
