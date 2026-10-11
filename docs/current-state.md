# 現状確認と改修前の基準

初回確認・修正後確認: 2026-10-10（日本時間）。初回の失敗記録は履歴として残し、最新結果は末尾の確認記録に追記する。[改善計画](improvement-plan.md)のP0として、現行ソースの機能索引、Git状態、ビルド、5画面の起動と代表操作を確認した。機能の入口は [features.md](features.md)、全体構成は [architecture.md](architecture.md) を参照する。2026-10-11のP3確認は [build-and-test.md](build-and-test.md) に記録する。

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

## 2026-10-11: P3の確認

単一リポジトリ化とビルド統合後、共通入口・起動・停止・破棄を整理した。[起動・終了仕様](app-lifecycle.md) と [実行手順・検証結果](build-and-test.md) に現行の構成を記録する。

- 共通入口は `app/ts/main.ts`、実行状態管理は `app/ts/lifecycle.ts`、diagramのチェーン・停止・待機は `diagram/ts/runtime.ts`。
- `npm.cmd run verify` 成功。TypeScript診断0、公開HTML6ページと92項目のWebGPU資産を確認。
- `npm.cmd run test:lifecycle` は5件成功。
- 既存 `tests/test.py` は変更せず、開発・previewの両方で5アプリ成功。単独での開発環境の最終再実行も全アプリ成功。
- `tests/test_lifecycle.py` は開発・previewの両方で成功。直接・重複起動と破棄、60秒待機の停止・再実行、diagramからmovie・game・webgpuの実行と停止・画面復帰、停止後のGPU追加送信なし、初期化失敗の後片付けを確認。

連携確認で見つけたdiagram経由のWGSL取得先と、movieの停止後に全操作完走を前提とするassertは修正した。旧diagram教材の互換性、Firebaseの機能、全GPUデモの数値・停止、実際の音声、Android・ESP32はこの確認で解決・検証済みとは扱わない。作業用のVite・previewサーバーは検証後に終了する。

## 2026-10-11: P4の幾何計算の先行分離

`plane/ts/all_functions.ts` から `calcFootFrom2Pos`、`distanceFromLine`、`calcCirclePointTangent` を `plane/ts/geometry_math.ts` へ移した。既存の参照用の再exportを維持し、`geometry.ts`、`shape.ts`、`tool.ts` は新しいモジュールを直接参照する。[機能索引](features.md) のPLANE-05と [構成文書](architecture.md) を更新した。

- `npm.cmd run verify`: 成功。TypeScript診断0、Vite 7.3.7で174モジュール変換、92項目コピー、公開HTML6ページと資産チェック成功。既存の静的・動的import混在警告2件は残る。
- TypeScriptの構文木で変更前のHEADと比較し、移した3関数の宣言・処理、および `all_functions.ts` と利用側3ファイルのその他の処理が一致することを確認。生成した `plane/lib/geometry_math.js` に実行時importがないことも確認。
- 既存 `tests/test.py` を開発サーバー `http://127.0.0.1:5183/` に対して実行し、webgpu・game・diagram・algebra・movieすべて成功。
- 同じテストをpreview `http://127.0.0.1:4183/` に対して実行し、5アプリすべて成功。
- Python環境は前回準備した `tmp/p3-venv` とChromiumを使用した。テストファイルのSHA256は変更前後とも `FE2F4527A91AAFEDF7C23326280C3EC2BCB44D9C4DEC9037E90F76C5885886FD`。

確認用の開発・previewサーバーは終了した。今回は計算式や退化入力の扱いを変更していない。図形を再計算する交点処理、関係管理、保存復元、再生、画面イベント、AppServicesの整理は後続の作業とする。

## 2026-10-11: P4の関係管理の分離

`all_functions.ts` の関係管理51関数を `relations.ts` に移し、点の並び順判定2関数を `geometry_order.ts`、planeのログ出力を `logging.ts` に分離した。`all_functions.ts` は2,381行から1,543行になった。共有状態とAppServicesの接続は維持し、利用側12ファイルと公開入口の参照先を更新した。機能索引と構成文書も更新した。

- `npm.cmd run verify`: 成功。TypeScript診断0、Vite 7.3.7で177モジュール変換、92項目コピー、公開HTML6ページと資産チェック成功。既存の静的・動的import混在警告2件は残る。
- TypeScriptの構文木で、移した58個の宣言・処理（公開関数54件、非公開補助関数2件、内部コレクション2件）と残した処理が変更前と一致することを確認。利用側と公開入口の処理本体、既存exportの名前も保持した。移した処理から使う `assert`・`range` は、従来のローカル定義と同じ実装であることを確認。
- 生成したJavaScriptの依存をたどり、新しい3モジュールからplane内の実行時import・再exportを経由して `all_functions.ts` や `index.ts` へ戻る経路がないことを確認。
- 開発サーバー上の追加確認では、点・直線・円の登録と検索、平行・垂直、等長・等角、初期化・再計算、18件の関係ログの取り消し・再適用と同じログの再利用を確認。互換exportの51関数が新しいモジュールの関数と同じ参照であることも確認。関係データの対象は最小限のオブジェクトを使用し、通常の画面操作は次の回帰テストで確認した。
- 既存 `tests/test.py` を開発 `http://127.0.0.1:5183/` に対して実行し、webgpu・game・diagram・algebra・movieすべて成功。
- 同じテストをpreview `http://127.0.0.1:4183/` に対して実行し、5アプリすべて成功。
- Python環境は既存の `tmp/p3-venv` とChromiumを使用した。`tests/test.py` のSHA256は変更前後とも `FE2F4527A91AAFEDF7C23326280C3EC2BCB44D9C4DEC9037E90F76C5885886FD`。

