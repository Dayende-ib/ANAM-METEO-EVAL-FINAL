from __future__ import annotations

from enum import Enum
from typing import Any, Dict, Optional, Tuple


class ErrorCode(str, Enum):
    BAD_REQUEST = "DEMANDE_INCORRECTE"
    UNAUTHORIZED = "NON_AUTORISE"
    FORBIDDEN = "INTERDIT"
    RESOURCE_NOT_FOUND = "RESSOURCE_NON_TROUVEE"
    CONFLICT = "CONFLIT"
    VALIDATION_ERROR = "ERREUR_VALIDATION"
    RATE_LIMITED = "TAUX_LIMITE"
    REQUEST_TIMEOUT = "DELAI_DEMANDE_DEPASSE"
    INTERNAL_SERVER_ERROR = "ERREUR_SERVEUR_INTERNE"
    NOT_IMPLEMENTED = "NON_IMPLANTE"
    SERVICE_UNAVAILABLE = "SERVICE_INDISPONIBLE"
    DATABASE_UNAVAILABLE = "BASE_DONNEES_INDISPONIBLE"
    AUTH_CONFIG_MISSING = "CONFIG_AUTH_MANQUANTE"
    AUTH_INVALID = "AUTH_NON_VALIDE"
    PIPELINE_ALREADY_RUNNING = "PIPELINE_DEJA_EN_COURS"
    PIPELINE_RUN_NOT_FOUND = "EXECUTION_PIPELINE_NON_TROUVEE"
    PIPELINE_FAILED = "ECHEC_PIPELINE"
    OCR_FAILED = "ECHEC_OCR"
    ROBOFLOW_UNAVAILABLE = "ROBOFLOW_INDISPONIBLE"
    UPLOAD_INVALID = "TELEVERSEMENT_INVALIDE"
    UPLOAD_EMPTY = "TELEVERSEMENT_VIDE"
    UPLOAD_FAILED = "ECHEC_TELEVERSEMENT"
    BULLETIN_NOT_FOUND = "BULLETIN_NON_TROUVE"
    METRICS_NOT_FOUND = "METRIQUES_NON_TROUVEES"


class AppError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status: int = 400,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details or {}


def status_to_code(status: int) -> str:
    mapping = {
        400: ErrorCode.BAD_REQUEST.value,
        401: ErrorCode.UNAUTHORIZED.value,
        403: ErrorCode.FORBIDDEN.value,
        404: ErrorCode.RESOURCE_NOT_FOUND.value,
        409: ErrorCode.CONFLICT.value,
        422: ErrorCode.VALIDATION_ERROR.value,
        429: ErrorCode.RATE_LIMITED.value,
        408: ErrorCode.REQUEST_TIMEOUT.value,
        500: ErrorCode.INTERNAL_SERVER_ERROR.value,
        501: ErrorCode.NOT_IMPLEMENTED.value,
        503: ErrorCode.SERVICE_UNAVAILABLE.value,
    }
    return mapping.get(status, ErrorCode.INTERNAL_SERVER_ERROR.value)


def parse_error_detail(detail: Any) -> Tuple[Optional[str], str, Dict[str, Any]]:
    if isinstance(detail, dict):
        code = detail.get("code")
        message = detail.get("message") or detail.get("detail") or "Request failed."
        details = detail.get("details") or {}
        return code, message, details
    if detail is None:
        return None, "Request failed.", {}
    return None, str(detail), {}


def error_payload(
    *,
    status: int,
    code: str,
    message: str,
    trace_id: str,
    details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "success": False,
        "error": {
            "code": code,
            "message": message,
            "status": status,
            "traceId": trace_id,
            "details": details or {},
        },
    }
