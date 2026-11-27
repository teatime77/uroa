# ブラウザ用PythonBlockへ読み込む。ESP32側はrpc-notify-esp32.py。
# 図内にブラウザ用とESP32用を1個ずつ置き、BLE接続後にESP32側でStartする。
# 通信仕様: diagram/ts/ble-wifi/rpc-protocol.ts。Plotly.js等の描画は後続作業。
class Browser(Remote):
    def show(self, value: int) -> None:
        print(f"received: {value}")

    def finished(self) -> None:
        print("notifications finished")

browser = Browser()
