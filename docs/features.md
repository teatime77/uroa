# 機能索引

更新日: 2026-10-10（日本時間）。目的の変更から、入口・主要関数・関連資産へたどるための索引。現行ソースを対象とし、dist、lib、node_modules、tmpの展開コピーは編集対象から除く。

全体の依存関係は [architecture.md](architecture.md)、改善の順序は [improvement-plan.md](improvement-plan.md)、実際に確認した条件・結果は [現状確認](current-state.md) を参照する。この索引にソースが載っていることは、その機能を実行検証済みであることを意味しない。

## 起動・アプリの連携

| ID | やりたいこと | 最初に見るソース・入口 | 関連資産・注意点 |
|---|---|---|---|
| ENTRY-01 | トップ画面のリンクを変える | [index.html](../index.html) | algebra、webgpu、game、diagram、movieの5リンク |
| ENTRY-02 | URLによる起動先を変える | [diagram/index.ts](../diagram/ts/index.ts): DOMContentLoaded | 全体起動を兼ねる。初期化済みフラグだけでは個別アプリの初期化成功を判定できない |
| ENTRY-03 | diagramから教材・ゲーム・GPU表示を起動する | [procedure.ts](../diagram/ts/procedure.ts): PlayMovieBlock、PlayGameBlock、PlayWebGPUBlock | [diagram_util.ts](../diagram/ts/diagram_util.ts): switchActiveModule。起動後の停止と画面復帰も確認する |

## 数式解析・代数・証明

| ID | やりたいこと | 最初に見るソース・入口 | 関連資産・確認の観点 |
|---|---|---|---|
| MATH-01 | 数式の文字や構文を追加する | [lex.ts](../parser/ts/lex.ts): lexicalAnalysis、[parser.ts](../parser/ts/parser.ts): parseMath、Parser | 数式の木構造Term/App/RefVar/Rational、proofモード、LaTeX変換への影響 |
| MATH-02 | 数式の表示や選択範囲を変更する | [parser/tex.ts](../parser/ts/tex.ts)、[algebra/tex.ts](../algebra/ts/tex.ts): initTexTest | [algebra画面](../public/algebra/index.html)。木構造と表示範囲の対応 |
| MATH-03 | 簡約・同類項整理を変える | [simplifier.ts](../algebra/ts/simplifier.ts): simplify、combineLikeTerms | 入力式、結果式、中間の表示と読み上げ |
| MATH-04 | 移項・代入・方程式の加算や除算を変える | [algebra.ts](../algebra/ts/algebra.ts): transpose、substitute、addEquations、divideEquation | 数式を利用するplane・gameにも影響する |
| MATH-05 | 定理や.mathファイルの構文を変える | [math_file_parser.ts](../algebra/ts/math_file_parser.ts): parseMathFile、testProof | [example.math](../public/algebra/formula/example.math)、[formula.ts](../algebra/ts/formula.ts)、[proof.ts](../algebra/ts/proof.ts)。testProofは読込・解析。saveProofOutputが開発用保存APIを呼び、initAlgebraは開発時のみ実行する |
| MATH-06 | 定理照合・証明手順・書き換えメニューを変える | [formula_matcher.ts](../algebra/ts/formula_matcher.ts)、[ProofStep.ts](../algebra/ts/ProofStep.ts): Rewrite、CopySide | [manipulation.ts](../algebra/ts/manipulation.ts): 共通因子の約分など |
| MATH-07 | 群・置換などの実験を調べる | [galois.ts](../algebra/ts/galois.ts): testGalois | 教材全体の自動証明器を意味する機能ではない |

## 平面作図・制約・操作記録

planeはmovieからも利用される。all_functions.tsはnamespaceからモジュールへの移行時の循環参照回避のために作られたというユーザーの説明を踏まえ、型依存、AppServices、生成関数登録を確認して変更する。

