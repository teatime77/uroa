# uroa 作業案内

## 概要と参照先

uroaは数式処理、平面図形編集、教材アニメーション、算数学習ゲーム、WebGPUシミュレーションを組み合わせるTypeScript中心のWebアプリ群。

全体構成、依存関係、実装範囲、robotとの連携については [docs/architecture.md](docs/architecture.md) を参照する。個別の変更では対象モジュールと直接の依存先を確認する。機能からソースを探すときは [docs/features.md](docs/features.md)、2026-10-10の実行条件・既知の問題は [docs/current-state.md](docs/current-state.md) を参照する。

## ソースの位置

- 共通機能: `i18n/ts/`、`parser/ts/`、`layout/ts/`。
- 数学・教材: `algebra/ts/`、`plane/ts/`、`game/ts/`、`movie/ts/`、`lesson/ts/`。
- 共通入口: `app/ts/main.ts`。URLによるアプリ選択と初期化順序を管理する。起動・停止・破棄の状態管理は `app/ts/lifecycle.ts`。
- ブロック編集: `diagram/ts/`。`index.ts`はdiagramのUI初期化、`runtime.ts`はブロック実行・停止・キャンセル可能な待機を担当する。diagram・ESP32関連の文書は`docs/diagram/`に置く。ブロック追加時は [docs/diagram/diagram-implementation.md](docs/diagram/diagram-implementation.md) の機能・登録・ポート・実行・保存・後片付けの説明を参照する。
- diagramの機能別ソース: `diagram/ts/ai/`はAIチャット・音声認識・Gemini物体検出・画像説明、`ble-wifi/`はBLE接続・Wi-Fi設定と通信、`hardware/`は各種センサー・アクチュエータ（現在はサーボ・IMU）、`plot/`はグラフ・履歴・Plotly型定義、`camera/`は端末／XIAOの画像取得。CameraBlock本体は`block.ts`、共通型は`data_type.ts`に置く。
- GPU処理: `webgpu/ts/`、`webgpu/public/wgsl/`、`webgpu/public/engines/physics/`。定義の作成用ソースは `webgpu/build/sims/`。
- 保存・認証: `firebase/ts/`。録音: `media/ts/`。
- ESP32ファームウェアの現行ソースは別リポジトリーの`D:\usr\prj\esp32`。教材は[app/diagram-control](../esp32/app/diagram-control/README.md)、共有C++ソースは[lib](../esp32/README.md)。ESP32側を変更する場合は[同リポジトリーのAGENTS.md](../esp32/AGENTS.md)を読む。PlatformIOで独立してビルドし、npmの`verify`には含めない。仕様・配線・送受信タイミング・ビルドの参照先は[連携ガイド](docs/diagram/esp32-integration.md)にまとめる。
- uroa内の`esp32/`と`esp32-ble-lab/`は2026-10-30に削除方針が決まった旧構成。現行の作業先・仕様の根拠にしない。旧倒立アプリは運用対象外で、別リポジトリーへ移行していない。ブラウザーに残るBalance受信・サンプル・模擬テストは互換機能で、diagram-controlはBalance通知を送らない。
- ESP32のWi-Fi設定・NVS・mDNS・通信は別リポジトリーの`lib/wifi/`・`lib/ble/`、教材設定・XIAOカメラは`app/diagram-control/src/network.cpp`・`camera.cpp`。Web側は`diagram/ts/ble-wifi/robot-wifi.ts`・`robot-wifi-dialog.ts`・`diagram/ts/camera/camera-feed.ts`。操作・保存・認証・制約は[Wi-Fiガイド](docs/diagram/esp32-ble-lab-wifi.md)。過去のビルド・実機報告を現行ファームウェアの再検証結果として扱わない。
- 旧13サブモジュールはすべてuroaの通常フォルダーとして管理する。変更・コミットはuroaで行う。履歴統合・検証結果は [docs/monorepo-migration.md](docs/monorepo-migration.md)、algebraの先行移行は [docs/algebra-monorepo.md](docs/algebra-monorepo.md) に記録する。
- `dist/`、各モジュールの `lib/`、`node_modules/` は主な編集対象のソースではない。`tmp/zip/`には過去の展開コピーがある。

## 現在の境界

- `diagram/ts/ai/image-caption.ts`のImageCaptionBlockはCameraBlockの画像をGeminiへ送り、日本語の短い説明文をTextPortへ出力する。手動実行とStart時の完了待ちに対応し、TTSへ接続できる。物体検出と画像取得・キー管理・取消を`camera-ai-block.ts`で共通化する。操作・保存・後片付けは [docs/diagram/diagram-image-caption.md](docs/diagram/diagram-image-caption.md)。2026-10-15の確認はユーザー指定でビルドまで。

