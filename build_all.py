import os
import shutil
import subprocess
from pathlib import Path
import time

SUB_PROJECTS = [
    "i18n", "parser", "algebra", "layout", "plane", 
    "firebase", "webgpu", "lesson", "media", "movie", 
    "game", "diagram", "plot"
]

def get_latest_mtime(directory):
    path = Path(directory)
    if not path.exists(): return 0
    mtimes = [f.stat().st_mtime for f in path.rglob('*') if f.is_file()]
    return max(mtimes) if mtimes else path.stat().st_mtime

def sync_file(src, dst):
    if not src.exists(): return
    if src.stat().st_mtime > (dst.stat().st_mtime if dst.exists() else 0):
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        print(f"    [Synced] {src.name}")

def run_smart_sync():
    parent_dist_root = Path("dist")
    
    print("--- Starting Vite Build & Asset Synchronization ---")

    for p_dir in SUB_PROJECTS:
        p_path = Path(p_dir)
        
        ts_dir = p_path / "ts"
        local_dist = p_path / "dist"
        vite_config = p_path / "vite.config.ts"
        target_dist = parent_dist_root / p_path
        
        # 親の dist 内に index.html があるか（ビルド済みの目印）
        target_index = target_dist / "index.html"
        
        print(f"\n[{p_path}]")

        # 1. Vite ビルドの判定
        if vite_config.exists() and ts_dir.exists():
            ts_latest = get_latest_mtime(ts_dir)
            dist_latest = get_latest_mtime(local_dist)
            
            # 判定条件を拡張：
            # A: ソースが子の成果物より新しい
            # B: 親の dist にファイルが存在しない (一括削除された後など)
            need_build = (ts_latest > dist_latest) or (not target_index.exists())

            if need_build:
                reason = "Source changed" if ts_latest > dist_latest else "Parent dist missing"
                print(f"  🚀 Build required ({reason})...")
                try:
                    subprocess.run(["npx", "vite", "build"], cwd=p_path, shell=True, check=True)
                    local_dist.touch()
                except subprocess.CalledProcessError:
                    print(f"  ❌ Vite build failed. Skipping sync.")
                    continue
            else:
                print(f"  ✅ Up to date.")

        # 2. 以降の同期処理 (子のdist -> 親のdist)
        if local_dist.exists():
            for src_file in local_dist.rglob("*"):
                if src_file.is_file():
                    sync_file(src_file, target_dist / src_file.relative_to(local_dist))

        sync_file(p_path / "index.html", target_dist / "index.html")
        
        public_dir = p_path / "public"
        if public_dir.exists():
            for src_file in public_dir.rglob("*"):
                if src_file.is_file():
                    sync_file(src_file, target_dist / src_file.relative_to(public_dir))

    print("\n--- All processes completed ---")

if __name__ == "__main__":
    subprocess.run(["tsc-all.bat"], shell=True)
    run_smart_sync()