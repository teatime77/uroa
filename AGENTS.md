# uroa 作業案内

## 概要と参照先

uroaは数式処理、平面図形編集、教材アニメーション、算数学習ゲーム、WebGPUシミュレーションを組み合わせるTypeScript中心のWebアプリ群。

全体構成、依存関係、実装範囲、robotとの連携については [docs/architecture.md](docs/architecture.md) を参照する。個別の変更では対象モジュールと直接の依存先を確認する。機能からソースを探すときは [docs/features.md](docs/features.md)、2026-10-10の実行条件・既知の問題は [docs/current-state.md](docs/current-state.md) を参照する。

## ソースの位置

- 共通機能: `i18n/ts/`、`parser/ts/`、`layout/ts/`。
- 数学・教材: `algebra/ts/`、`plane/ts/`、`game/ts/`、`movie/ts/`、`lesson/ts/`。
- 共通入口: `app/ts/main.ts`。URLによるアプリ選択と初期化順序を管理する。起動・停止・破棄の状態管理は `app/ts/lifecycle.ts`。
- ブロック編集: `diagram/ts/`。`index.ts`はdiagramのUI初期化、`runtime.ts`はブロック実行・停止・キャンセル可能な待機を担当する。
- GPU処理: `webgpu/ts/`、`webgpu/public/wgsl/`、`webgpu/public/engines/physics/`。定義の作成用ソースは `webgpu/build/sims/`。
- 保存・認証: `firebase/ts/`。録音: `media/ts/`。
- 旧13サブモジュールはすべてuroaの通常フォルダーとして管理する。変更・コミットはuroaで行う。履歴統合・検証結果は [docs/monorepo-migration.md](docs/monorepo-migration.md)、algebraの先行移行は [docs/algebra-monorepo.md](docs/algebra-monorepo.md) に記録する。
- `dist/`、各モジュールの `lib/`、`node_modules/` は主な編集対象のソースではない。`tmp/zip/`には過去の展開コピーがある。

## 現在の境界

- diagramの実機用ブロックはHTTP `POST /send_data`を前提とする。robotのBLE通信との接続は未実装。
- `diagram/ts/index.ts`の `diy_sbc = false` により実機センサーの定期取得は無効。サーボ送信コード自体は残っている。
- plotには実装ソースがない。lessonの `@let` は未実装。mediaのCanvas動画録画・音声合成部分はコメントアウトされている。
- planeの旧図形JSON保存・復元とmovie内のスライド・クイズ機能は廃止済み。図形の追加時は操作記録による生成・再生を確認する。diagram・FirebaseのJSON保存、独立した `lesson/ts/` は別機能として残る。
- plane・movieの保存／読込はversion 3の操作オブジェクト形式に統一済み。保存は `operation_storage.ts`、読込は `operation_loader.ts`。旧操作文字列形式・version 2.xは非対応。Firebase上の既存データを自動移行したとは扱わない。
- ソースにある機能を、ブラウザーや実機で動作確認済みと表現しない。

## 変更と検証

ビルド構成・コマンドは設計文書に記載。変更した機能に応じた確認を行う。文書だけの変更ではリンク・記述・差分を確認する。

現在のビルド・テスト手順は [docs/build-and-test.md](docs/build-and-test.md) を参照する。`npm run verify` は型・公開ビルド・成果物の静的確認であり、既存の大規模回帰テストは `tests/test.py` を別途実行する。
起動・終了を変更する場合は [docs/app-lifecycle.md](docs/app-lifecycle.md) と、追加した `tests/lifecycle.test.mjs`、`tests/test_lifecycle.py` も参照する。初期化済みの画面の再生は停止後に再実行できる。破棄後の同一documentの再初期化は行わず、ページを再読み込みする。

モジュールの役割、公開API、通信方式、データ形式、実装範囲を変更したら設計文書の該当箇所も更新する。既存の作業中の変更を保持し、秘密情報を文書へ転記しない。

## 改善計画の参照先

全体改善の作業案と段階ごとの完了条件は [docs/improvement-plan.md](docs/improvement-plan.md) を参照する。提案中の構成・コマンドと現行実装を区別し、着手時は現在のソース・Git状態・検証結果を確認する。
