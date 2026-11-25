# Python VMのオブジェクト・NumPy配列対応：仕様共有・変更箇所・段階別計画

最終更新：2026-11-25。ブラウザーのChatGPTへ渡して議論を継続できるよう、合意した仕様・現行実装・今後の修正段階をまとめる。対象はuroaでコンパイルし、ESP32上の独自C++ VMで実行するPythonサブセット。CPythonやMicroPythonの移植ではない。

実装済み仕様の正本はソースのコメントとする。形式・呼出し規約は[bytecode.ts](../../../diagram/ts/python/bytecode.ts)、型は[semantic.ts](../../../diagram/ts/python/semantic.ts)、実行は[bytecode_vm.cpp](../../../../esp32/app/diagram-control/src/bytecode_vm.cpp)、GCは[bytecode_heap.h](../../../../esp32/app/diagram-control/include/bytecode_heap.h)と[bytecode_heap.cpp](../../../../esp32/app/diagram-control/src/bytecode_heap.cpp)を参照する。本書の未実装項目は設計共有用であり、実装時にソースへ仕様コメントを記述する。

## 1. 共有する仕様と現在地

### 1.1 実装状況

| 項目 | 状態 |
|---|---|
| 事前整理 | 旧生成経路・バイトコード版1/2・旧Event/Snapshotを削除し、C++の形式解釈を共通化済み。 |
| 第1段階 | クラス・キーワード引数・複数添字の構文と、NumPyの共通宣言・引数番号対応を実装済み。 |
| 第2段階 | ヒープ確保・マーク＆スイープ・VMの根登録を実装済み。探索は浅い参照構造を前提とする再帰方式へ簡略化した。 |
| 第3段階 | ユーザークラス・コンストラクタ・メソッド・属性アクセス・既存recordの参照化を実装済み。 |
| 第4段階 | float32・uint8のzeros/empty、実行時shape、全軸添字・属性・len、参照共有を実装済み。 |
| 第5段階 | object配列のNone初期化・参照格納・要素型推論・GC探索を接続。全5段階の実装を完了。 |
| GC簡略化 | メインループの回収点を追加。再帰マークとスイープに整理し、C++の根・確保中のGC・GC統計・本体のデバッグ転送と展開を削除した。 |
| 採用方式 | ヒープに確保する、移動しない単純なマーク＆スイープGC。旧6段階を第10節の5段階へ再編した。 |

現行形式と変更点の正本はソースコメントを参照する。GC簡略化でバイトコードversion=7、API schema・呼出し規約=6、stringPolicyVersion=3、Snapshot=6へ更新した。moduleDefinitionVersion=1、Control=1、Event=2、転送フレーム=2は維持する。既存nativeIdは維持し、NumPyは共有のモジュール関数IDで呼ぶ。ABI指紋は変更したため、Web・ファームウェアの両方を更新し、バイトコードを再生成・再送信する。

### 1.2 GC採用後のメモリー規則

- 通常の変数・引数・一時値は値スタック、本体はヒープに置く。値スタックには型情報と本体ポインターを置き、整数の機器ハンドルや文字列IDと区別する。
- 代入・引数・戻り値は参照共有とする。複数の変数・メンバー・要素が同じ本体を指し、本体を暗黙にはコピーしない。
- 関数終了時は局所参照を根から外すだけで本体を解放しない。大域変数とメインループの引数・局所変数から到達不能になった本体を回収点でGC回収する。
- 入れ子・共有・循環を許可する。数値配列の生データは参照探索から除外し、参照メンバーとobject配列の要素をたどる。
- コンストラクタの所有フレーム継承、フレーム別の本体解放、コンパイル時寿命解析は廃止する。参照カウント・弱参照・スタック確保・増分GCは当初追加しない。
- 型・添字・未初期化・サイズ計算の検査は維持する。通常関数でも生成した本体をメンバーやobject配列へ格納できる。寿命を理由とする従来の禁止は撤回する。

```python
def set_item(dst):
    x = np.zeros(2, dtype=np.float32)
    dst[0] = x  # GC方式では許可する。dstには対応する参照要素型が必要。

def set_member(dst):
    x = np.zeros(2, dtype=np.float32)
    dst.data = x  # 関数終了後もdstから到達できるため保持される。
```

通常関数で生成したユーザーオブジェクトのメンバー格納は第3段階、数値配列のメンバー格納は第4段階で接続した。上のset_itemのような配列をobject配列の要素へ格納する操作も第5段階で接続した。

### 1.3 戻り値とコンストラクタ

