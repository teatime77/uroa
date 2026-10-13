# diagramの構造体ポートと式評価の設計案

作成日: 2026-10-12（日本時間）。ユーザー指定の要件と現行ソースに基づく設計案。下記の実装状況以外の式評価・型推論等は提案で、実装済みとは扱わない。

diagram全体の現行機能とブロック追加の実装手順は [diagram実装ガイド](diagram-implementation.md) を参照する。この文書は構造体・式評価の設計と未実装の後続案を扱う。

## 初回実装（2026-10-12）

data_type.tsへ既存の型定義クラスを移し、vec3・IMUを登録した。Port.dataTypeとStructPortの入れ子検証・複製・freeze・型の接続検査、固定型参照の保存復元を実装した。既存Port.valueのanyは旧ブロックとの互換のため維持し、StructPort.valueをStructValueで型付けした。型未指定ポートの型推論はまだ行わない。

imu.tsにIMUBlockを追加し、BLEから10Hzで取得するgyro・accを1つの構造体ポートへ出力してconsoleへ表示する。複数ブロックは計測を共有し、削除・切断時に購読と値を解除する。CalcBlock・CompareBlockは既存のスカラー評価を維持し、誤って構造体を数値式へ接続しないよう現在の端子をNumberPortで指定した。TypedValue評価・生成式・構造体のCalcBlock対応・ユーザー定義型UIは後続作業。

## 有効型参照とPlotBlockの追加（2026-10-12）

Port.getDataType()が明示型または単一接続元の型を取得し、subscribeConnectionsが接続・解除後の両端へ通知する。型参照はキャッシュせず、解除後に旧型を残さない。接続元が複数または循環する場合は未確定とする。これは接続元の参照であり、CalcBlockの式の型推論ではない。

PlotBlockはIMUValue・imuStructを参照せず、DataType.structとStruct.membersをたどって数値Fieldを列挙する。直接の数値Fieldを1パネルにまとめ、入れ子のStructを横に並べる。IMUはgyro・accの2パネルになる。Fieldの単位情報はユーザー指定により後続対応。Plotly.jsでの2D時系列表示、直近30秒の履歴、1秒ごとの平均・母標準偏差と3σの範囲、保存復元・削除時の後片付けを実装した。

## 要件と優先順位

- 複数測定値を1本の接続線で渡す構造体入出力は必須。IMUBlockの外部出力を6個の数値ポートに固定しない。
- diagramの既存Struct・Field・DataTypeを型定義の基礎にする。構造体の定義と、計測で得た値を分ける。
- CalcBlockの式で構造体・フィールドの参照、数値計算、構造体の生成を扱う。if文・whileループは追加しない。
- 汎用構造体・計算の完成は2026-10-16のデモに必須ではない。ただしIMU取得・グラフ・今後のポート変更はこの設計を前提にする。

対象の構造体は次のとおり。時刻・受信番号を必要とする場合も、このIMU定義に勝手にフィールドを追加せず、サンプルの付加情報として別に扱う。

```text
struct vec3 { x: number; y: number; z: number; }
struct IMU { gyro: vec3; acc: vec3; }
```

## 現行ソースと制約

- 設計時はindex.tsにVariable、Field、Struct、DataTypeがあり、Structはmembers、Fieldはname・type・parent、DataTypeはtypeName・dimensionsを持つだけだった。初回実装で [data_type.ts](../diagram/ts/data_type.ts)へ移し、index.tsは再exportする。
- [port.ts](../diagram/ts/port.ts)のPort.valueはanyを維持する。fitPortTypeは接続方向と指定済みのデータ型を比較する。setPortValueは型が指定されていれば検証してから接続先へ伝播し、その場でvalueChangedを呼ぶ。
- [block.ts](../diagram/ts/block.ts)のmakeInputValueMapは数値のみ許容する。calcTermはMap<string, number>からnumberを返す。CalcBlockはbなど単一の出力名を左辺とする式を評価する。
- [parser.ts](../parser/ts/parser.ts)は既にドット参照をApp(".", [RefVar("a"), RefVar("gyro"), RefVar("x")])として解析する。関数呼出しの形でvec3(...)やIMU(...)も解析できる。
- 現行parser/lib/parser.jsでb = a.gyro.x、b = a.gyro、b = vec3(a.acc.x, a.acc.y, a.acc.z)、b = IMU(a.gyro, a.acc)のASTを確認した。構造体として評価できることを確認したわけではない。lexerのSymbolTableに単独のドットがなく、ドットの不明トークンログが出る点は実装時に確認する。