確認用の開発・previewサーバーは終了した。今回は関係処理の本体と公開APIを維持する責任分割であり、関係推論の仕様変更は行っていない。保存復元、再生、画面イベント、AppServicesの役割整理は後続作業として残る。

## 2026-10-11: 旧図形JSONの保存・復元の廃止

ユーザーがplaneのmsgをi18nへ統一してlogging.tsを削除し、未使用のmovie内lesson機能も削除した後、旧図形JSONの処理を廃止した。前節のlogging.tsの作成は当時の作業記録であり、現在の構成ではない。

planeのmakeObj 34メソッド・toObj 1メソッド、registerEntity 41箇所、レジストリ、parseObject・loadData・anyToObj、旧形式のファイルdropとイベント登録、Widget__refMap・Widget__isLoading・Widget__processedを削除した。movieのFirebase読込経路はversion 2未満・versionなしのデータを非対応としてエラーにする。図形生成とID管理、操作記録の保存・読込・変換・再生、diagramとFirebaseの独自JSON保存は維持した。

- `npm.cmd run verify`: 成功。TypeScript診断0、Vite 7.3.7で175モジュール変換、92項目コピー、公開HTML6ページと資産チェック成功。既存の静的・動的import混在警告2件は残る。
- 旧形式の識別子・変換メソッドの参照がplane・movieの管理対象TypeScriptソースからなくなったことを確認。構文木で残る514関数・メソッド等を変更前と比較し、旧参照マップへの書き込みとdropイベントの登録を除き、処理本体が一致することを確認した。操作保存・読込・再生の処理本体も維持する。
- movieの実際のreadDoc関数を取り出し、Firebase取得と画面・再生処理を模擬して5ケースを確認。versionなし・0・1は非対応エラーとなり、再生関数を呼ばない。version 2・2.1は従来どおり操作再生へ渡す。Firestoreへの実際のアクセスは行っていない。
- 既存 `tests/test.py` を開発 `http://127.0.0.1:5183/` とpreview `http://127.0.0.1:4183/` に対して順番に実行し、両方でwebgpu・game・diagram・algebra・movieすべて成功。
- 開発環境のmovie編集画面で公開教材id 1を操作オブジェクトから再生した後、教材選択グラフを閉じてSaveをクリックし、movie.jsonのダウンロードを確認。version 2.1・操作文字列配列35件・shapesなしを確認し、ダウンロードした内容をloadOperationsTextで再読み込みして再生した。操作列、22図形のID・種類・相対順序・位置・visible・muteと、関係ログ27件が一致し、JavaScriptのpageerrorは0件。内部orderは再生成時に採番されるため、相対的な順序を比較した。
- Python環境は既存の `tmp/p3-venv` とChromiumを使用した。`tests/test.py` は変更せず、SHA256は `FE2F4527A91AAFEDF7C23326280C3EC2BCB44D9C4DEC9037E90F76C5885886FD`。追加の確認スクリプトとダウンロードはGit管理外のtmpに置いた。

確認用の開発・previewサーバーは終了した。Firebase上の旧データの調査・変換・削除、実際の認証・保存、音声の聴取、Android・実機の確認は行っていない。旧図形JSONは読み込めなくなる。操作記録の保存・読込・変換、再生、画面イベント、AppServicesの分離は引き続き後続作業とする。

## 2026-10-11: 操作記録の保存・変換の分離

saveJson・getOperationsText・convertOperationsを `plane/ts/operation_storage.ts` へ移した。plane_ui.tsとfactories.tsは直接importし、公開入口のgetOperationsTextも新モジュールから再exportする。all_functions.tsには3関数の互換用再exportを残した。保存形式、version 2.0の変換処理、GlobalState・AppServicesの接続を維持する。OperationとAnchorは型のみのimportとした。

