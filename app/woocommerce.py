"""Read-only WooCommerce-koppeling + ingebouwde demowinkel.

WooCommerce gebruikt geen OAuth: de klant maakt in de webshop (WooCommerce →
Instellingen → Geavanceerd → REST API) een read-only consumer key + secret aan
en voert die met de shop-URL in op de Integraties-pagina. De gegevens worden
(zoals alle tokens) Fernet-versleuteld per organisatie opgeslagen.

Het rapport wordt opgebouwd uit de orders zelf (wc/v3/orders) in plaats van de
legacy reports-endpoints: dat werkt op elke WooCommerce-versie en geeft ons in
één dataset omzet, statussen, betaalmethoden én topproducten.

Demowinkel: met store_url == DEMO_STORE wordt een deterministische generator
gebruikt die orders in exact dezelfde JSON-vorm oplevert als de echte API,
zodat de volledige aggregatie/cache/widget-keten getest kan worden zonder
externe winkel. Alleen de HTTP-laag wordt daarbij overgeslagen.
"""
import ipaddress
import logging
import random
import socket
from datetime import date, timedelta
from urllib.parse import urlparse

import requests

log = logging.getLogger(__name__)

DEMO_STORE = "demo"

_MAX_PAGES = 10          # 10 × 100 orders per rapportperiode
_TIMEOUT = 20

# Statussen die als omzet tellen (zoals WooCommerce's eigen netto-omzetrapport).
_REVENUE_STATUSES = {"completed", "processing"}


class WooError(Exception):
    """Nette foutmelding voor de UI (ongeldige URL, auth mislukt, ...)."""


# ------------------------------------------------------------------ SSRF-guard


def _assert_public_host(host: str) -> None:
    """Weiger een host die (nu) naar een niet-globaal IP resolvet.

    De literal-check in `validate_store_url` vangt alleen IP-adressen in de URL;
    een hostnaam die via DNS naar een privé/loopback/link-local adres wijst
    (bijv. het cloud-metadata-endpoint) zou anders alsnog bereikt worden. We
    resolven daarom vlak vóór elke uitgaande call en eisen dat álle adressen
    globaal zijn. (Volledige bescherming tegen DNS-rebinding vereist IP-pinning,
    wat botst met TLS-certvalidatie; dit sluit het praktische gat.)
    """
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise WooError("Kan de winkel niet bereiken - controleer de URL.") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise WooError("Deze host is niet toegestaan.")


def validate_store_url(url: str) -> str:
    """Normaliseer en valideer een door de gebruiker opgegeven shop-URL.

    De server gaat naar deze URL fetchen, dus dit is een SSRF-oppervlak:
    alleen https, geen loopback/privé/link-local hosts, geen poorten, geen
    credentials in de URL. Geeft de genormaliseerde basis-URL terug.
    """
    parsed = urlparse((url or "").strip())
    if parsed.scheme != "https":
        raise WooError("Gebruik een https://-adres van de winkel.")
    host = parsed.hostname or ""
    if not host or parsed.port or parsed.username or parsed.password:
        raise WooError("Ongeldige winkel-URL.")
    lowered = host.lower()
    if lowered == "localhost" or lowered.endswith(".local") or lowered.endswith(".internal"):
        raise WooError("Deze host is niet toegestaan.")
    try:
        ip = ipaddress.ip_address(lowered)
        if not ip.is_global:
            raise WooError("Deze host is niet toegestaan.")
    except ValueError:
        _assert_public_host(lowered)  # hostnaam: controleer waar hij naar wijst
    return f"https://{host}{parsed.path.rstrip('/')}"


def _host_of(store_url: str) -> str:
    return urlparse(store_url).hostname or ""