- `diagram/ts/ai/object-detection.ts`のObjectDetectionBlockはCameraBlockの端末／XIAO画像を固定し、学習者のキーでGeminiへ送って日本語ラベル・矩形を表示する。手動1回／Startの1回実行、ラベル・個数・先頭物体のStruct出力。キー・画像・結果は図へ保存しない。操作・通信・取消・制約は [docs/diagram/diagram-gemini-object-detection.md](docs/diagram/diagram-gemini-object-detection.md)。2026-10-15はユーザー指定でビルドまで。実通信・ブラウザー・実機の検出は未確認。

- `diagram/ts/ai/speech-recognition.ts`のSpeechRecognitionBlockはStartで単発の音声認識を待ち、セッション終了後に確定文字列をTextPortへ出力する。認識終了は結果を待つstop、全体Stopはabort。30秒タイムアウト、言語設定のみ保存し、復元で認識を始めない。ブラウザーの認識サービスに依存し、実音声・Androidの確認と模擬確認を区別する。

- `diagram/ts/ble-wifi/ble.ts`のBLEConnectionBlockで現行ESP32のdiagram-controlへ接続する。`diagram/ts/hardware/servo.ts`のServoMotorBlockは角度／速度モードを選び、90°または速度0%で明示的に有効化する。角度は60～120°のMOVE、速度は−100～100%のSET_SPEEDを送る。モード変更ではCHを無効化し、再有効化する。CH・移動時間、個別DISABLE・全体STOPを操作できる。再接続では自動有効化しない。`diagram/ts/hardware/imu.ts`のIMUBlockが先頭StructPortからgyro・accを出力し、配置されたIMUBlockが10HzのSTREAMを共有する。2番目balanceの受信処理は残るが、diagram-controlは送信しない。現行console.logはコメントアウトされている。`diagram/ts/plot/plot.ts`の汎用PlotBlockがStructの数値Fieldを読んで時系列グラフを表示する。構造体のCalcBlock評価は未実装。実機確認と模擬確認は区別する。
- `diagram/ts/index.ts`の `diy_sbc = false` により旧HTTPセンサーの定期取得は無効。旧カメラ・センサーのHTTP `POST /send_data`は残るが、ServoMotorBlockはBLEを使う。BLEのIMU通知受信は独立している。
- plotには実装ソースがない。lessonの `@let` は未実装。mediaのCanvas動画録画・音声合成部分はコメントアウトされている。
- planeの旧図形JSON保存・復元とmovie内のスライド・クイズ機能は廃止済み。図形の追加時は操作記録による生成・再生を確認する。diagram・FirebaseのJSON保存、独立した `lesson/ts/` は別機能として残る。
- plane・movieの保存／読込はversion 3の操作オブジェクト形式に統一済み。保存は `operation_storage.ts`、読込は `operation_loader.ts`。旧操作文字列形式・version 2.xは非対応。Firebase上の既存データを自動移行したとは扱わない。
- ソースにある機能を、ブラウザーや実機で動作確認済みと表現しない。

## 変更と検証

新規作成・変更するコードは [コーディング規約](docs/coding-style.md) に従う。C++はDoxygen形式のコメントを付ける。条件分岐とループの本体は必ず`{}`で囲み、`{`の後で改行して内側をスペース4個でインデントする。1行1文・1行1変数宣言とする。

ビルド構成・コマンドは設計文書に記載。変更した機能に応じた確認を行う。文書だけの変更ではリンク・記述・差分を確認する。

現在のビルド・テスト手順は [docs/build-and-test.md](docs/build-and-test.md) を参照する。`npm run verify` は型・公開ビルド・成果物の静的確認であり、既存の大規模回帰テストは `tests/test.py` を別途実行する。
起動・終了を変更する場合は [docs/app-lifecycle.md](docs/app-lifecycle.md) と、追加した `tests/lifecycle.test.mjs`、`tests/test_lifecycle.py` も参照する。初期化済みの画面の再生は停止後に再実行できる。破棄後の同一documentの再初期化は行わず、ページを再読み込みする。

モジュールの役割、公開API、通信方式、データ形式、実装範囲を変更したら設計文書の該当箇所も更新する。既存の作業中の変更を保持し、秘密情報を文書へ転記しない。

## 改善計画の参照先

全体改善の作業案と段階ごとの完了条件は [docs/improvement-plan.md](docs/improvement-plan.md) を参照する。提案中の構成・コマンドと現行実装を区別し、着手時は現在のソース・Git状態・検証結果を確認する。

2026-10-12時点の最優先は、2026-10-16までの簡単なロボット＋AIデモ。P4の整理よりデモを優先する。長期目標は、plane・diagram・gameの再生／実行の統合、algebraとplaneのUI統合、5アプリを使う教材作成ツール。具体的なデモ仕様と統合方式は未決定。計画文書の「現在の優先順位と長期目標」を読み、planeの再生を必要以上に整理しない。
