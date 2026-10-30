# Gemini画像説明ブロック

2026-10-15。ユーザー指定によりテストは実行せず、実装・ビルドまで。ブラウザー・Google実通信・Android・XIAO・実音声は未確認。

## 操作

1. Openで`gemini-image-caption.json`を選ぶ。CameraBlock → ImageCaptionBlock（Gemini画像説明）→ TTSBlockの配線済みサンプルを開く。
2. CameraBlockで「端末のカメラ」→「開始」から画像を表示する。XIAOを使う場合は既存のWi-Fi接続後に「XIAO」を選ぶ。
3. 画像説明ブロックの「接続」で自分のGemini APIキーと画像入力対応モデルを入力する。既定は`gemini-3.8-flash`。キーはブロックごとに保持し、物体検出・AIチャットとは共有しない。
4. 「画像を説明」で画像1枚をGoogleへ送信し、日本語の短い1〜3文の説明を取得する。送信した固定画像と説明文を表示する。
5. Startを押すと説明取得後にTTSが読み上げる。手動の「画像を説明」はTTSを自動実行しない。Startは配置済みの全runOnStartブロックを対象にするため、他の未接続・未認証ブロックにも注意する。

接続確認はモデル情報の取得成功で、画像推論の対応・利用枠までは保証しない。「画像をGoogleへ送信中…」にはGoogle側の解析・応答待ちも含む。連続送信は行わず、1回の操作ごとに画像を取得する。

## 入出力と保存

入力はCameraBlockから1本接続する「カメラ」Port。画像のポート値伝播は追加せず、接続元の`getFrame()`を参照する。出力は「説明文」TextPortで、TTSBlock等の文字列入力へつなげる。人物・物体・個数・位置関係・状況を短い日本語で説明するよう指定し、印刷物を実物と区別し、画像中の文字を指示として扱わないよう指示する。物体検出結果のラベルを文章へ変換する方式ではなく、元の画像をGeminiへ送る。認識・説明の正確さは保証しない。

成功時は前後の空白を除いた説明文を出力し、空文字列または4,000文字超の応答はエラーとする。開始・中断・失敗・カメラの配線／状態変更では前回の説明文と画像を解除し、出力をundefinedへ戻す。Start時の失敗は後続Actionへ進めない。

JSON・コピーへ追加する設定はモデル名だけ。APIキー・画像・説明文・接続状態は含めず、読込・コピーで接続や送信を始めない。型名は`ImageCaptionBlock`、型番号は24、既存0〜23を維持する。

## ソースと共通処理

- [image-caption.ts](../../diagram/ts/ai/image-caption.ts): 説明文のTextPort出力・表示、factory登録とコピー。
- [gemini-vision-client.ts](../../diagram/ts/ai/gemini-vision-client.ts): `captionGeminiImage()`で画像と説明指示を送信し、通常のテキスト応答を返す。物体検出のJSON Schema指定は使わない。
- [camera-ai-block.ts](../../diagram/ts/ai/camera-ai-block.ts): 物体検出と画像説明で共有する画像固定・キー入力・接続確認・通信待機・表示・保存・後片付け。
- [ai-client.ts](../../diagram/ts/ai/ai-client.ts): 固定のGoogle APIへのREST通信、認証ヘッダー、共通の応答解析・エラー処理。

画像は長辺最大1024px、JPEG品質0.8、Base64でInteractions APIへ送信する。接続確認は10秒、説明取得は60秒の時間制限。`store:false`を指定する。SDK・サーバー・モデル資産の追加はない。

全体Stop・手動の説明停止・カメラの配線変更・取得元変更・利用不可・解像度変更・タブ非表示で待機と結果を解除する。切断・Clear・図読込・削除・pagehide・破棄では保持キーも解除する。通常のStopは保持済みキーを維持する。世代番号とAbortSignalで遅れた応答を抑止し、削除時はカメラ／配線／停止の購読・DOMを解放する。中断はGoogle側の処理・課金の取消を保証しない。

物体検出は同じ共通基底を利用するが、ポート順・型名・型番号・モデル設定・矩形表示・検出プロンプトは維持する。物体検出のStruct定義は`object-detection.ts`内に置く。操作は[物体検出ガイド](diagram-gemini-object-detection.md)、検証範囲は[build-and-test.md](../build-and-test.md)、API仕様は[公式の画像理解ガイド](https://ai.google.dev/gemini-api/docs/image-understanding)を参照する。
