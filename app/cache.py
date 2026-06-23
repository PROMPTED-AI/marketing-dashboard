"""Server-side cache for expensive Google API responses.

Two layers sit in front of the GA4 / Search Console calls:

* a small in-process TTL map — instant, per Cloud Run instance, warm-hit only;
* a Postgres ``report_cache`` table — survives cold starts and is shared across
  instances, so the first request after the container scales up is still fast.

Only deterministic report payloads are cached. Realtime data is never cached.
Historical date ranges (whose end date is before today) are immutable, so they
get a long TTL; ranges that include today get a short one.
"""
import time
from datetime import date

from psycopg.types.json import Jsonb

from . import db

SHORT_TTL = 600        # 10 min — ranges that include today
LONG_TTL = 24 * 3600   # 24 h  — historical (immutable) ranges
LIST_TTL = 1800        # 30 min — property / site lists

_MEM_MAX = 512
_mem: dict[str, tuple[float, dict]] = {}  # key -> (expires_epoch, payload)


def init_schema() -> None:
    """Create the cache table. Called at startup alongside db.init_schema()."""
    with db.get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS report_cache (
                cache_key   TEXT PRIMARY KEY,
                payload     JSONB NOT NULL,
                expires_at  TIMESTAMPTZ NOT NULL,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )


def ttl_for_range(end: str) -> int:
    """Long TTL for ranges that ended in the past, short for ranges up to today."""
    try:
        end_d = date.fromisoformat(end[:10])
    except (ValueError, TypeError):
        return SHORT_TTL
    return LONG_TTL if end_d < date.today() else SHORT_TTL


def _evict() -> None:
    now = time.time()
    for k in [k for k, (exp, _) in _mem.items() if exp <= now]:
        _mem.pop(k, None)
    if len(_mem) > _MEM_MAX:
        for k in list(_mem.keys())[: len(_mem) - _MEM_MAX]:
            _mem.pop(k, None)


def get(key: str):
    """Return a cached payload (dict) or None. Checks memory then Postgres."""
    hit = _mem.get(key)
    if hit:
        exp, payload = hit
        if exp > time.time():
            return payload
        _mem.pop(key, None)
    try:
        with db.get_conn() as conn:
            row = conn.execute(
                "SELECT payload, extract(epoch FROM expires_at) "
                "FROM report_cache WHERE cache_key = %s AND expires_at > now()",
                (key,),
            ).fetchone()
    except Exception:
        return None
    if not row:
        return None
    payload, exp = row[0], float(row[1])
    _mem[key] = (exp, payload)
    return payload


def set(key: str, payload: dict, ttl: int) -> None:
    """Store a payload in both layers (best-effort for Postgres)."""
    exp = time.time() + ttl
    _mem[key] = (exp, payload)
    if len(_mem) > _MEM_MAX:
        _evict()
    try:
        with db.get_conn() as conn:
            conn.execute(
                """
                INSERT INTO report_cache (cache_key, payload, expires_at)
                VALUES (%s, %s, to_timestamp(%s))
                ON CONFLICT (cache_key) DO UPDATE
                  SET payload = EXCLUDED.payload,
                      expires_at = EXCLUDED.expires_at,
                      created_at = now()
                """,
                (key, Jsonb(payload), exp),
            )
    except Exception:
        pass


def invalidate_org(org_id: str) -> None:
    """Drop every cached entry for one org (after connect / disconnect)."""
    prefix = org_id + "|"
    for k in [k for k in _mem if k.startswith(prefix)]:
        _mem.pop(k, None)
    try:
        with db.get_conn() as conn:
            conn.execute("DELETE FROM report_cache WHERE cache_key LIKE %s", (prefix + "%",))
    except Exception:
        pass
