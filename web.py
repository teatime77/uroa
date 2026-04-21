from flask import Flask, send_from_directory, abort
import os

app = Flask(__name__)

# 配信するディレクトリを 'webgpu' から 'dist' に変更
DIST_DIRECTORY = os.path.join(os.getcwd(), 'dist')

# ルートURL（ http://localhost:5000/ ）にアクセスしたときに index.html を返す
@app.route('/')
def index():
    try:
        return send_from_directory(DIST_DIRECTORY, 'index.html')
    except FileNotFoundError:
        return "Error: index.html not found. Please run 'npx vite build' first.", 404

# その他のファイル（mjs, 画像, css など）へのリクエストを処理する
@app.route('/<path:filename>')
def serve_static(filename):
    try:
        # send_from_directory がディレクトリトラバーサル攻撃を防ぎつつファイルを返す
        return send_from_directory(DIST_DIRECTORY, filename)
    except FileNotFoundError:
        abort(404)

if __name__ == '__main__':
    # 起動前に dist フォルダが存在するかチェックし、なければ警告を出す
    if not os.path.exists(DIST_DIRECTORY):
        print(f"Warning: The directory '{DIST_DIRECTORY}' does not exist.")
        print("Please build the project first using Vite (e.g., npx vite build).")
    else:
        print(f"Serving files from: {DIST_DIRECTORY}")
    
    app.run(debug=True, port=5000)