/**
 * device.proto/options.protoから機器RPCの型・操作表・方向別codec・サーバー振分けと応答を生成する。
 * protobufjsは生成時の標準.proto構文解析だけに使い、生成物へ依存させない。
 * TypeScriptのホスト型は既存の復号済み値と所有参照を保ち、wire_packetだけ固定長codecの対象にする。
 * 未対応の型・属性不足・番号重複は生成前に拒否する。--checkは書き込まず成果物の一致を検査する。
 * codecは各messageのts_codec/cpp_codec方向だけを生成し、未使用の逆方向は出力しない。
 * command付きRPCは宣言的な分岐・フィールド参照・倍率・受理条件から通常指令の両側を生成する。
 * 操作ごとのJavaScript実装文字列は持たず、機能状態は生成したサービス型のフックへ委譲する。
 * wire.protoの固定領域・種別付きレコードはwire-generator/records-generator、
 * transport.protoのJSON・HTTP経路・転送窓口はjson-generatorから生成する。
 * CRC・分割手順・認証・セッション世代・VMの状態遷移は既存の通信所有者に残す。
 * 固定値・enum・下限は通常の形式検査へ生成する。C++復号は値を保持し、検査は別関数とする。
 * 既定はWebだけを生成する。--esp32で隣接ESP32のヘッダー・実装も更新・照合する。
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import protobuf from "protobufjs";
import { generateWire } from "./wire-generator.mjs";
import { generateJson } from "./json-generator.mjs";

/** 生成元と明示的な出力先。作業ディレクトリーには依存しない。 */
const directory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const flags = new Set(process.argv.slice(2));
for (const flag of flags) {
    if (flag !== "--check" && flag !== "--esp32") {
        throw new Error(`未対応の引数: ${flag}`);
    }
}
const root = new protobuf.Root();
const resolveImport = root.resolvePath;
root.resolvePath = (origin, target) => target.startsWith("google/protobuf/")
    ? require.resolve(`protobufjs/${target}`) : resolveImport(origin, target);
root.loadSync(resolve(directory, "device.proto"), { alternateCommentMode: true }).resolveAll();
const schema = root.lookup("uroa.device");
const messages = schema.nestedArray.filter(item => item instanceof protobuf.Type);
const enums = schema.nestedArray.filter(item => item instanceof protobuf.Enum);
const services = schema.nestedArray.filter(item => item instanceof protobuf.Service);

/** 独自オプションを名前で読む。明示値がない場合だけ共通の既定値を使う。 */
function option(item, name, fallback) {
    return item.options?.[`(uroa.${name})`] ?? fallback;
}

/** protobufjsが保持するaggregate optionを読む。繰返し宣言は曖昧に結合せず拒否する。 */
function aggregateOption(item, name) {
    const key = `(uroa.${name})`;
    const values = (item.parsedOptions ?? []).filter(entry => Object.hasOwn(entry, key));
    requireCondition(values.length <= 1, `複数の${name}指定: ${item.fullName}`);
    return values[0]?.[key];
}

