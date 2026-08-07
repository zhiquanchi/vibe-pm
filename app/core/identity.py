"""Small development identity layer used until real authentication is added."""

from fastapi import Header


def current_user_id(x_user_id: str | None = Header(default=None, alias="X-User-Id")) -> str:
    """Return the caller id from the development header, defaulting to demo-user."""
    return (x_user_id or "demo-user").strip() or "demo-user"
