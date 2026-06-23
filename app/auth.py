"""Session-based current-user and role helpers."""
from fastapi import HTTPException, Request

from . import config, models


def is_agency_admin(email: str) -> bool:
    return email.lower() in config.AGENCY_ADMIN_EMAILS


def role_for(email: str) -> str:
    return "agency_admin" if is_agency_admin(email) else "client"


def current_user(request: Request) -> dict:
    """Return the signed-in user, or raise 401."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not signed in")
    user = models.get_user(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Unknown session")
    return user


def require_admin(request: Request) -> dict:
    user = current_user(request)
    if user["role"] != "agency_admin":
        raise HTTPException(status_code=403, detail="Agency admin only")
    return user
