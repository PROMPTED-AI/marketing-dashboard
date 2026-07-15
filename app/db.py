"""Postgres connection pool and multi-tenant schema.

Tables
------
organizations  : one per client company (grouped by email domain)
users          : people who sign in; each belongs to one organization + role
connections    : one GA OAuth connection per organization (encrypted, with status)
dashboards     : user-composed widget layouts, shared within an organization
"""
from psycopg_pool import ConnectionPool

from . import config

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
_pool = ConnectionPool(
    config.DATABASE_URL,
    min_size=0,
    max_size=4,
    open=False,
    check=ConnectionPool.check_connection,
    max_idle=60,
    reconnect_timeout=10,
)


def get_conn():
    """Context manager yielding a pooled connection (auto-commit on exit)."""
    if _pool.closed:
        _pool.open()
    return _pool.connection()


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
        # Demo orgs get generated sample data instead of live Google data, so
        # the product can be shown without connecting a real account.
        conn.execute(
            "ALTER TABLE organizations "
            "ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false"
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
