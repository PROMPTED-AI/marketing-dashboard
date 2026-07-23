"""Read-only Shopify Admin API-koppeling.

Het rapport wordt opgebouwd uit de orders (Admin REST ``orders.json``), net als
bij WooCommerce, zodat we in dezelfde vorm omzet, orders, betaalstatussen en
topproducten teruggeven. Alle calls gaan alleen naar het gekoppelde
``*.myshopify.com``-domein (afgedwongen bij het koppelen).
"""
import logging
import random
import re
from datetime import date, timedelta

import requests

from . import config
from .shopify_oauth import ShopifyError, _SHOP_RE

log = logging.getLogger(__name__)

_TIMEOUT = 20
_MAX_PAGES = 10  # 10 × 250 orders per periode

# Ingebouwde demowinkel: net als bij WooCommerce (``woocommerce.DEMO_STORE``)
# krijgt de demo-organisatie een Shopify-koppeling naar dit domein, waarna
# `run_overview` deterministische voorbeeldorders genereert in plaats van de
# echte Admin API aan te roepen.
DEMO_SHOP = "demo.myshopify.com"

# Financiele statussen die als omzet tellen (betaald of deels terugbetaald).
_REVENUE_FINANCIAL = {"paid", "partially_refunded", "partially_paid"}
_LINK_NEXT_RE = re.compile(r'<([^>]+)>;\s*rel="next"')


def _num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _api_base(shop: str) -> str:
    if not _SHOP_RE.match(shop or ""):
        raise ShopifyError("Ongeldig Shopify-adres.")
    return f"https://{shop}/admin/api/{config.SHOPIFY_API_VERSION}"


def _fetch_orders(shop: str, token: str, start: str, end: str) -> list[dict]:
    """Alle orders in [start, end] ophalen (cursor-paginatie via de Link-header)."""
    url = f"{_api_base(shop)}/orders.json"
    params = {
        "status": "any",
        "created_at_min": f"{start}T00:00:00",
        "created_at_max": f"{end}T23:59:59",
        "limit": 250,
    }
    headers = {"X-Shopify-Access-Token": token}
    out: list[dict] = []
    for _ in range(_MAX_PAGES):
        resp = requests.get(url, params=params, headers=headers, timeout=_TIMEOUT)
        if resp.status_code in (401, 403):
            raise ShopifyError("Shopify weigert de koppeling - opnieuw koppelen.")
        resp.raise_for_status()
        batch = (resp.json() or {}).get("orders", [])
        if not isinstance(batch, list):
            raise ShopifyError("Onverwacht antwoord van Shopify.")
        out.extend(batch)
        # Volgende pagina via de Link-header; die bevat de volledige URL.
        m = _LINK_NEXT_RE.search(resp.headers.get("Link", ""))
        if not m:
            break
        url, params = m.group(1), None
    return out


# ------------------------------------------------------------------ demowinkel

_DEMO_PRODUCTS = [
    ("Linnen dekbedovertrek", 79.95), ("Geurkaars Amber", 24.50),
    ("Keramische mok (set van 4)", 29.95), ("Wollen plaid", 89.00),
    ("Bamboe snijplank", 34.95), ("Handdoekenset", 39.95),
    ("Glazen karaf 1L", 22.50), ("Katoenen badjas", 59.95),
    ("Serviesset 4-persoons", 119.00), ("Gietijzeren theepot", 44.95),
]


def _demo_orders(start: str, end: str) -> list[dict]:
    """Deterministische demo-orders in de vorm van de Shopify Admin API.

    Per dag geseed op de datum, dus dezelfde periode geeft altijd dezelfde
    cijfers (belangrijk voor caching en vergelijkbare periodes). Weekenddagen
    zijn wat drukker en er zit een licht trendje in."""
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    orders, oid = [], 5000
    day = s
    while day <= e:
        rng = random.Random(f"kompas-shopify-demo|{day.isoformat()}")
        base = 5 + (2 if day.weekday() >= 5 else 0) + (day.toordinal() % 7) // 3
        for _ in range(rng.randint(max(base - 2, 1), base + 3)):
            oid += 1
            items, subtotal = [], 0.0
            for name, price in rng.sample(_DEMO_PRODUCTS, rng.randint(1, 3)):
                qty = rng.randint(1, 2)
                subtotal += price * qty
                items.append({"name": name, "quantity": qty, "price": f"{price:.2f}"})
            roll = rng.random()
            fin = ("paid" if roll < 0.82 else
                   "pending" if roll < 0.92 else
                   "partially_refunded" if roll < 0.97 else "refunded")
            total = round(subtotal, 2)
            order = {
                "id": oid,
                "financial_status": fin,
                "created_at": f"{day.isoformat()}T{rng.randint(8, 21):02d}:{rng.randint(0, 59):02d}:00Z",
                "total_price": f"{total:.2f}",
                "customer": {"id": rng.randint(1, 60)} if rng.random() < 0.7 else None,
                "line_items": items,
            }
            if fin in ("partially_refunded", "refunded"):
                refund = round(total * (1.0 if fin == "refunded" else 0.3), 2)
                order["refunds"] = [{"transactions": [{"amount": f"{refund:.2f}"}]}]
            orders.append(order)
        day += timedelta(days=1)
    return orders


