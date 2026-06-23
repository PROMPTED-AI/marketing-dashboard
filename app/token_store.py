"""Per-user token storage, encrypted at rest in Postgres.

Credentials are serialized to JSON, encrypted with the app's Fernet key, and
stored as a single BYTEA per user. The refresh_token never touches the client
and is never logged.
"""
import json

from . import crypto, db


def save(user_id: str, creds: dict) -> None:
    blob = crypto.encrypt(json.dumps(creds))
    with db.get_conn() as conn:
        conn.execute(
            """
            INSERT INTO ga_tokens (user_id, encrypted_creds, updated_at)
            VALUES (%s, %s, now())
            ON CONFLICT (user_id)
            DO UPDATE SET encrypted_creds = EXCLUDED.encrypted_creds,
                          updated_at = now()
            """,
            (user_id, blob),
        )


def load(user_id: str) -> dict | None:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT encrypted_creds FROM ga_tokens WHERE user_id = %s",
            (user_id,),
        ).fetchone()
    if not row:
        return None
    return json.loads(crypto.decrypt(row[0]))
