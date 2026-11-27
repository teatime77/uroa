# ESP32用PythonBlockへ読み込む。ブラウザ側はrpc-notify-browser.py。
# ESP32はブラウザのメソッド完了を待たずに次へ進む。
# 有限長の送信キューを使用するため、連続送信には間隔を設ける。
from remote import browser

for value in range(3):
    browser.show(value)
    sleep(0.5)

browser.finished()
