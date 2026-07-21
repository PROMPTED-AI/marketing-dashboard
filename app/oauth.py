"""Helpers around the Google OAuth 2.0 Authorization Code flow."""
from datetime import datetime

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow

from . import config


def revoke(creds: Credentials) -> None:
    """Best-effort: revoke the Google grant (refresh token) for this account.

    Revoking the refresh token invalidates the whole grant for our client, so
    only call this when removing the last Google connection of an org.
    """
    token = creds.refresh_token or creds.token
    if not token:
        return
    try:
        requests.post(
            "https://oauth2.googleapis.com/revoke",
            params={"token": token},
            headers={"content-type": "application/x-www-form-urlencoded"},
            timeout=10,
        )
    except requests.RequestException:
        pass


def fetch_user_email(creds: Credentials) -> str:
    """Return the email of the account that just authorized (their identity)."""
    resp = requests.get(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        headers={"Authorization": f"Bearer {creds.token}"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["email"]


def build_flow(scopes: list[str], state: str | None = None) -> Flow:
    """Create an OAuth Flow bound to our client config and redirect URI."""
    flow = Flow.from_client_config(
        config.CLIENT_CONFIG,
        scopes=scopes,
        state=state,
    )
    flow.redirect_uri = config.REDIRECT_URI
    return flow


def build_authorization_url(
    scopes: list[str],
    access_type: str = "offline",
    prompt: str = "consent",
) -> tuple[str, str, str]:
    """Return (authorization_url, state, code_verifier) for the requested scopes.

    ``include_granted_scopes=true`` enables incremental authorization, so each
    tool adds its scope on top of what the user already granted. The PKCE
    ``code_verifier`` must be kept (in the session) and handed back to
    :func:`exchange_code`.
    """
    flow = build_flow(scopes)
    authorization_url, state = flow.authorization_url(
        access_type=access_type,
        include_granted_scopes="true",
        prompt=prompt,
    )
    return authorization_url, state, flow.code_verifier


def exchange_code(
    state: str,
    authorization_response_url: str,
    code_verifier: str | None = None,
) -> Credentials:
    """Exchange the ?code=... callback for user Credentials.

    The flow carries the scope superset; oauthlib's scope check is relaxed
    (see config) so the actually-granted subset is accepted.
    """
    flow = build_flow(config.ALL_SCOPES, state=state)
    flow.code_verifier = code_verifier
    flow.fetch_token(authorization_response=authorization_response_url)
    return flow.credentials


def credentials_to_dict(creds: Credentials) -> dict:
    """Serialize Credentials for storage (keep the refresh_token + expiry!).

    `expiry` is essential: without it a rebuilt Credentials object has
    ``expiry = None``, which google-auth treats as "never expires" — so it keeps
    handing Google a long-dead access token (HTTP 401 UNAUTHENTICATED) and never
    refreshes. Persisting expiry lets the standard refresh logic kick in.
    """
    return {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": creds.scopes,
        "expiry": creds.expiry.isoformat() if creds.expiry else None,
    }


def credentials_from_dict(data: dict) -> Credentials:
    """Rebuild Credentials from storage and refresh the access token if needed.

    De opgeslagen scopes gaan bewust NIET mee in het Credentials-object: bij
    het verversen stuurt google-auth ze anders als scope-parameter naar het
    token-endpoint, en Google weigert dat verzoek met invalid_scope zodra het
    refresh-token die scopes niet (meer) exact draagt (bijvoorbeeld na een
    herkoppeling met andere vinkjes in het toestemmingsscherm). Zonder
    scope-parameter geeft Google gewoon een token met alles wat het
    refresh-token wél heeft; mist er echt een recht, dan geeft de API-call
    zelf een duidelijke 403 en tonen we de herkoppel-melding.
    """
    data = dict(data)
    expiry = data.pop("expiry", None)
    data.pop("scopes", None)
    creds = Credentials(**data)
    if expiry:
        try:
            creds.expiry = datetime.fromisoformat(expiry)
        except (TypeError, ValueError):
            creds.expiry = None
    # Refresh when the token is stale. If the expiry is unknown (connections
    # stored before expiry was persisted), refresh proactively so an
    # already-expired token never reaches Google — this self-heals old grants.
    if creds.refresh_token and (not creds.valid or not creds.expiry):
        creds.refresh(Request())
    return creds
