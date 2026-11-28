# ESP32 VM → ブラウザVMのRPC：段階別実装計画

作成日：2026-11-27、更新日：2026-11-28（日本時間）。第0段階の方針はユーザー承認済み。第1段階の独立した解析・生成、第2段階のブラウザVM受付、第3段階のBLE整数通知と2ソースの開始UIを実装した。2026-11-28に追加した共通RPC APIへ、このPython RPCの呼出しも接続した。ただし送受信処理の自動生成による置換は一部だけであり、手書き実装を減らすための生成化計画を本書に追加した。生成化1〜4に加え、生成化5の既存通信への展開と両側ビルドを完了した。生成化6とPython RPCの第4〜7段階は未着手。今回のAPI統一や静的調査でPython RPCの進捗段階を繰り上げない。Future更新・配列・Python RPCのWi-Fi配送は未対応で、ブラウザ・実通信・実機での動作確認は未実施。

対象はuroaと、別リポジトリーの`D:\usr\prj\esp32\app\diagram-control`。本書は作業順、変更候補、決定が必要な事項、完了条件を整理する。実装済み仕様の正本はソースの定義とコメントとし、共通APIは`.proto`、Python RPCの既存配送は`rpc-protocol.ts`等を参照する。各段階で実装と同時に正本を更新し、本書へパケットのバイト配置や命令の詳細仕様を追加・重複記載しない。

## 1. 今回の到達目標

ESP32上のPythonから、ブラウザVMにある`Remote`派生クラスのオブジェクトを呼び出す。結果が必要な呼出しは、その場で送信を開始してFutureを返し、ESP32の処理を続行する。結果の利用は`result.done`を確認してから行う。spawn、別スレッド、ESP32のタスク切替、awaitは今回導入しない。

ESP32用とブラウザ用のPythonソースは別に用意する。構文解析・意味解析・バイトコード生成も、それぞれ独立した入力・状態・結果で行う。パーサー・意味解析器・生成器の実装コードは共用し、実行先に応じた利用可能APIと検査を切り替える。構文木、変数・クラス表、スロット番号、ヒープ、大域値をVM間で共有しない。

ブラウザ側の解析からRemoteの公開名・メソッド名・引数型・戻り値型・非同期指定を抽出し、RPC登録情報を生成する。ESP32側の意味解析には、その登録情報を外部API定義として渡す。メソッド本体をESP32側で再解析したり、宣言を両ソースへ手作業で重複記述したりしない。両成果物はRPC登録情報の指紋で対応を確認する。

以下はFutureまで完成した後に目指す2ソースの例。現在の第3段階は`def ... -> None`・整数引数0〜1個だけを開始でき、`async def`を含む公開定義は開始前に拒否する。現在使う整数通知の組は第3段階の操作例を参照する。

ブラウザ側のソース例：

```python
class Browser(Remote):
    def show(self, value: int) -> None:
        print(f"received: {value}")

    async def calc(self, value: int) -> int:
        return value * 2

browser = Browser()
```

ESP32側のソース例：

```python
from remote import browser

browser.show(10)
result = browser.calc(21)

while not result.done:
    # この間もESP32側の処理を進める。RPCの再送はしない。
    sleep(0.01)

if result.error == 0:
    print(f"result: {result.value}")
else:
    print(f"RPC error: {result.error}")
```

`from remote import browser`は生成したRPC登録情報から代理オブジェクトを参照する採用構文。ESP32でブラウザ側ソースをimport・実行する意味ではない。解析・公開定義・未実行成果物の入口は[remote.ts](../../../diagram/ts/python/remote.ts)を参照する。

この例の`async def`は、呼出し元がFutureを受け取るRemoteメソッドの宣言を目標とする。ブラウザでの処理開始と応答生成はRPCホストが管理する。一般的なコルーチン、メソッド内部のawait、JavaScript Promiseとの接続、CPU計算の並列化は別の機能として扱う。

RPC完了後の別作業とするもの：

- Plotly.jsによるプロット、更新、描画完了待ち。
- Three.jsによる3D表示、シーン・オブジェクト操作。
- それらのDOM操作・描画APIをPythonへ公開するホスト接続。

また、ブラウザ上のPythonからESP32上のPythonを呼ぶ逆向きRPC、動的なRemoteオブジェクトの生成・破棄、一般的なクラス継承、object配列・循環オブジェクトの転送、永続化、自動再接続による実行再開は今回の対象外とする。ブラウザのTypeScriptからサーボ等を操作する既存機器APIと、その共通RPC API化は、この逆向きPython RPCとは区別する。

### 共通RPC APIとの関係（2026-11-28）

機器制御・センサー購読・プログラム転送・デバッグ・Wi-Fi設定・カメラ取得の呼出しAPIを共通化した。Python RPCの公開定義抽出・VM実行・専用BLE配送は、この共通APIへ接続した既存実装として残る。

現状の自動生成は型・操作表・固定長配置とC++の一部書込み処理が中心である。TypeScriptの汎用codec、操作ごとの既存処理への対応付け、C++の受信復号・指令振分けなどは手書きで残っている。呼出しAPIの共通化は、送受信処理を生成コードへ置き換えて手書き実装を削減する作業の完了を意味しない。

| 対象 | 現在の分担と参照先 |
|---|---|
| 共通の操作・型・生成対象の固定長配置 | [device.proto](../../../diagram/rpc/device.proto)・[options.proto](../../../diagram/rpc/options.proto)を正本とし、[generate.mjs](../../../diagram/rpc/generate.mjs)がTypeScriptとC++を生成する。既存ホスト型へ参照を渡す定義もあり、すべての既存転送形式を`.proto`のcodecへ置き換えたものではない。 |
| 呼出しAPIと既存通信への接続 | [rpc-client.ts](../../../diagram/ts/ble-wifi/rpc-client.ts)・[device-rpc.ts](../../../diagram/ts/ble-wifi/device-rpc.ts)・[device-connection.ts](../../../diagram/ts/ble-wifi/device-connection.ts)が担当する。既存のBLE／Wi-Fi形式と認証を維持する。 |
| Python公開定義とVMの呼出し | [remote.ts](../../../diagram/ts/python/remote.ts)がPythonソースから公開オブジェクト・署名・代理APIを生成する。これらの利用者定義を共通`.proto`へ手作業で重複記述しない。 |
| Python RPCの実行ごとの配送 | [remote-session.ts](../../../diagram/ts/python/remote-session.ts)が共通APIから専用窓口を取得し、[rpc-protocol.ts](../../../diagram/ts/ble-wifi/rpc-protocol.ts)の登録・要求読出し・Worker受付確認を利用する。実行可能な範囲は第3段階のまま。 |

共通APIが返すJavaScriptの`Promise`と、本計画で追加するESP32 VM上の`Future`は別の値・寿命を持つ。API統一だけではFutureの生成・完了反映・GC管理は実装されず、機器APIのWi-Fi対応もPython RPCの第6段階完了を意味しない。

共通APIのサービス／メソッド番号と、Pythonの公開オブジェクト／メソッド・動的nativeの番号は別の識別体系である。同様に、`.proto`から生成する指紋は生成物の整合用であり、Pythonの登録情報・合成APIの指紋と区別する。今回、共通定義の指紋を相手機器と交換する処理は追加しておらず、従来のPython RPCの指紋照合を削除・代替したものでもない。

共通API化のビルド結果と未確認範囲は[2026-11-28の検証記録](../../build-and-test.md)を参照する。本計画の残る第4〜7段階では、共通APIと既存アダプターを拡張し、Python固有のFuture・値転送・VM寿命の処理を接続する。

## 2. 計画開始時の出発点

以下は第1〜3段階へ着手する前に2026-11-27のソースから整理した出発点であり、現在も未実装という意味ではない。その後の到達点は各段階の実施内容と進捗記録、共通API化後の分担は前節と次節を参照する。ブラウザ・通信・実機での動作確認とは区別する。

| 対象 | 現在地とRPCで必要になる変更 |
|---|---|
| [parser.ts](../../../diagram/ts/python/parser.ts)・[syntax.ts](../../../diagram/ts/python/syntax.ts) | ユーザークラスはあるが継承は拒否する。Remote指定とasyncメソッドの構文木・ソース再生成が必要。 |
| [semantic.ts](../../../diagram/ts/python/semantic.ts) | 機器・ユーザークラス、スカラー、ndarrayを扱う。Remote代理型、Future型、実行先の名前解決を追加する必要がある。 |
| [bytecode.ts](../../../diagram/ts/python/bytecode.ts) | 通常入口はversion 7、ブラウザ入口はversion 7/8。RPC用の生成・登録情報と、必要な形式更新は未実装。 |
| [python-block.ts](../../../diagram/ts/python/python-block.ts) | 実行先はESP32かブラウザの選択。両方を一組として開始・停止する経路はない。 |
| [browser-runtime.ts](../../../diagram/ts/python/browser-runtime.ts)・[browser-vm-worker.ts](../../../diagram/ts/python/browser-vm-worker.ts) | 実行ごとにWorkerを生成し、終了時に破棄する。Remote公開中の保持、要求受付、メソッド実行、応答が必要。 |
| [browser/host.cpp](../../../../esp32/app/diagram-control/browser/host.cpp) | 共通C++ VMへのC公開関数、print、同期CALL_KERNELがある。外部から登録済みユーザーメソッドを呼ぶ入口はない。 |
| [bytecode_vm.h](../../../../esp32/app/diagram-control/include/bytecode_vm.h)・[bytecode_vm.cpp](../../../../esp32/app/diagram-control/src/bytecode_vm.cpp) | PC・値スタック・フレームを持つVM。NativePendingは同じ命令を次tickで再試行する仕組みであり、即時にFutureを返すRPCとは区別する。 |
| [bytecode_heap.h](../../../../esp32/app/diagram-control/include/bytecode_heap.h)・[bytecode_heap.cpp](../../../../esp32/app/diagram-control/src/bytecode_heap.cpp) | 移動しないマーク＆スイープGC。根と再帰マークはVM側。非同期処理へVM内部の借用ポインターを持ち越さない規約がある。 |
| [control-connection.ts](../../../diagram/ts/ble-wifi/control-connection.ts)・[control_transport.h](../../../../esp32/app/diagram-control/include/control_transport.h) | BLE／Wi-Fiの経路・接続世代・制御権を共通化している。RPCの双方向配送窓口は追加が必要。 |

共通APIと生成対象の固定長配置は`.proto`、機器操作・センサー通知・コード一括転送・デバッグの既存アダプターは各ソースのコメントを参照する。Python RPC要求を最新値だけ保持するセンサー通知領域へ上書きせず、要求を識別して処理する方針は維持する。

