# ESP32向けPython VMのバイトコード参照先

2026-11-25: 数値NumPy配列対応の第4段階でバイトコードversion=5へ更新した。旧バイトコードと、意味解析なしの生成経路は扱わない。現行形式の仕様は実装ソースのコメントを正本とし、本書の旧版の命令・配置説明は廃止する。Webとファームウェアを更新し、古いバイナリは再コンパイル・再送信する。

| 確認する内容 | 参照先 |
|---|---|
| 型・名前解決・変数配置・診断 | [semantic.ts](../../../diagram/ts/python/semantic.ts) |
| アセンブリ・バイナリ・デバッグ情報の生成 | [bytecode.ts](../../../diagram/ts/python/bytecode.ts)の`generateAssembly(analysis)`・`generateBytecode(analysis)`・`generateDebugBytecode(analysis)` |
| 命令番号・バイナリ配置 | 同ファイルの`BytecodeOpcode`・`BytecodeGenerator.encodeBinary()` |
| 構文解析 | [parser.ts](../../../diagram/ts/python/parser.ts)の`parsePython()` |
| BLE／Wi-Fi一括転送 | [bytecode-transfer.ts](../../../diagram/ts/ble-wifi/bytecode-transfer.ts) |
| C++の共通レイアウト・命令長 | [bytecode_format.h](../../../../esp32/app/diagram-control/include/bytecode_format.h)・[bytecode_format.cpp](../../../../esp32/app/diagram-control/src/bytecode_format.cpp) |
| 受信した命令・PC・文字列の検証 | [bytecode_receiver.cpp](../../../../esp32/app/diagram-control/src/bytecode_receiver.cpp) |
| CALL／RET・値・実行上限 | [bytecode_vm.cpp](../../../../esp32/app/diagram-control/src/bytecode_vm.cpp) |
| 数値NumPyの生成・引数番号・添字・属性 | [numpy_native.cpp](../../../../esp32/app/diagram-control/src/numpy_native.cpp) |
| ブレークポイント・停止値の通信 | [debug-protocol.ts](../../../diagram/ts/ble-wifi/debug-protocol.ts) |

生成には`PythonAnalysis`を必須とする。`parsePython()`の結果を意味解析した後、診断がない場合だけ生成する。公開ビルド・ファームウェアビルドと、通信・ブラウザー・実機での実行確認は区別する。確認記録は[build-and-test.md](../../build-and-test.md)を参照する。
