import io
import json
import logging
import re
import unicodedata
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, List, Optional, Union

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile, Path as ApiPath
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel, Field

from backend.api_v1.models import (
    ScrapeRequest, ScrapeResponse, ScrapeManifestResponse,
    UploadResponse, UploadJobResponse, UploadJobStatus,
    UploadBatchResponse, UploadBatchStatus
)
import backend.api_v1.core as core
from backend.api_v1.core import _ensure_services_ready, _ensure_db_ready, ErrorCode
from backend.api_v1.utils import (
    _resolve_scrape_output_dir,
    _sanitize_filename,
    _serialize_temperature_payload
)
from backend.modules.pdf_scrap import MeteoBurkinaScraper, ManifestStore, ScrapeConfig
from backend.modules.pdf_extractor import PDFExtractor
from backend.modules.temperature_extractor import TemperatureExtractor
from backend.modules.workflow_temperature_extractor import WorkflowTemperatureExtractor
from backend.modules.icon_classifier import IconClassifier
from backend.modules.data_integrator import DataIntegrator

logger = logging.getLogger("anam.api")
router = APIRouter(tags=["data_management"])

_MONTHS_FR = {
    "janvier": 1,
    "fevrier": 2,
    "mars": 3,
    "avril": 4,
    "mai": 5,
    "juin": 6,
    "juillet": 7,
    "aout": 8,
    "septembre": 9,
    "octobre": 10,
    "novembre": 11,
    "decembre": 12,
}


def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")


def _parse_bulletin_date(filename: str) -> Optional[str]:
    match = re.search(r"Bulletin_du_(\d{1,2})_([A-Za-z\u00c0-\u017f]+)_(\d{4})", filename)
    if not match:
        return None
    day_str, month_raw, year_str = match.groups()
    month_key = _strip_accents(month_raw).lower()
    month_num = _MONTHS_FR.get(month_key)
    if not month_num:
        return None
    try:
        return datetime(int(year_str), month_num, int(day_str)).strftime("%Y-%m-%d")
    except ValueError:
        return None


def _map_type_from_name(filename: str) -> Optional[str]:
    lowered = filename.lower()
    if "observed" in lowered or "observation" in lowered:
        return "observed"
    if "forecast" in lowered or "prevision" in lowered:
        return "forecast"
    return None


def _infer_bulletin_type_from_filename(filename: str) -> Optional[str]:
    lowered = filename.lower()
    if "forecast" in lowered or "prevision" in lowered or "prévision" in lowered:
        return "forecast"
    if "observed" in lowered or "observation" in lowered or "obs" in lowered:
        return "observation"
    return None


def _normalize_manual_map_type(value: str) -> Optional[str]:
    lowered = value.lower().strip()
    if lowered in {"observed", "observation", "obs"}:
        return "observation"
    if lowered in {"forecast", "prevision", "prev"}:
        return "forecast"
    return None


