"""Facebook Login (OAuth 2.0) helpers for the Meta integration.

This is a separate flow from Google: Meta uses Facebook Login + the Graph API.
We exchange the callback code for a short-lived user token and immediately swap
it for a long-lived token (~60 days), then store that (encrypted) per org.
"""
from datetime import datetime, timedelta

import requests

from . import config


def _graph(path: str) -> str:
    return f"https://graph.facebook.com/{config.META_GRAPH_VERSION}/{path}"


def build_login_url(state: str) -> str:
    """The Facebook Login dialog URL for the configured scopes."""
    from urllib.parse import urlencode

    params = {
        "client_id": config.META_APP_ID,
        "redirect_uri": config.META_REDIRECT_URI,
        "state": state,
        "response_type": "code",
        "scope": ",".join(config.META_SCOPES),
    }
    return f"https://www.facebook.com/{config.META_GRAPH_VERSION}/dialog/oauth?{urlencode(params)}"


def _token_expiry(expires_in) -> str | None:
    try:
        secs = int(expires_in)
    except (TypeError, ValueError):
        return None
    return (datetime.utcnow() + timedelta(seconds=secs)).isoformat()


def exchange_code(code: str) -> dict:
    """Exchange the callback ?code= for a long-lived user access token.

    Returns a creds dict ready for encrypted storage:
    {access_token, expiry (ISO or None)}.
    """
    short = requests.get(
        _graph("oauth/access_token"),
        params={
            "client_id": config.META_APP_ID,
            "client_secret": config.META_APP_SECRET,
            "redirect_uri": config.META_REDIRECT_URI,
            "code": code,
        },
        timeout=15,
    )
    short.raise_for_status()
    short_token = short.json().get("access_token")

    # Swap the short-lived token for a long-lived one (~60 days).
    long = requests.get(
        _graph("oauth/access_token"),
        params={
            "grant_type": "fb_exchange_token",
            "client_id": config.META_APP_ID,
            "client_secret": config.META_APP_SECRET,
            "fb_exchange_token": short_token,
        },
        timeout=15,
    )
    long.raise_for_status()
    data = long.json()
    return {
        "access_token": data.get("access_token", short_token),
        "expiry": _token_expiry(data.get("expires_in")),
    }


def fetch_identity(access_token: str) -> str:
    """Name (or email) of the Meta user who authorized — used as the label."""
    resp = requests.get(
        _graph("me"),
        params={"fields": "name", "access_token": access_token},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json().get("name") or "Meta-account"


def is_expired(creds: dict) -> bool:
    """True if the stored long-lived token is past its expiry."""
    expiry = creds.get("expiry")
    if not expiry:
        return False
    try:
        return datetime.utcnow() >= datetime.fromisoformat(expiry)
    except (TypeError, ValueError):
        return False