| ID | やりたいこと | 最初に見るソース・入口 | 関連ソース・確認の観点 |
|---|---|---|---|
| PLANE-01 | 点・直線・円などの性質や描画を変える | [shape.ts](../plane/ts/shape.ts): Point、Shapeなど | [dimension_symbol.ts](../plane/ts/dimension_symbol.ts)、[view.ts](../plane/ts/view.ts)。形状、ラベル、選択、登録 |
| PLANE-02 | 作図ツールを追加する | [tool.ts](../plane/ts/tool.ts): Builder群、[factories.ts](../plane/ts/factories.ts): 生成関数 | [type_guards.ts](../plane/ts/type_guards.ts)、[index.ts](../plane/ts/index.ts): AppServicesの接続 |
| PLANE-03 | 等長・等角・平行・垂直の関係を変える | [constraint.ts](../plane/ts/constraint.ts)、[all_functions.ts](../plane/ts/all_functions.ts): initRelations、recalcRelations | [inference.ts](../plane/ts/inference.ts): 関係・状態。再計算と初期化も確認する |
| PLANE-04 | 合同・相似・命題の理由を追加する | [deduction/](../plane/ts/deduction/)、[statement.ts](../plane/ts/statement.ts) | [enums.ts](../plane/ts/enums.ts)、[factories.ts](../plane/ts/factories.ts)。理由、補助図形、表示 |
| PLANE-05 | 座標・幾何計算を変える | [geometry.ts](../plane/ts/geometry.ts)、[matrix.ts](../plane/ts/matrix.ts)、[all_functions.ts](../plane/ts/all_functions.ts): distanceFromLineなど | 描画・作図・制約の利用側を確認する |
| PLANE-06 | 操作の保存・復元・再生を変える | [operation.ts](../plane/ts/operation.ts)、[factories.ts](../plane/ts/factories.ts): loadOperationsJSON、loadOperationsText、playBack | [json.ts](../plane/ts/json.ts): 基底クラスと生成関数登録、[all_functions.ts](../plane/ts/all_functions.ts): parseObject、loadData、[play.ts](../plane/ts/play.ts) |
| PLANE-07 | 作図画面やプロパティ表示を変える | [plane_ui.ts](../plane/ts/plane_ui.ts): Plane、[factories.ts](../plane/ts/factories.ts): showProperty | [all_functions.ts](../plane/ts/all_functions.ts): 画面イベント、[view.ts](../plane/ts/view.ts)。movie側の配置も確認する |

## ブロック編集・実行・実機向け指令

| ID | やりたいこと | 最初に見るソース・入口 | 関連資産・確認の観点 |
|---|---|---|---|
| DIAGRAM-01 | ブロック配置・選択・接続を変える | [canvas.ts](../diagram/ts/canvas.ts): Canvas、Editor、[port.ts](../diagram/ts/port.ts) | [ui.ts](../diagram/ts/ui.ts)、[画面](../public/diagram/index.html) |
| DIAGRAM-02 | 入力・計算・比較ブロックを追加する | [block.ts](../diagram/ts/block.ts): 入力、CalcBlock、CompareBlock | ポートの値・型、生成関数、保存項目 |
| DIAGRAM-03 | 条件・繰り返し・待機・読み上げを変える | [procedure.ts](../diagram/ts/procedure.ts): IfBlock、InfiniteLoop、SleepBlock、TTSBlock | [index.ts](../diagram/ts/index.ts): runBlockChain、Start/Stop。停止時の非同期処理 |
| DIAGRAM-04 | ブロック図を保存・読込する | [json-util.ts](../diagram/ts/json-util.ts): saveJson、[index.ts](../diagram/ts/index.ts): loadJsonとdrop処理 | [diagram.json](../public/diagram/data/diagram.json)。ファイルdrop、Download、Clear、ポート参照の復元 |
| DIAGRAM-05 | サーボ指令・センサー連携を変える | [block.ts](../diagram/ts/block.ts): ServoMotorBlockなど、[diagram_util.ts](../diagram/ts/diagram_util.ts): sendData | 現行はPOST /send_data。対応サーバーは未確認、センサー定期取得はdiy_sbc=false。BLE接続は未実装 |