def _orders_for(shop: str, token: str, start: str, end: str) -> list[dict]:
    """Demowinkel levert gegenereerde orders; anders de echte Admin API."""
    if shop == DEMO_SHOP:
        return _demo_orders(start, end)
    return _fetch_orders(shop, token, start, end)


def _aggregate(orders: list[dict]) -> dict:
    revenue = refunded = 0.0
    paid_orders = items_sold = 0
    customers: set = set()
    by_day: dict[str, dict] = {}
    statuses: dict[str, int] = {}
    products: dict[str, dict] = {}

    for o in orders:
        fin = o.get("financial_status") or "onbekend"
        statuses[fin] = statuses.get(fin, 0) + 1
        refund_total = sum(
            _num(r.get("amount"))
            for tx in (o.get("refunds") or [])
            for r in (tx.get("transactions") or [])
        )
        # Fallback: sommige refunds staan alleen als order_adjustments.
        if not refund_total:
            refund_total = sum(
                abs(_num(a.get("amount")))
                for tx in (o.get("refunds") or [])
                for a in (tx.get("order_adjustments") or [])
            )
        refunded += refund_total
        if fin not in _REVENUE_FINANCIAL:
            continue
        total = _num(o.get("total_price"))
        paid_orders += 1
        revenue += total
        cust = (o.get("customer") or {}).get("id")
        customers.add(cust if cust else f"guest-{o.get('id')}")
        day = (o.get("created_at") or "")[:10]
        if day:
            slot = by_day.setdefault(day, {"revenue": 0.0, "orders": 0})
            slot["revenue"] += total
            slot["orders"] += 1
        for li in o.get("line_items") or []:
            name = li.get("name") or li.get("title") or "Onbekend product"
            qty = int(_num(li.get("quantity")))
            items_sold += qty
            p = products.setdefault(name, {"qty": 0, "revenue": 0.0})
            p["qty"] += qty
            p["revenue"] += _num(li.get("price")) * qty

    def share(counts: dict) -> list[dict]:
        total = sum(counts.values()) or 1
        rows = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
        return [{"label": k, "value": v, "pct": round(v * 100 / total)} for k, v in rows]

    top_products = sorted(
        ({"name": n, **p} for n, p in products.items()),
        key=lambda p: p["revenue"], reverse=True,
    )[:10]

    return {
        "kpis": {
            "revenue": round(revenue, 2),
            "orders": paid_orders,
            "avgOrderValue": round(revenue / paid_orders, 2) if paid_orders else 0.0,
            "itemsSold": int(items_sold),
            "customers": len(customers),
            "refunded": round(refunded, 2),
        },
        "by_date": [
            {"date": d.replace("-", ""), "revenue": round(v["revenue"], 2), "orders": v["orders"]}
            for d, v in sorted(by_day.items())
        ],
        "statuses": share(statuses),
        "top_products": top_products,
    }


def run_overview(shop: str, token: str, start: str, end: str,
                 compare: tuple[str, str] | None = None) -> dict:
    """Winkelrapport voor de periode, met optionele vergelijkingsdelta's."""
    orders = _orders_for(shop, token, start, end)
    data = _aggregate(orders)

    if compare:
        try:
            prev = _aggregate(_orders_for(shop, token, compare[0], compare[1]))["kpis"]

            def delta(key):
                c, p = data["kpis"].get(key, 0) or 0, prev.get(key, 0) or 0
                return ((c - p) / p * 100) if p else None

            data["deltas"] = {k: delta(k) for k in ("revenue", "orders", "avgOrderValue", "itemsSold", "customers")}
        except Exception as exc:  # noqa: BLE001 - vergelijking mag nooit het rapport breken
            log.warning("shopify compare failed: %s", exc)

    data["recent_orders"] = [
        {
            "id": o.get("id"),
            "date": (o.get("created_at") or "")[:10],
            "status": o.get("financial_status"),
            "total": _num(o.get("total_price")),
        }
        for o in sorted(orders, key=lambda o: o.get("created_at") or "", reverse=True)[:10]
    ]
    return data


def fetch_shop_info(shop: str, token: str) -> dict:
    """Winkelnaam + eigenaars-e-mail via shop.json (best-effort, faalt zacht).

    Gebruikt bij een self-serve App Store-installatie om de nieuwe organisatie een
    nette naam te geven. Elke fout levert lege velden op; de koppeling zelf gaat
    daar niet op stuk."""
    try:
        resp = requests.get(
            f"{_api_base(shop)}/shop.json",
            headers={"X-Shopify-Access-Token": token}, timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        s = (resp.json() or {}).get("shop", {})
        return {"name": s.get("name"), "email": s.get("email")}
    except (requests.RequestException, ValueError, ShopifyError):
        return {"name": None, "email": None}


def test_connection(shop: str, token: str) -> None:
    """Kleine validatiecall bij het koppelen; raise ShopifyError bij mislukking."""
    try:
        resp = requests.get(
            f"{_api_base(shop)}/shop.json",
            headers={"X-Shopify-Access-Token": token}, timeout=_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise ShopifyError("Kan de winkel niet bereiken.") from exc
    if resp.status_code in (401, 403):
        raise ShopifyError("Shopify weigert het token.")
    resp.raise_for_status()
