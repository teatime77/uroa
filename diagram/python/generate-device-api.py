#!/usr/bin/env python3
"""device.pyiを静的に解析し、コンパイラー用のdevice-api.jsonを生成する。

仕様の正本はこのコメントと各処理のdocstring。Python 3.8以降の標準ライブラリー
だけを使い、入力のimport・exec・evalは行わない。既定の入力は同じディレクトリーの
device.pyi、出力はuroa/public/diagram/device/device-api.json。既定パスは実行時の
作業ディレクトリーに依存しない。--input/--outputの相対パスは作業ディレクトリー基準。
今回はJSONだけを生成し、TypeScriptやC++、コンパイラー・VMの変更は行わない。

入力はクラス、型注釈付きフィールド、位置引数の関数・メソッドに限定する。
各スコープの先頭docstringは無視し、関数本体は...だけを許す。継承、デコレーター、
既定引数、位置専用・キーワード専用・可変長引数、型パラメーター、任意の実行文、
文字列の型注釈は拒否する。メソッドの先頭は注釈なしのselfを必須とする。
型はint/float/str/Noneと、入力内のクラス名。Noneは戻り値だけに許可する。
strはDisplay.printとモジュール関数printのtext引数だけに許可し、両APIは
(text: str) -> Noneに限定する。Vec3/IMUValueだけが公開フィールドを持てる。

JSONのschemaVersion/callingConventionVersion/stringPolicyVersionは1。
classes/functionsと、各クラスのconstructor/methods/fieldsを出力する。
classId相当のidはクラス宣言順、functionId相当のidは関数宣言順で1から。
methodId相当のidはクラスごとに__init__=0、通常メソッドを宣言順で1から。
fieldId相当のidはクラスごとのフィールド宣言順で1から。すべてuint16範囲。
constructorが未宣言ならnullとし、暗黙に作らない。selfはparametersに含めない。
コンストラクターのreturnTypeは宣言のnone、resultTypeは生成されるobject型。
フィールドはreadable/writableともtrue。型は{"kind": "int"}等の形式とし、
クラス型だけは{"kind": "object", "classId": id}とする。

abiHashは、abiHash自身を除いたJSON全体をsort_keys=True、ensure_ascii=False、
separators=(",", ":")で正規化したUTF-8のSHA-256（小文字16進64桁）。
通常の出力は4スペース整形・末尾LF付き。位置・パス・日時・docstringは含めない。
宣言順やシグネチャの変更で指紋が変わる。意味・呼出し規約の変更時は対応する版を
更新する。将来のC++生成はこのJSONと同じID・型・指紋を使用すること。

解析・検証・シリアライズの成功後にだけ出力を一時ファイル経由で置換する。
--checkは出力を変更せず、生成予定のバイト列と一致すれば0、不一致・欠落・エラーは1。
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


SCRIPT_DIRECTORY = Path(__file__).resolve().parent
PROJECT_DIRECTORY = SCRIPT_DIRECTORY.parent.parent
MAX_ID = 0xFFFF
RECORD_CLASSES = {"Vec3", "IMUValue"}
PRIMITIVE_TYPES = {"int", "float", "str"}


class InterfaceError(Exception):
    """入力.pyiの宣言・型が対応範囲外であることを表す。"""


class InterfaceParser:
    """名前を先に登録し、前方参照を解決してから宣言順のJSONを構築する。"""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.class_ids: Dict[str, int] = {}

    def fail(self, node: ast.AST, message: str) -> NoReturn:
        """対象ファイルと1始まりの行・列を付けて生成を中止する。"""
        line = getattr(node, "lineno", 1)
        column = getattr(node, "col_offset", 0) + 1
        raise InterfaceError("{}:{}:{}: {}".format(self.path, line, column, message))

    def body(self, nodes: List[ast.stmt]) -> List[ast.stmt]:
        """先頭の説明用docstringだけを除外する。"""
        if nodes and isinstance(nodes[0], ast.Expr):
            value = nodes[0].value
            if isinstance(value, ast.Constant) and isinstance(value.value, str):
                return nodes[1:]
        return nodes

    def register(self, names: Set[str], name: str, node: ast.AST) -> None:
        """同一スコープでの重複名を拒否する。"""
        if name in names:
            self.fail(node, "名前が重複しています: " + name)
        names.add(name)

    def check_id(self, value: int, node: ast.AST) -> int:
        """連番の上限を検査し、範囲外を切り詰めない。"""
        if value > MAX_ID:
            self.fail(node, "IDがuint16の上限65535を超えています")
        return value

    def read_type(self, node: Optional[ast.AST], owner: ast.AST,
                  allow_none: bool = False) -> Dict[str, Any]:
        """型注釈を実行せず、組込み型名か登録済みクラスIDへ解決する。"""
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
        """selfを除いた明示引数と戻り値を検証して呼出し情報を作る。"""
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

        result = {
            "id": self.check_id(api_id, node),
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
        """recordの公開フィールドと、クラスごとのメソッドIDを構築する。"""
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
        """入力全体を検証してJSON本体と、その本体のABI指紋を作る。"""
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
            if isinstance(node, ast.ClassDef):
                self.class_ids[node.name] = self.check_id(len(self.class_ids) + 1, node)

        classes = []
        functions = []
        for node in declarations:
            if isinstance(node, ast.ClassDef):
                classes.append(self.read_class(node))
            else:
                functions.append(self.read_callable(node, len(functions) + 1))
        result = {
            "schemaVersion": 1,
            "callingConventionVersion": 1,
            "stringPolicyVersion": 1,
            "classes": classes,
            "functions": functions,
        }
        canonical = json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        result["abiHash"] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        return result


def write_output(path: Path, content: bytes) -> None:
    """検証済み内容だけを同じディレクトリーの一時ファイルから原子的に置換する。"""
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
    """CLIで生成または既存成果物との照合を行い、成功時0を返す。"""
    arguments = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    arguments.add_argument("--input", type=Path, default=SCRIPT_DIRECTORY / "device.pyi",
                           help="入力.pyi（既定: このスクリプトと同じディレクトリー）")
    arguments.add_argument("--output", type=Path,
                           default=PROJECT_DIRECTORY / "public/diagram/device/device-api.json",
                           help="出力JSON（既定: uroa/public/diagram/device/device-api.json）")
    arguments.add_argument("--check", action="store_true", help="出力せず、既存JSONとの完全一致を確認する")
    options = arguments.parse_args()
    try:
        if options.input.resolve() == options.output.resolve():
            raise InterfaceError("入力と出力には異なるファイルを指定してください")
        interface = InterfaceParser(options.input).parse()
        content = (json.dumps(interface, ensure_ascii=False, indent=4) + "\n").encode("utf-8")
        if options.check:
            if not options.output.is_file() or options.output.read_bytes() != content:
                raise InterfaceError(str(options.output) + ": JSONが未生成または古くなっています。再生成してください")
        else:
            write_output(options.output, content)
    except SyntaxError as error:
        print("{}:{}:{}: {}".format(options.input, error.lineno, error.offset, error.msg), file=sys.stderr)
        return 1
    except (InterfaceError, OSError, UnicodeError) as error:
        print(str(error), file=sys.stderr)
        return 1
    action = "Checked" if options.check else "Generated"
    print("{} {} ({} classes, {} functions)".format(
        action, options.output, len(interface["classes"]), len(interface["functions"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
