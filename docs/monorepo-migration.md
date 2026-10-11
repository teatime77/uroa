# uroaの単一リポジトリ化

実施日: 2026-10-11（日本時間）。algebraの先行移行に続き、残る12サブモジュールを通常フォルダーへ移行した。uroa内の旧13サブモジュールはすべて親リポジトリで管理する。

## 維持した内容

- ソース・教材・公開資産の内容とフォルダー配置を維持した。
- 各フォルダーの `.gitignore` は元の内容・位置を維持した。
- 旧HEADとその祖先を `ours` 戦略のマージで接続した。旧コミットIDは変えていない。今回追加で接続した旧履歴は、重複を除いて1128コミット。
- 旧履歴内のファイルパスは元のまま。例えば `git log 8884b768 -- ts/index.ts` で旧diagramの履歴を確認できる。
- 旧ブランチ・タグ名のuroaへの登録は行わず、全参照をbundleと元のGitデータに保存した。
- diagramとFirebaseの機能修正、robot取り込み、Playwrightテストの変更は行っていない。

## 移行コミット

作業ブランチはalgebra移行から継続した `migration/algebra-monorepo`。今回の開始時点は `19d17d47735b7cda3a61df701ab14fa78fcfba55`。各フォルダーの移行を個別のマージコミットに分けた。

| フォルダー | 旧HEAD | 移行コミット | 追跡ファイル数 |
|---|---|---|---:|
| diagram | `8884b768` | `2faed4d0` | 13 |
| firebase | `25ba287d` | `e00d1037` | 18 |
| game | `fa1cf3c5` | `282a8049` | 37 |
| i18n | `baa6f6ba` | `08de8008` | 11 |
| layout | `dbb04c58` | `fef288b0` | 10 |
| lesson | `2bb60902` | `a74b5b3f` | 7 |
| media | `bd8c7b03` | `a3584949` | 6 |
| movie | `d4d70a0c` | `1bd1378a` | 14 |
| parser | `80e3f8da` | `3cc40d86` | 10 |
| plane | `3f658743` | `9409398e` | 35 |
| plot | `ca57103a` | `40416812` | 4 |
| webgpu | `81188165` | `af98f8bd` | 151 |

algebraの17ファイルと59コミットの先行移行は [algebra-monorepo.md](algebra-monorepo.md) に記録する。

## バックアップ・手順・照合

保存先: `D:/usr/prj/uroa-migration-backup/2026-10-11-remaining/`。uroaのGit管理対象外に置いた。

- `uroa.bundle`と各フォルダー名の `.bundle`: 全参照とHEADを保存し、すべて `git bundle verify` に成功した。
- `before.json`: 移行前のコミット、参照一覧、追跡件数、ファイルのSHA-256。
- `uroa-index`、`uroa-config`、`gitmodules.before`: 移行前の管理情報。
- 各フォルダー名の `.gitlink.txt`: 退避した `.git` 接続ファイル。
- `migrate.cjs`: バックアップ、検証用コピーでの試行、実際の移行を行ったスクリプト。
- `rehearsal-result.json`、`migration-result.json`、各progressファイル: 検証結果と完全なコミットID。

元の `uroa/.git/modules/` は保持している。bundleはコミット履歴のバックアップであり、未コミット変更・未追跡ファイルは含まない。事前に親と12サブモジュールの作業ツリーがクリーンであることを確認した。

algebraと同じ手順を検証用コピーで12件すべて試した後、実際の作業ブランチへ適用した。bundleからのfetch、`ours` マージ開始、`git rm --cached`、`.git`接続ファイルの退避、`git read-tree --prefix`、設定除去、コミットの順に実行した。実際の移行では `read-tree` に `-u` を付けず、作業ファイルを書き換えていない。

各フォルダーの移行直後と全件移行後に、追跡ファイル316件のGitツリーが旧HEADと一致することを確認した。さらに生成物を含む761ファイルのSHA-256一致を確認した。依存インストール済みの `node_modules/` と退避対象の `.git` はハッシュ集計から除外している。行末や既存の空白も維持した。

gitlinkは0件になり、`.gitmodules`と親のローカルsubmodule設定を廃止した。

## コマンドの最小限の置換

[package.json](../package.json)だけで、サブモジュール操作に依存する二つのコマンドを置き換えた。

| コマンド | 現在の処理 |
|---|---|
| `npm run install:all` | ルートで `npm install` |
| `npm run build:all` | `tsc -b tsconfig.sys.json` |

旧13フォルダーのbuildスクリプトはすべて `tsc -b` だったため、既存のルート参照ビルドで処理できる。npm workspaces登録は9個のまま。登録外のlesson、media、movie、plotは独自のnpm依存を宣言していない。ロックファイル、TypeScript参照、Vite設定、WebGPU資産コピーは変更していない。

## 移行直後の検証と残作業

- `npm.cmd run build:all -- --force --pretty false`: 13プロジェクトを強制ビルドし、診断なしで終了コード0。
- `node node_modules/vite/bin/vite.js build`: 終了コード0。gameの静的・動的importが混在する旨の警告2件は引き続き出る。
- Playwrightの大規模回帰テストは再実行していない。ブラウザー動作の確認済みを意味しない。
- 依存の新規インストール、Python経由のビルド・配信、Android、外部サービス、実機の検証は行っていない。

次のビルド整理では、workspacesとロックファイルの扱い、複数のビルド経路の役割、新規環境での再現、共通確認コマンドを検討する。push、mainへの反映、旧リポジトリや旧Gitデータの廃止は未実施。

## 2026-10-11: 新規インストールと依存更新の確認

移行後、ユーザーが通常のローカルcloneで作成した `uroa-install-check` に対し、`npm.cmd ci`、TypeScriptビルド、Viteビルドを実行して成功した。移行後の既存Playwrightテストもユーザーが再実行して問題なかったと報告した。

続いて検証用コピーで `npm.cmd audit fix` を実行し、TypeScript・Viteビルドと、そのコピーから起動したViteサーバーに対するPlaywrightテストの成功をユーザーが確認した。この依存更新をuroaへ反映する作業で、`webgpu/package.json` が既存のignore設定によってGit管理から漏れていることを確認したため、既存ファイルを管理対象に含め、ロックファイルのワークスペース登録を復元した。

依存更新の差分、検証結果、残る脆弱性は [dependency-update.md](dependency-update.md) に記録する。上の「未実施」は移行直後の記録であり、後から得られた確認結果はこの節と依存更新記録で区別する。
