import asyncio
import logging
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.concurrency import run_in_threadpool

from backend.api_v1.models import (
    PipelineTriggerRequest,
    PipelineTriggerResponse,
    PipelineRunDetail,
    TempRetentionSettings
)
import backend.api_v1.core as core
from backend.api_v1.core import _ensure_services_ready, ErrorCode, log_event
from backend.api_v1.utils import (
    _cache_clear,
    _serialize_pipeline_run,
    _get_temp_retention_days,
    _set_temp_retention_days,
    _should_trigger_auto_pipeline,
    _set_last_auto_pipeline_date
)
from backend.modules.pipeline_runner import PipelineRunner

logger = logging.getLogger("anam.api")
router = APIRouter(tags=["pipeline"])

@router.get("/settings/storage/retention", response_model=TempRetentionSettings)
async def get_temp_retention_settings():
    """Return temp file retention settings."""
    _ensure_services_ready()
    return TempRetentionSettings(keep_days=_get_temp_retention_days())


@router.post("/settings/storage/retention", response_model=TempRetentionSettings)
async def update_temp_retention_settings(payload: TempRetentionSettings):
    """Update temp file retention settings."""
    _ensure_services_ready()
    _set_temp_retention_days(payload.keep_days)
    return TempRetentionSettings(keep_days=payload.keep_days)


@router.post("/pipeline/run", response_model=PipelineTriggerResponse)
async def trigger_pipeline_run(request: PipelineTriggerRequest, background_tasks: BackgroundTasks):
    """Trigger the full pipeline in background."""
    _ensure_services_ready()
    assert core.services is not None and core.config is not None
    if core.services.pipeline.has_active_run():
        raise HTTPException(
            status_code=409,
            detail={
                "code": ErrorCode.PIPELINE_ALREADY_RUNNING.value,
                "message": "Pipeline already running.",
            },
        )
    steps_template = PipelineRunner.build_steps_template()
    run_id = core.services.pipeline.create_run(steps_template)
    runner = PipelineRunner(core.config, core.services.db_manager, run_id, options=request.dict())
    background_tasks.add_task(run_in_threadpool, runner.run)
    _cache_clear("bulletins:")
    _cache_clear("metrics:")
    return {"run_id": run_id, "status": "running"}


@router.get("/pipeline/runs")
async def list_pipeline_runs(limit: int = 20):
    """Return the latest recorded pipeline runs."""
    _ensure_services_ready()
    assert core.services is not None
    runs = core.services.pipeline.list_runs(limit)
    return {"runs": [_serialize_pipeline_run(run, include_steps=False) for run in runs]}


@router.post("/pipeline/stop/{run_id}")
async def stop_pipeline_run(run_id: int):
    """Stop an active pipeline run."""
    _ensure_services_ready()
    assert core.services is not None
    run = core.services.pipeline.get_run(run_id)
    if not run:
        raise HTTPException(
            status_code=404,
            detail={
                "code": ErrorCode.RESOURCE_NOT_FOUND.value,
                "message": "Execution pipeline non trouvée.",
            },
        )
    if run["status"] != "running":
        raise HTTPException(
            status_code=400,
            detail={
                "code": ErrorCode.CONFLICT.value,
                "message": "Seul un pipeline en cours peut être stoppé.",
            },
        )
    core.services.pipeline.update_run(run_id, status="cancelled", finished=True)
    return {"message": "Signal d'arrêt envoyé au pipeline."}


@router.post("/pipeline/skip-step/{run_id}/{step_key}")
async def skip_pipeline_step(run_id: int, step_key: str):
    """Mark a step to be skipped."""
    _ensure_services_ready()
    assert core.services is not None
    run = core.services.pipeline.get_run(run_id)
    if not run:
        raise HTTPException(
            status_code=404,
            detail={
                "code": ErrorCode.RESOURCE_NOT_FOUND.value,
                "message": "Execution pipeline non trouvée.",
            },
        )
    
    steps = run["steps"]
    found = False
    for step in steps:
        if step["key"] == step_key:
            if step["status"] not in ["pending"]:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": ErrorCode.CONFLICT.value,
                        "message": "Seule une étape en attente peut être sautée.",
                    },
                )
            step["status"] = "skipped"
            step["message"] = "Sauté par l'utilisateur."
            found = True
            break
    
    if not found:
        raise HTTPException(
            status_code=404,
            detail={
                "code": ErrorCode.RESOURCE_NOT_FOUND.value,
                "message": f"Étape {step_key} non trouvée.",
            },
        )
        
    core.services.pipeline.update_run(run_id, steps=steps)
    return {"message": f"Étape {step_key} marquée comme sautée."}


@router.get("/pipeline/runs/{run_id}", response_model=PipelineRunDetail)
async def get_pipeline_run(run_id: int):
    """Return detail for a specific pipeline run."""
    _ensure_services_ready()
    assert core.services is not None
    run = core.services.pipeline.get_run(run_id)
    if not run:
        raise HTTPException(
            status_code=404,
            detail={
                "code": ErrorCode.PIPELINE_RUN_NOT_FOUND.value,
                "message": "Pipeline not found.",
            },
        )
    return _serialize_pipeline_run(run, include_steps=True)


# Auto Pipeline logic
async def _start_pipeline_run(options: Optional[Dict[str, Any]] = None) -> Optional[int]:
    _ensure_services_ready()
    assert core.services is not None and core.config is not None
    if core.services.pipeline.has_active_run():
        return None
    steps_template = PipelineRunner.build_steps_template()
    run_id = core.services.pipeline.create_run(steps_template)
    runner = PipelineRunner(core.config, core.services.db_manager, run_id, options=options or {})
    asyncio.create_task(run_in_threadpool(runner.run))
    return run_id


async def _auto_pipeline_worker() -> None:
    while True:
        try:
            today = datetime.now().date()
            if _should_trigger_auto_pipeline(today):
                run_id = await _start_pipeline_run(
                    {
                        "use_scraping": True,
                        "metadata": {"trigger": "auto"},
                    }
                )
                if run_id:
                    log_event(logging.INFO, "auto_pipeline_triggered", runId=run_id, date=str(today))
                    _set_last_auto_pipeline_date(today)
        except Exception as exc:
            log_event(logging.ERROR, "auto_pipeline_error", error=str(exc))
        await asyncio.sleep(max(60, core.AUTO_PIPELINE_INTERVAL_SECONDS))