## 3. 実装時の分担と仕様コメントの記述先

以下は2026-11-28時点の担当先を基準にした後続段階の変更先である。「新規候補」と明記したものだけが未作成であり、既存ファイルを新規候補として扱わない。分割は各段階で必要な範囲にとどめる。

| 担当 | 変更候補・仕様コメントの記述先 |
|---|---|
| 独立したソースの解析とRemote署名の受渡し | 既存の`diagram/ts/python/remote.ts`を入口とし、`syntax.ts`、`parser.ts`、`semantic.ts`、`bytecode.ts`の実行先別解析・生成を使う。Pythonの公開定義変更を代理APIへ反映する。個別の型・生成規則は該当処理の直前へ置く。 |
| Futureの値・完了・エラー・保持 | `semantic.ts`とESP32の`bytecode_vm.h/.cpp`を拡張する。既存の`include/bytecode_rpc.h`・`src/bytecode_rpc.cpp`が所有する登録・要求管理へ、後続段階のFuture完了反映を接続する。 |
| 共通RPC API・生成物 | `diagram/rpc/device.proto`・`options.proto`と`generate.mjs`。TypeScriptの`device-rpc.generated.ts`、ESP32の`lib/protocol/include/uroa_rpc.generated.h`・`src/uroa_rpc.generated.cpp`は生成元から更新し、手編集しない。 |
| 共通の呼出し・購読とアダプター | `rpc-client.ts`・`device-rpc.ts`・`device-connection.ts`。引数・結果・対応経路の拡張は共通APIと既存処理への対応付けへ反映する。 |
| Python RPCメッセージ、配送、識別・上限 | 既存の`rpc-protocol.ts`が専用配送の中心契約、ESP32の`bytecode_rpc.h/.cpp`が受信・登録・要求管理を担当する。共通APIの管理用IDとPython呼出しのIDを混同しない。 |
| ブラウザの公開オブジェクトと要求実行 | `browser-runtime.ts`、`browser-vm-worker.ts`、`browser-abi.ts`、ESP32リポジトリーの`browser/host.cpp`。`remote-session.ts`が共通APIとブラウザVMの仲介を担当する。 |
| 開始・停止・接続の所有者 | `python-block.ts`・`remote-session.ts`、`device-connection.ts`、ESP32の`main.cpp`。全体Stopとの接続は既存の`diagram/ts/runtime.ts`を利用する。 |
| BLE／Wi-Fiへの接続 | Webの`control-connection.ts`、`ble-control-transport.ts`、`robot-wifi.ts`。ESP32の`control_transport.h/.cpp`、`network.cpp`、`lib/ble/include/uroa_ble.h`・`src/uroa_ble.cpp`、`lib/wifi/include/uroa_wifi.h`・`src/uroa_wifi.cpp`。 |
| 形式変更の反映 | `bytecode.ts`、`bytecode-transfer.ts`、ESP32の`bytecode_format.h/.cpp`、`bytecode_receiver.cpp`、`bytecode_debugger.cpp`。必要な場合だけ機器API宣言・生成器へ反映する。 |

後続段階で共通APIの型や対応経路を変える場合は、`.proto`と生成物・アダプターを同じ段階で揃える。Python固有の配送形式・VMの値と寿命に関する仕様は担当ソースへ記述し、本書には変更先と完了条件を残す。

### 送受信コードの自動生成と手書き実装削減の計画

状態：生成化1〜5を完了。通常指令に加え、機器一覧・Telemetry・転送・デバッグ・Python RPC・Wi-Fi設定／制御・JPEG取得の外側へ生成処理を接続した。生成化6は未着手。Python RPCの第0〜7段階とは別の共通基盤の移行作業として扱い、第3段階の機能を維持したまま進める。先に通常指令をクライアントからサーバーまで生成化し、同じ仕組みを既存通信へ展開してから、第4段階のFuture拡張へ進む。

目標は、`.proto`から要求・応答の型、符号化・復号、クライアントの送受信処理、サーバーの要求振分けと応答処理まで生成し、対応する手書き実装を削除すること。生成済みの型へ既存処理を渡すラッパーを増やすだけでは完了としない。gRPCのサービス定義とコード生成の考え方を使い、Protocol Buffersとのバイナリ互換や実際のgRPC／HTTP/2への移行は要件に加えない。

既存のBLE／Wi-Fi通信形式を維持する方針を引き継ぐ。既存の操作番号・パケット配置・UUID・HTTP窓口・応答先への対応を`.proto`の宣言と共通の生成規則で表し、同じバイト列と配送先を扱うコードを生成する。既存パケットへ共通RPCのサービスIDや呼出しIDを追加することは、本生成化には含めない。型定義だけで既存形式への変換を推測せず、生成に必要な対応情報が不足する場合は生成元で明示する。

#### 生成する範囲と手書きで残す範囲

| 区分 | 生成・共通化する処理 | 手書きで残す処理 |
|---|---|---|
| データの表現 | 両側の通信型、符号化・復号、格納幅・長さ・版・予約値等の通信上の検査。必要な単位変換や既存パケットへの対応も生成元から決める。 | サーボの利用状態、機器の存在、VM命令の妥当性など、機能・実行状態に依存する検査。 |
| クライアント | 操作ごとの要求作成・送信・応答復号を行うメソッドと、既存sequence等を共有の応答待ち処理へ接続するコード。 | 機器・ユーザー操作・実行世代の所有管理と、画面やブロックへの結果反映。 |
| サーバー | 要求の種類判定・引数復号・型付きハンドラーへの振分け・応答符号化・送信元への返送。 | サーボ操作、センサー測定、VM開始・停止などの処理本体。通信コールバックから機器やVMを直接操作しない責任分担も維持する。 |
| 通信経路 | サービス／操作と既存GATT特性・HTTP窓口等の対応表、経路に応じた生成済み呼出しコード。 | BLE接続・Read/Write/Notify、HTTP/WebSocketの入出力、認証・HMAC・制御権・切断処理。 |
| 通知・大きなデータ | 購読・解除、通知復号、分割データのヘッダーや結果の読み書きと、共有の転送処理への接続。 | 待ち列、期限・取消・再構築・ACK待ちなどの共通ランタイムを1か所で実装する。バイトコード検証・Snapshotの作成・画像取得等の処理本体は残す。 |

`host_type`はブロック・Receipt・Snapshot等のローカル参照や所有権を扱う用途と、実際に通信する値型を分けて整理する。通信する内容を型名だけで外部の手書きcodecへ委譲して生成済みとは扱わず、その通信型と上限・変換に必要な情報を生成元へ揃える。ローカルオブジェクトやVM内部アドレスをそのまま送信する変更は行わない。

#### 移行順と段階ごとの完了条件

| 段階 | 作業 | 完了条件 |
|---|---|---|
| 生成化1：現状と置換対象の整理 | 既存の操作・要求・応答・通知・分割転送と、その手書きの生成・復号・振分け箇所を一覧化する。生成対象・共通ランタイム・機能本体を分け、現時点の手書き行数と残す理由を記録する。 | 各通信について生成元、送信側、受信側、削除候補が対応付いている。既存形式を再現するための定義不足と、必要な共通処理が判明している。 |
| 生成化2：両側のcodec生成 | まずCommand／Statusを対象に、TypeScriptとC++それぞれに必要な符号化・復号を生成する。生成方向を定義し、使わないC++の送信関数等を常に出力する構成も見直す。移行後は対応する手書きのフィールド読み書き・同じ通信検査を削除する。 | 同じ定義から両側のcodecを生成でき、既存の配置・符号・単位・長さとの静的な対応確認と両側のビルドが完了する。旧codecへ迂回する呼出しが残らない。実際の送受信結果の一致は、実機確認を行った場合だけ確認済みとする。 |
| 生成化3：クライアント送受信生成 | 通常指令の要求作成、経路選択、送信、応答復号、完了条件に応じた戻り値への変換を生成する。ACK照合・期限・取消は共通ランタイムへ集約し、操作ごとの同じ待機処理と対応付けラッパーを削除する。 | 呼出元は生成APIを使い、操作を1個追加するたびにTypeScriptの送信・応答解釈を別途手書きする必要がない。BLEのユーザー操作からの接続開始、世代検査、STOP優先を維持する。 |
| 生成化4：サーバー振分け・応答生成 | 既存の受信窓口から要求を受け、生成した復号と振分けを通して型付きの機能ハンドラーへ渡す。ハンドラーの結果から応答を作る処理も生成し、opcodeやフィールド位置を手で判定する同じ処理を置き換える。 | C++側は機能ハンドラーと通信・キューの共通基盤を実装し、各操作の受信復号・応答パケット作成を重複記述しない。I2C・VMの実行タスク、接続世代・優先STOPの境界を保つ。 |
| 生成化5：既存通信への展開 | センサー通知・機器一覧、コード転送、デバッグ、Python RPCの登録・要求・受付確認、Wi-Fi設定、カメラ取得へ順次展開する。複数操作の転送手順は共通ランタイムの手順として整理し、必要な接続を生成する。 | 固定長指令だけに限定せず、各通信の型・送受信・通知の処理と削除箇所が揃う。Wi-Fiの認証、既存の分割順序・検証後開始、Worker受付とメソッド完了の違いを維持する。JPEGやコード本体は必要なバイト列として扱い、汎用化のための不要な全体コピーや別形式への変換を増やさない。 |
| 生成化6：旧実装の削除と削減確認 | 移行した手書きcodec・操作別ラッパー・重複したID/配置/通信型・未使用の生成関数を削除する。残るコードと維持理由を一覧化し、生成前後の行数と責任分担を比較する。 | 生成とビルドの確認に加え、機能別の手書き通信コードが着手時より減り、同じ通信形式を生成元と手書き実装の両方で管理していない。未移行の通信は個別に列挙し、すべて完了したとは報告しない。 |

移行中の併存は対象を切り替える段階だけに限定する。生成済みコードの外側へ旧処理をそのまま残す恒久的なラッパーや、生成器の中へ操作ごとの手書きコードを文字列で移すだけの方式は採らない。宣言・共通規則から処理を生成し、機能本体の登録は型付きサービスの単位等で行い、現在の操作ごとの対応付けをそのまま別ファイルへ複製しない。

#### 既存ソースの置換候補

以下は削除・縮小する処理の候補であり、ファイル全体を削除する指定ではない。移行時に現在の参照元を再確認し、機能本体・UI・所有管理と通信の重複部分を分ける。

