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