def _sanitize_source(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", value.strip())
    return cleaned.strip("_") or "manual"


class ManualMetricsStation(BaseModel):
    nom: Optional[str] = None
    tmin: Optional[float] = None
    tmax: Optional[float] = None
    weather_icon: Optional[str] = None


class ManualMetricsEntry(BaseModel):
    date: str = Field(..., min_length=8)
    mapType: str = Field(..., min_length=3)
    source: Optional[str] = None
    stations: List[ManualMetricsStation] = Field(default_factory=list)


class ManualMetricsIngestRequest(BaseModel):
    source: Optional[str] = None
    entries: List[ManualMetricsEntry] = Field(default_factory=list)


class ManualMetricsIngestResponse(BaseModel):
    inserted_bulletins: int
    updated_payloads: int
    skipped: int


@router.get("/json-metrics/files")
async def list_json_metrics_files():
    """Liste les fichiers JSON de métriques disponibles dans backend/json."""
    base_dir = (core.config.project_root / "json") if core.config else None
    if base_dir is None or not base_dir.exists():
        return {"files": [], "total": 0}

    files: List[dict] = []
    for json_path in sorted(base_dir.rglob("*.json")):
        try:
            stat = json_path.stat()
        except OSError:
            continue
        rel_path = json_path.relative_to(base_dir).as_posix()
        date_value = _parse_bulletin_date(json_path.name)
        files.append(
            {
                "path": rel_path,
                "name": json_path.name,
                "size_bytes": stat.st_size,
                "modified_at": datetime.utcfromtimestamp(stat.st_mtime).isoformat() + "Z",
                "date": date_value,
                "month": date_value[:7] if date_value else None,
                "year": int(date_value[:4]) if date_value else None,
                "map_type": _map_type_from_name(json_path.name),
            }
        )

    return {"files": files, "total": len(files)}


@router.get("/json-metrics/file")
async def get_json_metrics_file(path: str = Query(..., min_length=1)):
    """Retourne le contenu d'un fichier JSON de métriques."""
    base_dir = (core.config.project_root / "json") if core.config else None
    if base_dir is None:
        raise HTTPException(status_code=500, detail="Configuration indisponible.")

    base_dir = base_dir.resolve()
    target = (base_dir / path).resolve()
    if base_dir != target and base_dir not in target.parents:
        raise HTTPException(status_code=400, detail="Chemin invalide.")
    if target.suffix.lower() != ".json":
        raise HTTPException(status_code=400, detail="Seuls les fichiers JSON sont autorisés.")
    if not target.exists():
        raise HTTPException(status_code=404, detail="Fichier introuvable.")

    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lecture JSON impossible: {exc}")

    return {"path": path, "data": payload}


@router.post("/json-metrics/ingest", response_model=ManualMetricsIngestResponse)
async def ingest_json_metrics(payload: ManualMetricsIngestRequest):
    """Insere des donnees JSON/CSV traitees dans la base."""
    _ensure_db_ready()
    if core.db_manager is None:
        raise HTTPException(status_code=500, detail="Base de donnees indisponible.")

    inserted = 0
    updated = 0
    skipped = 0
    source = payload.source or "manual"
    source_key = _sanitize_source(source)

    for index, entry in enumerate(payload.entries):
        try:
            datetime.strptime(entry.date, "%Y-%m-%d")
        except ValueError:
            skipped += 1
            continue

        bulletin_type = _normalize_manual_map_type(entry.mapType or "")
        if not bulletin_type:
            skipped += 1
            continue

        pdf_path = f"manual-import/{source_key}/{entry.date}-{bulletin_type}-{index}.json"
        if not core.db_manager.has_bulletin_for_pdf(pdf_path):
            core.db_manager.insert_bulletin(
                entry.date,
                bulletin_type,
                file_path=pdf_path,
                title=f"Manual import {entry.date} {bulletin_type}",
            )
            inserted += 1

        payload_stations: List[dict] = []
        for station in entry.stations:
            name = (station.nom or "").strip()
            if not name:
                continue
            station_payload = {"name": name}
            block = {
                "tmin": station.tmin,
                "tmax": station.tmax,
                "weather_condition": station.weather_icon,
            }
            if bulletin_type == "observation":
                station_payload["observation"] = block
            else:
                station_payload["prevision"] = block
            payload_stations.append(station_payload)

        payload_dict = {
            "date_bulletin": entry.date,
            "type": bulletin_type,
            "source": entry.source or source,
            "stations": payload_stations,
        }
        core.db_manager.upsert_bulletin_payload(pdf_path, payload_dict)
        updated += 1

    return ManualMetricsIngestResponse(
        inserted_bulletins=inserted,
        updated_payloads=updated,
        skipped=skipped,
    )

@router.post("/scrape", response_model=ScrapeResponse)
async def trigger_scrape(request: ScrapeRequest):
    """Déclencher le scraping des bulletins avec des filtres facultatifs."""
    _ensure_services_ready()

    if request.month is not None and not 1 <= request.month <= 12:
        raise HTTPException(status_code=400, detail="Le mois doit être compris entre 1 et 12.")
    if request.day is not None and not 1 <= request.day <= 31:
        raise HTTPException(status_code=400, detail="Le jour doit être compris entre 1 et 31.")
    if request.year is not None and request.year < 1900:
        raise HTTPException(status_code=400, detail="L'année doit être valide.")

    output_dir = _resolve_scrape_output_dir(request.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    scrape_config = ScrapeConfig()
    if request.max_size_mb is not None:
        scrape_config.max_size_mb = request.max_size_mb
    if request.retries is not None:
        scrape_config.retries = request.retries
    if request.backoff is not None:
        scrape_config.backoff = request.backoff
    if request.connect_timeout is not None:
        scrape_config.connect_timeout = request.connect_timeout
    if request.read_timeout is not None:
        scrape_config.read_timeout = request.read_timeout
    if request.verify_ssl is not None:
        scrape_config.verify_ssl = request.verify_ssl

    scraper = MeteoBurkinaScraper(output_dir=str(output_dir), config=scrape_config)
    summary = await run_in_threadpool(
        scraper.scrape_all,
        request.use_pagination,
        request.year,
        request.month,
        request.day,
        request.max_pages,
        request.max_bulletins,
        request.delay,
    )
    return summary


@router.get("/scrape/manifest", response_model=ScrapeManifestResponse)
async def get_scrape_manifest(output_dir: Optional[str] = None):
    """Retourner le manifeste de scraping pour inspection."""
    manifest_dir = _resolve_scrape_output_dir(output_dir)
    manifest_path = manifest_dir / "scrape_manifest.json"
    if not manifest_path.exists():
        return {
            "output_dir": str(manifest_dir.resolve()),
            "exists": False,
            "manifest": {"version": 1, "items": {}},
        }
    try:
        store = ManifestStore(manifest_path)
        return {
            "output_dir": str(manifest_dir.resolve()),
            "exists": True,
            "manifest": store.data,
        }
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "code": ErrorCode.INTERNAL_SERVER_ERROR.value,
                "message": f"Unable to read manifest: {exc}",
            },
        )