| 対象 | 置換・削除する候補 | 維持する責任 |
|---|---|---|
| [device-connection.ts](../../../diagram/ts/ble-wifi/device-connection.ts) | 操作ごとの送受信対応付け、パケット固有の引数・結果変換、専用窓口への同型の接続。 | 接続UI、通信経路の所有、機器一覧・サーボ状態、プログラム・デバッグの所有と世代検査。 |
| [control-connection.ts](../../../diagram/ts/ble-wifi/control-connection.ts)・[生成codec](../../../diagram/ts/ble-wifi/device-rpc-codec.generated.ts)（旧`rpc-codec.ts`は生成化2で削除） | 手書きのパケット作成・復号と、操作別に重複する送信・応答解釈を生成した型別の読み書きへ置き換える。汎用codecを補助処理として残す場合も生成APIの内部から共用し、呼出元が手で配置表を選んで読み書きする対応付けを残さない。 | 共通の待ち列・ACK照合・PING・期限監視・STOP優先。生成された各操作から同じ基盤を利用する。 |
| [ble-control-transport.ts](../../../diagram/ts/ble-wifi/ble-control-transport.ts)・[robot-wifi.ts](../../../diagram/ts/ble-wifi/robot-wifi.ts) | 操作ごとに手書きした窓口選択や配送分岐、同型の応答読出し。 | BLE／HTTP／WebSocketの入出力、認証、制御権、画像を含む接続資源の寿命。 |
| [bytecode-transfer.ts](../../../diagram/ts/ble-wifi/bytecode-transfer.ts)・[debug-protocol.ts](../../../diagram/ts/ble-wifi/debug-protocol.ts)・[rpc-protocol.ts](../../../diagram/ts/ble-wifi/rpc-protocol.ts) | 転送フレーム・一覧・イベント・結果等の手書きのフィールド配置、同じ通信検査、専用窓口への接続。 | 転送・停止・プログラム世代・実行nonceの状態と、機能固有の検証。共用できる転送手順は共通基盤へまとめる。 |
| ESP32の[uroa_protocol.h](../../../../esp32/lib/protocol/include/uroa_protocol.h)・[uroa_protocol.cpp](../../../../esp32/lib/protocol/src/uroa_protocol.cpp) | 手書きで残る固定長の読出し・書込みと、生成済み定義と重複した型・番号・配置。 | 機器側の意味・状態に依存する処理があれば機能本体へ整理し、単なる旧codecの互換窓口として残さない。 |
| ESP32の[main.cpp](../../../../esp32/app/diagram-control/src/main.cpp)・[control_transport.cpp](../../../../esp32/app/diagram-control/src/control_transport.cpp) | 通信バイト列からの手書きの操作判定・引数取出し・結果パケット作成。 | キュー、STOP、機器操作、周期処理、接続元と世代の検査、VM・センサー・サーボの処理本体。 |
| ESP32の[bytecode_receiver.cpp](../../../../esp32/app/diagram-control/src/bytecode_receiver.cpp)・[bytecode_debugger.cpp](../../../../esp32/app/diagram-control/src/bytecode_debugger.cpp)・[bytecode_rpc.cpp](../../../../esp32/app/diagram-control/src/bytecode_rpc.cpp)、`lib/ble`・`lib/wifi` | それぞれの通信形式の手書き復号・符号化と、生成側と重複する配送分岐。 | バイトコード・PC検証、停止値の作成、Python RPCの登録・要求管理、通信タスク・認証と接続の責任。 |

Pythonソースから抽出する公開オブジェクト・メソッドの登録情報は、引き続き[remote.ts](../../../diagram/ts/python/remote.ts)で生成する。利用者のPythonメソッドを固定の`.proto`へ重複記述せず、Python呼出しを運ぶ共通の通信型・送受信処理を生成対象にする。Futureや配列という新機能の追加は既存の第4〜5段階で行い、今回の生成化に混ぜて実装済みとは扱わない。

#### 削減の判定と確認範囲

行数は、生成コード、`.proto`・生成器、手書きの共通ランタイム、機能別の手書き通信コードを分けて記録する。生成ファイルを含む総行数の減少だけを目標にせず、機能別の手書き通信コードの実際の削除と、通信定義の重複解消を必須とする。生成器や共通基盤の増加量も併記し、手書き全体で増える場合は理由と未削減部分を明示する。着手時の作業ツリーを基準に比較し、他の作業中の変更を削減量へ含めない。

生成対象と削除対象が対応し、`.proto`を修正して再生成すると両側の型・送受信処理・振分けが追従することを完了条件にする。実装時は`.proto`と中心ソースのコメントへ契約を反映し、本書にパケットのバイト配置を重複記述しない。既存の生成・照合コマンドは[生成・検証記録](../../build-and-test.md)を参照する。

検証は、生成物の整合、既存形式との静的な対応、リンク・差分、型、Webと現在の既定環境のESP32ビルドを基本とする。従来の指定に従って自動テスト・模擬テストは作成・実行せず、実通信・実機・性能・バイト列の実行比較は実施の有無を別に記録する。静的な配置確認やビルド成功だけで通信互換・実動作を確認済みとは扱わない。本書の計画追加で生成化の実装・検証が完了したとは報告しない。

#### 生成化1の実施記録（2026-11-28）

状態：着手時ソースの静的な棚卸しを完了。以下の表とJSONは生成化2より前の基準記録であり、生成化2の結果は次の実施記録を参照する。以下は生成化2以降の入力であり、送受信処理の置換・削除を実施した結果ではない。着手時のソースはuroaの`d0822e7`とESP32の`f606501`。uroaでは本計画書だけに既存の作業中の差分があり、ESP32は差分なしだった。既存の計画書の変更を保持して記録を追記した。

測定対象48ファイルの分類・物理行数・非空行数・SHA-256と、置換を検討する82の関数／プロパティ範囲を[rpc-generation-baseline.json](rpc-generation-baseline.json)へ保存した。範囲はTypeScriptの構文木とC++の定義位置から抽出した静的な調査単位で、先行する説明コメントを含めない。関数内には維持する状態管理等も混在するため、範囲の全行が削除できるという見積りではない。

##### 行数の基準値と維持する理由

物理行数は空行・コメントを含めて数え、改行形式による差は付けない。非空行数もコメントを含み、実行コードだけの行数ではない。ファイル単位の値と関数範囲の値を重ねて合計しない。

| 分類（JSONのcategory） | ファイル数 | 物理行数 | 非空行数 | 主な対象と残す理由 |
|---|---:|---:|---:|---|
| 定義（`schema`） | 2 | 490 | 484 | `device.proto`・`options.proto`。生成の正本として維持・拡張する。 |
| 生成器（`generator`） | 1 | 226 | 214 | `generate.mjs`。型・配置表中心の出力を両側の送受信処理へ拡張する。 |
| 生成物（`generated`） | 3 | 1,930 | 1,842 | TypeScriptの生成定義とC++の生成ヘッダー・実装。手で保守する行数と分ける。 |
| 共通手書き（`manual_shared`） | 3 | 323 | 304 | `rpc-client.ts`・`rpc-codec.ts`・`control_session.h`。取消・上限・接続識別等を共通基盤として残す。codecの配置選択は生成APIの内部へ移す。 |
| 通信形式・状態の混在（`manual_protocol_mixed`） | 8 | 2,397 | 2,308 | `control-connection.ts`、Telemetry・転送・デバッグ・RPC、C++の`uroa_protocol`等。フィールド処理を生成化し、ACK・転送状態・機能固有検査を残す。 |
| 通信経路との混在（`manual_transport_mixed`） | 8 | 3,228 | 3,103 | BLE／Wi-FiアダプターとC++のBLE・Wi-Fi・ControlTransport。窓口ごとの分岐は置換候補、認証・通信API・接続寿命は維持する。 |
| 機能・UIとの混在（`manual_feature_mixed`） | 17 | 5,369 | 5,143 | DeviceConnection、センサーブロック、main、Receiver／Debugger／Rpc、カメラ等。引数の読出し・応答作成を置換し、UI・機器・VM・所有管理を維持する。 |
| 周辺の生成元・利用先（`support_only`） | 6 | 4,632 | 4,343 | `block.ts`・`remote.ts`・カメラ取得・Wi-Fi画面・VM。必要な接点だけを変更し、VMやPython解析全体を削減対象にしない。 |

手書き保守対象の基準は`manual_*`の36ファイル・11,317物理行（非空10,858行）。この値には機能・UI・状態管理が含まれ、通信処理だけで11,317行を削除できるという意味ではない。周辺6ファイルはこの小計から除外する。個々のファイルと候補範囲の数値はJSONを参照し、以後の段階では実際に削除した部分と追加した共通処理を分けて比較する。

##### 通信別の定義元・送受信・置換候補

以下の関数名は調査時点のもの。既存のバイト配置・版・制約の本文はリンク先のソースコメントを正本とし、ここには生成元から不足している事項と変更箇所を記録する。

