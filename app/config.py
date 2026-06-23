"""Application configuration loaded from environment variables."""
import os

from dotenv import load_dotenv

load_dotenv()

# Google may return extra granted scopes (e.g. openid) on top of the ones we
# request; relax oauthlib so that does not raise a "scope has changed" error.
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

# Scopes: identify the signed-in user (email) + read their GA4 data.
SCOPES = [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/analytics.readonly",
]

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
