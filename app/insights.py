"""Rule-based proactive insights: notable period-over-period changes per channel.

Pure functions (no I/O). `main.py` fetches each connected channel's overview
(with a comparison period so deltas exist) and feeds the values + deltas here.
Deterministic, free, instant — no LLM call.
"""

# Per channel: display label + the metrics we surface, each as
# (nl_label, higher_is_better, kind). higher_is_better=None => neutral/informational.
_CHANNELS = {
    "analytics": {
        "label": "Analytics",
        "metrics": {
            "users": ("bezoekers", True, "count"),
            "sessions": ("sessies", True, "count"),
            "conversions": ("conversies", True, "count"),
            "bounceRate": ("bouncepercentage", False, "rate"),
            "engagementRate": ("betrokkenheid", True, "rate"),
        },
    },
    "search_console": {
        "label": "Search Console",
        "metrics": {
            "clicks": ("organische klikken", True, "count"),
            "impressions": ("vertoningen in Google", True, "count"),
            "position": ("gemiddelde positie", False, "rate"),
        },
    },
    "google_ads": {
        "label": "Google Ads",
        "metrics": {
            "conversions": ("Ads-conversies", True, "count"),
            "cpc": ("kosten per klik", False, "rate"),
            "roas": ("ROAS", True, "rate"),
            "cost": ("advertentie-uitgaven", None, "count"),
        },
    },
    "meta_ads": {
        "label": "META",
        "metrics": {
            "reach": ("bereik", True, "count"),
            "clicks": ("klikken", True, "count"),
            "ctr": ("CTR", True, "rate"),
            "spend": ("Meta-uitgaven", None, "count"),
        },
    },
}

SIGNIFICANT = 15.0  # percent change worth surfacing
_COUNT_FLOOR = {"conversions": 3, "cost": 1, "spend": 1}  # else 10; avoids noise on tiny numbers


def _question(label: str, up: bool, neutral: bool) -> str:
    if neutral:
        return f"Is de verandering in mijn {label} rendabel geweest?"
    if up:
        return f"Wat zit er achter de stijging van mijn {label} deze periode?"
    return f"Waarom daalde mijn {label} deze periode en wat kan ik eraan doen?"


def from_channel(channel: str, values: dict, deltas: dict | None) -> list[dict]:
    """Delta-based insights for one channel."""
    spec = _CHANNELS.get(channel)
    if not spec or not deltas:
        return []
    values = values or {}
    out = []
    for key, (label, higher_better, kind) in spec["metrics"].items():
        d = deltas.get(key)
        if d is None or abs(d) < SIGNIFICANT:
            continue
        if kind == "count" and (values.get(key, 0) or 0) < _COUNT_FLOOR.get(key, 10):
            continue
        up = d > 0
        neutral = higher_better is None
        severity = "neutral" if neutral else ("positive" if up == higher_better else "negative")
        pct = f"{abs(d):.0f}%"
        richting = "steeg" if up else "daalde"
        out.append({
            "channel": channel,
            "channel_label": spec["label"],
            "severity": severity,
            "delta": round(d, 1),
            "title": f"{label.capitalize()} {'+' if up else '−'}{pct}",
            "detail": f"{label.capitalize()} {richting} {pct} t.o.v. de vorige periode.",
            "question": _question(label, up, neutral),
        })
    return out


def search_opportunities(sc_data: dict) -> list[dict]:
    """Standing SEO quick-win signal, independent of period-over-period change."""
    opps = (sc_data or {}).get("opportunities") or []
    if not opps:
        return []
    n = len(opps)
    return [{
        "channel": "search_console",
        "channel_label": "Search Console",
        "severity": "neutral",
        "delta": None,
        "title": f"{n} SEO-kansen",
        "detail": f"{n} zoekopdrachten staan net buiten pagina 1 (positie 11–20) met veel vertoningen.",
        "question": "Welke SEO-quick-wins heb ik en hoe pak ik ze aan?",
    }]


def rank(items: list[dict], limit: int = 6) -> list[dict]:
    """Biggest movers first; standing signals (no delta) after, capped."""
    return sorted(items, key=lambda i: (i.get("delta") is None, -abs(i.get("delta") or 0)))[:limit]


