# ESP32向けPython VMの字句・構文解析

[lex.ts](../../../diagram/ts/python/lex.ts)の`lexicalAnalysis(text: string): Token[]`は、Pythonサブセットのソース文字列から[共通のToken](../../../parser/ts/lex.ts)の配列を作る。[parser.ts](../../../diagram/ts/python/parser.ts)はその配列からPython用の構文木を作る。構文木はPythonソースの再生成に加え、[bytecode.ts](../../../diagram/ts/python/bytecode.ts)の`generateAssembly(module: Module): string`と`generateBytecode(module: Module): Uint8Array`へ渡せる。生成の対応範囲・バイナリ形式・関数フレーム契約は[バイトコード仕様](bytecode.md)を参照する。ESP32への送信・形式検証・RAM保持は[BLE／Wi-Fi転送](../../../diagram/ts/ble-wifi/bytecode-transfer.ts)で行い、ESP32のVMで数値・分岐・関数呼出しを実行する。

## 字句解析の対応範囲

- ASCII英字・`_`で始まる識別子、後続のASCII英数字・`_`。予約語は`reservedWord`、組み込み関数名や`match`・`case`等は`identifier`とする。
- 10進整数、小数、指数表記。符号は別の`symbol`とし、数値の`subType`は`integer`または`float`とする。基数接頭辞・桁区切りの`_`・虚数は未対応。
- Pythonの通常の演算子・区切り記号。複数文字の記号は最長一致で読み取る。記号を認識することは、構文解析やVMがその演算・構文を実装していることを意味しない。
- `"`または`'`で囲む通常文字列。引用符を除いた内容を`String`型の`text`へ入れる。エスケープされた引用符を終端とみなさず、エスケープ自体は原文のまま残す。値への変換は後段の担当とする。三重引用符、raw・bytes・f-string等の接頭辞付き文字列は未対応として拒否する。
- `#`から行末までのコメントは読み飛ばす。LF・CRLF・CRは論理行末の`newLine`（`text`は`\n`）として扱う。空行・コメントだけの行はトークンを出さない。
- 行頭の空白からインデントを判定し、`symbol`型の`INDENT`・`DEDENT`を出す。タブは8桁のタブストップで数える。括弧内の改行・インデントは無視し、バックスラッシュ直後の改行も行継続として読み飛ばす。

## 字句解析の出力とエラー

`Token.charPos`は入力string中の0始まりのUTF-16位置。`INDENT`・`DEDENT`は次の有効行の最初の文字位置を指す。末尾改行がない有効行には`newLine`を補い、残りの`DEDENT`も入力末尾の位置で補う。共通の字句解析と同様、`eot`は付けない。

未対応文字・不正な数値・閉じていない文字列や括弧・不一致の閉じ括弧・以前の段に一致しないインデントは、`charPos`を含む`SyntaxError`を投げる。構文の正しさは構文解析、VMで実行できるかの判定は後段で行う。

## 構文解析のAPIと対応範囲

入口は`parsePython(text: string): Module`。既に字句解析した配列には`new Parser(tokens, tokenPos = 0).parseSource()`を使う。WebGPUの[Parser](../../../webgpu/ts/parser.ts)を参考にした再帰下降解析で、Pythonの改行とINDENT／DEDENTを保持する。エラーは現在のTokenの`charPos`を含む`SyntaxError`とする。

`parsePython()`は返すModuleの`source`に入力文字列を保持する。アセンブリ生成時の行番号・原文コメントに使い、`toString()`のキャッシュとは分ける。Token配列だけから`Parser.parseSource()`を呼ぶ場合は元ソースを持たず、`source`はundefinedとなる。構文木を手動変更した場合の原文・位置の追従は行わない。

- 式文、単一の変数・属性・添字への代入と複合代入。
- `if`／`elif`／`else`、`while`、単一の変数を束縛先にする`for ... in ...`、`break`／`continue`／`pass`。
- 通常の位置引数だけを持つ`def`、関数内の`return`。関数の入れ子を許可し、内側の関数から外側のループへの`break`／`continue`は拒否する。
- `import module`、`from module import name`、複数名と`as`別名。モジュール名のドットと、from形式の名前一覧を囲む括弧・末尾カンマも扱う。
- 数値、文字列、`True`／`False`／`None`、リスト、括弧で囲む式・タプル、位置引数による関数呼出し、属性参照、単一の添字アクセス。
- 四則・`//`・`%`・`**`、単項`+`／`-`／`~`、シフト・ビット演算、比較・連鎖比較・`in`／`not in`／`is`／`is not`、`not`／`and`／`or`。Pythonの優先順位と結合方向を保持する。
- コロン直後の単一の単純文、または改行・インデントによるブロック。各論理行は1文とし、空ブロックには`pass`を使う。

