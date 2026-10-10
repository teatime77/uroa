# algebraの単一リポジトリ化

実施日: 2026-10-11（日本時間）。algebraだけを対象とし、ソース・教材・ビルド設定の内容とフォルダー配置を維持した。

その後、同日に残る12サブモジュールも移行した。現在の構成と後続作業は [全体の移行記録](monorepo-migration.md) を参照する。以下はalgebra先行移行時点の記録。

## 変更内容と履歴

- 作業ブランチ: `migration/algebra-monorepo`。
- 移行前のuroa HEAD: `4bcaa0a850948b22a4db99c3c906bb148c1e0600`。
- 旧algebra HEAD: `8c4c8cf84ec053a651cbd5949f9c61621a4780e1`。
- Gitのgitlink登録を外し、algebra内の追跡済み17ファイルを通常のファイルとして登録した。
- `.gitmodules`と親リポジトリのローカル設定からalgebraの登録を外した。
- `algebra/.gitignore`は元の内容・位置を維持した。
- `ours`戦略のマージで、旧algebra HEADとその祖先59コミットを接続した。旧コミットIDと旧履歴内のパスは維持される。過去のファイルは旧HEADを指定し、例えば `git log 8c4c8cf -- ts/formula.ts` で確認できる。
- 旧ブランチ・タグ名のuroaへの登録は行っていない。元のGitデータと全参照のbundleを保持した。

## バックアップと検証用コピー

保存先: `D:/usr/prj/uroa-migration-backup/2026-10-10T14-59-14-182Z-algebra/`（フォルダー名の日時はUTC）。uroaのGit管理対象外に置いた。

- `uroa.bundle`と`algebra.bundle`: 全参照とHEADの履歴。両方を `git bundle verify` で検証した。
- `before.json`: 移行前のコミット、ブランチ、algebraの参照一覧と54ファイルのSHA-256。
- `uroa-index`、`uroa-config`、`gitmodules.before`: 移行前の管理情報。
- `algebra.gitlink.txt`: 退避した `algebra/.git` ファイル。
- `rehearsal/`と`rehearsal-result.json`: 検証用コピーと成功記録。
- `migration-result.json`: 実際の移行直後のファイル照合結果。

`uroa/.git/modules/algebra`は削除していない。bundleは未コミット変更や未追跡ファイルのバックアップではない。今回、uroaとalgebraの作業ツリーがクリーンであることを事前確認した。

## 実行した主要コマンド

PowerShell、作業ディレクトリはuroa。事前のbundle作成と検証用コピーでの試行を終えた後、次の処理を実施した。

```powershell
git checkout -b migration/algebra-monorepo
git fetch D:/usr/prj/uroa-migration-backup/2026-10-10T14-59-14-182Z-algebra/algebra.bundle HEAD
git merge --allow-unrelated-histories -s ours --no-ff --no-commit 8c4c8cf84ec053a651cbd5949f9c61621a4780e1
git rm --cached -- algebra
```

`algebra/.git`が `gitdir: ../.git/modules/algebra` を指すファイルであることを確認し、バックアップ先へ退避した。その後、作業ファイルを書き換えないよう `-u` を付けずに登録した。

```powershell
git read-tree --prefix=algebra/ 8c4c8cf84ec053a651cbd5949f9c61621a4780e1
git config -f .gitmodules --remove-section submodule.algebra
git config --local --remove-section submodule.algebra
git add -- .gitmodules
```

環境のGitは `2.12.0.windows.1`。検証用コピーでは `.git/modules/algebra`からの直接fetchが無出力で失敗したため、検証済みbundleから取得した。

## 検証結果と残作業

- 検証用コピーで、マージの親が移行前uroa HEADと旧algebra HEADになることを確認した。
- 実際の移行直後、生成物を含む54ファイルのSHA-256が移行前と一致した。
- 追跡ファイル17件のツリーは旧algebraのツリー `21d8991e852cc078301ef0513d8307fc971feb5c` と一致した。
- `node node_modules/typescript/bin/tsc -b tsconfig.sys.json --pretty false`: 終了コード0。
- `node node_modules/vite/bin/vite.js build`: 終了コード0。gameの静的・動的importが混在する旨の警告2件が出た。
- 旧ファイルのCRLFや行末空白も保持したため、通常の `git diff --cached --check` は取り込む旧ファイルに警告を出す。ソースの整形変更は行っていない。
- Playwrightの大規模回帰テストは変更・再実行していない。ブラウザー動作を今回確認済みとは扱わない。

残る12サブモジュールと、既存の `git submodule foreach` を使うビルド・インストールコマンドはそのまま。ルートのTypeScript参照とnpm workspacesには引き続きalgebraが含まれる。全体のビルド整理、diagram/Firebaseの機能修正、robot統合、pushは今回の対象外。
