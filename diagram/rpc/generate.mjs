/**
 * device.proto/options.protoから機器RPCの型・操作表・方向別固定長codecを生成する。
 * protobufjsは生成時の標準.proto構文解析だけに使い、生成物へ依存させない。
 * TypeScriptのホスト型は既存の復号済み値と所有参照を保ち、wire_packetだけ固定長codecの対象にする。
 * 未対応の型・属性不足・番号重複は生成前に拒否する。--checkは書き込まず成果物の一致を検査する。
 * codecは各messageのts_codec/cpp_codec方向だけを生成し、未使用の逆方向は出力しない。
 * 固定値・enum・下限は通常の形式検査へ生成する。C++復号は値を保持し、検査は別関数とする。
 * 既定はWebだけを生成する。--esp32で隣接ESP32のヘッダー・実装も更新・照合する。
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import protobuf from "protobufjs";

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
        result.min = option(field, "min_value", result.minimum);
        requireCondition(Number.isInteger(result.min) && result.min >= result.minimum && result.min <= result.maximum,
            `受理下限が不正: ${field.fullName}`);
        if (result.fixed !== undefined) {
            requireCondition(Number.isInteger(result.fixed) && result.fixed >= result.min && result.fixed <= result.maximum,
                `固定値が格納幅の範囲外: ${field.fullName}`);
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
            scope: option(service, "scope", "device"), subscription, hasRequest: method.resolvedRequestType.name !== "Empty",
            synchronous: option(method, "synchronous", false), priority: option(method, "priority", false),
            completion: option(method, "completion", "subscription"), ioTimeoutMs: option(method, "io_timeout_ms", 0),
            request: method.resolvedRequestType.name, response: method.resolvedResponseType.name });
    }
}

/** 定義の指紋はコメント・絶対パスを含めず、型・配置・番号・契約から生成する。 */
const fingerprint = createHash("sha256").update(JSON.stringify({ schema: schema.toJSON(), packets, methods })).digest("hex");
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
    ...enums.flatMap(item => ["        /**", "         * @brief 既存パケットの操作番号。", "         */", `        enum class ${item.name} : uint8_t {`,
        ...Object.entries(item.values).map(([name, value]) => `            ${name} = ${value},`), "        };", ""]),
    "        /**", "         * @brief ローカルRPCのサービスと操作の識別番号。既存パケットへは追加しない。", "         */", "        enum class Method : uint32_t {",
    ...methods.map(method => `            ${method.service}${method.method} = ${(method.serviceId << 16) | method.methodId},`), "        };", "",
    ...Object.entries(packets).flatMap(([name, layout]) => ["        /**", "         * @brief 宣言順・little endian・パディングなしの位置。sizeofで通信サイズを求めない。", "         */",
        `        struct ${name}Layout {`, `            static constexpr size_t ByteLength = ${layout.byteLength}; ///< パケット全長。`,
        ...layout.fields.flatMap(field => [`            static constexpr size_t ${field.name} = ${field.offset}; ///< ${field.bits}bitの先頭位置。`,
            ...(field.fixed === undefined ? [] : [`            static constexpr uint${field.bits}_t ${field.name}Value = ${field.fixed}; ///< 通常形式の固定値。`])]), "        };", "",
        "        /**", "         * @brief 固定長パケットの値。メモリー上の配置を直接送らない。", "         */", `        struct ${name} {`,
        ...layout.fields.map(field => `            ${field.signed ? "int" : "uint"}${field.bits}_t ${field.name}; ///< ${field.bits}bitの値。`), "        };", "",
        ...cppCodecDeclarations(name, layout)]),
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
        "        }", ""]), "    }", "}", ""].join("\n");

/** 全成果物を生成し終えてから書き込む。--checkでは欠落も不一致として失敗させる。 */
// 型/メタデータとcodecを分け、rpc-clientが参照する定義へエラー型の循環依存を作らない。
const tsCodecSource = [header, 'import { RpcCode, RpcError } from "./rpc-client";',
    `import type { ${Object.entries(packets).filter(([, layout]) => layout.directions.ts).map(([name]) => name).join(", ")} } from "./device-rpc.generated";`,
    ...tsCodecs, ""].join("\n\n");
const outputs = [[resolve(directory, "../ts/ble-wifi/device-rpc.generated.ts"), ts],
    [resolve(directory, "../ts/ble-wifi/device-rpc-codec.generated.ts"), tsCodecSource]];
if (flags.has("--esp32")) {
    outputs.push([resolve(directory, "../../../esp32/lib/protocol/include/uroa_rpc.generated.h"), cpp]);
    outputs.push([resolve(directory, "../../../esp32/lib/protocol/src/uroa_rpc.generated.cpp"), cppSource]);
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
console.log(`RPC ${flags.has("--check") ? "checked" : "generated"}: ${methods.length} methods, ${Object.keys(packets).length} packet layouts, ${fingerprint.slice(0, 12)}`);
