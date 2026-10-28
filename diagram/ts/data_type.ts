/** Diagram value types. This module has no UI, block, parser, or BLE dependencies. */
export type StructValue = { readonly [field: string]: DataValue };
export type DataValue = number | string | StructValue;
export interface Vec3Value extends StructValue { readonly x: number; readonly y: number; readonly z: number; }
export interface IMUValue extends StructValue { readonly gyro: Vec3Value; readonly acc: Vec3Value; }
export interface BalanceValue extends StructValue { readonly attitude: StructValue; readonly command: StructValue; }

const structs = new Map<string, Struct>();

export class DataType {
    dimensions: number[] = [];

    constructor(public typeName: string = "number") {}

    get struct(): Struct | undefined {
        if (this.typeName === "number" || this.typeName === "string") return undefined;
        const struct = structs.get(this.typeName);
        if (!struct) throw new Error(`未定義の構造体型: ${this.typeName}`);
        return struct;
    }

    equals(other: DataType): boolean {
        return this.typeName === other.typeName && this.dimensions.length === 0 && other.dimensions.length === 0;
    }

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

    makeObj(): { typeName: string; dimensions: number[] } {
        return { typeName: this.typeName, dimensions: [...this.dimensions] };
    }

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

export class Variable {
    constructor(public name: string, public type: DataType) {}
}

export class Field extends Variable {
    parent!: Struct;
}

export class Struct {
    members: Field[];

    constructor(public name: string, members: Field[]) {
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

    getField(name: string): Field {
        const field = this.members.find(field => field.name === name);
        if (!field) throw new Error(`${this.name}.${name}は定義されていません。`);
        return field;
    }
}

export const numberType = new DataType("number");
export const stringType = new DataType("string");
export const vec3Struct = new Struct("vec3", ["x", "y", "z"].map(name => new Field(name, numberType)));
export const vec3Type = new DataType("vec3");
export const imuStruct = new Struct("IMU", [new Field("gyro", vec3Type), new Field("acc", vec3Type)]);
export const imuType = new DataType("IMU");
export const balanceAttitudeStruct = new Struct("BalanceAttitude", ["angle", "target", "rate", "error"].map(name => new Field(name, numberType)));
export const wheelCommandStruct = new Struct("WheelCommandPercent", ["left", "right"].map(name => new Field(name, numberType)));
export const balanceStruct = new Struct("Balance", [new Field("attitude", new DataType(balanceAttitudeStruct.name)), new Field("command", new DataType(wheelCommandStruct.name))]);
export const balanceType = new DataType(balanceStruct.name);