## 学習ゲーム

| ID | やりたいこと | 最初に見るソース・入口 | 関連資産・確認の観点 |
|---|---|---|---|
| GAME-01 | 初期画面・教材マップを変える | [index.ts](../game/ts/index.ts): initGame、[isometric.ts](../game/ts/isometric/isometric.ts): initIsometric | [map.json](../public/game/data/map.json)、[prod.json](../public/game/data/prod.json)、[dev.json](../public/game/data/dev.json)。dagreをCDNから使う |
| GAME-02 | ステージを読み込み・実行する | [index.ts](../game/ts/index.ts): loadWorld、playGameWorld、[registry.ts](../game/ts/registry.ts): SymbolRef | [stage/](../public/game/data/stage/)、[system/](../public/game/data/system/)。読込ごとの状態リセット |
| GAME-03 | 順次・並列・条件付き動作を変える | [sequencer.ts](../game/ts/action/sequencer.ts)、[control.ts](../game/ts/action/control.ts) | [action.ts](../game/ts/action/action.ts)、JSONのactionsと登録 |
| GAME-04 | 算数問題の生成・採点を変える | [exercise.ts](../game/ts/lesson/exercise.ts): ArithmeticFormulaExercise | [ArithFormEx.json](../public/game/data/stage/ArithFormEx.json)。乱数・5問の進行・正解と不正解 |
| GAME-05 | 筆算・方程式・入力・Canvas部品を変える | [math/](../game/ts/math/)、[widget/](../game/ts/widget/) | [core.ts](../game/ts/widget/core.ts): UI登録、[canvas.ts](../game/ts/widget/canvas.ts)。数式解析・入力フォーカス |
| GAME-06 | 正解の効果音・演出を変える | [sound.ts](../game/ts/lesson/sound.ts)、[confetti.ts](../game/ts/lesson/confetti.ts) | 音声と描画の検証を分ける |

## 教材アニメーション・スライド・クイズ

| ID | やりたいこと | 最初に見るソース・入口 | 関連資産・確認の観点 |
|---|---|---|---|
| MOVIE-01 | 教材読込・作図操作の再生を変える | [index.ts](../movie/ts/index.ts): initMovie、readDocJson、loadOperationsAndPlay | [all-kyozai.json](../public/movie/all-kyozai.json): version 3、22教材。planeの再生も利用する |
| MOVIE-02 | 教材の連続再生・停止を変える | [flow.ts](../movie/ts/flow.ts): playAllGraph、stopPlay | 全体グラフ、音声、PlayMode、作図の強調と停止 |
| MOVIE-03 | スライド・クイズを編集・再生する | [lesson.ts](../movie/ts/lesson.ts): playLesson、initLessonなど | 独立したlessonモジュールとは別機能。保存データとアプリモードを確認する |
| MOVIE-04 | 音声・言語選択・再生画面を変える | [timeline.ts](../movie/ts/timeline.ts): playAudio、stopAudio、[movie_ui.ts](../movie/ts/movie_ui.ts) | i18nのSpeech、[画面](../public/movie/index.html)、ダイアログ、音声終了イベント |
| MOVIE-05 | 教材の変換・バックアップ・画像保存を変える | [flow.ts](../movie/ts/flow.ts): convert、backup、playBackUp、[index.ts](../movie/ts/index.ts): updateGraphDoc | Firebaseへの保存を伴うため検証用データ・環境を用いる |
| MOVIE-06 | 教材音声や字幕の生成を変える | [make_audio.py](../movie/python/make_audio.py)、[timeline.py](../movie/python/timeline.py) | Azure音声生成などの補助処理。ブラウザの再生コードと区別する |

