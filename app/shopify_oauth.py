"""Shopify OAuth 2.0 (install flow) voor de eigen Shopify-app.

De klant koppelt zijn eigen webshop: wij sturen hem naar het
``/admin/oauth/authorize``-scherm van zijn shop, Shopify stuurt hem terug naar
onze callback met een ``code`` (plus een HMAC-handtekening die we verifieren),
en die code wisselen we in voor een permanent Admin-API-token. Dat token wordt
(zoals alle tokens) Fernet-versleuteld per organisatie opgeslagen.
"""
import base64
import hashlib
import hmac
import re
from urllib.parse import urlencode

import requests

from . import config

# Een geldig shopdomein is strikt `naam.myshopify.com`. Door dit hard af te
# dwingen kan de gebruiker ons nooit naar een willekeurige host laten koppelen
# (de OAuth-URL en alle API-calls gaan alleen naar *.myshopify.com).
_SHOP_RE = re.compile(r"^[a-z0-9][a-z0-9-]*\.myshopify\.com$")


class ShopifyError(Exception):
    """Nette foutmelding voor de UI."""


def is_configured() -> bool:
    return bool(config.SHOPIFY_API_KEY and config.SHOPIFY_API_SECRET and config.SHOPIFY_REDIRECT_URI)


def normalize_shop(shop: str) -> str:
    """Maak van gebruikersinvoer een canoniek `naam.myshopify.com` of faal.

    Accepteert `naam`, `naam.myshopify.com` en een volledige URL; alles anders
    (andere domeinen, subpaden, poorten) wordt geweigerd.
    """
    s = (shop or "").strip().lower()
    s = s.removeprefix("https://").removeprefix("http://").strip("/")
    s = s.split("/")[0]
    if s and "." not in s:
        s = f"{s}.myshopify.com"
    if not _SHOP_RE.match(s):
        raise ShopifyError("Vul een geldig Shopify-adres in, bijvoorbeeld jouwwinkel.myshopify.com.")
    return s


def build_install_url(shop: str, state: str) -> str:
    """De autorisatie-URL van de shop voor de gevraagde scopes."""
    params = {
        "client_id": config.SHOPIFY_API_KEY,
        "scope": config.SHOPIFY_SCOPES,
        "redirect_uri": config.SHOPIFY_REDIRECT_URI,
        "state": state,
    }
    return f"https://{shop}/admin/oauth/authorize?{urlencode(params)}"


def verify_hmac(params: dict) -> bool:
    """Controleer de HMAC-handtekening waarmee Shopify de callback ondertekent.

    Alle queryparameters behalve `hmac` (en `signature`) worden gesorteerd en
    als querystring met de app-secret gehasht; dat moet exact de meegestuurde
    `hmac` opleveren. Zo weten we dat de callback echt van Shopify komt.
    """
    received = params.get("hmac", "")
    if not received:
        return False
    pairs = "&".join(
        f"{k}={v}" for k, v in sorted(params.items()) if k not in ("hmac", "signature")
    )
    digest = hmac.new(
        config.SHOPIFY_API_SECRET.encode(), pairs.encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(digest, received)


def verify_webhook_hmac(raw_body: bytes, header: str) -> bool:
    """Verifieer de handtekening van een Shopify-webhook.

    Anders dan de OAuth-callback (die gesorteerde queryparameters hasht) tekent
    Shopify een webhook met ``base64(HMAC-SHA256(app_secret, rauwe request-body))``
    in de header ``X-Shopify-Hmac-Sha256``. We hashen daarom exact de rauwe bytes
    van de body, vóór enige JSON-parsing.
    """
    if not header or not config.SHOPIFY_API_SECRET:
        return False
    digest = hmac.new(config.SHOPIFY_API_SECRET.encode(), raw_body, hashlib.sha256).digest()
    expected = base64.b64encode(digest).decode()
    return hmac.compare_digest(expected, header)


def exchange_code(shop: str, code: str) -> dict:
    """Wissel de callback-code in voor een permanent Admin-API-token.

    Returnt een creds-dict klaar voor versleutelde opslag: {shop, access_token}.
    """
    shop = normalize_shop(shop)
    resp = requests.post(
        f"https://{shop}/admin/oauth/access_token",
        json={
            "client_id": config.SHOPIFY_API_KEY,
            "client_secret": config.SHOPIFY_API_SECRET,
            "code": code,
        },
        timeout=15,
    )
    resp.raise_for_status()
    token = resp.json().get("access_token")
    if not token:
        raise ShopifyError("Shopify gaf geen token terug.")
    return {"shop": shop, "access_token": token}
