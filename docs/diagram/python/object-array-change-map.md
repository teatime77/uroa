# Python VMのオブジェクト・NumPy配列対応：変更箇所一覧


現行の形式・呼出し規約は[bytecode.ts](../../../diagram/ts/python/bytecode.ts)、現行の型・配置は[semantic.ts](../../../diagram/ts/python/semantic.ts)、実行は[bytecode_vm.cpp](../../../../esp32/app/diagram-control/src/bytecode_vm.cpp)のコメントを参照する。[bytecode.md](bytecode.md)は現行ソースへの参照案内とする。2026-11-24の事前整理で旧生成経路・バイトコード版1/2・旧Event/Snapshotを削除し、C++の形式解釈を共通化した。オブジェクト・ndarrayの新機能は引き続き未実装である。

## 1. この一覧に反映する作業範囲

- 通常の変数・引数・計算途中の値は値スタック、本体は関数ごとの論理的なデータ領域へ置く。通常の代入は参照共有、引数は参照渡しとする。
- 通常関数終了時に、その関数の本体領域を解放する。`main`から`f()`、続いて`g()`を呼ぶ場合、`f`終了後に`f`の本体は残らない。物理的なバッファを共用する場合も、関数の境界を保存・復元する。
- コンストラクタと、そこから直接呼ぶ子孫コンストラクタは、構築先から同じ所有フレームを引き継ぐ。途中に通常関数を挟む場合、その通常関数へ所有先を自動継承しない。コンストラクタが直接確保する一時的な本体も所有先終了まで保持する。
- 寿命は別名・フィールド・関数呼出しを含めてコンパイル時に検査する。実行時の各参照に所有フレーム情報を付けず、オブジェクトごとの参照管理表も設けない。コンストラクタの確保先を指定する呼出し情報と、フレームのデータ領域境界は別途必要である。
- 通常関数では、その関数内で生成したオブジェクト・配列の参照をobject配列へ格納する操作を禁止する。コンストラクタでは、格納先と同じ所有先へ確保した本体を格納できる。引数・大域値等の長命なオブジェクトのフィールドへの短命な参照の格納も禁止する。
- 戻り値の本体内部に、終了するcalleeの別の本体への参照を残してはならない。既存のcaller側本体への参照は保持できる。通常関数内で構築した、callee所有の可変長配列をメンバーに持つオブジェクトを返す操作も、この禁止の対象とする。
- 配列生成はC++で実装するNumPyサブセットへ統一する。`import numpy as np`、`np.zeros((h, w), dtype=np.float32)`、`np.zeros((h, w), dtype=np.uint8)`、`np.empty(n, dtype=object)`を対象とする。object配列の初期値は`None`、実際の参照は同じクラスへ型を統一する方針とする。
- リストリテラル、`array(float, n)`、確保後の配列長変更は対象外。形状指定のタプルと、汎用タプル機能は区別する。スライス・ビュー・broadcast等の追加NumPy機能を暗黙に含めない。
- NumPy配列の戻り値は実行時にサイズが決まっても許可する。数値配列は情報と要素を一体で保持し、RET時にcallee領域の先頭へ詰めてcallerへ引き継ぎ、残りを解放する。object配列では参照列を移し、参照先の本体は移動しない。引数をそのまま返す場合も本体をコピーする。先に検討した「戻り値配列は固定長・CALL前に全領域を予約する」という制限は採用しない。

以下の「既存」は現行ソースで存在を確認した名前、「新規候補」は未作成で名前も仮のもの、「条件付き」は実装方式により修正要否を判断する箇所である。型・構造体・定数も、関数の変更に不可欠なため併記する。

## 2. uroa：構文木・構文解析・スコープ

