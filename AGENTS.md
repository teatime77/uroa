# uroa 作業案内

## 概要と参照先

uroaは数式処理、平面図形編集、教材アニメーション、算数学習ゲーム、WebGPUシミュレーションを組み合わせるTypeScript中心のWebアプリ群。

全体構成、依存関係、実装範囲、robotとの連携については [docs/architecture.md](docs/architecture.md) を参照する。個別の変更では対象モジュールと直接の依存先を確認する。機能からソースを探すときは [docs/features.md](docs/features.md)、2026-10-10の実行条件・既知の問題は [docs/current-state.md](docs/current-state.md) を参照する。

## ソースの位置

- 共通機能: `i18n/ts/`、`parser/ts/`、`layout/ts/`。
- 数学・教材: `algebra/ts/`、`plane/ts/`、`game/ts/`、`movie/ts/`、`lesson/ts/`。
- ブロック編集・統合入口: `diagram/ts/`。`index.ts`がURLに応じてアプリを初期化する。
- GPU処理: `webgpu/ts/`、`webgpu/public/wgsl/`、`webgpu/public/engines/physics/`。定義の作成用ソースは `webgpu/build/sims/`。
- 保存・認証: `firebase/ts/`。録音: `media/ts/`。
- 旧13サブモジュールはすべてuroaの通常フォルダーとして管理する。変更・コミットはuroaで行う。履歴統合・検証結果は [docs/monorepo-migration.md](docs/monorepo-migration.md)、algebraの先行移行は [docs/algebra-monorepo.md](docs/algebra-monorepo.md) に記録する。
- `dist/`、各モジュールの `lib/`、`node_modules/` は主な編集対象のソースではない。`tmp/zip/`には過去の展開コピーがある。

## 現在の境界

- diagramの実機用ブロックはHTTP `POST /send_data`を前提とする。robotのBLE通信との接続は未実装。
- `diagram/ts/index.ts`の `diy_sbc = false` により実機センサーの定期取得は無効。サーボ送信コード自体は残っている。
- plotには実装ソースがない。lessonの `@let` は未実装。mediaのCanvas動画録画・音声合成部分はコメントアウトされている。
- ソースにある機能を、ブラウザーや実機で動作確認済みと表現しない。

## 変更と検証

ビルド構成・コマンドは設計文書に記載。変更した機能に応じた確認を行う。文書だけの変更ではリンク・記述・差分を確認する。

モジュールの役割、公開API、通信方式、データ形式、実装範囲を変更したら設計文書の該当箇所も更新する。既存の作業中の変更を保持し、秘密情報を文書へ転記しない。

## 改善計画の参照先

全体改善の作業案と段階ごとの完了条件は [docs/improvement-plan.md](docs/improvement-plan.md) を参照する。提案中の構成・コマンドと現行実装を区別し、着手時は現在のソース・Git状態・検証結果を確認する。
