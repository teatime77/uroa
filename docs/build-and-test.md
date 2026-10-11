# ビルドと回帰テスト

更新日: 2026-10-11。公開用ビルドはuroaルートのTypeScript・Viteビルドに統一する。既存の5アプリ回帰テストは `tests/test.py` に置く。

## コマンド

作業ディレクトリはuroa。PowerShellでは `npm.cmd` を使う。

| コマンド | 処理 |
|---|---|
| `npm.cmd ci` | ロックファイルに従ってnpm依存を準備 |
| `npm.cmd run dev` | Vite開発サーバー。通常は5173番ポート |
| `npm.cmd run build:all` | 14プロジェクトのTypeScript参照ビルド。共通入口appを含む型確認と各 `lib/` の生成 |
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

教材・座標操作・実行順（webgpu、game、diagram、algebra、movie）、画面を表示する設定、待機方法は既存テストのまま。`timeout=0` のコンソール待機も維持しているため、期待する通知が来ない場合は手動中断が必要となる。サーバーの自動起動・終了、CI用設定は追加していない。P3専用の確認は別のテストへ追加した。

## 操作JSONの保存・読込の確認

保存形式や操作クラスを変更するときは、既存の5アプリ回帰テストに加えて、次の専用テストを使う。Python・Playwrightの準備は上記と同じ。サーバーは別ターミナルで起動しておく。

```powershell
npm.cmd run dev -- --port 5173 --strictPort
# 別ターミナルで実行
python tests/test_operation_json.py --base-url http://localhost:5173/
```

`test_operation_json.py` はソースモジュールを読み込むため、Vite開発サーバーに対して実行する。previewには既存 `tests/test.py` を使う。公開教材22件、全7種類の操作、空データの読込→toJson→JSON文字列化→再読込を比較し、旧形式の拒否が画面を消去しないこと、編集画面のSaveと再生で操作・図形・関係ログが一致することを確認する。比較時は採番されるoperationIdを除く。ClickShape.toJsonは座標を小数2桁に丸めるため、任意精度の座標は完全一致せず、その例も結果に表示する。Firebaseへの実際の読み書きは含まない。

## P2での確認（2026-10-11）

- `npm.cmd run verify`: 成功。型診断なし、Vite 7.3.7、169モジュール変換、92項目コピー。gameの静的・動的importが混在する既存警告2件は残る。
- 成果物のコピーを使い、開発用WebGPU HTMLによる上書き、JS欠落、WebGPU資産欠落が終了コード1で検出されることを確認。
- `tsc-all.bat`: 成功。
- Python 3.12でPythonファイルの構文、およびビルド入口が成功0・失敗7を返すことを確認。
- `py -3.12 build_all.py` による実際の公開ビルドも成功。上の失敗7の確認はsubprocessを模擬した終了コード伝播の確認であり、実際のビルド失敗を起こしたものではない。
- Vite開発・preview配信でルートと5アプリのHTML、開発時の変換済みTypeScript入口、公開時のJSをHTTPで確認。サーバーは確認後に終了した。ブラウザー操作の確認ではない。
- 起動できたPython 3.12にはPlaywrightがないため、今回の回帰テストは未実行。過去の成功結果は [dependency-update.md](dependency-update.md) のユーザー実行結果と区別する。

## P3専用の確認

[起動・終了仕様](app-lifecycle.md)の変更では、既存テストに加えて次を実行する。Python環境とブラウザーの準備は上記と同じ。

```powershell
# 初期化順序、重複、失敗、初期化中の停止・破棄、後片付けの失敗
npm.cmd run test:lifecycle

# サーバーは別ターミナルで起動しておく
npm.cmd run test:e2e:lifecycle -- --base-url http://localhost:5173/
npm.cmd run test:e2e:lifecycle -- --base-url http://localhost:4173/
```

`tests/test_lifecycle.py` は5アプリの直接起動・重複起動・破棄、diagramの60秒待機の停止と再実行、子アプリの停止・画面復帰、停止後のGPU追加送信、HTTP失敗時の状態・破棄を確認する。確認用データは現行の保存形式で作り、旧教材の互換性とは分ける。

### P3での実行結果（2026-10-11）

- `npm.cmd run verify`: 成功。TypeScript診断0、173モジュール変換、92項目コピー、成果物チェック成功。既存のimport混在警告2件は残る。
- `node --test tests/lifecycle.test.mjs`: 5件成功。
- 既存 `tests/test.py`: 開発サーバー5183とpreview4183の両方でwebgpu・game・diagram・algebra・movieすべて成功。
- P3専用のブラウザ確認: 開発5183・preview4183の両方で成功。5アプリの直接・重複起動と破棄、60秒待機の停止・再実行、diagramからmovie・game・webgpuの停止と復帰、停止後500msのGPU追加送信なし、HTTP失敗時の状態と後片付けを確認。

検証中、複数のブラウザーを並行実行した回ではPlaywrightのdriverがメモリ不足で終了した。単独実行で確認する。連携テストで見つけたWebGPUの資産パスとmovie停止後の件数assertは修正済み。ブロック用のテスト入力もInputNumberBlockのvalueとInputTextBlockのtextに合わせた。

検証では作業フォルダー内の `tmp/p3-venv` にPython 3.12・Playwright 1.63.0を準備し、既存のChromiumを使用した。通常の実行コマンドのPython環境は利用者の環境で準備する。`tests/test.py` のSHA256は変更前後とも `FE2F4527A91AAFEDF7C23326280C3EC2BCB44D9C4DEC9037E90F76C5885886FD`。

音声を実際に聞いての確認、全GPUデモの数値・停止、Android、ESP32、Firebaseの外部操作は未検証。GPU停止の専用確認はdiagram経由のfdtdパッケージを対象とする。
