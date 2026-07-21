"""Seed voor de testomgeving: agency admin + testklant-gebruiker.

Idempotent. Vereist dezelfde omgevingsvariabelen als de app (DATABASE_URL,
TOKEN_ENCRYPTION_KEY, GOOGLE_CLIENT_ID, ...). De demo-organisatie (Janssen)
seedt de app zelf bij het opstarten.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import auth, models  # noqa: E402

org = models.create_or_rename_organization("Prompted", "prompted-ai.nl")
models.upsert_user("admin@prompted-ai.nl", org["id"], "agency_admin")
models.set_user_password("admin@prompted-ai.nl", auth.hash_password("admin123"))
models.activate_org(org["id"])

tk = models.create_or_rename_organization("Testklant", "testklant.nl")
models.upsert_user("test@testklant.nl", tk["id"], "client")
models.set_user_password("test@testklant.nl", auth.hash_password("test123"))

print("seed klaar: admin@prompted-ai.nl / test@testklant.nl")
