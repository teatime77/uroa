import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Explicit helper location avoids adding a browser dependency to the application.
const modulePath = process.env.UROA_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set UROA_PLAYWRIGHT_MODULE to playwright-core/index.mjs.');
const { chromium } = await import(pathToFileURL(resolve(modulePath)).href);
const baseURL = (process.env.UROA_TEST_BASE_URL || 'http://127.0.0.1:5175/').replace(/\/$/, '');
let browser;
before(async () => {
    browser = await chromium.launch({ headless: true, executablePath: process.env.UROA_BROWSER_EXECUTABLE });
});
after(async () => { await browser?.close(); });

async function pageFor(context) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, hasTouch: true });
    context.after(() => page.close());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        const mock = window.bleMock = { mode: 'ok', requests: 0, writes: [], controls: [], rate: 0, armed: [], active: 0, maximum: 0 };
        class Characteristic extends EventTarget {
            constructor() { super(); this.value = new DataView(new ArrayBuffer(12)); this.value.setUint8(0, 1); this.value.setUint8(4, 3); }
            async startNotifications() { return this; }
            async readValue() { return this.value; }
            async writeValueWithResponse(bytes) {
                mock.active++; mock.maximum = Math.max(mock.maximum, mock.active); mock.writes.push(bytes[1]);
                const packet = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                mock.controls.push({ opcode: bytes[1], value: packet.getUint16(6, true), channel: bytes[4], duration: packet.getUint16(8, true), bytes: [...bytes] });
                await new Promise(resolve => setTimeout(resolve, 2));
                if (mock.mode === 'holdWrite') await new Promise(resolve => { mock.finishWrite = resolve; });
                mock.active--;
                if (mock.mode !== 'holdAck') {
                    const channel = bytes[4];
                    let code = 0;
                    if (bytes[1] === 1) {
                        if (mock.mode === 'missingPca') code = 4;
                        else if (!mock.armed.includes(channel)) mock.armed.push(channel);
                    }
                    if (bytes[1] === 2 && !mock.armed.includes(channel)) code = 3;
                    if (bytes[1] === 3) mock.armed = [];
                    if (bytes[1] === 7) mock.armed = mock.armed.filter(ch => ch !== channel);
                    if (bytes[1] === 4) mock.rate = packet.getUint16(6, true);
                    status.value.setUint8(1, code);
                    status.value.setUint8(4, (mock.mode === 'missingPca' ? 2 : mock.mode === 'missingImu' ? 1 : 3) | (mock.armed.length ? 4 : 0) | (mock.rate ? 8 : 0));
                    status.value.setUint8(5, channel);
                    status.value.setUint16(2, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(2, true), true);
                    status.dispatchEvent(new Event('characteristicvaluechanged'));
                }
            }
        }
        const command = new Characteristic(), status = new Characteristic(), telemetry = new Characteristic();
        const device = new EventTarget();
        device.name = 'ESP32-BLE-Lab';
        device.gatt = {
            connected: false,
            async connect() {
                if (mock.mode === 'holdGatt') await new Promise(resolve => { mock.finishGatt = resolve; });
                this.connected = true; mock.rate = 0; mock.armed = []; status.value.setUint8(4, mock.mode === 'missingPca' ? 2 : mock.mode === 'missingImu' ? 1 : 3); return this;
            },
            disconnect() {
                const connected = this.connected; this.connected = false; mock.rate = 0; mock.armed = [];
                if (connected) device.dispatchEvent(new Event('gattserverdisconnected'));
            },
            async getPrimaryService() {
                if (mock.mode === 'unsupported') throw new DOMException('No service', 'NotFoundError');
                return { async getCharacteristic(uuid) {
                    return uuid.includes('1401-') ? command : uuid.includes('1403-') ? status : telemetry;
                } };
            },
        };
        mock.device = device;
        mock.emitStop = () => {
            mock.armed = []; mock.rate = 0;
            status.value.setUint8(1, 3); status.value.setUint16(2, 0, true);
            status.value.setUint8(4, 3); status.value.setUint8(5, 255);
            status.dispatchEvent(new Event('characteristicvaluechanged'));
        };
        mock.emitTelemetry = (bad = false) => {
            telemetry.value = new DataView(new ArrayBuffer(bad ? 19 : 20));
            if (!bad) {
                telemetry.value.setUint8(0, 1); telemetry.value.setUint8(1, 11);
                telemetry.value.setUint16(2, 7, true); telemetry.value.setUint32(4, 1234, true);
                [16384, -8192, 0, 131, -262, 0].forEach((raw, index) => telemetry.value.setInt16(8 + index * 2, raw, true));
            }
            telemetry.dispatchEvent(new Event('characteristicvaluechanged'));
        };
        Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: {
            requestDevice(options) {
                mock.requests++; mock.options = options; mock.userGesture = navigator.userActivation.isActive;
                if (mock.mode === 'cancel') return Promise.reject(new DOMException('Cancelled', 'NotFoundError'));
                if (mock.mode === 'holdChoice') return new Promise(resolve => { mock.finishChoice = () => resolve(device); });
                return Promise.resolve(device);
            },
        } });
    });
    await page.goto(`${baseURL}/diagram/index.html`);
    await page.waitForFunction(() => ['ready', 'failed'].includes(window.uroaApp?.state), undefined, { timeout: 60_000 });
    assert.equal(await page.evaluate(() => window.uroaApp.state), 'ready',
        await page.evaluate(() => String(window.uroaApp.error?.stack || window.uroaApp.error || '')) + errors.join('\n'));
    await page.evaluate(async () => {
        const { theEditor } = await import('/diagram/ts/json-util.ts');
        const { diagramBLE, BLEConnectionBlock } = await import('/diagram/ts/ble.ts');
        const { theCanvas } = await import('/diagram/ts/diagram_util.ts');
        const { IMUBlock } = await import('/diagram/ts/imu.ts');
        const { StructPort, NumberPort, Port } = await import('/diagram/ts/port.ts');
        const { imuStruct, DataType, Struct, Field, numberType } = await import('/diagram/ts/data_type.ts');
        const { PlotBlock } = await import('/diagram/ts/plot.ts');
        const { ServoMotorBlock } = await import('/diagram/ts/servo.ts');
        const { geBlockName } = await import('/diagram/ts/index.ts');
        const { PortType } = await import('/diagram/ts/diagram_util.ts');
        window.bleFixture = { editor: theEditor, connection: diagramBLE, Block: BLEConnectionBlock, canvas: theCanvas, IMUBlock, StructPort, NumberPort, Port, imuStruct, PortType, DataType, Struct, Field, numberType, PlotBlock, ServoMotorBlock, geBlockName };
    });
    context.after(() => assert.deepEqual(errors, []));
    return page;
}

