import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(resolve(process.env.UROA_PLAYWRIGHT_MODULE)).href);
const baseURL = (process.env.UROA_TEST_BASE_URL || 'http://127.0.0.1:5188').replace(/\/$/, '');
let browser;
before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.UROA_BROWSER_EXECUTABLE }); });
after(async () => { await browser?.close(); });

async function fixture(context) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    context.after(() => page.close());
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    context.after(() => assert.deepEqual(errors, []));
    await page.addInitScript(() => {
        window.speechMock = { instances: [], requests: [], spoken: [] };
        window.SpeechRecognition = undefined;
        window.webkitSpeechRecognition = class {
            constructor() { window.speechMock.instances.push(this); }
            start() { this.onstart?.(); }
            stop() { this.stopped = true; }
            abort() { this.aborted = true; /* Deliberately never sends end. */ }
            result(text, isFinal = true) { this.onresult?.({ results: [{ isFinal, 0: { transcript: text } }] }); }
        };
        const nativeFetch = window.fetch.bind(window);
        window.fetch = async (url, options) => {
            if (!String(url).startsWith('https://generativelanguage.googleapis.com/v1beta/')) return nativeFetch(url, options);
            if (String(url).includes('/models/')) return new Response(JSON.stringify({ name: 'models/' + decodeURIComponent(String(url).split('/models/')[1]) }));
            window.speechMock.requests.push(JSON.parse(options.body).input);
            return new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '模擬回答です' }] }] }));
        };
    });
    await page.goto(`${baseURL}/diagram/index.html`);
    await page.waitForFunction(() => ['ready', 'failed'].includes(window.uroaApp?.state), undefined, { timeout: 60_000 });
    assert.equal(await page.evaluate(() => window.uroaApp.state), 'ready', errors.join('\n'));
    await page.evaluate(async () => {
        const { SpeechRecognitionBlock } = await import('/diagram/ts/ai/speech-recognition.ts');
        const { AIChatBlock } = await import('/diagram/ts/ai/ai-chat.ts');
        const { TTSBlock, makeBlockByTypeName } = await import('/diagram/ts/procedure.ts');
        const { theEditor } = await import('/diagram/ts/json-util.ts');
        const { theCanvas } = await import('/diagram/ts/diagram_util.ts');
        const { Vec2 } = await import('/i18n/ts/index.ts');
        const { geBlockName, makeBlock } = await import('/diagram/ts/index.ts');
        const speech = new SpeechRecognitionBlock({}), ai = new AIChatBlock({}), tts = new TTSBlock({});
        // Deliberately insert AI before its speech dependency.
        for (const [block, x, y] of [[ai, 640, 80], [speech, 280, 80], [tts, 680, 440]]) {
            block.setBlockPortPosition(new Vec2(x, y)); theEditor.addBlock(block);
        }
        speech.outputPort.connect(ai.inputPort); ai.outputPort.connect(tts.inputPort);
        tts.speech.speak_waitEnd = async text => window.speechMock.spoken.push(text);
        await ai.connect('mock-key');
        if (!ai.connected) throw new Error('Mock AI connection failed');
        window.speechFixture = { speech, ai, tts, editor: theEditor, canvas: theCanvas, Vec2, makeBlockByTypeName, geBlockName, makeBlock };
    });
    return page;
}
async function pending(page) {
    await page.locator('#start-btn').click();
    await page.waitForFunction(() => window.speechFixture.speech.message.startsWith('聞き取り中'));
}
async function idle(page) {
    await page.waitForFunction(() => document.getElementById('start-btn').textContent === 'Start');
}

test('toolbox drag and demo JSON create passive recognition blocks', async context => {
    const page = await fixture(context);
    const origin = await page.evaluate(() => {
        const f = window.speechFixture;
        const tool = f.editor.tools.find(tool => f.geBlockName(tool.toolIdx) === 'SpeechRecognitionBlock');
        const [x1, y1, x2, y2] = tool.marginBox();
        return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    });
    await page.mouse.move(origin.x, origin.y); await page.mouse.down();
    await page.mouse.move(300, 500, { steps: 8 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.speechFixture.editor.blocks.at(-1).constructor.name), 'SpeechRecognitionBlock');
    assert.equal(await page.evaluate(() => window.speechMock.instances.length), 0);
    const demo = JSON.parse(await readFile(new URL('../public/diagram/data/speech-ai-chat.json', import.meta.url), 'utf8'));
    await page.evaluate(demo => {
        const transfer = new DataTransfer(); transfer.items.add(new File([JSON.stringify(demo)], 'speech-ai-chat.json', { type: 'application/json' }));
        document.getElementById('world-diagram').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    }, demo);
    await page.waitForFunction(() => window.speechFixture.editor.blocks.length === 3);
    assert.deepEqual(await page.evaluate(() => {
        const blocks = window.speechFixture.editor.blocks;
        return { types: blocks.map(b => b.constructor.name),
            targets: [blocks[0].outputPort.destinations[0].parent.constructor.name, blocks[1].outputPort.destinations[0].parent.constructor.name],
            instances: window.speechMock.instances.length };
    }), { types: ['SpeechRecognitionBlock', 'AIChatBlock', 'TTSBlock'], targets: ['AIChatBlock', 'TTSBlock'], instances: 0 });
});

