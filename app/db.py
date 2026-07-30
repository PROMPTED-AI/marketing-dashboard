"""Postgres connection pool and multi-tenant schema.

Tables
------
organizations  : one per client company (grouped by email domain); a bureau is
                 an organization too (`is_agency`), its clients point back via
                 `agency_id`
users          : people who sign in; each belongs to one organization + role
connections    : one GA OAuth connection per organization (encrypted, with status)
dashboards     : user-composed widget layouts, shared within an organization
org_features   : which product features a bureau activated per client account
"""
from contextlib import contextmanager

from psycopg_pool import ConnectionPool

from . import config, reqcache

# open=False so importing this module never blocks on a DB connection;
# the pool opens lazily on first use.
#
# Neon (serverless Postgres) scales to zero and drops idle server-side
# connections. Without guarding for that, the pool hands out a now-dead
# connection and the request fails with an OperationalError (HTTP 500) —
# the intermittent "sometimes login works, sometimes it doesn't" symptom,
# since login is usually the first DB hit after an idle period.
#
#   check    : validate (and recycle) a connection before handing it out,
#              so a dead one never reaches a request.
#   max_idle : proactively close idle connections before Neon does.
#   max_size : ruimer dan de vier van eerder. Het raamwerk haalt maanden
#              parallel op (tot 8 threads) en die threads doen ook kleine
#              queries; met een pool van 4 stonden ze op elkaar te wachten en
#              lag een PoolTimeout onder last op de loer.
_pool = ConnectionPool(
    config.DATABASE_URL,
    min_size=0,
    max_size=12,
    open=False,
    check=ConnectionPool.check_connection,
    max_idle=60,
    reconnect_timeout=10,
)


class _WriteAwareConn:
    """Pooled connectie die de per-request memo leegt bij een schrijfactie.

    Eén centrale plek in plaats van een `reqcache.clear()` in elke schrijffunctie
    (het zijn er tientallen, en een nieuwe zou het zo vergeten). Alles wat geen
    SELECT is telt als schrijven; te vaak legen is onschuldig, te weinig niet.
    """

    __slots__ = ("_conn",)

    def __init__(self, conn):
        self._conn = conn

    def execute(self, query, params=None, *args, **kwargs):
        if not str(query).lstrip().upper().startswith(("SELECT", "WITH")):
            reqcache.clear()
        return self._conn.execute(query, params, *args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._conn, name)


@contextmanager
def get_conn():
    """Context manager yielding a pooled connection (auto-commit on exit)."""
    if _pool.closed:
        _pool.open()
    with _pool.connection() as conn:
        yield _WriteAwareConn(conn)


