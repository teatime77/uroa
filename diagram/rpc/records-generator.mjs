/** .protoの種別付きレコード列を生成する。登録所有・計測・ポート反映は持たない。 */
export function generateRecords(root, layouts, types) {
    const option = (item, name) => item.options?.[`(uroa.${name})`];
    const predicates = type => type.fieldsArray.flatMap(field => {
        const name = `packet.${field.name}`;
        const fixed = option(field, "fixed_value");
        const min = option(field, "min_value");
        const max = option(field, "max_value");
        const sentinel = option(field, "sentinel");
        const conditions = [];
        if (fixed !== undefined) {
            conditions.push(`${name} == ${fixed}`);
        }
        if (min !== undefined) {
            conditions.push(`${name} >= ${min}`);
        }
        if (max !== undefined) {
            conditions.push(`${name} <= ${max}`);
        }
        if (!conditions.length) {
            return [];
        }
        return [sentinel === undefined ? `(${conditions.join(" && ")})` : `(${name} == ${sentinel} || (${conditions.join(" && ")}))`];
    }).join(" && ") || "true";
    const cppH = ["namespace uroa {", "    namespace wire {"];
    const cpp = ["namespace uroa {", "    namespace wire {"];
    const ts = [];
    for (const type of types) {
        const condition = predicates(type);
        ts.push(`export function valid${type.name}(packet: Wire${type.name}): boolean {\n    return ${condition.replaceAll(" == ", " === ")};\n}`);
        cppH.push("        /**", "         * @brief 生成元の固定値・範囲・予約値を検査する。", "         * @param packet 復号した値。", "         * @return wire上の値が有効ならtrue。", "         */", `        bool valid${type.name}(const ${type.name} &packet);`);
        cpp.push(`        bool valid${type.name}(const ${type.name} &packet) {`, `            return ${condition};`, "        }");
    }
    const sets = root.lookup("uroa.wire").nestedArray.flatMap(type => {
        const entry = type.parsedOptions?.find(item => item["(uroa.record_set)"]);
        return entry ? [{ name: type.name, ...entry["(uroa.record_set)"] }] : [];
    });
    for (const set of sets) {
        const variants = Array.isArray(set.variants) ? set.variants : [set.variants];
        const distinct = [...new Set(variants.map(item => item.type))];
        if (!Number.isInteger(set.max_records) || set.max_records <= 0 || !Number.isInteger(set.max_bytes) || set.max_bytes <= 0
            || (set.header && !layouts[set.header]) || new Set(variants.map(item => item.tag)).size !== variants.length
            || variants.some(item => !layouts[item.type] || !layouts[item.type].fields.some(field => field.name === set.tag_field && field.offset === 0))) {
            throw new Error(`レコード列が不正です: ${set.name}`);
        }
        const headerLength = set.header ? layouts[set.header].byteLength : 0;
        ts.push(`export const ${set.name}Limits = { maxRecords: ${set.max_records}, maxBytes: ${set.max_bytes} } as const;`);
        ts.push(`export function ${set.name}RecordLength(kind: number): number {\n    switch (kind) {\n${variants.map(item => `        case ${item.tag}:\n            return ${layouts[item.type].byteLength};`).join("\n")}\n        default:\n            return 0;\n    }\n}`);
        ts.push(`/** 全件を検査し終えてから位置を返す。元データ・登録順は所有者が保持する。 */
export function read${set.name}(view: DataView): { ${set.header ? `header: Wire${set.header}; ` : ""}records: readonly { deviceType: number; offset: number }[] } {
    if (view.byteLength < ${headerLength} || view.byteLength > ${set.max_bytes}) {
        throw new RpcError(RpcCode.InvalidArgument, "${set.name}の長さが不正です。");
    }
${set.header ? `    const header = read${set.header}(view);\n    if (!valid${set.header}(header)) {\n        throw new RpcError(RpcCode.InvalidArgument, "レコード列の版が不正です。");\n    }` : ""}
    const records: { deviceType: number; offset: number }[] = [];
    let offset = ${headerLength};
    while (offset < view.byteLength) {
        const kind = view.getUint8(offset);
        const length = ${set.name}RecordLength(kind);
        if (records.length >= ${set.max_records} || !length || offset + length > view.byteLength) {
            throw new RpcError(RpcCode.InvalidArgument, "レコード列の種別・長さ・件数が不正です。");
        }
        let valid = false;
        switch (kind) {
${variants.map(item => `            case ${item.tag}:\n                valid = valid${item.type}(read${item.type}(view, offset));\n                break;`).join("\n")}
        }
        if (!valid) {
            throw new RpcError(RpcCode.InvalidArgument, "レコードの値が範囲外です。");
        }
        records.push({ deviceType: kind, offset });
        offset += length;
    }
    return { ${set.header ? "header, " : ""}records };
}`);
        if (!set.header) {
            ts.push(`/** 所有者の機器情報を1レコード書く。サイズを含む構造体の直接送信は行わない。 */
export function write${set.name}Record(view: DataView, offset: number, packet: Wire${distinct.join(" | Wire")}): number {
    switch (packet.${set.tag_field}) {
${variants.map(item => `        case ${item.tag}: {\n            const record = packet as Wire${item.type};\n            if (!valid${item.type}(record)) {\n                throw new RpcError(RpcCode.InvalidArgument, "機器情報が範囲外です。");\n            }\n            write${item.type}(view, offset, record);\n            return offset + ${layouts[item.type].byteLength};\n        }`).join("\n")}
        default:\n            throw new RpcError(RpcCode.InvalidArgument, "機器種別が不正です。");
    }
}`);
        }
        cppH.push("        /**", "         * @brief 種別からレコード長を求める。", "         * @param kind 種別。", "         * @return 不明な種別なら0。", "         */", `        size_t ${set.name}RecordLength(uint8_t kind);`);
        cpp.push(`        size_t ${set.name}RecordLength(uint8_t kind) {`, "            switch (kind) {", ...variants.flatMap(item => [`                case ${item.tag}:`, `                    return ${item.type}Layout::ByteLength;`]), "                default:", "                    return 0;", "            }", "        }");
        if (set.header) {
            cppH.push("        /**", "         * @brief 同種別の物理サンプルを共有する列の値。呼出し中だけ借用する。", "         */", `        struct ${set.name}Values {`, ...distinct.map(name => `            const ${name} &${name[0].toLowerCase() + name.slice(1)}; ///< 計測済みの値。`), "        };",
                "        /**", "         * @brief 種別列から必要長を求める。", "         * @param kinds 種別列。", "         * @param count 件数。", "         * @return 不明・オーバーフローなら0。", "         */", `        size_t ${set.name}Length(const uint8_t *kinds, size_t count);`,
                "        /**", "         * @brief 全件検証後にヘッダーとレコード列を書く。", "         * @param out 出力。", "         * @param capacity 容量。", "         * @param header ヘッダー。", "         * @param kinds 登録順の種別。", "         * @param count 件数。", "         * @param values 計測済みの値。", "         * @return 不正なら0で出力を変えない。", "         */", `        size_t write${set.name}(uint8_t *out, size_t capacity, const ${set.header} &header, const uint8_t *kinds, size_t count, const ${set.name}Values &values);`);
            cpp.push(`        size_t ${set.name}Length(const uint8_t *kinds, size_t count) {`, "            if (count && !kinds) {", "                return 0;", "            }", `            size_t length = ${headerLength};`, "            for (size_t index = 0; index < count; ++index) {", `                const size_t bytes = ${set.name}RecordLength(kinds[index]);`, "                if (!bytes || length > SIZE_MAX - bytes) {", "                    return 0;", "                }", "                length += bytes;", "            }", "            return length;", "        }",
                `        size_t write${set.name}(uint8_t *out, size_t capacity, const ${set.header} &header, const uint8_t *kinds, size_t count, const ${set.name}Values &values) {`, `            const size_t length = ${set.name}Length(kinds, count);`, `            if (!out || !length || capacity < length || !valid${set.header}(header)) {`, "                return 0;", "            }", "            for (size_t index = 0; index < count; ++index) {", "                switch (kinds[index]) {",
                ...variants.flatMap(item => [`                    case ${item.tag}:`, `                        if (values.${item.type[0].toLowerCase() + item.type.slice(1)}.${set.tag_field} != ${item.tag} || !valid${item.type}(values.${item.type[0].toLowerCase() + item.type.slice(1)})) {`, "                            return 0;", "                        }", "                        break;"]), "                }", "            }", `            write${set.header}(out, header);`, `            size_t offset = ${headerLength};`, "            for (size_t index = 0; index < count; ++index) {", "                switch (kinds[index]) {",
                ...variants.flatMap(item => [`                    case ${item.tag}:`, `                        write${item.type}(out + offset, values.${item.type[0].toLowerCase() + item.type.slice(1)});`, "                        break;"]), "                }", `                offset += ${set.name}RecordLength(kinds[index]);`, "            }", "            return offset;", "        }");
        }
    }
    return { ts: ts.join("\n\n") + "\n", cppH: [...cppH, "    }", "}", ""].join("\n"), cpp: [...cpp, "    }", "}", ""].join("\n") };
}