| ファイル | 関数／メソッド・宣言 | 区分 | 変更内容 |
|---|---|---|---|
| [diagram/ts/python/syntax.ts](../../../diagram/ts/python/syntax.ts) | `App`、`App.children`、`App.precedence()`、`App.source()`、`App.toString()` | 既存 | `dtype=`のキーワード引数、複数添字、形状指定を表現・走査・再文字列化できるようにする。キーワード名を変数参照と混同しない。 |
| 同上 | `Fn`、`Fn.children`、`Fn.toString()`、`Domain.fns` | 既存 | クラス所属のメソッド・コンストラクタを保持し、モジュール関数と区別する。名前・親子関係・元位置を保持する。 |
| 同上 | `ClassDefinition`の`children`・`toString()`、キーワード引数用ノード | 新規候補 | クラス本体と呼出し引数の新しい表現を追加する。既存の`App`を拡張する方式でもよい。 |
| [diagram/ts/python/parser.ts](../../../diagram/ts/python/parser.ts) | `Parser.parseStatement()`、`parseBlock()`、`readFn()` | 既存 | `class`とその配下の`def`を解析し、`__init__`・`self`を後段へ渡す。通常関数とクラスの配置・入れ子の制約を確認する。 |
| 同上 | `Parser.readImport()`、`readModuleName()` | 既存 | 現在作成できるimportの構文木を再利用し、NumPyの別名を後段へ渡す。importの受理範囲を意味解析とそろえる。 |
| 同上 | `Parser.PrimaryExpression()`、`readComma()`、`parseAssignment()` | 既存 | `dtype=object`等の引数、`a[i, j]`、複数添字への代入を解析する。リストを実行可能な配列生成として受理しない。既存の単一添字・位置引数・式の括弧を維持する。 |
| 同上 | `Parser.readClass()`、`readCallArguments()` | 新規候補 | クラス宣言と、位置／キーワードを区別する呼出し引数の解析を分離する。 |
| 同上 | `parsePython()` | 既存・入口 | 新しいノードも`source`・`parent`・`charPos`を失わず返す。型・寿命の検査は引き続き意味解析に任せる。 |
| [diagram/ts/python/global-scope.ts](../../../diagram/ts/python/global-scope.ts) | `collectScopeGlobals()`内の`expression`・`statement` | 既存 | クラス本体と各メソッドのスコープを混ぜない。NumPy別名、キーワード引数の値、複数添字の式を正しく走査する。寿命検査では大域への参照格納も対象にする。 |
| [diagram/ts/python/lex.ts](../../../diagram/ts/python/lex.ts) | `lexicalAnalysis()`、`keywords`、`symbols` | 条件付き | `class`・`import`・`as`・`=`・`,`等は既存の字句で表現可能。新しい構文に字句の追加が必要な場合だけ変更する。クラス名用の新しいトークン型を安易に増やさない。 |

## 3. uroa：型・名前解決・寿命解析

