# ビルドと回帰テスト

更新日: 2026-10-11。公開用ビルドはuroaルートのTypeScript・Viteビルドに統一する。既存の5アプリ回帰テストは `tests/test.py` に置く。

## コマンド

作業ディレクトリはuroa。PowerShellでは `npm.cmd` を使う。

| コマンド | 処理 |
|---|---|
| `npm.cmd ci` | ロックファイルに従ってnpm依存を準備 |
| `npm.cmd run dev` | Vite開発サーバー。通常は5173番ポート |
| `npm.cmd run build:all` | 13プロジェクトのTypeScript参照ビルド。型確認と各 `lib/` の生成 |
| `npm.cmd run build` | 上記TypeScriptビルド成功後、ルートViteで `dist/` を生成 |
| `npm.cmd run check:dist` | 既存の `dist/` の入口・資産を確認 |
| `npm.cmd run verify` | `build` → `check:dist`。失敗した段階で終了 |
| `npm.cmd run preview` | 生成済み `dist/` をローカル配信。通常は4173番ポート |
| `npm.cmd run test:e2e` | Pythonで既存の5アプリ回帰テストを実行。接続先のサーバーとPython依存は事前準備が必要 |

`verify` はビルドと成果物の静的確認であり、ブラウザー操作は含まない。大規模Playwrightテストは明示的に実行する。Viteのpreviewはローカル確認用であり、本番配信サーバーではない。[Vite公式説明](https://vite.dev/guide/static-deploy.html)

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

教材・座標操作・実行順（webgpu、game、diagram、algebra、movie）、画面を表示する設定、待機方法は既存テストのまま。`timeout=0` のコンソール待機も維持しているため、期待する通知が来ない場合は手動中断が必要となる。サーバーの自動起動・終了、CI用設定、新しいテストケースは今回追加していない。

## 今回の確認

- `npm.cmd run verify`: 成功。型診断なし、Vite 7.3.7、169モジュール変換、92項目コピー。gameの静的・動的importが混在する既存警告2件は残る。
- 成果物のコピーを使い、開発用WebGPU HTMLによる上書き、JS欠落、WebGPU資産欠落が終了コード1で検出されることを確認。
- `tsc-all.bat`: 成功。
- Python 3.12でPythonファイルの構文、およびビルド入口が成功0・失敗7を返すことを確認。
- `py -3.12 build_all.py` による実際の公開ビルドも成功。上の失敗7の確認はsubprocessを模擬した終了コード伝播の確認であり、実際のビルド失敗を起こしたものではない。
- Vite開発・preview配信でルートと5アプリのHTML、開発時の変換済みTypeScript入口、公開時のJSをHTTPで確認。サーバーは確認後に終了した。ブラウザー操作の確認ではない。
- 起動できたPython 3.12にはPlaywrightがないため、今回の回帰テストは未実行。過去の成功結果は [dependency-update.md](dependency-update.md) のユーザー実行結果と区別する。
