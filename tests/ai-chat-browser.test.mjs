import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.UROA_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set UROA_PLAYWRIGHT_MODULE to playwright-core/index.mjs.');
const { chromium } = await import(pathToFileURL(resolve(modulePath)).href);
const baseURL = (process.env.UROA_TEST_BASE_URL || 'http://127.0.0.1:5187').replace(/\/$/, '');
let browser;
before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.UROA_BROWSER_EXECUTABLE }); });
after(async () => { await browser?.close(); });

async function fixture(context) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    context.after(() => page.close());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        window.aiMock = { mode: 'ok', connectionMode: 'ok', connections: [], requests: [], signals: [], spoken: [], held: [],
            credentialMode: 'ok', credentialStores: [], answer: '東京です。\n<img src=x onerror=alert(1)>' };
        // Use Chrome's real PasswordCredential constructor, but never persist test keys.
        Object.defineProperty(navigator.credentials, 'store', { configurable: true, value: credential => {
            const m = window.aiMock;
            m.credentialStores.push({ id: credential.id, password: credential.password, type: credential.type });
            if (m.credentialMode === 'throw') throw new Error('test-api-key');
            return m.credentialMode === 'reject' ? Promise.reject(new Error('test-api-key')) : Promise.resolve(credential);
        } });
        const nativeFetch = window.fetch.bind(window);
        window.fetch = async (url, options) => {
            if (!String(url).startsWith('https://generativelanguage.googleapis.com/v1beta/')) return nativeFetch(url, options);
            const m = window.aiMock;
            if (String(url).includes('/models/')) {
                m.connections.push({ key: options.headers['x-goog-api-key'], signal: options.signal });
                const result = () => new Response(JSON.stringify({ name: 'models/' + decodeURIComponent(String(url).split('/models/')[1]) }));
                if (m.connectionMode === 'hold') return new Promise(resolve => m.held.push(() => resolve(result())));
                if (m.connectionMode === 'fail') return new Response(JSON.stringify({ error: 'test-api-key' }), { status: 403 });
                return result();
            }
            const body = JSON.parse(options.body);
            m.requests.push({ question: body.input, model: body.model, store: body.store, method: options.method, headers: options.headers,
                credentials: options.credentials, redirect: options.redirect });
            m.signals.push(options.signal);
            const result = answer => ({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: answer }] }] });
            if (m.mode === 'network') throw new TypeError('simulated transport failure');
            if (m.mode === 'hold') return new Promise(resolve => m.held.push(() => resolve(new Response(JSON.stringify(result('遅い古い回答'))))));
            if (m.mode === 'holdBody') return { ok: true, json: () => new Promise(resolve => m.held.push(() => resolve(result('遅い本文')))) };
            if (m.mode === 'http') return new Response(JSON.stringify({ error: 'DO_NOT_DISPLAY_SERVER_DETAIL' }), { status: 502 });
            if (m.mode === 'malformed') return new Response('<html>not JSON</html>');
            return new Response(JSON.stringify(m.mode === 'empty' ? result(' \n') : m.mode === 'wrong' ? result(42) : result(m.answer)));
        };
    });
    await page.goto(`${baseURL}/diagram/index.html`);
    await page.waitForFunction(() => ['ready', 'failed'].includes(window.uroaApp?.state), undefined, { timeout: 60_000 });
    assert.equal(await page.evaluate(() => window.uroaApp.state), 'ready', errors.join('\n'));
    await page.evaluate(async () => {
        const { AIChatBlock } = await import('/diagram/ts/ai-chat.ts');
        const { InputTextBlock, FunctionBlock } = await import('/diagram/ts/block.ts');
        const { TTSBlock, makeBlockByTypeName } = await import('/diagram/ts/procedure.ts');
        const { theEditor } = await import('/diagram/ts/json-util.ts');
        const { theCanvas } = await import('/diagram/ts/diagram_util.ts');
        const { Vec2 } = await import('/i18n/ts/index.ts');
        const { geBlockName } = await import('/diagram/ts/index.ts');
        const { getProcedureSignal } = await import('/diagram/ts/runtime.ts');
        const input = new InputTextBlock({}), ai = new AIChatBlock({}), tts = new TTSBlock({});
        for (const [block, x, y] of [[input, 300, 100], [ai, 300, 220], [tts, 350, 540]]) {
            block.setBoxSize(); block.setBlockPortPosition(new Vec2(x, y)); theEditor.addBlock(block);
        }
        input.textPort.connect(ai.inputPort); ai.outputPort.connect(tts.inputPort);
        input.input.value = '  日本の首都は？  '; input.updatePort();
        tts.speech.speak_waitEnd = async text => { window.aiMock.spoken.push(text); };
        window.aiFixture = { input, ai, tts, editor: theEditor, canvas: theCanvas, AIChatBlock, FunctionBlock, makeBlockByTypeName, geBlockName, Vec2, getProcedureSignal };
        await ai.connect('test-api-key');
        theCanvas.requestUpdateCanvas();
    });
    context.after(() => assert.deepEqual(errors, []));
    return page;
}