- 戻り値は参照をそのままcallerへ渡す。引数をreturnする場合も同じ本体を共有する。従来の「戻り値本体はコピーする」という仕様は変更する。
- calleeで生成した本体や、内部から参照する別の本体も返せる。所有先変更・本体移動・内部参照の付替えは不要。
- 配列サイズは実行時に決まってよい。「CALL前にサイズ既知」「戻り値の内部へcallee生成本体を格納禁止」という制限は撤回済み。
- コンストラクタと子孫コンストラクタも通常のGCヒープへ確保する。構築処理中にはGCを行わない。

### 1.4 NumPyとキーワード引数

- NumPyサブセットの処理本体をC++で実装する。float32・uint8の`zeros`・`empty`と実行時shapeは第4段階、`np.empty(n, dtype=object)`と`dtype=np.object_`は第5段階で接続した。
- object配列の初期化・参照共有・格納可能な要素は[numpy_native.cpp](../../../../esp32/app/diagram-control/src/numpy_native.cpp)、型の統合・未定型の扱いは[semantic.ts](../../../diagram/ts/python/semantic.ts)の仕様コメントを参照する。異種Python値の自由な混在は追加しない。
- リストリテラル、`array(float, n)`、確保後の長さ変更は対象外。形状指定のタプルと汎用タプルを区別し、スライス・ビュー・broadcast等は暗黙に追加しない。
- 既定dtype・emptyの初期化・uint8変換・負の添字・対応オプションは[numpy_native.cpp](../../../../esp32/app/diagram-control/src/numpy_native.cpp)、次元数・shape・確保上限は[VM](../../../../esp32/app/diagram-control/src/bytecode_vm.cpp)の仕様コメントを参照する。
- `diagram/python/device.pyi`を共通宣言元とし、コンパイラー用JSONとC++ enumを生成する。`class numpy`は名前空間でありユーザークラスではない。省略可能な項目は`= ...`とし、既定値はC++実装で設定する。

| 関数 | 必須位置引数 | 省略可能な引数のoptionId |
|---|---|---|
| `numpy.zeros`・`numpy.empty` | `shape=0` | `dtype=0`、`order=1`、`device=2`、`like=3` |

キーワード名はコンパイル時に番号へ変換し、実行時は指定された番号と値のペアを渡す。値の評価順はソース順とし、呼出しごとの文字列辞書検索は行わない。第4段階で実行まで接続した。省略した値はC++が設定する。device・like等の宣言が存在することは任意の値の実行対応を意味しない。

### 1.5 第5段階までの実装境界

実装の詳細は[bytecode_vm.h](../../../../esp32/app/diagram-control/include/bytecode_vm.h)の`allocateHeapValue()`・`markValues()`・`collectHeap()`と、上記GCソースのコメントを参照する。

- `BytecodeHeap`は確保一覧・確保・スイープ・全解放を担当する。VMがValue列を再帰マークする。詳細はbytecode_vm.cppのmarkValues()・collectHeap()を参照する。
- 本体先頭のValue列と後続の数値バイト列を区別する。GCがたどるのはValue列内の本体参照だけ。
- 根・回収点・C++の参照規則の正本はbytecode_vm.cppのcollectHeap()とcallNative()。C++の根登録は削除した。
- コンパイラーの回収点選定とGC_LOOPの形式はbytecode.tsのcollectFunctions()・encodeBinary()を参照する。確保中のGC・再試行は削除した。命令数budgetはGC時間を含む経過時間上限ではない。
- Stop・再開始で全解放する。GC統計・診断用本体ID・探索待ちリンクは保持しない。60fpsや数ms以内の完了は未計測。
- Pythonのユーザークラスと既存recordを1スロットのHeapReferenceで扱う。型表・生成命令・属性アクセス・self・メソッドを接続した。詳細はsemantic.tsのregisterClasses()とbytecode.tsのtypedCall()を参照する。
- フィールド名は__init__のself属性代入から収集し、型を静的に推論する。通常関数でも宣言済みフィールドへ格納できる。継承・動的な属性追加・入れ子のクラス・第一級関数は対象外。
- ユーザークラスの文字列フィールドを保持し、C++側のrecord値型との変換は生成スタブで行う。既存APIの読取り専用フィールドを維持する。
- Snapshotは既存のスカラー・文字列・フレーム表示だけを維持し、GC参照はclassIdだけを表示する。本体ID・メンバー・配列内容の転送と展開は削除した。詳細はdebug-protocol.tsとdebugger-view.tsを参照する。
- 数値配列の生成・スカラー読書き・全軸添字・属性・lenを接続した。対応範囲と診断はsemantic.tsのresolveModuleCall()・arrayItem()・operation()、命令と評価順はbytecode.tsのtypedNumpy()・typedArray()を参照する。
- 配列の本体参照を、通常関数・メンバー・引数・戻り値でも共有する。配列全体の演算・真偽変換・要素ごとの比較は追加しない。
- object配列へ通常関数で生成した参照を格納できる。数値配列・object配列も要素になり、入れ子・共有・循環を許す。単一参照要素型の推論・合流と、格納元がない場合のNone専用型はsemantic.tsのmerge()・normalizeArrays()・resolve()を参照する。
- Noneの属性・配列操作は実行時に検査し、メソッドはCHECK_REFで引数評価前に対象を検査する。命令はbytecode.ts、実行はbytecode_vm.cpp、エラー番号はdebug-protocol.tsを参照する。

