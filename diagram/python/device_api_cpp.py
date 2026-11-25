"""device-apiの解析結果からVMスタブ・型付きバックエンド宣言を生成する。

generate-device-api.pyから呼び出す。採番・ABI指紋は同じ解析結果を使い、
機器操作はESP32のDeviceNative、スタックの所有権はBytecodeVMに任せる。
生成スタブはinvoke_<関数名>、メソッドはinvoke_<クラス名>_<メソッド名>、
コンストラクターはinvoke_<クラス名>_constructとする。命名だけでは数値IDとABI指紋は変わらない。
FLOAT_UNARY_FUNCTIONS/FLOAT_BINARY_FUNCTIONSに明示したモジュール関数は標準C++関数へ直接接続し、
同じfloat引数・float戻り値の型検査・結果格納を引数の個数ごとに共通化する。
それらのBackend宣言は生成せず、device_native.h/.cppにも実装を置かない。
未登録の関数・機器メソッドは従来のBackendを使う。数値の有限性はVMの
callNative()/validValue()が引数・結果とも検査する。三角関数の仕様本文は
生成するinvokeFloatUnaryのコメントに置き、device.pyiから参照する。
modfだけは小数部を返すfractionalPartを介し、std::modfの整数部出力を破棄する。
"""

import re
from typing import Any, Dict, List, Optional, Tuple


# 標準関数への接続先は型だけでは判定しない。追加時は表の引数個数とfloat型を必須とする。
FLOAT_UNARY_FUNCTIONS = {
    "sin": "std::sin", "cos": "std::cos", "tan": "std::tan",
    "floor": "std::floor", "ceil": "std::ceil", "acos": "std::acos", "asin": "std::asin",
    "modf": "fractionalPart", "abs": "std::fabs",
}
FLOAT_BINARY_FUNCTIONS = {"min": "std::fmin", "max": "std::fmax", "atan2": "std::atan2"}


