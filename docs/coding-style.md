# コーディング規約

2026-10-27に指定された書式。以降、uroaで新規作成・変更するコードはこの規約に従う。既存コードを整形する範囲は作業の対象に合わせる。

ESP32の現行教材・共有ライブラリーは別リポジトリーの`D:\usr\prj\esp32`で管理し、[同リポジトリーの規約](../../esp32/docs/coding-style.md)と[.clang-format](../../esp32/.clang-format)に従う。uroa内の旧ESP32フォルダーは廃止対象で、現行の整形設定の参照先にしない。`.pio/`内の外部ライブラリーとビルド生成物は編集対象から除く。Doxygenコメントの内容と変数宣言の分割は、整形ツールとは別に確認する。

## コメント

C++のファイル、関数、クラス、構造体にはDoxygen形式のコメントを書く。説明は日本語を基本とし、関数には目的を`@brief`、引数を`@param`、戻り値を`@return`で記載する。戻り値のない関数には`@return`を書かない。必要に応じて`@details`に呼出元タスク、単位、状態の変更、副作用や制約を記載する。変数・メンバーの短い説明には`///<`を使える。他言語では、その言語に対応した文書コメント形式を使う。

```cpp
/**
 * @brief センサーの生データを角速度へ変換する。
 * @param raw 符号付きの生データ。
 * @return 角速度。単位は度/秒。
 */
float angularRate(int16_t raw) {
    return raw / 131.0f;
}
```

## ブロックとインデント

- `if`のthen節、`else if`と`else`の各節を必ず`{}`で囲む。処理が1文でも省略しない。
- `for`、範囲for、`while`、`do`のループ本体も必ず`{}`で囲む。
- ブロックを開く`{`の直後で改行する。閉じる`}`は独立した行に置く。`};`やラムダ式の`});`など、構文上必要な末尾は同じ行に置ける。
- インデントはスペース4個とし、ブロックの内側を1段深くする。タブは使わない。関数、名前空間、型、ラムダ式の本体にも同じ規則を使う。
- `else`と`else if`は直前の`}`の次の行に置く。
- `switch`の`case`・`default`は`switch`の内側へ1段、その処理はさらに1段インデントする。

変数の`{}`初期化や配列・集成体の初期化リストは、処理ブロックとは区別する。例えば`uint8_t raw[14]{};`は1行で書ける。

```cpp
if (connected) {
    startStream();
}
else {
    stopStream();
}

for (int index = 0; index < count; ++index) {
    if (samples[index].valid) {
        process(samples[index]);
    }
}

while (waiting) {
    poll();
}
```

## 文と変数宣言

- 1行に複数の文を書かない。文末の`;`の後で改行する。
- `return`、`break`、`continue`も別の文と同じ行に書かない。
- 1行に複数の変数を宣言しない。カンマで宣言を連結せず、変数ごとに型を付けて別の行に書く。構造体のメンバーにも適用する。
- `for`ヘッダーの`;`は文末ではなく構文上の区切りなので、ヘッダーは1行で書ける。ヘッダー内で宣言する変数も1個とする。
- 関数の引数や初期化リストのカンマは複数変数の宣言とは区別する。

```cpp
uint32_t previous = micros();
uint32_t lastCommand = millis();
const bool stopped = mustStop.exchange(false);
const bool urgent = urgentStop.exchange(false);

controller.stop();
wheels.off();

if (stopped || urgent) {
    streamHz = 0;
    return;
}
```