| ファイル | 関数／メソッド・宣言 | 区分 | 変更内容 |
|---|---|---|---|
| [diagram/ts/python/semantic.ts](../../../diagram/ts/python/semantic.ts) | `PythonType`、`PythonVariable`、`PythonFunction`、`PythonBinding`、`PythonCall`、`PythonAnalysis` | 既存 | ユーザークラス、ndarray、dtype、次元数、実行時shape、object要素の型、クラス／メソッド情報、コンパイル時の参照先・寿命条件を表す。実行時の参照管理表とは区別する。 |
| 同上 | `valueSlotTypes()` | 既存 | 現在のrecordの葉への再帰展開と、参照1個による配置を整理する。値スタックの幅とデータ本体のサイズを分離する。 |
| 同上 | `sameType()`、`PythonResolver.typeName()`、`merge()`、`update()`、`compatible()` | 既存 | ndarrayのdtype・次元数・object要素クラス、`None`要素を判定する。実行時shapeの違いを、即座に別型として拒否しない。 |
| 同上 | `PythonResolver.reserved()`、`addVariable()`、`collect()`、`binding()`、`resolve()` | 既存 | クラス・メソッド・NumPy別名・dtype名を登録する。クラス所属ごとの名前を区別し、変数スロットを参照幅に合わせる。 |
| 同上 | `PythonResolver.owner()`、`field()`、`call()`、`nativeArguments()` | 既存 | ユーザークラスと既存の機器クラスを区別する。`self`、NumPy関数、配列属性、キーワード引数、コンストラクタの確保先を解決する。 |
| 同上 | `PythonResolver.operation()`、`expression()`、`assignment()` | 既存 | 添字の型、要素の読取り・代入、負の添字、`len()`を解析する。object要素への禁止された参照格納、フィールドへの寿命違反、リストの使用を診断する。 |
| 同上 | `PythonResolver.statement()`、`block()`、`fallsThrough()`、`infer()` | 既存 | returnの内部参照、分岐・ループ・別名・呼出しを含む寿命条件を検査する。再帰・相互再帰の条件も収束させ、証明できない操作を拒否する。コンストラクタと通常メソッドを区別する。 |
| 同上 | `readType()`、`readCallable()`、`readDeviceApi()`、`loadDeviceApi()` | 既存 | ネイティブAPIの参照型・呼出し規約・ABI変更を検証する。ユーザークラスの型IDを機器クラスのIDと混同しない。 |
| 同上 | `resolvePython()`、`analyzePython()` | 既存・入口 | 新しい解析を共通入口から実行し、寿命違反も既存の診断一覧へ返す。診断があれば生成・送信を止める。 |
| `diagram/ts/python/lifetime.ts` | `analyzeLifetimes()`、`checkReferenceStore()`、`checkReturnReferences()`、呼出し条件の集約処理 | 新規候補・ファイル未作成 | 寿命解析を切り出す場合の候補。局所生成、引数由来、通常関数の戻り値、コンストラクタ所有先を追跡する。`semantic.ts`内に実装する場合は新規ファイル不要。 |
| `diagram/ts/python/numpy-api.ts` | NumPy関数・dtypeの定義、呼出し解決・引数正規化処理 | 新規候補・ファイル未作成 | NumPy名、`zeros`・`empty`、shape・dtypeの対応表を置く候補。名前は仮。C++側のID・型・ABIと同じ定義からそろえる方式を選ぶ。 |

寿命解析では、直近の代入式だけではなく、通常関数の呼出し条件を要約して呼出し側で照合する必要がある。例えば「引数`src`を引数`dst`へ格納する」関数を経由しても禁止を回避できないようにする。コンストラクタは所有先を引き継ぐが、通常メソッド・通常関数へその例外を広げない。

## 4. uroa：バイトコード生成

| ファイル | 関数／メソッド・宣言 | 区分 | 変更内容 |
|---|---|---|---|
| [diagram/ts/python/bytecode.ts](../../../diagram/ts/python/bytecode.ts) | `BytecodeOpcode`、`operandEncoding`、形式版・ヘッダー／関数レコード長の定数 | 既存 | 本体確保、フィールド・配列要素アクセス、コンストラクタ呼出し、参照戻り値に必要な命令・型情報・形式を定義する。番号・長さ・形式版は未確定。 |
| 同上 | `Scope`、`AssemblyEntry`、`ValueAddress`、`SlotAllocation` | 既存 | 値スロットの住所とデータ本体の住所を区別する。通常関数／コンストラクタ、クラス所属、確保先を表現する。 |
| 同上 | `BytecodeGenerator.collectFunctions()` | 既存 | ユーザーメソッド・コンストラクタも収集する。局所・大域・クラスのフィールドを混同せず、関数を一意の名前とPCへ割り当てる。 |
| 同上 | `BytecodeGenerator.constructor()` | 既存 | `PythonAnalysis`を唯一の入力として型・寿命の診断を検査する。意味解析なしの旧経路は事前整理で削除済み。 |
| 同上 | `valueWidth()`、`loadValue()`、`storeValue()`、`temporary()`、`address()` | 既存 | recordの全葉コピーから、参照と本体アクセスを区別する処理へ変更する。属性の固定スロット加算を見直す。一時参照が生存中の本体を再利用・解放しない。 |
| 同上 | `expressionAs()`、`typedCall()`、`typedExpression()`、`typedAssignment()` | 既存 | オブジェクト生成、メソッドの`self`、NumPy呼出し、dtype・shape、添字アクセスを生成する。右辺・対象・添字の評価順と1回だけの評価を守る。 |
| 同上 | `statement()`、`compileTyped()` | 既存 | 通常CALL／RETとコンストラクタの確保先継承を生成する。実行時サイズの配列returnに対応する。クラス宣言・NumPy import自体を通常の実行文として出力しない。 |
| 同上 | `format()`、`formatAssembly()` | 既存 | 型・本体配置・新命令・メソッド名・呼出し規約をアセンブリで確認できるようにする。 |
| 同上 | `instructionLength()`、`addressOperand()`、`encodeBinary()` | 既存 | 新命令と新しい型／クラス情報を符号化し、PC・長さ・オペランド上限を検証する。文字列・関数表の位置計算も更新する。 |
| 同上 | `generateDebugBytecode()`、公開関数`generateAssembly()`・`generateBytecode()`・`generateDebugBytecode()` | 既存 | 同一コンパイルのクラス・配列型・変数配置・最終PCをデバッグ情報へ渡す。文開始・関数入口・暗黙returnの停止点を維持する。 |

