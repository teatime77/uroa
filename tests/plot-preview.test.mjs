import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.UROA_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set UROA_PLAYWRIGHT_MODULE to playwright-core/index.mjs.');
const { chromium } = await import(pathToFileURL(resolve(modulePath)).href);
const baseURL = (process.env.UROA_PREVIEW_BASE_URL || 'http://127.0.0.1:4177/').replace(/\/$/, '');

test('published diagram loads its local Plotly chunk and builds panels through canvas wiring', async context => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.UROA_BROWSER_EXECUTABLE });
    context.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${baseURL}/diagram/index.html`);
    await page.waitForFunction(() => ['ready', 'failed'].includes(window.uroaApp?.state));
    assert.equal(await page.evaluate(() => window.uroaApp.state), 'ready', await page.evaluate(() => String(window.uroaApp.error?.stack || window.uroaApp.error || '')) + errors.join('\n'));
    const drag = async (x, y, toX, toY) => {
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(toX, toY, { steps: 8 }); await page.mouse.up();
    };
    await drag(35, 150, 780, 170); // IMU toolbox -> canvas
    await drag(35, 230, 400, 430); // Plot toolbox -> canvas
    await drag(875, 272, 720, 418); // IMU output -> Plot input
    await page.waitForFunction(() => document.querySelector('.diagram-plot')?.data?.length === 6);
    assert.deepEqual(await page.evaluate(() => document.querySelector('.diagram-plot').layout.annotations.map(a => a.text)), ['gyro', 'acc']);
    assert.ok(await page.evaluate(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('/plotly-gl3d.min.mjs'))));
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    assert.equal(await page.locator('.diagram-plot').count(), 0);
    assert.deepEqual(errors, []);
});
