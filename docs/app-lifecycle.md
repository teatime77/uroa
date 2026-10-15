# 共通入口と起動・終了

2026-10-11、P3の実装。現行URLと既存の初期化順序を維持する。

## ソースの役割

| ソース | 役割 |
|---|---|
| [app/ts/main.ts](../app/ts/main.ts) | DOM準備後のURL判定、5アプリの初期化、diagramの子アプリ接続、pagehide・HMR時の終了 |
| [app/ts/lifecycle.ts](../app/ts/lifecycle.ts) | 初期化Promiseの共有、状態・エラー、逆順での停止・破棄 |
| [diagram/ts/index.ts](../diagram/ts/index.ts) | diagramのUI、読込、実機用HTTP処理、BLEのイベント登録と破棄。全アプリを起動する処理は置かない |
| [diagram/ts/ble-wifi/ble.ts](../diagram/ts/ble-wifi/ble.ts) | BLE接続ブロックと共有接続・サーボ指令・IMU通知管理。停止時に待機中のサーボ指令を取消。Clear・最後の購読ブロック削除・タブ非表示・pagehide・破棄で切断し、遅れた接続完了を破棄 |
| [diagram/ts/hardware/servo.ts](../diagram/ts/hardware/servo.ts) | 角度入力からBLEサーボ操作。明示ARM、MOVE、DISABLE/STOP。CH変更・削除で以前のCH停止、削除で購読・DOMを解除 |
| [diagram/ts/hardware/imu.ts](../diagram/ts/hardware/imu.ts) | IMU構造体を1つのポートへ出力。計測を購読し、削除・切断時に購読と最新値を解除 |
| [diagram/ts/plot/plot.ts](../diagram/ts/plot/plot.ts) | 型と配線を参照する汎用グラフ。削除時にPlotly・DOM・統計タイマー・ResizeObserver・購読・描画予約を解除 |
| [diagram/ts/ai/ai-chat.ts](../diagram/ts/ai/ai-chat.ts) | キー入力とGoogle接続確認、Startで直接AI質問。Stopで待機を取消。切断・Clear・読込・削除・pagehide・破棄で保持キーを解除。削除では回答DOM・ダイアログ・配線と停止の購読を解除 |
| [diagram/ts/runtime.ts](../diagram/ts/runtime.ts) | 実行中・停止フラグ、チェーン実行、キャンセル可能な待機、子アプリ停止の接続口 |
| [diagram/ts/ai/camera-ai-block.ts](../diagram/ts/ai/camera-ai-block.ts) | 物体検出・画像説明の画像取得、キー管理、通信待機、結果DOMと取消を共有。全体Stop・カメラ状態／配線変更・非表示で待機と出力を解除。削除時に購読・DOMを解放し、切断・読込・pagehide・破棄で保持キーも解除 |
| [diagram/ts/ai/object-detection.ts](../diagram/ts/ai/object-detection.ts) | Gemini物体検出。全体Stop・カメラ状態／配線変更・非表示で通信待機と結果を解除。切断・Clear・図読込・削除・pagehide・破棄で保持キーも解除。削除時にカメラ・配線・停止購読、DOMを解放 |
| [diagram/ts/procedure.ts](../diagram/ts/procedure.ts) | 個々のブロック。runtimeを利用し、indexへの逆向きimportを持たない |
| 各アプリのindex.ts | 個別の初期化と停止・破棄。algebraは初期化の中で数式処理を開始する |
| [webgpu/ts/session.ts](../webgpu/ts/session.ts) | デモ・パッケージの実行単位のAbortSignal |

共通入口は通常のTypeScript参照ビルドの対象とするため `app/tsconfig.json` を追加した。npm依存はルートを使用し、workspacesを増やしていない。

## ESP32 Wi-Fi追加時の資源管理（2026-10-14）

共有diagramBLEはBLEとWi-Fiの接続を管理する。Clear・図読込・最後の接続所有ブロック削除・タブ非表示・pagehide・破棄でWi-Fi設定ダイアログ、待機、WebSocket／HTTP通知取得、カメラの取得を解除する。保存先localStorageには接続先だけを残し、秘密情報と有効状態は保存しない。CameraBlockは配置中に画像を購読し、削除で解除する。Wi-Fiへ切り替える前にサーボ停止・IMU停止を要求し、接続確認後も手動ARMを要求する。操作と制約は [Wi-Fiガイド](esp32-ble-lab-wifi.md) を参照する。今回はユーザー指定でビルドまでとし、ライフサイクルテストを実行していない。

2026-10-15にCameraBlockの端末カメラ取得を追加した。端末映像はブロックごとに所有し、明示的な「開始」で取得する。全体Stop・取得元変更・Clear・図読込・削除・タブ非表示・pagehide・破棄でTrackと描画予約を解放する。ブラウザーのカメラ許可待ち自体は取り消せないため、世代を無効化し、後から成功した取得のTrackも停止する。復元・コピー・タブ復帰で端末カメラを自動起動しない。XIAOの共有画像取得は従来どおり通常Stopから独立している。今回はユーザー指定でビルドまでとし、ライフサイクルの実行テストは行わない。

## 起動と状態

`AppLifecycle.start()` は画面を初期化する。同じdocumentで複数回呼んでも同じPromiseを返し、イベント、Canvas、ボタン、GPUデバイスを重複して作らない。diagramではdiagram → game → webgpu → movieの順で初期化し、全処理の成功後に従来の `diagram ready` を出す。他の既存テスト通知も維持する。

