"""Application configuration loaded from environment variables."""
import os

from dotenv import load_dotenv

load_dotenv()

# Google may return extra granted scopes (e.g. openid) on top of the ones we
# request; relax oauthlib so that does not raise a "scope has changed" error.
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

# Sign-in only needs the user's identity (email). Data scopes are requested
# incrementally, per tool, when the user actually connects that tool.
LOGIN_SCOPES = ["https://www.googleapis.com/auth/userinfo.email"]

# Per-tool scopes, requested when connecting that specific provider.
PROVIDER_SCOPES = {
    "google_analytics": ["https://www.googleapis.com/auth/analytics.readonly"],
    "search_console": ["https://www.googleapis.com/auth/webmasters.readonly"],
}
GOOGLE_PROVIDERS = list(PROVIDER_SCOPES.keys())
PLACEHOLDER_PROVIDERS = ["google_ads", "meta_ads"]

# Union used when exchanging the auth code (oauthlib's scope check is relaxed,
# so the flow object can carry the superset regardless of what was requested).
ALL_SCOPES = LOGIN_SCOPES + [s for scopes in PROVIDER_SCOPES.values() for s in scopes]

CLIENT_ID = os.environ["GOOGLE_CLIENT_ID"]
CLIENT_SECRET = os.environ["GOOGLE_CLIENT_SECRET"]
REDIRECT_URI = os.environ["GOOGLE_REDIRECT_URI"]
SESSION_SECRET = os.environ["SESSION_SECRET"]

# Postgres connection string (use Neon's pooled URL in production).
DATABASE_URL = os.environ["DATABASE_URL"]

# Fernet key used to encrypt stored OAuth tokens at rest.
TOKEN_ENCRYPTION_KEY = os.environ["TOKEN_ENCRYPTION_KEY"]

# Comma-separated emails that get the "agency_admin" role (see all orgs).
AGENCY_ADMIN_EMAILS = {
    e.strip().lower()
    for e in os.environ.get("AGENCY_ADMIN_EMAILS", "").split(",")
    if e.strip()
}

# The client config the way google-auth-oauthlib expects it. This avoids
# shipping a client_secret.json file in the repo.
CLIENT_CONFIG = {
    "web": {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": [REDIRECT_URI],
    }
}
