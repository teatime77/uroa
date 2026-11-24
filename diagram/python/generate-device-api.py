#!/usr/bin/env python3
"""device.pyiを静的に解析し、コンパイラー用JSONとESP32のC++スタブを生成する。

仕様の正本はこのモジュールと各処理のdocstringとする。Python 3.8以降の
標準ライブラリーだけを使い、入力のimport・exec・evalは行わない。
JSONとC++は同じ解析結果・ABI指紋から生成する。C++変換はdevice_api_cpp.py、
機器操作はESP32のdevice_native.h/.cppが担当する。標準数学関数の直接接続と
同型スタブの共通変換・命名はdevice_api_cpp.pyを参照する。TypeScriptは生成しない。

InterfaceErrorは入力の制約違反、InterfaceParserは静的解析とAPI定義の構築、
write_outputは成果物の書込み、mainはCLIでの生成・照合を担当する。
入力の対応範囲とJSON形式はInterfaceParserの各メソッド、実行オプションと
既定パスはmain、出力の置換手順はwrite_outputのdocstringを参照する。
"""

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from typing import Any, Dict, List, NoReturn, Optional, Set

# 明示したJSON/C++以外の生成物を残さないため、補助モジュールのpycは書き出さない。
sys.dont_write_bytecode = True
from device_api_cpp import generate_cpp
from module_api import MODULE_NAMES, ModuleParser


SCRIPT_DIRECTORY = Path(__file__).resolve().parent
PROJECT_DIRECTORY = SCRIPT_DIRECTORY.parent.parent
MAX_ID = 0xFFFF
RECORD_CLASSES = {"Vec3", "IMUValue"}
PRIMITIVE_TYPES = {"int", "float", "str"}


class InterfaceError(Exception):
    """入力.pyiの宣言・型が対応範囲外であることを表す。"""


