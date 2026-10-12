# 共通入口と起動・終了

2026-10-11、P3の実装。現行URLと既存の初期化順序を維持する。

## ソースの役割

| ソース | 役割 |
|---|---|
| [app/ts/main.ts](../app/ts/main.ts) | DOM準備後のURL判定、5アプリの初期化、diagramの子アプリ接続、pagehide・HMR時の終了 |
| [app/ts/lifecycle.ts](../app/ts/lifecycle.ts) | 初期化Promiseの共有、状態・エラー、逆順での停止・破棄 |
| [diagram/ts/index.ts](../diagram/ts/index.ts) | diagramのUI、読込、実機用HTTP処理、BLEのイベント登録と破棄。全アプリを起動する処理は置かない |
| [diagram/ts/ble.ts](../diagram/ts/ble.ts) | BLE接続ブロックと共有接続管理。Clear・最後のブロック削除・タブ非表示・pagehide・破棄で切断し、遅れた接続完了を破棄 |
| [diagram/ts/runtime.ts](../diagram/ts/runtime.ts) | 実行中・停止フラグ、チェーン実行、キャンセル可能な待機、子アプリ停止の接続口 |
| [diagram/ts/procedure.ts](../diagram/ts/procedure.ts) | 個々のブロック。runtimeを利用し、indexへの逆向きimportを持たない |
| 各アプリのindex.ts | 個別の初期化と停止・破棄。algebraは初期化の中で数式処理を開始する |
| [webgpu/ts/session.ts](../webgpu/ts/session.ts) | デモ・パッケージの実行単位のAbortSignal |

共通入口は通常のTypeScript参照ビルドの対象とするため `app/tsconfig.json` を追加した。npm依存はルートを使用し、workspacesを増やしていない。

## 起動と状態

`AppLifecycle.start()` は画面を初期化する。同じdocumentで複数回呼んでも同じPromiseを返し、イベント、Canvas、ボタン、GPUデバイスを重複して作らない。diagramではdiagram → game → webgpu → movieの順で初期化し、全処理の成功後に従来の `diagram ready` を出す。他の既存テスト通知も維持する。

状態は `idle` → `initializing` → `ready`。例外時は `failed` になり、原因を `error` に残して、途中まで作成したアプリも含めて後片付けする。失敗したPromiseを共有するため、再度startを呼ぶだけで未完了の初期化を重ねない。初期化中に停止すると `stopped` になり、残りのアプリとready通知を抑止する。

`stop()` は初期化済みUIを保持して再生・実行を止める。ready後の再実行は各画面のStart／再生ボタンで行う。`start()`を再度呼ぶことは教材の再生を意味しない。

`dispose()` は終了処理で、複数回呼んでも一度だけ処理する。初期化中ならAbortSignalを立て、await後に作成された資源も初期化処理が戻った後に破棄する。処理済みのアプリを初期化の逆順に破棄し、一つの後片付けが失敗しても残りを処理する。

`failed`・初期化途中の `stopped`・`disposed` からの再起動はページの再読み込みで行う。既存アプリの全GlobalStateを同一document内で作り直す機能は追加していない。診断・テスト用に `window.uroaApp` から状態とstart／stop／disposeを確認できる。

## 停止・資源の管理

- diagramはSleepとループ内の待機を即時解除する。実行が成功・中断・例外のいずれで終わってもStart表示と実行中状態を戻す。
- BLE接続ボタンはStartと独立している。通常の手続きStopは接続を保持する。diagram破棄では共有BLE接続を切断し、配置済みブロックの購読とDOM部品をclearBlockで解除する。BLEのvisibilitychange・pagehideはdiagramのAbortSignalで登録し、非表示時に切断する。接続だけでは実機出力を有効化しない。
- 子アプリから戻る処理はtry/finallyでdiagramレイヤーを復元する。画面から離れる子アプリを停止し、diagram自体の実行は継続する。diagramのStopは子アプリにも届く。
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