@router.post("/upload-bulletin", response_model=Union[UploadResponse, UploadJobResponse])
async def upload_bulletin(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    async_job: bool = Query(False, alias="async"),
):
    """Téléverser un PDF de bulletin et exécuter l'extraction de température."""
    _ensure_services_ready()

    if not file.filename:
        raise HTTPException(
            status_code=400,
            detail={
                "code": ErrorCode.UPLOAD_INVALID.value,
                "message": "Nom de fichier manquant.",
            },
        )
    if file.content_type and "pdf" not in file.content_type.lower():
        raise HTTPException(
            status_code=400,
            detail={
                "code": ErrorCode.UPLOAD_INVALID.value,
                "message": "Le fichier doit être un PDF.",
            },
        )

    assert core.config is not None
    target_dir = core.config.pdf_directory
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = _sanitize_filename(file.filename)
    target_path = target_dir / filename

    data = await file.read()
    if not data:
        raise HTTPException(
            status_code=400,
            detail={
                "code": ErrorCode.UPLOAD_EMPTY.value,
                "message": "Le fichier est vide.",
            },
        )

    try:
        with open(target_path, "wb") as buffer:
            buffer.write(data)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "code": ErrorCode.UPLOAD_FAILED.value,
                "message": f"Impossible de sauvegarder le PDF : {exc}",
            },
        )

    def extraction_task():
        pdf_extractor = PDFExtractor(
            core.config.pdf_directory,
            core.config.output_directory
        )
        pdf_result = pdf_extractor.process_single_pdf(target_path)
        if not pdf_result:
            raise RuntimeError("Traitement PDF impossible (conversion ou detection).")
        
        temp_extractor = TemperatureExtractor(roi_config_path=core.config.roi_config_path)
        temperatures = temp_extractor.extract_temperatures([pdf_result])
        return _serialize_temperature_payload(temperatures)

    def _enqueue_job(job_id: str, filename_value: str, pdf_path_value: str):
        assert core.db_manager is not None

        def job_runner():
            try:
                core.db_manager.update_job(job_id, status="running")
                temperatures = extraction_task()
                result = {
                    "filename": filename_value,
                    "pdf_path": pdf_path_value,
                    "temperatures": temperatures,
                }
                core.db_manager.update_job(job_id, status="success", result=result)
            except Exception as exc:
                core.db_manager.update_job(job_id, status="error", error_message=str(exc))

        background_tasks.add_task(run_in_threadpool, job_runner)

    if async_job:
        assert core.db_manager is not None
        job_id = str(uuid.uuid4())
        core.db_manager.create_job(
            job_id,
            "upload_bulletin",
            {"filename": filename, "pdf_path": str(target_path)},
        )
        _enqueue_job(job_id, filename, str(target_path))
        response = {
            "job_id": job_id,
            "status": "pending",
            "filename": filename,
            "pdf_path": str(target_path),
        }
        return JSONResponse(content=response, status_code=202)

    try:
        temperatures = await run_in_threadpool(extraction_task)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "code": ErrorCode.OCR_FAILED.value,
                "message": f"Échec de l'extraction : {exc}",
            },
        )

    return {
        "filename": filename,
        "pdf_path": str(target_path),
        "temperatures": temperatures,
    }


