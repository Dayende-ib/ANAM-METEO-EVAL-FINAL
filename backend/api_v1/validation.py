import logging
from typing import Optional

from fastapi import APIRouter, Query

from backend.api_v1.models import (
    DataIssuesPage,
    DataQualityResponse,
    IssueStatusUpdate,
    TemperatureCorrectionRequest
)
import backend.api_v1.core as core
from backend.api_v1.core import _ensure_db_ready

logger = logging.getLogger("anam.api")
router = APIRouter(tags=["validation"])

@router.get("/validation/issues", response_model=DataIssuesPage)
async def list_data_issues(
    date: Optional[str] = None,
    station: Optional[str] = None,
    severity: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """List validation issues recorded during data integration."""
    _ensure_db_ready()
    assert core.db_manager is not None
    items = core.db_manager.list_data_issues(
        date=date,
        station_name=station,
        severity=severity,
        status=status,
        limit=limit,
        offset=offset,
    )
    total = core.db_manager.count_data_issues(
        date=date,
        station_name=station,
        severity=severity,
        status=status,
    )
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/validation/quality", response_model=DataQualityResponse)
async def get_quality_summary(date: Optional[str] = None):
    """Return average quality score for a given date (or overall)."""
    _ensure_db_ready()
    assert core.db_manager is not None
    average = core.db_manager.get_average_quality_score(date=date)
    sample_size = core.db_manager.count_quality_scores(date=date)
    return {"average_quality": average, "sample_size": sample_size, "date": date}


@router.post("/validation/issues/{issue_id}/ignore")
async def ignore_issue(issue_id: int, payload: IssueStatusUpdate):
    """Mark a validation issue as ignored."""
    _ensure_db_ready()
    assert core.db_manager is not None
    core.db_manager.update_data_issue_status(issue_id, "ignored", payload.note)
    return {"status": "ignored", "issue_id": issue_id}


@router.post("/validation/temperature-correction")
async def correct_temperature(payload: TemperatureCorrectionRequest):
    """Apply manual temperature corrections for a station/date/type."""
    _ensure_db_ready()
    assert core.db_manager is not None
    updated = core.db_manager.update_temperatures_for_station(
        payload.date,
        payload.station_name,
        payload.map_type,
        payload.tmin,
        payload.tmax,
    )
    if payload.issue_id:
        core.db_manager.update_data_issue_status(payload.issue_id, "fixed", None)
    return {"status": "updated", "updated": updated}