| 通信 | 現行の定義元・生成状態 | ブラウザ側 | ESP32側 | 置換候補と維持する責任 |
|---|---|---|---|---|
| 通常指令・Status（サーボ、STREAM、PING、INFO、VM開始・停止） | `.proto`の`CommandPacket`・`StatusPacket`と既存Protocol。APIと実パケットの対応は手書き。 | [control-connection.ts](../../../diagram/ts/ble-wifi/control-connection.ts)の`send()`／`receive()`、[device-connection.ts](../../../diagram/ts/ble-wifi/device-connection.ts)の`rpc`・`hardwareStatus()`・サーボ操作。 | [main.cpp](../../../../esp32/app/diagram-control/src/main.cpp)の`receive()`→`handle()`／`status()`、[uroa_protocol.cpp](../../../../esp32/lib/protocol/src/uroa_protocol.cpp)の`command()`／`valid()`／`status()`。 | 操作と実パケットの対応、引数の符号・単位変換、復号・応答作成を生成する。ACK待ち・接続世代・有効CH・VMやサーボの処理本体を残す。 |
| DeviceInfo | [device-telemetry.ts](../../../diagram/ts/ble-wifi/device-telemetry.ts)の説明とブロック側の`writeDeviceInfo()`。共通APIの`device.register`は図からの登録操作であり、一覧の通信型そのものではない。 | `DeviceConnection.sendDeviceInfo()`、[servo.ts](../../../diagram/ts/hardware/servo.ts)・[imu.ts](../../../diagram/ts/hardware/imu.ts)・[ultrasonic.ts](../../../diagram/ts/hardware/ultrasonic.ts)・[block.ts](../../../diagram/ts/block.ts)のレコード書込み。 | mainの`receiveDeviceInfo()`／`handleDeviceInfo()`。 | 種別ごとの可変長レコードと一覧の読み書きを生成する。図からの収集順・ブロック参照・全件受理後の置換とSTREAM再要求を維持する。 |
| センサー通知 | `.proto`の`TelemetryHeader`・`ImuRecord`・`DistanceRecord`はあるが、混在通知全体の生成は未接続。 | `parseDeviceTelemetry()`→`DeviceConnection.sampleChanged()`→IMU／距離ブロックの`readStatus()`。 | mainの`publishDeviceTelemetry()`→`Protocol::deviceTelemetry()`→[ControlTransport](../../../../esp32/app/diagram-control/src/control_transport.cpp)の通知配送。 | ヘッダー・レコードの読み書きと種別分岐を生成する。登録順の照合、計測、物理量・ポートへの反映を分けて残す。 |
| プログラムの一括転送とResult | [bytecode-transfer.ts](../../../diagram/ts/ble-wifi/bytecode-transfer.ts)の`uploadBytecode()`が中心契約。`.proto`には上位のUpload要求があるが、転送フレームと最終結果の実形式は未定義。 | `ControlConnection.sendBytecode()`、`uploadBytecode()`、経路別の`openBytecode()`。 | [bytecode_receiver.cpp](../../../../esp32/app/diagram-control/src/bytecode_receiver.cpp)の`enqueue()`／`adopt()`／`publishResult()`とmainの検証後開始。 | フレーム・一括本体ヘッダー・PC列・結果の読み書きを生成する。分割手順・進捗・CRCの共通処理と、バイトコード／PCの意味検証・RAM所有・開始条件を区別して残す。バイトコード命令形式自体の生成し直しは対象外。 |
| デバッグの一覧設定・継続／ステップ・ACK | [debug-protocol.ts](../../../diagram/ts/ble-wifi/debug-protocol.ts)の`PythonDebugTransport`。 | `sendPcList()`／`request()`／`execute()`。 | [bytecode_debugger.cpp](../../../../esp32/app/diagram-control/src/bytecode_debugger.cpp)の`handle()`／`reply()`。 | 操作ごとの引数と結果の読み書きを生成する。PC検証、停止ID・所有コードの照合、ステップ実行を機能側に残す。 |
| デバッグEvent | 同ファイルの`parseEvent()`。共通APIの`debug.state`は復号後の通知であり、実Eventの定義ではない。 | `parseEvent()`と状態監視、DeviceConnectionのデバッグ購読。 | `BytecodeDebugger::publishState()`、BLEのEvent Read／NotifyとWi-FiのEvent読出し。 | 状態によって異なるEventの解釈と書込みを生成する。実行状態・進捗の取得と公開タイミングは機能側に残す。 |
| Snapshot・選択チャンク | 同ファイルの`decodeSnapshot()`とVMの直列化処理。`.proto`の`Snapshot`は既存ホスト型の参照だけ。 | `PythonDebugTransport.download()`／`decodeSnapshot()`。 | Debuggerの選択処理に加え、[bytecode_vm.cpp](../../../../esp32/app/diagram-control/src/bytecode_vm.cpp)の`snapshotValue()`／`BytecodeVM::copyDebugSnapshot()`が生成元。 | Snapshotのヘッダー・値スロット・文字列・選択データの読み書きを生成する。Paused中の値取得・文字列の列挙・VM／GC参照の寿命は残す。VM内部のアドレスや本体参照の直接転送へ変えない。 |
| Python RPCの公開定義登録 | [rpc-protocol.ts](../../../diagram/ts/ble-wifi/rpc-protocol.ts)の登録形式と、[remote.ts](../../../diagram/ts/python/remote.ts)の公開定義生成。 | `encodeRpcConfiguration()`／`RpcTransport.configure()`、[remote-session.ts](../../../diagram/ts/python/remote-session.ts)からの登録。 | [bytecode_rpc.cpp](../../../../esp32/app/diagram-control/src/bytecode_rpc.cpp)の`configure()`／`handle()`／`result()`。 | 登録表・転送フレーム・Resultの読み書きを生成する。Pythonからの公開署名抽出、API指紋の照合、動的nativeへの結合は維持する。 |
| Python RPCの要求・Worker受付確認 | 同ファイルのEvent／ACK。`.proto`の`RemoteRequest`は既存型への参照であり、Eventの実形式を表さない。 | `RpcTransport.read()`／`acknowledge()`、`RemoteBleSession.deliver()`→Worker受付。 | `BytecodeRpc::invoke()`→要求キュー、`publish()`／`handle()`／`result()`。 | 要求・受付確認の符号化・復号・配送を生成する。要求キュー・nonce・要求IDとWorker寿命は残す。メソッドの戻り値やFuture配送は、まだ追加しない。 |
| BLE経由のWi-Fi設定・検索・設定結果 | [robot-wifi.ts](../../../diagram/ts/ble-wifi/robot-wifi.ts)の`BLEWifiSetup`とESP32の設定処理。`.proto`のEndpoint等はホスト型の参照。 | `request()`／`info()`／`scan()`／`configure()`、Wi-Fi画面からの共通API呼出し。 | [uroa_ble.cpp](../../../../esp32/lib/ble/src/uroa_ble.cpp)の`Configuration::onWrite()`／`onRead()`→[uroa_wifi.cpp](../../../../esp32/lib/wifi/src/uroa_wifi.cpp)の`configure()`。 | 分割設定フレームとJSONの要求・結果型、操作名の対応を生成する。ペアリング認証・資格情報の寿命・Wi-Fiタスク・NVS操作を残す。 |
| Wi-Fi認証・制御権・HTTP／WebSocketの外側の形式 | `RobotWifi`と`WifiNetwork`。既存バイト列の16進表現・署名付き要求／応答等の扱いは手書き。 | `json()`／`connectSocket()`／`writeControl()`／`receive()`／`poll()`／`readControlValue()`。 | `claimReply()`／`dispatchControl()`／`controlHTTP()`／`controlValueHTTP()`／`eventsHTTP()`／`socketEvent()`。 | JSONの型・窓口・応答種別とその対応付けを生成する。HMAC、counter、認証済み接続の照合、CORS、制御権の取得・解除は共通経路側に残す。署名対象の表現を生成時に勝手に変えない。 |
| JPEG取得 | `RobotWifi.image()`とカメラ用HTTP。`.proto`の`Image`はBlobへの参照。 | `camera.capture`→`image()`→[camera-feed.ts](../../../diagram/ts/camera/camera-feed.ts)の共有取得。 | `WifiNetwork::imageHTTP()`→[network.cpp](../../../../esp32/app/diagram-control/src/network.cpp)の接続→[camera.cpp](../../../../esp32/app/diagram-control/src/camera.cpp)の`cameraServe()`。 | 取得メソッド・窓口・応答の型の接続を生成する。JPEG本体は既存の生データを維持し、認証、画像フレームの取得・返却とBlobの共有寿命を残す。 |

`connection.connect`／`disconnect`、Wi-Fi画面の開閉、ローカル状態購読・センサーブロックの保持は、機器へ同名RPCを送る操作ではない。`.proto`のローカル操作として扱い、ESP32側の要求振分けや通信パケットを不要に生成しない。ブラウザWorker内のABI、Pythonの解析・VM命令形式、外部AIサービスとの通信、UARTログは本生成化の通信置換対象から除外する。

##### 生成に不足している定義と必要な共通処理

| 不足・注意点 | 次の段階で揃える内容 | 現行の正本・維持する処理 |
|---|---|---|
| APIと既存形式への対応 | メソッドと既存opcode／定数・既定値・引数字段・単位／符号変換、送信方向、UUID／HTTP窓口・結果窓口の対応。APIの要求型をそのまま実パケットと見なさない。 | DeviceConnectionの操作対応、ControlConnection、BLE／Wi-Fiの窓口処理。新たな共通ヘッダーを既存パケットへ追加しない。 |
| 固定長codecの生成範囲 | 版・予約値・種別・結果コード等の通信上の規則と必要な方向を明示し、両側の必要な読出し／書込みを生成する。 | 現状は5種類の配置とC++の5書込み関数まで。対象プロジェクトではStatusとTelemetryヘッダーだけがC++の生成関数へ接続され、Command・IMU・距離の生成書込みは未接続。C++の復号は未生成。TypeScriptは手書きの汎用codecを利用。 |
| 可変長・状態依存の形式 | DeviceInfoの種別別レコード、Telemetryの混在列、Debug Eventの状態別内容、Snapshotの値・文字列等を具体的な通信型として表す。 | 登録順の照合、Pausedの値取得、機器・VM状態や所有権の検査を単なるフィールド検査へ押し込まない。 |
| 分割転送と確認の境界 | 転送フレーム・最終結果・選択チャンク・受付確認の型と、共通の転送手順へ接続するための情報。 | 分割送信、CRC、受信位置、期限、取消、ACK待ち、再構築の共通基盤。コード検証・検証後開始と、Worker受付／メソッド完了の区別は機能側に残す。 |
| `.proto`のホスト型参照 | 14個の`host_type`付きmessageを、ローカル所有参照と実通信のデータ型に分類する。Snapshot・RPC登録／Event・Endpoint・Wi-Fi応答・画像等の実形式を名前だけで省略しない。 | 構造体やBlob、ブロック、Receiptの同一性を保ち、VM内部の借用ポインターを自動的に直列化しない。 |
| 識別子・結果の名前空間 | 共通APIのサービス／メソッド番号・ローカルIDと、既存sequence・転送ID・stopId・実行nonce・Pythonの動的IDの対応箇所。機器側の結果番号と共通エラーの対応。 | 共通APIの32操作／購読は既存パケットの32種類の要求という意味ではない。要求と応答の照合は既存の識別子を使う。 |
| 認証・外側の表現 | Wi-Fi設定のJSONと、認証付きHTTP／WebSocketの型・窓口・署名に使う表現。JPEGは生データとして扱う接続情報。 | HMACとペアリング、CORS、NVS、制御権、接続・認証世代、秘密情報の保存制約は共通処理として維持する。 |
| 優先STOP・実行タスク・期限 | 生成した受信入口も、認証・接続世代の検査とキューへのコピー、優先STOP、loop()での機器・VM処理を通す。通常の形式検査と優先STOPの受理条件の違いを保持する。 | 型付きハンドラーを通信コールバックから直接実行しない。1通信操作・最終確認・転送無進捗・ペアリング待ち等の期限は別の責任であり、単一の`io_timeout_ms`で一律に置換しない。 |