async function toolCenter(page, typeName) {
    return page.evaluate(typeName => {
        const f = window.bleFixture;
        const tool = f.editor.tools.find(tool => f.geBlockName(tool.toolIdx) === typeName);
        const [x1, y1, x2, y2] = tool.marginBox();
        return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    }, typeName);
}

async function placeBlock(page) {
    const before = await page.evaluate(() => window.bleFixture.editor.blocks.length);
    const origin = await toolCenter(page, 'BLEConnectionBlock');
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(445, 185, { steps: 8 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.bleFixture.editor.blocks.length), before + 1);
    assert.equal(await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).boxSize.y), 190);
}

async function buttonCenter(page) {
    return page.evaluate(() => {
        const [x1, y1, x2, y2] = window.bleFixture.editor.blocks.at(-1).button.marginBox();
        return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    });
}
async function clickButton(page, touch = false) {
    const { x, y } = await buttonCenter(page);
    if (touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
}
async function waitPhase(page, phase) {
    try {
        await page.waitForFunction(phase => window.bleFixture.connection.state.phase === phase, phase, { timeout: 10_000 });
    } catch (error) {
        throw new Error(`Expected BLE phase ${phase}: ${JSON.stringify(await page.evaluate(() => ({ state: window.bleFixture.connection.state, requests: window.bleMock.requests, controls: window.bleMock.controls, button: window.bleFixture.editor.blocks.at(-1)?.button?.text })))}`, { cause: error });
    }
}

test('toolbox placement, reusable canvas button, readiness, heartbeat and disconnect', async context => {
    const page = await pageFor(context);
    assert.equal(await page.evaluate(() => window.bleMock.requests), 0);
    await placeBlock(page);
    const position = await page.evaluate(() => ({ ...window.bleFixture.editor.blocks.at(-1).position }));
    await clickButton(page);
    await waitPhase(page, 'connected');
    assert.deepEqual(await page.evaluate(() => ({ ...window.bleFixture.editor.blocks.at(-1).position })), position);
    assert.equal(await page.evaluate(() => window.bleMock.userGesture), true);
    assert.equal(await page.evaluate(() => window.bleMock.options.acceptAllDevices), true);
    assert.equal(await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).button.text), '切断');
    await page.waitForFunction(() => window.bleMock.writes.includes(5));
    assert.equal(await page.evaluate(() => window.bleMock.maximum), 1);
    assert.deepEqual(await page.evaluate(() => [...new Set(window.bleMock.writes)].sort()), [5, 6]);
    await clickButton(page);
    await waitPhase(page, 'idle');
    assert.equal(await page.evaluate(() => window.bleMock.device.gatt.connected), false);
    await page.screenshot({ path: 'tmp/ble-connection.png' });
});

test('touch, drag cancellation and pointercancel do not cause accidental connections', async context => {
    const page = await pageFor(context);
    await placeBlock(page);
    const { x, y } = await buttonCenter(page);
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 40, y); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.bleMock.requests), 0);
    await page.mouse.move(x, y); await page.mouse.down();
    await page.locator('#world-diagram').dispatchEvent('pointercancel');
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.bleMock.requests), 0);
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 2, y + 1); await page.mouse.up();
    await waitPhase(page, 'connected');
    await clickButton(page, true); await waitPhase(page, 'idle');
    await clickButton(page, true); await waitPhase(page, 'connected');
});

test('cancelled choice and incompatible devices remain disconnected and can retry', async context => {
    const page = await pageFor(context);
    await placeBlock(page);
    await page.evaluate(() => { window.bleMock.mode = 'cancel'; });
    await clickButton(page); await waitPhase(page, 'idle');
    await page.evaluate(() => { window.bleMock.mode = 'unsupported'; });
    await clickButton(page); await waitPhase(page, 'error');
    assert.match(await page.evaluate(() => window.bleFixture.connection.state.message), /対応した機器/);
    assert.equal(await page.evaluate(() => window.bleMock.device.gatt.connected), false);
    await page.evaluate(() => { window.bleMock.mode = 'ok'; });
    await clickButton(page); await waitPhase(page, 'connected');
    await page.evaluate(() => window.bleMock.device.gatt.disconnect());
    await waitPhase(page, 'idle');
});

