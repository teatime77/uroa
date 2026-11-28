/**
 * 固定ヘッダー・値レコードを.protoの宣言順から生成する。
 * 部分領域への読み書きと固定bytesの借用を扱い、状態・所有権・転送の手順を持たない。
 * C++は未整列アクセス・動的確保を使わず、呼出元が検査した領域だけを読む。
 */
import { generateRecords } from "./records-generator.mjs";
export function generateWire(root) {
    const option = (item, name, fallback) => item.options?.[`(uroa.${name})`] ?? fallback;
    const types = [root.lookup("uroa.wire"), root.lookup("uroa.device")].flatMap(space => space.nestedArray)
        .filter(type => option(type, "extended_codec", false));
    const layouts = {};
    for (const type of types) {
        let offset = 0;
        const fields = type.fieldsArray.map(field => {
            const bytes = field.type === "bytes";
            const length = bytes ? option(field, "fixed_length") : option(field, "bits", 32) / 8;
            if (field.repeated || !Number.isInteger(length) || length <= 0
                || (!bytes && (!["uint32", "sint32"].includes(field.type) || ![1, 2, 4].includes(length)))) {
                throw new Error(`未対応のwireフィールド: ${field.fullName}`);
            }
            const result = { name: field.name, offset, length, bytes, signed: field.type === "sint32" };
            offset += length;
            return result;
        });
        layouts[type.name] = { byteLength: offset, offset: Object.fromEntries(fields.map(field => [field.name, field.offset])), fields };
    }
    const header = "/** wire.proto/device.protoから自動生成。手動編集せずgenerate.mjsを実行する。 */";
    const defaults = Object.fromEntries(types.map(type => [type.name, Object.fromEntries(type.fieldsArray
        .filter(field => option(field, "wire_default", option(field, "fixed_value")) !== undefined)
        .map(field => [field.name, option(field, "wire_default", option(field, "fixed_value"))]))]));
    const bounds = Object.fromEntries(types.map(type => [type.name, Object.fromEntries(type.fieldsArray
        .map(field => [field.name, Object.fromEntries(["min_value", "max_value", "sentinel"].filter(name => option(field, name) !== undefined).map(name => [name, option(field, name)]))]))]));
    const uuidType = root.lookupEnum("uroa.wire.GattUuid");
    const uuids = Object.fromEntries(Object.keys(uuidType.values).map(name => [name.toLowerCase().replace(/_([a-z])/g, (_, char) => char.toUpperCase()), option({ options: uuidType.valuesOptions?.[name] }, "json_name")]));
    const ts = [header, 'import { RpcCode, RpcError } from "./rpc-client";',
        "/** byteOffsetを持つビューも扱う。読み出したbytesは元バッファーを借用する。 */",
        `export const wireLayouts = ${JSON.stringify(layouts, null, 4)} as const;`,
        `export const wireDefaults = ${JSON.stringify(defaults, null, 4)} as const;`,
        `export const wireBounds = ${JSON.stringify(bounds, null, 4)} as const;`,
        `export const gattUuids = ${JSON.stringify(uuids, null, 4)} as const;`,
        `/** 値の意味・タグ別制約は所有者が検査する。生ビットの解釈だけを共通化する。 */
export function wireInt32(bits: number): number {
    return bits | 0;
}
export function wireFloat32(bits: number): number {
    const view = new DataView(new ArrayBuffer(4));
    view.setUint32(0, bits, true);
    return view.getFloat32(0, true);
}
/** 生成したフィールドだけを読み書きする。可変長本体は呼出元が保持・検証する。 */
function region(view: DataView, offset: number, length: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset + length > view.byteLength) {
        throw new RpcError(RpcCode.InvalidArgument, "wire領域の長さが不正です。");
    }
}`,
        ...Object.entries(layouts).flatMap(([name, layout]) => [
            `export interface Wire${name} {\n${layout.fields.map(field => `    ${field.name}: ${field.bytes ? "Uint8Array" : "number"};`).join("\n")}\n}`,
            `/** 部分領域を復号する。全パケットの長さ・版・状態は呼出元で検査する。 */
export function read${name}(view: DataView, offset = 0): Wire${name} {
    region(view, offset, ${layout.byteLength});
    return {
${layout.fields.map(field => `        ${field.name}: ${field.bytes
        ? `new Uint8Array(view.buffer, view.byteOffset + offset + ${field.offset}, ${field.length})`
        : `view.get${field.signed ? "Int" : "Uint"}${field.length * 8}(offset + ${field.offset}${field.length > 1 ? ", true" : ""})`},`).join("\n")}
    };
}`,
            `/** 必要な整数幅を検査して既存領域へ書く。 */
export function write${name}(view: DataView, offset: number, packet: Wire${name}): void {
    region(view, offset, ${layout.byteLength});
${layout.fields.flatMap(field => field.bytes ? [
    `    if (packet.${field.name}.byteLength !== ${field.length}) {`,
    `        throw new RpcError(RpcCode.InvalidArgument, "${name}.${field.name}の長さが不正です。");`, "    }",
    `    new Uint8Array(view.buffer, view.byteOffset + offset + ${field.offset}, ${field.length}).set(packet.${field.name});`]
    : [`    if (!Number.isInteger(packet.${field.name}) || packet.${field.name} < ${field.signed ? -(2 ** (field.length * 8 - 1)) : 0} || packet.${field.name} > ${2 ** (field.length * 8 - (field.signed ? 1 : 0)) - 1}) {`,
        `        throw new RpcError(RpcCode.InvalidArgument, "${name}.${field.name}が整数幅の範囲外です。");`, "    }",
        `    view.set${field.signed ? "Int" : "Uint"}${field.length * 8}(offset + ${field.offset}, packet.${field.name}${field.length > 1 ? ", true" : ""});`]).join("\n")}
}`,
            `/** 固定領域と可変長本体を一度だけコピーして送信用に作る。 */
export function encode${name}(packet: Wire${name}, tail?: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(${layout.byteLength} + (tail?.byteLength ?? 0));
    write${name}(new DataView(bytes.buffer), 0, packet);
    if (tail) {
        bytes.set(tail, ${layout.byteLength});
    }
    return bytes;
}`]), ""].join("\n\n");
    const cppHeader = ["/**", " * @file uroa_wire.generated.h", " * @brief .protoの部分領域codec。手動編集しない。", " */", "#pragma once", "#include <stddef.h>", "#include <stdint.h>",
        "namespace uroa {", "    namespace wire {", "        namespace GattUuidValues {",
        ...Object.entries(uuids).map(([name, value]) => `            constexpr char ${name}[] = ${JSON.stringify(value)}; ///< 既存GATT UUID。`), "        }",
        ...Object.entries(layouts).flatMap(([name, layout]) => [
            "        /**", `         * @brief ${name}の既存wire配置。`, "         */", `        struct ${name}Layout {`,
            `            static constexpr size_t ByteLength = ${layout.byteLength}; ///< 固定領域の長さ。`,
            ...layout.fields.flatMap(field => [`            static constexpr size_t ${field.name} = ${field.offset}; ///< フィールド位置。`,
                ...(defaults[name][field.name] === undefined ? [] : [`            static constexpr uint32_t ${field.name}Default = ${defaults[name][field.name]}; ///< 宣言した既定値。`]),
                ...Object.entries(bounds[name][field.name]).map(([rule, value]) => `            static constexpr uint32_t ${field.name}${rule === "min_value" ? "Min" : rule === "max_value" ? "Max" : "Sentinel"} = ${value}; ///< 宣言した範囲・予約値。`)]), "        };",
            "        /**", "         * @brief 復号値。bytesは受信バッファーを借用し、直接構造体を送らない。", "         */", `        struct ${name} {`,
            ...layout.fields.map(field => `            ${field.bytes ? "const uint8_t *" : `${field.signed ? "int" : "uint"}${field.length * 8}_t `}${field.name}; ///< wire上の値。`), "        };",
            "        /**", "         * @brief 検査済み領域を復号する。", `         * @param data ${layout.byteLength}バイト以上の領域。`, "         * @return bytesはdataと同じ寿命の借用。", "         */",
            `        ${name} read${name}(const uint8_t *data);`,
            "        /**", "         * @brief 固定長の値を書き込む。", `         * @param out ${layout.byteLength}バイト以上の出力領域。`, "         * @param packet 幅とbytesの寿命を保証した値。", "         */",
            `        void write${name}(uint8_t *out, const ${name} &packet);`, ""]), "    }", "}", ""].join("\n");
    const cpp = ["/**", " * @file uroa_wire.generated.cpp", " * @brief .protoの宣言順・little endianの部分領域codec。手動編集しない。", " */",
        '#include "uroa_wire.generated.h"', "#include <string.h>", "namespace uroa {", "    namespace wire {",
        ...Object.entries(layouts).flatMap(([name, layout]) => [
            "        /**", "         * @brief 検査済み固定領域を復号する。", "         * @param data 入力領域。", "         * @return 値と借用bytes。", "         */",
            `        ${name} read${name}(const uint8_t *data) {`, `            ${name} packet{};`,
            ...layout.fields.flatMap(field => {
                if (field.bytes) {
                    return [`            packet.${field.name} = data + ${field.offset};`];
                }
                const expression = Array.from({ length: field.length }, (_, index) =>
                    `(static_cast<uint32_t>(data[${field.offset + index}])${index ? ` << ${8 * index}` : ""})`).join(" | ");
                return [`            const uint32_t ${field.name}Value = ${expression};`,
                    `            packet.${field.name} = ${field.signed ? `static_cast<int${field.length * 8}_t>(${field.name}Value >= ${2 ** (field.length * 8 - 1)}u ? static_cast<int64_t>(${field.name}Value) - ${2 ** (field.length * 8)}LL : ${field.name}Value)` : `static_cast<uint${field.length * 8}_t>(${field.name}Value)`};`];
            }), "            return packet;", "        }",
            "        /**", "         * @brief 固定領域を書く。", "         * @param out 出力領域。", "         * @param packet 検証済みの値。", "         */",
            `        void write${name}(uint8_t *out, const ${name} &packet) {`,
            ...layout.fields.flatMap(field => field.bytes ? [`            memcpy(out + ${field.offset}, packet.${field.name}, ${field.length});`]
                : [`            const uint32_t ${field.name}Value = static_cast<uint32_t>(packet.${field.name});`,
                    ...Array.from({ length: field.length }, (_, index) => `            out[${field.offset + index}] = static_cast<uint8_t>(${field.name}Value${index ? ` >> ${8 * index}` : ""});`)]),
            "        }", ""]), "    }", "}", ""].join("\n");
    const records = generateRecords(root, layouts, types);
    return { ts: ts + records.ts, cppHeader: cppHeader + records.cppH, cpp: cpp + records.cpp };
}