加えて、`uroa_protocol.h`のVM_START説明にある「COMMITだけでは開始しない」は、一括転送の検証後開始フラグを含む現在の経路との適用範囲を明確にする必要がある。開始の中心契約は`bytecode-transfer.ts`とmainの一括転送処理を照合し、該当機能を移行する段階でコメントを揃える。生成化1ではコメントを含めソースを修正していない。

必要な共通ランタイムは、経路と接続世代の照合、有限長の送信待ち列とSTOP優先、既存識別子によるACK／Read結果待ち、期限・取消、購読の寿命、分割・再構築とCRCの処理である。機器操作・VM・Pythonの公開定義・値の所有処理はこれと分け、生成器へ機能ごとの実装文字列を移す方式を避ける。

##### 生成化2へ渡す最初の対象と確認範囲

最初の対象は、ブラウザのCommand符号化・Status復号と、ESP32のCommand復号・Status符号化。既存の配置と通常の形式検査に必要な定義を補い、生成したcodecへ実際の呼出しを接続して、対応する手書き処理を削除する。サーバー全体の操作振分けや機能本体の変更は生成化4で扱い、型付きcodecの導入と混同しない。型・配置表の追加だけ、または未使用の書込み関数追加だけでは生成化2を完了としない。

生成化1では、両リポジトリーのソースと現行定義の読取り、行数・ハッシュ・候補範囲の記録、文書とJSONの整合・リンク・差分確認を行った。ソース・`.proto`・生成物・ファームウェアは変更せず、生成器による再生成、ビルド、自動／模擬テスト、ブラウザ・BLE／Wi-Fi・実機確認は行っていない。上記は現在のソースからの静的な対応付けであり、通信互換や動作の再検証結果ではない。

#### 生成化2の実施記録（2026-11-28）

生成化2完了時点の記録：Command／Statusのcodec生成・呼出し置換と両側ビルドを完了。当時は生成化3〜6とPython RPCの第4段階以降が未着手。仕様の正本は[device.proto](../../../diagram/rpc/device.proto)と[Protocol](../../../../esp32/lib/protocol/include/uroa_protocol.h)等のソースコメントを参照する。

[生成器](../../../diagram/rpc/generate.mjs)に方向指定と通常形式の検査条件を追加し、ブラウザのCommand符号化・Status復号、ESP32のCommand復号・形式検査と既存のStatus符号化へ接続した。Statusは復号した値を機器接続へ渡し、生バイトの二重読出しを削除した。旧手書きの汎用codecを削除し、未使用だったC++のCommand・IMU・距離の符号化関数も生成対象から除いた。Telemetryヘッダーの既存の生成符号化は維持する。

TSの型・メタデータとcodecは別の生成ファイルにし、共通エラー処理との循環依存を避けた。機器の範囲・単位変換、ACK・世代・待ち列、優先STOPとloop()での機器／VM処理は既存の責任として維持した。操作別の要求組立て・送信手順とサーバー全体の振分けは、生成化3・4で扱う。

生成化1の分類・物理行数の数え方で比較した。基準JSONは着手時のまま保存し、削除済みファイルを除き、新しい生成codecを生成物へ加えた。

| 分類 | 生成化1の基準 | 生成化2の結果 | 差分 |
|---|---|---|---|
| 手書き保守対象（`manual_*`） | 36ファイル・11,317行 | 35ファイル・11,237行 | −80行（非空行は10,858→10,781） |
| 定義（`schema`） | 2ファイル・490行 | 2ファイル・505行 | ＋15行 |
| 生成器（`generator`） | 1ファイル・226行 | 1ファイル・351行 | ＋125行 |
| 生成物（`generated`） | 3ファイル・1,930行 | 4ファイル・2,080行 | ＋150行 |

手書きの値には維持するUI・機能本体・共通ランタイムを含む。今回の−80行はコメント・空行を含む差分であり、80行すべてが通信の実行文という意味ではない。定義・生成器・生成物を含む総行数は増えたが、Command／Statusのフィールド読み書き・通常形式検査を手書きで重複保守する箇所を置き換えた。

5種類の既存配置について長さ・位置・整数幅・符号の静的な一致を確認した。生成物の両リポジトリー照合、Webの`npm.cmd run verify`とESP32の現在のdefault_envsビルドを実施した。実行結果とコマンドは[Webの検証記録](../../build-and-test.md)・[ESP32の検証記録](../../../../esp32/docs/build-and-test.md)へ記載する。従来の指定に従いテストを作成・実行しておらず、codecの実行比較、ブラウザ・BLE／Wi-Fi・実機確認とUploadは未実施。

#### 生成化3の実施記録（2026-11-28）

生成化3完了時点の記録：通常指令のクライアント生成・置換と両側ビルドを完了。当時は生成化4〜6とPython RPCの第4段階以降が未着手。契約の正本は[device.proto](../../../diagram/rpc/device.proto)と[共通通信層](../../../diagram/ts/ble-wifi/control-connection.ts)等のソースコメントを参照する。

[生成器](../../../diagram/rpc/generate.mjs)が宣言的なCommand対応から[通常指令のクライアント](../../../diagram/ts/ble-wifi/device-control.generated.ts)を生成する。公開9操作（deviceのINFO／PING、サーボ5操作、programの開始／停止）と内部STREAMを接続した。既存の公開32操作／購読は維持し、内部操作1個を別scopeへ加えた。追加した内部RPC番号を通信パケットへ送る変更ではない。

要求作成、分岐・倍率・符号変換・既定値、優先度・期限とStatus結果への対応を生成元へ移した。手書きの操作別送信関数とそのRPCラッパー、opcodeの診断表・結果メッセージ表を削除した。接続直後のINFO、内部PING、共有STREAMも生成した入口を使い、旧sendControl／send経路は残していない。機能状態はServo／Program単位の型付きフックで扱い、サーボの有効状態・操作世代、所有Receipt・転送準備、停止時の失効と失敗処理を残した。

共通exchangeは現BLE／Wi-Fi経路・接続世代・有限待ち列・sequence照合と期限を所有し、生成した結果処理を呼ぶ。ACKエラーは未完了のWriteを待たず拒否し、書込みと成功ACKの完了後に取消・世代を照合してから機能の確定フックを呼ぶ。取消の境界を共通化したが、開始済みのネイティブWriteや機器処理は中断せず、ACK待ちは応答または期限まで待つ。新しいキュー・自動再送・再接続時の再実行は追加していない。

生成化1と同じファイル分類・物理行数で比較した。基準JSONは保存時のまま維持し、新しい生成ファイルを生成物へ加えている。

| 分類 | 生成化2の結果 | 生成化3の結果 | 今回の差分 |
|---|---|---|---|
| 手書き保守対象（`manual_*`） | 35ファイル・11,237行 | 35ファイル・11,187行 | −50行（非空10,781→10,737） |
| 定義（`schema`） | 2ファイル・505行 | 2ファイル・577行 | ＋72行 |
| 生成器（`generator`） | 1ファイル・351行 | 1ファイル・515行 | ＋164行 |
| 生成物（`generated`） | 4ファイル・2,080行 | 5ファイル・2,409行 | ＋329行 |

手書きは生成化1の基準から累計130行減少した。コメント・空行や維持するUI／機能本体も含む集計であり、通信の実行文だけの削減数ではない。定義・生成器・生成物を含む総行数は増えている。新しい通常指令のwire対応とStatus結果の処理は生成元から生成でき、操作ごとの送信コードをTypeScriptへ別途書く構成を除いた。

両リポジトリーの生成物照合、既存5配置の長さ・位置・整数幅・符号の静的照合、Webの型・公開ビルド・成果物確認とESP32の現在のdefault_envsビルドに成功した。C++の振分け・機能本体は変更せず、番号・指紋等の生成物を更新した。実行コマンドと結果は[Webの検証記録](../../build-and-test.md)・[ESP32の検証記録](../../../../esp32/docs/build-and-test.md)を参照する。テストの作成・実行、ブラウザ・BLE／Wi-Fi・Upload・実機確認は行っていない。

#### 生成化4の実施記録（2026-11-28）

状態：通常指令サーバーの受理・型付き振分け・応答生成を既存の受信経路へ接続し、両側ビルドを完了。生成化5・6とPython RPCの第4段階以降は未着手。仕様の正本は[device.proto](../../../diagram/rpc/device.proto)、[main.cpp](../../../../esp32/app/diagram-control/src/main.cpp)、[呼出しコンテキスト](../../../../esp32/app/diagram-control/include/control_session.h)等のソースコメントを参照する。

既存11 opcodeのサーバー対応を生成元へ揃え、[control_rpc.generated.h](../../../../esp32/app/diagram-control/include/control_rpc.generated.h)・[control_rpc.generated.cpp](../../../../esp32/app/diagram-control/src/control_rpc.generated.cpp)を追加した。クライアントの既定値と受信の受理条件を分け、受理検査・単位／符号変換・機能ハンドラーの選択・応答CH・I/O自発通知とStatusの作成を生成する。通常形式が有効な指令でheartbeatを更新する時点も、細部検査より前に保った。

main.cppの手書きopcode分岐と操作ごとのStatus作成を削除し、Servo／Program／Controlの型付き機能サービスと共有の状態取得・配送窓口を登録した。機器・VM・STREAMの処理本体、ドライバー結果の対応、制御権・停止優先の確認は機能側へ残した。サービス表は必須の関数参照で未登録をコンパイル時に拒否し、静的に保持する。動的確保・新しいキューを追加していない。受信コールバックは復号・コピーまでとし、機器処理はloop()だけで呼ぶ。優先STOPの受理条件・キュー破棄・VM停止順と接続世代の照合は既存経路を維持する。

通常応答・自発通知・優先STOPのStatusを共通の生成処理へ通した。Protocolの既存status()も生成した値組立てへ委譲し、結果番号と速度フラグの手書き定義値を生成定義への参照へ変えた。生成化1で記録したVM_START説明と開始フラグ付きCOMMITのコメントの適用範囲も揃えた。転送や開始処理の動作変更は行っていない。

生成化1と同じ分類・物理行数で比較し、新しいサーバー2ファイルを生成物へ加えた。基準JSONは変更していない。

| 分類 | 生成化3の結果 | 生成化4の結果 | 今回の差分 |
|---|---|---|---|
| 手書き保守対象（`manual_*`） | 35ファイル・11,187行 | 35ファイル・11,255行 | ＋68行（非空10,737→10,788） |
| 定義（`schema`） | 2ファイル・577行 | 2ファイル・642行 | ＋65行 |
| 生成器（`generator`） | 1ファイル・515行 | 1ファイル・676行 | ＋161行 |
| 生成物（`generated`） | 5ファイル・2,409行 | 7ファイル・2,828行 | ＋419行 |

