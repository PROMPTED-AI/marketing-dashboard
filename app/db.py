"""Postgres connection pool and schema.

Designed for Neon serverless Postgres behind Cloud Run: a small pool that can
shrink to zero so idle Cloud Run instances hold no connections. Point
DATABASE_URL at Neon's *pooled* connection string (the one with `-pooler` in
the host) for best behaviour under autoscaling.
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
    """Create the tokens table if it does not exist. Called at startup."""
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ga_tokens (
                user_id          TEXT PRIMARY KEY,
                encrypted_creds  BYTEA NOT NULL,
                updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
