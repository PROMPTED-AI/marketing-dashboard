"""Raamwerk: maandelijkse KPI-tabel (leadgeneratie en e-commerce).

Het raamwerk toont per maand een vaste set KPI-rijen, zoals een bureau die in
een spreadsheet bijhoudt: automatische waarden uit de gekoppelde kanalen
(advertentiekosten, bezoekers, conversies, omzet, orders), handmatige invulvelden
(budget, inkoopwaarde, retouren, kosten per klant) en daarvan afgeleide cijfers
(ROAS, POAS, kosten per lead, conversiepercentage). De afgeleide waarden worden
server-side berekend zodat elke weergave dezelfde formules gebruikt.
"""
import logging
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from .. import analytics, auth, cache, demo, google_ads, meta, models, woocommerce
from ..org_access import (
    _connected, _google_data, _meta_token, _org_credentials, _resolve_org_id, _wc_creds,
)

log = logging.getLogger("dashboard")
router = APIRouter()

# Handmatig in te vullen velden (per organisatie per maand opgeslagen).
MANUAL_KEYS = ("budget", "kosten_per_klant", "inkoopwaarde", "returns")
BTW_FACTOR = 1.21
MAX_MONTHS = 24


def _month_range(month: str) -> tuple[str, str]:
    """(start, eind) van een maand 'JJJJ-MM'; de lopende maand eindigt vandaag."""
    try:
        y_s, m_s = month.split("-")
        first = date(int(y_s), int(m_s), 1)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Ongeldige maand (verwacht JJJJ-MM)")
    today = date.today()
    if first > today:
        raise HTTPException(status_code=400, detail="Deze maand ligt in de toekomst")
    if first.month == 12:
        next_first = date(first.year + 1, 1, 1)
    else:
        next_first = date(first.year, first.month + 1, 1)
    end = min(next_first - timedelta(days=1), today)
    return first.isoformat(), end.isoformat()


def _last_months(count: int) -> list[str]:
    """De laatste `count` maanden als 'JJJJ-MM', oudste eerst, t/m de lopende maand."""
    today = date.today()
    y, m = today.year, today.month
    out = []
    for _ in range(count):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(out))


def _auto_values(org_id: str, month: str, property_id: str | None) -> dict:
    """Automatische kanaalcijfers voor één maand.

    Elk kanaal wordt defensief opgehaald: niet gekoppeld, geen data of een
    API-fout betekent None voor dat kanaal, nooit een kapotte tabel. De demo-org
    krijgt gegenereerde voorbeelddata; echte organisaties worden per maand
    gecachet (afgesloten maanden lang, de lopende maand kort).
    """
    start, end = _month_range(month)

    if models.is_demo_org(org_id):
        ga = demo.overview(start, end, None)
        ads = demo.ads_overview(start, end, None)
        mads = demo.meta_ads_overview(start, end, None)
        woo = None
    else:
        key = f"{org_id}|framework|{month}|{property_id or '-'}"
        cached = cache.get(key)
        if cached is not None:
            return cached

        def safe(name, fn):
            try:
                return fn()
            except Exception as exc:  # noqa: BLE001 - één kanaal mag de tabel nooit breken
                log.warning("raamwerk: %s overslaan org=%s maand=%s err=%r", name, org_id, month, exc)
                return None

        def fetch_ga():
            if not _connected(org_id, "google_analytics"):
                return None
            creds = _org_credentials(org_id)
            prop = property_id
            if not prop:
                props = _google_data(org_id, "google_analytics", lambda: analytics.list_properties(creds))
                prop = props[0]["property_id"] if props else None
            if not prop:
                return None
            return _google_data(org_id, "google_analytics",
                                lambda: analytics.run_ga_overview(creds, prop, start, end, None))

        def fetch_ads():
            if not _connected(org_id, "google_ads"):
                return None
            creds = _org_credentials(org_id, provider="google_ads")
            accounts = google_ads.list_accounts(creds)
            if not accounts:
                return None
            return google_ads.run_overview(creds, accounts[0]["customer_id"], start, end, None)

        def fetch_meta():
            if not _connected(org_id, "meta_ads"):
                return None
            token = _meta_token(org_id)
            accounts = meta.list_assets(token).get("ad_accounts") or []
            if not accounts:
                return None
            return meta.ads_overview(token, accounts[0]["id"], start, end, None)

        def fetch_woo():
            if not _connected(org_id, "woocommerce"):
                return None
            store, ck, cs = _wc_creds(org_id)
            return woocommerce.run_overview(store, ck, cs, start, end, None)

        ga = safe("analytics", fetch_ga)
        ads = safe("google_ads", fetch_ads)
        mads = safe("meta_ads", fetch_meta)
        woo = safe("woocommerce", fetch_woo)

    def r2(v):
        return round(v, 2) if isinstance(v, (int, float)) else v

    ga_kpis = (ga or {}).get("kpis", {})
    ads_google = r2((ads or {}).get("kpis", {}).get("cost"))
    ads_meta = r2((mads or {}).get("kpis", {}).get("spend"))
    spend_parts = [v for v in (ads_google, ads_meta) if v is not None]
    ads_kosten = r2(sum(spend_parts)) if spend_parts else None

    woo_kpis = (woo or {}).get("kpis", {})
    omzet = woo_kpis.get("revenue")
    omzet_bron = "woocommerce" if omzet is not None else None
    if omzet is None and ga_kpis.get("revenue"):
        omzet, omzet_bron = ga_kpis.get("revenue"), "google_analytics"
    orders = woo_kpis.get("orders")
    if orders is None:
        orders = ga_kpis.get("transactions")

    auto = {
        "ads_google": ads_google,
        "ads_meta": ads_meta,
        "ads_kosten": ads_kosten,
        "conversies": ga_kpis.get("conversions"),
        "bezoekers": ga_kpis.get("users"),
        "omzet_excl": r2(omzet),
        "omzet_bron": omzet_bron,
        "orders": orders,
    }
    if not models.is_demo_org(org_id):
        cache.set(f"{org_id}|framework|{month}|{property_id or '-'}", auto, cache.ttl_for_range(end))
    return auto