## GPU計算・シミュレーション

| ID | やりたいこと | 最初に見るソース・入口 | 関連資産・確認の観点 |
|---|---|---|---|
| GPU-01 | schemaによる起動先を変える | [index.ts](../webgpu/ts/index.ts): initWebGPU、[schema_public_path.ts](../webgpu/ts/schema_public_path.ts) | ?schema=ballなど。物理定義はengines/physics/<id>/<id>.json・.js・.wgsl |
| GPU-02 | 物理シミュレーションを追加・変更する | [build/sims/](../webgpu/build/sims/)、[build/cli.ts](../webgpu/build/cli.ts) | [engines/physics/](../webgpu/public/engines/physics/)。14種類。TypeScriptからJSON/DSLを生成しWGSLは別管理 |
| GPU-03 | 実行グラフ・資源・GPUバッファを変える | [control.ts](../webgpu/ts/control.ts): GraphManager、step、requestReadback | [schema_validator.ts](../webgpu/ts/schema_validator.ts)。DSLの区切りと物理ステップ、ping-pong、読出し時点 |
| GPU-04 | 時刻・カメラ・画面更新・画像保存を変える | [main.ts](../webgpu/ts/main.ts): initControl、stopGraphSchemaAnimation、[camera.ts](../webgpu/ts/camera.ts) | performance.now、requestAnimationFrame、Capture。固定条件での比較は今後整備する |
| GPU-05 | 定義から生成する操作パネルを変える | [sim_ui.ts](../webgpu/ts/sim_ui.ts): buildUI | schemaのuis、metadata、restart/reset |
| GPU-06 | DSL構文・シェーダー解釈を変える | [lex.ts](../webgpu/ts/lex.ts)、[parser.ts](../webgpu/ts/parser.ts)、[syntax.ts](../webgpu/ts/syntax.ts) | .js資産は独自DSLとして解釈する。任意のJS実行への変更を前提にしない |
| GPU-07 | 定義生成・シリアライズを変える | [builder/](../webgpu/ts/builder/)、[selftest.ts](../webgpu/ts/builder/selftest.ts) | selftestはJSON/DSLの生成を確認し、GPU描画を確認するものではない |
| GPU-08 | メッシュ・従来デモを変える | [primitive.ts](../webgpu/ts/primitive.ts)、[package.ts](../webgpu/ts/package.ts)、[lgt/](../webgpu/ts/lgt/) | [package/test.json](../webgpu/public/package/test.json)。schema方式と別の起動経路もある |

## 保存・認証・共通部品

| ID | やりたいこと | 最初に見るソース・入口 | 注意点 |
|---|---|---|---|
| STORE-01 | ログイン・教材の取得保存を変える | [firebase.ts](../firebase/ts/firebase.ts): initFirebase、getMyDocなど | Auth、Firestore、外部サービスへの書込は検証用環境で確認する |
| STORE-02 | 教材フォルダー・関連図を変える | [contents.ts](../firebase/ts/contents.ts)、[graph/](../firebase/ts/graph/) | 読込、階層、関連、画面操作、movieとの連携 |
| STORE-03 | 画像・サムネイル保存を変える | [storage.ts](../firebase/ts/storage.ts): uploadCanvasImg、uploadImgFile | Firebase Storage。アプリ画面と保存処理の境界 |
| COMMON-01 | 翻訳・表示言語・モードを変える | [reading.ts](../i18n/ts/reading.ts): appMode、AppMode | [public/i18n/](../public/i18n/)、12言語、URLによるモード判定 |
| COMMON-02 | 読み上げ・文字強調を変える | [speech.ts](../i18n/ts/speech.ts): Speech、waitEnd | ブラウザ音声合成、movieの音声終了と再生同期 |
| COMMON-03 | UI・配置・ベクトル・共通処理を変える | [layout/main.ts](../layout/ts/main.ts)、[layout/misc.ts](../layout/ts/misc.ts)、[i18n/ui.ts](../i18n/ts/ui.ts)、[vector.ts](../i18n/ts/vector.ts)、[util.ts](../i18n/ts/util.ts) | i18nという名前でも翻訳以外を含む。利用側の5アプリを確認する |
| AUX-01 | テキスト教材をHTMLへ変換する | [lesson.ts](../lesson/ts/lesson.ts): bodyOnLoad | 独立モジュールlesson。@letのreadLetは未実装 |
| AUX-02 | マイクの録音・再生を変える | [media.ts](../media/ts/media.ts): recordAudio、startAudioRecorder、stopAudioRecorder | マイク権限が必要。Canvas録画・音声合成の後半はコメントアウト |
| AUX-03 | plotを調べる | [README.md](../plot/README.md)、[package.json](../plot/package.json) | 現時点で実装ソースなし |