クラス、例外処理、非同期処理、ジェネレータ、`global`／`nonlocal`、型注釈、デフォルト引数・キーワード引数・可変長引数、分割・連鎖代入、辞書・集合・内包表記、スライス、括弧のないタプル、条件式、セミコロンによる複数文、ループの`else`、相対・ワイルドカードimportは未対応。記号が字句解析できても、これらを構文解析できるとは扱わない。

## Python用構文木

[syntax.ts](../../../diagram/ts/python/syntax.ts)にPython専用クラスを定義する。WebGPU側の[syntax.ts](../../../webgpu/ts/syntax.ts)と同じクラス名を使い、GPU用クラスへの依存は持たない。Pythonで不要な型・シェーダー・バッファ用クラスは作らない。

| クラス・表現 | 内容 |
|---|---|
| `Module`／`Domain` | `block.statements`にトップレベルの文と関数定義を実行順で保持。`fns`は直下の関数定義への参照 |
| `AbstractSyntaxNode` | ソース位置`charPos`、`parent`、`children`、`getAll()`、祖先の取得。`parseSource()`完了時に全ノードの親を設定 |
| `Term`／`ConstNum`／`Str`／`RefVar` | 式、数値、文字列、名前参照。`True`／`False`／`None`は予約された名前参照。文字列エスケープは未解釈のまま保持 |
| `App` | `fnc: RefVar`と`args: Term[]`。演算子名は元の記号・キーワード。単項演算は引数1個、二項演算は2個 |
| `App`の`<compare>` | `args`に比較対象を順に保持し、`comparisonOperators`に対象間の演算子を保持。中間値を複製せず、連鎖比較を1度ずつ評価できる形にする |
| `App`の`()`／`.`／`t[i]`／`[]`／`,` | 式を関数とする呼出し、属性、添字、リスト、タプル。通常の名前による呼出しはその名前を`fnc`に保持 |
| `Statement` | 文の基底。`keyword`で`pass`／`break`／`continue`／`import`を表す。importの`imports`は名前と別名、`moduleName`はfrom形式の取込元 |
| `CallStatement` | `app`に式文または代入の`App`を保持。一般の式文も扱うため`app`の型は`Term` |
| `ReturnStatement`／`BlockStatement` | 戻り値（省略可能）、ソース順の文列 |
| `IfStatement`／`WhileStatement` | `condition`とブロック。elifは`elseIf`、elseは`elseBlock` |
| `ForStatement` | `initializer: Variable`に単一の束縛先、`list: Term`に反復対象、`block`に本体 |
| `Variable`／`Fn` | 仮引数・forの束縛先、関数名・仮引数列・本体。`Fn`は文として定義位置を保持 |

Pythonの変数は代入で束縛するため、代入を宣言文へ置き換えたり、ブロックごとの変数スコープを作ったりしない。名前の静的な解決・数値リテラルの範囲検査はアセンブリ生成器が担当する。クロージャ、実行時の型・値の検査、文字列エスケープの解釈、importするモジュールの提供、短絡評価・連鎖比較の実行、組み込み関数や機器APIは今後の対応とする。`range`・`Pin`等の呼出しを解析できても、生成器が受理することやESP32で実行できることは意味しない。

```typescript
import { parsePython } from "./python/parser.js";

const module = parsePython("for i in range(3):\n    print(i)\n");
const statements = module.block.statements;
```

## toStringによるPythonソース生成

各ノードの`toString()`は、`_str`が`undefined`のときだけPythonソースを生成して保存し、以降は保存済みの文字列を返す。`Module`は`Domain`の実装を継承する。構文木を変更してもキャッシュは自動無効化しないため、生成後に内容を変える場合は新しい構文木を作る。

式のキャッシュは親に依存しないソースとし、親の演算で使う位置に応じて括弧を補う。優先順位だけでなく結合方向も考慮し、`a - (b - c)`、`(a ** b) ** c`、`a ** b ** c`、`(-a) ** b`、`-a ** b`を区別する。同じ順位の右部分木も、浮動小数点等の計算順が変わらないように保持する。比較式の中に比較式がある場合は括弧を付け、連鎖比較へ混ざらないようにする。

関数・条件分岐・ループの本体は4スペースで字下げし、`elif`／`else`を生成する。空の本体には`pass`を補う。ブロック単体のキャッシュには先頭の字下げを含めず、親の本体として埋め込む際に字下げする。モジュール全体は空でなければ末尾に改行を付ける。

文字列は二重引用符で囲み、元のエスケープを保持して、追加で必要な引用符・制御文字をエスケープする。文字列内のバックスラッシュによる物理行継続は除去し、値を変えずに1行へ整える。コメント、元の引用符・空白・冗長な括弧等の表記は復元しない。

ユーザー指定によりテストは作成・実行しない。
