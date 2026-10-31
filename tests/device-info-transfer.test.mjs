import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// ソースをメモリー内で評価する模擬BLE試験。公開ビルドと実BLEは対象外。
const source = readFileSync(new URL('../diagram/ts/ble-wifi/ble.ts', import.meta.url), 'utf8');
const script = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture({ fastTimeout = false } = {}) {
    class FunctionBlock {}
    class Device extends FunctionBlock {
        constructor(payload, sensor = true, actuator = false) {
            super();
            this.payload = payload;
            this.sensor = sensor;
            this.actuator = actuator;
        }
        isSensor() { return this.sensor; }
        isActuator() { return this.actuator; }
        writeDeviceInfo(bytes, offset) {
            for (const value of this.payload) {
                bytes[offset++] = value;
            }
            return offset;
        }
    }
    const editor = { blocks: [] };
    const exports = {};
    runInNewContext(script, {
        exports,
        require(name) {
            if (name === '../block') {
                return { FunctionBlock, registerFunctionBlock() {} };
            }
            if (name === '../json-util') {
                return { theEditor: editor };
            }
            if (name === '../camera/camera-feed') {
                return { setCameraProvider() {} };
            }
            return {};
        },
        setTimeout: (callback, milliseconds) => setTimeout(callback, fastTimeout ? 5 : milliseconds),
        clearTimeout,
        clearInterval,
        console,
    });
    const connection = exports.diagramBLE;
    const writes = [];
    const device = new EventTarget();
    device.gatt = { connected: true, disconnect() { this.connected = false; } };
    connection.device = device;
    connection.deviceInfo = { async writeValueWithResponse(bytes) { writes.push(Array.from(bytes)); } };
    return { connection, editor, writes, Device };
}

test('DeviceInfo sends sensors before actuators without zero padding or duplicates', async () => {
    const { connection, editor, writes, Device } = fixture();
    const servo = new Device([128, 2, 1], false, true);
    const imu = new Device([0], true, true);
    editor.blocks = [servo, new Device([2]), imu];
    await connection.sendDeviceInfo();
    assert.deepEqual(writes, [[2, 0, 128, 2, 1]]);
    assert.equal(connection.sensors.length, 2);
    assert.equal(connection.actuators.length, 1);
});

test('DeviceInfo sends an empty value to clear an empty diagram', async () => {
    const { connection, writes } = fixture();
    await connection.sendDeviceInfo();
    assert.deepEqual(writes, [[]]);
});

test('DeviceInfo accepts exactly 20 bytes and rejects overflow without writing', async () => {
    const { connection, editor, writes, Device } = fixture();
    editor.blocks = Array.from({ length: 20 }, () => new Device([0]));
    await connection.sendDeviceInfo();
    assert.equal(writes[0].length, 20);
    editor.blocks.push(new Device([0]));
    await assert.rejects(connection.sendDeviceInfo(), /20/);
    assert.equal(writes.length, 1);
    assert.equal(connection.sensors.length, 20);
});

test('DeviceInfo rejects a serializer that returns an invalid offset', async () => {
    const { connection, editor, writes, Device } = fixture();
    const invalid = new Device([0]);
    invalid.writeDeviceInfo = () => Number.NaN;
    editor.blocks = [invalid];
    await assert.rejects(connection.sendDeviceInfo());
    assert.deepEqual(writes, []);
});

test('DeviceInfo waits for the shared write queue and cancels an old session', async () => {
    const { connection, editor, writes, Device } = fixture();
    editor.blocks = [new Device([0])];
    let release;
    connection.tail = new Promise(resolve => { release = resolve; });
    const pending = connection.sendDeviceInfo();
    await Promise.resolve();
    assert.deepEqual(writes, []);
    connection.generation++;
    release();
    await assert.rejects(pending, /BLE/);
    assert.deepEqual(writes, []);
});

test('DeviceInfo serializes consecutive writes on the shared queue', async () => {
    const { connection } = fixture();
    let active = 0;
    let maximum = 0;
    connection.deviceInfo.writeValueWithResponse = async () => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
    };
    await Promise.all([connection.sendDeviceInfo(), connection.sendDeviceInfo()]);
    assert.equal(maximum, 1);
});

test('DeviceInfo times out a stalled write and clears the connection', async () => {
    const { connection } = fixture({ fastTimeout: true });
    connection.deviceInfo.writeValueWithResponse = () => new Promise(() => {});
    await assert.rejects(connection.sendDeviceInfo(), /タイムアウト/);
    assert.equal(connection.state.phase, 'error');
    assert.equal(connection.deviceInfo, undefined);
    assert.equal(connection.sensors.length, 0);
});

test('DeviceInfo rejects a completion from a disconnected session', async () => {
    const { connection, editor, Device } = fixture();
    editor.blocks = [new Device([0])];
    let finish;
    connection.deviceInfo.writeValueWithResponse = () => new Promise(resolve => { finish = resolve; });
    const pending = connection.sendDeviceInfo();
    await new Promise(resolve => setTimeout(resolve, 0));
    connection.disconnect();
    finish();
    await assert.rejects(pending, /取り消/);
    assert.equal(connection.sensors.length, 0);
});
