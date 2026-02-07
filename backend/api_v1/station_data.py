import csv
import io
import json
import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import StreamingResponse

import backend.api_v1.core as core
from backend.api_v1.core import _ensure_db_ready, _get_current_user
from backend.api_v1.models import (
    StationDataFilters,
    StationDataHistoryPage,
    StationDataPage,
    StationDataUpdateRequest,
    StationDataUpdateResponse,
)

logger = logging.getLogger("anam.api")
router = APIRouter(tags=["station_data"])


@router.get("/station-data/filters", response_model=StationDataFilters)
async def get_station_data_filters():
    _ensure_db_ready()
    assert core.db_manager is not None
    return core.db_manager.list_station_data_filters()


@router.get("/station-data", response_model=StationDataPage)
async def list_station_data(
    year: Optional[int] = None,
    month: Optional[int] = Query(None, ge=1, le=12),
    station: Optional[str] = None,
    map_type: Optional[str] = Query(None, pattern="^(observation|forecast)$"),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    _ensure_db_ready()
    assert core.db_manager is not None
    items = core.db_manager.list_station_data(
        year=year,
        month=month,
        station_name=station,
        map_type=map_type,
        limit=limit,
        offset=offset,
    )
    total = core.db_manager.count_station_data(
        year=year,
        month=month,
        station_name=station,
        map_type=map_type,
    )
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.patch("/station-data/{row_id}", response_model=StationDataUpdateResponse)
async def update_station_data(
    row_id: int,
    payload: StationDataUpdateRequest,
    authorization: Optional[str] = Header(None),
):
    _ensure_db_ready()
    assert core.db_manager is not None
    updates = payload.dict(exclude_unset=True)
    updated_by = updates.pop("user", None) or "unknown"
    reason = updates.pop("reason", None)
    if authorization:
        try:
            updated_by, _ = _get_current_user(authorization)
        except HTTPException:
            if not payload.user:
                raise
    updates = {k: v for k, v in updates.items() if k in {"tmin", "tmax", "tmin_raw", "tmax_raw", "weather_condition"}}
    if not updates:
        return {"status": "noop", "updated": False, "row": None, "changes": []}

    result = core.db_manager.update_station_data_row(
        row_id,
        updates=updates,
        updated_by=updated_by,
        reason=reason,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Station data row not found.")

    latitude = None
    longitude = None
    conn = core.db_manager.get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT latitude, longitude FROM stations WHERE id = ?", (result.get("station_id"),))
    coords = cursor.fetchone()
    if coords:
        latitude = coords[0]
        longitude = coords[1]

    row_payload = {
        "id": result.get("id"),
        "bulletin_id": result.get("bulletin_id"),
        "date": result.get("date"),
        "map_type": result.get("map_type"),
        "station_id": result.get("station_id"),
        "station_name": result.get("station_name"),
        "latitude": latitude,
        "longitude": longitude,
        "tmin": result.get("tmin"),
        "tmax": result.get("tmax"),
        "tmin_raw": result.get("tmin_raw"),
        "tmax_raw": result.get("tmax_raw"),
        "weather_condition": result.get("weather_condition"),
        "processed_at": None,
    }
    return {
        "status": "updated" if result.get("updated") else "noop",
        "updated": bool(result.get("updated")),
        "row": row_payload,
        "changes": result.get("changes") or [],
    }


@router.get("/station-data/history", response_model=StationDataHistoryPage)
async def list_station_data_history(
    year: Optional[int] = None,
    month: Optional[int] = Query(None, ge=1, le=12),
    station: Optional[str] = None,
    map_type: Optional[str] = Query(None, pattern="^(observation|forecast)$"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    _ensure_db_ready()
    assert core.db_manager is not None
    items = core.db_manager.list_station_data_history(
        year=year,
        month=month,
        station_name=station,
        map_type=map_type,
        limit=limit,
        offset=offset,
    )
    total = core.db_manager.count_station_data_history(
        year=year,
        month=month,
        station_name=station,
        map_type=map_type,
    )

    # Decode JSON strings for values if possible
    for item in items:
        for field in ("old_value", "new_value"):
            raw_value = item.get(field)
            if raw_value is None:
                continue
            try:
                item[field] = json.loads(raw_value)
            except Exception:
                pass
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/station-data/export")
async def export_station_data(
    year: Optional[int] = None,
    month: Optional[int] = Query(None, ge=1, le=12),
    station: Optional[str] = None,
    map_type: Optional[str] = Query(None, pattern="^(observation|forecast)$"),
):
    _ensure_db_ready()
    assert core.db_manager is not None

    def row_stream():
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "Date",
                "Type",
                "Station",
                "Tmin",
                "Tmax",
                "Meteo",
                "Latitude",
                "Longitude",
            ]
        )
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)

        for row in core.db_manager.iter_station_data_rows(
            year=year,
            month=month,
            station_name=station,
            map_type=map_type,
        ):
            writer.writerow(row)
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)

    filename = "station-data.csv"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(row_stream(), media_type="text/csv", headers=headers)
