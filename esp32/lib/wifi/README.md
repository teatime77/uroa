# UroaWiFi

`uroa_wifi.h`の`uroa::WifiNetwork`はuroa教材用のWi-Fi設定・NVS・mDNS・HTTP/WebSocket・HMAC認証をまとめる。`Config`へ教材の表示名・接続キー・NVS名前空間を渡す。BLEやカメラの具体的な実装は参照しない。

`begin(config, callbacks)`はsetupで1回呼ぶ。オブジェクトはグローバルまたはstaticに1個置き、稼働中ずっと保持する。専用タスク・サーバーの終了／破棄APIは今回提供しない。

| API／コールバック | 使用方法 |
|---|---|
| `configure(json)` | 認証済みBLE窓口からのみ呼ぶ。info/listは結果JSONを返し、scan/configure/forgetは専用タスクへ送る |
| `connected()` / `generation()` | 制御権と接続世代。connectedはWi-Fiルーターへの接続状態ではない |
| `stopControl()` | 制御権を解除し、sessionコールバックで教材へ停止を要求する |
| `tick()` | 制御ループで呼ぶ。readyの公開、BLEの遅延停止・再開を調停する |
| `publish(data, length)` | 制御ループでStatus 12／Telemetry 20バイトを渡す |
| `command(data, length, generation)` | HTTP／ネットワークタスクから呼ぶ。即座にコピーして制御キューへ送る |
| `session(connected, generation)` | 複数タスクから呼ばれ得る。停止フラグの設定など短い処理だけにする |
| `startBLE()` / `stopBLE()` | tickの呼び出し元で実行する。BLEライブラリーのstart/stopへ接続する |
| `cameraBegin()` / `cameraAvailable()` / `cameraServe(request)` | 省略可能。画像取得を教材側へ委譲する。AvailableはHTTP等のタスクからも呼ぶ |

command/session/startBLE/stopBLEは必須。begin前には他のAPIを呼ばない。カメラを使う場合は3つのカメラコールバックを揃える。カメラなしではメタデータのcamera=falseとなる。

NVSは`id`、`wifi`のJSONを使い、旧`key`だけを削除する。ポート80/81/82、認証対象文字列、要求番号の64件窓、設定サイズ・タイムアウト、CORSのOrigin保持は[既存Wi-Fi仕様](../../../docs/esp32-ble-lab-wifi.md)を維持する。通常Statusはキュー、HTTPのIMUは最新1件を保持する。通信コールバックからI²Cは操作しない。

教材用の固定接続キーとペアリングコードはアプリの[config.h](../../../esp32-ble-lab/firmware/include/config.h)が持つ。ライブラリーに教材の認証値やピンを固定しない。外部依存は`library.json`に記載する。