## 5. ネイティブAPI定義・生成物

現行のAPI生成器は`device.pyi`の機器・数値API専用であり、NumPyのモジュール名、dtype、キーワード引数、ndarrayは定義していない。NumPy用に別の定義を置く場合も、コンパイラーとESP32の登録表が一致するようにする。ユーザーが書くクラス本体を、機器スタブ生成器へ渡す設計にはしない。

| ファイル | 関数／メソッド・宣言 | 区分 | 変更内容 |
|---|---|---|---|
| [diagram/python/generate-device-api.py](../../../diagram/python/generate-device-api.py) | `InterfaceParser.read_type()`、`read_callable()`、`read_class()`、`parse()`、`main()` | 既存 | recordの参照化に伴うJSONの型・呼出し規約・ABIを更新する。NumPyの定義も統合する場合はモジュール・ndarrayの表現を追加する。 |
| [diagram/python/device_api_cpp.py](../../../diagram/python/device_api_cpp.py) | `CppGenerator.record()`、`cpp_type()`、`leaves()`、`arguments()`、`result_type()`、`generate()`、`generate_cpp()` | 既存 | 平坦化したrecordの引数・戻り値をVM本体との変換へ変更する。ネイティブが配列を確保する場合のVM確保先・結果型・登録表を生成する。 |
| [diagram/python/device.pyi](../../../diagram/python/device.pyi) | `Vec3`、`IMUValue`、`IMU.get_value()`等のrecord関連宣言 | 条件付き | Pythonから見える既存の機器APIを維持できれば、宣言変更は不要。コメント・型定義の拡張が必要な場合だけ変更する。NumPy APIをグローバルな機器関数として追加しない。 |
| [public/diagram/device/device-api.json](../../../public/diagram/device/device-api.json) | `schemaVersion`、`callingConventionVersion`、`abiHash`、型・呼出し情報 | 再生成 | 生成元から更新する。JSONを手編集しない。 |
| [ESP32/include/device_api.generated.h](../../../../esp32/app/diagram-control/include/device_api.generated.h) | `device_api::Vec3`、`IMUValue`、`Backend`、`makeNativeApi()` | 再生成 | C++側の値型を残すかVM参照用の型を置くかを決め、登録APIへ反映する。直接編集しない。 |
| [ESP32/src/device_api.generated.cpp](../../../../esp32/app/diagram-control/src/device_api.generated.cpp) | `invoke_IMU_get_value()`、`entries`、`abiHash`、`makeNativeApi()`ほか生成スタブ | 再生成 | 現在6スロットを返すIMUValueを新しいrecord表現へ変換する。NumPy登録を含む場合は共通IDとABIへ反映する。直接編集しない。 |

## 6. ESP32：値・データ領域と実行

この節のESP32パスはすべて`D:\usr\prj\esp32\app\diagram-control`を基準とする。

