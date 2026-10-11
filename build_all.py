"""Compatibility entry point for the root TypeScript and Vite build."""

import os
from pathlib import Path
import subprocess
import sys


if __name__ == "__main__":
    project_root = Path(__file__).resolve().parent
    try:
        result = subprocess.run(
            ["npm.cmd" if os.name == "nt" else "npm", "run", "build"],
            cwd=project_root,
            shell=os.name == "nt",
        )
    except OSError as error:
        print(f"Could not start npm: {error}", file=sys.stderr)
        sys.exit(1)
    sys.exit(result.returncode)
