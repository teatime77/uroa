/**
 * ポートが扱う数値・文字列・構造体の型定義と値の検証・コピーを担当する。UIや機器通信には依存しない。
 */
/** Diagram value types. This module has no UI, block, parser, or BLE dependencies. */
export type StructValue = { readonly [field: string]: DataValue };
/**
 * ポート間で受け渡す数値・文字列・構造体値。
 */
export type DataValue = number | string | StructValue;
/**
 * 3軸センサー値に使う読取り専用ベクトル。
 */
export interface Vec3Value extends StructValue { /** 3成分ベクトルのX成分。 */ readonly x: number; /** 3成分ベクトルのY成分。 */ readonly y: number; /** 3成分ベクトルのZ成分。 */ readonly z: number; }
/** 同じTelemetryから取得した時刻・角速度・加速度。 */
export interface IMUValue extends StructValue {
    /** ESP32起動後の経過時間。単位はミリ秒。 */
    readonly time: number;
    /**
     * 同じサンプル時刻に取得した3軸の角速度。
     */
    readonly gyro: Vec3Value;
    /**
     * 同じサンプル時刻に取得した3軸の加速度。
     */
    readonly acc: Vec3Value;
}

/**
 * 名前から構造体の定義を解決する登録表。Structの構築時に追加する。
 */
const structs = new Map<string, Struct>();

/**
 * ポートの型名と、値の検証・構造体コピーを管理する。
 */
export class DataType {
    /**
     * 配列の次元情報を保存する欄。現実装は空配列だけを受け付ける。
     */
    dimensions: number[] = [];

    /**
     * この型の状態と依存先を初期化する。
     */
    constructor(/** 組込み型または登録済み構造体を識別する型名。 */ public typeName: string = "number") {}

    /**
     * 組込み型ならundefined、構造体型なら登録済みの定義を返す。
     */
    get struct(): Struct | undefined {
        if (this.typeName === "number" || this.typeName === "string") return undefined;
        const struct = structs.get(this.typeName);
        if (!struct) throw new Error(`未定義の構造体型: ${this.typeName}`);
        return struct;
    }

    /**
     * 型名が一致し、両方とも非配列の型であるかを調べる。
     */
    equals(other: DataType): boolean {
        return this.typeName === other.typeName && this.dimensions.length === 0 && other.dimensions.length === 0;
    }

