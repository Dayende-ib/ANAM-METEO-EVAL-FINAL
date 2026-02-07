from typing import Optional
import sqlite3
from fastapi import APIRouter, Header, HTTPException

from backend.api_v1.models import (
    LoginRequest,
    LoginResponse,
    MeResponse,
    AuthUserCreateRequest,
    AuthUserUpdateRequest,
    AuthUserItem,
    AuthUsersPage,
)
import backend.api_v1.core as core
from backend.api_v1.core import (
    _generate_token,
    _get_current_user,
    _ensure_db_ready,
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


def _require_auth(authorization: Optional[str]):
    return _get_current_user(authorization)


@router.get("/auth/users", response_model=AuthUsersPage)
async def list_auth_users(
    authorization: Optional[str] = Header(None),
    limit: int = 50,
    offset: int = 0,
):
    _ensure_db_ready()
    _require_auth(authorization)
    assert core.db_manager is not None
    items = core.db_manager.list_auth_users(limit=limit, offset=offset)
    total = core.db_manager.count_auth_users()
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.post("/auth/users", response_model=AuthUserItem, status_code=201)
async def create_auth_user(
    payload: AuthUserCreateRequest,
    authorization: Optional[str] = Header(None),
):
    _ensure_db_ready()
    _require_auth(authorization)
    assert core.db_manager is not None
    try:
        user = core.db_manager.create_auth_user(payload.name.strip(), payload.email.strip(), payload.password)
    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=409,
            detail={
                "code": ErrorCode.CONFLICT.value,
                "message": "Email already exists.",
            },
        )
    return {
        "id": user.get("id"),
        "name": user.get("name"),
        "email": user.get("email"),
        "created_at": user.get("created_at"),
        "updated_at": user.get("updated_at"),
    }


@router.patch("/auth/users/{user_id}", response_model=AuthUserItem)
async def update_auth_user(
    user_id: int,
    payload: AuthUserUpdateRequest,
    authorization: Optional[str] = Header(None),
):
    _ensure_db_ready()
    _require_auth(authorization)
    assert core.db_manager is not None
    if payload.name is None and payload.email is None and payload.password is None:
        raise HTTPException(
            status_code=400,
            detail={
                "code": ErrorCode.VALIDATION_ERROR.value,
                "message": "No updates provided.",
            },
        )
    try:
        user = core.db_manager.update_auth_user(
            user_id,
            name=payload.name.strip() if payload.name is not None else None,
            email=payload.email.strip() if payload.email is not None else None,
            password=payload.password,
        )
    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=409,
            detail={
                "code": ErrorCode.CONFLICT.value,
                "message": "Email already exists.",
            },
        )
    if not user:
        raise HTTPException(
            status_code=404,
            detail={
                "code": ErrorCode.RESOURCE_NOT_FOUND.value,
                "message": "User not found.",
            },
        )
    return {
        "id": user.get("id"),
        "name": user.get("name"),
        "email": user.get("email"),
        "created_at": user.get("created_at"),
        "updated_at": user.get("updated_at"),
    }


@router.delete("/auth/users/{user_id}")
async def delete_auth_user(
    user_id: int,
    authorization: Optional[str] = Header(None),
):
    _ensure_db_ready()
    _require_auth(authorization)
    assert core.db_manager is not None
    deleted = core.db_manager.delete_auth_user(user_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail={
                "code": ErrorCode.RESOURCE_NOT_FOUND.value,
                "message": "User not found.",
            },
        )
    return {"deleted": True}
