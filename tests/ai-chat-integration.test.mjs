import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// Explicit opt-in: this test sends one question to the configured Google model.
const live = process.env.UROA_AI_LIVE_TEST === '1';
const baseURL = (process.env.UROA_TEST_BASE_URL || 'http://127.0.0.1:5187').replace(/\/$/, '');

test('real browser → Google connection check → Interactions API → TTS without Express', { skip: !live }, async context => {
    // Read the existing configuration in the test process only; never print or write keys.
    const require = createRequire(import.meta.url);
    const { parse } = require('D:/usr/prj/robot/chat/node_modules/dotenv');
    const config = parse(await readFile('D:/usr/prj/robot/chat/.env', 'utf8'));
    let apiKey = process.env.GEMINI_API_KEY?.trim() || config.GEMINI_API_KEY?.trim();
    const model = process.env.GEMINI_MODEL?.trim() || config.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite';
    assert.ok(apiKey, 'Configure a key for the explicitly requested live test.');
    const modulePath = process.env.UROA_PLAYWRIGHT_MODULE;
    assert.ok(modulePath);
    const { chromium } = await import(pathToFileURL(resolve(modulePath)).href);
    const browser = await chromium.launch({ headless: true, executablePath: process.env.UROA_BROWSER_EXECUTABLE });
    context.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let calls = 0, proxyCalls = 0, connectionCalls = 0;
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname === '/api/ask') proxyCalls++;
        if (url.hostname === 'generativelanguage.googleapis.com' && request.method() !== 'OPTIONS') {
            if (url.pathname.endsWith('/interactions')) calls++;
            else if (url.pathname.includes('/models/')) connectionCalls++;
        }
    });
    const logs = [];
    page.on('console', message => logs.push(message.text()));
    await page.addInitScript(() => {
        // Real TTSBlock and Speech code; only physical audio output is replaced.
        window.spokenAnswers = [];
        speechSynthesis.speak = utterance => {
            window.spokenAnswers.push(utterance.text);
            setTimeout(() => utterance.dispatchEvent(new Event('end')), 0);
        };
    });
    await page.goto(`${baseURL}/diagram/index.html`);
    await page.waitForFunction(() => ['ready', 'failed'].includes(window.uroaApp?.state), undefined, { timeout: 60_000 });
    assert.equal(await page.evaluate(() => window.uroaApp.state), 'ready', errors.join('\n'));
    const saved = JSON.parse(await readFile(new URL('../public/diagram/data/ai-chat.json', import.meta.url), 'utf8'));
    await page.evaluate(saved => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([JSON.stringify(saved)], 'ai-chat.json', { type: 'application/json' }));
        document.getElementById('world-diagram').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    }, saved);
    await page.locator('#layer-diagram input[type=text]').waitFor({ state: 'visible' });
    await page.evaluate(async () => {
        const { theEditor } = await import('/diagram/ts/json-util.ts');
        window.directAI = theEditor.blocks.find(block => block.constructor.name === 'AIChatBlock');
        window.directAI.openConnectionDialog();
    });
    await page.getByRole('dialog', { name: 'Googleに接続' }).waitFor();
    await page.evaluate(({ apiKey, model }) => {
        const dialog = document.querySelector('dialog');
        dialog.querySelector('input[name=username]').value = 'gemini-test';
        dialog.querySelector('input[type=password]').value = apiKey;
        dialog.querySelector('input[name=model]').value = model;
        dialog.querySelector('form').requestSubmit();
    }, { apiKey, model });
    await page.waitForFunction(() => window.directAI.connected || window.directAI.message === '接続エラー', undefined, { timeout: 15_000 });
    const connection = await page.evaluate(async () => {
        const { theEditor } = await import('/diagram/ts/json-util.ts');
        const ai = theEditor.blocks.find(block => block.constructor.name === 'AIChatBlock');
        return { connected: ai.connected, message: ai.answerView.value };
    });
    assert.equal(connection.connected, true, connection.message);
    await page.locator('#start-btn').click();
    await page.waitForFunction(() => document.getElementById('start-btn').textContent === 'Start', undefined, { timeout: 45_000 });
    const answer = await page.locator('#layer-diagram textarea').inputValue();
    const result = await page.evaluate(async () => {
        const { theEditor } = await import('/diagram/ts/json-util.ts');
        const ai = theEditor.blocks.find(block => block.constructor.name === 'AIChatBlock');
        return { message: ai.message, answer: ai.outputPort.value, spoken: window.spokenAnswers, saved: JSON.stringify(theEditor.blocks.map(block => block.makeObj())) };
    });
    assert.equal(result.message, '回答を取得しました', answer);
    assert.ok(answer.trim());
    assert.equal(result.answer, answer);
    assert.deepEqual(result.spoken, [answer.trim().replaceAll('○', 'マル').replaceAll('×', 'バツ')]);
    assert.equal(calls, 1);
    assert.equal(connectionCalls, 1); assert.equal(proxyCalls, 0);
    assert.equal(result.saved.includes(apiKey), false);
    assert.equal(logs.some(message => message.includes(apiKey)), false);
    apiKey = '';
    assert.deepEqual(errors, []);
    await page.screenshot({ path: 'tmp/ai-chat-live.png' });
    // Do not print the response or any backend environment variables.
});

test('direct Google communication preserves the existing development /api/save', { skip: !live }, async () => {
    const filename = `_ai-proxy-check-${randomUUID()}.json`;
    const outputPath = resolve('public/algebra/output', filename);
    try {
        const response = await fetch(`${baseURL}/api/save`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename, type: 'json', data: { proxyCheck: true } }),
        });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).ok, true);
        assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), { proxyCheck: true });
        for (const path of ['/api/ask/extra', '/api/ask-other', '/api/health']) {
            const response = await fetch(`${baseURL}${path}`);
            assert.ok(!(response.headers.get('content-type') || '').includes('application/json'), path);
        }
    } finally { await rm(outputPath, { force: true }); }
});
