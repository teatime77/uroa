# 現状確認と改修前の基準

初回確認・修正後確認: 2026-10-10（日本時間）。初回の失敗記録は履歴として残し、最新結果は末尾の「修正後の確認」に記録する。[改善計画](improvement-plan.md)のP0として、現行ソースの機能索引、Git状態、ビルド、5画面の起動と代表操作を確認した。機能の入口は [features.md](features.md)、全体構成は [architecture.md](architecture.md) を参照する。

**開発環境では5画面の表示と一部の代表操作を確認できた。一方、型確認は失敗し、ルートViteビルドの配信では5アプリの正常起動を確認できなかった。** これらを改修前の既知の問題として記録する。全機能の検証や回帰テストの導入完了を意味しない。

## 確認した環境・ソース

| 項目 | 今回の条件 |
|---|---|
| OS・作業場所 | Windows、PowerShell、D:/usr/prj/uroa |
| Node.js / npm | v24.21.0 / 11.3.0 |
| 実際のインストール済み依存 | TypeScript 5.9.3、Vite 7.3.2、KaTeX 0.18.5、esbuild 0.27.3 |
| ブラウザ | Chrome 154.0.8037.98、headless、隔離したコンテキスト |
| 表示条件 | 1280×800、locale ja-JP |
| 開発 / ビルド後配信 | http://127.0.0.1:5174/ / http://127.0.0.1:4174/ |
| 親リポジトリHEAD | d279763827bced4640a008db83900bead04fbf20 |
| 乱数 | 代表操作の確認ではMath.randomをseed 123のLCGに置換。時刻・音声・GPUの観測時点は固定していない |

親と13サブモジュールのコミット、変更・未追跡ファイル、robotの移行対象を [inventory.json](validation/2026-10-10/inventory.json) に記録した。採取時点で13サブモジュールにはGit差分がなかった。robotには既存の.gitignore・chat/package.jsonの変更と、未追跡のchat実装・設定・文書がある。移行時にHEADのファイルだけを取り込むと不足する。

今回はソース・依存設定を改修していない。診断用のplaywright-core 1.64.0は無視対象のtmp/p0/toolsだけに導入した。型確認で生成されたlibなどと、algebra起動時の既存保存APIによるpublic/algebra/output/output.mathも無視対象。文書・確認証跡は未コミットのまま残している。

## ビルド・既存テストの結果

| 確認 | 結果 | 内容 |
|---|---|---|
| tsc -b tsconfig.sys.json | 失敗・終了コード1 | KaTeX由来2件、game由来5件の診断 |
| ルートVite build | 成功・終了コード0 | 169モジュール変換、WebGPU資産93件コピー。ブラウザでの正常起動とは別 |
| WebGPU builderの既存selftest | 成功 | esbuildでNode用に束ねて実行し、ts/builder/selftest.ts: okを確認 |
| build_all.py / Flask web.py | 未実行 | Python 3の実行環境を起動できなかった |
| Firebase Hostingへのデプロイ | 未実行 | 今回はローカル配信だけを確認 |

実行した型確認とビルドのコマンド:

```powershell
node node_modules/typescript/bin/tsc -b tsconfig.sys.json --pretty false
node node_modules/vite/bin/vite.js build --outDir .qa-build --emptyOutDir false
```

新規の.qa-buildに出力し、その生成物だけをtmp/p0/distへ移動してpreviewで配信した。既存distには上書きしていない。Viteビルドではgame/index・isometricの静的importと動的importが共存し、動的importによる別チャンクにならない旨の警告が出た。

型診断の内訳:

- node_modules/katex/src/Parser.ts:17、18: TS7016。unicodeAccents.js / unicodeSymbols.jsの型宣言がない。
- game/ts/isometric/isometric.ts:96、102、111、112: TS2739。UIをTextUI / Labelとして扱う箇所で必要なプロパティが不足。
- 同ファイル:163: TS2345。UIをLabel引数へ渡せない。

Viteの変換成功からTypeScriptの型確認成功を推定しない。builder selftestはJSON入出力とDSLコード生成などの確認で、GPU計算の妥当性の確認ではない。

