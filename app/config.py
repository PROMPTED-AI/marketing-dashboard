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
    "google_ads": ["https://www.googleapis.com/auth/adwords"],
}
GOOGLE_PROVIDERS = list(PROVIDER_SCOPES.keys())
PLACEHOLDER_PROVIDERS = []

# AI-assistent (chat in de sidebar) via EuRouter (EU-gehoste, OpenAI-compatibele
# gateway). Key + modelslug worden als Cloud Run env vars gezet. Het model is de
# exacte EuRouter-slug uit hun modelcatalogus (kale slug, geen provider-prefix,
# bv. "claude-sonnet-4-6", "claude-sonnet-4-5" of "mistral-large-3").
EUROUTER_API_KEY = os.environ.get("EUROUTER_API_KEY", "")
EUROUTER_MODEL = os.environ.get("EUROUTER_MODEL", "claude-sonnet-4-6")
EUROUTER_BASE_URL = os.environ.get("EUROUTER_BASE_URL", "https://api.eurouter.ai/api/v1")

# Meta (Facebook + Instagram) uses its own Facebook Login OAuth flow, separate
# from Google. App credentials are set on the Cloud Run service, never in repo.
META_PROVIDERS = ["meta_ads"]
META_APP_ID = os.environ.get("META_APP_ID", "")
META_APP_SECRET = os.environ.get("META_APP_SECRET", "")
META_REDIRECT_URI = os.environ.get("META_REDIRECT_URI", "")
META_GRAPH_VERSION = os.environ.get("META_GRAPH_VERSION", "v21.0")
# Note: `email` and `read_insights` are not valid scopes for this app type
# (Facebook rejects them and blocks the login dialog). Identity comes from
# `public_profile`; page insights are covered by `pages_read_engagement`.
META_SCOPES = [
    "public_profile", "ads_read", "business_management",
    "pages_show_list", "pages_read_engagement",
    "instagram_basic", "instagram_manage_insights",
]

# Google Ads needs an approved developer token (set on the Cloud Run service,
# never in the repo). Optional login_customer_id is the manager (MCC) account id
# under which client accounts are accessed — digits only, no dashes.
GOOGLE_ADS_DEVELOPER_TOKEN = os.environ.get("GOOGLE_ADS_DEVELOPER_TOKEN", "")
GOOGLE_ADS_LOGIN_CUSTOMER_ID = "".join(
    c for c in os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "") if c.isdigit()
)

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

# Public / shared email providers. Users with one of these domains must NOT be
# grouped into a shared organization by domain (that would let unrelated people
# — e.g. any gmail.com user — see each other's data). They each get an isolated
# personal org instead. Extend via the PUBLIC_EMAIL_DOMAINS env var (comma-sep).
_DEFAULT_PUBLIC_EMAIL_DOMAINS = {
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
    "msn.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com",
    "mac.com", "aol.com", "protonmail.com", "proton.me", "gmx.com", "gmx.net",
    "mail.com", "zoho.com", "yandex.com", "hey.com", "fastmail.com", "pm.me",
}
PUBLIC_EMAIL_DOMAINS = _DEFAULT_PUBLIC_EMAIL_DOMAINS | {
    d.strip().lower()
    for d in os.environ.get("PUBLIC_EMAIL_DOMAINS", "").split(",")
    if d.strip()
}


def is_public_email_domain(domain: str) -> bool:
    return domain.strip().lower() in PUBLIC_EMAIL_DOMAINS

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