test('Clear invalidates a pending chooser and a late native GATT connection', async context => {
    const page = await pageFor(context);
    await placeBlock(page);
    await page.evaluate(() => { window.bleMock.mode = 'holdChoice'; });
    await clickButton(page); await waitPhase(page, 'selecting');
    await clickButton(page);
    assert.equal(await page.evaluate(() => window.bleMock.requests), 1);
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await page.evaluate(() => window.bleMock.finishChoice());
    await waitPhase(page, 'idle');
    assert.equal(await page.evaluate(() => window.bleMock.device.gatt.connected), false);
    await placeBlock(page);
    await page.evaluate(() => { window.bleMock.mode = 'holdGatt'; });
    await clickButton(page); await waitPhase(page, 'connecting');
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await page.evaluate(() => window.bleMock.finishGatt());
    await page.waitForFunction(() => !window.bleMock.device.gatt.connected);
    await waitPhase(page, 'idle');
});

test('shared blocks, download/drop restoration and application disposal release the connection', async context => {
    const page = await pageFor(context);
    await placeBlock(page);
    await clickButton(page); await waitPhase(page, 'connected');
    await placeBlock(page);
    assert.equal(await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).button.text), '切断');
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const download = await downloadEvent;
    const { readFile } = await import('node:fs/promises');
    const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(saved.length, 2);
    assert.ok(saved.every(block => block.typeName === 'BLEConnectionBlock' && block.ports.length === 0));
    assert.ok(saved.every(block => !('device' in block) && !('state' in block) && !('button' in block)));
    await page.evaluate(blocks => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([JSON.stringify(blocks)], 'ble.json', { type: 'application/json' }));
        document.getElementById('world-diagram').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer }));
    }, saved);
    await page.waitForFunction(() => window.bleFixture.editor.blocks.length === 2 && window.bleFixture.connection.state.phase === 'idle');
    assert.equal(await page.evaluate(() => window.bleMock.requests), 1);
    await clickButton(page); await waitPhase(page, 'connected');
    await page.evaluate(() => window.uroaApp.dispose());
    await waitPhase(page, 'idle');
    assert.equal(await page.evaluate(() => window.bleMock.device.gatt.connected), false);
    assert.equal(await page.evaluate(() => window.bleFixture.editor.blocks.length), 0);
});

test('missing ACK fails cleanly and a subsequent connection works', async context => {
    const page = await pageFor(context);
    await placeBlock(page);
    await page.evaluate(() => { window.bleMock.mode = 'holdAck'; });
    await clickButton(page); await waitPhase(page, 'error');
    assert.equal(await page.evaluate(() => window.bleMock.device.gatt.connected), false);
    await page.evaluate(() => { window.bleMock.mode = 'ok'; });
    await clickButton(page); await waitPhase(page, 'connected');
});

test('unavailable Bluetooth disables the button, and hidden tabs release active sessions', async context => {
    const page = await pageFor(context);
    await placeBlock(page);
    await clickButton(page); await waitPhase(page, 'connected');
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitPhase(page, 'idle');
    assert.equal(await page.evaluate(() => window.bleMock.device.gatt.connected), false);
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: undefined });
        window.bleFixture.canvas.repaint();
    });
    assert.equal(await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).button.disabled), true);
    await clickButton(page);
    assert.equal(await page.evaluate(() => window.bleMock.requests), 1);
});

test('existing action blocks still drag and their ports still connect', async context => {
    const page = await pageFor(context);
    for (const destination of [{ x: 445, y: 185 }, { x: 445, y: 355 }]) {
        const origin = await toolCenter(page, 'SleepBlock');
        await page.mouse.move(origin.x, origin.y); await page.mouse.down();
        await page.mouse.move(destination.x, destination.y, { steps: 8 }); await page.mouse.up();
    }
    assert.deepEqual(await page.evaluate(() => window.bleFixture.editor.blocks.map(block => block.constructor.name)), ['SleepBlock', 'SleepBlock']);
    const ports = await page.evaluate(() => {
        const blocks = window.bleFixture.editor.blocks;
        return { from: { ...blocks[0].bottomPort.getPosition() }, to: { ...blocks[1].topPort.getPosition() } };
    });
    await page.mouse.move(ports.from.x, ports.from.y); await page.mouse.down();
    await page.mouse.move(ports.to.x, ports.to.y, { steps: 8 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => {
        const blocks = window.bleFixture.editor.blocks;
        return blocks[0].bottomPort.destinations.includes(blocks[1].topPort);
    }), true);
});

async function placeServo(page) {
    const origin = await toolCenter(page, 'ServoMotorBlock');
    await page.mouse.move(origin.x, origin.y); await page.mouse.down();
    await page.mouse.move(700, 430, { steps: 8 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).constructor.name), 'ServoMotorBlock');
    await page.evaluate(() => { window.servo = window.bleFixture.editor.blocks.at(-1); });
}

async function servoClick(page, name) {
    const position = await page.evaluate(name => {
        const [x1, y1, x2, y2] = window.servo[name].marginBox();
        return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    }, name);
    await page.mouse.click(position.x, position.y);
}

async function connectFirstBlock(page) {
    const position = await page.evaluate(() => {
        const [x1, y1, x2, y2] = window.bleFixture.editor.blocks[0].button.marginBox();
        return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    });
    await page.mouse.click(position.x, position.y); await waitPhase(page, 'connected');
}

