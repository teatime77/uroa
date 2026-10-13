# ビルドと回帰テスト

更新日: 2026-10-13。公開用ビルドはuroaルートのTypeScript・Viteビルドに統一する。既存の5アプリ回帰テストは `tests/test.py` に置く。

## コマンド

作業ディレクトリはuroa。PowerShellでは `npm.cmd` を使う。

| コマンド | 処理 |
|---|---|
| `npm.cmd ci` | ロックファイルに従ってnpm依存を準備 |
| `npm.cmd run dev` | Vite開発サーバー。通常は5173番ポート |
| `npm.cmd run build:all` | 14プロジェクトのTypeScript参照ビルド。共通入口appを含む型確認と各 `lib/` の生成 |
| `npm.cmd run build` | 上記TypeScriptビルド成功後、ルートViteで `dist/` を生成 |
| `npm.cmd run check:dist` | 既存の `dist/` の入口・資産を確認 |
| `npm.cmd run verify` | `build` → `check:dist`。失敗した段階で終了 |
| `npm.cmd run preview` | 生成済み `dist/` をローカル配信。通常は4173番ポート |
| `npm.cmd run test:e2e` | Pythonで既存の5アプリ回帰テストを実行。接続先のサーバーとPython依存は事前準備が必要 |

`verify` はビルドと成果物の静的確認であり、ブラウザー操作は含まない。大規模Playwrightテストは明示的に実行する。Viteのpreviewはローカル確認用であり、本番配信サーバーではない。[Vite公式説明](https://vite.dev/guide/static-deploy.html)

## AIチャットとTTSのデモ（2026-10-13）

現行の教材向けAIChatBlockは、学習者のキーを入力してGoogleへ直接通信する。robot/chatのAPIサーバー起動は不要。uroa側はViteを起動する。

```powershell
cd D:\usr\prj\uroa
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

`http://127.0.0.1:5173/diagram/index.html`を開き、[ai-chat.json](../public/diagram/data/ai-chat.json)をcanvasへドロップする。AIChatBlockの「接続」を押し、自分のAPIキーとモデル名を入力する。旧バックエンドで別のGEMINI_MODELを使っていた場合は同じ名前を指定する。接続確認後、質問を編集してStartを押す。同じブロックならキーの再入力なしに質問を繰り返せる。「キー変更」で再設定、「切断」でキーを解除する。送信中は回答出力が空で、全文受信後だけTTSが読み上げる。手で作る場合はInputTextBlockの文字列出力をAIChatBlockの上側入力へ、AIChatBlockの下側出力をTTSBlockの文字列入力へ接続する。AIChatBlockはFunctionBlockなので手続き用のtop/bottom接続は不要。全AI回答を待ってから、単独のTTSBlockも実行される。ツールボックスのAIChatBlockはBLE・IMU・Plotの次に置く。

Stop、Clear、別JSONの読込、実行中のブロック削除、pagehide・破棄は待機を中断する。空入力・キー未設定・通信失敗・空／不正回答・35秒タイムアウトではTTSへ進まない。接続確認は10秒でタイムアウトする。通常のStopでは保持済みキーを維持し、切断・AIブロック削除・Clear・図読込・pagehide・破棄で解除する。キーは各ブロックのprivateフィールドへ一時保持し、入力確定後にダイアログを消去する。Downloadとコピーにはキー・回答・送信状態を含めず、質問文・配線・モデル名は保存する。localStorage・sessionStorageへ保存せず、URL・ログへキーを含めない。ブラウザーの開発者ツールから完全に隠せる設計ではない。

ブラウザーからGoogleのモデル情報取得で接続を確認し、質問はInteractions APIのRESTへ直接送る。Googleとの通信はHTTPS。静的HostingでもAPIプロキシ不要で、旧 `/api/ask` プロキシは解除した。`/api/save`はuroaの開発用保存処理を維持する。

AI専用のブラウザーテストは [tests/ai-chat-browser.test.mjs](../tests/ai-chat-browser.test.mjs)。以下のPlaywright・Chrome環境変数を使い、ソース変更後に専用Viteを再起動して実行する。

```powershell
$env:UROA_TEST_BASE_URL = 'http://127.0.0.1:5173/'
$env:UROA_PLAYWRIGHT_MODULE = '.\tmp\p0\tools\node_modules\playwright-core\index.mjs'
$env:UROA_BROWSER_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node --test tests/ai-chat-browser.test.mjs
```

AI APIと音声出力は模擬する。通常応答、編集時の非送信、空・未接続・長すぎる入力、通信／HTTPエラー、空・不正JSON・非文字列回答、Stop・Clear・図読込・AI／入力／TTS削除・破棄・pagehide、本文待機中の中断、遅い旧応答、タイムアウト、依存順の実行、コピー・Download・JSON配線復元、720px画面での配置・DOM追従を確認する。接続ダイアログのcanvasクリック、入力欄消去、2問でのキー再利用、private保持・JSON非保存、切断後の未認証、接続中の切断・Clear・Stop・pagehide、接続失敗時のキーとエラー本文の非表示も確認する。

[tests/ai-chat-integration.test.mjs](../tests/ai-chat-integration.test.mjs)は明示指定時だけ実Googleモデルへ1問を送る。上記Viteと環境変数を準備し、次を実行する。テストプロセスが既存robot/chat/.envを読み、GEMINI_API_KEY・GEMINI_MODELを使って画面に入力する。既存.envを変更・コピーせず、キーはログへ出さない。アプリ自体は.envを読み込まない。

```powershell
$env:UROA_AI_LIVE_TEST = '1'
node --test tests/ai-chat-integration.test.mjs
Remove-Item Env:UROA_AI_LIVE_TEST
```

この実通信テストはデモJSONを読み込み、ブロック内でキー入力 → Googleへ接続確認 → 直接Interactions API → 出力文字列 → 既存TTSBlock・Speechの音声出力呼出しまで確認する。スピーカー出力だけを模擬する。`/api/ask`呼び出しが0件であること、保存とログにキーを含めないこと、`/api/save`の保存内容も確認し、検証用保存ファイルは削除する。質問と回答、.env、SDK内部エラーはテスト結果へ出力しない。

純粋なREST応答解析・エラー本文非公開・取消は、TypeScriptビルド後に `node --test tests/ai-client.test.mjs` で確認する。直接方式への変更後、実通信2件とNodeのAI3件・ライフサイクル5件、npm.cmd run verifyが成功した。画像で接続ボタン・キー保持表示・回答欄を確認した。音声出力・Android・公開デプロイは未確認。

直接方式のChrome検証は29項目が成功した。全体実行では28件が成功し、保存・復元の1件は画面初期化待ちでタイムアウトしたため、同じ最終ソースで単独再実行して成功を確認した。実質問・キー保持・保存復元に進む前の初期化タイムアウトであり、既存CDNを含む起動環境の制約として記録する。

直接方式の追加後も既存tests/test_lifecycle.pyが成功した。5画面の初期化・重複起動・破棄、diagramのStop・再実行、movie/game/WebGPUへの委譲停止、初期化失敗時の片付けを確認した。初回は起動待ちタイムアウトが出たため、単独再実行でNODE_OPTIONS=--max-old-space-size=4096を指定した。

初期のExpress方式では、2026-10-13に5187番のViteと既存3001番のExpressを使い、実通信2件、AI専用ブラウザーテスト23件、既存Nodeテスト15件、robot/chatのAPIテスト5件が成功した。最終の文字列表示調整後にAI専用23件とnpm.cmd run verifyを再実行し、画像で回答欄とポート表示を確認した。既存tests/test_lifecycle.pyも5画面の初期化・破棄、diagramの待機取消・再実行・子アプリ停止、初期化失敗時の片付けが成功した。APIキー・モデル・.env・robot側ソースは変更していない。

検証環境の制限により、Chromeの既存CDN取得とtsx起動は隔離環境外で実行した。既存BLEテストの「IMU streams a converted immutable struct through one port and logs it once」は現在のHEADでコメントアウトされたIMUのconsole.logを待つため失敗する。ログ有効化や既存テスト変更は今回のAI追加に含めない。

既存BLE・サーボ・IMU・Plotの残る23件は、最終ソースで上記ログ待ち1件を除いて再実行し、すべて成功した。ソース更新中の実行では3件に状態待ちタイムアウトが出たため、再実行は更新後にViteを再起動して行った。

既存tests/test.pyは公開ビルド4178番でWebGPU・game・diagram・algebra・movieの全5アプリが成功した。開発版の初回実行はPlaywright driverが途中終了したため、公開版の単独再実行でNODE_OPTIONS=--max-old-space-size=4096を指定した。Python 3.12と既存tmp/ble-run-python.pyを使い、元の回帰テストソースは変更していない。

## 構造体ポートとBLE・サーボ・IMU・Plotブロックの確認

`tests/ble-browser.test.mjs` はVite開発サーバーとテスト用Chromeを使う。実Web Bluetooth APIは模擬し、ツールボックスからの配置、canvasのクリック／タップ・ドラッグ取消、機器選択取消、非対応機器、INFO ACK・PING、接続途中のClear、共有状態、JSON保存・復元、画面終了、ACKタイムアウトを確認する。IMUについては単位変換・構造体入力への伝播・数値ポートへの接続拒否・console出力・10Hz STREAMの共有と停止・IMU未検出・不正パケット・切断時の値の解除・型の保存復元も確認する。実ESP32・無線・Android実端末の確認にはならない。既存diagramのCDN依存も読み込むため、ネットワークが必要。

Plotの追加確認は、Portの有効型・両端への配線通知、測定前のField解析、実PlotlyのRGB描画、1秒ごとの3σ範囲更新、IMU以外のStruct、ブロック移動への追従、JSONによる配線復元、Clear・破棄・ライブラリ読込中のClearを含む。Plotly自体は模擬せず、BLEだけを模擬する。

サーボの追加確認は、現在のToolItemツールボックスからの配置、数値ポート配線、明示ARM、角度の100倍変換、CH・時間のパケット、入力範囲検査、即時MOVE、停止時の未送信指令取消、IMU通知の継続、CH変更、ARM書込中の削除、PCA未検出、ACKタイムアウト、全OFF通知、再接続、JSON・コピー・旧JSONのduration省略を含む。計算伝播でMOVEを重複送信しないことと、アプリStopがPWMのみを止めることも確認する。ESP32とPWM出力は模擬であり、実サーボの動作確認ではない。

2026-10-13のServoMotorBlock追加後は `npm.cmd run verify`、Nodeテスト15件、模擬BLE・サーボ・IMU・Plot画面テスト22件が成功した。最終のポート表示修正・calc維持後にverifyとサーボ6件を再実行して成功し、実際の描画も画像で確認した。既存 `tests/test_lifecycle.py` は5画面の初期化・重複起動・破棄、diagramの長時間待機取消と再実行、movie/game/WebGPUへの委譲とStop、初期化失敗時の片付けが成功した。

ブラウザーテストはViteの5184番ポートとインストール済みChromeを使用した。最初は検証環境のネットワーク制限で既存CDNのdagreを取得できなかったため、CDNを読める実行環境でサーバーとテストを起動して確認した。Pythonテストには既存のPlaywright環境とPython 3.12を使った。実ESP32への送信、実サーボ、Android、HTTPSデプロイは今回未確認。

同日の実機テスト報告後、保存した数値欄が出力ポートへ反映されず、サーボの入力がundefinedとなる読込経路を模擬ブラウザーで再現した。InputNumberBlockの数値復元とServoMotorBlockの配線時の値の取込みを修正し、ARM/MOVEのコンソール送信・ACKログも追加した。追加テストは保存値81°の復元と、実際の [ble-imu-pca9685.json](../public/diagram/data/ble-imu-pca9685.json) を使った接続・ボタンクリック・入力変更・IMU併用・表示・コンソールログを確認する。実機の不反応が解消したかは別途確認する。

この修正後、5186番ポートのViteと模擬BLEでサーボテスト8件が成功した。受信結果の表示とコンソールのARM/MOVE送信・ACKログを確認し、`npm.cmd run verify`も成功した。入力値・移動時間・配線など、提供されたデータファイルの内容は変更していない。

サーボを実機で確認するときの操作例は次のとおり。

1. BLEConnectionBlock、InputNumberBlock、ServoMotorBlockを配置し、数値出力をサーボの入力ポートへ配線する。
2. BLE接続ボタンでESP32へ接続し、ServoMotorBlockでCH（例: 0）と時間（例: 1000ms）を指定する。
3. 「90°で有効化」を押す。この操作で90°のPWM指令が出る。
4. 数値入力へ105を入れる、または入力済みなら「入力角度へ移動」を押す。60～120°の範囲で値の変更に追従する。
5. 「このCHを停止」と「全サーボ停止」を確認する。停止後・再接続後は改めて有効化する。IMUを併用していれば、全サーボ停止で計測通知は継続する。

以前の即時指令に合わせる場合は移動時間を0msにする。初期1000msでは、その時間をかけて目標へ補間する。コンソールの`Servo input`で入力角度・armed状態、`BLE servo send`で送信、`BLE servo ACK`でESP32の受付を確認できる。入力変更だけで毎回有効化をやり直す必要はない。

実行例（別ターミナルでViteを起動）。`playwright-core`はテスト用の補助フォルダーなどに準備し、モジュールの入口とChromeの実際のパスを指定する。アプリの実行時依存ではない。

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 5175 --strictPort
# 別ターミナル
$env:UROA_TEST_BASE_URL = 'http://127.0.0.1:5175/'
$env:UROA_PLAYWRIGHT_MODULE = '.\tmp\p0\tools\node_modules\playwright-core\index.mjs'
$env:UROA_BROWSER_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node --test tests/ble-browser.test.mjs
```

ソース編集によるHMRの更新時刻付きimportと、テストの直接importが別のモジュールインスタンスになることがある。テストが画面と同じ共有接続を参照するよう、専用のViteサーバーをソース変更後に起動してから実行する。

純粋な型定義のテストはブラウザー不要。先にTypeScriptをビルドし、入れ子の検証・複製・freeze・型参照の復元・登録エラーを確認する。

```powershell
npm.cmd run build:all
node --test tests/data-type.test.mjs tests/plot-data.test.mjs tests/lifecycle.test.mjs
```

`plot-data.test.mjs` はFieldからのパネル・系列の生成、母標準偏差、系列別の平均を使う3σ範囲、定数・空データの軸、履歴の時間窓・最大件数、入力検証を確認する。

公開ビルドのPlotly読込は、ソースモジュールを直接importしない専用テストで確認する。ビルド完了後にpreviewを起動し、実際のcanvas操作でIMUとPlotを配置・接続する。

```powershell
npm.cmd run verify
npm.cmd run preview -- --host 127.0.0.1 --port 4177 --strictPort
# 別ターミナル。上記のPlaywright・Chromeの環境変数も設定する
$env:UROA_PREVIEW_BASE_URL = 'http://127.0.0.1:4177/'
node --test tests/plot-preview.test.mjs
```

IMUの初回実装時（2026-10-12）に `npm.cmd run verify`、構造体型のNodeテスト5件、ライフサイクルのNodeテスト5件、模擬BLE・IMU画面テスト12件が成功。後者はタブ非表示・ブラウザー非対応時の無効化と、既存手続きブロックのドラッグ・ポート接続も確認した。

同日のPlotBlock追加後は `npm.cmd run verify`、Nodeテスト15件（型5・グラフデータ5・ライフサイクル5）、模擬BLE・IMU・Plot画面テスト16件、公開版のPlot確認1件が成功した。公開版ではローカルのPlotlyチャンク読込とcanvasによるIMU→Plot配線を確認した。実際のグラフ表示でField名、RGB、左右のパネル、凡例・時間軸の配置を画像でも確認した。

既存5アプリの回帰テストも公開版4177で成功した。開発版の確認中にPlaywright driverが終了したため、単独の公開版再実行ではNODE_OPTIONS=--max-old-space-size=4096を設定した。元のテストソースは変更していない。検証中に一度、公開成果物のWebGPU資産が欠けた状態で起動に失敗したため、単独でverifyを完了して静的確認と公開版のブラウザー確認をやり直した。PlotBlockの実機・Androidでの表示とHTTPSデプロイは未確認。ユーザーからのIMU実機確認報告と区別する。

構造体・IMUの追加後も、既存 `tests/test.py` のWebGPU・game・diagram・algebra・movieが成功した。WindowsのPythonランチャーが変わったため、今回だけ `tmp/ble-run-python.py` から既存の `tmp/p3-venv/Lib/site-packages` を読み、インストール済みChromeをheadlessで使った。元のテストソースは変更せず、無期限のconsole待機だけ実行時に60秒へ制限した。IMU追加後の実機接続、実Android、HTTPSへのデプロイは未確認。BLE接続自体はユーザーから動作確認済みとの報告がある。

`check:dist` はルートと5アプリのHTML、ローカルのscript・stylesheet・modulepreload参照、ルートの5アプリへのリンク、`webgpu/public/` からコピーする資産を確認する。未変換のTypeScript参照や欠落を検出すると終了コード1を返す。GPU計算、画像の正しさ、外部CDNの到達性は判定しない。

## 旧コマンドの扱い

`python build_all.py` は、スクリプトのあるuroaルートで `npm run build` を実行する入口となった。以前の子dist・公開資産の更新時刻による同期は廃止した。公開HTMLを開発用HTMLで上書きしない。npmの終了コードをそのまま返す。

`tsc-all.bat` は、バッチのあるuroaルートで `npm.cmd run build:all` を呼び、終了コードを返す。TypeScript対象の一覧は `tsconfig.sys.json` に集約する。

`web.py` はFlaskで `dist/` を配信する別の入口として継続する。今回、配信処理は変更していない。未使用の `vite.config.base.ts` と依存の削除は別作業とする。

## Python・Playwrightの準備

以前のテストを実行できたPython環境を優先して使う。新しい環境ではPython 3とPlaywright、Chromiumが必要。

```powershell
python -m pip install -r tests/requirements.txt
python -m playwright install chromium
```

WindowsでPythonランチャーを使う場合は、`python` を `py -3.12` など利用するPython 3の指定へ置き換える。npmの `test:e2e` はPATH上の `python` を使うため、同じ環境へPlaywrightを導入する。[Playwright公式手順](https://playwright.dev/python/docs/library)

`requirements.txt` は依存の宣言であり、現時点でPython版Playwrightのバージョンは固定していない。ユーザーが従来の確認に使った環境のバージョンは未取得。

## 回帰テストの実行

ターミナル1で対象のサーバーを起動し、ターミナル2でテストを実行する。`--strictPort` により指定ポートが使用中なら起動を止め、別ポートや別サーバーを意図せずテストすることを避ける。

開発環境:

```powershell
# ターミナル1
npm.cmd run dev -- --port 5173 --strictPort

# ターミナル2
npm.cmd run test:e2e -- --base-url http://localhost:5173/
```

公開ビルド:

```powershell
# ターミナル1
npm.cmd run verify
npm.cmd run preview -- --port 4173 --strictPort

# ターミナル2
npm.cmd run test:e2e -- --base-url http://localhost:4173/
```

Pythonから直接 `python tests/test.py --base-url http://localhost:4173/` でも実行できる。接続先は引数、環境変数 `UROA_TEST_BASE_URL`、既定値 `http://localhost:5173/` の順に決まる。

教材・座標操作・実行順（webgpu、game、diagram、algebra、movie）、画面を表示する設定、待機方法は既存テストのまま。`timeout=0` のコンソール待機も維持しているため、期待する通知が来ない場合は手動中断が必要となる。サーバーの自動起動・終了、CI用設定は追加していない。P3専用の確認は別のテストへ追加した。

## 操作JSONの保存・読込の確認

保存形式や操作クラスを変更するときは、既存の5アプリ回帰テストに加えて、次の専用テストを使う。Python・Playwrightの準備は上記と同じ。サーバーは別ターミナルで起動しておく。

```powershell
npm.cmd run dev -- --port 5173 --strictPort
# 別ターミナルで実行
python tests/test_operation_json.py --base-url http://localhost:5173/
```

`test_operation_json.py` はソースモジュールを読み込むため、Vite開発サーバーに対して実行する。previewには既存 `tests/test.py` を使う。公開教材22件、全7種類の操作、空データの読込→toJson→JSON文字列化→再読込を比較し、旧形式の拒否が画面を消去しないこと、編集画面のSaveと再生で操作・図形・関係ログが一致することを確認する。比較時は採番されるoperationIdを除く。ClickShape.toJsonは座標を小数2桁に丸めるため、任意精度の座標は完全一致せず、その例も結果に表示する。Firebaseへの実際の読み書きは含まない。

## P2での確認（2026-10-11）

- `npm.cmd run verify`: 成功。型診断なし、Vite 7.3.7、169モジュール変換、92項目コピー。gameの静的・動的importが混在する既存警告2件は残る。
- 成果物のコピーを使い、開発用WebGPU HTMLによる上書き、JS欠落、WebGPU資産欠落が終了コード1で検出されることを確認。
- `tsc-all.bat`: 成功。
- Python 3.12でPythonファイルの構文、およびビルド入口が成功0・失敗7を返すことを確認。
- `py -3.12 build_all.py` による実際の公開ビルドも成功。上の失敗7の確認はsubprocessを模擬した終了コード伝播の確認であり、実際のビルド失敗を起こしたものではない。
- Vite開発・preview配信でルートと5アプリのHTML、開発時の変換済みTypeScript入口、公開時のJSをHTTPで確認。サーバーは確認後に終了した。ブラウザー操作の確認ではない。
- 起動できたPython 3.12にはPlaywrightがないため、今回の回帰テストは未実行。過去の成功結果は [dependency-update.md](dependency-update.md) のユーザー実行結果と区別する。

## P3専用の確認

[起動・終了仕様](app-lifecycle.md)の変更では、既存テストに加えて次を実行する。Python環境とブラウザーの準備は上記と同じ。

```powershell
# 初期化順序、重複、失敗、初期化中の停止・破棄、後片付けの失敗
npm.cmd run test:lifecycle

# サーバーは別ターミナルで起動しておく
npm.cmd run test:e2e:lifecycle -- --base-url http://localhost:5173/
npm.cmd run test:e2e:lifecycle -- --base-url http://localhost:4173/
```

`tests/test_lifecycle.py` は5アプリの直接起動・重複起動・破棄、diagramの60秒待機の停止と再実行、子アプリの停止・画面復帰、停止後のGPU追加送信、HTTP失敗時の状態・破棄を確認する。確認用データは現行の保存形式で作り、旧教材の互換性とは分ける。

### P3での実行結果（2026-10-11）

- `npm.cmd run verify`: 成功。TypeScript診断0、173モジュール変換、92項目コピー、成果物チェック成功。既存のimport混在警告2件は残る。
- `node --test tests/lifecycle.test.mjs`: 5件成功。
- 既存 `tests/test.py`: 開発サーバー5183とpreview4183の両方でwebgpu・game・diagram・algebra・movieすべて成功。
- P3専用のブラウザ確認: 開発5183・preview4183の両方で成功。5アプリの直接・重複起動と破棄、60秒待機の停止・再実行、diagramからmovie・game・webgpuの停止と復帰、停止後500msのGPU追加送信なし、HTTP失敗時の状態と後片付けを確認。

検証中、複数のブラウザーを並行実行した回ではPlaywrightのdriverがメモリ不足で終了した。単独実行で確認する。連携テストで見つけたWebGPUの資産パスとmovie停止後の件数assertは修正済み。ブロック用のテスト入力もInputNumberBlockのvalueとInputTextBlockのtextに合わせた。

検証では作業フォルダー内の `tmp/p3-venv` にPython 3.12・Playwright 1.63.0を準備し、既存のChromiumを使用した。通常の実行コマンドのPython環境は利用者の環境で準備する。`tests/test.py` のSHA256は変更前後とも `FE2F4527A91AAFEDF7C23326280C3EC2BCB44D9C4DEC9037E90F76C5885886FD`。

音声を実際に聞いての確認、全GPUデモの数値・停止、Android、ESP32、Firebaseの外部操作は未検証。GPU停止の専用確認はdiagram経由のfdtdパッケージを対象とする。
