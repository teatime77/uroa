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
        const mock = window.bleMock = { mode: 'ok', requests: 0, writes: [], active: 0, maximum: 0 };
        class Characteristic extends EventTarget {
            constructor() { super(); this.value = new DataView(new ArrayBuffer(12)); this.value.setUint8(0, 1); }
            async startNotifications() { return this; }
            async readValue() { return this.value; }
            async writeValueWithResponse(bytes) {
                mock.active++; mock.maximum = Math.max(mock.maximum, mock.active); mock.writes.push(bytes[1]);
                await new Promise(resolve => setTimeout(resolve, 2));
                mock.active--;
                if (mock.mode !== 'holdAck') {
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
                this.connected = true; return this;
            },
            disconnect() {
                const connected = this.connected; this.connected = false;
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
    await page.waitForFunction(() => ['ready', 'failed'].includes(window.uroaApp?.state), { timeout: 120_000 });
    assert.equal(await page.evaluate(() => window.uroaApp.state), 'ready',
        await page.evaluate(() => String(window.uroaApp.error?.stack || window.uroaApp.error || '')) + errors.join('\n'));
    await page.evaluate(async () => {
        const { theEditor } = await import('/diagram/ts/json-util.ts');
        const { diagramBLE, BLEConnectionBlock } = await import('/diagram/ts/ble.ts');
        const { theCanvas } = await import('/diagram/ts/diagram_util.ts');
        window.bleFixture = { editor: theEditor, connection: diagramBLE, Block: BLEConnectionBlock, canvas: theCanvas };
    });
    context.after(() => assert.deepEqual(errors, []));
    return page;
}

async function placeBlock(page) {
    const before = await page.evaluate(() => window.bleFixture.editor.blocks.length);
    await page.mouse.move(45, 85);
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
    await page.waitForFunction(phase => window.bleFixture.connection.state.phase === phase, phase);
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
        const origin = await page.evaluate(() => {
            const tool = window.bleFixture.editor.tools.find(block => block.constructor.name === 'SleepBlock');
            return { x: tool.position.x + 20, y: tool.position.y + 20 };
        });
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