test('servo placement needs explicit ARM and wired degrees become MOVE with channel and duration', async context => {
    const page = await pageFor(context);
    await placeBlock(page); await clickButton(page); await waitPhase(page, 'connected');
    await placeServo(page);
    assert.equal(await page.evaluate(() => window.bleMock.writes.some(op => op === 1 || op === 2)), false);
    await page.getByRole('spinbutton', { name: 'チャンネル', exact: true }).fill('3');
    await page.getByRole('spinbutton', { name: 'チャンネル', exact: true }).press('Tab');
    await page.getByRole('spinbutton', { name: '移動時間ms', exact: true }).fill('750');
    await page.evaluate(async () => {
        const { InputNumberBlock } = await import('/diagram/ts/block.ts');
        const { Vec2 } = await import('/i18n/ts/index.ts');
        const source = window.servoSource = new InputNumberBlock({});
        source.input.setAttribute('aria-label', 'サーボ角度');
        source.setBoxSize(); source.setBlockPortPosition(new Vec2(440, 650));
        window.bleFixture.editor.addBlock(source);
    });
    const ports = await page.evaluate(() => ({ from: { ...window.servoSource.numberPort.getPosition() }, to: { ...window.servo.inputPort.getPosition() } }));
    await page.mouse.move(ports.from.x, ports.from.y); await page.mouse.down();
    await page.mouse.move(ports.to.x, ports.to.y, { steps: 8 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.servo.inputPort.sources.length), 1);
    await page.getByRole('spinbutton', { name: 'サーボ角度', exact: true }).fill('105');
    assert.equal(await page.evaluate(() => window.bleMock.writes.includes(2)), false);
    await servoClick(page, 'armButton');
    await page.waitForFunction(() => window.bleFixture.connection.isServoArmed(3) && !window.servo.armButton.disabled);
    await servoClick(page, 'moveButton');
    await page.waitForFunction(() => window.bleMock.controls.some(command => command.opcode === 2));
    await page.getByRole('spinbutton', { name: 'サーボ角度', exact: true }).fill('105.25');
    await page.waitForFunction(() => window.bleMock.controls.some(command => command.opcode === 2 && command.value === 10525));
    await page.evaluate(() => window.servoSource.propergateCalc());
    const commands = await page.evaluate(() => window.bleMock.controls.filter(command => command.opcode === 1 || command.opcode === 2));
    assert.deepEqual(commands.map(({ opcode, channel, value, duration }) => ({ opcode, channel, value, duration })), [
        { opcode: 1, channel: 3, value: 9000, duration: 0 },
        { opcode: 2, channel: 3, value: 10500, duration: 750 },
        { opcode: 2, channel: 3, value: 10525, duration: 750 },
    ]);
    assert.ok(commands.every(command => command.bytes.length === 10 && command.bytes[0] === 1 && command.bytes[5] === 0));
    assert.equal(await page.evaluate(() => window.bleMock.maximum), 1);
    await page.screenshot({ path: 'tmp/servo-block.png', clip: { x: 650, y: 380, width: 390, height: 350 } });
});

test('servo rejects invalid angles, channels and durations before BLE writes', async context => {
    const page = await pageFor(context);
    await placeBlock(page); await clickButton(page); await waitPhase(page, 'connected');
    await placeServo(page);
    await page.evaluate(() => window.servo.arm());
    const result = await page.evaluate(async () => {
        const connection = window.bleFixture.connection, before = window.bleMock.controls.length;
        const errors = [];
        for (const [ch, angle, duration] of [[0, 59, 0], [0, 121, 0], [0, NaN, 0], [0, Infinity, 0], [0, 90, -1], [0, 90, 10001], [0, 90, 1.5], [16, 90, 0], [0.5, 90, 0], [NaN, 90, 0], [1, 90, 0]]) {
            try { await connection.moveServo(ch, angle, duration); } catch (error) { errors.push(error.message); }
        }
        window.servo.inputPort.setPortValue(59); await window.servo.valueChanged();
        return { errors, count: window.bleMock.controls.length - before, message: window.servo.message };
    });
    assert.equal(result.errors.length, 11); assert.equal(result.count, 0); assert.match(result.message, /60～120/);
    await page.evaluate(() => { window.servo.inputPort.setPortValue(120); window.servo.durationInput.value = '0'; return window.servo.valueChanged(); });
    assert.equal(await page.evaluate(() => window.bleMock.controls.at(-1).value), 12000);
    assert.equal(await page.evaluate(() => window.bleMock.controls.at(-1).duration), 0);
});

test('servo STOP cancels queued moves, keeps IMU streaming, and channel changes disable the old output', async context => {
    const page = await pageFor(context);
    await placeBlock(page); await clickButton(page); await waitPhase(page, 'connected');
    await placeIMU(page); await page.waitForFunction(() => window.bleMock.rate === 10);
    await placeServo(page); await page.evaluate(() => window.servo.arm());
    const count = await page.evaluate(() => window.bleMock.writes.filter(op => op === 2).length);
    await page.evaluate(async () => {
        window.servo.inputPort.setPortValue(100); const first = window.servo.valueChanged();
        window.servo.inputPort.setPortValue(110); const second = window.servo.valueChanged();
        await Promise.all([first, second, window.servo.stop()]);
    });
    assert.equal(await page.evaluate(() => window.bleMock.writes.filter(op => op === 2).length), count);
    assert.equal(await page.evaluate(() => window.bleMock.armed.length), 0);
    assert.equal(await page.evaluate(() => window.bleMock.rate), 10);
    await page.evaluate(() => window.servo.arm());
    await page.getByRole('spinbutton', { name: 'チャンネル', exact: true }).fill('1');
    await page.getByRole('spinbutton', { name: 'チャンネル', exact: true }).press('Tab');
    await page.waitForFunction(() => window.bleMock.controls.some(command => command.opcode === 7 && command.channel === 0));
    assert.equal(await page.evaluate(() => window.bleFixture.connection.isServoArmed(0)), false);
    assert.equal(await page.evaluate(() => window.bleFixture.connection.isServoArmed(1)), false);
    await page.evaluate(() => window.servo.arm()); await servoClick(page, 'disableButton');
    await page.waitForFunction(() => !window.bleMock.armed.length);
    await page.evaluate(() => window.servo.arm());
    await page.evaluate(() => window.uroaApp.stop());
    await page.waitForFunction(() => !window.bleMock.armed.length);
    assert.equal(await page.evaluate(() => window.bleMock.rate), 10);
    assert.equal(await page.evaluate(() => window.bleFixture.connection.state.phase), 'connected');
});

