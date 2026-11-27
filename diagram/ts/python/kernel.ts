/**
 * @kernelの宣言・数値型・純粋性と、1要素分の独立した書込みを検査する。
 * parser.ts/syntax.tsが型注釈とデコレーターを保持し、semantic.tsが通常VMの型推論とlaunchを接続する。
 * C生成、CALL_KERNEL、実行時の配列共有検査は後段で実装する。本処理は実行時検査を生成しない。
 */
import {
    AbstractSyntaxNode, App, BlockStatement, CallStatement, ConstNum, Fn, ForStatement,
    IfStatement, KeywordArgument, Module, RefVar, ReturnStatement, Statement, Term, WhileStatement,
    Variable, indexOpr
} from "./syntax";

/** カーネル内だけの静的型。配列モードとboolをVMのobject/intへ混ぜない。 */
export type PythonKernelType = "int" | "float" | "bool" | "in_f32" | "out_f32" | "none" | "error";

/** 注釈から確定した仮引数。実行インデックスも先頭に保持する。 */
export interface PythonKernelParameter {
    /** Pythonの仮引数名。 */
    name: string;
    /** 型と入出力モード。 */
    type: PythonKernelType;
}

/** カーネルまたは到達する純粋なスカラーヘルパーの宣言。 */
export interface PythonKernelFunction {
    /** 元の関数宣言。ソース位置を診断と後段へ引き継ぐ。 */
    node: Fn;
    /** 宣言順の仮引数。カーネルでは実行インデックスを含む。 */
    parameters: readonly PythonKernelParameter[];
    /** 注釈で指定した戻り値型。カーネルではnone。 */
    returnType: PythonKernelType;
}

/** コンパイル時に解決したlaunch。第1引数の関数名を実行時の値にしない。 */
export interface PythonKernelLaunch {
    /** 呼出すカーネルの宣言。 */
    kernel: PythonKernelFunction;
    /** 実行要素数の未評価式。 */
    count: Term;
    /** 実行インデックスを除く、未評価の明示引数。 */
    arguments: readonly Term[];
}

/** 通常のVM型・スロット配置とは独立した、カーネルの意味解析結果。 */
export interface PythonKernelAnalysis {
    /** モジュール直下のカーネルをPython名で引く表。 */
    kernels: ReadonlyMap<string, PythonKernelFunction>;
    /** カーネルから到達したスカラーヘルパー。 */
    helpers: ReadonlyMap<string, PythonKernelFunction>;
    /** カーネルとヘルパー内の式の型。 */
    types: ReadonlyMap<Term, PythonKernelType>;
    /** 各関数の仮引数とローカル変数の単一型。 */
    locals: ReadonlyMap<Fn, ReadonlyMap<string, PythonKernelType>>;
    /** 静的に解決したヘルパー呼出し。 */
    calls: ReadonlyMap<App, PythonKernelFunction>;
}

/** @kernelの有無だけを調べる。重複や配置の正否は宣言検査で診断する。 */
export function isKernelFunction(fn: Fn): boolean {
    return fn.decorators.some(decorator => decorator.name === "kernel");
}

/** 関数ごとの固定型と、現在の経路の初期化済み変数を分けて管理する。 */
interface KernelScope {
    /** 解析対象の署名。 */
    fn: PythonKernelFunction;
    /** 仮引数とローカル変数の単一型。 */
    variables: Map<string, PythonKernelType>;
    /** 再代入を禁止する実行インデックスとforの制御変数。 */
    readonlyNames: Set<string>;
}

/** スカラーヘルパーの注釈にも使う、実行しない注釈名の変換表。 */
const annotationTypes = new Map<string, PythonKernelType>([
    ["int", "int"], ["float", "float"], ["None", "none"], ["InF32", "in_f32"], ["OutF32", "out_f32"]
]);

/** カーネル解析で数値として扱える型。boolは数値変換しない。 */
function isNumeric(type: PythonKernelType): boolean {
    return type === "int" || type === "float";
}

