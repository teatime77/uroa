/**
 * global文の宣言収集・宣言順検査を、意味解析と意味解析なしの生成経路で共有する。
 * parser.tsがGlobalStatementを作り、semantic.tsは診断を蓄積、bytecode.tsの従来経路は
 * 最初の違反で生成を拒否する。名前の型・スロット割当てはそれぞれの呼出し元が担当する。
 */
import {
    AbstractSyntaxNode, App, BlockStatement, CallStatement, Fn, ForStatement, GlobalStatement,
    IfStatement, RefVar, ReturnStatement, Term, Variable, WhileStatement
} from "./syntax";

/**
 * 同じスコープのglobal名を収集する。if・while等の内側も含め、入れ子の関数本体には入らない。
 * globalの宣言は関数全体で読み書きをモジュールへ向け、宣言自体では変数・値を作らない。
 * モジュール直下では束縛を変えない。宣言より前の参照・代入と仮引数との衝突は診断する。
 * 属性名・演算子名を変数の使用と数えず、属性の対象・添字・引数・f文字列の置換式は走査する。
 * paramsと衝突した名前は回復用の集合から外し、仮引数を局所変数として解析できるようにする。
 * 関数内でglobal宣言した名前への代入は、モジュール直下に同名の代入がなくても大域領域を作る。
 * global未指定の代入は従来どおり局所変数。nonlocal・クロージャには対応しない。
 */
export function collectScopeGlobals(
    block: BlockStatement,
    parameters: readonly Variable[],
    report: (node: AbstractSyntaxNode, message: string) => void
): Set<string> {
    const globals = new Set<string>();
    const parameterNames = new Set(parameters.map(parameter => parameter.name));
    const seen = new Set<string>();

    const expression = (term: Term): void => {
        if (term instanceof RefVar) {
            seen.add(term.name);
        }
        else if (term instanceof App) {
            if (term.fncName === ".") {
                expression(term.args[0]);
                return;
            }
            // 通常の関数呼出しは関数名の参照でもある。演算子や疑似関数名は含めない。
            if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(term.fncName)) {
                seen.add(term.fncName);
            }
            for (const argument of term.args) {
                expression(argument);
            }
        }
    };

    const statement = (node: AbstractSyntaxNode): void => {
        if (node instanceof GlobalStatement) {
            for (const name of node.names) {
                if (parameterNames.has(name.name)) {
                    report(name, `仮引数をglobal宣言できません: ${name.name}`);
                    continue;
                }
                if (seen.has(name.name)) {
                    report(name, `global宣言より前に参照または代入されています: ${name.name}`);
                }
                globals.add(name.name);
            }
        }
        else if (node instanceof Fn) {
            seen.add(node.name);
        }
        else if (node instanceof CallStatement) {
            expression(node.app);
        }
        else if (node instanceof ReturnStatement) {
            if (node.value !== undefined) {
                expression(node.value);
            }
        }
        else if (node instanceof IfStatement) {
            expression(node.condition);
            statement(node.ifBlock);
            if (node.elseIf !== undefined) {
                statement(node.elseIf);
            }
            if (node.elseBlock !== undefined) {
                statement(node.elseBlock);
            }
        }
        else if (node instanceof WhileStatement) {
            expression(node.condition);
            statement(node.block);
        }
        else if (node instanceof ForStatement) {
            expression(node.list);
            seen.add(node.initializer.name);
            statement(node.block);
        }
        else if (node instanceof BlockStatement) {
            for (const child of node.statements) {
                statement(child);
            }
        }
    };
    statement(block);
    return globals;
}
