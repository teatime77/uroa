# ESP32 VM → ブラウザVMのRPC：段階別実装計画

作成日：2026-11-27、更新日：2026-11-28（日本時間）。第0段階の方針はユーザー承認済み。第1段階の独立した解析・生成、第2段階のブラウザVM受付、第3段階のBLE整数通知と2ソースの開始UIを実装した。2026-11-28に追加した共通RPC APIへ、このPython RPCの呼出しも接続した。第4〜7段階は未着手であり、今回のAPI統一で進捗段階を繰り上げない。Future更新・配列・Python RPCのWi-Fi配送は未対応で、ブラウザ・実通信・実機での動作確認は未実施。

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
| 補足：共通RPC API化（2026-11-28） | 実装・ビルド完了 | `.proto`からのAPI生成と既存BLE／Wi-Fi処理への対応付けを追加し、第3段階のPython RPCも接続した。型・Web公開ビルド・生成物照合・既定環境のESP32ビルドが成功。実行・実通信・実機は未確認。第4〜7段階の完了には含めない。 |
| 第4段階：整数Future | 未着手 | — |
| 第5段階：数値配列・複数要求 | 未着手 | — |
| 第6段階：Wi-Fi配送 | 未着手 | — |
| 第7段階：終了・互換性・仕上げ | 未着手 | — |

2026-11-28の本書更新では、共通APIの位置付け・担当先・後続段階の接続方針を現行ソースへ合わせた。文書内のリンク・記述・差分を確認し、ソース変更・生成・ビルド・実行確認は行っていない。補足行のビルド結果は共通API実装時の記録であり、この文書更新で再実行した結果ではない。

関連する現行の作業案内・ビルド・終了処理は、[ESP32連携ガイド](../esp32-integration.md)、[Webのビルドと確認](../../build-and-test.md)、[起動・終了](../../app-lifecycle.md)、[オブジェクト・配列対応の経緯](object-array-change-map.md)を参照する。過去のビルド・実機結果を今回のRPCの検証結果として扱わない。
