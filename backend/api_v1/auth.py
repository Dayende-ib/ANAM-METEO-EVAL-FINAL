from typing import Optional
from fastapi import APIRouter, Header, HTTPException

from backend.api_v1.models import LoginRequest, LoginResponse, MeResponse
import backend.api_v1.core as core
from backend.api_v1.core import (
    _generate_token,
    _get_current_user,
    _ensure_auth_config,
    _get_auth_users,
    ErrorCode
)

router = APIRouter(tags=["auth"])

@router.post("/auth/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """Return a signed token valid for 30 days for the configured user."""
    _ensure_auth_config()
    identifier = (request.email or request.username or "").strip()
    if not identifier:
        raise HTTPException(
            status_code=401,
            detail={
                "code": ErrorCode.AUTH_INVALID.value,
                "message": "Invalid credentials.",
            },
        )
    if core.db_manager is not None:
        user = core.db_manager.get_auth_user_by_email(identifier)
        if user:
            if core.db_manager._verify_password(request.password, user.get("password_hash", "")):
                token, expires_at = _generate_token(identifier)
                return {"access_token": token, "token_type": "bearer", "expires_at": expires_at}
            raise HTTPException(
                status_code=401,
                detail={
                    "code": ErrorCode.AUTH_INVALID.value,
                    "message": "Invalid credentials.",
                },
            )
    users = _get_auth_users()
    if identifier not in users or request.password != users.get(identifier):
        raise HTTPException(
            status_code=401,
            detail={
                "code": ErrorCode.AUTH_INVALID.value,
                "message": "Invalid credentials.",
            },
        )
    token, expires_at = _generate_token(identifier)
    return {"access_token": token, "token_type": "bearer", "expires_at": expires_at}


@router.get("/auth/me", response_model=MeResponse)
async def auth_me(authorization: Optional[str] = Header(None)):
    """Validate the provided token and return the current user."""
    username, expires_at = _get_current_user(authorization)
    return {"username": username, "expires_at": expires_at}