def _guarded_get(store_url: str, path: str, auth: tuple[str, str], params: dict):
    """GET met SSRF-guards: host opnieuw valideren, geen redirects volgen."""
    _assert_public_host(_host_of(store_url))
    resp = requests.get(
        f"{store_url}/{path}", params=params, auth=auth,
        timeout=_TIMEOUT, allow_redirects=False,
    )
    if resp.is_redirect or 300 <= resp.status_code < 400:
        # Een winkel die doorverwijst (mogelijk naar een intern doel) vertrouwen we niet.
        raise WooError("De winkel stuurt door naar een ander adres - niet toegestaan.")
    return resp


# ---------------------------------------------------------------- echte winkel


def _fetch_orders(store_url: str, ck: str, cs: str, start: str, end: str) -> list[dict]:
    """Alle orders in [start, end] ophalen (gepagineerd, met plafond)."""
    out = []
    for page in range(1, _MAX_PAGES + 1):
        resp = _guarded_get(
            store_url, "wp-json/wc/v3/orders", (ck, cs),
            {
                "after": f"{start}T00:00:00",
                "before": f"{end}T23:59:59",
                "per_page": 100,
                "page": page,
                "orderby": "date",
                "order": "asc",
            },
        )
        if resp.status_code in (401, 403):
            raise WooError("WooCommerce weigert de sleutel - controleer key/secret en leesrechten.")
        resp.raise_for_status()
        batch = resp.json()
        if not isinstance(batch, list):
            raise WooError("Onverwacht antwoord van de winkel - is dit een WooCommerce-site?")
        out.extend(batch)
        if len(batch) < 100:
            break
    return out


def test_connection(store_url: str, ck: str, cs: str) -> None:
    """Kleine validatiecall bij het koppelen; raise WooError bij mislukking."""
    if store_url == DEMO_STORE:
        return
    try:
        resp = _guarded_get(store_url, "wp-json/wc/v3/orders", (ck, cs), {"per_page": 1})
    except requests.RequestException as exc:
        raise WooError("Kan de winkel niet bereiken - controleer de URL.") from exc
    if resp.status_code in (401, 403):
        raise WooError("WooCommerce weigert de sleutel - controleer key/secret en leesrechten.")
    if resp.status_code == 404:
        raise WooError("Geen WooCommerce REST API gevonden op dit adres.")
    resp.raise_for_status()
    if not isinstance(resp.json(), list):
        raise WooError("Onverwacht antwoord van de winkel - is dit een WooCommerce-site?")


# ------------------------------------------------------------------ demowinkel

_DEMO_PRODUCTS = [
    ("Yogamat Pro", 49.95), ("Hardloopschoenen Vento", 129.00),
    ("Sportfles 750ml", 14.50), ("Fitnessband set", 24.95),
    ("Trainingsshirt Dry-Fit", 34.95), ("Wielrenhandschoenen", 19.95),
    ("Foamroller", 29.95), ("Sporttas 40L", 59.95),
    ("Hartslagmeter HR-2", 79.00), ("Wandelsokken 3-pack", 16.95),
]
_DEMO_PAYMENTS = ["iDEAL", "Creditcard", "PayPal", "Klarna", "Bancontact"]


def _demo_orders(start: str, end: str) -> list[dict]:
    """Deterministische demo-orders, in dezelfde vorm als de wc/v3 API.

    Per dag geseed op de datum, dus dezelfde periode geeft altijd dezelfde
    cijfers (belangrijk voor caching en vergelijkbare periodes). Weekenddagen
    zijn drukker en er zit een licht groeitrendje in.
    """
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    orders, oid = [], 1000
    day = s
    while day <= e:
        rng = random.Random(f"kompas-demo|{day.isoformat()}")
        base = 6 + (2 if day.weekday() >= 5 else 0) + (day.toordinal() % 7) // 3
        for i in range(rng.randint(base - 2, base + 3)):
            oid += 1
            items, total = [], 0.0
            for name, price in rng.sample(_DEMO_PRODUCTS, rng.randint(1, 3)):
                qty = rng.randint(1, 2)
                line = round(price * qty, 2)
                total += line
                items.append({"name": name, "quantity": qty, "total": f"{line:.2f}"})
            roll = rng.random()
            status = ("completed" if roll < 0.72 else
                      "processing" if roll < 0.90 else
                      "refunded" if roll < 0.95 else "cancelled")
            orders.append({
                "id": oid,
                "status": status,
                "date_created": f"{day.isoformat()}T{rng.randint(8, 21):02d}:{rng.randint(0, 59):02d}:00",
                "total": f"{total:.2f}",
                "payment_method_title": rng.choice(_DEMO_PAYMENTS),
                "customer_id": rng.randint(1, 40) if rng.random() < 0.7 else 0,
                "line_items": items,
            })
        day += timedelta(days=1)
    return orders