test('removing a servo during an in-flight ARM disables it and removes its DOM inputs', async context => {
    const page = await pageFor(context);
    await placeBlock(page); await clickButton(page); await waitPhase(page, 'connected');
    await placeServo(page);
    await page.evaluate(() => { window.bleMock.mode = 'holdWrite'; window.armTask = window.servo.arm(); });
    await page.waitForFunction(() => !!window.bleMock.finishWrite);
    await page.evaluate(() => {
        window.bleFixture.editor.blocks.pop().clearBlock();
        window.bleMock.mode = 'ok'; window.bleMock.finishWrite();
    });
    await page.evaluate(() => window.armTask);
    await page.waitForFunction(() => window.bleMock.writes.includes(7));
    await page.waitForFunction(() => !window.bleMock.armed.length);
    assert.equal(await page.getByRole('spinbutton', { name: 'チャンネル', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.bleFixture.connection.isServoArmed(0)), false);
    assert.equal(await page.evaluate(() => window.bleFixture.connection.state.phase), 'connected');
});

test('servo timeout, spontaneous stop, missing PCA and reconnection require explicit rearming', async context => {
    const page = await pageFor(context);
    await placeBlock(page); await clickButton(page); await waitPhase(page, 'connected');
    await placeServo(page); await page.evaluate(() => window.servo.arm());
    await page.evaluate(() => window.bleMock.emitStop());
    assert.equal(await page.evaluate(() => window.servo.moveButton.disabled), true);
    await page.evaluate(() => { window.servo.inputPort.setPortValue(105); return window.servo.valueChanged(); });
    assert.equal(await page.evaluate(() => window.bleMock.writes.includes(2)), false);
    await page.evaluate(() => { window.bleMock.mode = 'holdAck'; window.armTask = window.servo.arm(); });
    await waitPhase(page, 'error'); await page.evaluate(() => window.armTask);
    await page.evaluate(() => { window.bleMock.mode = 'missingPca'; });
    await connectFirstBlock(page);
    assert.equal(await page.evaluate(() => window.servo.armButton.disabled), true);
    await page.evaluate(() => window.bleFixture.connection.disconnect());
    await page.evaluate(() => { window.bleMock.mode = 'ok'; });
    await connectFirstBlock(page);
    const before = await page.evaluate(() => window.bleMock.writes.length);
    await page.evaluate(() => window.servo.valueChanged());
    assert.equal(await page.evaluate(() => window.bleMock.writes.length), before);
    assert.equal(await page.evaluate(() => window.servo.moveButton.disabled), true);
});

test('servo JSON and copy retain channel and duration without saving or replaying PWM state', async context => {
    const page = await pageFor(context);
    await placeBlock(page); await clickButton(page); await waitPhase(page, 'connected');
    await placeServo(page);
    await page.evaluate(() => { window.servo.loadObj({ channel: 4, duration: 1500 }); return window.servo.arm(); });
    const saved = await page.evaluate(() => {
        const count = window.bleMock.writes.filter(op => op === 1).length;
        const copy = window.servo.copy(), obj = copy.makeObj();
        const unchanged = window.bleMock.writes.filter(op => op === 1).length === count;
        copy.clearBlock();
        return { obj, unchanged };
    });
    assert.equal(saved.obj.channel, 4); assert.equal(saved.obj.duration, 1500);
    assert.equal(saved.unchanged, true); assert.equal('armed' in saved.obj, false);
    const original = await page.evaluate(() => window.bleFixture.editor.blocks.map(block => block.makeObj()));
    await page.evaluate(blocks => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([JSON.stringify(blocks)], 'servo.json', { type: 'application/json' }));
        document.getElementById('world-diagram').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer }));
    }, original);
    await waitPhase(page, 'idle');
    assert.equal(await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).input.value), '4');
    assert.equal(await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).durationInput.value), '1500');
    await connectFirstBlock(page);
    assert.equal(await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).moveButton.disabled), true);
    await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).loadObj({ channel: 2 }));
    assert.equal(await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).durationInput.value), '1000');
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    assert.equal(await page.getByRole('spinbutton', { name: '移動時間ms', exact: true }).count(), 0);
});

test('servo restored numeric input is ready before ARM and native edits still send MOVE', async context => {
    const page = await pageFor(context);
    await page.evaluate(() => {
        const blocks = [
            { idx: 0, typeName: 'BLEConnectionBlock', x: 640, y: 140, ports: [] },
            { idx: 1, typeName: 'ServoMotorBlock', x: 270, y: 200, channel: 0, duration: 1000,
                ports: [{ idx: 0, destinations: [] }] },
            { idx: 2, typeName: 'InputNumberBlock', x: 310, y: 100, text: '81', value: 81,
                ports: [{ idx: 1, destinations: [0] }] },
        ];
        const transfer = new DataTransfer();
        transfer.items.add(new File([JSON.stringify(blocks)], 'restored-servo.json', { type: 'application/json' }));
        document.getElementById('world-diagram').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer }));
    });
    await page.waitForFunction(() => window.bleFixture.editor.blocks.length === 3);
    await page.evaluate(() => {
        window.servo = window.bleFixture.editor.blocks[1];
        window.bleFixture.editor.blocks[2].input.setAttribute('aria-label', '復元した角度');
    });
    assert.equal(await page.evaluate(() => window.servo.inputPort.value), 81);
    assert.equal(await page.evaluate(() => window.bleMock.writes.some(op => op === 1 || op === 2)), false);
    await connectFirstBlock(page);
    await servoClick(page, 'armButton');
    await page.waitForFunction(() => window.bleFixture.connection.isServoArmed(0) && !window.servo.moveButton.disabled);
    await servoClick(page, 'moveButton');
    await page.waitForFunction(() => window.bleMock.controls.some(command => command.opcode === 2 && command.value === 8100 && command.duration === 1000));
    await page.getByRole('spinbutton', { name: '復元した角度', exact: true }).fill('105');
    await page.waitForFunction(() => window.bleMock.controls.some(command => command.opcode === 2 && command.value === 10500));
});