    /**
     * 有限数値・文字列・構造体のフィールドを型定義と照合し、不正なら例外を投げる。
     *
     * @param value 検証または反映する値。
     */
    validateValue(value: unknown, path = this.typeName): void {
        if (this.dimensions.length) throw new Error("配列型はまだ対応していません。");
        if (this.typeName === "number") {
            if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path}には有限の数値が必要です。`);
            return;
        }
        if (this.typeName === "string") {
            if (typeof value !== "string") throw new Error(`${path}には文字列が必要です。`);
            return;
        }
        const struct = this.struct!;
        if (!value || typeof value !== "object" || Array.isArray(value)
            || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
            throw new Error(`${path}には${struct.name}の構造体データが必要です。`);
        }
        const record = value as Record<string, unknown>;
        const names = Object.keys(record);
        if (names.length !== struct.members.length || struct.members.some(field => !Object.hasOwn(record, field.name))) {
            throw new Error(`${path}のフィールドは${struct.members.map(field => field.name).join(", ")}です。`);
        }
        for (const field of struct.members) field.type.validateValue(record[field.name], `${path}.${field.name}`);
    }

    /** Validate and copy nested data so consumers cannot mutate another port's sample. */
    copyValue(value: unknown): DataValue {
        this.validateValue(value);
        const struct = this.struct;
        if (!struct) return value as number | string;
        const record = value as StructValue;
        const result: Record<string, DataValue> = {};
        for (const field of struct.members) result[field.name] = field.type.copyValue(record[field.name]);
        return Object.freeze(result);
    }

    /**
     * 図の保存に必要な設定をJSON化可能なオブジェクトへ変換する。
     */
    makeObj(): { /** 組込み型または登録済み構造体を識別する型名。 */ typeName: string; /** 配列の次元情報を保存する欄。現実装は空配列だけを受け付ける。 */ dimensions: number[] } {
        return { typeName: this.typeName, dimensions: [...this.dimensions] };
    }

    /**
     * 保存された型名と非配列の次元情報を検証し、登録済みの型を復元する。
     *
     * @param value 検証または反映する値。
     */
    static fromObj(value: unknown): DataType {
        if (!value || typeof value !== "object" || !("typeName" in value) || typeof value.typeName !== "string") {
            throw new Error("ポートのデータ型が正しくありません。");
        }
        if ("dimensions" in value && (!Array.isArray(value.dimensions) || value.dimensions.length)) {
            throw new Error("配列型はまだ対応していません。");
        }
        const type = new DataType(value.typeName);
        void type.struct;
        return type;
    }
}

/**
 * 名前とデータ型を持つ宣言。
 */
export class Variable {
    /**
     * この型の状態と依存先を初期化する。
     *
     * @param name 対象を識別する名前。
     * @param type 検証または配置するデータ型。
     */
    constructor(/** 表示・保存・名前解決に使用する名前。 */ public name: string, /** 対象の種別またはデータ型。 */ public type: DataType) {}
}

/**
 * 所属する構造体への参照を持つフィールド宣言。
 */
export class Field extends Variable {
    /**
     * この要素を所有する親の参照。
     */
    parent!: Struct;
}

/**
 * 宣言順のフィールドを登録し、名前から解決できる構造体定義。
 */
export class Struct {
    /**
     * 構造体の宣言順のフィールド一覧。型検証と値コピーでもこの順を使用する。
     */
    members: Field[];

    /**
     * この型の状態と依存先を初期化する。
     *
     * @param name 対象を識別する名前。
     */
    constructor(/** 表示・保存・名前解決に使用する名前。 */ public name: string, members: Field[]) {
        if (!name || name === "number" || name === "string" || structs.has(name)) throw new Error(`型名が重複または不正です: ${name}`);
        const names = new Set<string>();
        for (const field of members) {
            if (!field.name || ["__proto__", "constructor", "prototype"].includes(field.name) || names.has(field.name)) {
                throw new Error(`フィールド名が重複または不正です: ${field.name}`);
            }
            if (field.type.dimensions.length) throw new Error("配列型はまだ対応していません。");
            void field.type.struct; // Members must reference already defined types; no recursive types.
            names.add(field.name);
            field.parent = this;
        }
        this.members = members.slice();
        structs.set(name, this);
    }

    /**
     * 名前に対応するフィールド定義を返す。未登録の名前は例外として報告する。
     *
     * @param name 対象を識別する名前。
     */
    getField(name: string): Field {
        const field = this.members.find(field => field.name === name);
        if (!field) throw new Error(`${this.name}.${name}は定義されていません。`);
        return field;
    }
}

/**
 * 数値ポートで共有する組込み数値型。
 */
export const numberType = new DataType("number");
/**
 * 文字列ポートで共有する組込み文字列型。
 */
export const stringType = new DataType("string");
/**
 * X・Y・Zの3成分を持つ構造体の登録定義。
 */
export const vec3Struct = new Struct("vec3", ["x", "y", "z"].map(name => new Field(name, numberType)));
/**
 * 3成分ベクトルのポートで共有する型。
 */
export const vec3Type = new DataType("vec3");
/**
 * サンプル時刻・角速度・加速度からなるIMUの構造体定義。
 */
export const imuStruct = new Struct("IMU", [
    new Field("time", numberType),
    new Field("gyro", vec3Type),
    new Field("acc", vec3Type)
]);
/**
 * IMUの構造体ポートで共有する型。
 */
export const imuType = new DataType("IMU");