Pythonはpython.exeがアクセスエラーとなり、py -3.12もWindowsAppsの実行ファイルを起動できなかった。build_all.pyは子プロジェクトのビルド・資産同期を行う別経路であり、その完成物の動作を今回のルートViteの結果から断定しない。

## 5アプリの確認表

トップのindex.htmlにある5リンクを実際にクリックして開発環境・ビルド後配信を確認した。下表の代表操作は開発環境で行った。JavaScript例外、HTTPエラー、通信失敗も採取した。

| アプリ | 開発環境の起動・代表操作 | ルートViteビルド後の配信 | 未確認の主な範囲 |
|---|---|---|---|
| algebra | 数式・証明データ表示、最初の式のドラッグ選択で.ast-selectedが1件 | 数式は表示されるが、POST /api/saveが404となりSave failed: 404で初期化処理が中断 | 全証明・簡約処理の完了、式変形の正しさ、音声 |
| game | 等角投影マップ、10までのたし算、999の不正解判定と次問9の正解判定 | /diagram/ts/index.tsが404。画面のHTMLだけではアプリが起動しない | 全問題・全ゲーム、5問完走、音声、タッチ操作 |
| diagram | 編集画面、既存JSONのドロップ読込・Download・Clear、空の図のStartを確認。旧サンプルのテキスト保存に問題あり | 同じ入口TSが404 | 接続済みの計算・条件・待機の実行、実行中停止、他アプリ起動と復帰、実機 |
| movie | 画面表示。公開readDocJson APIでローカルdoc 1を早送りし、35操作・16図形の状態を確認 | 同じ入口TSが404 | 通常の画面操作での教材選択、音声同期の再生、途中停止・再実行、最終描画の基準比較 |
| webgpu | 画面表示、schema=ballの球の描画、Captureで800×800のPNG保存。公開停止APIが戻ることを確認 | 同じ入口TSが404 | GPU数値の期待値・保存量、決まったステップでの画像、停止後不変、残り13schemaと従来デモ |

ブラウザの観測値とエラーは [observations.json](validation/2026-10-10/observations.json) に保存した。entryMarkerは入口側で初期化処理の完了前に設定されるため、trueだけで合格にしない。例外がないこと、Canvasやボタンが存在することも、全機能の成功を意味しない。

開発時のdiagram・movieでは、HTML内のFirebase compatスクリプトとinit.jsへの要求がnet::ERR_BLOCKED_BY_ORBとなった。該当URLも証跡に記録した。モジュール側の初期化とローカル操作は進んだが、クラウド連携の成功を意味しない。認証操作、Firestore/Storageへのユーザーデータの書込みは行っていない。

最初の制限環境ではCDN読込がnet::ERR_NETWORK_ACCESS_DENIEDとなり、gameにdagre is not definedが出た。ネットワークを利用できる隔離Chromeで再確認するとその例外は出なかった。この環境由来の失敗はアプリの不具合件数へ加えていない。組込みBrowserツールも接続準備時にカーネル資産のパスエラーとなり、既存Chromeでの確認へ切り替えた。

## 固定入力と再確認の手順

教材・資産8ファイルのSHA-256をinventory.jsonへ記録した。確認時点の入力を識別するためのもので、今後の意図した教材変更を禁止する基準ではない。

| 対象 | 今回使用した入力 | 操作・実際の結果 |
|---|---|---|
| algebra | public/algebra/formula/example.mathと画面既定の式 | 開く→最初の.math-containerをドラッグ。選択クラス1件。約2秒後の観測にとどまり、algebra OKまでの完了確認はしていない |
| game | public/game/data/map.json、stage/ArithFormEx.json、seed 123 | 10までのたし算をクリック→8+1に999・Enter→NG→次の5+4に9・Enter→OK |
| diagram | public/diagram/data/diagram.json | ファイルを編集Canvasへドロップ→Download。TTSBlock 1件だがtextが消える→Clearで0ブロック→空のStartはStart表示へ戻る |
| movie | public/movie/all-kyozai.json、doc id 1 | 公開APIで既存データを渡して早送り。入力35操作・再生後35操作、図形16件。図形数は今回の観測値で、独立した正しさの判定ではない |
| webgpu | webgpu/public/engines/physics/ball/ball.json・ball.js・ball.wgsl | /webgpu/index.html?schema=ball→Capture。PNGヘッダー、800×800、903452 bytesを確認。stopGraphSchemaAnimationを呼び出して復帰を確認 |

