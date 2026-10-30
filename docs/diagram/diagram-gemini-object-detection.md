# Gemini APIによるカメラ画像の物体検出

2026-10-15。実装とビルドまでを担当し、ユーザー指定によりテストは実行しない。実通信・認識精度・Android・XIAOの動作確認はユーザーが行う。

## 操作

1. Openで`gemini-object-detection.json`を選ぶ。またはCameraBlockとObjectDetectionBlock（Gemini物体検出）を配置し、カメラ出力を検出ブロックの「カメラ」入力へ接続する。接続元はCameraBlockを1つだけにする。
2. CameraBlockで「端末のカメラ」→「開始」→権限許可の順に操作し、先に画像を表示する。XIAOを使う場合は既存のWi-Fi接続を済ませて「XIAO」を選ぶ。
3. 検出ブロックの「接続」から自分のGemini APIキーと画像入力に対応するモデル名を入力する。既定は公式の画像理解ガイドの例に合わせた`gemini-3.8-flash`。利用可能な別モデルも指定できる。AIChatBlockとは別にキーを保持する。
4. 「1回検出」を押す。表示中の画像を1枚固定し、JPEGに変換してGoogleへ送信する。結果は送信した画像上の矩形・日本語ラベルと、下部のテキストに表示する。
5. 「検出停止」または全体Stopで待機を中断する。カメラ取得元変更・停止・接続変更・画像の利用不可・解像度変更でも検出結果を解除する。再開は明示操作で行う。

接続確認はモデル情報取得（models.get）の成功で、画像推論の対応・利用枠まで保証しない。画像推論の失敗はブロック下部に表示する。429は利用上限、401／403はキー・権限、404はモデル名の確認を案内する。Googleの生のエラー本文やAPIキーは表示・ログ出力しない。

Startでも1回検出してからActionチェーンへ進む。ラベル出力をTTSBlockの文字列入力につなぐと、Start時の検出完了後にラベルを読み上げられる。手動の「1回検出」はTTSを自動実行しない。配置した全runOnStartブロックを実行するため、未接続・未認証の検出ブロックもStartを失敗させる。まずサンプルの2ブロックで確認する。

## 入出力・保存

| ポート | 内容 |
|---|---|
| カメラ入力 | CameraBlockの接続参照。画像のPort.value伝播や画像DataTypeは追加しない |
| ラベル（TextPort） | 日本語ラベルを重複なしで「、」区切り。0件なら空文字列 |
| 個数（NumberPort） | 物体数。最大20件、0件なら0 |
| 先頭の物体（StructPort） | `ObjectDetection { label, x, y, width, height }`。モデルの応答順の先頭であり、信頼度順ではない。0件ならundefined |

x・yは矩形左上、width・heightは幅・高さ。送信画像を基準とした0〜1の正規化値で、原点は左上。Geminiの`[ymin,xmin,ymax,xmax]`、0〜1000の値から変換する。信頼度スコアは取得・生成せず、しきい値は設けない。全物体はブロック内で保持して表示し、現行DataTypeに配列型がないため配列出力は追加しない。停止・失敗・接続変更ではすべての出力をundefinedへ戻す。

JSON・コピーに含める追加設定はモデル名だけ。キー・画像・認識結果・接続状態は含めず、読込・コピーで接続や検出を開始しない。ObjectDetectionBlockの型番号は23、既存0〜22を維持する。

## 通信と後片付け

- [object-detection.ts](../../diagram/ts/ai/object-detection.ts): 検出ブロック、ポート出力・矩形表示、ObjectDetectionのStruct登録、コピー。
- [camera-ai-block.ts](../../diagram/ts/ai/camera-ai-block.ts): 画像説明と共通の接続フォーム、1枚の画像固定、UI・保存・取消。
- [gemini-vision-client.ts](../../diagram/ts/ai/gemini-vision-client.ts): 画像と指示・JSON Schemaの送信、応答検証、共通の座標への変換。
- [ai-client.ts](../../diagram/ts/ai/ai-client.ts): AIChatBlockと共通のREST通信・認証ヘッダー・エラー処理・Interactions応答解析・取消可能な時間制限。

追加のSDK・npm依存・サーバー・MediaPipe・WASM・モデルの同梱は不要。ブラウザーから固定の`https://generativelanguage.googleapis.com/v1beta/interactions`へ直接通信する。JPEGは長辺最大1024px、品質0.8、Base64を画像入力として渡す。指示は主要物体を最大20個、日本語名、印刷された物体は「〜の写真」等として実物と区別する内容。画像内の文字を指示として扱わないよう指定する。認識名・矩形の正しさを保証するものではない。

`response_format`でJSON Schemaを指定し、`store:false`でInteractionの保存を無効にする。キーはブロックのprivateフィールドで一時保持する。図JSON・コピー・URL・localStorage・sessionStorageへ含めない。接続フォームを閉じる際は入力を消去し、切断・Clear・図読込・削除・pagehide・破棄でアプリが保持するキーを解除する。通常の全体Stop・タブ非表示では待機と結果を解除し、保持済みキーは維持する。

接続確認は10秒、画像推論は60秒で時間切れとする。待機終了と世代番号の確認を併用し、取消を無視した通信・本文解析が遅れて完了しても表示・出力を更新しない。取消は送信済みのGoogle側処理・課金の取消を保証しない。連続送信・追跡・学習・自動サーボ操作は今回追加しない。

CameraBlockの`getFrame()`は画像・実寸に加え、取得元や利用可否・解像度の変更を表すrevisionを返す。`subscribeFrameState()`で状態変化を購読する。通常の画像更新ではrevisionを変えず、検出結果には固定した画像を使う。端末カメラはHTTPS／localhostと権限、XIAOは従来のWi-Fi・CORS条件に従う。

仕様の参照先: [画像理解・画像入力](https://ai.google.dev/gemini-api/docs/image-understanding)、[物体検出・座標とJSON出力](https://ai.google.dev/gemini-api/docs/image-understanding#object-detection)、[Interactions API](https://ai.google.dev/api/interactions-api)。検証範囲は[build-and-test.md](../build-and-test.md)に記録する。