# ------------------------------------------------------------------ aggregatie


def _num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _aggregate(orders: list[dict]) -> dict:
    """Orders -> kpis + dagreeks + verdelingen + tabellen (één codepad voor
    echte én demo-orders)."""
    revenue = refunded = items_sold = 0.0
    paid_orders = 0
    customers = set()
    by_day: dict[str, dict] = {}
    statuses: dict[str, int] = {}
    payments: dict[str, int] = {}
    products: dict[str, dict] = {}

    for o in orders:
        status = o.get("status") or "onbekend"
        statuses[status] = statuses.get(status, 0) + 1
        total = _num(o.get("total"))
        day = (o.get("date_created") or "")[:10]
        if status == "refunded":
            refunded += total
        if status not in _REVENUE_STATUSES:
            continue
        paid_orders += 1
        revenue += total
        cid = o.get("customer_id")
        customers.add(cid if cid else f"guest-{o.get('id')}")
        pm = o.get("payment_method_title") or "Onbekend"
        payments[pm] = payments.get(pm, 0) + 1
        if day:
            slot = by_day.setdefault(day, {"revenue": 0.0, "orders": 0})
            slot["revenue"] += total
            slot["orders"] += 1
        for li in o.get("line_items") or []:
            name = li.get("name") or "Onbekend product"
            qty = int(_num(li.get("quantity")))
            items_sold += qty
            p = products.setdefault(name, {"qty": 0, "revenue": 0.0})
            p["qty"] += qty
            p["revenue"] += _num(li.get("total"))

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
        "payment_methods": share(payments),
        "top_products": top_products,
    }


def _orders_for(store_url: str, ck: str, cs: str, start: str, end: str) -> list[dict]:
    if store_url == DEMO_STORE:
        return _demo_orders(start, end)
    return _fetch_orders(store_url, ck, cs, start, end)


def run_overview(store_url: str, ck: str, cs: str, start: str, end: str,
                 compare: tuple[str, str] | None = None) -> dict:
    """Winkelrapport voor de periode, met optionele vergelijkingsdelta's."""
    orders = _orders_for(store_url, ck, cs, start, end)
    data = _aggregate(orders)

    deltas = None
    if compare:
        try:
            prev = _aggregate(_orders_for(store_url, ck, cs, compare[0], compare[1]))["kpis"]

            def delta(key):
                c, p = data["kpis"].get(key, 0) or 0, prev.get(key, 0) or 0
                return ((c - p) / p * 100) if p else None

            deltas = {k: delta(k) for k in ("revenue", "orders", "avgOrderValue", "itemsSold", "customers")}
        except Exception as exc:  # noqa: BLE001 - vergelijking mag nooit het rapport breken
            log.warning("woocommerce compare failed: %s", exc)

    recent_orders = [
        {
            "id": o.get("id"),
            "date": (o.get("date_created") or "")[:10],
            "status": o.get("status"),
            "total": _num(o.get("total")),
            "payment": o.get("payment_method_title") or "—",
        }
        for o in sorted(orders, key=lambda o: o.get("date_created") or "", reverse=True)[:10]
    ]
    return {**data, "recent_orders": recent_orders, "deltas": deltas,
            "is_demo": store_url == DEMO_STORE}