class CppGenerator:
    """値スロットを型付きC++引数へ変換し、呼出し結果をスロットへ戻す。"""

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
        stubs = [self.stub_name(*entry) for entry in self.calls]
        if len(set(stubs)) != len(stubs):
            raise ValueError("C++スタブ名が重複しています")

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

    def record_helpers(self) -> List[str]:
        """GC本体とC++の値型を変換するrecordごとの関数を生成する。

        Returns:
            依存するrecordから順に並べた読取り・書込み関数の行一覧。

        Raises:
            ValueError: 現行ネイティブrecordで未対応の文字列出力を宣言した場合。
        """
        lines = []
        for item in self.records:
            name = item["name"]
            count = len(item["fields"])
            if any(field["type"]["kind"] == "str" for field in item["fields"]):
                raise ValueError("ネイティブrecordの文字列変換は未対応です")
            lines.extend([
                "        /**", "         * @brief GC本体をC++の{}へコピーする。".format(name),
                "         * @param vm 本体を検査するVM。", "         * @param value 本体参照。",
                "         * @param result 成功時のC++値。", "         * @return 型・幅が一致すればtrue。", "         */",
                "        inline bool read_{}(BytecodeVM &vm, const BytecodeVM::Value &value, {} &result) {{".format(name, name),
                "            const BytecodeVM::Value *fields = nullptr;",
                "            if (!vm.heapFields(value, {}, {}, fields)) {{".format(item["id"], count),
                "                return false;", "            }",
            ])
            for index, field in enumerate(item["fields"]):
                value = field["type"]
                target = "result." + field["name"]
                slot = "fields[{}]".format(index)
                if value["kind"] == "object" and self.classes[value["classId"]]["kind"] == "record":
                    condition = "!read_{}(vm, {}, {})".format(self.classes[value["classId"]]["name"], slot, target)
                else:
                    tag, member = {"int": ("Integer", "integer"), "float": ("Float", "real"), "object": ("Object", "address")}[value["kind"]]
                    condition = "{}.type != BytecodeVM::Type::{}".format(slot, tag)
                    if value["kind"] == "object":
                        condition += " || {}.classId != {}".format(slot, value["classId"])
                    if value["kind"] == "float":
                        condition += " || !std::isfinite({}.real)".format(slot)
                lines.extend(["            if ({}) {{".format(condition), "                return false;", "            }"])
                if not (value["kind"] == "object" and self.classes[value["classId"]]["kind"] == "record"):
                    lines.append("            {} = {}.{};".format(target, slot, member))
            lines.extend(["            return true;", "        }", "", "        /**",
                          "         * @brief C++の{}を入れ子も含めてGC本体へコピーする。".format(name),
                          "         * @param vm 確保先のVM。", "         * @param input バックエンドの結果。",
                          "         * @param value 成功時だけ設定する参照。", "         * @return 確保と変換の成功時true。",
                          "         * @details 構築途中の親をHeapRootで保持し、子の確保中のGCから保護する。", "         */",
                          "        inline bool write_{}(BytecodeVM &vm, const {} &input, BytecodeVM::Value &value) {{".format(name, name),
                          "            BytecodeVM::Value holder;", "            BytecodeVM::HeapRoot root(vm, holder);",
                          "            if (!vm.allocateHeapValue({}, {}, 0, holder)) {{".format(item["id"], count),
                          "                return false;", "            }",
                          "            auto *fields = static_cast<BytecodeVM::Value *>(holder.reference->data);"])
            for index, field in enumerate(item["fields"]):
                value = field["type"]
                source = "input." + field["name"]
                slot = "fields[{}]".format(index)
                if value["kind"] == "str":
                    raise ValueError("ネイティブrecordの文字列出力は未対応です")
                if value["kind"] == "object" and self.classes[value["classId"]]["kind"] == "record":
                    lines.extend(["            if (!write_{}(vm, {}, {})) {{".format(self.classes[value["classId"]]["name"], source, slot),
                                  "                return false;", "            }"])
                else:
                    tag, member = {"int": ("Integer", "integer"), "float": ("Float", "real"), "object": ("Object", "address")}[value["kind"]]
                    if value["kind"] == "float":
                        lines.extend(["            if (!std::isfinite({})) {{".format(source), "                return false;", "            }"])
                    lines.append("            {}.type = BytecodeVM::Type::{};".format(slot, tag))
                    if value["kind"] == "object":
                        lines.append("            {}.classId = {};".format(slot, value["classId"]))
                    lines.append("            {}.{} = {};".format(slot, member, source))
            lines.extend(["            value = holder;", "            return true;", "        }", ""])
        return lines

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

    def stub_name(self, owner: Optional[Dict[str, Any]], function: Dict[str, Any], constructor: bool) -> str:
        """スタブ名はAPI名から作る。機器の同名メソッドはクラス名で区別する。"""
        return "invoke_" + (owner["name"] + "_" if owner else "") + ("construct" if constructor else function["name"])

    def direct_function(self, owner: Optional[Dict[str, Any]], function: Dict[str, Any], constructor: bool) -> Optional[Tuple[str, int]]:
        """明示した標準関数だけを直接接続し、宣言が対応する型から変わったら生成を拒否する。"""
        if owner is not None:
            return None
        name = function["name"]
        if name in FLOAT_UNARY_FUNCTIONS:
            target = FLOAT_UNARY_FUNCTIONS[name]
            count = 1
        elif name in FLOAT_BINARY_FUNCTIONS:
            target = FLOAT_BINARY_FUNCTIONS[name]
            count = 2
        else:
            return None
        parameters = function["parameters"]
        if (constructor or len(parameters) != count or any(parameter["type"]["kind"] != "float" for parameter in parameters)
                or function["returnType"]["kind"] != "float"):
            raise ValueError(name + ": 標準関数はfloat引数{}個とfloat戻り値が必要です".format(count))
        return target, count

    def float_unary_helper(self) -> List[str]:
        """直接接続するfloat単項関数の共通変換と、三角関数の仕様コメントを生成する。"""
        return """        /**
         * @brief float単項関数の引数を検査し、結果をVMスロットへ格納する。
         * @param call VMの入出力領域。
         * @param function float版の標準関数またはそのアダプター。
         * @return 成功はNone、スロット数不一致はOperand、型不一致はType。
         * @details
         * 数学関数の共通仕様。device.pyiの宣言からdevice_api_cpp.pyが
         * invoke_<関数名>とID表を生成し、BackendやDeviceNativeを介さず標準関数を呼ぶ。
         * PythonBlockからimportなしで呼び出す。整数の引数はコンパイラーがfloatへ変換する。
         * 引数・戻り値はVMのfloat32で、対応するC++標準関数のfloat版を使う。
         * absはstd::fabsで絶対値をfloatで返す。整数引数もfloatへ変換し、負のゼロは正のゼロになる。
         * floorは入力以下の最大の整数値、ceilは入力以上の最小の整数値をfloatで返す。
         * Python標準のmath.floor/ceilと異なりintは返さず、int32への変換・範囲制限は行わない。
         * modfはfractionalPartでstd::modfの整数部を破棄し、小数部だけをfloatで返す。
         * Python標準のmath.modfと異なりタプルは返さない。小数部は入力と同符号で、
         * modf(-1.25)は-0.25。整数部はゼロ方向へ切り捨てられ、整数入力の結果は符号付きゼロ。
         * sin・cos・tanの引数とacos・asinの戻り値の角度はラジアン。
         * acos・asinの入力範囲は[-1, 1]。範囲外の非有限な計算結果もVMがTypeとして拒否する。
         * sin・cos・tanでは度からの変換、入力角度の制限、独自の周期丸めは行わない。
         * 有限性の検査はbytecode_vm.cppのcallNative()/validValue()が呼出し前後に行う。
         * NaN・無限大の引数と非有限の計算結果はそこでTypeとなり、VMの実行を停止する。
         * tanは丸められたfloat32の角度に対して計算する。特異点付近でも独自のしきい値で
         * 拒否せず、有限の結果はそのまま返す。数学上のπ/2等でも丸めにより大きな有限値になり得る。
         * 機器・プログラムの起点には依存せず、待機・NativePendingは使わない。
         * loop()からVMを通して呼ぶ。contextは使用しない。
         */
        BytecodeVM::Error invokeFloatUnary(BytecodeVM::NativeCall &call, float (*function)(float)) {
            using Type = BytecodeVM::Type;
            using Error = BytecodeVM::Error;
            if (call.argumentSlots != 1 || call.resultSlots != 1) {
                return Error::Operand;
            }
            if (call.arguments[0].type != Type::Float) {
                return Error::Type;
            }
            call.results[0].type = Type::Float;
            call.results[0].real = function(call.arguments[0].real);
            return Error::None;
        }
""".splitlines() + [""]

    def modf_adapter(self) -> List[str]:
        """整数部を要求しないmodfを、共通のfloat単項呼出しへ接続する。"""
        return """        /** @brief std::modfの小数部だけを返す。仕様はinvokeFloatUnaryを参照する。
         * @param value 分解する値。@return 入力と同符号の小数部。
         */
        float fractionalPart(float value) {
            float integerPart{};
            return std::modf(value, &integerPart);
        }
""".splitlines() + [""]

    def float_binary_helper(self) -> List[str]:
        """float二項関数を共通変換し、min/max/atan2の契約を生成する。"""
        return """        /**
         * @brief float二項関数の引数を検査し、結果をVMスロットへ格納する。
         * @param call VMの入出力領域。
         * @param function float版の標準関数。
         * @return 成功はNone、スロット数不一致はOperand、型不一致はType。
         * @details
         * float32・整数引数の変換・有限性・実行タスクの共通仕様はinvokeFloatUnaryを参照する。
         * min/maxは数値2引数だけを受け、std::fmin/fmaxで小さい値/大きい値をfloatで返す。
         * 整数同士でも戻り値はfloat。可変長引数・反復可能オブジェクト・key/defaultは未対応。
         * atan2(y, x)はstd::atan2(y, x)で象限を含む角度をラジアンで返す。
         * ゼロ・符号付きゼロの扱いは標準関数に従い、独自の原点判定は行わない。
         */
        BytecodeVM::Error invokeFloatBinary(BytecodeVM::NativeCall &call, float (*function)(float, float)) {
            using Type = BytecodeVM::Type;
            using Error = BytecodeVM::Error;
            if (call.argumentSlots != 2 || call.resultSlots != 1) {
                return Error::Operand;
            }
            if (call.arguments[0].type != Type::Float || call.arguments[1].type != Type::Float) {
                return Error::Type;
            }
            call.results[0].type = Type::Float;
            call.results[0].real = function(call.arguments[0].real, call.arguments[1].real);
            return Error::None;
        }
""".splitlines() + [""]

    def module_enums(self) -> List[str]:
        """モジュール定義から共有番号を生成する。実行処理はnumpy_native.cppへ接続する。

        Functionの番号はモジュール内の宣言順で、CALL_NATIVEのnativeIdとは異なる。
        必須位置引数は各関数のArgument、optionalはOptionの独立したenumにする。
        optionIdは必須引数を除いた宣言順なので、zerosではdtype=0、order=1、
        device=2、like=3となる。既定値の補完はC++実装側の責務とする。

        Returns:
            ヘッダーへ出力する定義版・名前空間・共有enumの行一覧。

        Raises:
            ValueError: 関数名から生成したenum名が同じモジュール内で重複する場合。
        """
        lines = [
            "    /**", "     * @brief 組込みモジュール定義の版。呼出し規約の版とは独立する。",
            "     */", "    constexpr uint16_t ModuleDefinitionVersion = {};".format(self.interface["moduleDefinitionVersion"]),
        ]
        for module in self.interface["modules"]:
            lines.extend(["", "    /**", "     * @brief {}の引数番号。実行処理はnumpy_native.cppが使用する。".format(module["name"]),
                          "     */", "    namespace " + module["name"] + " {",
                          "        /**", "         * @brief モジュール内の関数ID。nativeIdとは異なる。",
                          "         */", "        enum class Function : uint16_t {"])
            for function in module["functions"]:
                lines.append("            {} = {},".format(function["name"], function["id"]))
            lines.append("        };")
            enum_names = {"Function"}
            for function in module["functions"]:
                stem = "".join(part[:1].upper() + part[1:] for part in function["name"].split("_"))
                for suffix, required in [("Argument", True), ("Option", False)]:
                    parameters = [item for item in function["parameters"] if item["required"] == required]
                    if not parameters:
                        continue
                    enum_name = stem + suffix
                    if enum_name in enum_names:
                        raise ValueError("C++のモジュールenum名が重複しています: " + enum_name)
                    enum_names.add(enum_name)
                    lines.extend(["", "        /**", "         * @brief {}の{}番号。".format(function["name"], "必須引数" if required else "省略可能な引数"),
                                  "         */", "        enum class " + enum_name + " : uint16_t {"])
                    for parameter in parameters:
                        number = parameter["position"] if required else parameter["optionId"]
                        lines.append("            {} = {},".format(parameter["name"], number))
                    lines.append("        };")
            lines.append("    }")
        return lines

    def generate(self) -> Tuple[bytes, bytes]:
        """全成果物をメモリー上で作る。未知のC++識別子や幅超過は書出し前に拒否する。

        Returns:
            UTF-8で符号化した生成ヘッダーと生成ソースのバイト列の組。

        Raises:
            ValueError: C++識別子、enum名、型、または引数・戻り値の幅が不正な場合。
        """
        keywords = set("alignas alignof and asm auto bool break case catch char class const constexpr continue default delete do double else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not nullptr operator or private protected public register reinterpret_cast return short signed sizeof static struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor".split())
        for item in self.interface["classes"]:
            for name in [item["name"]] + [field["name"] for field in item["fields"]]:
                if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name) or name in keywords:
                    raise ValueError("C++で使用できない型名またはフィールド名: " + name)
        for module in self.interface["modules"]:
            names = [module["name"]]
            for function in module["functions"]:
                names.append(function["name"])
                names.extend(parameter["name"] for parameter in function["parameters"])
            for name in names:
                if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name) or name in keywords:
                    raise ValueError("C++で使用できないモジュール名・引数名: " + name)
        header = [
            "/** @file device_api.generated.h",
            " * @brief device.pyiから自動生成した値型・機器バックエンドの契約。直接編集しない。",
            " */", "#pragma once", '#include "bytecode_vm.h"', "", "namespace device_api {",
            "    /** @brief 呼出し中だけ有効な長さ付きUTF-8。埋込NULを許す。 */",
            "    struct StringView {", "        const char *data; ///< 呼出し中だけ有効なUTF-8。", "        size_t length; ///< 終端NULを含まないバイト数。", "    };", "",
        ]
        header.extend(self.module_enums())
        for item in self.interface["classes"]:
            header.append("    constexpr uint16_t ClassId{} = {}; ///< device.pyiのクラスID。".format(item["name"], item["id"]))
        for item in self.records:
            header.extend(["", "    /** @brief バックエンドとの変換用値型。VMではGC本体参照として扱う。 */", "    struct " + item["name"] + " {"])
            for field in item["fields"]:
                header.append("        {} {}; ///< device.pyiの宣言フィールド。".format(self.cpp_type(field["type"]), field["name"]))
            header.append("    };")
        header.extend(["", "    /** @brief loop()で同期実行する機器操作。生成スタブが引数を検査して呼ぶ。 */", "    class Backend {", "        public:", "        /** @brief 派生バックエンドを破棄する。 */", "        virtual ~Backend();", "        /** @brief VM所有の出力を停止し、ハンドルをすべて無効化する。 */", "        virtual void reset() = 0;"])
        source = [
            "/** @file device_api.generated.cpp",
            " * @brief device.pyiから自動生成した型検査・値スロット変換・単一ID登録表。直接編集しない。",
            " * @details 数学関数は共通変換から直接呼び、機器操作はBackendへ渡す。有限性はVMが検査する。",
            " */", '#include "device_api.generated.h"', "#include <cmath>", "", "namespace device_api {",
            "    /** @brief 派生バックエンドを破棄する。 */", "    Backend::~Backend() = default;", "", "    namespace {",
        ]
        if any(self.direct_function(*entry) is not None for entry in self.calls):
            source.extend(self.float_unary_helper())
        if any(owner is None and function["name"] in FLOAT_BINARY_FUNCTIONS for owner, function, _ in self.calls):
            source.extend(self.float_binary_helper())
        if any(owner is None and function["name"] == "modf" for owner, function, _ in self.calls):
            source.extend(self.modf_adapter())
        source.extend(self.record_helpers())
        entries = []
        for owner, function, constructor in self.calls:
            method = self.method_name(owner, function, constructor)
            arguments = self.arguments(owner, function, constructor)
            result = self.result_type(function, constructor)
            stub = self.stub_name(owner, function, constructor)
            direct = self.direct_function(owner, function, constructor)
            if direct is not None:
                target, count = direct
                helper = "invokeFloatUnary" if count == 1 else "invokeFloatBinary"
                signature = ", ".join(["float"] * count)
                entries.append("            {{{}, {}, 1, {}}},".format(function["nativeId"], count, stub))
                source.extend([
                    "        /** @brief {}を共通変換から呼ぶ。@param call VMの入出力領域。@return 実行結果。 */".format(target),
                    "        BytecodeVM::Error {}(BytecodeVM::NativeCall &call) {{".format(stub),
                    "            return {}(call, static_cast<float (*)({})>({}));".format(helper, signature, target),
                    "        }", "",
                ])
                continue
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
            leaves = [(value, name) for name, value in arguments]
            outputs = [] if result["kind"] == "none" else [(result, "result")]
            width = max(1, len(outputs))
            if len(leaves) > 1024 or width > 1024:
                raise ValueError(method + ": VMのスロット上限1024を超えています")
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
                if value["kind"] == "object" and self.classes[value["classId"]]["kind"] == "record":
                    source.extend(["            if (!read_{}(call.vm, {}, {})) {{".format(self.classes[value["classId"]]["name"], slot, name),
                                   "                return Error::Type;", "            }"])
                    continue
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
                if value["kind"] == "object" and self.classes[value["classId"]]["kind"] == "record":
                    source.extend(["            if (!write_{}(call.vm, {}, call.results[{}])) {{".format(self.classes[value["classId"]]["name"], name, index),
                                   "                return call.vm.error == Error::None ? Error::Type : call.vm.error;", "            }"])
                    continue
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
                       "        // nativeIdの昇順。recordも1スロットのGC参照で受け渡す。",
                       "        const BytecodeVM::NativeEntry entries[] = {"] + (entries or ["            {},"]) + ["        };", "",
                       "        /** @brief VM停止時に機器の出力とハンドルを解放する。@param context 登録バックエンド。 */",
                       "        void resetBackend(void *context) {", "            static_cast<Backend *>(context)->reset();", "        }", "    }", "",
                       "    /** @brief VM登録表を構築する。@param backend 登録中保持する機器操作。@return 静的なID表を参照する登録情報。 */",
                       "    BytecodeVM::NativeApi makeNativeApi(Backend &backend) {",
                       "        return {abiHash, entries, " + str(len(entries)) + ", &backend, resetBackend};", "    }", "}", ""])
        return self.documented(header), self.documented(source)

    def documented(self, lines: List[str]) -> bytes:
        """生成C++の文書コメントを規約どおり複数行・1タグ1行へ整える。

        Args:
            lines: ヘッダーまたは実装の行一覧。

        Returns:
            UTF-8の生成ソース。コードの行とタグ以外の説明は変更しない。
        """
        result = []
        for line in lines:
            match = re.match(r"^(\s*)/\*\*\s+(.+)$", line)
            if match:
                indent, body = match.groups()
                closed = body.endswith("*/")
                body = body[:-2].rstrip() if closed else body
                result.append(indent + "/**")
                for text in re.split(r"(?=@(?:file|brief|param|return|details)\b)", body):
                    if text.strip():
                        result.append(indent + " * " + text.strip())
                if closed:
                    result.append(indent + " */")
            else:
                result.append(line)
        return "\n".join(result).encode("utf-8")


def generate_cpp(interface: Dict[str, Any]) -> Tuple[bytes, bytes]:
    """JSONと共通の解析結果からヘッダー・実装を生成する。"""
    return CppGenerator(interface).generate()
