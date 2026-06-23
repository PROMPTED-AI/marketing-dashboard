"""Postgres connection pool and multi-tenant schema.

Tables
------
organizations  : one per client company (grouped by email domain)
users          : people who sign in; each belongs to one organization + role
connections    : one GA OAuth connection per organization (encrypted, with status)
"""
from psycopg_pool import ConnectionPool

from . import config

# open=False so importing this module never blocks on a DB connection;
# the pool opens lazily on first use.
_pool = ConnectionPool(config.DATABASE_URL, min_size=0, max_size=4, open=False)


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
