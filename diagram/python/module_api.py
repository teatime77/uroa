"""device.pyi内の組込みモジュール宣言を静的に解析する。

第1段階ではnumpyだけを名前空間として扱う。通常のdevice/recordとは別の定義であり、
ネイティブ登録や実行処理は生成しない。generate-device-api.pyがJSONへ含め、
device_api_cpp.pyが同じ定義から必須引数番号・optionIdのenumを生成する。
呼出し時の既定値はC++側に置くため、宣言の省略可能マーカーには...だけを許す。
moduleDefinitionVersion=1の定義と宣言順は既存のAPI全体のabiHashに含める。
"""

import ast
from typing import Any, Callable, Dict, List, NoReturn, Set


# classを機器クラスでなくモジュール名前空間として解釈する宣言名。
MODULE_NAMES = {"numpy"}
# モジュール内で宣言する型名と、JSONへ出す形式型の対応。
TYPE_KINDS = {
    "Shape": "shape", "DType": "dtype", "Device": "device",
    "ArrayLike": "array_like", "ndarray": "ndarray",
}


class ModuleParser:
    """入力ASTを実行せず、モジュールの型・定数・関数の定義を作る。"""

    def __init__(self, report: Callable[[ast.AST, str], NoReturn]) -> None:
        """位置付きエラーを生成器と共通にするため、報告関数を受け取る。

        Args:
            report: ASTノードと説明を受け取り、例外を送出する診断関数。
        """
        self.report = report  # 呼出し元のファイル・行・列を含む診断関数。
        self.types: Dict[str, str] = {}  # このモジュールで先に登録した型名。

    def fail(self, node: ast.AST, message: str) -> NoReturn:
        """未対応の宣言・形式を位置付きで拒否する。

        Args:
            node: 診断位置となる入力ASTノード。
            message: モジュール名の接頭辞を付けて報告する説明。

        Raises:
            InterfaceError: 呼出し元の診断関数が常に送出する入力形式エラー。
        """
        self.report(node, "組込みモジュール: " + message)

    def body(self, nodes: List[ast.stmt]) -> List[ast.stmt]:
        """宣言の先頭にある説明用docstringだけを除く。

        Args:
            nodes: クラスまたは関数の本体を構成する文列。

        Returns:
            先頭docstringを除いた文列。docstringがなければ元の文列。
        """
        if nodes and isinstance(nodes[0], ast.Expr) and isinstance(nodes[0].value, ast.Constant):
            if isinstance(nodes[0].value.value, str):
                return nodes[1:]
        return nodes

    def empty_body(self, node: Any) -> None:
        """型や関数の宣言本体を...に限定し、実行文を受け付けない。

        Args:
            node: body属性を持つ型または関数の宣言ノード。

        Raises:
            InterfaceError: docstringを除いた本体が単一の...ではない場合。
        """
        body = self.body(node.body)
        if (len(body) != 1 or not isinstance(body[0], ast.Expr)
                or not isinstance(body[0].value, ast.Constant) or body[0].value.value is not Ellipsis):
            self.fail(node, "宣言本体は...にしてください")

    def type_name(self, node: ast.AST) -> str:
        """宣言済みのモジュール専用型、またはstrを形式の型名へ変換する。

        Args:
            node: 引数・戻り値・定数の型注釈ノード。

        Returns:
            JSONとC++生成器で共有する形式型の名前。

        Raises:
            InterfaceError: 未知の型名または未対応の型注釈の場合。
        """
        if isinstance(node, ast.Name):
            if node.id == "str":
                return "str"
            if node.id in self.types:
                return self.types[node.id]
        self.fail(node, "未知または未対応の型です")

    def function(self, node: ast.FunctionDef, function_id: int) -> Dict[str, Any]:
        """宣言順の引数と、省略可能な項目だけの0始まりoptionIdを構築する。

        positionはPythonの位置指定可能引数の番号で、キーワード専用ならNone。
        必須引数のoptionIdはNone。省略時の値はJSONへ含めず、C++実装が設定する。
        *args/**kwargs・位置専用引数・必須キーワード専用引数は第1段階の対象外。

        Args:
            node: 静的関数の宣言ノード。
            function_id: モジュール内の宣言順で割り当てる1始まりの関数ID。

        Returns:
            関数ID・名前・引数定義・戻り値の形式型を含む辞書。

        Raises:
            InterfaceError: 宣言形式・型・既定値・引数名・IDの制約に違反する場合。
        """
        if (len(node.decorator_list) != 1 or not isinstance(node.decorator_list[0], ast.Name)
                or node.decorator_list[0].id != "staticmethod" or getattr(node, "type_params", [])):
            self.fail(node, "モジュール関数は@staticmethodとして宣言してください")
        args = node.args
        if args.posonlyargs or args.vararg is not None or args.kwarg is not None:
            self.fail(node, "位置専用・可変長引数は未対応です")
        self.empty_body(node)
        parameters = []
        names: Set[str] = set()
        required_count = len(args.args) - len(args.defaults)
        option_id = 0
        declarations = []
        for position, parameter in enumerate(args.args):
            default = None if position < required_count else args.defaults[position - required_count]
            declarations.append((parameter, position, default))
        declarations.extend((parameter, None, default) for parameter, default in zip(args.kwonlyargs, args.kw_defaults))
        for parameter, position, default in declarations:
            if parameter.arg in names:
                self.fail(parameter, "引数名が重複しています: " + parameter.arg)
            names.add(parameter.arg)
            if position is None and default is None:
                self.fail(parameter, "キーワード専用引数は省略可能として宣言してください")
            required = default is None
            if not required and (not isinstance(default, ast.Constant) or default.value is not Ellipsis):
                self.fail(default, "省略可能な引数は= ...とし、既定値はC++側に置いてください")
            parameters.append({
                "name": parameter.arg, "type": self.type_name(parameter.annotation),
                "position": position, "required": required,
                "optionId": None if required else option_id,
            })
            if not required:
                option_id += 1
        if len(parameters) > 65535 or not 1 <= function_id <= 65535:
            self.fail(node, "関数または引数の数が上限を超えています")
        return {"id": function_id, "name": node.name, "parameters": parameters,
                "returnType": self.type_name(node.returns)}

    def parse(self, node: ast.ClassDef) -> Dict[str, Any]:
        """numpyクラスを実体のないモジュール宣言として読む。クラスIDは割り当てない。

        Args:
            node: device.pyiに記述されたモジュール名前空間のクラス宣言。

        Returns:
            モジュール名と型・定数・関数の宣言順一覧を含む辞書。

        Raises:
            InterfaceError: 未対応の宣言、名前の重複、型や関数の形式違反の場合。
        """
        if (node.name not in MODULE_NAMES or node.bases or node.keywords or node.decorator_list
                or getattr(node, "type_params", [])):
            self.fail(node, "未対応のモジュール宣言です")
        declarations = self.body(node.body)
        names: Set[str] = set()
        types = []
        for member in declarations:
            if isinstance(member, ast.ClassDef):
                if (member.name not in TYPE_KINDS or member.bases or member.keywords or member.decorator_list
                        or getattr(member, "type_params", [])):
                    self.fail(member, "未対応のモジュール型宣言です")
                self.empty_body(member)
                if member.name in names:
                    self.fail(member, "宣言名が重複しています: " + member.name)
                names.add(member.name)
                self.types[member.name] = TYPE_KINDS[member.name]
                types.append({"name": member.name, "kind": TYPE_KINDS[member.name]})
        constants = []
        functions = []
        for member in declarations:
            if isinstance(member, ast.ClassDef):
                continue
            if isinstance(member, ast.FunctionDef):
                name = member.name
            elif isinstance(member, ast.AnnAssign) and isinstance(member.target, ast.Name):
                name = member.target.id
            else:
                self.fail(member, "型・定数・静的関数の宣言だけを使用してください")
            if name in names:
                self.fail(member, "宣言名が重複しています: " + name)
            names.add(name)
            if isinstance(member, ast.FunctionDef):
                functions.append(self.function(member, len(functions) + 1))
            else:
                if member.value is not None or self.type_name(member.annotation) != "dtype":
                    self.fail(member, "定数は値を持たないDType宣言にしてください")
                constants.append({"name": name, "type": "dtype"})
        return {"name": node.name, "types": types, "constants": constants, "functions": functions}