### 1.6 将来拡張

イテレーター・内包表記・NumPy配列用イテレーター・yield・マルチスレッドは第1〜5段階の対象外。ジェネレーターの中断中は値とGCの根を保持する必要がある。マルチスレッドでは実行コンテキストとGC時の停止・同期を別途設計する。

以下の「既存」は現行ソースの宣言、「新規候補」は未作成で名称も仮、「条件付き」は実装方式により変更不要となる箇所を示す。

## 2. uroa：構文木・構文解析・スコープ

| ファイル | 関数／メソッド・宣言 | 区分 | 変更内容 |
|---|---|---|---|
| [diagram/ts/python/syntax.ts](../../../diagram/ts/python/syntax.ts) | `App`、`App.children`、`App.precedence()`、`App.source()`、`App.toString()` | 既存 | `dtype=`のキーワード引数、複数添字、形状指定を表現・走査・再文字列化できるようにする。キーワード名を変数参照と混同しない。 |
| 同上 | `Fn`、`Fn.children`、`Fn.toString()`、`Domain.fns` | 既存 | クラス所属のメソッド・コンストラクタを保持し、モジュール関数と区別する。名前・親子関係・元位置を保持する。 |
| 同上 | `ClassDefinition`・`KeywordArgument`の`children`・`toString()` | 第1段階で追加済み | クラス本体・キーワード引数の値を走査し、元位置とソース順を保持する。後続段階で意味解析・生成へ接続する。 |
| [diagram/ts/python/parser.ts](../../../diagram/ts/python/parser.ts) | `Parser.parseStatement()`、`parseBlock()`、`readFn()` | 既存 | `class`とその配下の`def`を解析し、`__init__`・`self`を後段へ渡す。通常関数とクラスの配置・入れ子の制約を確認する。 |
| 同上 | `Parser.readImport()`、`readModuleName()` | 既存 | 現在作成できるimportの構文木を再利用し、NumPyの別名を後段へ渡す。importの受理範囲を意味解析とそろえる。 |
| 同上 | `Parser.PrimaryExpression()`、`readComma()`、`parseAssignment()` | 既存 | `dtype=object`等の引数、`a[i, j]`、複数添字への代入を解析する。リストを実行可能な配列生成として受理しない。既存の単一添字・位置引数・式の括弧を維持する。 |
| 同上 | `Parser.readClass()`、`readCallArguments()` | 第1段階で追加済み | クラス宣言と、位置／キーワードを区別する呼出し引数を解析する。実行未対応の機能は意味解析が拒否する。 |
| 同上 | `parsePython()` | 既存・入口 | 新しいノードも`source`・`parent`・`charPos`を失わず返す。型の検査は引き続き意味解析に任せる。 |
| [diagram/ts/python/global-scope.ts](../../../diagram/ts/python/global-scope.ts) | `collectScopeGlobals()`内の`expression`・`statement` | 既存 | クラス本体と各メソッドのスコープを混ぜず、キーワード引数の値や添字の式を走査する。大域の本体参照はGCの根として扱う。 |
| [diagram/ts/python/lex.ts](../../../diagram/ts/python/lex.ts) | `lexicalAnalysis()`、`keywords`、`symbols` | 条件付き | `class`・`import`・`as`・`=`・`,`等は既存の字句で表現可能。新しい構文に字句の追加が必要な場合だけ変更する。クラス名用の新しいトークン型を安易に増やさない。 |

## 3. uroa：型・名前解決・GC用本体情報