今回は型付きの機能本体・共有状態取得・コンテキストの分離と、その説明コメントにより手書きの物理行数が増えた。opcodeごとの受理・フィールド変換・応答作成は生成側へ置換した。手書きの集計は生成化1から累計62行減だが、UI・機能本体・コメントを含むため通信の実行文だけの削減数ではない。全体の削減確認は生成化6で扱う。

生成物7ファイルの照合、既存5配置の長さ・位置・整数幅・符号の静的照合、Webの型・公開ビルド・成果物確認、ESP32の現在のdefault_envsビルドに成功した。受理条件と応答CH、優先STOP、VM開始・停止の確認順、StatusとI/O自発通知の順序を旧ソースと静的に照合した。コマンドと結果は[Webの検証記録](../../build-and-test.md)・[ESP32の検証記録](../../../../esp32/docs/build-and-test.md)を参照する。テストの作成・実行、ブラウザ・BLE／Wi-Fi・Upload・実機確認は行っていない。

#### 生成化5の実施記録（2026-11-28）

状態：既存通信への生成処理の接続と、生成物照合・ブラウザVM再ビルド・両側ビルドを完了。生成化6とPython RPCの第4段階以降は未着手。通信形式の正本は[device.proto](../../../diagram/rpc/device.proto)・[wire.proto](../../../diagram/rpc/wire.proto)・[transport.proto](../../../diagram/rpc/transport.proto)と各所有者のソースコメントを参照する。

| 対象 | 生成処理へ置換した部分 | 残す機能・所有者 |
|---|---|---|
| DeviceInfo・Telemetry | 機器タグ・サーボ登録の書込み／読出し、混在通知のヘッダー・各値・長さ・制約と全件検証。 | 機器登録の確定、測定、物理単位変換、登録順とポートへの反映。 |
| コード転送 | フレーム・Bundleヘッダー・PC値・Resultの両側codec。 | 命令／PC検証、CRC、連番・位置と確定後開始。コード本体は既存のバイト列を使う。 |
| デバッグ | Control・Result・Event、Snapshotヘッダー・値・文字列ヘッダーのcodec。 | 停止ID・所有コードと状態の検証、GC参照の解釈・文字列列挙、ステップ実行。 |
| Python RPC | 登録表・フレーム・Result・Eventと整数引数のcodec。 | 動的署名・指紋、要求キュー・nonce・接続世代、Worker受付後のACK。メソッド完了やFuture更新は追加していない。 |
| BLE Wi-Fi設定・HTTP／WS | 設定フレーム、JSONフィールドの読出し・構築、経路・サイズ・振分け・Read値の選択・HTTP登録、Wi-FiのBytecode／Debug窓口。 | 資格情報の検査・消去、NVS、HMACと認証・制御権・接続世代・通信タスク。 |
| カメラ | パス・MIME・取得上限、HTTP経路登録の定義。 | 撮影・HTTP取得・取消・Blobの所有。JPEGを生バイトで扱う。 |

[wire-generator.mjs](../../../diagram/rpc/wire-generator.mjs)・[records-generator.mjs](../../../diagram/rpc/records-generator.mjs)・[json-generator.mjs](../../../diagram/rpc/json-generator.mjs)を追加し、TSのwire／JSONとC++のwire／JSONを既存の生成コマンドへ統合した。通常指令を含む生成物は13ファイル。手書きのフィールド別バイト処理、機器別の長さ判定と通知組立て、HTTP経路一覧・振分け・転送窓口の重複を置き換えた。BLEの初期応答とMTU通知、GATT UUIDも生成定義へ接続した。

[wire-transfer.ts](../../../diagram/ts/ble-wifi/wire-transfer.ts)で、コード・PC一覧・RPC設定・BLE Wi-Fi設定の順次分割を共有した。生成した固定領域codecへ可変長本体の借用ビューを渡し、送信用の最終フレームで結合する。可変長全体の所有・CRC・最終ACK・状態遷移は各転送処理へ残し、Snapshotやコード本体を別形式へ変換していない。共通VMが同じSnapshot codecを使うため、ブラウザ用ビルドにも生成C++を加えた。

生成化1の基準JSONは変更せず、同じファイル分類に新規ファイルを加えて集計した。物理行数はコメント・空行を含み、機能本体・UIも含むため通信の実行文だけの削減数ではない。

| 分類 | 生成化4 | 生成化5 | 今回の差分 |
|---|---|---|---|
| 手書き保守対象（manual_*） | 35ファイル・11,255行（非空10,788） | 36ファイル・11,090行（非空10,626） | −165行（非空−162） |
| 定義（schema） | 2ファイル・642行 | 4ファイル・1,210行（非空1,145） | ＋568行 |
| 生成器（generator） | 1ファイル・676行 | 4ファイル・1,018行（非空996） | ＋342行 |
| 生成物（generated） | 7ファイル・2,828行 | 13ファイル・11,550行（非空11,109） | ＋8,722行 |

手書き保守対象は生成化1の11,317行から累計227行減少した。新しい共有分割処理をmanual_sharedへ加えた。今回の内訳はmanual_shared=275行、manual_protocol_mixed=2,293行、manual_transport_mixed=3,180行、manual_feature_mixed=5,342行。基準のsupport_only 6ファイル・4,624行は小計から除外し、基準外のbrowser/build.pyの変更と文書もこの比較へ含めない。新しい固定領域codecは読み書きを広く生成しているため生成物と総行数は増加した。不要な生成方向・残る配置定数や旧ヘルパーの整理と最終削減確認は生成化6で行う。

生成物13ファイルの照合、既存5配置の長さ・位置・整数幅・符号の静的一致、Emscripten 4.0.23によるブラウザVM再ビルド、Webの型・公開ビルド・成果物確認、ESP32の現在のdefault_envsだけのビルドが成功した。既存の認証・署名対象・HTTPとWSのcounter型、分割順序・CRC・検証後開始・Worker受付ACK・JPEGの生配送をソース差分で確認した。コマンド・結果は[Webの記録](../../build-and-test.md)・[ESP32の記録](../../../../esp32/docs/build-and-test.md)を参照する。テストの作成・実行、ブラウザ操作、実BLE／Wi-Fi・JPEG・Upload・実機確認は行っていない。

## 4. 段階別計画

段階は順番に進める。途中の機能は対応範囲を明示し、未対応の型・呼出しを送信前または開始前に拒否する。各段階で、実装・ソースコメント・対象ビルドの整合を確認する。実行確認の項目はビルド完了条件と分けて記録する。

### 第0段階：実装境界と公開方法の決定

目的：後続段階で解釈が分かれる事項を確定し、必要な変更を限定する。

状態：2026-11-27、ユーザーが推奨案の採用と次段階への着手を承認したため完了。採用した方針は以下。未実装の実行・通信に関する選択は、対応段階でソースコメントと実装へ反映する。

- 2ソースと解析状態を独立させ、ブラウザの公開署名だけをESP32の外部API定義として使う。構文解析器・意味解析器の実装は共用する。
- 当初はブラウザ用・ESP32用のPythonBlock各1個を1組とし、ESP32側のStartから一組の準備・開始を管理する。ブラウザの準備完了後にESP32を開始する。2ソースUIと所有者の接続は第3段階で行う。
- モジュール直下で静的に生成したRemoteインスタンスを変数名で公開し、ESP32は`from remote import browser`で参照する。公開はメソッドだけとし、両VMの大域値・属性・機器ハンドルを暗黙に共有しない。
- 通常defはNoneを返す通知、async defはスカラーまたはNoneのFutureを返す呼出しとする。公開引数・戻り値には型注釈を必須とし、内部のawait・一般的なコルーチンは導入しない。
- Futureは読取専用のdone・error・valueを持つ。doneは成功・失敗を含む完了判定、errorは0が成功の整数コード、valueは正常完了後だけ参照可能とし、繰返し読取りを許す。第1段階は型・配置だけで、状態更新とvalueの実行時検査は第4段階で行う。
- ブラウザ側の要求は受信順に1件ずつ実行する。初期化終了後も受付を維持する。ESP32の通常終了では受付済み要求を即時破棄せず、Stop・切断では未完了要求を失敗とする。ブラウザVMの実行エラーでは受付を停止し、残るFutureも失敗とする。
- 公開する型はint・float・str・Noneとfloat32／uint8の数値配列に限定する。第1段階はスカラー、配列の注釈・rankと配送は第5段階で具体化する。
- 版・指紋・世代・要求IDを区別し、旧要求の失効と重複実行の防止を行う。キュー・サイズ・期限には上限を設ける。パケット配置・上限の具体値は各実装段階でソースへ記述する。

完了条件を満たした範囲：採用方針と実装順序の決定。RPCの実行・通信・状態管理が実装済みという意味ではない。

### 第1段階：Remote構文・独立した型解析・生成

目的：2ソースを独立して解析・生成し、RPCの公開定義で対応付ける。

主な作業：

- `syntax.ts`・`parser.ts`へRemoteの継承指定とasyncメソッドを追加し、`toString()`・編集表示・診断位置を対応させる。一般的な継承やspawn／awaitは追加しない。
- `semantic.ts`と必要な補助処理へRemote署名・代理型・Future型を追加する。メソッド本体の戻り値型`T`と、ESP32の呼出し式の`Future[T]`を区別する。利用者へジェネリック型注釈を必須にしない。
- 各ソースに個別の構文木・解析結果を作り、名前解決と型照合を独立して行う。共通の実装へ実行先を渡し、ブラウザ側ではESP32機器APIを、ESP32側ではブラウザ専用APIを拒否する。
- ブラウザ側の解析から公開Remoteオブジェクトと署名を抽出する。ESP32側では生成した公開定義を外部APIとして読み、代理オブジェクトの参照と呼出しを解決する。登録情報に構文木やメソッド本体を含めない。
- `bytecode.ts`は各ソースの解析結果からそれぞれの生成物・デバッグ情報を作る。RPC登録情報の指紋で両成果物の対応を確認する。未接続の機能を通常Startで誤実行しないよう、実行入口で未対応を明示する。
- 変更する命令・型表・関数表・ABIと、受信検証・PC走査・デバッガーへの影響を洗い出し、必要な更新を同じ段階へ含める。

完了条件：2ソースの解析状態が独立し、Remote本体がESP32で実行されず、ESP32専用APIがブラウザへ紛れ込まない生成・診断経路が揃う。ブラウザの公開定義変更によるESP32側の型不一致と、古い登録情報の利用を検出する経路がある。署名・登録情報・生成コードの対応を静的に確認できる。通信とRemote実行はまだ未接続と明記する。