## 型定義と実データ

初回実装でVariable、Field、Struct、DataTypeをdiagram/ts/data_type.tsへ移した。index.tsからPort・CalcBlockへ実行時importするとUI初期化側への循環参照を増やすため、型定義モジュールはUI・BLE・ブロックへ依存させない。index.tsに互換用の再exportを残した。

既存クラスを次のように利用する。

| クラス | 役割・追加する情報 |
|---|---|
| Struct | 型の登録名とmembers。例: vec3、IMU |
| Field | フィールド名、DataType、所属Struct。例: IMU.gyroの型はvec3 |
| DataType | 値の型。typeNameから組込型または登録Structを解決。dimensionsは初期段階では空配列で、配列対応は後続 |
| 型の登録表 | 登録名からStructを解決し、フィールド検索・型の互換性・値検証を行う |

型の一致はJavaScriptのオブジェクト同一性で判断しない。同じ登録名と整合する定義を参照するDataType同士を一致とし、異なる名前の構造体を自動変換しない。初期段階では再帰的な構造体・配列は扱わず、有限の入れ子構造とする。

値はStructのインスタンスやJSON文字列ではなく、フィールド名を持つJavaScriptオブジェクトで保持する。

```ts
// StructValue・DataValueは初回実装済み。TypedValueは後続の設計。
type StructValue = { readonly [field: string]: DataValue };
type DataValue = number | string | StructValue;
type TypedValue = { dataType: DataType; value: DataValue };
```

IMUの値の例:

```ts
{
  gyro: { x: 0.1, y: 0.2, z: 0.3 },
  acc:  { x: 0.0, y: 0.0, z: 9.80665 }
}
```

この値を持つポートのDataTypeはIMU。未取得はundefinedで、全項目0の正常サンプルとは区別する。角速度は°/s、加速度はm/s²として、UI・グラフに単位を表示する。型定義・各フィールドの値・単位表示は別の責任にする。

## Portへの接続

PortTypeは入出力・手続き・条件などの接続方向を表す既存enumのまま維持し、値の型としてPort.dataTypeを追加する。

```ts
// 設計用の抜粋
class Port {
  dataType?: DataType;
  value?: DataValue;
}
```

NumberPort、TextPortはnumber、stringの型を指定する既存の便利クラスとして残す。構造体は同じPortにDataType("IMU")やDataType("vec3")を指定して渡せるようにする。ConditionGate等の既存0/1の扱いは、今回booleanへ変更しない。

接続では方向と値の型を別々に検査する。IMU出力からIMU入力への接続は許可し、number専用入力への直接接続は拒否する。CalcBlockの入力型は接続元から受け取り、右辺式の型から出力型を決める。接続解除・式変更で型を再計算し、既存配線が不適合になったらブロックに理由を表示して計算を止める。

既存の型未指定ポートは未確定として段階的に対応する。型が未確定なだけで旧教材の読込を拒否せず、数値専用処理へ入る時点では既存どおり検証する。

IMUは1回のBLE通知を完全なIMUオブジェクトへ変換し、検証後に1回だけ出力ポートへ設定する。受信のたびに新しい値を作り、伝播後にgyro.xなどを変更しない。接続先間で同じオブジェクトを共有しても値が変わらないように、深い読み取り専用の扱いまたは入口での複製・freezeを行う。

ポートには型名と短い値の要約を描画する。全フィールドの値や候補一覧は詳細表示に出し、[object Object]や長いJSONをキャンバスへそのまま描かない。

## CalcBlockとcalcTerm

式の型検査と実データの評価を分ける。計測値がまだなくても、入力ポートの型が分かればa.gyro.xがnumber、a.gyroがvec3であることを判断できる。

```ts
// 設計用のシグネチャ
inferTermType(inputs: Map<string, DataType>, term: Term): DataType;
calcTerm(inputs: Map<string, TypedValue>, term: Term): TypedValue;
```