class InterfaceParser:
    """入力の宣言を静的に解析し、宣言順のAPI定義を構築する。

    parseでクラス名を先に登録し、前方参照を解決してから各宣言を検証する。
    入力のASTは実行せず、入力ファイルごとに新しいインスタンスを作成して使う。
    型はread_type、呼出し定義はread_callable、クラスはread_classが担当する。

    Attributes:
        path: 入力する.pyiファイルのパス。診断にも使用する。
        class_ids: 入力内のクラス名と、宣言順に採番したIDの対応。
        native_count: 全呼出し定義で共有する、最後に割り当てたnativeId。
    """

    def __init__(self, path: Path) -> None:
        """入力パスと、宣言の採番に使う状態を初期化する。

        Args:
            path: 解析対象の.pyiファイル。ここでは読込みを行わない。
        """
        self.path = path
        self.class_ids: Dict[str, int] = {}
        self.native_count = 0

    def fail(self, node: ast.AST, message: str) -> NoReturn:
        """対象ファイルと1始まりの行・列を付けて解析を中止する。

        Args:
            node: 診断対象のASTノード。位置属性がなければ1行1列とする。
            message: 制約違反の説明。

        Raises:
            InterfaceError: ファイル・行・列と説明を含む入力エラー。
        """
        line = getattr(node, "lineno", 1)
        column = getattr(node, "col_offset", 0) + 1
        raise InterfaceError("{}:{}:{}: {}".format(self.path, line, column, message))

    def body(self, nodes: List[ast.stmt]) -> List[ast.stmt]:
        """文列の先頭にある説明用docstringだけを除外する。

        モジュール・クラス・関数の各スコープで共通に使う。先頭以外の文字列は
        取り除かず、呼出し元が未対応の文として検証できるようにする。

        Args:
            nodes: スコープ内の文列。元のリストとASTは変更しない。

        Returns:
            先頭が文字列式なら、それを除く新しいリスト。それ以外は元のリスト。
        """
        if nodes and isinstance(nodes[0], ast.Expr):
            value = nodes[0].value
            if isinstance(value, ast.Constant) and isinstance(value.value, str):
                return nodes[1:]
        return nodes

    def register(self, names: Set[str], name: str, node: ast.AST) -> None:
        """同一スコープでの重複を検査し、名前を登録する。

        Args:
            names: 既に登録した名前の集合。成功時にnameを追加する。
            name: 登録する名前。
            node: 名前が重複する場合の診断対象。

        Raises:
            InterfaceError: 同じスコープに同名の宣言がある場合。
        """
        if name in names:
            self.fail(node, "名前が重複しています: " + name)
        names.add(name)

    def check_id(self, value: int, node: ast.AST) -> int:
        """採番したIDがuint16の上限を超えていないことを確認する。

        通常のIDは1から、コンストラクターのクラス内IDは0として呼び出す。
        下限の判定は行わず、上限を超える値は切り詰めずに拒否する。

        Args:
            value: 呼出し元が採番したID。
            node: 上限を超えた場合の診断対象。

        Returns:
            上限65535以下であることを確認した元の値。

        Raises:
            InterfaceError: IDが65535を超える場合。
        """
        if value > MAX_ID:
            self.fail(node, "IDがuint16の上限65535を超えています")
        return value

    def read_type(self, node: Optional[ast.AST], owner: ast.AST,
                  allow_none: bool = False) -> Dict[str, Any]:
        """型注釈を実行せず、組込み型名か登録済みクラスIDへ解決する。

        int・float・strと入力内のクラス名を受理し、Noneは戻り値だけに許す。
        文字列による型注釈や、それ以外の型の式は拒否する。strの使用位置は
        read_callableとread_classで追加検証する。

        Args:
            node: 型注釈のASTノード。省略された注釈はNone。
            owner: 注釈がない場合に診断対象とする宣言ノード。
            allow_none: None型を受理するか。戻り値の検証時だけTrueにする。

        Returns:
            組込み型は{"kind": "int"}等、クラス型は
            {"kind": "object", "classId": id}の形式の辞書。

        Raises:
            InterfaceError: 型注釈がない、または対応範囲外の場合。
        """
        if node is None:
            self.fail(owner, "型注釈が必要です")
        if isinstance(node, ast.Constant) and node.value is None and allow_none:
            return {"kind": "none"}
        if isinstance(node, ast.Name):
            if node.id in PRIMITIVE_TYPES:
                return {"kind": node.id}
            if node.id in self.class_ids:
                return {"kind": "object", "classId": self.class_ids[node.id]}
        self.fail(node, "未対応の型注釈です（int/float/str/戻り値のNone/宣言済みクラスのみ）")

    def read_callable(self, node: ast.FunctionDef, api_id: int,
                      class_name: Optional[str] = None) -> Dict[str, Any]:
        """明示引数と戻り値を検証し、呼出し定義とnativeIdを構築する。

        先頭docstringを除いた関数本体は...だけを許す。デコレーター、型パラメーター、
        既定引数、位置専用・キーワード専用・可変長引数、実行文は拒否する。
        メソッドの先頭には注釈なしのselfを要求し、parametersには含めない。
        strはDisplay.printとモジュール関数printのtext引数だけに許し、
        両APIは(text: str) -> Noneに限定する。strの戻り値は許可しない。

        全コンストラクター・メソッド・関数に、入力ファイル内の宣言順で共通の
        nativeIdを1から付ける。CALL_NATIVEはこの単一IDを使用し、idは
        名前解決用のクラス内またはモジュール内の名前空間に残す。
        コンストラクターのreturnTypeは宣言のnone、resultTypeは生成する
        object型とする。native_countを更新する。

        Args:
            node: 検証する関数またはメソッドの宣言。
            api_id: 名前解決用のID。コンストラクターは0、それ以外は1から。
            class_name: 所属クラス名。モジュール関数の場合はNone。

        Returns:
            id・nativeId・name・parameters・returnTypeを持つ辞書。
            コンストラクターにはresultTypeも含める。

        Raises:
            InterfaceError: 宣言・引数・型・本体が制約に違反する場合、
                またはIDがuint16の上限を超える場合。
        """
        qualified_name = node.name if class_name is None else class_name + "." + node.name
        if node.decorator_list or getattr(node, "type_params", []):
            self.fail(node, qualified_name + ": デコレーター・型パラメーターは未対応です")
        arguments = node.args
        if (arguments.posonlyargs or arguments.kwonlyargs or arguments.vararg is not None
                or arguments.kwarg is not None or arguments.defaults):
            self.fail(node, qualified_name + ": 既定値のない通常の位置引数だけを宣言してください")
        implementation = self.body(node.body)
        if (len(implementation) != 1 or not isinstance(implementation[0], ast.Expr)
                or not isinstance(implementation[0].value, ast.Constant)
                or implementation[0].value.value is not Ellipsis):
            self.fail(node, qualified_name + ": 関数本体は...にしてください")

        parameters = arguments.args
        names: Set[str] = set()
        if class_name is not None:
            if not parameters or parameters[0].arg != "self" or parameters[0].annotation is not None:
                self.fail(node, qualified_name + ": 先頭引数には注釈なしのselfが必要です")
            names.add("self")
            parameters = parameters[1:]

        output_parameters = []
        is_print = qualified_name in {"print", "Display.print"}
        for parameter in parameters:
            self.register(names, parameter.arg, parameter)
            parameter_type = self.read_type(parameter.annotation, parameter)
            if parameter_type["kind"] == "str" and not (is_print and parameter.arg == "text"):
                self.fail(parameter, qualified_name + ": strは表示APIのtext引数だけに使用できます")
            output_parameters.append({"name": parameter.arg, "type": parameter_type})

        return_type = self.read_type(node.returns, node, allow_none=True)
        if return_type["kind"] == "str":
            self.fail(node, qualified_name + ": strの戻り値は使用できません")
        if is_print and (output_parameters != [{"name": "text", "type": {"kind": "str"}}]
                         or return_type != {"kind": "none"}):
            self.fail(node, qualified_name + ": (text: str) -> Noneとして宣言してください")

        self.native_count = self.check_id(self.native_count + 1, node)
        result = {
            "id": self.check_id(api_id, node),
            "nativeId": self.native_count,
            "name": node.name,
            "parameters": output_parameters,
            "returnType": return_type,
        }
        if class_name is not None and node.name == "__init__":
            if return_type != {"kind": "none"}:
                self.fail(node, qualified_name + ": 戻り値の注釈はNoneにしてください")
            result["resultType"] = {"kind": "object", "classId": self.class_ids[class_name]}
        return result

    def read_class(self, node: ast.ClassDef) -> Dict[str, Any]:
        """クラスの公開フィールド・コンストラクター・メソッドを構築する。

        継承、クラス引数、デコレーター、型パラメーター、任意の実行文は拒否する。
        先頭docstringを除き、メソッドと型注釈付きフィールドだけを受理する。
        Vec3/IMUValueをrecord、それ以外をdeviceとし、公開フィールドは
        recordだけに許す。フィールドは初期値のない単一名の宣言に限定し、
        readable/writableをともにTrueにする。strのフィールドは拒否する。

        メソッドとフィールドの名前は同じクラス内で一意とする。クラスごとの
        methodId相当のidは__init__が0、通常メソッドが宣言順で1からとなる。
        fieldId相当のidもクラスごとの宣言順で1から付ける。
        constructorが未宣言ならNoneとし、JSONではnullとして出力する。

        Args:
            node: クラスIDを登録済みのクラス宣言。

        Returns:
            id・name・kind・constructor・methods・fieldsを持つ辞書。

        Raises:
            InterfaceError: クラス・メンバーの宣言が制約に違反する場合。
        """
        if (node.bases or node.keywords or node.decorator_list
                or getattr(node, "type_params", [])):
            self.fail(node, node.name + ": 継承・クラス引数・デコレーター・型パラメーターは未対応です")
        kind = "record" if node.name in RECORD_CLASSES else "device"
        result: Dict[str, Any] = {
            "id": self.class_ids[node.name],
            "name": node.name,
            "kind": kind,
            "constructor": None,
            "methods": [],
            "fields": [],
        }
        names: Set[str] = set()
        for member in self.body(node.body):
            if isinstance(member, ast.FunctionDef):
                self.register(names, member.name, member)
                if member.name == "__init__":
                    result["constructor"] = self.read_callable(member, 0, node.name)
                else:
                    method_id = len(result["methods"]) + 1
                    result["methods"].append(self.read_callable(member, method_id, node.name))
            elif isinstance(member, ast.AnnAssign):
                if (kind != "record" or not isinstance(member.target, ast.Name)
                        or member.simple != 1 or member.value is not None):
                    self.fail(member, node.name + ": 公開フィールドはVec3/IMUValueの名前: 型だけを許可します")
                name = member.target.id
                self.register(names, name, member)
                member_type = self.read_type(member.annotation, member)
                if member_type["kind"] == "str":
                    self.fail(member, node.name + "." + name + ": strのフィールドは使用できません")
                result["fields"].append({
                    "id": self.check_id(len(result["fields"]) + 1, member),
                    "name": name,
                    "type": member_type,
                    "readable": True,
                    "writable": True,
                })
            else:
                self.fail(member, node.name + ": 未対応のクラス内宣言です")
        return result

    def parse(self) -> Dict[str, Any]:
        """入力全体を検証してAPI定義と、その定義のABI指紋を作る。

        UTF-8の入力を読み、先頭BOMがあれば除去してASTへ変換する。
        モジュール直下は先頭docstringとクラス・関数の宣言だけを許す。
        クラス名を先に登録し、前方参照を解決できる状態で各宣言を解析する。
        classId相当のidはクラス宣言順、functionId相当のidは関数宣言順で
        それぞれ1から付ける。各IDの上限は65535とする。

        JSONのschemaVersion/callingConventionVersionは2、
        stringPolicyVersionは1とし、classes/functionsを出力する。
        class numpyはクラスIDを持たない組込みモジュール宣言としてmodule_api.pyへ渡す。
        moduleDefinitionVersion=1とmodulesを追加し、引数番号・省略可否・型もABI指紋に含める。
        この追加は定義情報だけで、既存の値受渡し規約とnativeIdの採番は変更しない。
        module関数のIDはモジュール内だけの番号であり、実行用nativeIdはまだ割り当てない。
        呼出し規約version=2ではrecordを宣言順の末端フィールドの連続スロットへ
        展開し、代入・引数・戻り値で値をコピーする。deviceは1スロットの
        ハンドルとする。配置とコピーはsemantic.ts・bytecode.ts・VMが担当する。

        abiHashは、指紋自身を除いたJSON全体をsort_keys=True、
        ensure_ascii=False、separators=(",", ":")で正規化したUTF-8の
        SHA-256とし、小文字16進64桁で保持する。位置・パス・日時・docstringは
        出力に含めない。宣言順やシグネチャの変更で指紋が変わる。
        意味・呼出し規約の変更時は対応する版を更新する。
        C++生成もこのJSONと同じID・型・指紋を使用する。

        Returns:
            検証済みのAPI定義とabiHashを含む辞書。

        Raises:
            InterfaceError: 入力の宣言・名前・型・IDが制約に違反する場合。
            SyntaxError: 入力をPythonの構文として解析できない場合。
            OSError: 入力ファイルの読込みに失敗した場合。
            UnicodeError: 入力をUTF-8として復号できない場合。
        """
        source = self.path.read_text(encoding="utf-8-sig")
        module = ast.parse(source, filename=str(self.path))
        declarations = self.body(module.body)
        names: Set[str] = set()
        for node in declarations:
            if not isinstance(node, (ast.ClassDef, ast.FunctionDef)):
                self.fail(node, "モジュール直下はクラスと関数の宣言だけを許可します")
            self.register(names, node.name, node)
            if node.name in PRIMITIVE_TYPES:
                self.fail(node, "組込み型名と同じ名前は宣言できません: " + node.name)
            if isinstance(node, ast.ClassDef) and node.name not in MODULE_NAMES:
                self.class_ids[node.name] = self.check_id(len(self.class_ids) + 1, node)

        classes = []
        functions = []
        modules = []
        for node in declarations:
            if isinstance(node, ast.ClassDef) and node.name in MODULE_NAMES:
                modules.append(ModuleParser(self.fail).parse(node))
            elif isinstance(node, ast.ClassDef):
                classes.append(self.read_class(node))
            else:
                functions.append(self.read_callable(node, len(functions) + 1))
        result = {
            "schemaVersion": 2,
            "callingConventionVersion": 2,
            "stringPolicyVersion": 1,
            "classes": classes,
            "functions": functions,
            "moduleDefinitionVersion": 1,
            "modules": modules,
        }
        canonical = json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        result["abiHash"] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        return result