test('servo in the BLE IMU PCA9685 demo displays ACKs and follows numeric edits without Start', async context => {
    const page = await pageFor(context);
    const servoLogs = [];
    page.on('console', message => {
        if (message.text().startsWith('BLE servo ')) servoLogs.push(message.text());
    });
    await page.evaluate(async () => {
        const blocks = await (await fetch('/diagram/data/ble-imu-pca9685.json')).json();
        const transfer = new DataTransfer();
        transfer.items.add(new File([JSON.stringify(blocks)], 'ble-imu-pca9685.json', { type: 'application/json' }));
        document.getElementById('world-diagram').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer }));
    });
    await page.waitForFunction(() => window.bleFixture.editor.blocks.length === 5);
    await page.evaluate(() => {
        window.servo = window.bleFixture.editor.blocks.find(block => block.constructor.name === 'ServoMotorBlock');
        const source = window.bleFixture.editor.blocks.find(block => block.constructor.name === 'InputNumberBlock');
        source.input.setAttribute('aria-label', 'デモの角度');
    });
    assert.equal(await page.evaluate(() => window.servo.inputPort.value), 81);
    await connectFirstBlock(page);
    await page.waitForFunction(() => window.bleMock.rate === 10);
    await servoClick(page, 'armButton');
    await page.waitForFunction(() => window.servo.message.includes('90°の指令を受け付けました'));
    await servoClick(page, 'moveButton');
    await page.waitForFunction(() => window.servo.message.includes('81°の移動指令を受け付けました'));
    await page.getByRole('spinbutton', { name: 'デモの角度', exact: true }).fill('105');
    await page.waitForFunction(() => window.servo.message.includes('105°の移動指令を受け付けました'));
    assert.equal(await page.evaluate(() => window.bleMock.controls.filter(command => command.opcode === 2).length), 2);
    assert.equal(await page.evaluate(() => window.bleMock.rate), 10);
    assert.equal(servoLogs.filter(message => message.startsWith('BLE servo send')).length, 3);
    assert.equal(servoLogs.filter(message => message.startsWith('BLE servo ACK')).length, 3);
    assert.ok(servoLogs.some(message => message.includes('MOVE') && message.includes('8100')));
    await page.screenshot({ path: 'tmp/servo-restored-demo.png' });
});

async function placeIMU(page, x = 850, y = 185) {
    const origin = await toolCenter(page, 'IMUBlock');
    await page.mouse.move(origin.x, origin.y); await page.mouse.down();
    await page.mouse.move(x, y, { steps: 8 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).constructor.name), 'IMUBlock');
    assert.equal(await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).ports.length), 1);
}

test('IMU streams a converted immutable struct through one port and logs it once', async context => {
    const page = await pageFor(context);
    await placeBlock(page); await clickButton(page); await waitPhase(page, 'connected');
    assert.equal(await page.evaluate(() => window.bleMock.controls.some(command => command.opcode === 4)), false);
    await placeIMU(page);
    await page.waitForFunction(() => window.bleMock.rate === 10);
    await page.screenshot({ path: 'tmp/imu-block.png' });
    await page.evaluate(() => {
        const f = window.bleFixture, block = f.editor.blocks.at(-1);
        const receiver = new f.IMUBlock({ inToolbox: true });
        receiver.valueChanged = async () => { window.imuNotifications = (window.imuNotifications || 0) + 1; };
        window.imuInput = new f.StructPort(receiver, f.PortType.inputPort, f.imuStruct, 'a');
        block.outputPort.connect(window.imuInput);
        window.rejectScalar = !block.outputPort.fitPortType(new f.NumberPort(receiver, f.PortType.inputPort));
    });
    const logEvent = page.waitForEvent('console', { predicate: message => message.text().startsWith('IMU ') });
    await page.evaluate(() => window.bleMock.emitTelemetry());
    const log = await logEvent;
    const expected = { gyro: { x: 1, y: -2, z: 0 }, acc: { x: 9.80665, y: -4.903325, z: 0 } };
    assert.deepEqual(await log.args()[1].jsonValue(), expected);
    assert.deepEqual(await page.evaluate(() => window.imuInput.structValue()), expected);
    assert.equal(await page.evaluate(() => window.imuNotifications), 1);
    assert.equal(await page.evaluate(() => window.rejectScalar), true);
    assert.equal(await page.evaluate(() => Object.isFrozen(window.imuInput.value.acc)), true);
    assert.equal(await page.evaluate(() => window.bleMock.maximum), 1);
    await page.evaluate(() => window.bleFixture.connection.disconnect());
    assert.equal(await page.evaluate(() => window.imuInput.value === undefined), true);
});

