/** JSONの実フィールドとHTTP/WSの窓口を生成する。署名・資格情報・接続状態は所有しない。 */
export function generateJson(root) {
    const space = root.lookup("uroa.network");
    const option = (item, name) => item.options?.[`(uroa.${name})`];
    const literal = field => option(field, "json_literal") ?? option(field, "json_bool_literal");
    const messages = space.nestedArray.filter(type => option(type, "json_codec"));
    const scalarType = field => field.repeated ? `readonly ${field.resolvedType ? `Json${field.resolvedType.name}` : "string"}[]`
        : field.type === "string" ? "string" : field.type === "bool" ? "boolean" : "number";
    const nativeType = field => field.repeated ? "JsonArrayConst" : field.type === "string" ? "const char *"
        : field.type === "bool" ? "bool" : field.type === "sint32" ? "int32_t" : "uint32_t";
    const nativeArg = field => field.type === "string" ? `const String &${field.name}` : `${nativeType(field)} ${field.name}`;
    const header = "/** transport.protoから自動生成。手動編集しない。 */";
    const ts = [header, 'import type { BytecodeChannel } from "./bytecode-transfer";', 'import type { DebugChannel } from "./debug-protocol";'];
    const h = ["/**", " * @file uroa_json.generated.h", " * @brief transport.protoのJSONフィールドと窓口。手動編集しない。", " */", "#pragma once", "#include <Arduino.h>", "#include <ArduinoJson.h>", "namespace uroa {", "    namespace jsonwire {"];
    const cpp = ["/**", " * @file uroa_json.generated.cpp", " * @brief JSONの読み書きと既存Wi-Fi窓口への配送。手動編集しない。", " */", '#include "uroa_json.generated.h"', '#include "uroa_wifi.h"', "#include <memory>", "#include <new>", "namespace uroa {", "    namespace jsonwire {"];
    for (const type of messages) {
        const fields = type.fieldsArray;
        // 全フィールドが固定値なら、メモリー確保不要の応答も定義から作る。
        const literals = fields.map(field => literal(field) ?? option(field, "json_bool_literal"));
        if (literals.every(value => value !== undefined)) {
            const body = JSON.stringify(Object.fromEntries(fields.map((field, index) => [field.name, literals[index]])));
            h.push(`        extern const char ${type.name}Json[]; ///< 宣言した固定JSON。`);
            cpp.push(`        const char ${type.name}Json[] = ${JSON.stringify(body)};`);
        }
        ts.push(`export interface Json${type.name} {\n${fields.map(field => `    ${field.name}${option(field, "host_optional") ? "?" : ""}: ${literal(field) !== undefined ? JSON.stringify(literal(field)) : scalarType(field)};`).join("\n")}\n}`,
            `/** フィールドを借用する。意味・型の厳密検査は従来の機器/署名の検査へ委譲する。 */
export function read${type.name}(input: unknown): Json${type.name} {
    if (typeof input !== "object" || input === null) {
        throw new Error("JSON応答が不正です。");
    }
    const value = input as Record<string, unknown>;
    return {
${fields.map(field => `        ${field.name}: value.${field.name} as ${literal(field) !== undefined ? JSON.stringify(literal(field)) : scalarType(field)},`).join("\n")}
    };
}`,
            `/** JSON.stringifyへ渡す宣言順のフィールドを作る。資格情報を保持・記録しない。 */
export function make${type.name}(value: ${fields.every(field => literal(field) === undefined) ? `Json${type.name}` : `Omit<Json${type.name}, ${fields.filter(field => literal(field) !== undefined).map(field => JSON.stringify(field.name)).join(" | ")}>`}): Json${type.name} {
    return {
${fields.map(field => `        ${field.name}: ${literal(field) === undefined ? `value.${field.name}` : JSON.stringify(literal(field))},`).join("\n")}
    };
}`);
        h.push("        /**", `         * @brief ${type.name}のJSON値。文字列と配列はDocumentを借用する。`, "         */", `        struct ${type.name} {`,
            ...fields.map(field => `            ${nativeType(field)}${field.type === "string" && !field.repeated ? "" : " "}${field.name}; ///< JSONの値。`), "        };",
            "        /**", "         * @brief Document内の値を借用して読む。", "         * @param input 解析済みJSON。", "         * @return 借用した値。寿命を越えて保存しない。", "         */", `        ${type.name} read${type.name}(JsonVariantConst input);`,
            "        /**", "         * @brief 宣言順のJSONフィールドを書く。", "         * @param out 出力オブジェクト。", ...fields.filter(field => literal(field) === undefined).map(field => `         * @param ${field.name} ${field.name}の値。`), "         */",
            `        void write${type.name}(JsonObject out${fields.filter(field => literal(field) === undefined).map(field => `, ${nativeArg(field)}`).join("")});`);
        cpp.push(`        ${type.name} read${type.name}(JsonVariantConst input) {`, `            ${type.name} value{};`,
            ...fields.map(field => `            value.${field.name} = ${field.repeated ? `input["${field.name}"].as<JsonArrayConst>()` : `input["${field.name}"] | ${field.type === "string" ? '""' : field.type === "bool" ? "false" : `${nativeType(field)}(0)`}`};`), "            return value;", "        }",
            `        void write${type.name}(JsonObject out${fields.filter(field => literal(field) === undefined).map(field => `, ${nativeArg(field)}`).join("")}) {`,
            ...fields.map(field => `            out["${field.name}"] = ${literal(field) === undefined ? field.name : JSON.stringify(literal(field))};`), "        }");
    }
    const provision = space.lookupEnum("ProvisionOperation");
    const operations = Object.entries(provision.values).map(([name, value]) => ({ name, value, text: option({ options: provision.valuesOptions?.[name] }, "json_name") }));
    ts.push(`export const provisionOps = ${JSON.stringify(Object.fromEntries(operations.filter(item => item.text).map(item => [item.text, item.text])), null, 4)} as const;`);
    h.push("        /**", "         * @brief BLE設定JSONの操作。", "         */", "        enum class ProvisionOperation {", ...operations.map(item => `            ${item.name} = ${item.value},`), "        };", "        /**", "         * @brief 設定の操作名を読む。", "         * @param value 操作名。", "         * @return 不明ならPROVISION_UNKNOWN。", "         */", "        ProvisionOperation provisionOperation(const String &value);");
    cpp.push("        ProvisionOperation provisionOperation(const String &value) {", ...operations.filter(item => item.text).flatMap(item => [`            if (value == ${JSON.stringify(item.text)}) {`, `                return ProvisionOperation::${item.name};`, "            }"]), "            return ProvisionOperation::PROVISION_UNKNOWN;", "        }");
    const routes = space.lookupService("Http").methodsArray.map(method => {
        const route = method.parsedOptions?.find(item => item["(uroa.route)"])?.["(uroa.route)"];
        if (!route || !/^\/[a-z-]+$/.test(route.path) || !["GET", "POST"].includes(route.verb)
            || ["callback", "storage", "server_method", "client_method"].some(key => route[key] && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(route[key]))
            || (route.callback && (!Number.isInteger(route.min_bytes) || !Number.isInteger(route.max_bytes) || route.max_bytes < route.min_bytes))) {
            throw new Error(`HTTP窓口の定義が不正: ${method.name}`);
        }
        return { name: method.name, op: "", min_bytes: 0, max_bytes: 0, ...route };
    });
    if (new Set(routes.map(route => route.path)).size !== routes.length) {
        throw new Error("HTTP窓口が重複しています");
    }
    ts.push(`export const transportRoutes = ${JSON.stringify(Object.fromEntries(routes.map(route => [route.name, route])), null, 4)} as const;`,
        `export type TransportResource = typeof transportRoutes[keyof typeof transportRoutes];`,
        `export const signedReadPaths: readonly string[] = ${JSON.stringify(routes.filter(route => route.authenticated && route.verb === "GET" && !route.camera).map(route => route.path))};`);
    const channels = [...new Set(routes.filter(route => route.channel).map(route => route.channel))];
    for (const channel of channels) {
        const members = routes.filter(route => route.channel === channel);
        ts.push(`/** 接続世代のcheckと既存の署名付きI/Oへ生成した窓口を接続する。 */
export function create${channel}Channel(check: () => void, write: (route: TransportResource, bytes: Uint8Array) => Promise<void>,
    read: (route: TransportResource) => Promise<DataView>): ${channel}Channel {
    return {
${channel === "Bytecode" ? `        packetLength: ${members.find(route => route.callback).max_bytes},` : ""}
${members.map(route => route.callback ? `        ${route.client_method}: async bytes => {\n            check();\n            if (bytes.byteLength < ${route.min_bytes} || bytes.byteLength > ${route.max_bytes}) {\n                throw new Error("送信サイズが窓口の範囲外です。");\n            }\n            await write(transportRoutes.${route.name}, bytes);\n        },` : `        ${route.client_method}: () => {\n            check();\n            return read(transportRoutes.${route.name});\n        },`).join("\n")}
    };
}`);
    }
    h.push("        /**", "         * @brief 既存HTTP/WSの資源。番号は通信へ送らない。", "         */", "        enum class Resource {", "            Unknown,", ...routes.map(route => `            ${route.name},`), "        };",
        "        /**", "         * @brief 既存窓口のパスとサイズ。", "         */", "        struct Route {", "            const char *path; ///< HMACにも使う既存パス。", "            const char *op; ///< WS操作名。", "            size_t minBytes; ///< 読み書きの下限。", "            size_t maxBytes; ///< 読み書きの上限。", "            const char *mime; ///< 生データのMIME。", "        };",
        "        /**", "         * @brief 資源の定義を返す。", "         * @param resource 資源。", "         * @return 稼働中有効な定義。", "         */", "        const Route &route(Resource resource);",
        "        /**", "         * @brief パスを資源へ対応付ける。", "         * @param path 既存パス。", "         * @return 不明ならUnknown。", "         */", "        Resource resource(const String &path);", "    }", "}");
    cpp.push("        const Route &route(Resource resource) {", "            static const Route routes[] = {", '                {"", "", 0, 0, ""},', ...routes.map(route => `                {${JSON.stringify(route.path)}, ${JSON.stringify(route.op ?? "")}, ${route.min_bytes ?? 0}, ${route.max_bytes ?? 0}, ${JSON.stringify(route.mime ?? "")}},`), "            };", "            return routes[static_cast<size_t>(resource)];", "        }",
        "        Resource resource(const String &path) {", ...routes.flatMap(route => [`            if (path == ${JSON.stringify(route.path)}) {`, `                return Resource::${route.name};`, "            }"]), "            return Resource::Unknown;", "        }", "    }");
    cpp.push("    /**", "     * @brief 定義済みの認証後HTTP/WS書込みを既存コールバックへ配送する。", "     * @param path 署名検証に使ったパス。", "     * @param payload 既存の16進本文。", "     * @param sessionGeneration 検証済み接続世代。", "     * @return 内容と現在世代が一致して配送できたらtrue。", "     */",
        "    bool WifiNetwork::dispatchControl(const String &path, const String &payload, uint32_t sessionGeneration) {", "        if (!connected.load() || sessionGeneration != generation.load()) {", "            return false;", "        }", "        const auto resource = jsonwire::resource(path);", "        const size_t length = payload.length() / 2;", "        switch (resource) {",
        ...routes.filter(route => route.callback).flatMap(route => [
            `            case jsonwire::Resource::${route.name}: {`, `                if (payload.length() % 2 || length < ${route.min_bytes} || length > ${route.max_bytes}${route.required ? "" : ` || !callbacks_.${route.callback}`}) {`, "                    return false;", "                }",
            ...(route.stack_buffer ? [`                uint8_t buffer[${route.max_bytes}];`, "                uint8_t *data = buffer;"]
                : [`                std::unique_ptr<uint8_t[]> storage(new (std::nothrow) uint8_t[${route.max_bytes}]{});`, "                if (!storage) {", "                    return false;", "                }", "                uint8_t *data = storage.get();"]),
            "                if (!unhex(payload, data, length)) {", "                    return false;", "                }", `                callbacks_.${route.callback}(data, length, sessionGeneration);`, "                return true;", "            }"]),
        "            default:", "                return false;", "        }", "    }",
        "    /**", "     * @brief 定義済みの独立Read資源を選ぶ。", "     * @param path 署名検証に使ったパス。", "     * @return 資源がなければnullptr。内容・世代は呼出元がロック下で検査する。", "     */", "    const WifiNetwork::ControlValue *WifiNetwork::generatedControlValue(const String &path) const {", "        switch (jsonwire::resource(path)) {",
        ...routes.filter(route => route.storage).flatMap(route => [`            case jsonwire::Resource::${route.name}:`, `                return &${route.storage};`]), "            default:", "                return nullptr;", "        }", "    }");
    for (const camera of [false, true]) {
        cpp.push("    /**", "     * @brief 定義から既存のHTTP窓口とOPTIONSを登録する。", "     */", `    void WifiNetwork::registerGenerated${camera ? "Camera" : "Control"}Routes() {`,
            ...routes.filter(route => !!route.camera === camera).flatMap(route => [
                `        registerRoute(${camera ? "cameraServer" : "httpServer"}, jsonwire::route(jsonwire::Resource::${route.name}).path, HTTP_${route.verb}, &WifiNetwork::${route.server_method});`,
                `        registerRoute(${camera ? "cameraServer" : "httpServer"}, jsonwire::route(jsonwire::Resource::${route.name}).path, HTTP_OPTIONS, &WifiNetwork::options);`]), "    }");
    }
    cpp.push("}", "");
    return { ts: ts.join("\n\n") + "\n", cppHeader: h.join("\n") + "\n", cpp: cpp.join("\n") };
}