def combine(ga: dict | None, gsc: dict | None, ads: dict | None,
            mads: dict | None, woo: dict | None) -> dict:
    """Cross-channel figures with the relationships computed server-side (blended
    ROAS, total ad spend, paid conversions, cost per conversion, traffic mix).
    Pure and deterministic; the single source of truth shared by the assistant's
    marketing overview and the cross-channel signals. Missing channels drop out."""
    def r2(v):
        return round(v, 2) if isinstance(v, (int, float)) else v

    ads_cost = (ads or {}).get("kpis", {}).get("cost")
    meta_spend = (mads or {}).get("kpis", {}).get("spend")
    spend_parts = {k: v for k, v in (("google_ads", ads_cost), ("meta_ads", meta_spend)) if v}
    ad_spend_total = round(sum(spend_parts.values()), 2) if spend_parts else None

    woo_revenue = (woo or {}).get("kpis", {}).get("revenue")
    ga_revenue = (ga or {}).get("kpis", {}).get("revenue")
    if woo_revenue:
        revenue_total, revenue_source = round(woo_revenue, 2), "woocommerce"
    elif ga_revenue:
        revenue_total, revenue_source = round(ga_revenue, 2), "google_analytics"
    else:
        revenue_total, revenue_source = None, None

    blended_roas = (
        round(revenue_total / ad_spend_total, 2)
        if revenue_total and ad_spend_total else None
    )
    ads_conv = (ads or {}).get("kpis", {}).get("conversions") or 0
    meta_results = sum((r.get("count") or 0) for r in (mads or {}).get("results", []) or [])
    paid_conversions = round(ads_conv + meta_results, 1) or None
    blended_cpa = (
        round(ad_spend_total / paid_conversions, 2)
        if ad_spend_total and paid_conversions else None
    )

    # Traffic mix from GA channel groups (share of sessions).
    traffic_mix = None
    if ga and ga.get("channels"):
        buckets = {"organisch": 0, "betaald": 0, "direct": 0, "social": 0, "overig": 0}
        for c in ga["channels"]:
            label = (c.get("label") or "").lower()
            v = c.get("value") or c.get("sessions") or 0
            if "paid" in label or "cpc" in label:
                buckets["betaald"] += v
            elif "organic search" in label:
                buckets["organisch"] += v
            elif "social" in label:
                buckets["social"] += v
            elif "direct" in label:
                buckets["direct"] += v
            else:
                buckets["overig"] += v
        tot = sum(buckets.values()) or 1
        traffic_mix = {k: round(v * 100 / tot) for k, v in buckets.items() if v}

    return {
        "advertentie_uitgaven_totaal": ad_spend_total,
        "advertentie_uitgaven_per_kanaal": {k: r2(v) for k, v in spend_parts.items()} or None,
        "omzet_totaal": revenue_total,
        "omzet_bron": revenue_source,
        "blended_roas": blended_roas,  # omzet / advertentie-uitgaven
        "betaalde_conversies": paid_conversions,
        "kosten_per_conversie": blended_cpa,
        "verkeersverdeling_pct": traffic_mix,
        "organische_zoekklikken": (gsc or {}).get("totals", {}).get("clicks"),
    }


# Blended ROAS onder deze drempel: advertenties leveren minder dan 2x hun kosten
# op. Boven deze verkeersaandeel-drempel leun je sterk op betaald verkeer.
_ROAS_FLOOR = 2.0
_PAID_TRAFFIC_CEIL = 55


def cross_channel(combined: dict, ads: dict | None = None) -> list[dict]:
    """Signalen die pas ontstaan als je kanalen combineert: rendement onder druk,
    opschaalkans, lage blended ROAS en afhankelijkheid van betaald verkeer. Elk
    signaal draagt channel='cross' zodat de UI ze onder 'Alle kanalen' groepeert."""
    out: list[dict] = []
    ad = {
        "channel": "cross",
        "channel_label": "Alle kanalen",
    }
    deltas = (ads or {}).get("deltas") or {}
    spend_total = combined.get("advertentie_uitgaven_totaal")
    roas = combined.get("blended_roas")

    # Rendement onder druk: Google Ads-uitgaven stijgen fors terwijl de conversies
    # nauwelijks meegroeien. De duidelijkste "let op" voor een marketeer.
    cost_d, conv_d = deltas.get("cost"), deltas.get("conversions")
    if cost_d is not None and cost_d >= SIGNIFICANT and (conv_d is None or conv_d <= 5):
        conv_txt = "bleven de conversies vlak" if conv_d is None or abs(conv_d) < 5 else (
            f"stegen de conversies maar {conv_d:.0f}%" if conv_d > 0 else f"daalden de conversies {abs(conv_d):.0f}%")
        out.append({**ad, "severity": "negative", "delta": round(cost_d, 1),
                    "title": f"Uitgaven +{cost_d:.0f}%, conversies blijven achter",
                    "detail": f"Je Google Ads-uitgaven stegen {cost_d:.0f}% terwijl {conv_txt} t.o.v. de vorige periode.",
                    "question": "Mijn advertentie-uitgaven stijgen sneller dan mijn conversies. Waar zit dat in en wat kan ik doen om het rendement te verbeteren?"})

    # Opschaalkans: ROAS stijgt sterk, dan is er vaak ruimte om budget te verhogen.
    roas_d = deltas.get("roas")
    if roas_d is not None and roas_d >= SIGNIFICANT:
        out.append({**ad, "severity": "positive", "delta": round(roas_d, 1),
                    "title": f"ROAS +{roas_d:.0f}%: ruimte om op te schalen",
                    "detail": f"Je rendement op advertenties (ROAS) steeg {roas_d:.0f}%. Vaak is er dan ruimte om het budget te verhogen.",
                    "question": "Mijn ROAS is gestegen. Op welke campagnes kan ik het beste opschalen en waar moet ik op letten?"})

    # Lage blended ROAS: staande waarschuwing, los van periode-verandering.
    if roas is not None and spend_total and roas < _ROAS_FLOOR:
        out.append({**ad, "severity": "negative", "delta": None,
                    "title": f"Blended ROAS {roas:.1f}",
                    "detail": f"Over alle advertenties samen lever je {roas:.1f}x je uitgaven terug. Onder 2x staat het rendement onder druk.",
                    "question": "Mijn blended ROAS is laag. Welke kanalen of campagnes trekken het gemiddelde omlaag en hoe verbeter ik dit?"})

    # Afhankelijkheid van betaald verkeer: staande, informatieve observatie.
    mix = combined.get("verkeersverdeling_pct") or {}
    betaald = mix.get("betaald")
    if betaald and betaald >= _PAID_TRAFFIC_CEIL:
        out.append({**ad, "severity": "neutral", "delta": None,
                    "title": f"{betaald:.0f}% van je verkeer is betaald",
                    "detail": f"Een groot deel van je bezoekers ({betaald:.0f}%) komt via betaalde kanalen. Meer organisch verkeer maakt je minder afhankelijk van advertentiebudget.",
                    "question": "Een groot deel van mijn verkeer is betaald. Hoe bouw ik meer organisch verkeer op om minder afhankelijk te zijn van advertenties?"})

    return out
