import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from backend.api_v1.models import (
    EvaluationMetrics,
    MetricsListResponse,
    MetricsRecalculateRequest
)
import backend.api_v1.core as core
from backend.api_v1.core import _ensure_services_ready, ErrorCode
from backend.api_v1.utils import _cache_get, _cache_set, _cache_clear

logger = logging.getLogger("anam.api")
router = APIRouter(tags=["metrics"])

@router.get("/metrics/{date}", response_model=EvaluationMetrics)
async def get_evaluation_metrics(date: str):
    """Retourner les métriques d'évaluation stockées dans la base de données pour une date donnée."""
    _ensure_services_ready()
    cache_key = f"metrics:detail:{date}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    assert core.services is not None
    payload = core.services.metrics.get_evaluation_metrics(date)
    if not payload:
        raise HTTPException(
            status_code=404,
            detail={
                "code": ErrorCode.METRICS_NOT_FOUND.value,
                "message": f"No metrics for {date}.",
            },
        )
    _cache_set(cache_key, payload)
    return payload


@router.get("/metrics", response_model=MetricsListResponse)
async def list_evaluation_metrics(limit: int = Query(50, ge=1, le=500)):
    """List evaluation metrics stored in the database."""
    _ensure_services_ready()
    cache_key = f"metrics:list:{limit}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    assert core.services is not None
    items = core.services.metrics.list_evaluation_metrics(limit)
    payload = {"items": items, "total": len(items)}
    _cache_set(cache_key, payload)
    return payload


@router.post("/metrics/recalculate")
async def recalculate_metrics(payload: Optional[MetricsRecalculateRequest] = None):
    """Recalculate evaluation metrics for all bulletins."""
    _ensure_services_ready()
    assert core.services is not None
    force = payload.force if payload else False

    def run_evaluation():
        return core.services.metrics.recalculate(force=force)

    result = await run_in_threadpool(run_evaluation)
    
    # Invalider le cache après recalcul
    _cache_clear("metrics:")
    _cache_clear("monthly_metrics:")
    
    if not result.get("daily"):
        observation_count = len(core.services.metrics.list_bulletin_dates("observation"))
        forecast_count = len(core.services.metrics.list_bulletin_dates("forecast"))
        return {
            "status": "no_data",
            "message": "Aucune donnee observation/prevision disponible pour recalculer.",
            "observation_count": observation_count,
            "forecast_count": forecast_count,
        }
    
    return {
        "status": "done",
        "result": result,
    }


@router.get("/metrics/monthly/{year}/{month}")
async def get_monthly_metrics(year: int, month: int):
    """Récupère les métriques agrégées pour un mois donné."""
    _ensure_services_ready()
    assert core.services is not None
    
    cache_key = f"monthly_metrics:{year}-{month:02d}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    
    metrics = core.services.metrics.get_monthly_metrics(year, month)
    if not metrics:
        raise HTTPException(
            status_code=404,
            detail={
                "code": ErrorCode.METRICS_NOT_FOUND.value,
                "message": f"Aucune métrique mensuelle pour {year}-{month:02d}.",
            },
        )
    
    _cache_set(cache_key, metrics)
    return metrics


@router.get("/metrics-monthly")
async def list_monthly_metrics(limit: int = Query(12, ge=1, le=60)):
    """Liste les métriques mensuelles récentes."""
    logger.info(f"list_monthly_metrics called with limit={limit}")
    _ensure_services_ready()
    assert core.services is not None
    
    cache_key = f"monthly_metrics:list:{limit}"
    cached = _cache_get(cache_key)
    if cached is not None:
        logger.info(f"Returning cached result for {cache_key}")
        return cached
    
    logger.info("Calling services.metrics.list_monthly_metrics")
    items = core.services.metrics.list_monthly_metrics(limit)
    logger.info(f"list_monthly_metrics: found {len(items)} items with limit={limit}")
    payload = {"items": items, "total": len(items)}
    
    if len(items) == 0:
        logger.warning("No monthly metrics found in database")
        raise HTTPException(
            status_code=404,
            detail={
                "code": ErrorCode.METRICS_NOT_FOUND.value,
                "message": "No monthly metrics found in database.",
            },
        )
    
    _cache_set(cache_key, payload)
    return payload


# Station Monthly Metrics Endpoints

@router.get("/metrics/stations")
async def list_stations_with_metrics():
    """Liste toutes les stations avec leurs métriques disponibles."""
    _ensure_services_ready()
    assert core.services is not None
    
    # Désactiver temporairement le cache pour le debug
    # cache_key = "stations_with_metrics"
    # cached = _cache_get(cache_key)
    # if cached is not None:
    #     return cached
    
    stations = core.services.metrics.list_all_stations_with_metrics()
    payload = {"stations": stations, "total": len(stations)}
    
    # _cache_set(cache_key, payload)
    return payload


@router.get("/metrics/station/{station_id}/monthly/{year}/{month}")
async def get_station_monthly_metrics(station_id: int, year: int, month: int):
    """Récupère les métriques mensuelles pour une station donnée."""
    _ensure_services_ready()
    assert core.services is not None
    
    cache_key = f"station_metrics:{station_id}:{year}-{month:02d}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    
    metrics = core.services.metrics.get_station_monthly_metrics(station_id, year, month)
    if not metrics:
        raise HTTPException(
            status_code=404,
            detail={
                "code": ErrorCode.METRICS_NOT_FOUND.value,
                "message": f"Aucune métrique mensuelle pour la station {station_id} en {year}-{month:02d}.",
            },
        )
    
    _cache_set(cache_key, metrics)
    return metrics


@router.get("/metrics/station/{station_id}/monthly")
async def list_station_monthly_metrics(station_id: int, limit: int = Query(12, ge=1, le=60)):
    """Liste les métriques mensuelles récentes pour une station."""
    _ensure_services_ready()
    assert core.services is not None
    
    cache_key = f"station_metrics_list:{station_id}:{limit}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    
    items = core.services.metrics.list_station_monthly_metrics(station_id, limit)
    payload = {"items": items, "total": len(items)}
    
    if len(items) == 0:
        raise HTTPException(
            status_code=404,
            detail={
                "code": ErrorCode.METRICS_NOT_FOUND.value,
                "message": f"Aucune métrique mensuelle trouvée pour la station {station_id}.",
            },
        )
    
    _cache_set(cache_key, payload)
    return payload
