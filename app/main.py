"""FastAPI app: multi-tenant Google Analytics dashboard (hybrid model).

Identity + data access both run through Google OAuth: signing in identifies
the user (by email) AND connects their organization's GA data.

Roles
-----
client        : sees only their own organization's data
agency_admin  : sees every organization + its connection status, and can view
                any organization's data (set via AGENCY_ADMIN_EMAILS)

Routes
------
GET  /                              -> dashboard page (static HTML)
GET  /healthz                       -> health check
GET  /api/me                        -> current user + organization + role
GET  /api/auth/google/login         -> sign in / connect with Google
GET  /api/auth/google/callback      -> identify user, store connection
GET  /api/auth/logout               -> clear session
GET  /api/admin/organizations       -> (admin) all orgs + connection status
GET  /api/analytics/properties      -> GA4 properties for an organization
GET  /api/analytics/report          -> sample GA4 report for a property
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from . import cache, config, db, demo

# Zonder basisconfiguratie hebben de app-loggers geen handler onder uvicorn en
# verdwijnen INFO-regels (zoals de assistent-telemetrie) stilletjes. Uvicorns
# eigen loggers hebben al handlers en propagate=False; die raakt dit niet.
logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
log = logging.getLogger("dashboard")

# Foutbewaking: alleen actief wanneer SENTRY_DSN gezet is. De sdk is een
# optionele dependency; ontbreekt die, dan draait alles gewoon zonder.
if config.SENTRY_DSN:
    try:
        import sentry_sdk

        sentry_sdk.init(dsn=config.SENTRY_DSN, traces_sample_rate=0.0, send_default_pii=False)
        log.info("Sentry-foutbewaking actief")
    except ImportError:
        log.warning("SENTRY_DSN gezet maar sentry-sdk niet geinstalleerd; foutbewaking uit")

# The React/Vite build is copied here by the Dockerfile (stage 1 -> stage 2).
SPA_DIR = Path(__file__).resolve().parent / "static_spa"
SPA_INDEX = SPA_DIR / "index.html"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_schema()
    cache.init_schema()
    try:
        demo.seed()
    except Exception:
        log.exception("demo seed failed")  # never block startup on the demo account
    yield


app = FastAPI(title="Marketing Dashboard - GA4 (multi-tenant)", lifespan=lifespan)
app.add_middleware(
    SessionMiddleware,
    secret_key=config.SESSION_SECRET,
    https_only=config.SESSION_COOKIE_SECURE,
    same_site="lax",
)

# Serve the built SPA's static assets (present in production / after a build).
if (SPA_DIR / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=SPA_DIR / "assets"), name="assets")
if (SPA_DIR / "fonts").is_dir():
    app.mount("/fonts", StaticFiles(directory=SPA_DIR / "fonts"), name="fonts")




@app.get("/healthz")
def healthz():
    return {"ok": True}


from .routers import account, adminpanel, assistant_api, channels, dashboards, feedback, framework  # noqa: E402

app.include_router(account.router)
app.include_router(adminpanel.router)
app.include_router(assistant_api.router)
app.include_router(channels.router)
app.include_router(dashboards.router)
app.include_router(feedback.router)
app.include_router(framework.router)

@app.get("/{full_path:path}")
def spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    if SPA_INDEX.exists():
        return FileResponse(SPA_INDEX, headers={"Cache-Control": "no-cache"})
    return JSONResponse(
        {"detail": "Frontend not built. Run `npm run build` in frontend/."},
        status_code=503,
    )