test('multiple IMU blocks share STREAM and only the last removal stops it', async context => {
    const page = await pageFor(context);
    await placeBlock(page); await clickButton(page); await waitPhase(page, 'connected');
    await placeIMU(page); await placeIMU(page, 850, 400);
    await page.waitForFunction(() => window.bleMock.rate === 10);
    assert.equal(await page.evaluate(() => window.bleMock.controls.filter(command => command.opcode === 4 && command.value === 10).length), 1);
    await page.evaluate(() => window.bleFixture.editor.blocks.pop().clearBlock());
    assert.equal(await page.evaluate(() => window.bleMock.rate), 10);
    await page.evaluate(() => window.bleFixture.editor.blocks.pop().clearBlock());
    await page.waitForFunction(() => window.bleMock.rate === 0);
    await waitPhase(page, 'connected');
    assert.equal(await page.evaluate(() => window.bleMock.controls.filter(command => command.opcode === 4 && command.value === 0).length), 1);
});

test('IMU absence does not start STREAM and malformed telemetry clears the sample', async context => {
    const page = await pageFor(context);
    await page.evaluate(() => { window.bleMock.mode = 'missingImu'; });
    await placeBlock(page); await clickButton(page); await waitPhase(page, 'connected');
    await placeIMU(page);
    assert.equal(await page.evaluate(() => window.bleMock.controls.some(command => command.opcode === 4)), false);
    await page.evaluate(() => { window.bleMock.mode = 'ok'; window.bleFixture.connection.disconnect(); });
    // Reconnect using the BLE block, not the sensor block.
    const center = await page.evaluate(() => {
        const [x1, y1, x2, y2] = window.bleFixture.editor.blocks[0].button.marginBox();
        return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    });
    await page.mouse.click(center.x, center.y); await waitPhase(page, 'connected');
    await page.waitForFunction(() => window.bleMock.rate === 10);
    await page.evaluate(() => window.bleMock.emitTelemetry());
    assert.equal(await page.evaluate(() => !!window.bleFixture.editor.blocks.at(-1).outputPort.value), true);
    await page.evaluate(() => window.bleMock.emitTelemetry(true)); await waitPhase(page, 'error');
    assert.equal(await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).outputPort.value === undefined), true);
});

test('IMU type restores without saving or replaying measured values', async context => {
    const page = await pageFor(context);
    await placeIMU(page);
    const saved = await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).makeObj());
    assert.equal(saved.ports[0].dataType.typeName, 'IMU');
    assert.equal('value' in saved.ports[0], false);
    await page.evaluate(block => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([JSON.stringify([block])], 'imu.json', { type: 'application/json' }));
        document.getElementById('world-diagram').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer }));
    }, saved);
    await page.waitForFunction(() => window.bleFixture.editor.blocks.length === 1 && window.bleFixture.editor.blocks[0].outputPort.dataType.typeName === 'IMU');
    assert.equal(await page.evaluate(() => window.bleFixture.editor.blocks[0].outputPort.value === undefined), true);
    assert.equal(await page.evaluate(() => window.bleMock.requests), 0);
});

test('Port resolves source metadata and notifies both ends after connect/disconnect', async context => {
    const page = await pageFor(context);
    const result = await page.evaluate(() => {
        const f = window.bleFixture;
        const parent = new f.IMUBlock({ inToolbox: true });
        const source = new f.StructPort(parent, f.PortType.outputPort, f.imuStruct);
        const input = new f.Port(parent, f.PortType.inputPort);
        const changes = [];
        const release = source.subscribeConnections(event => changes.push(['source', event.connected, source.destinations.includes(input)]));
        input.subscribeConnections(event => changes.push(['input', event.connected, input.getDataType()?.typeName]));
        input.connect(source); source.connect(input);
        const schema = input.getDataType().struct;
        const fields = schema.members.map(field => [field.name, field.type.struct.members.map(child => [child.name, child.type.typeName])]);
        const notCached = input.dataType === undefined && !('dataType' in input.makeObj());
        input.disconnect(source); input.disconnect(source);
        const cleared = input.getDataType() === undefined;
        release(); source.connect(input); source.disconnectAll();
        const cycleA = new f.Port(parent, f.PortType.inputPort), cycleB = new f.Port(parent, f.PortType.outputPort);
        cycleA.sources = [cycleB]; cycleB.sources = [cycleA];
        return { fields, notCached, cleared, changes, cycle: cycleA.getDataType() === undefined };
    });
    assert.deepEqual(result.fields, [['gyro', [['x', 'number'], ['y', 'number'], ['z', 'number']]], ['acc', [['x', 'number'], ['y', 'number'], ['z', 'number']]]]);
    assert.equal(result.notCached, true); assert.equal(result.cleared, true); assert.equal(result.cycle, true);
    assert.deepEqual(result.changes, [['source', true, true], ['input', true, 'IMU'], ['source', false, false], ['input', false, undefined], ['input', true, 'IMU'], ['input', false, undefined]]);
});

async function placePlot(page) {
    const origin = await toolCenter(page, 'PlotBlock');
    await page.mouse.move(origin.x, origin.y); await page.mouse.down();
    await page.mouse.move(400, 430, { steps: 8 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).constructor.name), 'PlotBlock');
}

