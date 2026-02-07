from typing import Optional
from fastapi import APIRouter, Header, HTTPException

from backend.api_v1.models import LoginRequest, LoginResponse, MeResponse
from backend.api_v1.core import (
    AUTH_USERNAME,
    AUTH_PASSWORD,
    _generate_token,
    _get_current_user,
    _ensure_auth_config,
    ErrorCode
)

router = APIRouter(tags=["auth"])

@router.post("/auth/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """Return a signed token valid for 30 days for the configured user."""
    _ensure_auth_config()
    if request.username != AUTH_USERNAME or request.password != AUTH_PASSWORD:
        raise HTTPException(
            status_code=401,
            detail={
                "code": ErrorCode.AUTH_INVALID.value,
                "message": "Invalid credentials.",
            },
        )
    token, expires_at = _generate_token(request.username)
    return {"access_token": token, "token_type": "bearer", "expires_at": expires_at}


@router.get("/auth/me", response_model=MeResponse)
async def auth_me(authorization: Optional[str] = Header(None)):
    """Validate the provided token and return the current user."""
    username, expires_at = _get_current_user(authorization)
    return {"username": username, "expires_at": expires_at}