def init_schema() -> None:
    """Create the multi-tenant tables if they do not exist. Called at startup."""
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS organizations (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                domain      TEXT UNIQUE,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        # Personal orgs isolate users on shared/public email domains (no
        # domain-based grouping). They are hidden from the admin client list.
        conn.execute(
            "ALTER TABLE organizations "
            "ADD COLUMN IF NOT EXISTS is_personal BOOLEAN NOT NULL DEFAULT false"
        )
        # Demo orgs serve generated sample data instead of live Google data, so
        # the product can be shown without connecting a real account.
        conn.execute(
            "ALTER TABLE organizations "
            "ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false"
        )
        # Company profile: 'leadgen' (service businesses — forms, quotes, calls)
        # or 'ecommerce' (revenue, orders, ROAS). Drives which dashboard views and
        # KPIs are shown by default, per organization.
        conn.execute(
            "ALTER TABLE organizations "
            "ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'leadgen'"
        )
        # Abonnement: nieuwe organisaties starten met een proefperiode van 14
        # dagen ('trial' + trial_ends_at); 'active' is betaald/onbeperkt. De
        # kolommen krijgen default 'trial', maar organisaties die vóór deze
        # migratie bestonden (trial_ends_at IS NULL) worden actief gezet zodat
        # bestaande klanten nooit opeens buitengesloten raken. Idempotent:
        # elke echte trial-org heeft altijd een einddatum.
        conn.execute(
            "ALTER TABLE organizations "
            "ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'trial'"
        )
        conn.execute(
            "ALTER TABLE organizations "
            "ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ"
        )
        conn.execute(
            "UPDATE organizations SET plan = 'active' "
            "WHERE plan = 'trial' AND trial_ends_at IS NULL"
        )
        # Gekozen pakket per organisatie (start | groei | pro), NULL = nog geen.
        conn.execute(
            "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS package TEXT"
        )
        # Handmatige raamwerkwaarden (budget, inkoopwaarde, retouren, kosten
        # per klant) per organisatie per maand, voor de pagina Raamwerk.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS framework_values (
                organization_id  TEXT NOT NULL REFERENCES organizations(id),
                month            TEXT NOT NULL,
                key              TEXT NOT NULL,
                value            DOUBLE PRECISION,
                updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (organization_id, month, key)
            )
            """
        )
        # Facturatiegegevens per organisatie, ingevuld door de agency admin op
        # de pagina Pakketten & facturatie.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS billing_details (
                organization_id  TEXT PRIMARY KEY REFERENCES organizations(id),
                company_name     TEXT NOT NULL DEFAULT '',
                billing_email    TEXT NOT NULL DEFAULT '',
                address          TEXT NOT NULL DEFAULT '',
                postal_city      TEXT NOT NULL DEFAULT '',
                kvk              TEXT NOT NULL DEFAULT '',
                btw              TEXT NOT NULL DEFAULT '',
                reference        TEXT NOT NULL DEFAULT '',
                updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id               TEXT PRIMARY KEY,
                email            TEXT UNIQUE NOT NULL,
                organization_id  TEXT NOT NULL REFERENCES organizations(id),
                role             TEXT NOT NULL DEFAULT 'client',
                created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        # Password sign-in (next to Google). NULL = user can only use Google.
        conn.execute(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT"
        )
        # Sessieteller: elke sessie draagt de stand die bij het inloggen gold.
        # Bij een wachtwoordwijziging of -reset gaat de teller omhoog, waardoor
        # alle bestaande sessies elders ongeldig worden. Zonder dit blijft een
        # gestolen sessie geldig, ook nadat het slachtoffer zijn wachtwoord
        # heeft veranderd.
        conn.execute(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS session_epoch INTEGER NOT NULL DEFAULT 0"
        )
        # Bureau-model: een 'managed' organisatie krijgt zijn data via de
        # bureau-koppeling (het manageraccount), en de admin wijst per bedrijf
        # toe welke property/site/Ads-klant erbij hoort. De toewijzing wordt
        # server-side afgedwongen, zodat een klant nooit een ander bedrijf ziet.
        conn.execute(
            "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS managed BOOLEAN NOT NULL DEFAULT false"
        )
        # Bedrijfsprofiel: naam (bestaat al), website en branche, zodat de
        # identiteit expliciet wordt vastgelegd in plaats van afgeleid uit het
        # e-mailadres (belangrijk voor accounts op een publiek domein zoals gmail).
        conn.execute("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS website TEXT")
        conn.execute("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS industry TEXT")
        # Bureau-omgeving: een bureau (zoals TriplePro, met een MCC/manager-
        # account) is zelf een organisatie met `is_agency`; de klanten die het
        # klaarzet wijzen via `agency_id` terug naar dat bureau. Zo beheert elk
        # bureau alleen zijn eigen klanten en kunnen meerdere bureaus naast
        # elkaar op hetzelfde platform draaien.
        conn.execute(
            "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_agency BOOLEAN NOT NULL DEFAULT false"
        )
        conn.execute(
            "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS agency_id TEXT REFERENCES organizations(id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS organizations_agency_idx ON organizations (agency_id)"
        )
        # Per-account functies: het bureau bepaalt per klantomgeving welke
        # onderdelen aanstaan (signalen, AI-assistent, integraties, raamwerk,
        # mijn dashboards). Een ontbrekende rij betekent "aan", zodat bestaande
        # omgevingen ongewijzigd blijven werken.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS org_features (
                organization_id  TEXT NOT NULL REFERENCES organizations(id),
                feature          TEXT NOT NULL,
                enabled          BOOLEAN NOT NULL DEFAULT true,
                updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (organization_id, feature)
            )
            """
        )
        # Migratie naar het bureau-model. Elke organisatie waar een agency admin
        # in zit, is een bureau. Bestaat er daarna precies één bureau (de situatie
        # van elke bestaande installatie), dan zijn alle bestaande klanten van dat
        # bureau — anders laten we de koppeling leeg en wijst de platform-admin ze
        # zelf toe, in plaats van te gokken.
        conn.execute(
            "UPDATE organizations SET is_agency = true WHERE id IN "
            "(SELECT organization_id FROM users WHERE role = 'agency_admin')"
        )
        conn.execute(
            """
            UPDATE organizations SET agency_id =
                (SELECT id FROM organizations WHERE is_agency ORDER BY created_at LIMIT 1)
            WHERE agency_id IS NULL AND is_personal = false AND is_agency = false
              AND (SELECT count(*) FROM organizations WHERE is_agency) = 1
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS org_assets (
                organization_id  TEXT PRIMARY KEY REFERENCES organizations(id),
                ga_property_id   TEXT,
                gsc_site_url     TEXT,
                ads_customer_id  TEXT,
                updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        # Eenmalige tokens voor uitnodigingen en wachtwoord-reset. Alleen de
        # hash van de token wordt bewaard; de link bevat de ruwe token. `kind`
        # is 'invite' of 'reset'. `used_at`/`expires_at` maken de token
        # eenmalig en tijdgebonden.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS access_tokens (
                id               TEXT PRIMARY KEY,
                kind             TEXT NOT NULL,
                email            TEXT NOT NULL,
                organization_id  TEXT REFERENCES organizations(id),
                role             TEXT,
                token_hash       TEXT NOT NULL UNIQUE,
                expires_at       TIMESTAMPTZ NOT NULL,
                used_at          TIMESTAMPTZ,
                created_by       TEXT,
                created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS connections (
                id               TEXT PRIMARY KEY,
                organization_id  TEXT NOT NULL REFERENCES organizations(id),
                provider         TEXT NOT NULL DEFAULT 'google_analytics',
                google_email     TEXT,
                encrypted_creds  BYTEA NOT NULL,
                status           TEXT NOT NULL DEFAULT 'connected',
                updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (organization_id, provider)
            )
            """
        )
        # Custom dashboards: a named layout of widgets the user composes.
        # Private by default (only the owner — `created_by` — sees it); the owner
        # may flip `visibility` to 'shared' so the rest of their organization can
        # view it. `page` scopes a dashboard to a screen (e.g. 'overview') so the
        # same mechanism can later serve other tabs. `layout` holds the widget
        # config as JSON. `is_default` is the owner's default for that page.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS dashboards (
                id               TEXT PRIMARY KEY,
                organization_id  TEXT NOT NULL REFERENCES organizations(id),
                page             TEXT NOT NULL DEFAULT 'overview',
                name             TEXT NOT NULL,
                layout           JSONB NOT NULL DEFAULT '{"widgets": []}',
                visibility       TEXT NOT NULL DEFAULT 'private',
                is_default       BOOLEAN NOT NULL DEFAULT false,
                created_by       TEXT,
                created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        # For installs created before private/shared existed.
        conn.execute(
            "ALTER TABLE dashboards "
            "ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS dashboards_org_page_idx "
            "ON dashboards (organization_id, page)"
        )
        # Gebruikersfeedback over de applicatie. `status` volgt de kolommen van
        # het kanban-bord in de beheeromgeving (requests -> in_progress ->
        # done / rejected); `ai_analysis` is de door AI uitgewerkte versie.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS feedback (
                id               TEXT PRIMARY KEY,
                organization_id  TEXT,
                user_email       TEXT NOT NULL,
                category         TEXT NOT NULL,
                message          TEXT NOT NULL,
                page             TEXT,
                severity         TEXT,
                status           TEXT NOT NULL DEFAULT 'requests',
                ai_analysis      TEXT,
                created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