| ファイル | 関数／メソッド・宣言 | 区分 | 変更内容 |
|---|---|---|---|
| [include/bytecode_vm.h](../../../../esp32/app/diagram-control/include/bytecode_vm.h) | `BytecodeVM::Type`、`Value`、`Error`、`Frame` | 既存 | 既存の機器`Object`ハンドルと、VMのオブジェクト／ndarray参照を区別する。フレームにデータ領域の境界・コンストラクタの確保先を持たせる。エラーと上限を定義する。 |
| 同上 | `NativeCall`、`NativeEntry`、`NativeApi`、データ領域用メンバー | 既存＋追加 | C++実装がVMの領域を確保・参照できる入出力契約を追加する。非同期に生ポインターを保持しない。寿命検査用の所有者を各参照へ追加しない。 |
| [src/bytecode_vm.cpp](../../../../esp32/app/diagram-control/src/bytecode_vm.cpp) | `BytecodeVM::start()`、`stop()`、`bindNativeApi()` | 既存 | 新形式の型表・登録表を検証し、データ領域を初期化・解放する。再開始・Stop・イメージ置換で参照を失効させる。 |
| 同上 | `BytecodeVM::call()`、`ret()` | 既存 | 通常関数ごとのデータ境界を保存・復元する。コンストラクタの所有先継承と通常関数の切替えを区別する。RETでは戻り値本体だけをcallerへ残し、実行時サイズ・重複領域のコピー・戻り値参照の更新を扱う。 |
| 同上 | `BytecodeVM::step()` | 既存 | 本体確保、属性、添字、dtype別の読書き、配列長、コンストラクタ用命令等を実行する。`None`要素のメンバー参照、添字範囲、未初期化フィールド、バイト数計算のoverflowを検査する。 |
| 同上 | `BytecodeVM::validValue()`、`truth()`、`calculate()` | 既存 | VM参照と機器ハンドルを区別して検査する。配列・オブジェクトを数値として扱わず、未対応の演算を明示的に拒否する。 |
| 同上 | `BytecodeVM::push()`、`pop()` | 条件付き | 参照1個のpush／popでは本体を解放しない。現在の固定スロット・一時値下限の方式を利用できるか確認する。 |
| 同上 | `BytecodeVM::callNative()` | 既存 | ndarray生成・record変換用に確保先を渡す。`NativePending`再試行で本体を重複確保しない。失敗した呼出しで部分的な結果を公開しない。 |
| 同上 | `BytecodeVM::allocateText()`、`firstDebugString()` | 条件付き | 現在はglobalsと値スタック上のStringだけを見る。本体内部に文字列参照を許す場合は探索を追加する。初期対応で文字列フィールドを許さない場合は、その制約を型解析とコメントで明示する。 |
| 同上＋ヘッダー | `allocateData()`、`allocateObject()`、`allocateArray()`、`arrayElementOffset()`、戻り値本体の移送処理 | 新規候補 | データ領域の確保、整列、相対アドレス、shapeからのサイズ計算、要素アクセス、RET時の移送を共通化する。名称は仮。常設のオブジェクト参照管理表は作らない。 |
| `include/numpy_native.h`・`src/numpy_native.cpp` | `numpy_native::zeros()`、`empty()`、登録表の作成処理 | 新規候補・ファイル未作成 | NumPyサブセットのC++処理を置く候補。`zeros`の初期化、objectの`None`初期化、対応dtypeを実装する。VM管理の領域を使い、C++関数終了時に結果を解放しない。 |
| [include/device_native.h](../../../../esp32/app/diagram-control/include/device_native.h)・[src/device_native.cpp](../../../../esp32/app/diagram-control/src/device_native.cpp) | `DeviceNative::IMU_get_value()`、`reset()`、既存の`create()`と機器管理用`Object` | 条件付き | 生成BackendのC++署名を保つならIMU本体の変更は不要で、変換は生成スタブへ置ける。機器ハンドルの管理とVM本体領域の解放を混ぜない。 |
| [src/main.cpp](../../../../esp32/app/diagram-control/src/main.cpp) | `nativeApi`初期化、`setup()`、`runBytecode()`、`handle()`、`loop()` | 必須／一部条件付き | NumPy登録をVMへ接続し、終了後の診断表示を新しい参照型へ対応させる。既存の開始・停止・世代変更経路でデータ領域が解放されることを確認する。VMは引き続き`loop()`だけで操作する。 |

既存`Value::Object`と`DeviceNative`の機器管理表は、今回省く「VMオブジェクト本体の参照管理表」とは別物である。機器の登録・停止・resetを廃止する計画ではない。