test('Start waits for microphone end before AI and TTS, then recognizes a fresh question', async context => {
    const page = await fixture(context);
    assert.equal(await page.evaluate(() => window.speechMock.instances.length), 0);
    await pending(page);
    await page.evaluate(() => window.speechMock.instances.at(-1).result('日本の首都は？'));
    assert.deepEqual(await page.evaluate(() => window.speechMock.requests), []);
    assert.equal(await page.evaluate(() => window.speechFixture.speech.outputPort.value), undefined);
    await page.evaluate(() => window.speechMock.instances.at(-1).onend());
    await idle(page);
    assert.deepEqual(await page.evaluate(() => window.speechMock.requests), ['日本の首都は？']);
    assert.deepEqual(await page.evaluate(() => window.speechMock.spoken), ['模擬回答です']);
    await pending(page);
    assert.equal(await page.evaluate(() => window.speechFixture.speech.outputPort.value), undefined);
    await page.evaluate(() => { const r = window.speechMock.instances.at(-1); r.result('次の質問'); r.onend(); });
    await idle(page);
    assert.deepEqual(await page.evaluate(() => window.speechMock.requests), ['日本の首都は？', '次の質問']);
    await page.screenshot({ path: 'tmp/speech-recognition.png' });
});

test('canvas finish button stops capture and still waits for a final result', async context => {
    const page = await fixture(context);
    await pending(page);
    const center = await page.evaluate(() => {
        const [x1, y1, x2, y2] = window.speechFixture.speech.finishButton.marginBox();
        return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    });
    await page.mouse.click(center.x, center.y);
    assert.equal(await page.evaluate(() => window.speechMock.instances.at(-1).stopped), true);
    assert.deepEqual(await page.evaluate(() => window.speechMock.requests), []);
    await page.evaluate(() => { const r = window.speechMock.instances.at(-1); r.result('終了ボタン'); r.onend(); });
    await idle(page);
    assert.deepEqual(await page.evaluate(() => window.speechMock.requests), ['終了ボタン']);
});

test('permission refusal, empty result, unsupported API and timeout prevent AI/TTS and permit retry', async context => {
    const page = await fixture(context);
    for (const mode of ['permission', 'empty', 'unsupported', 'timeout']) {
        if (mode === 'unsupported') await page.evaluate(() => { window.savedRecognition = window.webkitSpeechRecognition; window.webkitSpeechRecognition = undefined; });
        if (mode === 'timeout') await page.evaluate(() => {
            window.savedSetTimeout = window.setTimeout;
            window.setTimeout = (fn, ms, ...args) => window.savedSetTimeout(fn, ms === 30_000 ? 10 : ms, ...args);
        });
        await page.locator('#start-btn').click();
        if (mode === 'permission' || mode === 'empty') {
            await page.waitForFunction(() => window.speechFixture.speech.message.startsWith('聞き取り中'));
            await page.evaluate(mode => { const r = window.speechMock.instances.at(-1); mode === 'empty' ? r.onend() : r.onerror({ error: 'not-allowed' }); }, mode);
        }
        await idle(page);
        assert.equal(await page.evaluate(() => window.speechFixture.speech.message), 'エラー');
        assert.equal(await page.evaluate(() => window.speechFixture.speech.outputPort.value), undefined);
        assert.deepEqual(await page.evaluate(() => window.speechMock.requests), []);
        assert.deepEqual(await page.evaluate(() => window.speechMock.spoken), []);
        await page.evaluate(() => {
            if (window.savedRecognition) window.webkitSpeechRecognition = window.savedRecognition;
            if (window.savedSetTimeout) window.setTimeout = window.savedSetTimeout;
        });
    }
    await pending(page);
    await page.evaluate(() => { const r = window.speechMock.instances.at(-1); r.result('再試行'); r.onend(); });
    await idle(page);
    assert.equal(await page.evaluate(() => window.speechMock.spoken.length), 1);
});