def write_output(path: Path, content: bytes) -> None:
    """検証済み内容を同じディレクトリーの一時ファイルから原子的に置換する。

    出力先の親ディレクトリーを作成し、全バイトを書き終えてからos.replaceで
    ファイルを置換する。終了時には残っている一時ファイルを削除する。
    mainが成果物ごとに呼び出し、ファイル単位で置換する。

    Args:
        path: 置換する出力先のパス。
        content: 解析・検証・シリアライズ済みのバイト列。

    Raises:
        OSError: ディレクトリー作成、書込み、置換、一時ファイル削除の失敗。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=str(path.parent),
                                         prefix="." + path.name + ".", suffix=".tmp", delete=False) as output:
            temporary_path = Path(output.name)
            output.write(content)
        os.replace(str(temporary_path), str(path))
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def main() -> int:
    """CLIの引数に従って成果物を生成または照合し、終了コードを返す。

    --inputは入力.pyi、--outputはJSON、--cpp-headerと--cpp-sourceは
    C++成果物の出力先を指定する。既定の入力はこのスクリプトと同じ
    ディレクトリーのdevice.pyi、JSONはuroa/public/diagram/device/
    device-api.json、C++は隣接するesp32リポジトリーのapp/diagram-control/
    include/device_api.generated.hとsrc/device_api.generated.cppとする。
    既定パスは作業ディレクトリーに依存しない。指定した相対パスは作業
    ディレクトリーを基準とする。

    --json-onlyではJSONだけを対象とする。JSONはensure_ascii=Falseと
    4スペースで整形し、末尾LF付きのUTF-8にする。解析・検証・全成果物の
    シリアライズと入出力パスの重複検査に成功してからwrite_outputを呼ぶ。
    --checkはファイルを書き換えず、生成予定のバイト列と既存成果物を照合する。
    成功時は対象パスを標準出力へ、失敗時は診断を標準エラー出力へ表示する。

    Returns:
        生成または照合がすべて成功した場合は0。不一致・欠落、入力の構文・
        宣言の不正、入出力・文字コード・C++生成等の処理エラーの場合は1。

    Raises:
        SystemExit: argparseによる--helpの表示時、またはCLI引数が不正な場合。
    """
    arguments = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    arguments.add_argument("--input", type=Path, default=SCRIPT_DIRECTORY / "device.pyi",
                           help="入力.pyi（既定: このスクリプトと同じディレクトリー）")
    arguments.add_argument("--output", type=Path,
                           default=PROJECT_DIRECTORY / "public/diagram/device/device-api.json",
                           help="出力JSON（既定: uroa/public/diagram/device/device-api.json）")
    arguments.add_argument("--cpp-header", type=Path,
                           default=PROJECT_DIRECTORY.parent / "esp32/app/diagram-control/include/device_api.generated.h",
                           help="出力C++ヘッダー")
    arguments.add_argument("--cpp-source", type=Path,
                           default=PROJECT_DIRECTORY.parent / "esp32/app/diagram-control/src/device_api.generated.cpp",
                           help="出力C++実装（ヘッダー名はdevice_api.generated.h）")
    arguments.add_argument("--json-only", action="store_true", help="従来通りJSONだけを生成する")
    arguments.add_argument("--check", action="store_true", help="出力せず、生成対象の全成果物との完全一致を確認する")
    options = arguments.parse_args()
    try:
        interface = InterfaceParser(options.input).parse()
        content = (json.dumps(interface, ensure_ascii=False, indent=4) + "\n").encode("utf-8")
        outputs = [(options.output, content)]
        if not options.json_only:
            header, source = generate_cpp(interface)
            outputs.extend([(options.cpp_header, header), (options.cpp_source, source)])
        # すべての検証・生成と出力先重複検査に成功してから各成果物を原子的に置換する。
        paths = [options.input.resolve()] + [path.resolve() for path, _ in outputs]
        if len(set(paths)) != len(paths):
            raise InterfaceError("入力と各出力には異なるファイルを指定してください")
        for path, data in outputs:
            if options.check:
                if not path.is_file() or path.read_bytes() != data:
                    raise InterfaceError(str(path) + ": 未生成または古くなっています。再生成してください")
            else:
                write_output(path, data)
    except SyntaxError as error:
        print("{}:{}:{}: {}".format(options.input, error.lineno, error.offset, error.msg), file=sys.stderr)
        return 1
    except (InterfaceError, OSError, UnicodeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    action = "Checked" if options.check else "Generated"
    for path, _ in outputs:
        print("{} {}".format(action, path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
