"""Thin wrapper around the Google Ads API (read-only).

Unlike GA4 / Search Console, the Google Ads API additionally needs an approved
**developer token** (config.GOOGLE_ADS_DEVELOPER_TOKEN) on top of the user's
OAuth grant. Reports are pulled with GAQL via the GoogleAdsService.

The google-ads library is imported lazily inside the functions so a missing or
broken install can never take down the rest of the app (GA4 / GSC keep working).
Cost is returned by Google in *micros* (1/1_000_000 of the account currency); we
convert to whole currency units.
"""
import logging
from datetime import date

from google.oauth2.credentials import Credentials

from . import config

log = logging.getLogger(__name__)


class AdsNotConfigured(Exception):
    """Raised when no developer token is set, so callers can return a clean 409."""


def _iso_date(v: str) -> str:
    """Normalize to YYYY-MM-DD; raises ValueError otherwise.

    Dates are interpolated into GAQL, so this guarantees no query syntax can be
    injected via a date parameter regardless of the caller (defense-in-depth).
    """
    return date.fromisoformat(v).isoformat()


def _micros(v) -> float:
    return (int(v) / 1_000_000) if v else 0.0


def _int(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _client(creds: Credentials, login_customer_id: str | None = None):
    """Build a GoogleAdsClient from a stored OAuth grant + the developer token.

    ``login_customer_id`` overrides the configured default; nodig wanneer we
    onder een specifiek manager-account (MCC) willen kijken, zoals bij het
    opsommen van de klantaccounts eronder."""
    if not config.GOOGLE_ADS_DEVELOPER_TOKEN:
        raise AdsNotConfigured("GOOGLE_ADS_DEVELOPER_TOKEN is not set")
    from google.ads.googleads.client import GoogleAdsClient

    cfg = {
        "developer_token": config.GOOGLE_ADS_DEVELOPER_TOKEN,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "refresh_token": creds.refresh_token,
        "use_proto_plus": True,
    }
    login = login_customer_id or config.GOOGLE_ADS_LOGIN_CUSTOMER_ID
    if login:
        cfg["login_customer_id"] = _digits(login)
    return GoogleAdsClient.load_from_dict(cfg)


def _digits(customer_id: str) -> str:
    return "".join(c for c in (customer_id or "") if c.isdigit())


def _expand_manager(creds: Credentials, manager_id: str, seen: set) -> list[dict]:
    """Alle actieve klantaccounts ónder een manager-account (MCC).

    ``list_accessible_customers`` geeft alleen accounts waar de gebruiker zelf
    direct op staat — bij een bureau is dat meestal alleen het MCC zelf. De
    klantaccounts eronder komen uit een ``customer_client``-query op het MCC,
    met dat MCC als login-customer. Faalt de expansie, dan geeft dit een lege
    lijst en valt de aanroeper terug op het MCC zelf."""
    out: list[dict] = []
    try:
        client = _client(creds, login_customer_id=manager_id)
        ga_service = client.get_service("GoogleAdsService")
        rows = ga_service.search(
            customer_id=_digits(manager_id),
            query=(
                "SELECT customer_client.id, customer_client.descriptive_name, "
                "customer_client.manager, customer_client.hidden "
                "FROM customer_client WHERE customer_client.status = 'ENABLED'"
            ),
        )
        for row in rows:
            c = row.customer_client
            cid = str(c.id)
            # Managers (het MCC zelf en sub-MCC's) zijn niet rapporteerbaar;
            # alleen de echte klantaccounts horen in de toewijzingslijst.
            if c.hidden or c.manager or cid in seen:
                continue
            seen.add(cid)
            out.append({"customer_id": cid, "name": c.descriptive_name or cid})
    except Exception as exc:  # noqa: BLE001 - expansie mag de lijst nooit breken
        log.info("google_ads: MCC-expansie mislukt voor %s: %s", manager_id, exc)
    return out


def list_accounts(creds: Credentials) -> list[dict]:
    """List the ad accounts the authenticated user can access.

    Returns the accessible customer ids, enriched with the descriptive name
    where that lookup succeeds (it can fail for accounts the login customer
    cannot describe — that must not break the list). Manager-accounts (MCC's)
    worden uitgeklapt naar de klantaccounts eronder, zodat een bureau met één
    manager-login al zijn klanten in de toewijzingslijst ziet.
    """
    client = _client(creds)
    customer_service = client.get_service("CustomerService")
    accessible = customer_service.list_accessible_customers()
    ga_service = client.get_service("GoogleAdsService")

    accounts: list[dict] = []
    seen: set = set()
    for resource_name in accessible.resource_names:
        cid = resource_name.split("/")[-1]
        name, is_manager = cid, False
        try:
            rows = ga_service.search(
                customer_id=cid,
                query=(
                    "SELECT customer.descriptive_name, customer.manager "
                    "FROM customer LIMIT 1"
                ),
            )
            for row in rows:
                name = row.customer.descriptive_name or cid
                is_manager = bool(row.customer.manager)
                break
        except Exception as exc:  # noqa: BLE001 - one account must not break the list
            log.info("google_ads: name lookup failed for %s: %s", cid, exc)
        children = _expand_manager(creds, cid, seen) if is_manager else []
        if children:
            accounts.extend(children)
        elif cid not in seen:
            # Geen (vindbare) klantaccounts: toon het account zelf, zoals voorheen.
            seen.add(cid)
            accounts.append({"customer_id": cid, "name": name})
    return accounts


def _totals(ga_service, customer_id: str, start: str, end: str) -> dict:
    query = (
        "SELECT metrics.cost_micros, metrics.clicks, metrics.impressions, "
        "metrics.conversions, metrics.conversions_value "
        "FROM customer "
        f"WHERE segments.date BETWEEN '{start}' AND '{end}'"
    )
    cost = clicks = impressions = 0
    conversions = conv_value = 0.0
    for row in ga_service.search(customer_id=customer_id, query=query):
        m = row.metrics
        cost += int(m.cost_micros or 0)
        clicks += int(m.clicks or 0)
        impressions += int(m.impressions or 0)
        conversions += float(m.conversions or 0)
        conv_value += float(m.conversions_value or 0)
    spend = cost / 1_000_000
    return {
        "cost": spend,
        "clicks": clicks,
        "impressions": impressions,
        "conversions": conversions,
        "conversionsValue": conv_value,
        "ctr": (clicks / impressions * 100) if impressions else 0.0,
        "cpc": (spend / clicks) if clicks else 0.0,
        "roas": (conv_value / spend) if spend else 0.0,
    }


def run_overview(
    creds: Credentials,
    customer_id: str,
    start: str,
    end: str,
    compare: tuple[str, str] | None = None,
) -> dict:
    """Account KPIs (+ optional comparison deltas), a daily series and top campaigns.

    Dates are ISO (YYYY-MM-DD). Each block degrades to a safe default if the API
    rejects it, so one unsupported part never 500s the whole report.
    """
    customer_id = _digits(customer_id)
    start, end = _iso_date(start), _iso_date(end)
    if compare:
        compare = (_iso_date(compare[0]), _iso_date(compare[1]))
    client = _client(creds)
    ga_service = client.get_service("GoogleAdsService")

    def safe(fn, default):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            log.warning("google_ads overview block failed: %s", exc)
            return default

    kpis = safe(lambda: _totals(ga_service, customer_id, start, end), {})

    deltas = None
    if compare and kpis:
        prev = safe(lambda: _totals(ga_service, customer_id, compare[0], compare[1]), {})

        def delta(key):
            c, p = kpis.get(key, 0) or 0, prev.get(key, 0) or 0
            return ((c - p) / p * 100) if p else None

        deltas = {k: delta(k) for k in ("cost", "clicks", "impressions", "conversions", "conversionsValue", "ctr", "cpc", "roas")}

    def _by_date():
        query = (
            "SELECT segments.date, metrics.cost_micros, metrics.clicks, "
            "metrics.impressions, metrics.conversions "
            "FROM customer "
            f"WHERE segments.date BETWEEN '{start}' AND '{end}' "
            "ORDER BY segments.date"
        )
        out = []
        for row in ga_service.search(customer_id=customer_id, query=query):
            out.append({
                "date": row.segments.date,
                "cost": _micros(row.metrics.cost_micros),
                "clicks": _int(row.metrics.clicks),
                "impressions": _int(row.metrics.impressions),
                "conversions": float(row.metrics.conversions or 0),
            })
        return out

    def _campaigns():
        query = (
            "SELECT campaign.name, metrics.cost_micros, metrics.clicks, "
            "metrics.impressions, metrics.conversions, metrics.conversions_value "
            "FROM campaign "
            f"WHERE segments.date BETWEEN '{start}' AND '{end}' "
            "ORDER BY metrics.cost_micros DESC "
            "LIMIT 10"
        )
        out = []
        for row in ga_service.search(customer_id=customer_id, query=query):
            spend = _micros(row.metrics.cost_micros)
            clicks = _int(row.metrics.clicks)
            impressions = _int(row.metrics.impressions)
            conv_value = float(row.metrics.conversions_value or 0)
            out.append({
                "name": row.campaign.name,
                "cost": spend,
                "clicks": clicks,
                "impressions": impressions,
                "conversions": float(row.metrics.conversions or 0),
                "ctr": (clicks / impressions * 100) if impressions else 0.0,
                "roas": (conv_value / spend) if spend else 0.0,
            })
        return out

    return {
        "kpis": kpis,
        "deltas": deltas,
        "by_date": safe(_by_date, []),
        "campaigns": safe(_campaigns, []),
    }
