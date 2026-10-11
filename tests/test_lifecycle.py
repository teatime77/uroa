"""Focused P3 checks. Run after starting Vite dev or preview; test.py stays unchanged."""
import argparse
import json
from playwright.sync_api import sync_playwright, expect


def drop_blocks(page, blocks, has_input=True):
    marker = f"block:[{blocks[-1]['typeName']}]"
    with page.expect_console_message(lambda message: message.text == marker):
        page.evaluate("""blocks => {
            const transfer = new DataTransfer();
            transfer.items.add(new File([JSON.stringify(blocks)], 'lifecycle.json', {type: 'application/json'}));
            document.getElementById('world-diagram').dispatchEvent(
                new DragEvent('drop', {bubbles: true, dataTransfer: transfer}));
        }""", blocks)
    # Wait for the editor to mount the block's input, rather than sleeping for rendering.
    if has_input:
        expect(page.locator('#layer-diagram input').last).to_be_visible()


def run(base_url):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=False)
        try:
            page = browser.new_page()
            page.add_init_script("""if (window.GPUQueue) {
                window.p3GpuSubmissions = 0;
                const submit = GPUQueue.prototype.submit;
                GPUQueue.prototype.submit = function(...args) {
                    window.p3GpuSubmissions++;
                    return submit.apply(this, args);
                };
            }""")
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda message: errors.append(message.text)
                    if message.type == 'error' and message.text.startswith(('diagram procedure failed', 'uroa cleanup failed')) else None)
            page.goto(base_url)
            page.wait_for_function("window.uroaApp?.state === 'ready'")
            assert page.get_by_role('link').count() == 5
            for name in ['webgpu', 'game', 'diagram', 'algebra', 'movie']:
                page.goto(f'{base_url}{name}/index.html')
                page.wait_for_function("window.uroaApp?.state === 'ready'", timeout=120_000)
                before = page.locator('button, canvas, input').count()
                assert page.evaluate("""async () => {
                    const first = window.uroaApp.start();
                    const second = window.uroaApp.start();
                    await Promise.all([first, second]);
                    return first === second;
                }""")
                assert page.locator('button, canvas, input').count() == before
                await_disposal = page.evaluate("async () => { await window.uroaApp.dispose(); return window.uroaApp.state; }")
                assert await_disposal == 'disposed'
                print(f'{name}: direct startup, duplicate startup, disposal OK', flush=True)

            page.goto(f'{base_url}diagram/index.html')
            page.wait_for_function("window.uroaApp?.state === 'ready'", timeout=120_000)
            drop_blocks(page, [
                dict(idx=0, typeName='InputNumberBlock', x=400, y=130,
                     text='60', value=60, ports=[dict(idx=0, destinations=[3])]),
                dict(idx=1, typeName='SleepBlock', x=400, y=230,
                     ports=[dict(idx=1, destinations=[]), dict(idx=2, destinations=[]),
                            dict(idx=3, destinations=[])]),
            ])
            button = page.locator('#start-btn')
            for _ in range(2):
                button.click()
                expect(button).to_have_text('Stop')
                page.wait_for_timeout(100) # Ensure the long wait is still active before cancelling.
                expect(button).to_have_text('Stop')
                button.click()
                expect(button).to_have_text('Start', timeout=2000)
            print('diagram: cancel 60-second wait and replay OK', flush=True)

            game_target = page.request.get(f'{base_url}game/data/prod.json').json()['target']
            for child, target in [('movie', None), ('game', game_target), ('webgpu', 'fdtd')]:
                type_name = {'movie': 'PlayMovieBlock', 'game': 'PlayGameBlock', 'webgpu': 'PlayWebGPUBlock'}[child]
                blocks = [dict(idx=0, typeName=type_name,
                               x=400, y=230, ports=[dict(idx=0, destinations=[]), dict(idx=1, destinations=[])])]
                if target:
                    blocks[0]['ports'].append(dict(idx=2, destinations=[]))
                    blocks.append(dict(idx=1, typeName='InputTextBlock', x=400, y=130,
                                       text=target, ports=[dict(idx=3, destinations=[2])]))
                drop_blocks(page, blocks, has_input=bool(target))
                button.click()
                expect(page.locator(f'#layer-{child}')).to_be_visible()
                if child == 'webgpu':
                    page.wait_for_function('window.p3GpuSubmissions > 0')
                page.evaluate('window.uroaApp.stop()')
                expect(page.locator('#layer-diagram')).to_be_visible(timeout=10_000)
                expect(button).to_have_text('Start', timeout=10_000)
                if child == 'webgpu':
                    submissions = page.evaluate('window.p3GpuSubmissions')
                    page.wait_for_timeout(500) # Observation window: detect a live GPU render loop after stop.
                    assert page.evaluate('window.p3GpuSubmissions') == submissions
                print(f'diagram: {child} delegation, stop, layer restoration OK', flush=True)

            page.route('**/game/data/prod.json*', lambda route: route.fulfill(status=503, body='unavailable'))
            page.goto(f'{base_url}game/index.html')
            page.wait_for_function("window.uroaApp?.state === 'failed'")
            assert page.evaluate("async () => { try { await window.uroaApp.start(); return false; } catch { return true; } }")
            page.evaluate("async () => { await window.uroaApp.dispose(); }")
            assert page.evaluate('window.uroaApp.state') == 'disposed'
            assert not errors, json.dumps(errors, ensure_ascii=False)
            print('initialization failure: error state and cleanup OK', flush=True)
        finally:
            browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://localhost:5173/')
    args = parser.parse_args()
    run(args.base_url.rstrip('/') + '/')