実施内容：`Remote`・`async def`の構文木と再文字列化、実行先別のAPI解決、スカラーの公開署名抽出、ESP32側の代理・読取専用Future型、公開定義と両コードの指紋、個別のPC情報を接続した。入口・対応範囲・生成物の扱いは[remote.ts](../../../diagram/ts/python/remote.ts)、生成の拒否境界は[bytecode.ts](../../../diagram/ts/python/bytecode.ts)を参照する。

既存のCALL_NATIVEとrecord型表を使うため、この段階では命令形式・機器API生成物・ESP32ソースを変更しない。専用APIで作る成果物は`executable: false`で、通常のStart・転送用生成入口はRPC解析結果を拒否する。RPC用のAPI指紋も既存ファームウェアの登録表と異なる。

検証：`npm.cmd run build:all`と`npm.cmd run verify`が成功し、型・公開ビルド・配布資産を静的に確認した。既存のgame import混在2件とBinaryenのNode分岐外部化の警告は継続。テスト・構文再生成の実行確認・RPCサンプルの解析／生成の実行試験・ブラウザ・通信・実機確認は行っていない。ESP32ソース・配布用VM資産は変更せず、ファームウェアビルド・Uploadも未実施。第2〜7段階は未接続。

### 第2段階：ブラウザVMのRPC受付とメソッド実行入口

状態：実装・ビルド完了。ブラウザ上の動作確認は未実施。

目的：ブラウザ側にRemoteオブジェクトを保持し、登録済みメソッドを要求単位で実行できるようにする。

主な作業：

- `browser/host.cpp`と共通VMへ、登録済みメソッドの引数設定、実行開始、tick、RET時の結果取得を接続する入口を追加する。HALTを通常実行の終端とRPC受付の終了に一律に使わない。
- Remote実体・メンバーをGCの根として保持し、要求ごとの引数・一時値・結果の解放を分ける。VM内部のアドレスをWorkerメッセージへ公開しない。
- `browser-vm-worker.ts`・`browser-abi.ts`へ準備完了、要求受付、実行完了、失敗、停止のメッセージを追加する。
- `browser-runtime.ts`の実行終了によるWorker破棄を見直し、Remote公開中は受付を維持する。通常のブラウザ単独実行は従来の終了動作を維持する。
- 1件ずつ実行する有限長キューと、実行中のtick間でイベントループへ戻る処理を用意する。同期CALL_KERNEL中は停止・通信処理もその復帰を待つ境界を維持する。

完了条件：ブラウザ側の準備・受付・終了が別の状態として表現され、登録外メソッド・不正引数を拒否できる実装が揃う。メソッド終了後も次の要求を受け付ける構造となる。ブラウザ上の実行確認は別途記録する。

実施内容：共通VMへブラウザ専用の外部呼出し・RETでの停止・結果取得・要求間GCを追加した。Remoteは大域変数を根として保持し、ホストは本体のポインターを保持しない。[browser-runtime.ts](../../../diagram/ts/python/browser-runtime.ts)の`BrowserRemoteRuntime`と[Worker](../../../diagram/ts/python/browser-vm-worker.ts)へ準備・受付・結果・失敗・停止を接続した。スカラーの範囲・上限・メッセージは[browser-abi.ts](../../../diagram/ts/python/browser-abi.ts)、C接続は[browser/host.cpp](../../../../esp32/app/diagram-control/browser/host.cpp)の仕様コメントを参照する。

専用Runtimeは第1段階の生成物からブラウザ側だけを起動する。通常のブラウザ単独実行は従来どおり終了時に破棄する。ESP32配送・Future更新・2ソースUIは第3段階以降で、同期C計算中の停止はその復帰後に処理する。

検証：Emscripten 4.0.23でVMのJS／Wasmと`assets.json`を再生成した。Webの`npm.cmd run verify`と、現在の`default_envs`（`supermini_esp32s3`）だけのPlatformIOビルドが成功。テスト・ブラウザの受付／連続呼出し／状態保持／GC／Stopの実行試験、BLE／Wi-Fi通信、Upload、実機確認は行っていない。詳細は[Web側の記録](../../build-and-test.md)と[ESP32側の記録](../../../../esp32/docs/build-and-test.md)を参照する。

### 第3段階：BLEで戻り値なしのRPCを通す

状態：実装・ビルド完了。ビルド・静的確認の結果は下記記録を参照する。ブラウザ・BLE実配送・実機確認は未実施。

目的：ESP32 → ブラウザの最小の呼出し経路を完成させる。対象は整数引数と`def ... -> None`。

主な作業：

- RPC専用の双方向配送窓口をBLEと共通通信層へ接続する。既存のセンサー通知・Status・デバッグACKへ混在させない。
- ESP32は送信データを所有するキューへ登録後、Noneを返して次へ進む。送信失敗・キュー満杯・未準備を黙って破棄しない。
- BLEの通知は要求の読出し契機として利用する場合も、未処理要求を上書きしない保持・取得・受付確認を用意する。通知受信やWrite完了とメソッド完了を区別する。
- `python-block.ts`と実行の所有者へ、ブラウザソースの解析・RPC登録情報生成、ESP32ソースの解析、ブラウザ準備・Remote登録、ESP32開始を順に行う経路を接続する。途中の失敗では開始済み資源を後片付けする。
- 通信コールバックではデータをコピーして引き渡し、ESP32のVM操作は`loop()`に集約する。切断・Stop・旧世代要求の失効はこの段階から扱う。

完了条件：通知呼出しがブラウザの完了を待たない経路、ブラウザ側のprint等による受信表示、送信エラーの通知が接続される。通常のESP32単独実行を維持する。BLE実配送・実機VMの確認はビルドと分ける。

実施内容：[rpc-protocol.ts](../../../diagram/ts/ble-wifi/rpc-protocol.ts)に中心契約を置き、専用BLE窓口・公開定義の登録・ESP32の整数要求キュー・Worker受付後の確認を接続した。ESP32はキューへコピーしてNoneを返し、ブラウザの終了は待たない。満杯・未準備・配送期限・メソッド失敗を黙って破棄せず、VMエラーまたはブラウザの表示と一組の停止へ伝える。

[PythonBlock](../../../diagram/ts/python/python-block.ts)は両ソースを個別に診断し、ESP32側のStartからブラウザ準備、公開定義の登録、ESP32コードとPC一覧の一括送信・開始を行う。[remote-session.ts](../../../diagram/ts/python/remote-session.ts)がブラウザVMを所有し、ESP32の通常終了後も通知を配送する。Stop・切断・開始失敗では両側を片付け、ESP32の停止指令は同期C計算の復帰を待たずに送る。ブラウザWorkerの解放はCの復帰後となる。

現在の操作例（実行未確認）：

1. 図にPythonBlockを2個置き、一方の実行先をブラウザ、もう一方をESP32にする。他のPythonBlockは置かない。
2. Openからブラウザ側へ[rpc-notify-browser.py](../../../public/diagram/python/rpc-notify-browser.py)、ESP32側へ[rpc-notify-esp32.py](../../../public/diagram/python/rpc-notify-esp32.py)を読み込む。一覧は既存のViteによる自動列挙を使う。
3. 対応ファームウェアのESP32へBLE接続し、ESP32側のCheck、Startを手動で操作する。ブラウザ側の出力欄へ受信値を表示する実装となっている。
4. 終了時はどちらかのStopで一組を停止する。実行中の接続・要求・Workerは保存せず、再読込や再接続で自動再開しない。

検証記録：[Web側](../../build-and-test.md)と[ESP32側](../../../../esp32/docs/build-and-test.md)を参照する。第4段階のFuture更新へは進めない。Plotly.js・Three.js連携はRPC完了後とする。

### 第4段階：Futureによるスカラー結果の取得

目的：`result = browser.calc(value)`でESP32を止めず、完了後に`result.value`を使えるようにする。まず整数の戻り値と同時未完了1件に限定する。

共通API化後の作業方針：未実装の結果配送・完了通知に必要な定義を`.proto`へ追加し、生成API・`device-connection.ts`・`remote-session.ts`から既存のPython RPC配送へ接続する。JavaScriptの`Promise`が完了することと、ESP32 VMのFutureが完了することを別々に扱い、現在のWorker受付ACKをメソッドの完了応答として流用しない。

主な作業：

- 呼出し時に要求を一度だけ発行してFutureを返す。`done`の読取りやVMのtickで同じRPCを再発行しない。NativePendingで応答まで呼出し命令を止める実装にはしない。
- 応答を接続・実行世代・要求IDで照合し、ESP32の実行ループでFutureへ反映する。値またはエラーを設定してから完了状態にする。
- FutureをVM所有の値として管理し、未完了要求が必要とする参照だけをVM内の根として保持する。完了・失敗・期限切れで要求管理の保持を解除し、利用者が保持する結果は引き続き参照できるようにする。
- 未完了／失敗時のvalue参照、不正な属性代入、同時件数超過を扱う。破棄されたFutureと再利用した管理領域を古い応答で更新しない。
- 失敗・タイムアウト・切断をFutureへ届け、ブラウザのメソッド失敗と通信失敗を識別する。正常終了後の読み直しで要求を復活させない。
- デバッガーの停止PC・Snapshot表示を確認し、Futureを通常の機器ハンドルや数値へ誤変換しない。停止中に届く応答の反映時点も定める。

完了条件：単一RPCのPending → 成功／失敗の実装と、done確認・値取得が一貫する。結果待ちの間もESP32の別の通常処理と通信を進める構造となる。実際の継続動作・遅延応答の確認は別途記録する。

### 第5段階：数値配列・スカラー型・複数要求への拡張

目的：当初の`calc(data)`に必要なデータと、上限内の複数Futureを扱う。

共通API化後の作業方針：引数・結果の型、長さの上限、分割転送に必要なAPIを生成元へ反映し、共通クライアントとPython RPCのアダプターを拡張する。現在のホスト型参照や既存コード転送の利用だけで、VM間の配列配送が実装済みとは扱わない。共通クライアントの同時呼出し上限、ESP32の要求キュー、VMの未完了Future数はそれぞれ別に管理する。

主な作業：