/** 数値リテラルと単項符号を、ループのステップ等の静的解析だけに使う。 */
function constantInteger(term: Term): number | undefined {
    if (term instanceof ConstNum && !/[.eE]/.test(term.text)) {
        return term.value;
    }
    if (term instanceof App && term.args.length === 1 && ["+", "-"].includes(term.fncName)) {
        const value = constantInteger(term.args[0]);
        return value === undefined ? undefined : term.fncName === "-" ? -value : value;
    }
    return undefined;
}

/**
 * カーネル本体を通常のVM推論から分離し、静的にCへ渡せる範囲だけを検査する。
 * 配列の値・添字範囲・オーバーフロー・ゼロ除算・有限性は検査しない。
 * 出力はout[i]だけ、iは再代入禁止。入力の読取りと出力の書込みを別モードとして追跡する。
 * ヘルパーは注釈付きのスカラー関数だけとし、大域参照・循環呼出し・副作用を拒否する。
 */
export function analyzePythonKernels(
    module: Module,
    report: (node: AbstractSyntaxNode, message: string) => void
): PythonKernelAnalysis {
    const kernels = new Map<string, PythonKernelFunction>();
    const helpers = new Map<string, PythonKernelFunction>();
    const functions = new Map<string, Fn>();
    const types = new Map<Term, PythonKernelType>();
    const locals = new Map<Fn, Map<string, PythonKernelType>>();
    const calls = new Map<App, PythonKernelFunction>();
    const visiting = new Set<Fn>();
    const checked = new Set<Fn>();
    const topLevel = new Set(module.block.statements);
    const allNodes: AbstractSyntaxNode[] = [];
    module.getAll(allNodes);

    /** 問題の元位置を通常の意味診断へ渡し、依存式にerror型を返す。 */
    const fail = (node: AbstractSyntaxNode, message: string): PythonKernelType => {
        report(node, message);
        return "error";
    };

    /** 明示型を読む。欠落と未対応名を元の注釈または宣言位置で診断する。 */
    const annotation = (node: AbstractSyntaxNode, value: RefVar | undefined): PythonKernelType => {
        if (value === undefined) {
            return fail(node, "カーネルとスカラーヘルパーは引数・戻り値の型注釈が必要です");
        }
        return annotationTypes.get(value.name) ?? fail(value, `未対応の型注釈です: ${value.name}`);
    };

    /** 全宣言を先に登録し、定義順に依存しない呼出し検査を行う。 */
    const signature = (fn: Fn, kernel: boolean): PythonKernelFunction => {
        const parameters = fn.args.map(parameter => ({ name: parameter.name, type: annotation(parameter, parameter.annotation) }));
        const returnType = annotation(fn, fn.returnAnnotation);
        if (kernel) {
            if (parameters.length === 0 || parameters[0].type !== "int") {
                fail(fn.args[0] ?? fn, "@kernelの先頭引数は実行インデックスのintにしてください");
            }
            if (returnType !== "none" && returnType !== "error") {
                fail(fn.returnAnnotation ?? fn, "@kernelの戻り値はNoneにしてください");
            }
            for (const [index, parameter] of parameters.entries()) {
                if (index > 0 && !isNumeric(parameter.type) && !["in_f32", "out_f32", "error"].includes(parameter.type)) {
                    fail(fn.args[index], "カーネル引数はint・float・InF32・OutF32にしてください");
                }
            }
        }
        else if (parameters.some(parameter => !isNumeric(parameter.type) && parameter.type !== "error")
            || !isNumeric(returnType) && returnType !== "error") {
            fail(fn, "カーネルの補助関数は引数・戻り値をintまたはfloatにしてください");
        }
        return { node: fn, parameters, returnType };
    };

    for (const node of allNodes) {
        if (!(node instanceof Fn)) {
            continue;
        }
        for (const decorator of node.decorators) {
            if (decorator.name !== "kernel") {
                fail(decorator, `未対応のデコレーターです: @${decorator.name}`);
            }
        }
        if (node.decorators.length > 1) {
            fail(node.decorators[1], "デコレーターは@kernelを1個だけ指定してください");
        }
        if (isKernelFunction(node) && !topLevel.has(node)) {
            fail(node, "@kernelはモジュール直下の関数だけに指定できます");
        }
        if (topLevel.has(node)) {
            if (functions.has(node.name)) {
                if (isKernelFunction(node) || isKernelFunction(functions.get(node.name)!)) {
                    fail(node, `カーネルの関数名が重複しています: ${node.name}`);
                }
            }
            else {
                functions.set(node.name, node);
                if (isKernelFunction(node)) {
                    kernels.set(node.name, signature(node, true));
                }
            }
        }
    }

    /** 既知の数値型を要求する。errorに起因する二次診断は出さない。 */
    const requireType = (node: AbstractSyntaxNode, actual: PythonKernelType, expected: PythonKernelType): void => {
        if (actual !== "error" && actual !== expected && !(actual === "int" && expected === "float")) {
            fail(node, `カーネルの型が一致しません: ${expected}が必要ですが${actual}です`);
        }
    };

    /** 式を解析する。配列は添字とlenの対象にだけ許し、スカラー式として返さない。 */
    const expression = (term: Term, scope: KernelScope, initialized: Set<string>): PythonKernelType => {
        let type: PythonKernelType;
        if (term instanceof ConstNum) {
            type = /[.eE]/.test(term.text) ? "float" : "int";
        }
        else if (term instanceof RefVar) {
            if (["True", "False"].includes(term.name)) {
                type = "bool";
            }
            else if (term.name === "None") {
                type = "none";
            }
            else {
                const variable = scope.variables.get(term.name);
                type = variable === undefined ? fail(term, `カーネルから大域変数・未定義名は参照できません: ${term.name}`)
                    : !initialized.has(term.name) ? fail(term, `カーネルの変数は参照前に初期化してください: ${term.name}`)
                    : variable === "in_f32" || variable === "out_f32" ? fail(term, "配列は添字アクセスまたはlenの対象だけに使用できます")
                    : variable;
            }
        }
        else if (term instanceof App) {
            type = operation(term, scope, initialized);
        }
        else {
            type = fail(term, "カーネルでは文字列・一般オブジェクト・キーワード引数を使用できません");
        }
        types.set(term, type);
        return type;
    };

    /** 配列の対象・添字型・読書きモードを検査する。添字の数値や範囲は検査しない。 */
    const array = (app: App, scope: KernelScope, initialized: Set<string>, write: boolean): PythonKernelType => {
        const receiver = app.args[0];
        if (app.args.length !== 2 || !(receiver instanceof RefVar)) {
            return fail(app, "カーネルの配列は宣言された1次元配列を直接参照してください");
        }
        const mode = scope.variables.get(receiver.name);
        if (mode !== undefined) {
            types.set(receiver, mode);
        }
        if (mode !== (write ? "out_f32" : "in_f32")) {
            fail(receiver, write ? "書込み先はOutF32だけにしてください" : "読取り先はInF32だけにしてください。OutF32の要素は読めません");
        }
        requireType(app.args[1], expression(app.args[1], scope, initialized), "int");
        if (write && (!(app.args[1] instanceof RefVar) || app.args[1].name !== scope.fn.parameters[0]?.name)) {
            fail(app.args[1], "OutF32の書込み先は実行インデックスのout[i]だけにしてください");
        }
        types.set(app, "float");
        return "float";
    };

    /** 許可した演算・組込み・静的ヘルパー呼出しだけを解決する。 */
    const operation = (app: App, scope: KernelScope, initialized: Set<string>): PythonKernelType => {
        const name = app.fncName;
        if (name === indexOpr) {
            return array(app, scope, initialized, false);
        }
        if (name === "len") {
            const receiver = app.args[0];
            if (app.args.length !== 1 || !(receiver instanceof RefVar)
                || !["in_f32", "out_f32"].includes(scope.variables.get(receiver.name) ?? "")) {
                return fail(app, "カーネルのlenは配列引数1個に使用してください");
            }
            types.set(receiver, scope.variables.get(receiver.name)!);
            return "int";
        }
        const argumentsTypes = app.args.map(argument => expression(argument instanceof KeywordArgument ? argument.value : argument, scope, initialized));
        if (app.args.some(argument => argument instanceof KeywordArgument)) {
            return fail(app, "カーネル内ではキーワード引数を使用できません");
        }
        if (name === "<compare>") {
            if (app.comparisonOperators.some(operator => !["==", "!=", "<", "<=", ">", ">="].includes(operator))) {
                return fail(app, "カーネルでは数値の比較だけに対応しています");
            }
            for (const [index, type] of argumentsTypes.entries()) {
                if (!isNumeric(type) && type !== "error") {
                    fail(app.args[index], "カーネルの比較には数値が必要です");
                }
            }
            return "bool";
        }
        if (["not", "and", "or"].includes(name)) {
            for (const [index, type] of argumentsTypes.entries()) {
                requireType(app.args[index], type, "bool");
            }
            return "bool";
        }
        if (["+", "-", "*", "/", "abs", "min", "max", "float"].includes(name)) {
            const count = name === "abs" || name === "float" ? 1 : name === "min" || name === "max" || name === "*" || name === "/" ? 2 : app.args.length;
            if (app.args.length !== count || count < 1 || count > 2) {
                return fail(app, `${name}の引数数が不正です`);
            }
            for (const [index, type] of argumentsTypes.entries()) {
                if (!isNumeric(type) && type !== "error") {
                    fail(app.args[index], "カーネルの演算にはintまたはfloatが必要です");
                }
            }
            if (name === "float") {
                requireType(app.args[0], argumentsTypes[0], "int");
            }
            return name === "/" || name === "float" || argumentsTypes.includes("float") ? "float" : "int";
        }
        const helper = functions.get(name);
        if (helper !== undefined && !isKernelFunction(helper)) {
            let target = helpers.get(name);
            if (target === undefined) {
                target = signature(helper, false);
                helpers.set(name, target);
            }
            if (target.parameters.length !== app.args.length) {
                fail(app, `${name}の引数は${target.parameters.length}個必要です`);
            }
            for (const [index, parameter] of target.parameters.entries()) {
                if (index < argumentsTypes.length) {
                    requireType(app.args[index], argumentsTypes[index], parameter.type);
                }
            }
            calls.set(app, target);
            if (visiting.has(helper)) {
                fail(app, "カーネルの補助関数は再帰・循環呼出しを使用できません");
            }
            else {
                checkFunction(target);
            }
            return target.returnType;
        }
        return fail(app, `カーネル内では未対応の演算・呼出しです: ${name}`);
    };

    /** スカラー代入の固定型・読取り専用制約を確認する。配列の別名は作らない。 */
    const assign = (target: RefVar | Variable, type: PythonKernelType, scope: KernelScope, initialized: Set<string>): void => {
        if (scope.readonlyNames.has(target.name)) {
            fail(target, `実行インデックス・forの制御変数へ再代入できません: ${target.name}`);
            return;
        }
        if (["kernel", "launch", "InF32", "OutF32", "len", "range", "abs", "min", "max", "int", "float"].includes(target.name)
            || functions.has(target.name)) {
            fail(target, `組込み・関数名へ代入できません: ${target.name}`);
            return;
        }
        const previous = scope.variables.get(target.name);
        if (previous === "in_f32" || previous === "out_f32") {
            fail(target, "配列引数を再代入・別名化できません");
            return;
        }
        if (type !== "error" && !isNumeric(type) && type !== "bool") {
            fail(target, "カーネルのローカル変数は数値またはboolだけにしてください");
            return;
        }
        if (previous !== undefined) {
            requireType(target, type, previous);
        }
        else {
            scope.variables.set(target.name, type);
        }
        if (target instanceof RefVar) {
            types.set(target, scope.variables.get(target.name)!);
        }
        initialized.add(target.name);
    };

    /** whileの制御変数・不変な上限・無条件の末尾更新を保守的に確認する。 */
    const finiteWhile = (statement: WhileStatement, scope: KernelScope): void => {
        const condition = statement.condition;
        const nodes: AbstractSyntaxNode[] = [];
        statement.block.getAll(nodes);
        if (!(condition instanceof App) || condition.fncName !== "<compare>" || condition.comparisonOperators.length !== 1
            || !(condition.args[0] instanceof RefVar) || !["<", "<=", ">", ">="].includes(condition.comparisonOperators[0])) {
            fail(statement, "whileは整数変数と不変な上限を比較する単純な有限ループにしてください");
            return;
        }
        const counter = condition.args[0].name;
        const updates = nodes.filter((node): node is App => node instanceof App && node.isAssignmentApp()
            && node.args[0] instanceof RefVar && node.args[0].name === counter);
        const last = statement.block.statements[statement.block.statements.length - 1];
        const update = updates[0];
        let step: number | undefined;
        if (update?.fncName === "+=" || update?.fncName === "-=") {
            const value = constantInteger(update.args[1]);
            step = value === undefined ? undefined : update.fncName === "-=" ? -value : value;
        }
        else if (update?.fncName === "=" && update.args[1] instanceof App) {
            const right = update.args[1];
            if (right.args.length === 2 && right.args[0] instanceof RefVar && right.args[0].name === counter) {
                const value = constantInteger(right.args[1]);
                step = value === undefined ? undefined : right.fncName === "+" ? value : right.fncName === "-" ? -value : undefined;
            }
        }
        const assigned = new Set(nodes.flatMap(node => node instanceof App && node.isAssignmentApp() && node.args[0] instanceof RefVar
            ? [node.args[0].name] : node instanceof ForStatement ? [node.initializer.name] : []));
        const boundNodes: AbstractSyntaxNode[] = [];
        condition.args[1].getAll(boundNodes);
        if (scope.variables.get(counter) !== "int" || types.get(condition.args[1]) !== "int"
            || scope.readonlyNames.has(counter) || updates.length !== 1
            || !(last instanceof CallStatement) || last.app !== update || step === undefined || !Number.isSafeInteger(step) || step === 0
            || (condition.comparisonOperators[0].startsWith("<") ? step < 0 : step > 0)
            || nodes.some(node => node instanceof Statement && node.keyword === "continue")
            || nodes.some(node => node instanceof ForStatement && node.initializer.name === counter)
            || boundNodes.some(node => node instanceof RefVar && assigned.has(node.name))) {
            fail(statement, "whileは制御変数を末尾で一定量更新し、上限を変更せずcontinueを使わない有限ループにしてください");
        }
    };

    /** 文列の各経路を確認する。戻る経路だけで初期化済み集合を合流する。 */
    const block = (body: BlockStatement, scope: KernelScope, initialized: Set<string>): boolean => {
        let fallsThrough = true;
        for (const statement of body.statements) {
            let continues = true;
            if (statement instanceof CallStatement) {
                const app = statement.app;
                if (app instanceof App && app.isAssignmentApp()) {
                    const target = app.args[0];
                    const right = expression(app.args[1], scope, initialized);
                    if (target instanceof RefVar) {
                        let type = right;
                        if (app.fncName !== "=") {
                            const left = expression(target, scope, initialized);
                            if (!["+=", "-=", "*=", "/="].includes(app.fncName) || !isNumeric(left) || !isNumeric(right)) {
                                fail(app, "カーネルの複合代入は数値の+=・-=・*=・/=だけに対応しています");
                            }
                            type = app.fncName === "/=" || left === "float" || right === "float" ? "float" : "int";
                        }
                        assign(target, type, scope, initialized);
                    }
                    else if (target instanceof App && target.fncName === indexOpr) {
                        array(target, scope, initialized, true);
                        requireType(app.args[1], right, "float");
                        if (app.fncName !== "=") {
                            fail(app, "OutF32は読取りを伴う複合代入に使用できません");
                        }
                    }
                    else {
                        fail(app, "カーネルの代入先はスカラー変数またはout[i]にしてください");
                    }
                }
                else {
                    expression(app, scope, initialized);
                }
            }
            else if (statement instanceof ReturnStatement) {
                const actual = statement.value === undefined ? "none" : expression(statement.value, scope, initialized);
                requireType(statement, actual, scope.fn.returnType);
                continues = false;
            }
            else if (statement instanceof IfStatement) {
                requireType(statement.condition, expression(statement.condition, scope, initialized), "bool");
                const first = new Set(initialized);
                const second = new Set(initialized);
                const firstContinues = block(statement.ifBlock, scope, first);
                const alternative = statement.elseIf === undefined ? statement.elseBlock : new BlockStatement([statement.elseIf]);
                const secondContinues = alternative === undefined || block(alternative, scope, second);
                const paths = [firstContinues ? first : undefined, secondContinues ? second : undefined]
                    .filter((path): path is Set<string> => path !== undefined);
                initialized.clear();
                for (const name of paths[0] ?? []) {
                    if (paths.every(path => path.has(name))) {
                        initialized.add(name);
                    }
                }
                continues = paths.length !== 0;
            }
            else if (statement instanceof WhileStatement) {
                requireType(statement.condition, expression(statement.condition, scope, initialized), "bool");
                finiteWhile(statement, scope);
                block(statement.block, scope, new Set(initialized));
            }
            else if (statement instanceof ForStatement) {
                const range = statement.list;
                if (!(range instanceof App) || range.fncName !== "range" || range.args.length < 1 || range.args.length > 3) {
                    fail(range, "カーネルのforは整数のrangeだけに対応しています");
                }
                else {
                    for (const argument of range.args) {
                        requireType(argument, expression(argument, scope, initialized), "int");
                    }
                    if (range.args.length === 3) {
                        const step = constantInteger(range.args[2]);
                        if (step === undefined || !Number.isSafeInteger(step) || step <= 0) {
                            fail(range.args[2], "rangeのステップは正の整数定数にしてください");
                        }
                    }
                }
                const inner = new Set(initialized);
                if (scope.variables.has(statement.initializer.name) && scope.variables.get(statement.initializer.name) !== "int") {
                    fail(statement.initializer, "forの制御変数はintにしてください");
                }
                assign(statement.initializer, "int", scope, inner);
                const alreadyReadonly = scope.readonlyNames.has(statement.initializer.name);
                scope.readonlyNames.add(statement.initializer.name);
                block(statement.block, scope, inner);
                if (!alreadyReadonly) {
                    scope.readonlyNames.delete(statement.initializer.name);
                }
            }
            else if (["break", "continue"].includes(statement.keyword)) {
                continues = false;
            }
            else if (statement.keyword !== "pass") {
                fail(statement, "カーネルでは宣言・import・global・機器処理などの文を使用できません");
            }
            fallsThrough = fallsThrough && continues;
        }
        return fallsThrough;
    };

    /** 関数を1回だけ解析し、ヘルパーの循環と戻り値欠落を診断する。 */
    const checkFunction = (fn: PythonKernelFunction): void => {
        if (checked.has(fn.node)) {
            return;
        }
        visiting.add(fn.node);
        const variables = new Map(fn.parameters.map(parameter => [parameter.name, parameter.type]));
        for (const parameter of fn.node.args) {
            if (["kernel", "launch", "InF32", "OutF32", "int", "float", "len", "range", "abs", "min", "max"].includes(parameter.name)
                || functions.has(parameter.name)) {
                fail(parameter, `組込み・関数名をカーネルの仮引数にできません: ${parameter.name}`);
            }
        }
        const readonlyNames = new Set<string>();
        if (isKernelFunction(fn.node) && fn.parameters.length !== 0) {
            readonlyNames.add(fn.parameters[0].name);
        }
        const scope: KernelScope = { fn, variables, readonlyNames };
        const fallsThrough = block(fn.node.block, scope, new Set(variables.keys()));
        if (fn.returnType !== "none" && fn.returnType !== "error" && fallsThrough) {
            fail(fn.node, "カーネルの補助関数はすべての経路で数値をreturnしてください");
        }
        locals.set(fn.node, variables);
        visiting.delete(fn.node);
        checked.add(fn.node);
    };

    for (const kernel of kernels.values()) {
        checkFunction(kernel);
    }
    return { kernels, helpers, types, locals, calls };
}
