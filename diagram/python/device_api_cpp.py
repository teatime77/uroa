"""device-apiの解析結果からVMスタブ・型付きバックエンド宣言を生成する。

generate-device-api.pyから呼び出す。採番・ABI指紋は同じ解析結果を使い、
機器操作はESP32のDeviceNative、スタックの所有権はBytecodeVMに任せる。
"""

import re
from typing import Any, Dict, List, Optional, Tuple


class CppGenerator:
    """値スロットを型付きC++引数へ変換し、バックエンドの結果をスロットへ戻す。"""

    def __init__(self, interface: Dict[str, Any]) -> None:
        self.interface = interface
        self.classes = {item["id"]: item for item in interface["classes"]}
        self.records: List[Dict[str, Any]] = []
        self.visiting = set()
        self.complete = set()
        self.calls = []
        for item in interface["classes"]:
            self.record(item)
            if item["constructor"]:
                self.calls.append((item, item["constructor"], True))
            for method in item["methods"]:
                self.calls.append((item, method, False))
        for function in interface["functions"]:
            self.calls.append((None, function, False))
        self.calls.sort(key=lambda entry: entry[1]["nativeId"])
        names = [self.method_name(*entry) for entry in self.calls]
        if len(set(names)) != len(names):
            raise ValueError("C++バックエンドのメソッド名が重複しています")

    def record(self, item: Dict[str, Any]) -> None:
        """入れ子recordの宣言順依存を解決する。空・循環recordは生成前に拒否する。"""
        if item["kind"] != "record" or item["id"] in self.complete:
            return
        if item["id"] in self.visiting or not item["fields"]:
            raise ValueError("空または循環するrecord: " + item["name"])
        self.visiting.add(item["id"])
        for field in item["fields"]:
            if field["type"]["kind"] == "object":
                self.record(self.classes[field["type"]["classId"]])
        self.visiting.remove(item["id"])
        self.complete.add(item["id"])
        self.records.append(item)

    def cpp_type(self, value: Dict[str, Any]) -> str:
        """deviceは不透明ハンドル、recordは生成した値型へ対応させる。"""
        if value["kind"] == "object":
            item = self.classes[value["classId"]]
            return item["name"] if item["kind"] == "record" else "uint32_t"
        return {"int": "int32_t", "float": "float", "str": "StringView"}[value["kind"]]

    def leaves(self, value: Dict[str, Any], name: str) -> List[Tuple[Dict[str, Any], str]]:
        """recordをフィールド宣言順に再帰展開する。device・数値・文字列は1スロット。"""
        if value["kind"] == "object":
            item = self.classes[value["classId"]]
            if item["kind"] == "record":
                return [leaf for field in item["fields"]
                        for leaf in self.leaves(field["type"], name + "." + field["name"])]
        return [(value, name)]

    def arguments(self, owner: Optional[Dict[str, Any]], function: Dict[str, Any], constructor: bool) -> List[Tuple[str, Dict[str, Any]]]:
        """メソッドのselfを先頭に置く。コンストラクターは明示引数だけを受け取る。"""
        result = []
        if owner is not None and not constructor:
            result.append(("receiver", {"kind": "object", "classId": owner["id"]}))
        result.extend(("arg_" + parameter["name"], parameter["type"]) for parameter in function["parameters"])
        return result

    def result_type(self, function: Dict[str, Any], constructor: bool) -> Dict[str, Any]:
        """コンストラクターではNoneではなく生成されるオブジェクトを返す。"""
        return function["resultType"] if constructor else function["returnType"]

    def method_name(self, owner: Optional[Dict[str, Any]], function: Dict[str, Any], constructor: bool) -> str:
        """バックエンドのシンボルは採番に依存させず、API名から作る。"""
        return (owner["name"] + "_" if owner else "function_") + ("construct" if constructor else function["name"])

    def generate(self) -> Tuple[bytes, bytes]:
        """全成果物をメモリー上で作る。未知のC++識別子や幅超過は書出し前に拒否する。"""
        keywords = set("alignas alignof and asm auto bool break case catch char class const constexpr continue default delete do double else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not nullptr operator or private protected public register reinterpret_cast return short signed sizeof static struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor".split())
        for item in self.interface["classes"]:
            for name in [item["name"]] + [field["name"] for field in item["fields"]]:
                if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name) or name in keywords:
                    raise ValueError("C++で使用できない型名またはフィールド名: " + name)
        header = [
            "/** @file device_api.generated.h",
            " * @brief device.pyiから自動生成した値型・機器バックエンドの契約。直接編集しない。",
            " */", "#pragma once", '#include "bytecode_vm.h"', "", "namespace device_api {",
            "    /** @brief 呼出し中だけ有効な長さ付きUTF-8。埋込NULを許す。 */",
            "    struct StringView {", "        const char *data;", "        size_t length;", "    };", "",
        ]
        for item in self.interface["classes"]:
            header.append("    constexpr uint16_t ClassId{} = {}; ///< device.pyiのクラスID。".format(item["name"], item["id"]))
        for item in self.records:
            header.extend(["", "    /** @brief 宣言順の値フィールド。VMでは葉の連続スロットへ展開する。 */", "    struct " + item["name"] + " {"])
            for field in item["fields"]:
                header.append("        {} {};".format(self.cpp_type(field["type"]), field["name"]))
            header.append("    };")
        header.extend(["", "    /** @brief loop()で同期実行する機器操作。生成スタブが引数を検査して呼ぶ。 */", "    class Backend {", "        public:", "        /** @brief 派生バックエンドを破棄する。 */", "        virtual ~Backend();", "        /** @brief VM所有の出力を停止し、ハンドルをすべて無効化する。 */", "        virtual void reset() = 0;"])
        source = [
            "/** @file device_api.generated.cpp",
            " * @brief device.pyiから自動生成した型検査・値スロット変換・単一ID登録表。直接編集しない。",
            " */", '#include "device_api.generated.h"', "", "namespace device_api {",
            "    /** @brief 派生バックエンドを破棄する。 */", "    Backend::~Backend() = default;", "", "    namespace {",
        ]
        entries = []
        for owner, function, constructor in self.calls:
            method = self.method_name(owner, function, constructor)
            arguments = self.arguments(owner, function, constructor)
            result = self.result_type(function, constructor)
            parameters = [self.cpp_type(value) + " " + name for name, value in arguments]
            if result["kind"] != "none":
                parameters.append(self.cpp_type(result) + " &result")
            header.append("        /** @brief {}を実行する。".format(method))
            for name, _ in arguments:
                header.append("         * @param {} 検査済み引数。recordは値コピー、deviceは不透明ハンドル。".format(name))
            if result["kind"] != "none":
                header.append("         * @param result 成功時の戻り値。")
            header.extend(["         * @return None=成功、NativePending=再試行、その他は実行エラー。", "         */",
                           "        virtual BytecodeVM::Error {}({}) = 0;".format(method, ", ".join(parameters))])
            leaves = [leaf for name, value in arguments for leaf in self.leaves(value, name)]
            outputs = [] if result["kind"] == "none" else self.leaves(result, "result")
            width = max(1, len(outputs))
            if len(leaves) > 1024 or width > 1024:
                raise ValueError(method + ": VMのスロット上限1024を超えています")
            stub = "invoke" + str(function["nativeId"])
            entries.append("            {{{}, {}, {}, {}}},".format(function["nativeId"], len(leaves), width, stub))
            source.extend(["        /** @brief {}の型を検査し、機器操作へ渡す。@param call VMの入出力領域。@return 実行結果。 */".format(method),
                           "        BytecodeVM::Error {}(BytecodeVM::NativeCall &call) {{".format(stub),
                           "            using Type = BytecodeVM::Type;", "            using Error = BytecodeVM::Error;",
                           "            if (!call.context || call.argumentSlots != {} || call.resultSlots != {}) {{".format(len(leaves), width),
                           "                return Error::Operand;", "            }"])
            for name, value in arguments:
                source.append("            {} {}{{}};".format(self.cpp_type(value), name))
            for index, (value, name) in enumerate(leaves):
                slot = "call.arguments[{}]".format(index)
                if value["kind"] == "str":
                    condition = "!call.vm.stringBytes({}, {}.data, {}.length)".format(slot, name, name)
                else:
                    tag, member = {"int": ("Integer", "integer"), "float": ("Float", "real"), "object": ("Object", "address")}[value["kind"]]
                    condition = "{}.type != Type::{}".format(slot, tag)
                    if value["kind"] == "object":
                        condition += " || {}.classId != {}".format(slot, value["classId"])
                source.extend(["            if ({}) {{".format(condition), "                return Error::Type;", "            }"])
                if value["kind"] != "str":
                    source.append("            {} = {}.{};".format(name, slot, member))
            if result["kind"] != "none":
                source.append("            {} result{{}};".format(self.cpp_type(result)))
            call_arguments = [name for name, _ in arguments] + ([] if result["kind"] == "none" else ["result"])
            source.extend(["            const Error status = static_cast<Backend *>(call.context)->{}({});".format(method, ", ".join(call_arguments)),
                           "            if (status != Error::None) {", "                return status;", "            }"])
            if result["kind"] == "none":
                source.append("            call.results[0].type = Type::None;")
            for index, (value, name) in enumerate(outputs):
                tag, member = {"int": ("Integer", "integer"), "float": ("Float", "real"), "object": ("Object", "address")}[value["kind"]]
                source.append("            call.results[{}].type = Type::{};".format(index, tag))
                if value["kind"] == "object":
                    source.append("            call.results[{}].classId = {};".format(index, value["classId"]))
                source.append("            call.results[{}].{} = {};".format(index, member, name))
            source.extend(["            return Error::None;", "        }", ""])
        header.extend(["    };", "", "    /** @brief 生成したABIハッシュとID表をバックエンドへ接続する。@param backend 登録中保持する機器操作。@return VM登録表。 */", "    BytecodeVM::NativeApi makeNativeApi(Backend &backend);", "}", ""])
        digest = bytes.fromhex(self.interface["abiHash"])
        source.extend(["        // JSONと同一のABIハッシュ。シグネチャ・ID・フィールド配置の差をVM開始時に検出する。",
                       "        const uint8_t abiHash[32] = {", "            " + ", ".join("0x{:02X}".format(byte) for byte in digest), "        };",
                       "        // nativeIdの昇順。引数と戻り値の幅はrecord展開後のスロット数。",
                       "        const BytecodeVM::NativeEntry entries[] = {"] + (entries or ["            {},"]) + ["        };", "",
                       "        /** @brief VM停止時に機器の出力とハンドルを解放する。@param context 登録バックエンド。 */",
                       "        void resetBackend(void *context) {", "            static_cast<Backend *>(context)->reset();", "        }", "    }", "",
                       "    /** @brief VM登録表を構築する。@param backend 登録中保持する機器操作。@return 静的なID表を参照する登録情報。 */",
                       "    BytecodeVM::NativeApi makeNativeApi(Backend &backend) {",
                       "        return {abiHash, entries, " + str(len(entries)) + ", &backend, resetBackend};", "    }", "}", ""])
        return "\n".join(header).encode("utf-8"), "\n".join(source).encode("utf-8")


def generate_cpp(interface: Dict[str, Any]) -> Tuple[bytes, bytes]:
    """JSONと共通の解析結果からヘッダー・実装を生成する。"""
    return CppGenerator(interface).generate()
