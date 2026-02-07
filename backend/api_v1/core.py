import base64
import hashlib
import hmac
import json
import logging
import os
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from fastapi import HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from backend.api_errors import (
    AppError,
    ErrorCode,
    error_payload,
    parse_error_detail,
    status_to_code,
)
from backend.utils.config import Config
from backend.utils.database import DatabaseManager

# Global state
config: Optional[Config] = None
db_manager: Optional[DatabaseManager] = None
result_file: Optional[Path] = None

# Security/Auth constants
AUTH_SECRET = os.getenv("AUTH_SECRET", "change-this-secret")
AUTH_USERNAME = os.getenv("AUTH_USERNAME")
AUTH_PASSWORD = os.getenv("AUTH_PASSWORD")
AUTH_USERS = os.getenv("AUTH_USERS")
TOKEN_VALIDITY_SECONDS = 30 * 24 * 60 * 60  # 30 days

# Pipeline/API constants
AUTO_PIPELINE_ENABLED = os.getenv("AUTO_PIPELINE_ENABLED", "1").lower() in {"1", "true", "yes"}
AUTO_PIPELINE_INTERVAL_SECONDS = int(os.getenv("AUTO_PIPELINE_INTERVAL_SECONDS", "3600"))
AUTO_PIPELINE_STATE_KEY = "auto_pipeline_last_date"
API_CACHE_TTL_SECONDS = int(os.getenv("API_CACHE_TTL_SECONDS", "30"))
TEMP_RETENTION_STATE_KEY = "temp_file_retention_days"
TRACE_ID_HEADER = "X-Trace-Id"

logger = logging.getLogger("anam.api")

def log_event(level: int, event: str, **fields: Any) -> None:
    payload = {
        "event": event,
        "level": logging.getLevelName(level),
        "ts": datetime.utcnow().isoformat(),
    }
    payload.update(fields)
    logger.log(level, json.dumps(payload, ensure_ascii=True))

def _get_trace_id(request: Request) -> str:
    trace_id = getattr(request.state, "trace_id", None)
    if trace_id:
        return trace_id
    return request.headers.get(TRACE_ID_HEADER) or str(uuid.uuid4())

# Exception Handlers
async def app_error_handler(request: Request, exc: AppError):
    trace_id = _get_trace_id(request)
    payload = error_payload(
        status=exc.status,
        code=exc.code,
        message=exc.message,
        trace_id=trace_id,
        details=exc.details,
    )
    log_event(logging.WARNING, "app_error", traceId=trace_id, code=exc.code, status=exc.status)
    return JSONResponse(status_code=exc.status, content=payload, headers={TRACE_ID_HEADER: trace_id})

async def http_error_handler(request: Request, exc: HTTPException):
    trace_id = _get_trace_id(request)
    detail_code, message, details = parse_error_detail(exc.detail)
    code = detail_code or status_to_code(exc.status_code)
    payload = error_payload(
        status=exc.status_code,
        code=code,
        message=message,
        trace_id=trace_id,
        details=details,
    )
    log_event(logging.WARNING, "http_error", traceId=trace_id, code=code, status=exc.status_code)
    return JSONResponse(status_code=exc.status_code, content=payload, headers={TRACE_ID_HEADER: trace_id})

async def validation_error_handler(request: Request, exc: RequestValidationError):
    trace_id = _get_trace_id(request)
    encoded_errors = jsonable_encoder(exc.errors())
    payload = error_payload(
        status=422,
        code=ErrorCode.VALIDATION_ERROR.value,
        message="Échec de la validation.",
        trace_id=trace_id,
        details={"errors": encoded_errors},
    )
    log_event(logging.WARNING, "validation_error", traceId=trace_id, status=422)
    return JSONResponse(status_code=422, content=payload, headers={TRACE_ID_HEADER: trace_id})

async def unhandled_error_handler(request: Request, exc: Exception):
    trace_id = _get_trace_id(request)
    payload = error_payload(
        status=500,
        code=ErrorCode.INTERNAL_SERVER_ERROR.value,
        message="Erreur inattendue.",
        trace_id=trace_id,
        details={},
    )
    log_event(logging.ERROR, "unhandled_error", traceId=trace_id, status=500, error=str(exc))
    return JSONResponse(status_code=500, content=payload, headers={TRACE_ID_HEADER: trace_id})

def _generate_token(username: str):
    expires_at = int(time.time()) + TOKEN_VALIDITY_SECONDS
    payload = {"u": username, "exp": expires_at}
    encoded_payload = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")).decode("utf-8").rstrip("=")
    signature = hmac.new(AUTH_SECRET.encode("utf-8"), encoded_payload.encode("utf-8"), hashlib.sha256).hexdigest()
    token = f"{encoded_payload}.{signature}"
    return token, expires_at


# Auth Helpers
def _decode_token(token: str) -> dict:
    try:
        payload_b64, signature = token.split(".", 1)
    except ValueError:
        raise HTTPException(status_code=401, detail="Format de token invalide.")
    expected_signature = hmac.new(AUTH_SECRET.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected_signature):
        raise HTTPException(status_code=401, detail="Signature de token invalide.")
    padded = payload_b64 + "=" * (-len(payload_b64) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
        return json.loads(decoded)
    except Exception:
        raise HTTPException(status_code=401, detail="Decodage du token impossible.")

def _verify_token(token: str) -> Tuple[str, int]:
    data = _decode_token(token)
    username = data.get("u")
    expires_at = data.get("exp")
    if not username or not expires_at:
        raise HTTPException(status_code=401, detail="Token incomplet.")
    if int(expires_at) < int(time.time()):
        raise HTTPException(status_code=401, detail="Token expire.")
    return username, int(expires_at)

def _get_current_user(authorization: Optional[str]) -> Tuple[str, int]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Token manquant.")
    token = authorization.split(" ", 1)[1].strip()
    return _verify_token(token)

def _ensure_db_ready():
    if db_manager is None:
        raise HTTPException(
            status_code=503,
            detail={
                "code": ErrorCode.DATABASE_UNAVAILABLE.value,
                "message": "Database not initialized.",
            },
        )

def _ensure_services_ready():
    if config is None or db_manager is None:
        raise HTTPException(
            status_code=503,
            detail={
                "code": ErrorCode.SERVICE_UNAVAILABLE.value,
                "message": "Services not initialized.",
            },
        )

def _get_auth_users() -> Dict[str, str]:
    users: Dict[str, str] = {}
    auth_users = os.getenv("AUTH_USERS") or AUTH_USERS
    if auth_users:
        for entry in auth_users.split(","):
            entry = entry.strip()
            if not entry:
                continue
            if ":" not in entry:
                continue
            username, password = entry.split(":", 1)
            username = username.strip()
            password = password.strip()
            if username and password:
                users[username] = password
    auth_username = os.getenv("AUTH_USERNAME") or AUTH_USERNAME
    auth_password = os.getenv("AUTH_PASSWORD") or AUTH_PASSWORD
    if auth_username and auth_password:
        users.setdefault(auth_username, auth_password)
    return users

def _ensure_auth_config():
    has_db_users = False
    if db_manager is not None:
        try:
            has_db_users = db_manager.count_auth_users() > 0
        except Exception:
            has_db_users = False
    if not _get_auth_users() and not has_db_users:
        raise HTTPException(
            status_code=500,
            detail={
                "code": ErrorCode.AUTH_CONFIG_MISSING.value,
                "message": "AUTH_USERNAME/AUTH_PASSWORD or AUTH_USERS must be set.",
            },
        )