- `npm.cmd run verify`: 成功。TypeScript診断0、Vite 7.3.7で176モジュール変換、92項目コピー、公開HTML6ページと資産チェック成功。既存の静的・動的import混在警告2件は残る。
- 構文木で移した3関数の宣言・処理本体が変更前と一致すること、およびall_functions.ts・factories.ts・plane_ui.ts・index.tsの残る143個のトップレベル宣言・処理がimport・再exportを除いて一致することを確認。all_functions.tsのexport名も維持した。移した処理で使用するi18nのassertと従来のローカルassertの実装も一致する。
- 生成したoperation_storage.jsのplane内の実行時import・再exportをたどり、到達先がinference.js・enums.jsのみで、all_functions.js・index.js・operation.jsへ戻る経路がないことを確認。
- 既存 `tests/test.py` を開発 `http://127.0.0.1:5183/` とpreview `http://127.0.0.1:4183/` に対して順番に実行し、両方でwebgpu・game・diagram・algebra・movieすべて成功。
- 開発環境で実際のOperationクラスとAppServicesを使用し、version 2.0の等長・等角・平行・四角形の操作順変換、各操作の参照維持、入力配列の非変更、通常操作の維持、空配列、version 2.1・3の同一配列の返却を確認。3関数の互換exportと公開getOperationsTextが新モジュールの関数と同じ参照であることも確認した。
- movie編集画面のSaveをクリックし、movie.jsonのダウンロードを確認。公開教材id 1の35操作をversion 2.1の文字列配列として保存し、loadOperationsTextで再読み込みして再生した。操作列、22図形のID・種類・相対順序・座標・visible・muteと関係ログ27件が一致し、pageerrorは0件。
- Python環境は既存の `tmp/p3-venv` とChromiumを使用した。`tests/test.py` は変更せず、SHA256は `FE2F4527A91AAFEDF7C23326280C3EC2BCB44D9C4DEC9037E90F76C5885886FD`。追加の確認スクリプトとダウンロードはGit管理外のtmpに置いた。

確認用サーバーは終了した。Firestoreへの実際の認証・保存、音声の聴取、Android・実機は未検証。今回は保存・変換3関数の分離であり、読込関数はfactories.tsに残す。操作記録の読込、再生、画面イベント、AppServicesの分離は後続作業とする。

## 2026-10-11: 操作オブジェクト形式への統一

前項の保存・変換分離後、保存形式をversion 3の操作オブジェクト配列へ変更した。操作文字列のloadOperationsText・convertOperationsと、movieのisJson・newDocs・旧形式の一括変換用分岐を削除した。loadOperationsJSONは新しい `plane/ts/operation_loader.ts` に分離し、planeの公開APIから利用する。factories.tsには同関数の互換用再exportを残す。

Save・Firebase更新・バックアップはgetOperationsTextの同じJSONを使う。readDocの既定はローカル教材、明示指定時はFirebase取得で、どちらも同じJSONローダーを使う。ローカル読込とバックアップ再生でもID・名前・本文をtheDocに保持し、更新・バックアップが現在の教材を対象にできるようにした。バックアップのcommitBackUpをawaitする。Firebase上の既存データの移行・削除は行っていない。

検証結果:

- `npm.cmd run verify`: 成功。TypeScript診断0、Vite 7.3.7、177モジュール変換、92項目コピー、成果物チェック成功。gameの静的・動的import混在の既存警告2件は残る。
- 既存 `tests/test.py`: 開発5183・preview4183の両方でwebgpu・game・diagram・algebra・movieの5アプリすべて成功。Python 3.12、Playwright 1.63.0、既存Chromiumを順次実行した。ファイルのSHA256は従来と同じ `FE2F4527A91AAFEDF7C23326280C3EC2BCB44D9C4DEC9037E90F76C5885886FD`。
- 新規 `tests/test_operation_json.py`: 開発5183で成功。公開教材22件、全7種類を含む追加ケース、空配列の計24ケース・1,252操作について、読込→toJson→JSON文字列化→再読込後のクラス・フィールドと保存内容を比較した。実行ごとに採番されるoperationIdは比較から除く。公開教材の操作データも元データと一致。
- 旧図形JSON、version 2.x、文字列配列、欠落・不正なトップレベル入力の8ケースを拒否し、拒否時に既存の図形・操作配列を消去しないことを確認。
- 編集画面のSaveからmovie.jsonを実際にダウンロードし、version 3・35操作のオブジェクト配列を確認。再読み込み・再生後の操作列、22図形のID・種類・相対順序・座標・visible・mute、関係ログ27件が一致。pageerrorは0件。
- ClickShape.toJsonの既存の丸めにより、座標 `(1.234567, -2.345678)` は再読込後 `(1.23, -2.35)` になることも確認。任意精度の座標まで完全一致するテストではない。
- 実ソースの関数を抽出して実行し、Firebase I/Oを模擬してローカル／Firebase取得先の選択、読込後のID・名前、更新データと確認キャンセル、旧形式・未存在教材の拒否、バックアップ保存とcommit完了待ち、バックアップ再生、対応形式のconvertによる再保存を確認。実際のFirebase SDK通信・認証・Storage保存の確認ではない。

確認用の開発・previewサーバーは終了した。既存の操作クラスの生成・再生処理とAppServicesの接続、図形生成時のID管理は維持する。操作文字列形式・version 2.xは今後読み込めない。Firestoreの実サービス、音声の聴取、Android・実機は未検証。残るP4作業は再生・画面イベント・生成補助・AppServicesの責任分割。
