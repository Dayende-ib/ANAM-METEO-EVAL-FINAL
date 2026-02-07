import json
import logging
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from backend.api_errors import ErrorCode
import backend.api_v1.core as core

logger = logging.getLogger("anam.api")

# Cache logic
_CACHE: Dict[str, Dict[str, Any]] = {}

def _cache_get(key: str):
    if core.API_CACHE_TTL_SECONDS <= 0:
        return None
    entry = _CACHE.get(key)
    if not entry:
        return None
    if entry["expires_at"] <= time.time():
        _CACHE.pop(key, None)
        return None
    return entry["value"]

def _cache_set(key: str, value: Any):
    if core.API_CACHE_TTL_SECONDS <= 0:
        return
    _CACHE[key] = {
        "value": value,
        "expires_at": time.time() + core.API_CACHE_TTL_SECONDS,
    }

def _cache_clear(prefix: str):
    keys = [cache_key for cache_key in _CACHE.keys() if cache_key.startswith(prefix)]
    for cache_key in keys:
        _CACHE.pop(cache_key, None)

# File and Data Helpers
def _load_result_file():
    """Load interpreted bulletins from disk."""
    if core.result_file is None or not core.result_file.exists():
        raise HTTPException(
            status_code=404,
            detail={
                "code": ErrorCode.RESOURCE_NOT_FOUND.value,
                "message": "No interpreted results available.",
            },
        )
    try:
        with open(core.result_file, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "code": ErrorCode.INTERNAL_SERVER_ERROR.value,
                "message": f"Unable to read results: {exc}",
            },
        )

def _sanitize_filename(original: str) -> str:
    base = Path(original).stem or "bulletin"
    safe = re.sub(r"[^\w-]+", "_", base).strip("_") or "bulletin"
    timestamp = int(time.time())
    return f"{safe}_{timestamp}.pdf"

def _resolve_scrape_output_dir(output_dir: Optional[str]) -> Path:
    base_dir = core.config.project_root.parent if core.config else Path.cwd()
    return Path(output_dir) if output_dir else (base_dir / "bulletins_meteo")

def _serialize_temperature_payload(results: List[dict]) -> List[dict]:
    serialized = []
    for entry in results:
        data_entries = []
        for map_entry in entry.get("data", []):
            temps = []
            for t in map_entry.get("temperatures", []):
                temp_dict = {
                    "name": t.get("name"),
                    "tmin": t.get("tmin"),
                    "tmax": t.get("tmax"),
                    "tmin_raw": t.get("tmin_raw"),
                    "tmax_raw": t.get("tmax_raw"),
                    "bbox": t.get("relative_bbox") or t.get("bbox"),
                    "map_width": t.get("map_width"),
                    "map_height": t.get("map_height")
                }
                temps.append(temp_dict)
            
            data_entries.append(
                {
                    "type": map_entry.get("type"),
                    "image_path": Path(map_entry.get("image_path")).name if map_entry.get("image_path") else None,
                    "temperatures": temps,
                }
            )
        
        img_path = entry.get("image_path")
        pdf_p = entry.get("pdf_path")
        
        serialized.append(
            {
                "pdf_path": Path(pdf_p).name if pdf_p else None,
                "image_path": Path(img_path).name if img_path else None,
                "data": data_entries,
            }
        )
    return serialized

def _serialize_pipeline_run(run: Dict[str, Any], include_steps: bool):
    payload = {
        "id": run.get("id"),
        "status": run.get("status"),
        "started_at": run.get("started_at"),
        "finished_at": run.get("finished_at"),
        "metadata": run.get("metadata"),
        "error_message": run.get("error_message"),
        "last_update": run.get("last_update"),
    }
    if include_steps:
        payload["steps"] = run.get("steps", [])
    return payload

# Auto-pipeline helpers
def _get_latest_bulletin_date():
    if core.db_manager is None:
        return None
    conn = core.db_manager.get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT MAX(date) FROM bulletins")
    row = cursor.fetchone()
    if not row or not row[0]:
        return None
    try:
        return datetime.strptime(row[0], "%Y-%m-%d").date()
    except ValueError:
        return None

def _get_last_auto_pipeline_date():
    if core.db_manager is None:
        return None
    raw_value = core.db_manager.get_app_state(core.AUTO_PIPELINE_STATE_KEY)
    if not raw_value:
        return None
    try:
        return datetime.strptime(raw_value, "%Y-%m-%d").date()
    except ValueError:
        return None

def _set_last_auto_pipeline_date(value):
    if core.db_manager is None:
        return
    core.db_manager.set_app_state(core.AUTO_PIPELINE_STATE_KEY, value.strftime("%Y-%m-%d"))

def _get_temp_retention_days() -> int:
    default_days = int(os.getenv("TEMP_FILE_RETENTION_DAYS", "7"))
    if core.db_manager is None:
        return default_days
    raw_value = core.db_manager.get_app_state(core.TEMP_RETENTION_STATE_KEY)
    if not raw_value:
        return default_days
    try:
        parsed = int(raw_value)
    except ValueError:
        return default_days
    return parsed if parsed > 0 else default_days

def _set_temp_retention_days(value: int) -> None:
    if core.db_manager is None:
        return
    core.db_manager.set_app_state(core.TEMP_RETENTION_STATE_KEY, str(value))

def _should_trigger_auto_pipeline(today) -> bool:
    last_run = _get_last_auto_pipeline_date()
    if last_run == today:
        return False
    last_bulletin = _get_latest_bulletin_date()
    if last_bulletin is None:
        return True
    return last_bulletin < today