| ファイル | 関数／メソッド・宣言 | 区分 | 変更内容 |
|---|---|---|---|
| [diagram/ts/python/semantic.ts](../../../diagram/ts/python/semantic.ts) | `PythonType`、`PythonVariable`、`PythonFunction`、`PythonBinding`、`PythonCall`、`PythonAnalysis` | 既存 | ユーザークラス、ndarray、dtype、次元数、実行時shape、object要素の型、メソッドとGC用フィールド情報を表す。所有フレームや寿命条件は追加しない。 |
| 同上 | `valueSlotTypes()` | 第3段階で変更済み | recordを含む全値を1スロットへ統一した。本体のサイズと値スロット数を分離する。 |
| 同上 | `sameType()`、`PythonResolver.typeName()`、`merge()`、`update()`、`compatible()` | 既存 | ndarrayのdtype・次元数・object要素クラス、`None`要素を判定する。実行時shapeの違いを、即座に別型として拒否しない。 |
| 同上 | `PythonResolver.reserved()`、`addVariable()`、`collect()`、`binding()`、`resolve()` | 既存 | クラス・メソッド・NumPy別名・dtype名を登録する。クラス所属ごとの名前を区別し、変数スロットを参照幅に合わせる。 |
| 同上 | `PythonResolver.owner()`、`field()`、`call()`、`nativeArguments()` | 既存 | ユーザークラスと機器クラスを区別し、self、NumPy、配列属性、引数、コンストラクタとGC本体生成を解決する。 |
| 同上 | `PythonResolver.registerClasses()`、`userArguments()` | 第3段階で追加済み | クラスID・固定フィールド名・Class.methodの関数名を登録し、selfを含む引数型を推論する。 |
| 同上 | `PythonNumpyCall`、`PythonArrayOperation`、`DeviceClass.array`、`PythonResolver.resolveModuleCall()`、`arrayItem()`、`truthExpression()` | 第4段階で追加・変更済み | dtype・rankと実行時shapeを分け、生成・添字・属性を解決する。配列全体の真偽変換を診断する。 |
| 同上 | `PythonResolver.canonicalOwner()`、`canonicalType()`、`merge()`、`normalizeArrays()`、`assignment()`、`resolve()` | 第5段階で追加・変更済み | object配列の要素型を推論し、変数・引数・戻り値の合流で型IDを統合する。自己・相互参照を再帰展開せず、生成前に全型参照を代表へそろえる。 |
| 同上 | `PythonResolver.operation()`、`expression()`、`assignment()` | 既存 | 添字・要素・lenと参照格納の型を検査する。通常関数の参照格納を許可し、リスト等の未対応操作は診断する。 |
| 同上 | `PythonResolver.statement()`、`block()`、`fallsThrough()`、`infer()` | 既存 | 再帰・相互再帰を含む型推論、return型、コンストラクタと通常メソッドの区別を扱う。本体内部の参照を寿命を理由に拒否しない。 |
| 同上 | `readType()`、`readCallable()`、`readDeviceApi()`、`loadDeviceApi()` | 既存 | ネイティブAPIの参照型・呼出し規約・ABI変更を検証する。ユーザークラスの型IDを機器クラスのIDと混同しない。 |
| 同上 | `resolvePython()`、`analyzePython()` | 既存・入口 | 型や未対応機能の診断を既存の一覧へ返す。診断があれば生成・送信を止める。 |
| [diagram/ts/python/module-api.ts](../../../diagram/ts/python/module-api.ts) | `readModuleDefinitions()`、`bindModuleArguments()`、`ModuleCallBinding` | 第1段階で追加済み | 生成JSONの型・引数番号を検証し、式を評価せずソース順の対応を作る。後続段階で型推論と実行命令へ接続する。 |

GC採用により、新規lifetime.tsとコンストラクタ所有先の解析は不要。型解析と本体の参照情報を生成する。

## 4. uroa：バイトコード生成

