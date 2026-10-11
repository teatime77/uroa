import argparse
import os
import time
from playwright.sync_api import Playwright, sync_playwright, expect

BASE_URL = os.environ.get("UROA_TEST_BASE_URL", "http://localhost:5173/").rstrip("/") + "/"

def drag(page, start_x, start_y, end_x, end_y):
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(end_x, end_y, steps=10)
    page.mouse.up()

    # page.locator("#world-diagram").click(position={"x":117,"y":81})
    # page.locator("#world-diagram").click(position={"x":422,"y":179})
    # page.locator("#world-diagram").click(position={"x":97,"y":188})
    # page.locator("#world-diagram").click(position={"x":434,"y":221})

def run_game(page):
    page.goto(BASE_URL)
    with page.expect_console_message(lambda msg: "game ready" in msg.text, timeout=0) as msg_info:
        page.get_by_role("link", name="game").click()

    page.locator("#world-game").click(position={"x":976,"y":425})
    time.sleep(1)
    page.locator("#world-game").click(position={"x":1233,"y":38})

    page.locator("#world-game").click(position={"x":952,"y":503})
    with page.expect_console_message(lambda msg: "root-parallel-action end" in msg.text, timeout=0) as msg_info:
        page.locator("#world-game").click(position={"x":1229,"y":135})

    print("game OK")
    time.sleep(1)

def run_diagram(page):
    page.goto(BASE_URL)
    with page.expect_console_message(lambda msg: "diagram ready" in msg.text, timeout=0) as msg_info:
        page.get_by_role("link", name="diagram").click()

    drag(page, 117, 81, 422, 179)
    drag(page, 97, 188, 434, 221)
    print("diagram OK")
    time.sleep(1)

def run_webgpu(page):
    page.goto(BASE_URL)
    with page.expect_console_message(lambda msg: "webgpu ready" in msg.text, timeout=0) as msg_info:
        page.get_by_role("link", name="webgpu").click()
    page.get_by_role("button", name="電磁波").click()
    print("webgpu OK")
    time.sleep(1)

def run_algebra(page):
    page.goto(BASE_URL)
    with page.expect_console_message(lambda msg: "algebra OK" in msg.text, timeout=0) as msg_info:
        page.get_by_role("link", name="algebra").click()

    print("algebra OK")
    time.sleep(1)

def run_movie(page):
    page.goto(BASE_URL)
    page.get_by_role("link", name="movie").click()
    page.locator("polygon").first.dispatch_event("contextmenu")    
    with page.expect_console_message(lambda msg: "play all done." in msg.text, timeout=0) as msg_info:
        page.get_by_text("play all graph").click()
    print("movie OK")

def run(playwright: Playwright) -> None:
    # browser = playwright.chromium.launch(headless=False, args=["--start-maximized"])
    # context = browser.new_context(no_viewport=True)
    browser = playwright.chromium.launch(headless=False)
    context = browser.new_context()
    page = context.new_page()

    run_webgpu(page)
    run_game(page)
    run_diagram(page)
    run_algebra(page)
    run_movie(page)

    context.close()
    browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the existing five-app regression test.")
    parser.add_argument("--base-url", default=BASE_URL, help="Vite dev or preview server URL")
    args = parser.parse_args()
    BASE_URL = args.base_url.rstrip("/") + "/"
    with sync_playwright() as playwright:
        run(playwright)