ゲームの再現用乱数は次の置換を、アプリのスクリプト読込前に隔離したブラウザへ設定した。普通に開くだけでは同じ問題列にならない。

```javascript
let seed = 123;
Math.random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
```

movieの再確認は開発画面を開いてから、ブラウザのコンソールで以下の公開APIを呼ぶ。クラウドの教材一覧取得を伴う?id=1経路とは区別する。

```javascript
const movie = await import('/movie/ts/index.ts');
const flow = await import('/movie/ts/flow.ts');
await movie.readDocJson(flow.allData.docs, 1);
const { GlobalState } = await import('/plane/ts/inference.ts');
console.log(GlobalState.View__current.operations.length,
            GlobalState.View__current.shapes.length); // 今回は35、16
```

手動確認用の起動コマンド例。ビルド出力には新しい作業用フォルダーを選び、既存成果物を上書きしない。

```powershell
# 開発環境
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174 --strictPort

# 別ターミナル: 再確認用のビルドと配信
node node_modules/vite/bin/vite.js build --outDir tmp/p0/recheck-dist --emptyOutDir false
node node_modules/vite/bin/vite.js preview --outDir tmp/p0/recheck-dist --host 127.0.0.1 --port 4174 --strictPort
```

画面証跡: [algebra選択](validation/2026-10-10/action-algebra.png)、[game採点後](validation/2026-10-10/action-game.png)、[ballのCapture](validation/2026-10-10/ball-capture.png)。時刻・GPU進行を固定していないため、回帰テスト用の基準画像ではない。movieは早送りで内部状態を確認したが、教材一覧の表示が残る画面を最終図形の描画成功の証拠にはしていない。

## 確認できた問題と次の作業

| ID | 問題とソース上の対応 | 次に行う修正・確認 |
|---|---|---|
| STATE-01 | ルートViteではpublicの4画面がTS入口のままコピーされる。[vite.config.ts](../vite.config.ts)のbuildAlgebraPagePluginはalgebraだけを書換える | 5画面の公開用入口を揃え、ルートリンクと直接URLを開発・ビルド後の両方で確認。ソースHTMLの開発用参照も保つ |
| STATE-02 | [initAlgebra](../algebra/ts/index.ts)→[testProof](../algebra/ts/math_file_parser.ts)が起動時に保存APIを要求。saveDataPluginはconfigureServerでのみ実装 | 初期化と開発用出力保存の責任を分け、静的配信でAPI不在でも必要な処理が完了する仕様を決める |
| STATE-03 | 上記のTypeScript診断7件 | KaTeXの型宣言とgameの取得値の型を原因ごとに修正。広いany化で消さず、型確認と画面の両方を確認 |
| STATE-04 | 旧diagramサンプルはTTSBlock.textと2ポート。現在の[TTSBlock](../diagram/ts/procedure.ts)は3番目の入力ポートから文字列を得るため、読込・再保存で旧textが消える | 旧データの互換処理か教材の移行を決める。旧サンプル・現行形式の両方で内容と接続を比較し、TTSを実行する |
| STATE-05 | diagram・movieのHTMLに残るFirebase CDN要求が失敗 | スクリプトのURL・必要性とモジュール側実装を整理し、ローカルと認証・保存の確認を分ける |
| STATE-06 | Python 3が起動できず、一括ビルド経路が未確認 | 実行環境を整備してbuild_all.pyの成果物を別途確認。現在のルートVite確認と混同しない |

旧diagramの再保存結果は [diagram-roundtrip.json](validation/2026-10-10/diagram-roundtrip.json) に残した。この問題は既存教材と現行データ形式の不一致として確認したもので、現行形式で新規作成した全ブロックの保存が壊れているとは断定していない。

