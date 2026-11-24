/**
 * global文の宣言収集・宣言順を検査する。parser.tsがGlobalStatementを作り、
 * semantic.tsが本処理の診断を蓄積して型・スロットを決定する。bytecode.tsはその解析結果を使用する。
 */
import {
    AbstractSyntaxNode, App, BlockStatement, CallStatement, ClassDefinition, Fn, ForStatement, GlobalStatement, KeywordArgument,
    IfStatement, RefVar, ReturnStatement, Term, Variable, WhileStatement
} from "./syntax";

/**
 * 同じスコープのglobal名を収集する。if・while等の内側も含め、関数・クラスの本体には入らない。
 * globalの宣言は関数全体で読み書きをモジュールへ向け、宣言自体では変数・値を作らない。
 * モジュール直下では束縛を変えない。宣言より前の参照・代入と仮引数との衝突は診断する。
 * 属性名・演算子名・キーワード引数名を変数の使用と数えず、その対象・添字・値の式を走査する。
 * paramsと衝突した名前は回復用の集合から外し、仮引数を局所変数として解析できるようにする。
 * 関数内でglobal宣言した名前への代入は、モジュール直下に同名の代入がなくても大域領域を作る。
 * global未指定の代入は従来どおり局所変数。nonlocal・クロージャには対応しない。
 * @param block global宣言と参照・代入の順序を検査するスコープ本体。
 * @param parameters global名との衝突を検査する仮引数一覧。
 * @param report 違反したノードと診断メッセージを受け取る関数。
 * @returns 仮引数との衝突を除いた、このスコープのglobal名の集合。
 */
export function collectScopeGlobals(
    block: BlockStatement,
    parameters: readonly Variable[],
    report: (node: AbstractSyntaxNode, message: string) => void
): Set<string> {
    const globals = new Set<string>();
    const parameterNames = new Set(parameters.map(parameter => parameter.name));
    const seen = new Set<string>();

    /**
     * 式内の変数参照を使用済み名へ登録する。
     * @param term 走査する式。属性名・キーワード引数名は変数参照に含めない。
     */
    const expression = (term: Term): void => {
        if (term instanceof RefVar) {
            seen.add(term.name);
        }
        else if (term instanceof KeywordArgument) {
            expression(term.value);
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

    /**
     * 同じスコープの文を順に走査し、global宣言と参照順を検査する。
     * @param node 走査する文またはブロック。関数・クラスの本体へは入らない。
     */
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
        else if (node instanceof Fn || node instanceof ClassDefinition) {
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