makeInputValueMapもTypedValueの環境を作る処理へ変更する。最終的にPort.valueへ設定するのは結果のvalueで、結果のdataTypeはポートの型へ反映する。

| 式 | 入力aの型 | 出力bの型・意味 |
|---|---|---|
| b = a | IMU | IMUの値をそのまま渡す |
| b = a.gyro | IMU | vec3を取り出す |
| b = a.gyro.x | IMU | numberを取り出す |
| b = 2 * a.acc.x + a.acc.y | IMU | フィールドを使う数値計算 |
| b = vec3(a.acc.x, a.acc.y, a.acc.z) | IMU | vec3を生成する |
| b = IMU(a.gyro, vec3(2*a.acc.x, 2*a.acc.y, 2*a.acc.z)) | IMU | 計算結果を入れた新しいIMUを生成する |

ドット参照は、通常の演算引数を評価する前に特別扱いする。先頭のaだけを入力環境で解決し、以降のgyro・xはStruct.membersのフィールド名として順に解決する。gyroやxを独立した変数として入力環境から探さない。登録されていないフィールドへのアクセスは拒否する。

vec3(...)、IMU(...)は登録Structの生成式として扱う。引数の個数・型をmembersの順序と照合し、フィールド名を持つ新しい値を作る。初版はb = 式という1つの出力値の代入に留める。b.gyro.x = ...のような部分更新や複数文を導入せず、完成した出力を1回だけ発行する。

加減乗除等は最初は数値に限定する。IMU+1や、任意のStruct全体を自動で要素ごとに加算する意味は定義しない。vec3同士の加算・スカラー倍を追加する場合はvec3用の演算規則として後続で明示する。構造体の計算結果は、上記のフィールド計算と生成式で表現できる。

現在のパーサーは単項マイナス等をTerm.valueの係数として表す。評価結果がnumberならこの係数を適用し、構造体に係数が付いた場合は未定義演算として拒否する。既存calcTermのRefVar分岐が係数適用より先にreturnする点も、共通化時に負数・係数の回帰確認へ含める。

CompareBlockも同じ評価処理を使い、a.acc.z < 数値のような数値比較を扱えるようにする。構造体全体の大小比較は認めず、出力は従来の0/1にする。フィールド未定義・型違い・未取得時に古い出力を正常値として流し続けない。

## 保存・復元と共有パーサー

Portの型参照とCalcBlockの式を保存し、復元時は型を解決して配線を検査する。計測中の最新値・接続・サンプル時刻は図の保存へ自動的に混ぜない。

固定のvec3・IMUは組込登録から復元できる。ユーザー定義Structを追加する段階では、型定義の一覧とブロック一覧を保存できるdiagram専用の形式を用意する。現行ブロック配列の読込は残し、plane/movieのversion 3操作形式とは混同しない。未定義型・重複名・型定義の不整合を読込時に検査する。

共有parserはalgebra・plane等でも使うため、まず既存ASTを利用してdiagramの評価処理を拡張する。ドットのlexer診断や新しい構文を直す場合は、数値の小数点・既存のドット参照・数式解析を回帰確認する。JavaScriptのevalやFunctionによる式実行へ置き換えない。

## 実装の順序

1. 型定義を独立モジュールへ移し、vec3・IMUの登録、値検証、フィールド検索を用意する。
2. Portに値の型と構造体の表示・接続検査を追加する。IMUは1出力とし、グラフはIMU/vec3を受けて表示項目を選ぶ形にする。
3. CalcBlockにフィールド参照・型推論・TypedValue評価を追加し、既存のスカラー計算を維持する。
4. 生成式、保存・復元、必要に応じたvec3の演算やユーザー定義型UIを追加する。

受入確認には、入れ子の型検証、1通知1出力、分岐先による値の変更防止、a.gyro.x／a.gyro／構造体生成の評価、未知フィールドと誤配線の拒否、係数と負数、既存スカラー式・CompareBlock、図の保存復元を含める。構造体の表示・計算が動くことと、ブラウザー／BLE経由の倒立振子制御に必要な周期を保証することは別の検証であり、この設計は制御周期を保証しない。