test('PlotBlock discovers gyro/acc before data, displays RGB telemetry and updates sigma each second', async context => {
    const page = await pageFor(context);
    await placeBlock(page); await clickButton(page); await waitPhase(page, 'connected');
    await placeIMU(page, 780, 170); await placePlot(page);
    await page.waitForFunction(() => window.bleMock.rate === 10);
    const ports = await page.evaluate(() => {
        const blocks = window.bleFixture.editor.blocks;
        return { from: { ...blocks[1].outputPort.getPosition() }, to: { ...blocks[2].inputPort.getPosition() } };
    });
    await page.mouse.move(ports.from.x, ports.from.y); await page.mouse.down();
    await page.mouse.move(ports.to.x, ports.to.y, { steps: 8 }); await page.mouse.up();
    await page.waitForFunction(() => window.bleFixture.editor.blocks.at(-1).plotElement.data?.length === 6);
    assert.deepEqual(await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).plotElement.layout.annotations.map(a => a.text)), ['gyro', 'acc']);
    assert.deepEqual(await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).plotElement.data.map(trace => trace.line.color)), ['red', 'green', 'blue', 'red', 'green', 'blue']);
    await page.evaluate(() => window.bleMock.emitTelemetry());
    await page.waitForFunction(() => window.bleFixture.editor.blocks.at(-1).plotElement.data[0].y.length === 1);
    assert.deepEqual(await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).plotElement.data.map(trace => trace.y[0])), [1, -2, 0, 9.80665, -4.903325, 0]);
    const range = await page.evaluate(() => [...window.bleFixture.editor.blocks.at(-1).plotElement.layout.yaxis.range]);
    await page.evaluate(() => window.bleFixture.editor.blocks[1].setIMU({gyro: {x: 100, y: 0, z: 0}, acc: {x: 0, y: 0, z: 10}}));
    await page.waitForFunction(() => window.bleFixture.editor.blocks.at(-1).plotElement.data[0].y.length === 2);
    assert.deepEqual(await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).plotElement.layout.yaxis.range), range);
    await page.waitForFunction(() => window.bleFixture.editor.blocks.at(-1).plotElement.layout.yaxis.range[1] >= 199);
    // Seed a full window for visual inspection after verifying the actual BLE path above.
    await page.evaluate(() => {
        const plot = window.bleFixture.editor.blocks.at(-1);
        plot.history.clear();
        for (let i = 0; i < 300; i++) plot.history.append({gyro: {x: Math.sin(i / 15) * 30, y: Math.cos(i / 20) * 20, z: Math.sin(i / 25) * 10}, acc: {x: Math.sin(i / 18), y: Math.cos(i / 22), z: 9.80665 + Math.sin(i / 30) * 0.3}}, i * 100);
    });
    await page.waitForFunction(() => window.bleFixture.editor.blocks.at(-1).plotElement.data[0].y.length === 300);
    await page.screenshot({ path: 'tmp/plot-block.png' });
    const before = await page.evaluate(() => {
        const plot = window.bleFixture.editor.blocks.at(-1);
        return { x: plot.position.x + 20, y: plot.position.y + 30, left: parseFloat(plot.plotElement.style.left) };
    });
    await page.mouse.move(before.x, before.y); await page.mouse.down();
    await page.mouse.move(before.x - 30, before.y + 20, { steps: 8 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => parseFloat(window.bleFixture.editor.blocks.at(-1).plotElement.style.left)), before.left - 30);
    await page.evaluate(() => window.bleFixture.connection.disconnect());
    await page.waitForFunction(() => window.bleFixture.editor.blocks.at(-1).plotElement.data[0].y.length === 0);
});

test('PlotBlock accepts other structs, rewires, saves/restores and releases DOM on Clear', async context => {
    const page = await pageFor(context);
    await placeIMU(page, 780, 170); await placePlot(page);
    await page.evaluate(() => {
        const f = window.bleFixture, [imu, plot] = f.editor.blocks;
        imu.outputPort.connect(plot.inputPort);
        plot.inputPort.disconnect(imu.outputPort);
        const weather = new f.Struct('browser-weather', [new f.Field('temperature', f.numberType), new f.Field('humidity', f.numberType)]);
        window.weatherSource = new f.Port(imu, f.PortType.outputPort, '', new f.DataType(weather.name));
        window.weatherSource.connect(plot.inputPort);
        window.weatherSource.setPortValue({temperature: 25, humidity: 50});
    });
    await page.waitForFunction(() => window.bleFixture.editor.blocks.at(-1).plotElement.data?.length === 2 && window.bleFixture.editor.blocks.at(-1).plotElement.data[0].y.length === 1);
    assert.deepEqual(await page.evaluate(() => window.bleFixture.editor.blocks.at(-1).plotElement.data.map(t => t.name)), ['temperature', 'humidity']);
    await page.evaluate(() => {
        const [imu, plot] = window.bleFixture.editor.blocks;
        window.weatherSource.disconnect(plot.inputPort);
        imu.outputPort.connect(plot.inputPort);
    });
    const saved = await page.evaluate(() => window.bleFixture.editor.blocks.map(block => block.makeObj()));
    assert.equal('dataType' in saved[1].ports[0], false);
    await page.evaluate(blocks => {
        const transfer = new DataTransfer(); transfer.items.add(new File([JSON.stringify(blocks)], 'plot.json', {type: 'application/json'}));
        document.getElementById('world-diagram').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer }));
    }, saved);
    await page.waitForFunction(() => window.bleFixture.editor.blocks.length === 2 && window.bleFixture.editor.blocks[1].plotElement.data?.length === 6);
    assert.equal(await page.evaluate(() => window.bleFixture.editor.blocks[1].inputPort.getDataType().typeName), 'IMU');
    assert.equal(await page.locator('.diagram-plot').count(), 1);
    await page.getByRole('button', {name: 'Clear', exact: true}).click();
    assert.equal(await page.locator('.diagram-plot').count(), 0);
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.diagram-plot').count(), 0);
});

test('Clear during lazy Plotly loading and application disposal do not recreate plots', async context => {
    const page = await pageFor(context);
    await page.evaluate(() => {
        const f = window.bleFixture;
        f.editor.addBlock(new f.PlotBlock({}));
        f.editor.clearBlock();
    });
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('.diagram-plot').count(), 0);
    await placePlot(page);
    await page.waitForFunction(() => !!window.bleFixture.editor.blocks.at(-1).plotElement.layout);
    await page.evaluate(() => window.uroaApp.dispose());
    assert.equal(await page.locator('.diagram-plot').count(), 0);
});