async function start(page) {
    await page.locator('#start-btn').click();
    await page.waitForFunction(() => document.getElementById('start-btn').textContent === 'Start');
}
async function pending(page, mode = 'hold') {
    await page.evaluate(mode => { window.aiMock.mode = mode; }, mode);
    await page.locator('#start-btn').click();
    await page.waitForFunction(() => window.aiFixture.ai.message === '送信中…' && window.aiMock.held.length > 0);
    assert.equal(await page.evaluate(() => window.aiFixture.ai.outputPort.value), undefined);
}
async function release(page) {
    await page.evaluate(() => window.aiMock.held.splice(0).forEach(finish => finish()));
    // Give both the fetch and JSON continuations an opportunity to settle.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
}
async function drop(page, data) {
    await page.evaluate(data => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([JSON.stringify(data)], 'ai-chat.json', { type: 'application/json' }));
        document.getElementById('world-diagram').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    }, data);
}

test('Start sends one independent question, waits for full answer, then TTS; editing is passive', async context => {
    const page = await fixture(context);
    assert.deepEqual(await page.evaluate(() => window.aiMock.requests), []);
    assert.equal(await page.evaluate(() => window.aiFixture.ai instanceof window.aiFixture.FunctionBlock), true);
    await start(page);
    assert.deepEqual(await page.evaluate(() => window.aiMock.requests), [{ question: '日本の首都は？', model: 'gemini-3.5-flash-lite', store: false,
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': 'test-api-key' }, credentials: 'omit', redirect: 'error' }]);
    assert.deepEqual(await page.evaluate(() => window.aiMock.spoken), [await page.evaluate(() => window.aiMock.answer)]);
    assert.equal(await page.locator('textarea[aria-label="AI回答・エラー"]').inputValue(), await page.evaluate(() => window.aiMock.answer));
    assert.equal(await page.locator('textarea img').count(), 0);
    await page.screenshot({ path: 'tmp/ai-chat-answer.png' });
    await page.locator('#layer-diagram input[type=text]').fill('次の質問');
    assert.equal(await page.evaluate(() => window.aiMock.requests.length), 1);
    await start(page);
    assert.equal(await page.evaluate(() => window.aiMock.requests[1].question), '次の質問');
    assert.equal(await page.evaluate(() => window.aiMock.spoken.length), 2);
});

for (const mode of ['blank', 'missing', 'tooLong', 'network', 'http', 'empty', 'wrong', 'malformed']) {
    test(`${mode} clears the old answer and prevents subsequent TTS, then allows retry`, async context => {
        const page = await fixture(context);
        await start(page);
        await page.evaluate(mode => {
            const { ai, input } = window.aiFixture;
            window.aiMock.mode = mode;
            if (mode === 'blank') input.input.value = '  \n';
            if (mode === 'tooLong') input.input.value = 'a'.repeat(2001);
            if (mode === 'missing') input.textPort.disconnect(ai.inputPort);
        }, mode);
        await start(page);
        assert.equal(await page.evaluate(() => window.aiFixture.ai.message), 'エラー');
        assert.equal(await page.evaluate(() => window.aiFixture.ai.outputPort.value), undefined);
        assert.equal(await page.evaluate(() => window.aiFixture.tts.inputPort.value), undefined);
        assert.equal(await page.evaluate(() => window.aiMock.spoken.length), 1);
        assert.ok((await page.locator('#layer-diagram textarea').inputValue()).length > 0);
        assert.ok(!(await page.locator('#layer-diagram textarea').inputValue()).includes('DO_NOT_DISPLAY_SERVER_DETAIL'));
        assert.equal(await page.evaluate(() => window.aiMock.requests.length), ['blank', 'missing', 'tooLong'].includes(mode) ? 1 : 2);
        await page.evaluate(() => {
            window.aiMock.mode = 'ok'; window.aiFixture.input.input.value = '再質問';
            window.aiFixture.input.textPort.connect(window.aiFixture.ai.inputPort);
        });
        await start(page);
        assert.equal(await page.evaluate(() => window.aiMock.spoken.length), 2);
    });
}

for (const operation of ['stop', 'clear', 'load', 'deleteAI', 'deleteInput', 'deleteTTS', 'dispose', 'pagehide', 'stopBody']) {
    test(`${operation} cancels waiting immediately and ignores a transport that returns late`, async context => {
        const page = await fixture(context);
        await pending(page, operation === 'stopBody' ? 'holdBody' : 'hold');
        if (operation === 'stop' || operation === 'stopBody') await page.locator('#start-btn').click();
        if (operation === 'clear') await page.locator('#clear-btn').click();
        if (operation === 'load') await drop(page, []);
        if (operation.startsWith('delete')) await page.evaluate(operation => {
            const f = window.aiFixture;
            const block = operation === 'deleteAI' ? f.ai : operation === 'deleteInput' ? f.input : f.tts;
            f.editor.blocks.splice(f.editor.blocks.indexOf(block), 1); block.clearBlock();
        }, operation);
        if (operation === 'dispose') await page.evaluate(() => window.uroaApp.dispose());
        if (operation === 'pagehide') await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
        await page.waitForFunction(() => document.getElementById('start-btn').textContent === 'Start');
        assert.equal(await page.evaluate(() => window.aiMock.signals[0].aborted), true);
        await release(page);
        assert.equal(await page.evaluate(() => window.aiFixture.ai.outputPort.value), undefined);
        assert.deepEqual(await page.evaluate(() => window.aiMock.spoken), []);
        if (['clear', 'load', 'deleteAI', 'dispose', 'pagehide'].includes(operation)) {
            assert.equal(await page.evaluate(() => window.aiFixture.ai.connected), false);
        }
        if (operation === 'stop' || operation === 'stopBody') {
            await page.evaluate(async () => { window.aiMock.mode = 'ok'; await window.aiFixture.ai.connect('test-api-key'); });
            await start(page);
            assert.equal(await page.evaluate(() => window.aiMock.spoken.length), 1);
        }
    });
}

test('late answer from a stopped run cannot replace the next run', async context => {
    const page = await fixture(context);
    await pending(page);
    await page.locator('#start-btn').click();
    await page.waitForFunction(() => document.getElementById('start-btn').textContent === 'Start');
    await page.evaluate(() => { window.aiMock.mode = 'ok'; window.aiMock.answer = '新しい回答'; });
    await start(page);
    await release(page);
    assert.equal(await page.locator('#layer-diagram textarea').inputValue(), '新しい回答');
    assert.deepEqual(await page.evaluate(() => window.aiMock.spoken), ['新しい回答']);
});

test('canvas connection dialog checks Google immediately, keeps credentials private, and reuses them', async context => {
    const page = await fixture(context);
    await page.evaluate(() => window.aiFixture.ai.disconnect());
    const center = await page.evaluate(() => {
        const [x1, y1, x2, y2] = window.aiFixture.ai.connectButton.marginBox();
        return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    });
    await page.mouse.click(center.x, center.y);
    const dialog = page.getByRole('dialog', { name: 'Googleに接続' });
    await dialog.getByRole('textbox', { name: 'ユーザー名' }).fill('gemini-learner');
    await dialog.getByRole('textbox', { name: 'モデル名' }).fill('gemini-test-model');
    await dialog.locator('input[type=password]').fill('learner-private-key');
    await dialog.getByRole('button', { name: '接続', exact: true }).click();
    await page.waitForFunction(() => window.aiFixture.ai.connected);
    assert.deepEqual(await page.evaluate(() => window.aiMock.credentialStores),
        [{ id: 'gemini-learner', password: 'learner-private-key', type: 'password' }]);
    assert.equal(await page.getByRole('dialog', { name: 'Googleに接続' }).count(), 0);
    assert.equal(await page.locator('#layer-diagram input[type=password]').count(), 0);
    assert.equal(await page.evaluate(() => window.aiMock.requests.length), 0);
    assert.equal(await page.evaluate(() => JSON.stringify(window.aiFixture.ai.makeObj()).includes('learner-private-key')), false);
    assert.equal(await page.evaluate(() => JSON.stringify(window.aiFixture.ai.makeObj()).includes('gemini-learner')), false);
    assert.equal(await page.evaluate(() => Object.values(window.aiFixture.ai).includes('gemini-learner')), false);
    assert.equal(await page.evaluate(() => Object.values(window.aiFixture.ai).includes('learner-private-key')), false);
    await start(page); await start(page);
    assert.equal(await page.evaluate(() => window.aiMock.connections.length), 2);
    assert.equal(await page.evaluate(() => window.aiMock.requests.length), 2);
    assert.equal(await page.evaluate(() => window.aiMock.requests.every(req => req.model === 'gemini-test-model' && req.headers['x-goog-api-key'] === 'learner-private-key')), true);
    assert.equal(await page.evaluate(() => JSON.stringify(window.aiMock.requests).includes('gemini-learner')), false);
    const disconnected = await page.evaluate(() => { window.aiFixture.ai.disconnect(); return window.aiFixture.ai.connected; });
    assert.equal(disconnected, false);
    await start(page);
    assert.match(await page.locator('#layer-diagram textarea').inputValue(), /接続ボタン/);
    assert.equal(await page.evaluate(() => window.aiMock.spoken.length), 2);
});

for (const operation of ['disconnect', 'clear', 'stop', 'pagehide']) {
    test(`pending connection is cancelled by ${operation} and a late check never retains a key`, async context => {
        const page = await fixture(context);
        await page.evaluate(() => {
            window.aiFixture.ai.disconnect(); window.aiMock.connectionMode = 'hold';
            window.pendingConnection = window.aiFixture.ai.connect('late-key', window.aiFixture.ai.model, 'gemini-late');
        });
        await page.waitForFunction(() => window.aiMock.held.length > 0);
        await page.evaluate(async operation => {
            if (operation === 'disconnect') window.aiFixture.ai.disconnect();
            if (operation === 'clear') window.aiFixture.editor.clearBlock();
            if (operation === 'stop') (await import('/diagram/ts/index.ts')).stopDiagram();
            if (operation === 'pagehide') window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
            await window.pendingConnection;
        }, operation);
        assert.equal(await page.evaluate(() => window.aiMock.connections.at(-1).signal.aborted), true);
        await release(page);
        assert.equal(await page.evaluate(() => window.aiFixture.ai.connected), false);
        assert.deepEqual(await page.evaluate(() => window.aiMock.credentialStores), []);
    });
}

test('connection failure never retains or displays credentials or raw Google errors', async context => {
    const page = await fixture(context);
    const logs = [];
    page.on('console', message => logs.push(message.text()));
    await page.evaluate(async () => { window.aiMock.connectionMode = 'fail'; await window.aiFixture.ai.connect('test-api-key', window.aiFixture.ai.model, 'gemini-fail'); });
    assert.equal(await page.evaluate(() => window.aiFixture.ai.connected), false);
    assert.match(await page.locator('#layer-diagram textarea').inputValue(), /APIキーまたは利用権限/);
    assert.ok(!(await page.locator('#layer-diagram textarea').inputValue()).includes('test-api-key'));
    assert.ok(logs.every(message => !message.includes('test-api-key')));
    assert.deepEqual(await page.evaluate(() => window.aiMock.credentialStores), []);
});

test('credential form supports autofill, validates required fields, and erases cancelled input', async context => {
    const page = await fixture(context);
    await page.evaluate(() => { window.aiFixture.ai.disconnect(); window.aiFixture.ai.openConnectionDialog(); });
    const dialog = page.getByRole('dialog', { name: 'Googleに接続' });
    assert.equal(await dialog.locator('form').getAttribute('method'), 'post');
    assert.equal(await dialog.locator('input[name=username]').getAttribute('autocomplete'), 'username');
    assert.equal(await dialog.locator('input[name=api-key]').getAttribute('autocomplete'), 'current-password');
    assert.equal(await dialog.locator('input[name=api-key]').getAttribute('type'), 'password');
    await page.screenshot({ path: 'tmp/ai-credentials-dialog.png' });
    // Keep references to detached controls so cleanup can be asserted after Escape.
    await page.evaluate(() => { window.credentialInputs = [...document.querySelector('dialog').querySelectorAll('input')]; });
    await dialog.locator('input[name=api-key]').fill('cancelled-key');
    await dialog.getByRole('button', { name: '接続', exact: true }).click();
    assert.equal(await dialog.count(), 1);
    await dialog.locator('input[name=username]').fill('   ');
    await dialog.getByRole('button', { name: '接続', exact: true }).click();
    assert.equal(await dialog.count(), 1);
    assert.equal(await page.evaluate(() => window.aiMock.connections.length), 1);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0);
    assert.deepEqual(await page.evaluate(() => window.credentialInputs.map(input => input.value)), ['', '', '']);
    assert.deepEqual(await page.evaluate(() => window.aiMock.credentialStores), []);
    await page.evaluate(() => window.aiFixture.ai.openConnectionDialog());
    await dialog.locator('input[name=username]').fill('   ');
    await dialog.locator('input[name=api-key]').fill('autofilled-key');
    await dialog.getByRole('button', { name: '接続', exact: true }).click();
    assert.equal(await dialog.count(), 1);
    // Autofill can set DOM values without producing an input event.
    await page.evaluate(() => {
        const form = document.querySelector('dialog form');
        form.elements.namedItem('username').value = 'gemini-autofill';
        form.elements.namedItem('api-key').value = 'autofilled-key';
        form.requestSubmit();
    });
    await page.waitForFunction(() => window.aiFixture.ai.connected);
    await start(page);
    assert.equal(await page.evaluate(() => window.aiMock.requests[0].headers['x-goog-api-key']), 'autofilled-key');
});

for (const mode of ['reject', 'throw', 'unsupported']) {
    test(`password manager ${mode} preserves a usable connection without exposing errors`, async context => {
        const page = await fixture(context);
        const logs = [];
        page.on('console', message => logs.push(message.text()));
        await page.evaluate(mode => {
            window.aiFixture.ai.disconnect(); window.aiMock.credentialMode = mode;
            if (mode === 'unsupported') Object.defineProperty(window, 'PasswordCredential', { configurable: true, value: undefined });
            window.aiFixture.ai.openConnectionDialog();
        }, mode);
        const dialog = page.getByRole('dialog', { name: 'Googleに接続' });
        await dialog.getByRole('textbox', { name: 'ユーザー名' }).fill('gemini');
        await dialog.locator('input[type=password]').fill('test-api-key');
        await dialog.getByRole('button', { name: '接続', exact: true }).click();
        await page.waitForFunction(() => window.aiFixture.ai.connected);
        await start(page);
        assert.equal(await page.evaluate(() => window.aiMock.spoken.length), 1);
        assert.equal(await page.evaluate(() => window.aiMock.credentialStores.length), mode === 'unsupported' ? 0 : 1);
        assert.ok(logs.every(message => !message.includes('test-api-key')));
    });
}

test('Start awaits AI data dependencies once even when editor order is reversed', async context => {
    const page = await fixture(context);
    await page.evaluate(async () => {
        const f = window.aiFixture;
        const second = f.makeBlockByTypeName('AIChatBlock');
        second.setBoxSize(); second.setBlockPortPosition(new f.Vec2(650, 220)); f.editor.addBlock(second);
        f.ai.outputPort.disconnect(f.tts.inputPort);
        f.ai.outputPort.connect(second.inputPort); second.outputPort.connect(f.tts.inputPort);
        f.editor.blocks.splice(f.editor.blocks.indexOf(second), 1); f.editor.blocks.unshift(second);
        await second.connect('second-api-key');
    });
    await start(page);
    assert.equal(await page.evaluate(() => window.aiMock.requests.length), 2);
    assert.equal(await page.evaluate(() => window.aiMock.requests[1].question), await page.evaluate(() => window.aiMock.answer));
    assert.deepEqual(await page.evaluate(() => window.aiMock.spoken), [await page.evaluate(() => window.aiMock.answer)]);
});

test('timeout stops the chain even when transport ignores abort', async context => {
    const page = await fixture(context);
    await page.evaluate(() => {
        const nativeTimer = window.setTimeout;
        window.setTimeout = (fn, ms, ...args) => nativeTimer(fn, ms === 35_000 ? 20 : ms, ...args);
        window.aiMock.mode = 'hold';
    });
    await start(page);
    assert.match(await page.locator('#layer-diagram textarea').inputValue(), /時間切れ/);
    await release(page);
    assert.deepEqual(await page.evaluate(() => window.aiMock.spoken), []);
});

test('copy, download and JSON drop preserve wiring without live state or implicit requests', async context => {
    const page = await fixture(context);
    await start(page);
    const copy = await page.evaluate(() => {
        const copy = window.aiFixture.ai.copy();
        const result = { type: copy.constructor.name, answer: copy.answerView.value, value: copy.outputPort.value, message: copy.message, connected: copy.connected };
        copy.clearBlock(); return result;
    });
    assert.deepEqual(copy, { type: 'AIChatBlock', answer: '', value: undefined, message: '待機中', connected: false });
    const downloaded = page.waitForEvent('download');
    await page.locator('#download-btn').click();
    const download = await downloaded;
    const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
    const ai = saved.find(block => block.typeName === 'AIChatBlock');
    assert.deepEqual(Object.keys(ai).sort(), ['idx', 'model', 'ports', 'typeName', 'x', 'y']);
    assert.equal(ai.ports.length, 2);
    assert.ok(!JSON.stringify(saved).includes('東京です'));
    assert.ok(!JSON.stringify(saved).includes('test-api-key'));
    await drop(page, saved);
    await page.waitForFunction(() => window.aiFixture.editor.blocks.length === 3 && !window.aiFixture.editor.blocks.includes(window.aiFixture.ai));
    assert.equal(await page.locator('#layer-diagram textarea').inputValue(), '');
    assert.equal(await page.evaluate(() => window.aiMock.requests.length), 1);
    await page.evaluate(async () => {
        const f = window.aiFixture;
        f.tts = f.editor.blocks.find(block => block.constructor.name === 'TTSBlock');
        f.tts.speech.speak_waitEnd = async text => window.aiMock.spoken.push(text);
        await f.editor.blocks.find(block => block.constructor.name === 'AIChatBlock').connect('restored-key');
    });
    await start(page);
    assert.equal(await page.evaluate(() => window.aiMock.requests.length), 2);
    assert.equal(await page.evaluate(() => window.aiMock.spoken.length), 2);
});

test('toolbox AI placement and answer field fit a 720px viewport and follow movement', async context => {
    const page = await fixture(context);
    await page.setViewportSize({ width: 720, height: 720 });
    await page.locator('#clear-btn').click();
    const origin = await page.evaluate(() => {
        const f = window.aiFixture, tool = f.editor.tools.find(tool => f.geBlockName(tool.toolIdx) === 'AIChatBlock');
        const [x1, y1, x2, y2] = tool.marginBox();
        return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    });
    assert.ok(origin.y < 720);
    await page.mouse.move(origin.x, origin.y); await page.mouse.down();
    await page.mouse.move(330, 185, { steps: 8 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.aiFixture.editor.blocks[0].constructor.name), 'AIChatBlock');
    const view = await page.locator('#layer-diagram textarea').boundingBox();
    assert.ok(view.x >= 0 && view.x + view.width <= 720 && view.y + view.height <= 720);
    await page.mouse.move(400, 212); await page.mouse.down();
    await page.mouse.move(420, 232, { steps: 5 }); await page.mouse.up();
    const moved = await page.locator('#layer-diagram textarea').boundingBox();
    assert.equal(moved.x - view.x, 20); assert.equal(moved.y - view.y, 20);
});
