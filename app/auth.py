"""Session-based current-user and role helpers, plus password hashing."""
import hashlib
import hmac
import secrets

from fastapi import HTTPException, Request

from . import config, models

# PBKDF2-HMAC-SHA256 (stdlib only). Format: pbkdf2_sha256$<iters>$<salt>$<hash>
_PBKDF2_ITERATIONS = 260_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), _PBKDF2_ITERATIONS
    )
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt, expected = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt), int(iters)
        )
        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, AttributeError):
        return False


# --- eenmalige tokens (uitnodiging + wachtwoord-reset) + wachtwoordbeleid ---

MIN_PASSWORD_LENGTH = 8


def generate_token() -> tuple[str, str]:
    """Geef (ruwe token voor in de link, hash voor in de database).

    Alleen de hash wordt opgeslagen, zodat een databaselek de links niet
    bruikbaar maakt. De ruwe token gaat eenmalig naar de gebruiker.
    """
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def password_problem(password: str) -> str | None:
    """Geef een foutmelding als het wachtwoord niet voldoet, anders None."""
    if not password or len(password) < MIN_PASSWORD_LENGTH:
        return f"Wachtwoord moet minimaal {MIN_PASSWORD_LENGTH} tekens zijn."
    if len(password) > 200:
        return "Wachtwoord is te lang."
    return None


def is_agency_admin(email: str) -> bool:
    return email.lower() in config.AGENCY_ADMIN_EMAILS


def role_for(email: str) -> str:
    return "agency_admin" if is_agency_admin(email) else "client"


def current_user(request: Request) -> dict:
    """Return the signed-in user, or raise 401."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not signed in")
    user = models.get_user(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Unknown session")
    return user


def require_admin(request: Request) -> dict:
    user = current_user(request)
    if user["role"] != "agency_admin":
        raise HTTPException(status_code=403, detail="Agency admin only")
    return user
