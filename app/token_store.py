"""Per-user token storage.

DEMO ONLY: this writes plaintext JSON to ./tokens (git-ignored).
For production, store tokens ENCRYPTED in a database or a secret manager,
keyed by your own user id, and never expose the refresh_token to clients.
"""
import json
from pathlib import Path

_DIR = Path(__file__).resolve().parent.parent / "tokens"
_DIR.mkdir(exist_ok=True)


def save(user_id: str, creds: dict) -> None:
    (_DIR / f"{user_id}.json").write_text(json.dumps(creds))


def load(user_id: str) -> dict | None:
    path = _DIR / f"{user_id}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())