| ファイル | 関数／メソッド・宣言 | 区分 | 変更内容 |
|---|---|---|---|
| [diagram/ts/python/bytecode.ts](../../../diagram/ts/python/bytecode.ts) | `BytecodeOpcode`、`operandEncoding`、形式版・ヘッダー／関数／型レコード長の定数 | 第3段階で拡張済み | 本体生成・属性読書き・複製と本体型表を追加した。番号・長さ・形式版は同ソースのコメントを正本とする。配列命令は後続段階。 |
| 同上 | `Scope`、`AssemblyEntry`、`ValueAddress`、`SlotAllocation` | 既存 | 値スロットの住所とGC本体参照を区別する。通常関数／コンストラクタ、クラス所属、本体型を表現する。 |
| 同上 | `BytecodeGenerator.collectFunctions()` | 既存 | ユーザーメソッド・コンストラクタも収集する。局所・大域・クラスのフィールドを混同せず、関数を一意の名前とPCへ割り当てる。 |
| 同上 | `BytecodeGenerator.constructor()` | 既存 | `PythonAnalysis`を唯一の入力として型・未対応機能の診断を検査する。意味解析なしの旧経路は事前整理で削除済み。 |
| 同上 | `valueWidth()`、`loadValue()`、`storeValue()`、`temporary()`、`address()` | 既存 | recordの全葉コピーから、参照と本体アクセスを区別する処理へ変更する。属性の固定スロット加算を見直す。一時参照が生存中の本体を再利用・解放しない。 |
| 同上 | `expressionAs()`、`typedCall()`、`typedExpression()`、`typedAssignment()` | 既存 | オブジェクト生成、メソッドの`self`、NumPy呼出し、dtype・shape、添字アクセスを生成する。右辺・対象・添字の評価順と1回だけの評価を守る。 |
| 同上 | `typedNumpy()`、`typedArray()` | 第4段階で追加済み | 評価済み引数を一時スロットから指定順に積み直し、CALL_NUMPYと要素・属性命令を出す。省略引数を追加しない。 |
| 同上 | `statement()`、`compileTyped()` | 既存 | CALL／RETとGC本体生成を接続し、戻り値参照を共有する。クラス宣言・NumPy import自体は実行文として出力しない。 |
| 同上 | `format()`、`formatAssembly()` | 既存 | 型・本体配置・新命令・メソッド名・呼出し規約をアセンブリで確認できるようにする。 |
| 同上 | `instructionLength()`、`addressOperand()`、`encodeBinary()` | 既存 | 新命令と新しい型／クラス情報を符号化し、PC・長さ・オペランド上限を検証する。文字列・関数表の位置計算も更新する。 |
| 同上 | `generateDebugBytecode()`、公開関数`generateAssembly()`・`generateBytecode()`・`generateDebugBytecode()` | 既存 | 同一コンパイルのクラス・配列型・変数配置・最終PCをデバッグ情報へ渡す。文開始・関数入口・暗黙returnの停止点を維持する。 |

## 5. ネイティブAPI定義・生成物

第1段階で`device.pyi`へNumPyの宣言を追加した。機器クラスと組込みモジュールを区別し、共通の宣言からJSONとC++の引数番号を生成する。モジュール関数の実行登録は後続段階で行う。ユーザーが書くクラス本体を、機器スタブ生成器へ渡す設計にはしない。

| ファイル | 関数／メソッド・宣言 | 区分 | 変更内容 |
|---|---|---|---|
| [diagram/python/module_api.py](../../../diagram/python/module_api.py) | `ModuleParser.parse()`、`function()`、`type_name()` | 第1段階で追加済み | 組込みモジュールの型・関数・必須引数・optionIdを構築する。実行対応する型と関数を追加する際も、この定義から共有する。 |
| [diagram/python/generate-device-api.py](../../../diagram/python/generate-device-api.py) | `InterfaceParser.read_type()`、`read_callable()`、`read_class()`、`parse()`、`main()` | 第3段階で拡張済み | recordの参照化と文字列保持に伴う共通版・ABIを更新した。 |
| [diagram/python/device_api_cpp.py](../../../diagram/python/device_api_cpp.py) | `CppGenerator.module_enums()`、`record()`、`cpp_type()`、`record_helpers()`、`arguments()`、`result_type()`、`generate()`、`generate_cpp()` | 第3段階で拡張済み | leaves()を削除し、GC本体とC++ recordの変換を生成する。HeapRootの生成は削除済み。 |
| [diagram/python/device.pyi](../../../diagram/python/device.pyi) | `numpy`・`zeros()`・`empty()`・`object_`、`Vec3`・`IMUValue`等のrecord宣言 | 第1〜5段階で拡張済み | NumPy名前空間・共有シグネチャ・object_のdtype宣言を生成定義へ接続した。 |
| [public/diagram/device/device-api.json](../../../public/diagram/device/device-api.json) | `schemaVersion`、`callingConventionVersion`、`abiHash`、型・呼出し情報 | 再生成 | 生成元から更新する。JSONを手編集しない。 |
| [ESP32/include/device_api.generated.h](../../../../esp32/app/diagram-control/include/device_api.generated.h) | `device_api::Vec3`、`IMUValue`、`Backend`、`makeNativeApi()` | 第3段階で再生成済み | C++側のrecord値型・Backend署名を維持した。直接編集しない。 |
| [ESP32/src/device_api.generated.cpp](../../../../esp32/app/diagram-control/src/device_api.generated.cpp) | `read_*()`、`write_*()`、`invoke_IMU_get_value()`、`entries`、`abiHash`、`makeNativeApi()`ほか生成スタブ | 第3段階で再生成済み | IMUValueを入れ子のGC本体へ変換し、戻り値を参照1スロットにした。直接編集しない。 |

## 6. ESP32：値・GC本体と実行

この節のESP32パスはすべて`D:\usr\prj\esp32\app\diagram-control`を基準とする。