@router.post("/upload-bulletins", response_model=UploadBatchResponse)
async def upload_bulletins(
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
):
    """Téléverser plusieurs bulletins (PDF ou ZIP) et les traiter de manière asynchrone."""
    _ensure_services_ready()
    assert core.config is not None and core.db_manager is not None

    batch_id = str(uuid.uuid4())
    jobs: List[UploadJobResponse] = []
    collected_paths: List[tuple[str, str]] = []

    def _save_bytes(filename_value: str, data: bytes) -> Optional[str]:
        if not data:
            return None
        target_dir = core.config.pdf_directory
        target_dir.mkdir(parents=True, exist_ok=True)
        filename_clean = _sanitize_filename(filename_value)
        target_path = target_dir / filename_clean
        try:
            with open(target_path, "wb") as buffer:
                buffer.write(data)
        except Exception:
            return None
        return str(target_path)

    for upload in files:
        if not upload.filename:
            continue
        raw = await upload.read()
        name_lower = upload.filename.lower()
        if name_lower.endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                    for member in archive.infolist():
                        if member.is_dir():
                            continue
                        member_name = Path(member.filename).name
                        if not member_name.lower().endswith(".pdf"):
                            continue
                        with archive.open(member) as handle:
                            content = handle.read()
                        saved = _save_bytes(member_name, content)
                        if saved:
                            collected_paths.append((member_name, saved))
            except Exception as exc:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": ErrorCode.UPLOAD_INVALID.value,
                        "message": f"Invalid zip archive: {exc}",
                    },
                )
        else:
            if upload.content_type and "pdf" not in upload.content_type.lower() and not name_lower.endswith(".pdf"):
                continue
            saved = _save_bytes(upload.filename, raw)
            if saved:
                collected_paths.append((upload.filename, saved))

    if not collected_paths:
        raise HTTPException(
            status_code=400,
            detail={
                "code": ErrorCode.UPLOAD_EMPTY.value,
                "message": "No PDF files to process.",
            },
        )

    job_ids: List[str] = []
    for original_name, pdf_path_value in collected_paths:
        job_id = str(uuid.uuid4())
        job_ids.append(job_id)
        filename_value = Path(pdf_path_value).name
        core.db_manager.create_job(
            job_id,
            "upload_bulletin",
            {"filename": filename_value, "pdf_path": pdf_path_value, "batch_id": batch_id},
        )
        def _make_job_runner(job_id_value: str, filename_value: str, pdf_path_value: str):
            def _run():
                try:
                    batch_job = core.db_manager.get_job(batch_id)
                    if batch_job and batch_job.get("status") == "canceled":
                        core.db_manager.update_job(job_id_value, status="canceled", error_message="Batch canceled.")
                        return
                    core.db_manager.update_job(job_id_value, status="running")
                    pdf_extractor = PDFExtractor(
                        core.config.pdf_directory,
                        core.config.output_directory
                    )
                    pdf_result = pdf_extractor.process_single_pdf(Path(pdf_path_value))
                    if not pdf_result:
                        raise RuntimeError("Traitement PDF impossible (conversion ou detection).")
                    temp_extractor = TemperatureExtractor(roi_config_path=core.config.roi_config_path)
                    temperatures = temp_extractor.extract_temperatures([pdf_result])
                    result = {
                        "filename": filename_value,
                        "pdf_path": pdf_path_value,
                        "temperatures": _serialize_temperature_payload(temperatures),
                    }
                    core.db_manager.update_job(job_id_value, status="success", result=result)
                except Exception as exc:
                    core.db_manager.update_job(job_id_value, status="error", error_message=str(exc))
            return _run

        background_tasks.add_task(
            run_in_threadpool,
            _make_job_runner(job_id, filename_value, pdf_path_value),
        )
        jobs.append(
            {
                "job_id": job_id,
                "status": "pending",
                "filename": filename_value,
                "pdf_path": pdf_path_value,
            }
        )

    core.db_manager.create_job(
        batch_id,
        "upload_batch",
        {"job_ids": job_ids, "total": len(job_ids)},
    )

    return {
        "batch_id": batch_id,
        "total": len(jobs),
        "jobs": jobs,
    }