def _derived(auto: dict, manual: dict) -> dict:
    """Alle afgeleide cijfers; de frontend toont per raamwerk de relevante subset.

    Ontbrekende verplichte invoer (bijvoorbeeld geen advertentiekosten) geeft
    None; optionele handmatige velden (inkoop, retouren, budget) tellen als 0
    zolang ze niet zijn ingevuld, precies zoals in het spreadsheet-origineel.
    """
    ads = auto.get("ads_kosten")
    conversies = auto.get("conversies")
    bezoekers = auto.get("bezoekers")
    omzet = auto.get("omzet_excl")
    orders = auto.get("orders")
    inkoop = manual.get("inkoopwaarde") or 0
    returns = manual.get("returns") or 0
    budget = manual.get("budget") or 0

    def ratio(num, den, digits=2):
        if num is None or not den:
            return None
        return round(num / den, digits)

    conversie_pct = ratio((conversies or 0) * 100, bezoekers) if conversies is not None else None
    conversie_pct_orders = ratio((orders or 0) * 100, bezoekers) if orders is not None else None

    return {
        "conversie_pct": conversie_pct,
        "conversie_pct_orders": conversie_pct_orders,
        "kosten_per_lead": ratio(ads, conversies),
        "omzet_incl": round(omzet * BTW_FACTOR, 2) if omzet is not None else None,
        "roi_marketing": ratio((omzet - ads), ads) if omzet is not None and ads else None,
        "roas": ratio(omzet, ads),
        "gem_orderwaarde": ratio(omzet, orders),
        "poas": ratio((omzet - inkoop - returns), ads) if omzet is not None and ads else None,
        "poas_excl_bureau": (
            ratio((omzet - inkoop - returns - budget), ads)
            if omzet is not None and ads else None
        ),
    }


def _month_payload(org_id: str, month: str, property_id: str | None, manual_by_month: dict) -> dict:
    start, end = _month_range(month)
    auto = _auto_values(org_id, month, property_id)
    manual = {k: v for k, v in (manual_by_month.get(month) or {}).items() if k in MANUAL_KEYS}
    return {
        "month": month,
        "start": start,
        "end": end,
        "auto": auto,
        "manual": manual,
        "derived": _derived(auto, manual),
    }


@router.get("/api/framework")
def framework(request: Request, months: int = 3, property_id: str | None = None, org_id: str | None = None):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    months = max(1, min(int(months), MAX_MONTHS))
    month_list = _last_months(months)
    manual_by_month = models.get_framework_values(target_org, month_list)
    org = models.get_organization(target_org) or {}
    return {
        "org_id": target_org,
        "business_type": org.get("business_type") or "leadgen",
        "months": [_month_payload(target_org, m, property_id, manual_by_month) for m in month_list],
    }


class FrameworkValuesIn(BaseModel):
    values: dict[str, float | None]


@router.put("/api/framework/{month}")
def save_framework(request: Request, month: str, payload: FrameworkValuesIn,
                   property_id: str | None = None, org_id: str | None = None):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    _month_range(month)  # valideert het formaat en weigert toekomstige maanden
    values = {}
    for k, v in payload.values.items():
        if k not in MANUAL_KEYS:
            raise HTTPException(status_code=400, detail=f"Onbekend veld: {k}")
        if v is not None and (v < 0 or v > 1e12):
            raise HTTPException(status_code=400, detail="Waarde moet 0 of hoger zijn")
        values[k] = v
    if values:
        models.save_framework_values(target_org, month, values)
    manual_by_month = models.get_framework_values(target_org, [month])
    return {"org_id": target_org, **_month_payload(target_org, month, property_id, manual_by_month)}