| ファイル | 関数／メソッド・宣言 | 区分 | 変更内容 |
|---|---|---|---|
| [include/bytecode_vm.h](../../../../esp32/app/diagram-control/include/bytecode_vm.h) | `BytecodeVM::Type`、`Value` | 第2〜3段階で拡張済み | 機器ハンドルとGC本体ポインターを区別する。C++の根・GC統計は削除した。 |
| 同上 | `NativeCall`、`NativeEntry`、`NativeApi` | 第2段階で契約を拡張 | C++確保APIを使う。同期構築を完了して結果をVMへ返し、C++側へGC対象の参照を持ち越さない。 |
| [src/bytecode_vm.cpp](../../../../esp32/app/diagram-control/src/bytecode_vm.cpp) | `BytecodeVM::start()`、`stop()`、`bindNativeApi()` | 第2〜3段階で拡張済み | Stop・再開始で根を失効させ全本体を解放し、共通形式検証済みの本体型表を借用する。 |
| 同上 | `BytecodeVM::call()`、`ret()` | 第3段階まで接続済み | 局所スロットを根から外し、Pythonの戻り値参照を共有する。本体のコピー・所有先変更は不要。 |
| 同上 | `BytecodeVM::step()` | 既存 | 本体確保、属性、添字、dtype別の読書き、配列長、コンストラクタ用命令等を実行する。`None`要素のメンバー参照、添字範囲、未初期化フィールド、バイト数計算のoverflowを検査する。 |
| 同上 | `BytecodeVM::validValue()`、`truth()`、`calculate()` | 既存 | VM参照と機器ハンドルを区別して検査する。配列・オブジェクトを数値として扱わず、未対応の演算を明示的に拒否する。 |
| 同上 | `BytecodeVM::push()`、`pop()` | 条件付き | 参照1個のpush／popでは本体を解放しない。現在の固定スロット・一時値下限の方式を利用できるか確認する。 |
| 同上 | `BytecodeVM::callNative()` | 第2段階で拡張済み | コールバック中にはGCを行わない。成功・待機・失敗のすべてでC++の結果領域を消去する。 |
| 同上 | `BytecodeVM::allocateText()`、`firstDebugString()`、`debugValueCount()`、`debugValueAt()` | 第3段階で拡張済み | 文字列の回収をGC_LOOPだけに限定し、Snapshotは大域・値スタックの直接の文字列だけを含める。 |
| 同上 | `BytecodeVM::heapFields()`、`fieldValue()` | 第3段階で追加済み | 型表・本体・フィールド値を照合し、属性操作と生成スタブの変換を検査する。 |
| [include/bytecode_heap.h](../../../../esp32/app/diagram-control/include/bytecode_heap.h)・[src/bytecode_heap.cpp](../../../../esp32/app/diagram-control/src/bytecode_heap.cpp) | `BytecodeHeap::Block`、`blocks`、`allocate()`、`contains()`、`sweep()`、`clear()` | 第2〜4段階で拡張済み／探索を簡略化済み | 確保一覧・確保・到達不能本体のスイープ・全解放。本体種別で通常オブジェクトと配列を区別する。 |
| VMヘッダー・実装 | `allocateHeapValue()`、`markValues()`、`collectHeap()` | 第2段階で追加済み | メインループの安全な位置だけで、大域とメインの局所値から本体先頭のValue列を再帰探索する。 |
| [include/numpy_native.h](../../../../esp32/app/diagram-control/include/numpy_native.h)・[src/numpy_native.cpp](../../../../esp32/app/diagram-control/src/numpy_native.cpp) | `numpy_native::Option`、`create()`、`item()`、`attribute()` | 第4段階で追加済み | 共有enumの関数ID・引数番号でzeros/emptyを実行する。既定値・対応オプション・数値変換・添字をC++で扱う。 |
| VMヘッダー・実装 | `Array`、`allocateArray()`、`arrayData()`、`arrayElementValue()`、`callNumpy()`、`arrayItem()`、`arrayAttribute()` | 第4〜5段階で追加・変更済み | 数値本体のサイズ・型・shapeを検証し、object配列のValue要素列をNoneで初期化してGCへ接続する。数値データは探索しない。旧NumericArray系の名前は共通名へ変更した。 |
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
| 同上＋[include/bytecode_debugger.h](../../../../esp32/app/diagram-control/include/bytecode_debugger.h) | `BytecodeDebugger::publishState()`、`handle()`、Snapshot保持メンバー | 既存／一部条件付き | 値スロットと文字列のSnapshot長・上限・取得失敗を扱い、Pausedの同じ停止状態から取得する。 |
| [ESP32/src/bytecode_vm.cpp](../../../../esp32/app/diagram-control/src/bytecode_vm.cpp) | `configureDebugPoints()`、`debugSnapshotLength()`、`copyDebugSnapshot()` | 第3段階で拡張済み | GC参照はclassIdだけを送り、メンバーや配列を列挙しない。 |
| [diagram/ts/ble-wifi/debug-protocol.ts](../../../diagram/ts/ble-wifi/debug-protocol.ts) | `DebugValue`、`DebugSnapshot`、`decodeSnapshot()`、`debugProtocol` | 既存 | 値タグ・スロット・文字列を復号し、GC参照の不透明な表現を検証する。Snapshot形式版と上限をC++側とそろえる。Control／Eventまで無条件に版変更しない。 |
| 同上 | `PythonDebugTransport.download()`、`accept()`、`invalidateSnapshot()` | 条件付き | 既存のチャンク受信・CRC・世代照合で新Snapshotを扱えるか確認する。必要な箇所だけ変更する。 |
| [diagram/ts/python/debug-info.ts](../../../diagram/ts/python/debug-info.ts) | `PythonDebugFunction`、`PythonDebugInfo` | 既存 | API表だけでなくユーザークラス・ndarray型、メソッド名・所属と参照スロットを表示できる情報を追加する。 |
| [diagram/ts/python/debugger-view.ts](../../../diagram/ts/python/debugger-view.ts) | `restoreFrames()`、`PythonDebuggerView.show()`、`value()`、`variables()`、`variable()` | 第3〜5段階で拡張済み | 既存のフレーム・スカラー・文字列と参照のclassIdを表示する。本体の展開は削除した。 |