/** 型や属性の不足を見逃さず、生成元の名前を含むエラーにする。 */
function requireCondition(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

/** ホスト型のimportを重複させず、生成した型名との衝突を避ける。 */
const hostImports = [];
function messageType(message) {
    const host = option(message, "host_type");
    if (!host) {
        return undefined;
    }
    const source = option(message, "host_import");
    if (!source) {
        requireCondition(host === "Error" || host === "Blob", `ホスト型のimportがありません: ${message.name}`);
        return host;
    }
    const match = /^([A-Za-z_][A-Za-z_0-9]*)(.*)$/.exec(host);
    requireCondition(match && /^(\.\/|\.\.\/)[a-zA-Z0-9_./-]+$/.test(source), `ホスト型指定が不正: ${message.name}`);
    const alias = `Host${message.name}`;
    hostImports.push(`import type { ${match[1]} as ${alias} } from ${JSON.stringify(source)};`);
    return alias + match[2];
}

/** APIメッセージのフィールドをTSへ写す。配列は読取専用で、追加コピーを要求しない。 */
function fieldType(field) {
    let name;
    if (field.resolvedType) {
        name = field.resolvedType.name;
    }
    else {
        name = { uint32: "number", sint32: "number", double: "number", float: "number", bool: "boolean", string: "string", bytes: "Uint8Array" }[field.type];
    }
    requireCondition(name && !field.map, `未対応のフィールド: ${field.fullName}`);
    if (field.repeated || field.type === "string" || field.type === "bytes") {
        requireCondition(Number.isInteger(option(field, "max_length")) && option(field, "max_length") > 0,
            `最大長が必要: ${field.fullName}`);
    }
    return field.repeated ? `readonly ${name}[]` : name;
}

/** 固定長パケットだけ宣言順に配置する。Protobufのフィールド番号やC++の構造体配置には依存しない。 */
const packets = {};
for (const message of messages) {
    if (!option(message, "wire_packet", false)) {
        continue;
    }
    let offset = 0;
    const directions = {};
    for (const language of ["ts", "cpp"]) {
        const direction = option(message, `${language}_codec`, "");
        requireCondition(["", "encode", "decode"].includes(direction), `未対応のcodec方向: ${message.fullName}`);
        directions[language] = direction;
    }
    const fields = message.fieldsArray.map(field => {
        const bits = option(field, "bits", 32);
        const enumType = field.resolvedType instanceof protobuf.Enum ? field.resolvedType : undefined;
        requireCondition((["uint32", "sint32"].includes(field.type) || enumType) && [8, 16, 32].includes(bits)
            && !field.repeated, `未対応の固定長フィールド: ${field.fullName}`);
        const result = { name: field.name, offset, bits, signed: field.type === "sint32" };
        result.minimum = result.signed ? -(2 ** (bits - 1)) : 0;
        result.maximum = 2 ** (bits - (result.signed ? 1 : 0)) - 1;
        result.fixed = option(field, "fixed_value");
        result.default = option(field, "wire_default");
        result.min = option(field, "min_value", result.minimum);
        requireCondition(Number.isInteger(result.min) && result.min >= result.minimum && result.min <= result.maximum,
            `受理下限が不正: ${field.fullName}`);
        if (result.fixed !== undefined) {
            requireCondition(Number.isInteger(result.fixed) && result.fixed >= result.min && result.fixed <= result.maximum,
                `固定値が格納幅の範囲外: ${field.fullName}`);
        }
        if (result.default !== undefined) {
            requireCondition(Number.isInteger(result.default) && result.default >= result.min && result.default <= result.maximum,
                `既定値が格納幅の範囲外: ${field.fullName}`);
        }
        if (enumType) {
            requireCondition(Object.values(enumType.values).every(value => value >= result.minimum && value <= result.maximum),
                `enumが格納幅の範囲外: ${field.fullName}`);
            result.values = [...new Set(Object.values(enumType.values))].filter(value => value >= result.min);
            requireCondition(result.values.length > 0 && (result.fixed === undefined || result.values.includes(result.fixed)),
                `受理可能なenum値がありません: ${field.fullName}`);
        }
        offset += bits / 8;
        return result;
    });
    packets[message.name] = { byteLength: offset, offset: Object.fromEntries(fields.map(field => [field.name, field.offset])),
        fixed: Object.fromEntries(fields.filter(field => field.fixed !== undefined).map(field => [field.name, field.fixed])), fields, directions };
}

/** API番号は明示値。並べ替えで変化させず、サービス内の重複も拒否する。 */
const methods = [];
const serviceIds = new Set();
const names = new Set();
for (const service of services) {
    const serviceId = option(service, "service_id");
    const scope = option(service, "scope", "device");
    requireCondition(["device", "remote", "internal"].includes(scope), `未対応のサービス範囲: ${service.name}`);
    requireCondition(Number.isInteger(serviceId) && serviceId > 0 && serviceId <= 65535 && !serviceIds.has(serviceId),
        `サービス番号が不正または重複: ${service.name}`);
    serviceIds.add(serviceId);
    const methodIds = new Set();
    for (const method of service.methodsArray) {
        const methodId = option(method, "method_id");
        const name = option(method, "api_name");
        const transport = option(method, "transport");
        requireCondition(Number.isInteger(methodId) && methodId > 0 && methodId <= 65535 && !methodIds.has(methodId),
            `メソッド番号が不正または重複: ${method.fullName}`);
        requireCondition(typeof name === "string" && /^[a-z]+\.[a-z]+$/.test(name) && !names.has(name), `API名が不正または重複: ${name}`);
        requireCondition(["local", "ble", "wifi", "both"].includes(transport), `通信経路が不正: ${name}`);
        requireCondition(!method.requestStream, `要求ストリームは既存の転送アダプターで扱ってください: ${name}`);
        const subscription = option(method, "subscription", "");
        requireCondition(method.responseStream ? ["listener", "owner"].includes(subscription) : option(method, "completion"),
            `完了または購読の契約がありません: ${name}`);
        methodIds.add(methodId);
        names.add(name);
        methods.push({ name, service: service.name, method: method.name, serviceId, methodId, transport,
            scope, subscription, hasRequest: method.resolvedRequestType.name !== "Empty",
            synchronous: option(method, "synchronous", false), priority: option(method, "priority", false),
            completion: option(method, "completion", "subscription"), ioTimeoutMs: option(method, "io_timeout_ms", 0),
            request: method.resolvedRequestType.name, response: method.resolvedResponseType.name,
            command: aggregateOption(method, "command") });
    }
}

/** Commandの宣言はフィールド参照・定数・倍率だけを許可する。操作ごとの実装文字列を受け付けない。 */
const commandMethods = methods.filter(method => method.command);
const commandLayout = packets.CommandPacket;
const opcodeEnum = schema.lookupEnum("CommandOpcode");
for (const method of commandMethods) {
    const binding = method.command;
    requireCondition(Object.keys(binding).every(key => ["selector", "cases"].includes(key)) && binding.cases,
        `Command対応が不正: ${method.name}`);
    const request = schema.lookupType(method.request);
    requireCondition(["device", "internal"].includes(method.scope) && !method.subscription && !method.synchronous && method.response === "Empty"
        && ["ack", "initialized"].includes(method.completion) && method.transport === "both" && Number.isInteger(method.ioTimeoutMs) && method.ioTimeoutMs > 0,
        `Commandの経路・完了条件・期限が不正: ${method.name}`);
    const variants = Array.isArray(binding.cases) ? binding.cases : [binding.cases];
    requireCondition(binding.selector ? request.fields[binding.selector]?.type === "string" : variants.length === 1,
        `Commandの分岐フィールドが不正: ${method.name}`);
    const selections = new Set();
    for (const variant of variants) {
        requireCondition(Object.keys(variant).every(key => ["equals", "opcode", "channel", "value", "constant_value", "scale", "signed_value", "duration", "server"].includes(key)),
            `未対応のCommand属性: ${method.name}`);
        requireCondition(Object.hasOwn(opcodeEnum.values, variant.opcode) && opcodeEnum.values[variant.opcode] > 0,
            `Command操作番号が不正: ${method.name}`);
        if (binding.selector) {
            requireCondition(typeof variant.equals === "string" && !selections.has(variant.equals), `Command分岐が不正または重複: ${method.name}`);
            selections.add(variant.equals);
        }
        else {
            requireCondition(variant.equals === undefined, `分岐なしのequals指定: ${method.name}`);
        }
        for (const target of ["channel", "value", "duration"]) {
            if (!variant[target]) {
                continue;
            }
            const field = request.fields[variant[target]];
            requireCondition(field && !field.repeated && !option(field, "host_optional", false)
                && (target === "value" ? ["uint32", "sint32", "double", "float"] : ["uint32"]).includes(field.type),
                `Commandフィールド参照が不正: ${method.name}.${target}`);
        }
        requireCondition(!(variant.value && variant.constant_value !== undefined)
            && (variant.constant_value === undefined || Number.isInteger(variant.constant_value) && variant.constant_value >= 0
                && variant.constant_value <= commandLayout.fields.find(field => field.name === "value").maximum)
            && (variant.scale === undefined || variant.value && Number.isInteger(variant.scale) && variant.scale > 0)
            && (variant.signed_value === undefined || typeof variant.signed_value === "boolean" && (!variant.signed_value || variant.value)),
            `Commandの値・倍率・符号指定が不正: ${method.name}`);
    }
    method.command = { ...binding, cases: variants };
}
requireCondition(methods.filter(method => method.scope === "internal").every(method => method.command), "内部操作のCommand対応がありません");

/** クライアントの既定値と受信制約を混同せず、サーバー用の対応を検証する。 */
const statusBinding = aggregateOption(schema.lookupType("StatusPacket"), "status_binding");
requireCondition(statusBinding && Object.keys(statusBinding).every(key => ["channel_count", "speed_flag", "speed_scale"].includes(key))
    && Number.isInteger(statusBinding.channel_count) && statusBinding.channel_count > 0 && statusBinding.channel_count <= 256
    && Number.isInteger(statusBinding.speed_flag) && statusBinding.speed_flag > 0 && statusBinding.speed_flag <= 255
    && Number.isInteger(statusBinding.speed_scale) && statusBinding.speed_scale > 0, "Statusのサーバー対応が不正です");
const serverCases = [];
const serverOpcodes = new Set();
const handlerNames = new Set();
for (const method of commandMethods) {
    for (const variant of method.command.cases) {
        const server = variant.server;
        requireCondition(server && Object.keys(server).every(key => ["handler", "value_name", "value_scale", "context", "echo_channel", "notify_io_error", "status_only", "checks"].includes(key)),
            `サーバー対応がありません: ${variant.opcode}`);
        requireCondition(!serverOpcodes.has(variant.opcode), `サーバー操作が重複: ${variant.opcode}`);
        serverOpcodes.add(variant.opcode);
        for (const name of ["context", "echo_channel", "notify_io_error", "status_only"]) {
            requireCondition(server[name] === undefined || typeof server[name] === "boolean", `サーバー属性が不正: ${variant.opcode}.${name}`);
        }
        requireCondition(server.status_only ? !server.handler && !server.context && !server.value_name && !variant.channel && !variant.value && !variant.duration
            : /^[a-z][a-zA-Z0-9]*$/.test(server.handler) && !handlerNames.has(`${method.service}.${server.handler}`),
            `サーバーハンドラーが不正または重複: ${variant.opcode}`);
        if (!server.status_only) {
            handlerNames.add(`${method.service}.${server.handler}`);
        }
        const valueName = server.value_name ?? variant.value;
        const scale = server.value_scale ?? variant.scale ?? 1;
        requireCondition((valueName === undefined || /^[a-z][a-zA-Z0-9]*$/.test(valueName))
            && Number.isInteger(scale) && scale > 0 && (server.value_scale === undefined || valueName),
            `サーバーの値引数が不正: ${variant.opcode}`);
        const checks = server.checks ? (Array.isArray(server.checks) ? server.checks : [server.checks]) : [];
        for (const check of checks) {
            const field = commandLayout.fields.find(field => field.name === check.field);
            const predicates = ["equals", "max", "one_of"].filter(key => check[key] !== undefined);
            requireCondition(field && Object.keys(check).every(key => ["field", "equals", "max", "one_of"].includes(key)) && predicates.length === 1,
                `サーバー検査が不正: ${variant.opcode}`);
            const values = predicates[0] === "one_of" ? check.one_of : [check[predicates[0]]];
            requireCondition(Array.isArray(values) && values.length > 0 && values.every(value => Number.isInteger(value) && value >= field.minimum && value <= field.maximum),
                `サーバー検査値が不正: ${variant.opcode}`);
        }
        const args = [];
        if (variant.channel) {
            args.push({ name: variant.channel, type: "uint8_t", expression: "command.channel" });
        }
        if (valueName) {
            args.push({ name: valueName, type: scale > 1 ? "float" : `${variant.signed_value ? "int" : "uint"}16_t`,
                expression: `${variant.signed_value ? "signedValue" : "command.value"}${scale > 1 ? ` / ${scale}.0f` : ""}` });
        }
        if (variant.duration) {
            args.push({ name: variant.duration, type: "uint16_t", expression: "command.duration" });
        }
        if (server.context) {
            args.push({ name: "context", type: "const ControlRpcContext &", expression: "context" });
        }
        requireCondition(new Set(args.map(arg => arg.name)).size === args.length, `サーバー引数名が重複: ${variant.opcode}`);
        serverCases.push({ service: method.service, variant, server, checks, args });
    }
}
requireCondition(Object.entries(opcodeEnum.values).filter(([, value]) => value > 0).every(([name]) => serverOpcodes.has(name)),
    "サーバーで未対応のCommand操作があります");

/** 定義の指紋はコメント・絶対パスを含めず、型・配置・番号・契約から生成する。 */
const fingerprint = createHash("sha256").update(JSON.stringify({ schema: schema.toJSON(), wire: root.lookup("uroa.wire").toJSON(), transport: root.lookup("uroa.network").toJSON(), packets, methods })).digest("hex");
const declarations = messages.map(message => {
    const host = messageType(message);
    if (host) {
        return `/** 既存の復号済みホスト型。直列化と所有検査は既存アダプターへ委譲する。 */\nexport type ${message.name} = ${host};`;
    }
    if (message.name === "Empty") {
        return "export type Empty = void;";
    }
    const fields = message.fieldsArray.map(field => `    ${field.name}${option(field, "host_optional", false) ? "?" : ""}: ${fieldType(field)};`);
    return `/** device.protoの${message.name}から生成した値型。 */\nexport interface ${message.name} {\n${fields.join("\n")}\n}`;
});

/** 単発呼出しと同期購読を別の表へ生成し、型の異なる操作を混在させない。 */
function interfaceText(name, selected, subscription = false) {
    const entries = selected.map(method => {
        let signature;
        if (subscription) {
            signature = method.subscription === "owner" ? `(owner: ${method.request})` : `(listener: (value: ${method.response}) => void)`;
            signature += " => () => void";
        }
        else {
            signature = `(${method.hasRequest ? `request: ${method.request}, ` : ""}options?: RpcCallOptions)`;
            signature += ` => ${method.synchronous ? method.response : `Promise<${method.response}>`}`;
        }
        return `    /** ${method.service}.${method.method}: ${method.completion}まで。 */\n    ${JSON.stringify(method.name)}: ${signature};`;
    });
    return `export interface ${name} {\n${entries.join("\n")}\n}`;
}
const header = "/** device.proto/options.protoから自動生成。編集せずdiagram/rpc/generate.mjsを実行する。 */";

/** 固定値・enum・下限の受理条件。整数幅はTSの送信時だけ追加で検査する。 */
function fieldConditions(field, value) {
    const conditions = [];
    if (field.fixed !== undefined) {
        conditions.push(`${value} == ${field.fixed}`);
    }
    if (field.values) {
        const values = [...field.values].sort((left, right) => left - right);
        conditions.push(values.at(-1) - values[0] + 1 === values.length
            ? `(${value} >= ${values[0]} && ${value} <= ${values.at(-1)})`
            : `(${values.map(item => `${value} == ${item}`).join(" || ")})`);
    }
    else if (field.min > field.minimum) {
        conditions.push(`${value} >= ${field.min}`);
    }
    return conditions;
}

/** TSは実通信で使う方向へ直接DataViewアクセスを生成し、配置表を走査する手書きcodecを不要にする。 */
const tsCodecs = Object.entries(packets).filter(([, layout]) => layout.directions.ts).map(([name, layout]) => {
    const encode = layout.directions.ts === "encode";
    const lines = [encode ? "/** 整数幅と形式を検査し、既存の固定長パケットを書く。 */"
        : "/** byteOffset付きDataViewを全長・形式検査して読む。未知のStatus結果コードも保持する。 */",
    encode ? `export function encode${name}(packet: ${name}): Uint8Array {`
        : `export function decode${name}(view: DataView): ${name} {`];
    if (encode) {
        for (const field of layout.fields) {
            const value = `packet.${field.name}`;
            const conditions = [`Number.isInteger(${value})`, `${value} >= ${field.minimum}`, `${value} <= ${field.maximum}`,
                ...fieldConditions(field, value).map(condition => condition.replaceAll(" == ", " === "))];
            lines.push(`    if (!(${conditions.join(" && ")})) {`,
                `        throw new RpcError(RpcCode.InvalidArgument, "${name}.${field.name}が格納幅または形式の範囲外です。");`, "    }");
        }
        lines.push(`    const bytes = new Uint8Array(${layout.byteLength});`, "    const view = new DataView(bytes.buffer);");
        for (const field of layout.fields) {
            lines.push(`    view.set${field.signed ? "Int" : "Uint"}${field.bits}(${field.offset}, packet.${field.name}${field.bits > 8 ? ", true" : ""});`);
        }
        lines.push("    return bytes;");
    }
    else {
        lines.push(`    if (view.byteLength !== ${layout.byteLength}) {`,
            `        throw new RpcError(RpcCode.InvalidArgument, "${name}の長さが不正です。");`, "    }", `    const packet: ${name} = {`);
        for (const field of layout.fields) {
            lines.push(`        ${field.name}: view.get${field.signed ? "Int" : "Uint"}${field.bits}(${field.offset}${field.bits > 8 ? ", true" : ""}),`);
        }
        lines.push("    };");
        const conditions = layout.fields.flatMap(field => fieldConditions(field, `packet.${field.name}`))
            .map(condition => condition.replaceAll(" == ", " === "));
        if (conditions.length > 0) {
            lines.push(`    if (!(${conditions.join(" && ")})) {`,
                `        throw new RpcError(RpcCode.InvalidArgument, "${name}の形式が不正です。");`, "    }");
        }
        lines.push("    return packet;");
    }
    return [...lines, "}"].join("\n");
});
const ts = [header, 'import type { RpcCallOptions } from "./rpc-client";', ...hostImports, "",
    `export const rpcApiVersion = ${option(schema, "api_version")};`,
    `export const rpcMaxPending = ${option(schema, "max_pending")};`,
    `export const rpcSchemaFingerprint = ${JSON.stringify(fingerprint)};`, "",
    ...enums.map(item => `export enum ${item.name} {\n${Object.entries(item.values).map(([name, value]) => `    ${name} = ${value},`).join("\n")}\n}`),
    ...declarations,
    interfaceText("DeviceRpcCalls", methods.filter(method => method.scope === "device" && !method.subscription)),
    interfaceText("RemoteRpcCalls", methods.filter(method => method.scope === "remote")),
    interfaceText("InternalControlRpcCalls", methods.filter(method => method.scope === "internal")),
    interfaceText("DeviceRpcSubscriptions", methods.filter(method => method.subscription), true),
    `export const packetLayouts = ${JSON.stringify(packets, null, 4)} as const;`,
    `/** フィールドの検査と操作の対応に使う生成済み定義。 */\nexport const rpcMessages = ${JSON.stringify(Object.fromEntries(messages.filter(message => !option(message, "host_type")).map(message => [message.name,
        message.fieldsArray.map(field => ({ name: field.name, type: field.resolvedType?.name ?? field.type, repeated: field.repeated,
            optional: option(field, "host_optional", false), bits: option(field, "bits", 32), maxLength: option(field, "max_length", 0) }))])), null, 4)} as const;`,
    `export const rpcMethods = ${JSON.stringify(Object.fromEntries(methods.map(method => [method.name, method])), null, 4)} as const;`, ""].join("\n\n");

/** 指定方向だけのC++宣言を作る。復号と形式検査を分け、不正指令のsequenceを維持する。 */
function cppCodecDeclarations(name, layout) {
    if (layout.directions.cpp === "encode") {
        return ["        /**", "         * @brief 宣言順に固定長パケットを書く。", "         * @param out ByteLength以上の出力領域。", "         * @param packet 呼出元が確定した幅・固定値の値。", "         */",
            `        void encode${name}(uint8_t *out, const ${name} &packet);`, ""];
    }
    if (layout.directions.cpp === "decode") {
        return ["        /**", "         * @brief 全長が一致するパケットを読む。形式検査は別途行う。", "         * @param data 入力バイト列。", "         * @param length 入力のバイト数。", "         * @return 長さ不正またはnullptrなら全フィールド0、それ以外は復号した値。", "         */",
            `        ${name} decode${name}(const uint8_t *data, size_t length);`, "",
            "        /**", "         * @brief 固定値・enum・下限による通常の形式検査。機器の範囲検査は含まない。", "         * @param packet 復号した値。", "         * @return 形式が正しければtrue。", "         */",
            `        bool validate${name}(const ${name} &packet);`, ""];
    }
    return [];
}

/** ESP32へ番号・配置・値型と指定方向のcodecを出力する。ランタイムや動的確保は導入しない。 */
const cpp = ["/**", " * @file uroa_rpc.generated.h", " * @brief device.protoから生成した既存パケットの番号・配置・方向別codec。手動編集しない。", " */", "#pragma once", "#include <stddef.h>", "#include <stdint.h>", "", "namespace uroa {", "    namespace rpc {",
    `        constexpr uint32_t ApiVersion = ${option(schema, "api_version")}; ///< 呼出しAPIの版。既存Commandの版とは別。`,
    `        constexpr char SchemaFingerprint[] = "${fingerprint}"; ///< 生成物整合用。現在の通信で交換しない。`,
    ...enums.flatMap(item => ["        /**", "         * @brief 既存パケットの操作・結果番号。", "         */", `        enum class ${item.name} : uint8_t {`,
        ...Object.entries(item.values).map(([name, value]) => `            ${name} = ${value},`), "        };", ""]),
    "        /**", "         * @brief ローカルRPCのサービスと操作の識別番号。既存パケットへは追加しない。", "         */", "        enum class Method : uint32_t {",
    ...methods.map(method => `            ${method.service}${method.method} = ${(method.serviceId << 16) | method.methodId},`), "        };", "",
    ...Object.entries(packets).flatMap(([name, layout]) => ["        /**", "         * @brief 宣言順・little endian・パディングなしの位置。sizeofで通信サイズを求めない。", "         */",
        `        struct ${name}Layout {`, `            static constexpr size_t ByteLength = ${layout.byteLength}; ///< パケット全長。`,
        ...layout.fields.flatMap(field => [`            static constexpr size_t ${field.name} = ${field.offset}; ///< ${field.bits}bitの先頭位置。`,
            ...(field.fixed === undefined ? [] : [`            static constexpr uint${field.bits}_t ${field.name}Value = ${field.fixed}; ///< 通常形式の固定値。`])]),
        ...(name === "StatusPacket" ? [
            `            static constexpr uint16_t ChannelCount = ${statusBinding.channel_count}; ///< 値を持つCHの件数。`,
            `            static constexpr uint8_t SpeedFlag = ${statusBinding.speed_flag}; ///< 速度モードの状態ビット。`,
            `            static constexpr uint32_t SpeedScale = ${statusBinding.speed_scale}; ///< 速度指令の整数化倍率。`] : []), "        };", "",
        "        /**", "         * @brief 固定長パケットの値。メモリー上の配置を直接送らない。", "         */", `        struct ${name} {`,
        ...layout.fields.map(field => `            ${field.signed ? "int" : "uint"}${field.bits}_t ${field.name}; ///< ${field.bits}bitの値。`), "        };", "",
        ...cppCodecDeclarations(name, layout)]),
    "        /**", "         * @brief 固定値とCHの条件に従ってStatusの値を作る。", "         * @param code 受付結果。", "         * @param sequence 応答対象。", "         * @param flags 機器状態。", "         * @param channel CHまたは全体。", "         * @param current 現在の指令値のビット列。", "         * @param target 目標値のビット列。", "         * @param remaining 残り時間ms。", "         * @return 通信へ書き込む値。全体CHの3値は0。", "         */",
    "        StatusPacket makeStatusPacket(uint8_t code, uint16_t sequence, uint8_t flags, uint8_t channel,",
    "            uint16_t current, uint16_t target, uint16_t remaining);", "",
    "    }", "}", ""].join("\n");

/** uint32のシフトで読み書きする。構造体の直接送信・未整列アクセス・符号付き右シフトを使わない。 */
const cppSource = ["/**", " * @file uroa_rpc.generated.cpp", " * @brief device.protoから生成した方向別の固定長codecと形式検査。手動編集しない。", " */",
    '#include "uroa_rpc.generated.h"', "", "namespace uroa {", "    namespace rpc {",
    ...Object.entries(packets).filter(([, layout]) => layout.directions.cpp === "encode").flatMap(([name, layout]) => ["        /**", "         * @brief 宣言順に固定長パケットを書く。", "         * @param out パケット全長以上の出力領域。", "         * @param packet 呼出元が確定した幅・固定値の値。", "         */",
        `        void encode${name}(uint8_t *out, const ${name} &packet) {`,
        ...layout.fields.flatMap(field => [`            const uint32_t ${field.name}Value = static_cast<uint32_t>(packet.${field.name});`,
            ...Array.from({ length: field.bits / 8 }, (_, index) => `            out[${name}Layout::${field.name}${index ? ` + ${index}` : ""}] = static_cast<uint8_t>(${field.name}Value${index ? ` >> ${index * 8}` : ""});`)]),
        "        }", ""]),
    ...Object.entries(packets).filter(([, layout]) => layout.directions.cpp === "decode").flatMap(([name, layout]) => [
        "        /**", "         * @brief 全長一致時だけ復号する。版等の不正値も応答照合用に保持する。", "         * @param data 入力バイト列。", "         * @param length 入力のバイト数。", "         * @return nullptrまたは長さ不正なら全フィールド0。", "         */",
        `        ${name} decode${name}(const uint8_t *data, size_t length) {`, `            ${name} packet{};`,
        `            if (data == nullptr || length != ${name}Layout::ByteLength) {`, "                return packet;", "            }",
        ...layout.fields.flatMap(field => {
            if (field.bits === 8 && !field.signed) {
                return [`            packet.${field.name} = data[${name}Layout::${field.name}];`];
            }
            const value = Array.from({ length: field.bits / 8 }, (_, index) =>
                `(static_cast<uint32_t>(data[${name}Layout::${field.name}${index ? ` + ${index}` : ""}])${index ? ` << ${index * 8}` : ""})`).join(" | ");
            if (field.signed) {
                return [`            const uint32_t ${field.name}Value = ${value};`,
                    `            packet.${field.name} = static_cast<int${field.bits}_t>(${field.name}Value >= ${2 ** (field.bits - 1)}u ? static_cast<int64_t>(${field.name}Value) - ${2 ** field.bits}LL : ${field.name}Value);`];
            }
            return [`            packet.${field.name} = static_cast<uint${field.bits}_t>(`,
                ...value.split(" | ").map((part, index, parts) => `                ${part}${index < parts.length - 1 ? " |" : ");"}`)];
        }),
        "            return packet;", "        }", "",
        "        /**", "         * @brief 生成元の固定値・enum・下限を検査する。", "         * @param packet 復号した値。", "         * @return 通常の形式が正しければtrue。", "         */",
        `        bool validate${name}(const ${name} &packet) {`,
        `            return ${layout.fields.flatMap(field => fieldConditions(field, `packet.${field.name}`)).join(" && ") || "true"};`,
        "        }", ""]),
    "        /**", "         * @brief 共通Statusの固定値・CHごとの値を設定する。", "         * @param code 受付結果。", "         * @param sequence 応答対象。", "         * @param flags 機器状態。", "         * @param channel CHまたは全体。", "         * @param current 現在の指令値。", "         * @param target 目標値。", "         * @param remaining 残り時間ms。", "         * @return CH条件を適用したStatus。", "         */",
    "        StatusPacket makeStatusPacket(uint8_t code, uint16_t sequence, uint8_t flags, uint8_t channel,",
    "            uint16_t current, uint16_t target, uint16_t remaining) {",
    "            StatusPacket packet{};", "            packet.version = StatusPacketLayout::versionValue;",
    "            packet.code = code;", "            packet.sequence = sequence;", "            packet.flags = flags;", "            packet.channel = channel;",
    "            if (channel < StatusPacketLayout::ChannelCount) {", "                packet.current = current;", "                packet.target = target;", "                packet.remaining = remaining;", "            }",
    "            return packet;", "        }", "", "    }", "}", ""].join("\n");

/** 全成果物を生成し終えてから書き込む。--checkでは欠落も不一致として失敗させる。 */
// 型/メタデータとcodecを分け、rpc-clientが参照する定義へエラー型の循環依存を作らない。
const tsCodecSource = [header, 'import { RpcCode, RpcError } from "./rpc-client";',
    `import type { ${Object.entries(packets).filter(([, layout]) => layout.directions.ts).map(([name]) => name).join(", ")} } from "./device-rpc.generated";`,
    ...tsCodecs, ""].join("\n\n");

/** 宣言済みのフィールド参照・倍率・定数からCommandの値を作る。任意の式や操作名分岐は持たない。 */
function commandValueText(variant) {
    const valueField = commandLayout.fields.find(field => field.name === "value");
    const value = variant.value ? (variant.scale ? `Math.round(request.${variant.value} * ${variant.scale})` : `request.${variant.value}`)
        : variant.constant_value ?? valueField.default;
    const values = {
        version: commandLayout.fixed.version, reserved: commandLayout.fixed.reserved,
        opcode: `CommandOpcode.${variant.opcode}`, channel: variant.channel ? `request.${variant.channel}` : commandLayout.fields.find(field => field.name === "channel").default,
        value, duration: variant.duration ? `request.${variant.duration}` : commandLayout.fields.find(field => field.name === "duration").default,
    };
    requireCondition(Object.values(values).every(value => value !== undefined), "Commandの固定値または既定値が不足しています");
    return `{ ${Object.entries(values).map(([name, value]) => `${name}: ${value}`).join(", ")} }`;
}

/** 公開RPCと内部STREAMを分けて生成する。サービス単位のフックにはwire情報を渡さない。 */
function controlFactoryText(name, selected, internal = false) {
    const resultType = internal ? "InternalControlRpcCalls" : "ControlRpcCalls";
    const lines = ["/** 既存Commandへ接続した型付き呼出し表。接続選択やドメイン状態を所有しない。 */",
        `export function ${name}(transport: ControlConnection${internal ? "" : ", hooks: ControlServiceHooks = {}"}): ${resultType} {`, "    return {"];
    for (const method of selected) {
        lines.push(`        ${JSON.stringify(method.name)}: async (${method.hasRequest ? "request, " : ""}options) => {`);
        const variants = method.command.cases;
        if (method.command.selector) {
            lines.push('            let packet: Omit<CommandPacket, "sequence">;', "            let signed: boolean;");
            variants.forEach((variant, index) => {
                lines.push(`            ${index ? "else if" : "if"} (request.${method.command.selector} === ${JSON.stringify(variant.equals)}) {`,
                    `                packet = ${commandValueText(variant)};`, `                signed = ${!!variant.signed_value};`, "            }");
            });
            lines.push("            else {", `                throw new RpcError(RpcCode.InvalidArgument, "${method.request}.${method.command.selector}が不正です。");`, "            }");
        }
        else {
            lines.push(`            const packet = ${commandValueText(variants[0])};`, `            const signed = ${!!variants[0].signed_value};`);
        }
        lines.push(internal ? "            const context: ControlCallContext = {};"
            : `            const context = hooks.${method.service}?.({ name: ${JSON.stringify(method.name)}, request: ${method.hasRequest ? "request" : "undefined"} }, options) ?? {};`,
            `            return invokeControl(transport, packet, signed, rpcMethods[${JSON.stringify(method.name)}], context, options);`, "        },");
    }
    return [...lines, "    };", "}"].join("\n");
}

const publicCommands = commandMethods.filter(method => method.scope === "device");
const internalCommands = commandMethods.filter(method => method.scope === "internal");
const controlServices = [...new Set(publicCommands.map(method => method.service))];
const resultEnum = schema.lookupEnum(option(schema.lookupType("StatusPacket"), "result_enum"));
const resultMessages = Object.fromEntries(Object.entries(resultEnum.values).map(([name, value]) => {
    const message = option({ options: resultEnum.valuesOptions?.[name] }, "result_message");
    requireCondition(typeof message === "string", `結果メッセージがありません: ${name}`);
    return [value, message];
}));
const success = Object.entries(resultEnum.values).find(([, value]) => value === 0)?.[0];
requireCondition(success, "成功結果0がありません");
const traceNames = Object.fromEntries(Object.entries(opcodeEnum.values).filter(([name]) =>
    option({ options: opcodeEnum.valuesOptions?.[name] }, "command_trace", false)).map(([name, value]) => [value, name]));
const controlSource = [header,
    '/** 通常Commandの要求作成・送信・Status結果を生成する。機器状態はサービスフック、ACK待ちは共通exchangeが所有する。 */',
    'import { RpcCode, RpcError, type RpcCallOptions } from "./rpc-client";',
    'import type { ControlConnection, ControlCallContext, ControlExchangePolicy } from "./control-connection";',
    'import { encodeCommandPacket } from "./device-rpc-codec.generated";',
    `import { CommandOpcode, ${resultEnum.name}, rpcMethods, type CommandPacket, type StatusPacket, type DeviceRpcCalls, type InternalControlRpcCalls, ${[...new Set(publicCommands.map(method => method.request))].map(name => `type ${name}`).join(", ")} } from "./device-rpc.generated";`,
    `/** sequence 0を自発通知用に残し、最大値の次は1へ戻す。 */\nexport const controlMaxSequence = ${commandLayout.fields.find(field => field.name === "sequence").maximum};`,
    `export type ControlRpcCalls = Pick<DeviceRpcCalls, ${publicCommands.map(method => JSON.stringify(method.name)).join(" | ")}>;`,
    ...controlServices.map(service => `/** ${service}の機能状態を検査する値。opcode・配置・倍率を含めない。 */\nexport type ${service}ControlInvocation =\n${publicCommands.filter(method => method.service === service).map(method => `    | { name: ${JSON.stringify(method.name)}; request: ${method.request} }`).join("\n")};`),
    `export interface ControlServiceHooks {\n${controlServices.map(service => `    ${service}?: (invocation: ${service}ControlInvocation, options?: RpcCallOptions) => ControlCallContext;`).join("\n")}\n}`,
    `const resultMessages: Readonly<Record<number, string>> = ${JSON.stringify(resultMessages, null, 4)};`,
    `const traceNames: Readonly<Partial<Record<CommandOpcode, string>>> = ${JSON.stringify(traceNames, null, 4)};`,
    `/** Statusは機器受付まで。VMの初期化成功もHALTや動作完了を表さない。未知の番号を保持する。 */
function commandResult(status: StatusPacket): void {
    if (status.code !== ${resultEnum.name}.${success}) {
        throw new RpcError(RpcCode.Device, resultMessages[status.code] ?? \`機器エラー \${status.code}\`, status.code);
    }
}`,
    `/** 宣言から作った要求を現在の経路へ送る。取消・世代の最終検査後に共通exchangeがACKフックを実行する。 */
async function invokeControl(transport: ControlConnection, packet: Omit<CommandPacket, "sequence">, signed: boolean,
    policy: ControlExchangePolicy, context: ControlCallContext, options?: RpcCallOptions): Promise<void> {
    if (context.skip) {
        return;
    }
    try {
        if (signed && (!Number.isInteger(packet.value) || packet.value < ${-(2 ** (commandLayout.fields.find(field => field.name === "value").bits - 1))}
            || packet.value > ${2 ** (commandLayout.fields.find(field => field.name === "value").bits - 1) - 1})) {
            throw new RpcError(RpcCode.InvalidArgument, "Commandの符号付き値が格納幅の範囲外です。");
        }
        const operation = traceNames[packet.opcode];
        const diagnostic = operation ? { operation, channel: packet.channel, value: packet.value, duration: packet.duration } : undefined;
        await transport.exchange(sequence => encodeCommandPacket({ ...packet, sequence,
            value: signed ? packet.value & ${commandLayout.fields.find(field => field.name === "value").maximum} : packet.value }),
            commandResult, policy, context, options, diagnostic);
    }
    catch (error) {
        context.failed?.(error);
        throw error;
    }
}`,
    controlFactoryText("createControlCalls", publicCommands),
    controlFactoryText("createInternalControlCalls", internalCommands, true), ""].join("\n\n");
/** サービスごとの型付き関数表。実装・状態・タスクや接続の所有権は生成しない。 */
const serverServices = [...new Set(serverCases.filter(entry => !entry.server.status_only).map(entry => entry.service))];
const memberName = name => name[0].toLowerCase() + name.slice(1);
const argsText = args => args.map(arg => `${arg.type}${arg.type.endsWith("&") ? "" : " "}${arg.name}`).join(", ");
const serverHeader = ["/**", " * @file control_rpc.generated.h", " * @brief device.protoから生成した通常指令のサービスと応答。手動編集しない。", " */",
    "#pragma once", '#include "uroa_rpc.generated.h"', '#include "control_session.h"', "", "namespace uroa {", "    namespace rpc {",
    "        /**", "         * @brief loop()が取得する指令状態。角度は既存cdeg、速度は%で渡す。", "         */",
    "        struct ControlStatusState {",
    "            uint8_t flags; ///< 機器と制御の状態。",
    "            uint16_t current; ///< 角度指令のcdeg。",
    "            uint16_t target; ///< 角度目標のcdeg。",
    "            uint16_t remaining; ///< 補間の残りms。",
    "            bool speedMode; ///< 指定CHが速度モードならtrue。",
    "            float speedPercent; ///< 速度指令%。実測速度ではない。", "        };", "",
    "        /**", "         * @brief 状態取得・配送と通常形式受理の共通窓口。すべてloop()で呼ぶ。", "         */",
    "        struct ControlReplyService {",
    "            ControlStatusState (&snapshot)(uint8_t channel); ///< 指定CHの現在状態。",
    "            void (&publish)(const uint8_t *bytes, size_t length); ///< 完成したStatusを現在の経路へ通知する。",
    "            void (&accepted)(); ///< 通常形式が有効なら細部検査前にheartbeatを更新する。", "        };", "",
    ...serverServices.flatMap(service => ["        /**", `         * @brief ${service}の型付き機能ハンドラー。単位変換済みの値を受け取る。`, "         */",
        `        struct ${service}CommandService {`,
        ...serverCases.filter(entry => entry.service === service && !entry.server.status_only).map(entry =>
            `            StatusCode (&${entry.server.handler})(${argsText(entry.args)}); ///< ${entry.variant.opcode}の機能本体。`), "        };", ""]),
    "        /**", "         * @brief 稼働中保持するサービス表。必須の関数参照により未登録をコンパイル時に拒否する。", "         */",
    "        struct ControlServices {",
    ...serverServices.map(service => `            ${service}CommandService ${memberName(service)}; ///< ${service}の処理群。`),
    "            ControlReplyService reply; ///< 共有の状態と配送窓口。", "        };", "",
    "        /**", "         * @brief 状態を取得し、通常応答・自発通知のStatusを生成して通知する。", "         * @param service 状態取得と通知窓口。", "         * @param code 受付結果。", "         * @param sequence 応答対象。0は自発通知。", "         * @param channel CHまたは全体。", "         */",
    "        void publishControlStatus(const ControlReplyService &service, uint8_t code, uint16_t sequence, uint8_t channel);", "",
    "        /**", "         * @brief 復号済みCommandを検査・振分けし、ハンドラーの結果からStatusを返す。", "         * @param command 受信時に生成codecで復号した値。", "         * @param context loop()の呼出元と停止優先状態。", "         * @param services 機能本体と共通の通知窓口。", "         * @details 通信コールバックから直接呼ばない。優先STOPは呼出元の従来経路で処理する。", "         */",
    "        void dispatchControl(const CommandPacket &command, const ControlRpcContext &context, const ControlServices &services);",
    "    }", "}", ""].join("\n");

/** 各caseは宣言から生成する。未指定フィールドの追加検査や既定値の押付けを行わない。 */
function serverCaseText(entry) {
    const { variant, server, checks, args, service } = entry;
    const channel = server.echo_channel ? "command.channel" : commandLayout.fields.find(field => field.name === "channel").default;
    const lines = [`                case CommandOpcode::${variant.opcode}: {`];
    const reject = replyChannel => [`                        publishControlStatus(services.reply, static_cast<uint8_t>(StatusCode::CODE_RANGE), command.sequence, ${replyChannel});`, "                        return;"];
    if (variant.channel) {
        lines.push("                    if (command.channel >= StatusPacketLayout::ChannelCount) {",
            ...reject(commandLayout.fields.find(field => field.name === "channel").default), "                    }");
    }
    for (const check of checks) {
        const input = `command.${check.field}`;
        const invalid = check.equals !== undefined ? `${input} != ${check.equals}` : check.max !== undefined ? `${input} > ${check.max}`
            : check.one_of.map(value => `${input} != ${value}`).join(" && ");
        lines.push(`                    if (${invalid}) {`, ...reject(channel), "                    }");
    }
    if (variant.signed_value) {
        const bits = commandLayout.fields.find(field => field.name === "value").bits;
        lines.push(`                    const int32_t signedValue = command.value >= ${2 ** (bits - 1)}u`,
            `                        ? static_cast<int32_t>(command.value) - ${2 ** bits} : command.value;`);
    }
    lines.push(server.status_only ? "                    const StatusCode code = StatusCode::CODE_OK;"
        : `                    const StatusCode code = services.${memberName(service)}.${server.handler}(${args.map(arg => arg.expression).join(", ")});`);
    if (server.notify_io_error) {
        lines.push("                    if (code == StatusCode::CODE_IO_ERROR) {",
            `                        publishControlStatus(services.reply, static_cast<uint8_t>(code), 0, ${channel});`, "                    }");
    }
    lines.push(`                    publishControlStatus(services.reply, static_cast<uint8_t>(code), command.sequence, ${channel});`,
        "                    return;", "                }");
    return lines;
}
const serverSource = ["/**", " * @file control_rpc.generated.cpp", " * @brief device.protoの受理条件・機能振分け・応答作成。手動編集しない。", " */",
    '#include "control_rpc.generated.h"', "#include <math.h>", "", "namespace uroa {", "    namespace rpc {",
    "        /**", "         * @brief 状態をwire値へ変換し、生成したStatusを現在の窓口へ通知する。", "         * @param service 状態取得と通知窓口。", "         * @param code 結果。", "         * @param sequence 応答対象。", "         * @param channel CHまたは全体。", "         */",
    "        void publishControlStatus(const ControlReplyService &service, uint8_t code, uint16_t sequence, uint8_t channel) {",
    "            const ControlStatusState state = service.snapshot(channel);", "            uint8_t flags = state.flags;",
    "            uint16_t current = state.current;", "            uint16_t target = state.target;",
    "            if (state.speedMode) {", "                flags |= StatusPacketLayout::SpeedFlag;",
    "                current = static_cast<uint16_t>(static_cast<int16_t>(lroundf(state.speedPercent * StatusPacketLayout::SpeedScale)));",
    "                target = current;", "            }",
    "            const StatusPacket packet = makeStatusPacket(code, sequence, flags, channel, current, target, state.remaining);",
    "            uint8_t bytes[StatusPacketLayout::ByteLength];", "            encodeStatusPacket(bytes, packet);",
    "            service.publish(bytes, sizeof bytes);", "        }", "",
    "        /**", "         * @brief 受理条件とopcode対応から機能を呼び、共通のStatusを返す。", "         * @param command 復号済みの値。", "         * @param context 呼出元の世代と停止優先状態。", "         * @param services 型付きの機能表。", "         */",
    "        void dispatchControl(const CommandPacket &command, const ControlRpcContext &context, const ControlServices &services) {",
    "            if (!validateCommandPacket(command)) {",
    `                publishControlStatus(services.reply, static_cast<uint8_t>(StatusCode::CODE_FORMAT), command.sequence, ${commandLayout.fields.find(field => field.name === "channel").default});`,
    "                return;", "            }", "            services.reply.accepted();",
    "            switch (static_cast<CommandOpcode>(command.opcode)) {", ...serverCases.flatMap(serverCaseText), "                default:",
    `                    publishControlStatus(services.reply, static_cast<uint8_t>(StatusCode::CODE_FORMAT), command.sequence, ${commandLayout.fields.find(field => field.name === "channel").default});`,
    "                    return;", "            }", "        }", "    }", "}", ""].join("\n");
const wire = generateWire(root);
const json = generateJson(root);
const outputs = [[resolve(directory, "../ts/ble-wifi/device-rpc.generated.ts"), ts],
    [resolve(directory, "../ts/ble-wifi/device-wire.generated.ts"), wire.ts],
    [resolve(directory, "../ts/ble-wifi/device-json.generated.ts"), json.ts],
    [resolve(directory, "../ts/ble-wifi/device-rpc-codec.generated.ts"), tsCodecSource],
    [resolve(directory, "../ts/ble-wifi/device-control.generated.ts"), controlSource]];
if (flags.has("--esp32")) {
    outputs.push([resolve(directory, "../../../esp32/lib/protocol/include/uroa_rpc.generated.h"), cpp]);
    outputs.push([resolve(directory, "../../../esp32/lib/protocol/src/uroa_rpc.generated.cpp"), cppSource]);
    outputs.push([resolve(directory, "../../../esp32/lib/protocol/include/uroa_wire.generated.h"), wire.cppHeader]);
    outputs.push([resolve(directory, "../../../esp32/lib/protocol/src/uroa_wire.generated.cpp"), wire.cpp]);
    outputs.push([resolve(directory, "../../../esp32/lib/wifi/include/uroa_json.generated.h"), json.cppHeader]);
    outputs.push([resolve(directory, "../../../esp32/lib/wifi/src/uroa_json.generated.cpp"), json.cpp]);
    outputs.push([resolve(directory, "../../../esp32/app/diagram-control/include/control_rpc.generated.h"), serverHeader]);
    outputs.push([resolve(directory, "../../../esp32/app/diagram-control/src/control_rpc.generated.cpp"), serverSource]);
}
for (const [path, content] of outputs) {
    if (flags.has("--check")) {
        let existing;
        try {
            existing = readFileSync(path, "utf8");
        }
        catch {
            existing = undefined;
        }
        requireCondition(existing === content, `生成物が一致しません: ${path}`);
    }
    else {
        writeFileSync(path, content, "utf8");
    }
}
console.log(`RPC ${flags.has("--check") ? "checked" : "generated"}: ${methods.length} methods, ${outputs.length} files (control/wire/JSON), ${fingerprint.slice(0, 12)}`);
