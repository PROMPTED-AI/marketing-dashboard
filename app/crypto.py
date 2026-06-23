"""Symmetric encryption for data at rest (e.g. OAuth refresh tokens).

Uses Fernet (AES-128-CBC + HMAC). Generate a key once with:

    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

and store it as the TOKEN_ENCRYPTION_KEY environment variable. Rotating this
key invalidates previously stored tokens (users must reconnect).
"""
from cryptography.fernet import Fernet

from . import config

_fernet = Fernet(config.TOKEN_ENCRYPTION_KEY.encode())


def encrypt(plaintext: str) -> bytes:
    return _fernet.encrypt(plaintext.encode())


def decrypt(token: bytes) -> str:
    return _fernet.decrypt(bytes(token)).decode()