for (const operation of ['stop', 'clear', 'load', 'delete', 'pagehide', 'dispose']) {
    test(`${operation} settles without end and discards delayed recognition`, async context => {
        const page = await fixture(context);
        await pending(page);
        await page.evaluate(() => {
            const r = window.speechMock.instances.at(-1);
            window.lateSpeech = { result: r.onresult, end: r.onend };
        });
        if (operation === 'stop') await page.locator('#start-btn').click();
        if (operation === 'clear') await page.locator('#clear-btn').click();
        if (operation === 'delete') await page.evaluate(() => {
            const f = window.speechFixture; f.editor.blocks.splice(f.editor.blocks.indexOf(f.speech), 1); f.speech.clearBlock();
        });
        if (operation === 'load') await page.evaluate(() => {
            const transfer = new DataTransfer(); transfer.items.add(new File(['[]'], 'empty.json', { type: 'application/json' }));
            document.getElementById('world-diagram').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
        });
        if (operation === 'pagehide') await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
        if (operation === 'dispose') await page.evaluate(() => window.uroaApp.dispose());
        await idle(page);
        assert.equal(await page.evaluate(() => window.speechMock.instances.at(-1).aborted), true);
        await page.evaluate(() => { window.lateSpeech.result({ results: [{ isFinal: true, 0: { transcript: '古い質問' } }] }); window.lateSpeech.end(); });
        assert.deepEqual(await page.evaluate(() => window.speechMock.requests), []);
        assert.deepEqual(await page.evaluate(() => window.speechMock.spoken), []);
        assert.equal(await page.evaluate(() => window.speechFixture.speech.outputPort.value), undefined);
        if (operation === 'stop') {
            await pending(page);
            await page.evaluate(() => { const r = window.speechMock.instances.at(-1); r.result('新しい質問'); r.onend(); window.lateSpeech.end(); });
            await idle(page);
            assert.deepEqual(await page.evaluate(() => window.speechMock.requests), ['新しい質問']);
        } else if (operation === 'pagehide') {
            assert.equal(await page.locator('textarea[aria-label="音声認識結果・エラー"]').inputValue(), '');
        } else assert.equal(await page.locator('textarea[aria-label="音声認識結果・エラー"]').count(), 0);
    });
}

test('tool order, copy and JSON restore keep settings and wiring but omit live text', async context => {
    const page = await fixture(context);
    await pending(page);
    await page.evaluate(() => { const r = window.speechMock.instances.at(-1); r.result('保存しない質問'); r.onend(); });
    await idle(page);
    const data = await page.evaluate(() => {
        const f = window.speechFixture;
        const order = f.editor.tools.slice(0, 5).map(tool => f.geBlockName(tool.toolIdx));
        const copy = f.speech.copy();
        const copied = { lang: copy.lang, value: copy.outputPort.value, text: copy.resultView.value, x: copy.position.x };
        copy.clearBlock();
        const restored = f.makeBlockByTypeName('SpeechRecognitionBlock');
        restored.loadObj({ lang: 'invalid_language' });
        const defaultLang = restored.lang; restored.clearBlock();
        return { order, copied, defaultLang, starts: window.speechMock.instances.length, json: f.speech.makeObj() };
    });
    assert.deepEqual(data.order, ['BLEConnectionBlock', 'IMUBlock', 'PlotBlock', 'AIChatBlock', 'SpeechRecognitionBlock']);
    assert.deepEqual(data.copied, { lang: 'ja-JP', value: undefined, text: '', x: 280 });
    assert.equal(data.defaultLang, 'ja-JP'); assert.equal(data.starts, 1);
    assert.ok(!JSON.stringify(data.json).includes('保存しない質問'));
    const downloadEvent = page.waitForEvent('download'); await page.locator('#download-btn').click();
    const download = await downloadEvent;
    const json = JSON.parse(await readFile(await download.path(), 'utf8'));
    await page.evaluate(json => {
        const transfer = new DataTransfer(); transfer.items.add(new File([JSON.stringify(json)], 'speech.json', { type: 'application/json' }));
        document.getElementById('world-diagram').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    }, json);
    await page.waitForFunction(() => window.speechFixture.editor.blocks.some(b => b.constructor.name === 'SpeechRecognitionBlock' && b !== window.speechFixture.speech));
    assert.deepEqual(await page.evaluate(() => {
        const blocks = window.speechFixture.editor.blocks;
        const speech = blocks.find(b => b.constructor.name === 'SpeechRecognitionBlock');
        return { lang: speech.lang, value: speech.outputPort.value, target: speech.outputPort.destinations[0].parent.constructor.name, starts: window.speechMock.instances.length };
    }), { lang: 'ja-JP', value: undefined, target: 'AIChatBlock', starts: 1 });
    await page.setViewportSize({ width: 720, height: 720 });
    const layout = await page.evaluate(() => {
        const speech = window.speechFixture.editor.blocks.find(b => b.constructor.name === 'SpeechRecognitionBlock');
        speech.setBlockPortPosition(new window.speechFixture.Vec2(280, 100));
        const rect = speech.resultView.getBoundingClientRect();
        const [x1, y1, x2, y2] = speech.finishButton.marginBox();
        const [bx1, by1, bx2, by2] = speech.marginBox();
        return { left: rect.left, top: rect.top, right: rect.right, buttonInside: x1 >= bx1 && x2 <= bx2 && y1 >= by1 && y2 <= by2 };
    });
    assert.deepEqual(layout, { left: 296, top: 234, right: 584, buttonInside: true });
});