- 第1段階で型解析・生成するfloat・文字列・`async ... -> None`を、実際の引数配送・完了応答へ接続する。対応範囲とエラーを引数・戻り値で揃える。
- float32・uint8の数値ndarrayを引数・戻り値へ接続する。まず1次元を通し、複数次元を今回含めるかは第0段階の選択に従う。
- dtype・shape・要素データを境界で検証し、サイズ上限・空配列・分割・再構築を扱う。VM間で参照共有せず、呼出し受付時点の内容を独立した転送データとして保持する。
- 非同期配送へ渡すコピーは必要なものに限定する。転送中の元配列変更・GC・関数終了がデータを変えないようにし、結果は受信側VMで確保する。
- 未完了数を有限の上限へ拡張し、要求とFutureを対応付ける。ブラウザ側は当初の直列実行を維持し、複数の未完了要求を並列実行と混同しない。
- 配列転送やキュー待ちが期限・通常指令・Stopを圧迫しないように配送量を制限する。重複要求は自動的に再実行せず、保持する重複判定情報にも上限を設ける。

完了条件：数値配列を使うRPC、複数Futureの対応、転送・結果保持・GCの解放点が接続される。object配列・リスト・ユーザーオブジェクトの転送は未対応として明示する。メモリー量と転送時間は実測がある場合だけ報告する。

### 第6段階：Wi-Fiへ同じRPCを接続

目的：BLEとWi-Fiで同じRemote／Futureの契約を利用する。

共通API化後の作業方針：現在の`Remote`・`RemoteSession`の生成APIと、`RemoteBleSession`に残るBLE専用の経路選択を両経路へ接続する。Wi-Fiの実配送を実装してから、`.proto`の対応経路・生成物とAPI側の利用条件を揃える。定義の対応経路だけを書き換えて完了とはしない。

主な作業：

- `robot-wifi.ts`、ESP32の`network.cpp`・`lib/wifi`へRPCの配送を追加する。HMAC認証・制御権・接続世代の照合を既存経路と揃える。
- WebSocket経路と、既存のHTTP経路を使う場合の要求取得・応答送信を接続する。HTTPで必要な継続取得は未処理要求を取りこぼさない方式とする。
- 共通のRPC API・既存アダプターを使い、Python RPCの復号・要求ID・キュー・期限・エラー処理を両経路へ接続する。共通APIのエラーをFutureの結果へ対応付ける箇所を明確にし、経路ごとにRemoteやFutureの意味を変えない。
- BLE／Wi-Fi切替で旧要求を失効させ、同じ要求を新経路へ暗黙に再送しない。再接続後は新しい実行として明示的に準備する。
- カメラHTTP、Plotly.js、Three.jsには変更を加えない。

完了条件：両経路に配送の実装が揃い、経路切替・切断がFutureの永久待機を残さない構造となる。HTTP／WebSocket／BLEの実通信確認はそれぞれ独立して記録する。

### 第7段階：終了・互換性・サンプルの仕上げ

目的：途中段階で対応した停止・失効処理を全経路で揃え、RPCの実装完了を判断できる状態にする。

主な作業：

- Stop、通常終了、実行エラー、再実行、どちらかのソース変更、ブロック削除、Clear、図読込、非表示、pagehide・破棄で、Remote・要求・Future・Worker・転送データの終了を揃える。ソース変更時には該当成果物とRPC登録情報の対応を再確認する。
- ESP32のトップレベル終了時に未完了要求がある場合と、ブラウザのトップレベル初期化終了後の受付寿命を区別する。古い応答で新しい実行を変更しない。
- 通知呼出しの実行失敗をブラウザ側の表示へ届ける。取消は新たな結果反映を止めるもので、実行済みの副作用を巻き戻す保証にはしない。
- 新旧のバイトコード・Python RPC版・登録情報とAPIの指紋の不一致を開始前に拒否する。共通`.proto`の生成物の指紋照合は別に行い、現状は相手機器との指紋交換を実装していないことを維持して記述する。VM用JS／Wasmと`assets.json`を同じ生成物として更新し、古い資産の混用を防ぐ。
- 通常のESP32実行、ブラウザ単独実行、print、NumPy、数値カーネル、F9・ステップ・停止表示への影響を確認する。
- `public/diagram/python/`へ戻り値なし・整数Future・数値配列・失敗処理の教材用サンプルを、ブラウザ用とESP32用の2ソースの組で追加し、既存の一覧登録方式へ接続する。2ソースの対応は保存・復元でも維持し、実行中のFutureや接続IDは図へ保存しない。
- 各リポジトリーのビルド記録・README等は操作と検証結果を更新し、実装仕様はソースコメントを参照させる。

完了条件：対象機能の実装、版・資産・コメント、サンプル、終了処理が揃い、残る未確認項目を列挙できる。「実装・ビルド完了」と「実通信・実機確認完了」は分けて報告する。Plotly.js／Three.jsの連携はこの後に別計画で着手する。

## 5. ビルド・確認の進め方

初回の計画書作成では文書のリンク・現行ソースとの対応・差分だけを確認した。第1段階以降は各段階の実施記録に、実装と実際に実行した確認を追記する。Uploadは依頼された場合だけ行う。

実装時も従来のテスト不要指定を引き継ぎ、自動テスト・模擬テストを作成・実行しない。以下の実行確認候補は、実装を確認する際の観点として残し、実施した結果だけを記録する。

| 確認区分 | 対象・記録する境界 |
|---|---|
| 文書・ソースの静的確認 | コメントと実装の一致、リンク、型・ID対応、生成物の整合、`git diff --check`。 |
| 共通RPC APIの生成・照合 | `.proto`を変更した場合は生成器を実行し、Webと変更対象のESP32生成物を照合する。具体的なコマンドは[生成・検証記録](../../build-and-test.md)を参照する。生成物を手編集せず、配列やFutureの実配送確認とは区別する。 |
| Webビルド | uroaで`npm.cmd run verify`。型・公開ビルド・資産の静的確認であり、RPCの実行確認ではない。 |
| ブラウザ用VMビルド | 共通VM・`browser/host.cpp`・C公開関数を変更した段階で[ブラウザVMのビルド手順](../../../../esp32/app/diagram-control/browser/README.md)に従いJS／Wasmとマニフェストを再生成する。生成済みJS／Wasmを手編集しない。 |
| ESP32ビルド | 実行直前に`platformio.ini`の`default_envs`を読み、diagram-controlで下記コマンドを実行する。`-e`で別環境へ上書きしない。 |
| ブラウザ実行候補 | 初期化後の受付継続、2回目の呼出し、戻り値、エラー表示、Stop・再実行。ブラウザで実行していなければ未確認とする。 |
| 実通信・実機候補 | BLE／Wi-Fiごとの整数・配列RPC、結果待ち中のESP32処理継続、切断・遅延・期限切れ・旧応答、通知呼出しの順序、上限時の失敗。ビルド結果から動作済みとは判断しない。 |
| 既存機能の確認候補 | ESP32／ブラウザ単独実行、print、NumPy、カーネル、デバッグ、通常指令・センサー通知。試験を実施しない場合は静的確認の範囲を明記する。 |

```powershell
# uroaリポジトリー
Set-Location D:\usr\prj\uroa
npm.cmd run verify

# ESP32：現在のdefault_envsだけでビルドする。Uploadは含まない。
Set-Location D:\usr\prj\esp32\app\diagram-control
& C:\Users\hamad\.platformio\penv\Scripts\platformio.exe run
```

2026-11-27の静的確認時点の`default_envs`は`supermini_esp32s3`。将来の実行対象を固定する根拠にはしない。`bin/build.ps1`はUploadを含むため、ビルドだけの確認では使用しない。

各段階の完了報告には、変更内容、仕様コメントの場所、実行したビルドと対象、未実施のブラウザ・通信・実機確認、次段階へ残す項目を記載する。部分対応の段階をRPC全体の完了とは扱わない。

## 6. 進捗記録

各行の「未接続」はその段階を完了した時点の範囲を示す。現在のPython RPCの到達点は第3段階であり、その後の共通API化は補足行へ記録する。

| 段階 | 状態 | 実施結果 |
|---|---|---|
| 第0段階：境界・公開方法 | 完了 | 推奨案の採用をユーザーが承認。実行・配送の詳細は対応段階で具体化する。 |
| 第1段階：構文・独立解析・生成 | 実装・ビルド完了 | スカラーの専用解析・未実行成果物まで。RPC実行と2ソースUIは未接続。解析／生成の実行試験は未実施。 |
| 第2段階：ブラウザ受付・メソッド入口 | 実装・ビルド完了 | 専用Runtimeのスカラー受付、順次実行、要求間GCと停止まで。ブラウザ実行・実通信は未確認。 |
| 第3段階：BLE通知呼出し | 実装・ビルド完了 | 整数0〜1引数・None戻り値、専用BLE窓口と2ソース開始・停止を接続。サンプル1組を追加。実配送・実機は未確認。 |
| 補足：共通RPC API化（2026-11-28） | 呼出しAPIの実装・ビルド完了 | `.proto`からの型・操作表と一部codecの生成、既存BLE／Wi-Fi処理への対応付けを追加し、第3段階のPython RPCも接続した。型・Web公開ビルド・生成物照合・既定環境のESP32ビルドが成功。送受信処理の生成・置換による手書き削減は未完了。実行・実通信・実機は未確認。第4〜7段階の完了には含めない。 |
| 補足：送受信の自動生成・手書き実装削減 | 生成化1〜4完了、5・6未着手 | 基準を保存し、通常指令の両側codec・クライアント・サーバー振分けと応答生成を接続した。手書きのopcode振分け・応答作成を置換し、両側ビルドと静的照合を完了。実通信は未確認。 |
| 第4段階：整数Future | 未着手 | — |
| 第5段階：数値配列・複数要求 | 未着手 | — |
| 第6段階：Wi-Fi配送 | 未着手 | — |
| 第7段階：終了・互換性・仕上げ | 未着手 | — |

2026-11-28の本書更新では、共通APIの位置付け・担当先・後続段階の接続方針を現行ソースへ合わせ、送受信の自動生成によって手書き実装を削減する計画を追加した。続いて生成化1の棚卸しを行い、通信別の置換対象・不足する定義と行数の基準JSONを記録した。リンク・記述・差分と基準値の整合を確認し、生成化1ではソース変更・再生成・ビルド・実行確認を行っていない。生成化2〜4ではcodec・クライアント・サーバー振分けと応答作成の置換・再生成・両側ビルドまで実施し、各実施記録と検証記録へ区別して記載した。実通信・実機の確認結果ではない。

関連する現行の作業案内・ビルド・終了処理は、[ESP32連携ガイド](../esp32-integration.md)、[Webのビルドと確認](../../build-and-test.md)、[起動・終了](../../app-lifecycle.md)、[オブジェクト・配列対応の経緯](object-array-change-map.md)を参照する。過去のビルド・実機結果を今回のRPCの検証結果として扱わない。
