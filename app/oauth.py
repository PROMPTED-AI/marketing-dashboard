"""Helpers around the Google OAuth 2.0 Authorization Code flow."""
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow

from . import config


def build_flow(state: str | None = None) -> Flow:
    """Create an OAuth Flow bound to our client config and redirect URI."""
    flow = Flow.from_client_config(
        config.CLIENT_CONFIG,
        scopes=config.SCOPES,
        state=state,
    )
    flow.redirect_uri = config.REDIRECT_URI
    return flow


def build_authorization_url() -> tuple[str, str, str]:
    """Return (authorization_url, state, code_verifier) for the login redirect.

    ``access_type=offline`` + ``prompt=consent`` ensures we receive a
    refresh token. The PKCE ``code_verifier`` must be kept (in the session)
    and handed back to :func:`exchange_code`, otherwise Google rejects the
    token exchange with "Missing code verifier".
    """
    flow = build_flow()
    authorization_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    return authorization_url, state, flow.code_verifier


def exchange_code(
    state: str,
    authorization_response_url: str,
    code_verifier: str | None = None,
) -> Credentials:
    """Exchange the ?code=... callback for user Credentials."""
    flow = build_flow(state=state)
    flow.code_verifier = code_verifier
    flow.fetch_token(authorization_response=authorization_response_url)
    return flow.credentials


def credentials_to_dict(creds: Credentials) -> dict:
    """Serialize Credentials for storage (keep the refresh_token!)."""
    return {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": creds.scopes,
    }


def credentials_from_dict(data: dict) -> Credentials:
    """Rebuild Credentials from storage and refresh the access token if needed."""
    creds = Credentials(**data)
    if not creds.valid and creds.refresh_token:
        creds.refresh(Request())
    return creds