## 8. 既存入口・UIの確認箇所

以下は変更の波及先であり、すべての本体を必ず書き換えるという意味ではない。

| ファイル | 関数／メソッド | 変更・確認内容 |
|---|---|---|
| [diagram/ts/python/python-block.ts](../../../diagram/ts/python/python-block.ts) | `PythonBlock.checkSource()`、`check()`、`start()`、`executeDebug()`、`replaceSource()` | 新しい意味診断・DebugInfo・Snapshotが共通入口から扱えることを確認する。ソース保存形式の変更は不要。 |
| [diagram/ts/ble-wifi/device-connection.ts](../../../diagram/ts/ble-wifi/device-connection.ts) | `DeviceConnection.sendBytecode()`、`publishDebug()`、`sendBreakpoints()`、`observeDeployment()` | ブロック以外の送信入口でも新しい形式検証と診断表示を利用する。生の転送データを変換する処理を重複実装しない。 |
| [diagram/ts/python/editor-diagnostics.ts](../../../diagram/ts/python/editor-diagnostics.ts) | `semanticEditorDiagnostic()`、`syntaxEditorDiagnostic()` | 新しいノードや型違反でも、元のソース位置を表示できることを確認する。 |
| [diagram/ts/python/highlight-editor.ts](../../../diagram/ts/python/highlight-editor.ts) | `highlightTokens()`、`PythonHighlightEditor.setDiagnostics()`、`refresh()`、`toggleBreakpoint()` | 必要ならNumPy・dtype名の色分けを追加する。F9トグルと、ソース変更時のブレークポイント全解除を維持する。 |


## 9. 実装後に残る事項

全5段階の実装は接続済み。object要素型・配列要素・None初期化とSnapshotの扱いはソースコメントを参照する。GC簡略化を追加した。残る実運用上の事項は確保上限の調整と、実機の処理時間・メモリー量・60fps成立の確認。イテレーター・yield・マルチスレッド等は第1〜5段階の対象外とする。

## 10. GC採用後の段階別修正内容

以下は全5段階で行った作業の履歴。GC・Snapshotの現在の変更先は第1・6・7節を参照する。各段階で修正内容を提示して停止し、ユーザーが確認・commit・pushした後に次へ進む。旧6段階の所有管理・寿命解析・戻り値移送は撤回した。

### 第1段階：共通定義・構文解析（実装済み）

対象：syntax.ts、parser.ts、global-scope.ts、semantic.ts、module-api.ts、device.pyi、API生成器と生成JSON／C++。

- クラス・キーワード引数・複数添字を構文木へ追加する。
- NumPyの名前解決、引数番号対応、共通宣言生成を実装する。
- 実行未対応のクラス・NumPy呼出しを意味診断で拒否する。

完了条件：共通定義と構文解析を既存入口へ接続し、指定ビルド・生成物確認が成功する。実装と確認は完了済み。

### 第2段階：ヒープ管理・GC基盤（実装済み）

対象：bytecode_heap.h/.cpp、bytecode_vm.h/.cpp。