## 7. 形式検証・命令PC・デバッガー

| ファイル | 関数／メソッド・宣言 | 区分 | 変更内容 |
|---|---|---|---|
| [diagram/ts/ble-wifi/bytecode-transfer.ts](../../../diagram/ts/ble-wifi/bytecode-transfer.ts) | `checkBytecodeTransfer()` | 既存 | 新しいバイトコード版、ヘッダー、関数・型表の長さと位置を検証する。転送フレーム版とは分離する。 |
| [ESP32/include/bytecode_format.h](../../../../esp32/app/diagram-control/include/bytecode_format.h)・[src/bytecode_format.cpp](../../../../esp32/app/diagram-control/src/bytecode_format.cpp) | `BytecodeFormat::Image`、`parseImage()`、`instructionLength()`、配置定数 | 既存・事前整理で追加 | 新しい型表・命令・ヘッダー配置を共通定義へ反映する。VM・受信器・デバッガーへ固定の版別判定を再追加しない。 |
| [ESP32/src/bytecode_receiver.cpp](../../../../esp32/app/diagram-control/src/bytecode_receiver.cpp) | `BytecodeReceiver::validate()`、`validatePcs()` | 既存 | 新形式・命令・型情報・オペランドと、新しい命令先頭PCを検証する。共通の配置・命令長を使い、受信時固有の検証を更新する。 |
| [ESP32/include/bytecode_receiver.h](../../../../esp32/app/diagram-control/include/bytecode_receiver.h) | `MaxLength`、`MaxBundle`、受信コードの公開宣言 | 条件付き | 上限や公開情報を変える場合のみ修正する。ndarrayの要素データは実行時に作るため、通常はbytecode転送へ配列本体を追加しない。 |
| [ESP32/src/bytecode_debugger.cpp](../../../../esp32/app/diagram-control/src/bytecode_debugger.cpp) | `BytecodeDebugger::code()`、`clearFlags()`、`applyBreakpoints()`、`installDeployment()` | 既存 | 共通の形式解釈を使って命令範囲を取得する。新しい型表の位置を命令列と混同せず、bit7の設定・解除を命令先頭だけに行う。 |
| 同上＋[include/bytecode_debugger.h](../../../../esp32/app/diagram-control/include/bytecode_debugger.h) | `BytecodeDebugger::publishState()`、`handle()`、Snapshot保持メンバー | 既存／一部条件付き | データ領域込みのSnapshot長・上限・取得失敗を扱い、Pausedの同じ停止状態から取得する。 |
| [ESP32/src/bytecode_vm.cpp](../../../../esp32/app/diagram-control/src/bytecode_vm.cpp) | `configureDebugPoints()`、`debugSnapshotLength()`、`copyDebugSnapshot()` | 既存 | 新命令の長さと、オブジェクト／配列情報・使用データ領域の直列化に対応する。Snapshotの値が指す本体を受信側で解決できるようにする。 |
| [diagram/ts/ble-wifi/debug-protocol.ts](../../../diagram/ts/ble-wifi/debug-protocol.ts) | `DebugValue`、`DebugSnapshot`、`decodeSnapshot()`、`debugProtocol` | 既存 | 新しい値タグ、データ領域、型・shape・参照位置を復号・全件検証する。Snapshot形式版と上限をC++側とそろえる。Control／Eventまで無条件に版変更しない。 |
| 同上 | `PythonDebugTransport.download()`、`accept()`、`invalidateSnapshot()` | 条件付き | 既存のチャンク受信・CRC・世代照合で新Snapshotを扱えるか確認する。必要な箇所だけ変更する。 |
| [diagram/ts/python/debug-info.ts](../../../diagram/ts/python/debug-info.ts) | `PythonDebugFunction`、`PythonDebugInfo` | 既存 | API表だけでなくユーザークラス・ndarray型、メソッド名・所属と参照スロットを表示できる情報を追加する。 |
| [diagram/ts/python/debugger-view.ts](../../../diagram/ts/python/debugger-view.ts) | `restoreFrames()`、`PythonDebuggerView.show()`、`value()`、`variables()`、`variable()` | 既存 | recordの平坦スロット復元から、参照先のフィールド・shape・要素表示へ対応する。共有参照・循環があっても表示が無限再帰しないようにする。新しいCALL表現でもフレームを復元する。 |

