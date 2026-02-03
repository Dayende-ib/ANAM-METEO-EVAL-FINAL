#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
from pathlib import Path

import uvicorn


def main():
    """Launch the FastAPI service."""
    project_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(project_root))
    existing_path = os.environ.get("PYTHONPATH", "")
    if str(project_root) not in existing_path.split(os.pathsep):
        os.environ["PYTHONPATH"] = os.pathsep.join(
            [str(project_root)] + ([existing_path] if existing_path else [])
        )

    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", "8000"))
    reload_flag = os.getenv("API_RELOAD", "1").lower() in {"1", "true", "yes"}
    uvicorn.run(
        "backend.api:app",
        host=host,
        port=port,
        reload=reload_flag,
        reload_dirs=[str(project_root)],
    )


if __name__ == "__main__":
    main()