- malloc/freeを使う本体管理、上限・整列・サイズ検査を追加する。
- 本体を移動せず、追加確保を行わないマーク＆スイープを実装する。実装後に浅い参照構造を前提とする再帰探索へ変更し、pendingを削除した。
- 当初は値スタック・大域・ネイティブ結果・HeapRootを根として接続した。後述のGC簡略化で変更した。
- 当初は命令境界のGC要求と確保失敗時の回収・再試行を追加した。GC簡略化で削除した。
- Stop・再開始で全解放し、Paused・Halted・Errorの診断値は保持する。使用量・GC時間・回収数を記録する。
- 既存形式とABIを維持し、新しい参照をSnapshotで未対応として拒否する。Pythonの生成命令・型表・文字列フィールドは後続段階。

完了条件：共通の確保・回収・根登録・停止時解放をVMへ接続し、指定環境でビルドできる。テスト・実機GC動作・処理時間は未確認とする。

### 第3段階：オブジェクト・コンストラクタ・メソッド（実装済み）

対象：semantic.ts、bytecode.ts、VM、API生成器、debug-info.ts、debugger-view.ts、関連する形式・Snapshot検証。

- ユーザークラス型、フィールド配置、self、__init__、メソッド、本体生成・属性読書きを実装する。
- 通常関数からのメンバー格納と、引数・戻り値の参照共有を許可する。
- 構築途中・ネイティブ変換中の本体を根として保持する。
- 既存recordを本体参照へ統合し、C++変換と本体内文字列の寿命を整える。
- 型表・命令・ABI・双方の検証を更新し、入れ子・共有・循環を含むSnapshotと表示を追加する。

完了条件：配列以外の本体生成、メンバー・メソッド・引数・戻り値の共有を実装へ接続した。所有フレーム・寿命解析は追加しない。型・公開ビルド・生成物一致と指定ESP32環境のビルドを確認し、テスト・VM実行・実機は未確認。

### 第4段階：数値NumPy配列（実装済み）

対象：NumPy定義・生成器、意味解析・コード生成、VM、新規numpy_native.h/.cpp、共通形式検証、配列のデバッグ表示。

- zeros・empty、float32・uint8、実行時shape、添字・属性・lenの対応範囲を実装する。
- 引数番号と値のペアをC++へ渡し、既定値をC++で設定する。
- 数値バイト列をGC探索から除外し、型・範囲・サイズ計算を検査する。
- 通常関数・メンバー・引数・戻り値で配列を共有し、Snapshotと表示を追加する。

完了条件：実行時サイズの数値配列を、コンストラクタ以外でも生成・メンバー格納・返却する実装へ接続する。ビルド・生成物の確認結果は両リポジトリーの検証記録を参照し、実行確認とは区別する。

### 第5段階：object配列（実装済み）

対象：device.pyiと生成器、module-api.ts、意味解析・コード生成、NumPy C++処理、VM、デバッガー。

- np.empty(n, dtype=object)、None初期化、要素型推論・整合性検査を実装する。
- 通常関数で生成した本体を要素へ格納できるようにする。
- 要素参照からGCが本体をたどり、オブジェクトと配列の相互参照・循環も扱える構造にする。
- Noneアクセスの診断、共有・循環を含むSnapshotと表示を整える。

完了条件：数値配列とobject配列を区別し、入れ子・共有・循環を含む参照構造をGC・型検査・Snapshotへ接続した。実装・生成物・ビルドの確認と、未実施の実行確認は両リポジトリーの検証記録で区別する。

### GC簡略化（2026-11-25）

コンパイラーの回収点選定・GC_LOOPと根の範囲を追加し、VMの再帰マークとヒープのスイープに整理した。C++の根登録、確保失敗時のGC・再試行、GC統計、本体IDと本体のSnapshot転送・表示を削除した。詳細な規則は[bytecode.ts](../../../diagram/ts/python/bytecode.ts)と[bytecode_vm.cpp](../../../../esp32/app/diagram-control/src/bytecode_vm.cpp)の仕様コメントを参照する。

### 共通の作業・確認条件

- 新規・変更コードは[coding-style.md](../../coding-style.md)に従い、仕様・引数・戻り値等をソースの文書コメントへ記載する。
- 形式変更時は命令PC・転送検証・Snapshot・デバッガーを同じ段階で更新する。
- API生成を変更したらJSONとC++を同時再生成し、--checkで確認する。ABI変更時はWebとファームウェアをそろえ、バイトコードを再生成・再送信する。
- ESP32のビルドはsupermini_esp32s3のみ。platformio.iniのdefault_envsを確認する。各段階で止め、ユーザーが確認・commit・pushする。
- テストは作成・実行しない。生成物・ビルド・ソース確認と、ブラウザー・通信・VM実行・実機確認を区別する。
- コマンドと結果は[uroa](../../build-and-test.md)・[ESP32](../../../../esp32/docs/build-and-test.md)の記録を参照する。第5段階はWeb・C++・生成APIを同時更新する。
