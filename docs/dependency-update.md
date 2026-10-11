# 依存更新と新規インストールの確認

実施日: 2026-10-11。ユーザーが `uroa-install-check` で検証した `npm audit fix` の結果をuroaへ反映した。対象は依存の固定バージョンとnpmワークスペースの登録であり、アプリのTypeScriptソースは変更していない。

## 反映した変更

ルートの `package.json` の依存範囲は検証用コピーと同じで、変更していない。`package-lock.json` には検証用コピーの更新を取り込んだ。主な固定バージョンの差分は以下の通り。

| パッケージ | 更新前 | 更新後 |
|---|---|---|
| vite | 7.3.2 | 7.3.7 |
| esbuildと各プラットフォームのバイナリ | 0.27.3 | 0.28.2 |
| vite-plugin-static-copy | 4.1.0 | 4.1.1 |
| websocket-driver | 0.7.4 | 0.7.5 |
| @grpc/grpc-js | 1.9.15 | 1.9.16 |
| protobufjs | 7.5.5 | 7.6.6 |
| postcss | 8.5.13 | 8.5.29 |
| nanoid | 3.3.11 | 3.3.20 |

ほかにprotobufjsの補助パッケージ、brace-expansion、source-map-js、tinyglobbyなどが更新された。Firebase SDKは10.14.1のまま。

`webgpu/.gitignore` が `package.json` を除外していたため、元のuroaにはファイルがある一方、通常のcloneには含まれていなかった。今回、そのignore行を削除し、既存の `webgpu/package.json` を内容を変えずにGit管理へ追加した。

検証用コピーのロックファイルでは `node_modules/@stem/webgpu` のリンクが消え、`webgpu` に `extraneous: true` が付いていた。この2点を元のワークスペース登録に戻した。外部パッケージの登録内容はすべてユーザーが検証したロックファイルと一致する。

## 検証

ユーザーが通常のローカルcloneで作成した `D:/usr/prj/uroa-install-check` で実施した確認:

- `npm.cmd ci` に成功し、TypeScript・Viteビルドにも成功。
- `npm.cmd audit fix` 後もTypeScript・Viteビルドに成功。Viteは7.3.7。
- 更新後のコピーから起動したViteサーバーに対する既存Playwrightテストも問題なかったとユーザーが報告。

これらのブラウザー確認はユーザーによる実行結果であり、今回CodexがPlaywrightを再実行した結果ではない。

uroaへの反映後にCodexが実施した確認:

| 確認 | 結果 |
|---|---|
| `npm.cmd ci --no-audit --no-fund` | 終了コード0。309パッケージを新規インストール |
| `npm.cmd run build:all -- --force --pretty false` | 終了コード0。型診断なし |
| `node node_modules/vite/bin/vite.js build` | 終了コード0。Vite 7.3.7、169モジュール変換、92項目コピー |
| ワークスペース登録の照合 | 9個すべてのmanifestとロックファイルのリンク先が一致。WebGPUのインストール済みリンク先も確認 |
| ロックファイルの照合 | WebGPU登録の補修を除き、すべてのパッケージ登録がユーザー検証済みコピーと一致 |
| WebGPUのmanifestの照合 | 元ファイルとバイト単位で一致 |
| `npm.cmd audit --json` | 14件（moderate 6、high 8、critical 0）。ユーザー提示結果と一致 |

Viteのgame/index・isometricの静的importと動的importが共存する警告2件は引き続き出る。Python経由のビルド・配信、Firebase実サービス、Android、ESP32実機の確認は今回行っていない。

## 残る脆弱性

検証用コピーでユーザーが提示した更新後の `npm audit` 結果は14件（moderate 6、high 8）。今回uroaで取得した監査結果も同じ件数だった。更新前の23件（critical 1を含む）から減少したが、解消済みではない。

| 主な依存経路 | 残る指摘 |
|---|---|
| Firebase → Firestoreなど → @grpc/grpc-js | 認証コンテキストやエラーメッセージに関する指摘 |
| Firebase → Auth・Functions・Storage・Firestoreなど → undici | HTTP・WebSocketなどに関する指摘 |
| vite-plugin-static-copy → chokidar → braces | 深く入れ子になったパターンによるスタック枯渇 |

提示された `npm audit fix --force` の候補はFirebase 9.14.0とvite-plugin-static-copy 0.2.0への変更を含む。今回は実行しない。別作業で依存元の対応状況と互換性を調べ、対象機能の検証を伴う更新を行う。監査件数は依存と監査データの更新によって変わるため、将来の作業では再確認する。

変更前のロックファイル、ユーザー検証済みのロックファイル、WebGPU設定の控え、`verification.json`、今回の監査結果 `audit.json` は `D:/usr/prj/uroa-migration-backup/2026-10-11-dependency-update/` に保存した。
