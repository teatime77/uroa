import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DataType, Field, Struct, imuStruct, imuType, numberType, vec3Struct } from '../diagram/lib/data_type.js';

const measurement = () => ({ gyro: { x: 1, y: -2, z: 3 }, acc: { x: 0, y: 0, z: 9.80665 } });

test('nested IMU types retain field types and owning Struct', () => {
    assert.equal(imuType.struct, imuStruct);
    assert.equal(imuStruct.getField('gyro').type.struct, vec3Struct);
    assert.equal(vec3Struct.getField('x').type, numberType);
    assert.equal(imuStruct.getField('acc').parent, imuStruct);
    assert.throws(() => imuStruct.getField('temperature'), /定義されていません/);
});

test('a structured sample is copied and deeply frozen before fan-out', () => {
    const original = measurement();
    const value = imuType.copyValue(original);
    assert.deepEqual(value, original);
    original.gyro.x = 999;
    assert.equal(value.gyro.x, 1);
    assert.ok(Object.isFrozen(value) && Object.isFrozen(value.gyro) && Object.isFrozen(value.acc));
    assert.throws(() => { value.acc.z = 0; }, TypeError);
});

test('missing fields, extra fields and invalid scalar values fail before publication', () => {
    assert.throws(() => imuType.copyValue({ gyro: { x: 1, y: 2, z: 3 } }), /フィールド/);
    assert.throws(() => imuType.copyValue({ ...measurement(), sequence: 1 }), /フィールド/);
    assert.throws(() => imuType.copyValue({ ...measurement(), acc: { x: '0', y: 0, z: 1 } }), /IMU.acc.x/);
    assert.throws(() => imuType.copyValue({ ...measurement(), gyro: { x: NaN, y: 0, z: 0 } }), /有限/);
    assert.throws(() => imuType.copyValue({ ...measurement(), gyro: { x: Infinity, y: 0, z: 0 } }), /有限/);
});

test('saved type references resolve by registered name, without object identity', () => {
    const restored = DataType.fromObj(JSON.parse(JSON.stringify(imuType.makeObj())));
    assert.notEqual(restored, imuType);
    assert.equal(restored.struct, imuStruct);
    assert.ok(restored.equals(imuType));
    assert.ok(!restored.equals(numberType));
    assert.throws(() => DataType.fromObj({ typeName: 'unknown' }), /未定義/);
    assert.throws(() => DataType.fromObj({ typeName: 'number', dimensions: [3] }), /配列/);
});

test('type registration rejects duplicate names and unresolved recursive fields', () => {
    assert.throws(() => new Struct('IMU', []), /型名/);
    assert.throws(() => new Struct('duplicate-fields', [new Field('x', numberType), new Field('x', numberType)]), /フィールド名/);
    assert.throws(() => new Struct('recursive', [new Field('self', new DataType('recursive'))]), /未定義/);
});