## ビルド・配信

| ID | やりたいこと | 最初に見る設定・処理 | 注意点 |
|---|---|---|---|
| BUILD-01 | TypeScript対象や依存を変える | [tsconfig.sys.json](../tsconfig.sys.json)、[tsc-all.bat](../tsc-all.bat)、[package.json](../package.json) | TS参照13、workspaces 9。型確認とViteビルドは別の確認 |
| BUILD-02 | HTML・モジュール・公開資産の配信を変える | [vite.config.ts](../vite.config.ts)、[build_all.py](../build_all.py) | 5アプリの公開用HTML書換え、WebGPUの資産コピー、開発時のみPOST /api/save。ビルド成功と5画面の起動成功を分ける |
| BUILD-03 | Flask・Firebase Hostingで配信する | [web.py](../web.py)、[firebase.json](../firebase.json) | Flaskはdistの静的配信。Vite開発用APIが自動的に配信先へ移るわけではない |

## robotの移行対象（現時点では別リポジトリ）

| ID | 移行・変更したい機能 | 現在のソース | 実装の境界 |
|---|---|---|---|
| ROBOT-01 | AI質問画面とAPI | [chat/src/main.ts](../../robot/chat/src/main.ts)、[server/app.ts](../../robot/chat/server/app.ts)、[server/index.ts](../../robot/chat/server/index.ts) | 1問ごとの文章応答。モーターへの直接指令は未実装 |
| ROBOT-02 | BLE接続・サーボ操作 | [main.ts](../../robot/esp32-ble-lab/web/src/main.ts)、[ble.ts](../../robot/esp32-ble-lab/web/src/ble.ts)、[protocol.ts](../../robot/esp32-ble-lab/web/src/protocol.ts) | ARM/MOVE/STOP/DISABLE、ACK、直列化、切断。uroaとの接続は未実装 |
| ROBOT-03 | IMU表示・グラフ・CSV | [main.ts](../../robot/esp32-ble-lab/web/src/main.ts)、[protocol.ts](../../robot/esp32-ble-lab/web/src/protocol.ts) | 加速度・角速度。姿勢角やサーボ実測角度ではない |
| ROBOT-04 | ESP32のBLEサーボ・IMU処理 | [main.cpp](../../robot/esp32-ble-lab/firmware/src/main.cpp)、[config.h](../../robot/esp32-ble-lab/firmware/include/config.h) | PWM、I2C、指令キュー、ハートビート、停止。通信変更はWeb側と同期する |
| ROBOT-05 | DCモーター・エンコーダーの診断 | [main.cpp](../../robot/esp32_recovery/src/main.cpp) | 別ファームウェア。シリアル指令、IMU、手動停止と2秒経過停止 |

## 更新するとき

機能を変更したら該当IDの入口・ソース・資産・実装範囲を更新し、現状確認に実行条件と結果を追記する。新しいIDは利用者が目的を区別できる単位で追加する。秘密情報、生成物、全シンボルの機械的な一覧をこの文書へ混在させない。
