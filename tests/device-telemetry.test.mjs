import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// 実際の受信処理とIMUBlock.readStatusをメモリー内で評価する。ビルド・実BLEは対象外。
function fixture(sensorCount) {
    class FunctionBlock {}
    class MyError extends Error {}
    const modules = {};
    const types = { IMU6Axis: 0, IMU9Axis: 1, UltrasonicDistanceSensor: 2, Camera: 3, ServoMotor: 128 };
    function load(file) {
        const exports = {};
        const script = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText;
        runInNewContext(script, {
            exports, Error, DataView, Uint8Array, setTimeout, clearTimeout, clearInterval, console,
            require(name) {
                if (name === '../block') {
                    return { FunctionBlock, DeviceType: types, registerFunctionBlock() {} };
                }
                if (name === '@i18n') {
                    return { assert, MyError };
                }
                if (name === '../ble-wifi/ble') {
                    return modules.ble;
                }
                if (name === '../data_type') {
                    return { imuType: { copyValue: value => value } };
                }
                if (name === '../json-util') {
                    return { theEditor: { blocks: [] } };
                }
                return {};
            },
        });
        return exports;
    }
    modules.ble = load('../diagram/ts/ble-wifi/ble.ts');
    const imu = load('../diagram/ts/hardware/imu.ts');
    const connection = new modules.ble.BLEConnection();
    const updates = [];
    const closed = [];
    connection.state = { phase: 'connected', imuAvailable: true };
    connection.requestedRate = 10;
    connection.sensors = Array.from({ length: sensorCount }, (_, index) => {
        const sensor = Object.create(imu.IMUBlock.prototype);
        sensor.deviceType = types.IMU6Axis;
        sensor.setIMU = value => updates.push({ index, value });
        return sensor;
    });
    connection.close = (phase, message) => closed.push({ phase, message });
    return { updates, closed, receive: data => connection.sampleChanged({ target: { value: data } }) };
}

function packet(count) {
    const data = new DataView(new ArrayBuffer(8 + 13 * count));
    data.setUint8(0, 3);
    data.setUint8(1, 11);
    data.setUint16(2, 7, true);
    data.setUint32(4, 1234, true);
    for (let i = 0; i < count; i++) {
        const offset = 8 + i * 13;
        data.setUint8(offset, 0);
        [16384, -8192, 4096, 131, -262, 393].forEach((value, axis) => {
            data.setInt16(offset + 1 + axis * 2, value, true);
        });
    }
    return data;
}

test('version 3 decodes a 21-byte IMU record with correct units', () => {
    const f = fixture(1);
    f.receive(packet(1));
    assert.deepEqual(f.closed, []);
    assert.equal(f.updates.length, 1);
    const { acc, gyro } = f.updates[0].value;
    assert.equal(acc.x, 9.80665);
    assert.equal(acc.y, -4.903325);
    assert.equal(acc.z, 2.4516625);
    assert.equal(gyro.x, 1);
    assert.equal(gyro.y, -2);
    assert.equal(gyro.z, 3);
});

test('version 3 applies consecutive records to the registered IMU blocks in order', () => {
    const f = fixture(2);
    const data = packet(2);
    data.setInt16(21 + 7, -131, true);
    f.receive(data);
    assert.deepEqual(f.closed, []);
    assert.deepEqual(f.updates.map(update => update.index), [0, 1]);
    assert.equal(f.updates[1].value.gyro.x, -1);
});

test('version 3 rejects incomplete payloads before updating any block', () => {
    const f = fixture(2);
    const data = packet(2);
    f.receive(new DataView(data.buffer, 0, data.byteLength - 1));
    assert.equal(f.closed.length, 1);
    assert.deepEqual(f.updates, []);
});

test('version 3 rejects a later wrong device type without partial updates', () => {
    const f = fixture(2);
    const data = packet(2);
    data.setUint8(21, 1);
    f.receive(data);
    assert.equal(f.closed.length, 1);
    assert.deepEqual(f.updates, []);
});

test('version 3 rejects trailing bytes and mismatched device counts', () => {
    const f = fixture(1);
    f.receive(packet(2));
    assert.equal(f.closed.length, 1);
    assert.deepEqual(f.updates, []);
});

test('version 3 supports an empty sensor list and DataView byte offsets', () => {
    const empty = fixture(0);
    empty.receive(packet(0));
    assert.deepEqual(empty.closed, []);
    const f = fixture(1);
    const data = packet(1);
    const buffer = new Uint8Array(data.byteLength + 10);
    buffer.set(new Uint8Array(data.buffer), 5);
    f.receive(new DataView(buffer.buffer, 5, data.byteLength));
    assert.deepEqual(f.closed, []);
    assert.equal(f.updates[0].value.acc.x, 9.80665);
});