@router.get("/upload-bulletin/jobs/{job_id}", response_model=UploadJobStatus)
async def get_upload_job(job_id: str = ApiPath(..., min_length=1)):
    _ensure_db_ready()
    assert core.db_manager is not None
    job = core.db_manager.get_job(job_id)
    if not job:
        raise HTTPException(
            status_code=404,
            detail={
                "code": ErrorCode.RESOURCE_NOT_FOUND.value,
                "message": "Job not found.",
            },
        )
    payload = job.get("payload") or {}
    result = job.get("result")
    response = {
        "job_id": job.get("id"),
        "status": job.get("status"),
        "filename": payload.get("filename"),
        "pdf_path": payload.get("pdf_path"),
        "result": result,
        "error_message": job.get("error_message"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
    }
    return response


@router.get("/upload-bulletins/batches/{batch_id}", response_model=UploadBatchStatus)
async def get_upload_batch(batch_id: str = ApiPath(..., min_length=1)):
    _ensure_db_ready()
    assert core.db_manager is not None
    batch = core.db_manager.get_job(batch_id)
    if not batch or batch.get("job_type") != "upload_batch":
        raise HTTPException(
            status_code=404,
            detail={
                "code": ErrorCode.RESOURCE_NOT_FOUND.value,
                "message": "Batch not found.",
            },
        )
    payload = batch.get("payload") or {}
    job_ids = payload.get("job_ids") or []
    jobs_raw = core.db_manager.get_jobs(job_ids)
    jobs_map = {job["id"]: job for job in jobs_raw}
    jobs: List[UploadJobStatus] = []
    counts = {"pending": 0, "running": 0, "success": 0, "error": 0, "canceled": 0}
    for job_id in job_ids:
        job = jobs_map.get(job_id)
        if not job:
            continue
        job_payload = job.get("payload") or {}
        status = job.get("status") or "pending"
        if status in counts:
            counts[status] += 1
        else:
            counts["pending"] += 1
        jobs.append(
            {
                "job_id": job_id,
                "status": status,
                "filename": job_payload.get("filename"),
                "pdf_path": job_payload.get("pdf_path"),
                "result": job.get("result"),
                "error_message": job.get("error_message"),
                "created_at": job.get("created_at"),
                "updated_at": job.get("updated_at"),
            }
        )

    overall_status = "pending"
    batch_status = batch.get("status")
    if batch_status == "canceled":
        overall_status = "canceled"
    if counts["running"] > 0:
        overall_status = "running"
    elif counts["error"] > 0 and counts["success"] == 0:
        overall_status = "error"
    elif counts["success"] == len(job_ids):
        overall_status = "success"
    elif counts["error"] > 0:
        overall_status = "partial"

    return {
        "batch_id": batch_id,
        "status": overall_status,
        "total": len(job_ids),
        "pending": counts["pending"],
        "running": counts["running"],
        "success": counts["success"],
        "error": counts["error"],
        "canceled": counts["canceled"],
        "jobs": jobs,
    }


@router.post("/upload-bulletins/batches/{batch_id}/stop")
async def stop_upload_batch(batch_id: str = ApiPath(..., min_length=1)):
    _ensure_db_ready()
    assert core.db_manager is not None
    batch = core.db_manager.get_job(batch_id)
    if not batch or batch.get("job_type") != "upload_batch":
        raise HTTPException(
            status_code=404,
            detail={
                "code": ErrorCode.RESOURCE_NOT_FOUND.value,
                "message": "Batch not found.",
            },
        )
    core.db_manager.update_job(batch_id, status="canceled", error_message="Canceled by user.")
    payload = batch.get("payload") or {}
    job_ids = payload.get("job_ids") or []
    jobs = core.db_manager.get_jobs(job_ids)
    for job in jobs:
        if job.get("status") == "pending":
            core.db_manager.update_job(job.get("id"), status="canceled", error_message="Batch canceled.")
    return {"batch_id": batch_id, "status": "canceled"}


@router.get("/files/{category}/{filename}")
async def serve_file(category: str, filename: str):
    """Serve files from temp directories (maps, pdf_images)."""
    if not core.config:
        raise HTTPException(status_code=500, detail="Config not initialized")
    
    if ".." in filename or "/" in filename or "\\" in filename:
         raise HTTPException(status_code=400, detail="Invalid filename")

    base_path = core.config.output_directory / "temp"
    if category == "maps":
        file_path = base_path / "maps" / filename
    elif category == "pdf_images":
        file_path = base_path / "pdf_images" / filename
    else:
        raise HTTPException(status_code=400, detail="Invalid category")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(file_path)
