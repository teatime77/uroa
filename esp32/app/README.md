# 新しいESP32教材の追加

実装済み利用例は [esp32-ble-lab/firmware](../../esp32-ble-lab/firmware/)と、このフォルダーの[inverted-pendulum](inverted-pendulum/README.md)。倒立教材はSuperminiのGPIO8/9、GY-521、PCA9685、FS90R×2を使い、起動時の静止姿勢を目標に制御し、BLEでdiagramへIMUと速度指令を送る。実機の倒立成立は未確認。

```text
app/rover/
├─ README.md
├─ platformio.ini
├─ src/
│  ├─ hardware_config.h
│  ├─ main.cpp
│  ├─ rover.h / rover.cpp
│  └─ controller.h / controller.cpp
└─ docs/
```

1. 対応基板と部品を決め、`platformio.ini`に環境を作る。既存Labと同じ基板なら[既存設定](../../esp32-ble-lab/firmware/platformio.ini)を参照し、使用する環境・ポートを明示する。
2. `src/hardware_config.h`にピン・CH・向き・可動範囲を置き、`main.cpp`でI²Cなどを初期化する。
3. 利用する共通ライブラリーだけを`lib_deps`へ宣言する。ここからは`symlink://../../lib/servo`のような相対パスになる。各ライブラリーの外部依存は`library.json`に含まれる。
4. `rover.cpp`は車体の操作、`controller.cpp`は入力から操作を選ぶ判断に使う。小規模なら1ファイルから始める。
5. READMEへ目的、対応基板、部品、配線、組立、ビルド・Upload・起動方法、調整と停止方法、確認済みの組み合わせを記載する。

通信オブジェクトは稼働中に破棄せず、通信コールバックから機器を直接操作しない。接続断時の動作・周期処理は教材ごとに定める。倒立教材の起動時自動制御と停止条件は専用READMEを参照する。