状態は `idle` → `initializing` → `ready`。例外時は `failed` になり、原因を `error` に残して、途中まで作成したアプリも含めて後片付けする。失敗したPromiseを共有するため、再度startを呼ぶだけで未完了の初期化を重ねない。初期化中に停止すると `stopped` になり、残りのアプリとready通知を抑止する。

`stop()` は初期化済みUIを保持して再生・実行を止める。ready後の再実行は各画面のStart／再生ボタンで行う。`start()`を再度呼ぶことは教材の再生を意味しない。

diagramのStartはrunOnStartがtrueのFunctionBlock（現在はAIChatBlock）をデータ依存順にawaitし、その後にActionBlockを実行する。失敗時はTTSへ進まず、Startボタンを戻す。回答待ちのStopではAbortSignalが即時に待機を解除し、再実行で新しいSignalを作る。Clear・図読込は既存チェーンも停止する。実行中の任意のブロック削除もチェーンを止め、削除したTTSや切断した入力へ遅い回答を反映しない。ブラウザー側の中断は、Google側で進行中の生成まで取り消す保証ではない。

`dispose()` は終了処理で、複数回呼んでも一度だけ処理する。初期化中ならAbortSignalを立て、await後に作成された資源も初期化処理が戻った後に破棄する。処理済みのアプリを初期化の逆順に破棄し、一つの後片付けが失敗しても残りを処理する。

`failed`・初期化途中の `stopped`・`disposed` からの再起動はページの再読み込みで行う。既存アプリの全GlobalStateを同一document内で作り直す機能は追加していない。診断・テスト用に `window.uroaApp` から状態とstart／stop／disposeを確認できる。

## 停止・資源の管理

- diagramはSleepとループ内の待機を即時解除する。実行が成功・中断・例外のいずれで終わってもStart表示と実行中状態を戻す。
- SpeechRecognitionBlockもStart単位のAbortSignalと停止購読へ接続する。Stop・pagehideで認識をabortし、終了イベントが来なくても待機を解除する。Clear・読込・削除・破棄では結果DOM、イベント・停止購読、タイマーを解放する。遅延イベントは停止後・再実行後の出力へ反映しない。bfcacheから戻っても音声認識を自動再開しない。
- BLE接続ボタン、サーボ入力、IMU受信はStartと独立している。通常の手続きStop・アプリ停止はBLEのSTOPで全PWMと待機中のサーボ指令を停止し、接続・IMU受信を保持する。diagram破棄では共有BLE接続を切断し、配置済みブロックの購読とDOM部品をclearBlockで解除する。BLEのvisibilitychange・pagehideはdiagramのAbortSignalで登録し、非表示時に切断する。接続だけではサーボを有効化しない。配置済みIMUBlockがある場合だけIMU正常フラグを確認して10HzのSTREAMを要求し、最後のIMUBlock削除時はSTREAM=0を送る。切断・計測停止では出力ポートをundefinedへ戻す。
- 子アプリから戻る処理はtry/finallyでdiagramレイヤーを復元する。画面から離れる子アプリを停止し、diagram自体の実行は継続する。diagramのStopは子アプリにも届く。
- PlotBlockの受信と表示もStart/Stopから独立する。入力のundefined・配線変更で履歴を消し、受信停止で統計タイマーを解除する。通常のStopでは接続・IMU受信を保持する。Clear・図の読込・diagram破棄でPlotBlock.clearBlockを呼ぶ。遅れて完了したライブラリ読込は削除済みのブロックを再描画しない。Plotlyの非同期描画中に削除された場合は完了時にもpurgeする。
- gameはSequencerのgeneratorと音声を停止し、読込待ちの古い実行から再開しない。Canvasの入力イベントと描画要求は破棄時に解除する。
- movieは音声・Audioと再生モードを停止する。一括再生は停止後に次の教材へ進めない。初期化で登録した固定メニュー、View、LayoutのイベントとView描画ループを破棄する。
- 音声初期化のvoiceschanged登録は重複させず、終了時に解除する。高速再生用の音声模擬タイマーも停止する。
- WebGPUは標準描画、schema描画、各デモの停止関数を共通の終了経路へ接続する。停止時にNext待ちを解除し、非同期の起動完了が後からアニメーションを再開しないようにする。入力イベントとデバッグ用タイマーも実行単位で解除する。
- WebGPUの破棄時にはCanvasコンテキストを解除し、通常・schema・HMCの所有するGPUDeviceを破棄する。送信済みGPUコマンドの取り消しは行わず、停止後の追加送信・再開を抑える。GPUDeviceの資源破棄の仕様は [MDN](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/destroy) を参照。

diagram経由のパッケージ実行では、WGSL取得先も起動時に `../webgpu` へ設定する。従来の `./wgsl` 固定パスではdiagram側のHTMLを取得して解析に失敗していたため、この連携を修正した。movieの途中停止では、全操作完走時の件数assertと記録生成を行わない。

通常のページ離脱ではdispose、[bfcacheへの退避](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event)ではstopを使い、戻った画面のUIを保持する。再生を自動再開する処理は追加していない。import時に行っていたWebGPUボタン領域のDOM取得とinjectTestData登録は起動処理へ移した。

## 検証

実行コマンドと結果は [build-and-test.md](build-and-test.md) を参照。P3の専用ブラウザ確認は [tests/test_lifecycle.py](../tests/test_lifecycle.py)、初期化失敗・非同期終了などの制御確認は [tests/lifecycle.test.mjs](../tests/lifecycle.test.mjs)。既存の [tests/test.py](../tests/test.py) は変更していない。

実機用HTTPの有効化、robot統合、Firebaseの機能変更、全GPUデモの数値・音声出力・Androidの検証はこの変更に含めない。
