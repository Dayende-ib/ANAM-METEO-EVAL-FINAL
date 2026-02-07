#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Serveur API pour le système ANAM-METEO-EVAL
Point d'entrée principal regroupant les différents routeurs.
"""

import asyncio
import logging
import os
import time
import uuid
from datetime import datetime
from pathlib import Path

import uvicorn
try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError

# Imports locaux
from backend.api_errors import AppError
import backend.api_v1.core as core
from backend.api_v1.core import (
    app_error_handler,
    http_error_handler,
    validation_error_handler,
    unhandled_error_handler,
    log_event,
    TRACE_ID_HEADER
)
from backend.utils.config import Config
from backend.utils.database import DatabaseManager

# Import des routeurs
from backend.api_v1.auth import router as auth_router
from backend.api_v1.bulletins import router as bulletins_router
from backend.api_v1.pipeline import router as pipeline_router, _auto_pipeline_worker
from backend.api_v1.metrics import router as metrics_router
from backend.api_v1.data_management import router as data_management_router
from backend.api_v1.validation import router as validation_router

# Chargement de l'environnement
if load_dotenv is not None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if env_path.exists():
        load_dotenv(env_path, override=False)

# Configuration de l'application
app = FastAPI(title="ANAM-METEO-EVAL API", description="API for meteorological forecast evaluation system")

# Logging
def configure_logging() -> None:
    root = logging.getLogger()
    level_name = os.getenv("BACKEND_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    if not root.handlers:
        logging.basicConfig(level=level, format="%(message)s")
    else:
        root.setLevel(level)

configure_logging()

# Middlewares
@app.middleware("http")
async def api_prefix_middleware(request: Request, call_next):
    """Autoriser le préfixe /api pour la compatibilité avec les proxys/frontend."""
    path = request.scope.get("path", "")
    if path == "/api":
        request.scope["path"] = "/"
    elif path.startswith("/api/") and not path.startswith("/api/v"):
        request.scope["path"] = path[4:]
    return await call_next(request)

@app.middleware("http")
async def trace_id_middleware(request: Request, call_next):
    trace_id = request.headers.get(TRACE_ID_HEADER) or str(uuid.uuid4())
    request.state.trace_id = trace_id
    start = time.perf_counter()
    response = await call_next(request)
    response.headers.setdefault(TRACE_ID_HEADER, trace_id)
    duration_ms = int((time.perf_counter() - start) * 1000)
    log_event(
        logging.INFO,
        "http_request",
        traceId=trace_id,
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        duration_ms=duration_ms,
    )
    return response

# CORS
default_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
cors_origins = os.getenv("CORS_ALLOWED_ORIGINS")
if cors_origins:
    origins = [origin.strip() for origin in cors_origins.split(",") if origin.strip()]
else:
    origins = default_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Handlers d'exceptions
app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(HTTPException, http_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)
app.add_exception_handler(Exception, unhandled_error_handler)

# Cycle de vie
@app.on_event("startup")
async def startup_event():
    """Initialiser la configuration et la base de données au démarrage."""
    core.config = Config()
    core.db_manager = DatabaseManager(core.config.db_path)
    core.db_manager.initialize_database()
    core.result_file = core.config.output_directory / "resultats_interpretes.json"
    
    # Note : Le modèle NLLB sera chargé à la demande (lazy loading) pour économiser la RAM au démarrage

    if core.AUTO_PIPELINE_ENABLED:
        app.state.auto_pipeline_task = asyncio.create_task(_auto_pipeline_worker())
    
    # Nettoyer périodiquement les anciennes tâches de traduction
    async def _cleanup_old_tasks():
        """Nettoie les tâches terminées depuis plus d'1 heure."""
        from backend.utils.background_tasks import get_task_manager
        while True:
            await asyncio.sleep(3600)  # Toutes les heures
            try:
                task_manager = get_task_manager()
                task_manager.cleanup_old_tasks(max_age_seconds=3600)
            except Exception as exc:
                core.logger.warning(f"Erreur lors du nettoyage des tâches : {exc}")
    
    app.state.cleanup_task = asyncio.create_task(_cleanup_old_tasks())

@app.on_event("shutdown")
async def shutdown_event():
    """Fermer les connexions à l'arrêt."""
    auto_task = getattr(app.state, "auto_pipeline_task", None)
    if auto_task:
        auto_task.cancel()
    cleanup_task = getattr(app.state, "cleanup_task", None)
    if cleanup_task:
        cleanup_task.cancel()
    if core.db_manager:
        core.db_manager.close()
    
    # Arrêter proprement le gestionnaire de tâches en arrière-plan
    from backend.utils.background_tasks import shutdown_task_manager
    shutdown_task_manager()

# Routes de base
@app.get("/")
async def root():
    return {"message": "ANAM-METEO-EVAL API", "version": "1.0"}

@app.get("/health")
async def health():
    checks = {"config": core.config is not None, "database": False}
    if core.db_manager is not None:
        try:
            conn = core.db_manager.get_connection()
            conn.execute("SELECT 1")
            checks["database"] = True
        except Exception:
            pass
    status = "ok" if all(checks.values()) else "degraded"
    return {"status": status, "checks": checks}

# Inclusion des routeurs V1
from fastapi import APIRouter
api_v1_router = APIRouter(prefix="/api/v1")
api_v1_router.include_router(auth_router)
api_v1_router.include_router(bulletins_router)
api_v1_router.include_router(pipeline_router)
api_v1_router.include_router(metrics_router)
api_v1_router.include_router(data_management_router)
api_v1_router.include_router(validation_router)

app.include_router(api_v1_router)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