## 8. 既存入口・UIの確認箇所

以下は変更の波及先であり、すべての本体を必ず書き換えるという意味ではない。

| ファイル | 関数／メソッド | 変更・確認内容 |
|---|---|---|
| [diagram/ts/python/python-block.ts](../../../diagram/ts/python/python-block.ts) | `PythonBlock.checkSource()`、`check()`、`start()`、`executeDebug()`、`replaceSource()` | 新しい意味診断・DebugInfo・Snapshotが共通入口から扱えることを確認する。ソース保存形式の変更は不要。 |
| [diagram/ts/ble-wifi/device-connection.ts](../../../diagram/ts/ble-wifi/device-connection.ts) | `DeviceConnection.sendBytecode()`、`publishDebug()`、`sendBreakpoints()`、`observeDeployment()` | ブロック以外の送信入口でも新しい形式検証と診断表示を利用する。生の転送データを変換する処理を重複実装しない。 |
| [diagram/ts/python/editor-diagnostics.ts](../../../diagram/ts/python/editor-diagnostics.ts) | `semanticEditorDiagnostic()`、`syntaxEditorDiagnostic()` | 新しいノードや寿命違反でも、元のソース位置を表示できることを確認する。 |
| [diagram/ts/python/highlight-editor.ts](../../../diagram/ts/python/highlight-editor.ts) | `highlightTokens()`、`PythonHighlightEditor.setDiagnostics()`、`refresh()`、`toggleBreakpoint()` | 必要ならNumPy・dtype名の色分けを追加する。F9トグルと、ソース変更時のブレークポイント全解除を維持する。 |

## 9. 実装前に詳細化する事項

この一覧は変更先を列挙したものであり、次の値・符号化を既に実装したとは扱わない。

1. データ領域の容量、最大次元数・要素数・本体サイズ、整列、相対アドレスの幅。関数ごとの別バッファと共通バッファ＋境界管理のどちらを使うか。
2. 本体のヘッダー、ユーザークラス型表、dtype表、命令番号、呼出し規約・バイトコード・Snapshotの形式版。
3. NumPy API定義の生成元と登録方法、対応メソッドの正確な範囲。既定dtypeをfloat32とする推奨案の明文化と、NumPyの既定float64との差の表示。
4. `uint8`への数値代入時の変換規則、非数値・非有限値、空配列、object要素型が推論不能な場合、`None`要素アクセスのエラー表現。
5. `shape`等の属性の表現と、汎用タプル・ビューを追加しない範囲。文字列をオブジェクトのフィールドへ許すかどうか。

これらを具体化する際は、中心となるソースのコメントと関連ファイルを同時に更新する。寿命解析の詳細を決めずに、本体確保命令だけを先に利用可能にしない。

## 10. 実装時の進め方と確認範囲

1. 構文木・クラス／NumPy名前解決・型と寿命条件を具体化する。
2. `bytecode.ts`と`bytecode_vm.h/.cpp`の表現・CALL／RET・コンストラクタ確保先をそろえる。
3. NumPyのC++処理、既存recordの変換、生成API・ABI、双方の形式検証を接続する。
4. 命令PC走査とSnapshot、変数・配列表示まで更新し、既存の送信入口から利用できる形にする。

将来の生成・ビルド手順は[uroaのbuild-and-test.md](../../build-and-test.md)と[ESP32のbuild-and-test.md](../../../../esp32/docs/build-and-test.md)を参照する。API生成を変更する場合は生成器の`--check`で一致を確認する。ESP32をビルドする際は、その時点の`platformio.ini`の`default_envs`を読み直す。

本書の作成時に行った確認は、現行ソースの宣言・呼出し関係、文書内の既存ファイルへのリンク、差分の確認だけである。新規候補のファイル・関数は未作成。ビルド、生成器の実行、テスト、ブラウザー、通信、実機確認は行っていない。