最初はSTATE-01・02・03を小さな変更として直し、再確認する。その後、STATE-04に対応した接続済みブロック図と、algebraの完了、movieの指定操作までの通常再生、WebGPUの決まったステップでの観測をP1のシナリオにする。失敗中の画面や変動するアニメーション画像を正常な基準として登録しない。

今回のP0は機能索引と初回の現状記録まで。P1の継続実行できるブラウザテスト、初期化完了通知、時計・音声・GPU進行の制御はまだ実装していない。Android、Firebase実サービス、マイク、ESP32実機、robotのビルド・既存APIテストも今回の実行対象外。

## 修正後の確認（2026-10-10）

ユーザーの承認に基づきSTATE-01・02・03を修正した。上記の型診断と公開用入口・起動時保存の失敗は改修前の記録であり、以下が今回の修正後の結果。STATE-04・05・06は修正対象に含めていない。

| 項目 | 修正内容・結果 |
|---|---|
| 公開用入口 | buildAppPagesPluginで5画面を生成し、全画面が../main.mjsを参照することを確認。ソースHTMLはTypeScript参照のまま維持 |
| WebGPUのコピー | ビルド時だけindex.htmlをコピー対象から除外。資産コピー92件、開発時の収集は93件。開発・ビルド後のschema=ball描画と800×800のPNG保存を確認 |
| algebraの読込・保存 | testProofは読込・解析、saveProofOutputは出力保存。起動時保存はimport.meta.env.DEVの条件内。公開時の保存要求0件、JavaScript例外なし |
| 開発時の保存成功 | /api/saveが200。後続の簡約5件とalgebra OKまで完了 |
| 開発時の保存失敗 | /api/saveを503へ模擬。保存失敗の警告が出て、後続の簡約5件とalgebra OKまで完了 |
| 公開時の完了 | 保存APIを呼ばず、後続の簡約5件とalgebra OKまで完了 |
| 型確認 | tsc -b tsconfig.sys.json --pretty falseが終了コード0、診断0件 |
| Viteビルド | tmp/p0/fixes-distへの新規出力が終了コード0、169モジュール変換。既存distは上書きしていない |
| 5画面の起動 | 開発・ビルド後のトップの5リンクから画面を開き、ローカル資産のHTTPエラー・JavaScript例外なし。gameのマップ、diagram/movieの動的UI、algebraの数式と簡約処理への進行を確認 |
| gameの代表操作 | seed 123で8+1に999→NG、次の5+4に9→OKを再確認 |

型診断の修正はalgebra/ts/manipulation.tsの未使用assembleSupSub import削除と、game/ts/widget/core.tsのButton/Labelオーバーロード・import type追加。登録方式と実行時のUI生成処理は維持した。

algebraの3通りの完了確認は、隔離ChromeでspeechSynthesis.speakの音声終了イベントだけを模擬した。実際のexample.math・画面の5式を読込・解析・簡約するアプリ処理は差し替えていない。通常の音声再生を含む全動作が検証済みとは扱わない。

証跡は [修正後observations.json](validation/2026-10-10-fixes/observations.json)。ソース5ファイルのSHA-256、起動10ケース、保存条件3ケース、ゲームの採点結果を記録した。画面は [ビルド後algebra](validation/2026-10-10-fixes/built-algebra.png)、[ビルド後WebGPU](validation/2026-10-10-fixes/built-webgpu.png) に保存した。画像はアニメーション時刻を固定した基準画像ではない。

diagram/movieの既存Firebase CDN要求は引き続きERR_BLOCKED_BY_ORBとなる。今回の画面起動の合否はローカルの入口・UIを対象とし、この外部通信失敗は別の残件として証跡に残した。Viteの既存チャンク警告も残る。Python一括ビルド・Firebase実サービス・Android・ESP32は今回未確認。

次はSTATE-04の旧diagramデータの互換性を整理し、P1の継続的な回帰テストを導入する。今回はサブモジュール構成を変更せず、algebraとgameの変更はそれぞれの作業ツリーに未コミットのまま残した。
