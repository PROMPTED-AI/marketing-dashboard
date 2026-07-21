"""Demo account + generated sample data.

The demo organization (flagged ``is_demo``) serves realistic, deterministic
sample data instead of live Google data, so the product can be demonstrated
without connecting a real Google account.

Everything is derived from SHA-256 of the inputs (dates, labels), so the same
date range always renders the same numbers — across restarts and instances —
while different ranges still look naturally different.

Google Analytics, Search Console, Google Ads and Meta (Ads + Organic) are all
generated here. WooCommerce reuses the app's built-in demo store
(``woocommerce.DEMO_STORE``): the demo org simply gets a real ``woocommerce``
connection row pointing at it, so that dashboard fills via the normal path.
"""
import hashlib
import time
from datetime import date, datetime, timedelta

from . import auth, models, woocommerce

DEMO_ORG_NAME = "Janssen"
DEMO_ORG_DOMAIN = "janssen.nl"
DEMO_EMAIL = "info@janssen.nl"
DEMO_PASSWORD = "janssen123"
DEMO_SITE = "https://www.janssen.nl/"

DEMO_PROPERTIES = [
    {"property_id": "demo-janssen", "display_name": "janssen.nl · website", "account": "Janssen"},
]

DEMO_SITES = [{"site_url": DEMO_SITE, "permission": "siteFullUser"}]

# Google Ads: accounts the demo "connection" exposes.
DEMO_ADS_ACCOUNTS = [{"customer_id": "demo-1234567890", "name": "Janssen · Google Ads"}]

# Meta: ad accounts + pages (with linked Instagram) the demo exposes.
DEMO_META_ASSETS = {
    "ad_accounts": [{"id": "act_demo_janssen", "name": "Janssen · Adverteren", "currency": "EUR"}],
    "pages": [
        {
            "id": "demo_page_janssen",
            "name": "Janssen",
            "instagram": {"id": "demo_ig_janssen", "username": "janssen.nl"},
        }
    ],
}


# --------------------------------------------------------------------- seeding


def seed() -> None:
    """Create the demo org + user (email/password) and connect the demo shop.

    Idempotent: safe to run on every startup. Never raises on a partial state.
    """
    org = models.create_demo_organization(DEMO_ORG_NAME, DEMO_ORG_DOMAIN)
    models.upsert_user(DEMO_EMAIL, org["id"], auth.role_for(DEMO_EMAIL))
    user = models.get_user_by_email(DEMO_EMAIL)
    if user and not user.get("password_hash"):
        models.set_user_password(DEMO_EMAIL, auth.hash_password(DEMO_PASSWORD))
    # Wire up the built-in WooCommerce demo store so that dashboard fills too.
    if not models.get_connection(org["id"], provider="woocommerce"):
        models.save_connection(
            org["id"], "Demowinkel (voorbeelddata)",
            {"store_url": woocommerce.DEMO_STORE, "consumer_key": "", "consumer_secret": ""},
            provider="woocommerce",
        )


# ------------------------------------------------------------------ generators


def _rand(*keys) -> float:
    """Deterministic pseudo-random float in [0, 1) from the given keys."""
    h = hashlib.sha256("|".join(str(k) for k in keys).encode()).digest()
    return int.from_bytes(h[:8], "big") / 2**64


def _jitter(*keys, spread: float = 0.2) -> float:
    """Multiplier around 1.0 (± spread/2)."""
    return 1 + (_rand(*keys) - 0.5) * spread


def _parse(day: str) -> date:
    return datetime.strptime(day, "%Y-%m-%d").date()


def _days(start: str, end: str) -> list[date]:
    a, b = _parse(start), _parse(end)
    return [a + timedelta(days=i) for i in range((b - a).days + 1)]


def _daily_sessions(d: date) -> int:
    """Sessions for one day: weekday pattern + slow growth + noise."""
    weekday = [1.06, 1.12, 1.10, 1.04, 0.95, 0.72, 0.68][d.weekday()]
    trend = 1 + (d.toordinal() - date(2026, 1, 1).toordinal()) * 0.0008
    return max(5, round(380 * weekday * trend * _jitter("sessions", d, spread=0.3)))


def _day_row(d: date) -> dict:
    """One day of GA metrics, all derived from that day's sessions.

    Keys match analytics.run_ga_overview's ``series_by_date`` rows (plus the
    extra metrics main's widget catalog reads: engagedSessions, revenue)."""
    sessions = _daily_sessions(d)
    users = round(sessions * 0.78 * _jitter("users", d))
    return {
        "date": d.strftime("%Y%m%d"),
        "sessions": sessions,
        "users": users,
        "newUsers": round(users * 0.42 * _jitter("new", d)),
        "pageViews": round(sessions * 3.4 * _jitter("pv", d)),
        "eventCount": round(sessions * 9.2 * _jitter("ev", d)),
        "conversions": round(sessions * 0.031 * _jitter("conv", d)),
        "engagedSessions": round(sessions * 0.58 * _jitter("engs", d)),
        "revenue": round(sessions * 2.2 * _jitter("rev", d), 2),
        # E-commerce funnel per dag: winkelwagen -> checkout -> bestelling.
        "addToCarts": round(sessions * 0.085 * _jitter("cart", d)),
        "checkouts": round(sessions * 0.034 * _jitter("chk", d)),
        "transactions": round(sessions * 0.014 * _jitter("trans", d)),
        "bounceRate": 0.41 * _jitter("bounce", d, spread=0.15),
        "avgSessionDuration": 168.0 * _jitter("dur", d, spread=0.15),
        "avgEngagementTime": 92.0 * _jitter("eng-t", d, spread=0.15),
        "engagementRate": 0.58 * _jitter("eng", d, spread=0.1),
    }


def _series(start: str, end: str) -> list[dict]:
    return [_day_row(d) for d in _days(start, end)]


def _totals(series: list[dict]) -> dict:
    """Aggregate a day series into period KPIs (sums + weighted averages)."""
    n = len(series) or 1
    s = lambda k: sum(r[k] for r in series)  # noqa: E731
    avg = lambda k: sum(r[k] for r in series) / n  # noqa: E731
    sessions = s("sessions")
    users = s("users")
    pageViews = s("pageViews")
    transactions = s("transactions")
    revenue = round(s("revenue"), 2)
    return {
        "sessions": sessions,
        "users": users,
        "newUsers": s("newUsers"),
        "pageViews": pageViews,
        "eventCount": s("eventCount"),
        "conversions": s("conversions"),
        "engagedSessions": s("engagedSessions"),
        "revenue": revenue,
        "addToCarts": s("addToCarts"),
        "checkouts": s("checkouts"),
        "transactions": transactions,
        "avgOrderValue": round(revenue / transactions, 2) if transactions else 0.0,
        "firstTimePurchasers": round(transactions * 0.62),
        "bounceRate": avg("bounceRate"),
        "engagementRate": avg("engagementRate"),
        "avgSessionDuration": avg("avgSessionDuration"),
        "avgEngagementTime": avg("avgEngagementTime"),
        "viewsPerSession": (pageViews / sessions) if sessions else 0.0,
        "sessionsPerUser": (sessions / users) if users else 0.0,
    }


def _breakdown(shares: list[tuple[str, float]], total: int, seed: str) -> list[dict]:
    rows = []
    for label, share in shares:
        rows.append((label, max(0, round(total * share * _jitter(seed, label)))))
    grand = sum(v for _, v in rows) or 1
    out = []
    for label, v in rows:
        item = {"label": label, "value": v, "pct": round(v * 100 / grand)}
        item["sessions"] = v  # back-compat with screens that read .sessions
        out.append(item)
    return out


def overview(start: str, end: str, compare: tuple[str, str] | None = None) -> dict:
    """Same shape as analytics.run_ga_overview, but generated."""
    series_by_date = _series(start, end)
    cur = _totals(series_by_date)
    kpis = {
        "users": cur["users"],
        "newUsers": cur["newUsers"],
        "sessions": cur["sessions"],
        "engagedSessions": cur["engagedSessions"],
        "pageViews": cur["pageViews"],
        "bounceRate": cur["bounceRate"],
        "avgSessionDuration": cur["avgSessionDuration"],
        "avgEngagementTime": cur["avgEngagementTime"],
        "engagementRate": cur["engagementRate"],
        "viewsPerSession": cur["viewsPerSession"],
        "sessionsPerUser": cur["sessionsPerUser"],
        "eventCount": cur["eventCount"],
        "conversions": cur["conversions"],
        "revenue": cur["revenue"],
        "transactions": cur["transactions"],
        "avgOrderValue": cur["avgOrderValue"],
        "addToCarts": cur["addToCarts"],
        "checkouts": cur["checkouts"],
        "firstTimePurchasers": cur["firstTimePurchasers"],
    }

    deltas = None
    if compare:
        prev = _totals(_series(compare[0], compare[1]))
        deltas = {
            k: ((cur[k] - prev[k]) / prev[k] * 100) if prev.get(k) else None
            for k in (
                "users", "newUsers", "sessions", "engagedSessions", "pageViews",
                "bounceRate", "avgSessionDuration", "engagementRate", "eventCount",
                "conversions", "revenue", "viewsPerSession", "sessionsPerUser",
                "transactions", "avgOrderValue", "addToCarts", "checkouts",
                "firstTimePurchasers",
            )
        }

    # sessions_by_date kept for back-compat; series_by_date is what the widget
    # catalog reads (GA returns dates as YYYYMMDD).
    sessions_by_date = [{"date": r["date"], "sessions": r["sessions"]} for r in series_by_date]
    compare_series = None
    if compare:
        compare_series = [_daily_sessions(d) for d in _days(compare[0], compare[1])]

    seed = f"{start}|{end}"
    sessions = cur["sessions"]
    channels = _breakdown(
        [("Organic Search", 0.38), ("Direct", 0.22), ("Paid Search", 0.14),
         ("Organic Social", 0.10), ("Referral", 0.09), ("Email", 0.07)],
        sessions, seed + "ch",
    )
    devices = _breakdown(
        [("mobile", 0.55), ("desktop", 0.38), ("tablet", 0.07)], sessions, seed + "dev"
    )
    geography = _breakdown(
        [("Netherlands", 0.78), ("Belgium", 0.09), ("Germany", 0.06),
         ("United Kingdom", 0.04), ("United States", 0.03)],
        sessions, seed + "geo",
    )
    source_medium = _breakdown(
        [("google / organic", 0.36), ("(direct) / (none)", 0.22), ("google / cpc", 0.14),
         ("facebook.com / referral", 0.08), ("nieuwsbrief / email", 0.07), ("bing / organic", 0.05)],
        sessions, seed + "sm",
    )
    first_user_channels = _breakdown(
        [("Organic Search", 0.41), ("Direct", 0.19), ("Paid Search", 0.15),
         ("Organic Social", 0.11), ("Referral", 0.08), ("Email", 0.06)],
        sessions, seed + "fuc",
    )
    first_user_source_medium = _breakdown(
        [("google / organic", 0.39), ("(direct) / (none)", 0.19), ("google / cpc", 0.15),
         ("facebook.com / referral", 0.09), ("nieuwsbrief / email", 0.06), ("bing / organic", 0.05)],
        sessions, seed + "fusm",
    )
    session_campaigns = _breakdown(
        [("(organic)", 0.42), ("(direct)", 0.22), ("voorjaarsactie-2026", 0.13),
         ("merk-altijd-aan", 0.10), ("nieuwsbrief-juni", 0.07), ("retargeting", 0.06)],
        sessions, seed + "camp",
    )
    browsers = _breakdown(
        [("Chrome", 0.52), ("Safari", 0.27), ("Edge", 0.10),
         ("Firefox", 0.07), ("Samsung Internet", 0.04)],
        sessions, seed + "br",
    )
    new_vs_returning = _breakdown(
        [("new", 0.62), ("returning", 0.38)], sessions, seed + "nvr"
    )
    events = _breakdown(
        [("page_view", 0.37), ("user_engagement", 0.18), ("session_start", 0.11),
         ("scroll", 0.10), ("click", 0.08), ("view_item", 0.07),
         ("form_start", 0.05), ("form_submit", 0.04)],
        cur["eventCount"], seed + "evb",
    )

    def pages(defs, total, key):
        return [
            {
                "path": path,
                "views": max(1, round(total * share * _jitter(seed, key, path))),
                "bounceRate": bounce * _jitter(seed, key + "b", path),
            }
            for path, share, bounce in defs
        ]

    top_pages = pages(
        [("/", 0.24, 0.35), ("/producten", 0.16, 0.38), ("/diensten", 0.12, 0.41),
         ("/over-ons", 0.09, 0.44), ("/blog/5-marketing-tips", 0.07, 0.52),
         ("/contact", 0.06, 0.30)],
        cur["pageViews"], "tp",
    )
    landing_pages = pages(
        [("/", 0.34, 0.36), ("/producten", 0.18, 0.40), ("/diensten", 0.13, 0.42),
         ("/blog/5-marketing-tips", 0.09, 0.55), ("/offerte", 0.07, 0.28),
         ("/contact", 0.05, 0.31)],
        sessions, "lp",
    )
    page_titles = pages(
        [("Home · Janssen", 0.24, 0.35), ("Producten · Janssen", 0.16, 0.38),
         ("Diensten · Janssen", 0.12, 0.41), ("Over ons · Janssen", 0.09, 0.44),
         ("5 marketing-tips · Blog", 0.07, 0.52), ("Contact · Janssen", 0.06, 0.30)],
        cur["pageViews"], "ptl",
    )

    conv_total = cur["conversions"]
    conv_defs = [("form_submit", 0.38), ("offerte_aanvraag", 0.27),
                 ("telefoon_klik", 0.21), ("nieuwsbrief_aanmelding", 0.14)]
    conversions = [
        {"name": name, "count": max(1, round(conv_total * share * _jitter(seed, "cv", name)))}
        for name, share in conv_defs
    ]

    # Top verkochte producten (GA4 item-scope), afgeleid van de periode-omzet.
    item_defs = [
        ("Loungestoel Vigo", 0.14), ("Eettafel Nordic", 0.12),
        ("Boekenkast Bergen", 0.10), ("Vloerkleed Fez", 0.08),
        ("Wandlamp Oslo", 0.07), ("Spiegel Anna", 0.06),
        ("Bijzettafel Rond", 0.05), ("Plaid Wolmix", 0.04),
        ("Kussenset Linnen", 0.035), ("Vaas Amber", 0.03),
    ]
    aov = cur["avgOrderValue"] or 1.0
    top_items = []
    for name, share in item_defs:
        rev = round(cur["revenue"] * share * _jitter(seed, "item", name), 2)
        top_items.append({
            "name": name,
            "qty": max(1, round(rev / aov * 1.6)),
            "revenue": rev,
        })

    return {
        "kpis": kpis,
        "deltas": deltas,
        "sessions_by_date": sessions_by_date,
        "series_by_date": series_by_date,
        "compare_series": compare_series,
        "channels": channels,
        "devices": devices,
        "geography": geography,
        "source_medium": source_medium,
        "first_user_channels": first_user_channels,
        "first_user_source_medium": first_user_source_medium,
        "session_campaigns": session_campaigns,
        "browsers": browsers,
        "new_vs_returning": new_vs_returning,
        "events": events,
        "top_pages": top_pages,
        "page_titles": page_titles,
        "landing_pages": landing_pages,
        "conversions": conversions,
        "top_items": top_items,
    }


def basic_report() -> list[dict]:
    return [
        {"country": label, "activeUsers": str(round(1200 * share))}
        for label, share in [
            ("Netherlands", 0.78), ("Belgium", 0.09), ("Germany", 0.06),
            ("United Kingdom", 0.04), ("United States", 0.03),
        ]
    ]


def realtime() -> dict:
    """Active-users-now snapshot; drifts a little every minute."""
    minute = int(time.time() // 60)
    by_minute = [round(18 + 14 * _rand("rt", minute - m)) for m in range(29, -1, -1)]
    active = by_minute[-1] + round(6 * _rand("rt-now", minute))
    pages = [
        ("Home · Janssen", 0.34), ("Producten · Janssen", 0.22),
        ("Diensten · Janssen", 0.18), ("Contact · Janssen", 0.15),
        ("Blog · Janssen", 0.11),
    ]
    return {
        "active_users": active,
        "by_minute": by_minute,
        "pages": [
            {"name": name, "active": max(1, round(active * share))}
            for name, share in pages
        ],
    }


# ------------------------------------------------------------- search console


def _daily_clicks(d: date) -> int:
    weekday = [1.08, 1.12, 1.09, 1.02, 0.94, 0.70, 0.66][d.weekday()]
    trend = 1 + (d.toordinal() - date(2026, 1, 1).toordinal()) * 0.0009
    return max(1, round(52 * weekday * trend * _jitter("gsc", d, spread=0.35)))


def gsc_report(start: str, end: str, compare: tuple[str, str] | None = None) -> dict:
    """Same shape as search_console.run_search_analytics, but generated."""

    def totals_for(s, e):
        days = _days(s, e)
        clicks = sum(_daily_clicks(d) for d in days)
        impressions = round(clicks / (0.034 * _jitter("gsc-ctr", s, e)))
        return {
            "clicks": clicks,
            "impressions": impressions,
            "ctr": clicks / impressions if impressions else 0,
            "position": 8.4 * _jitter("gsc-pos", s, e),
        }

    cur = totals_for(start, end)
    deltas = None
    if compare:
        prev = totals_for(compare[0], compare[1])
        deltas = {
            k: ((cur[k] - prev[k]) / prev[k] * 100) if prev[k] else None
            for k in ("clicks", "impressions", "ctr", "position")
        }

    def _day_gsc(d: date) -> dict:
        clicks = _daily_clicks(d)
        impressions = round(clicks / (0.034 * _jitter("gsc-ctr", d)))
        return {
            "date": d.isoformat(),
            "clicks": clicks,
            "impressions": impressions,
            "ctr": clicks / impressions if impressions else 0,
            "position": 8.4 * _jitter("gsc-pos", d, spread=0.2),
        }

    by_date = [_day_gsc(d) for d in _days(start, end)]

    def rows(defs, key, label_key):
        out = []
        for label, share, pos in defs:
            clicks = max(1, round(cur["clicks"] * share * _jitter("gsc", key, label)))
            impressions = round(clicks / max(0.005, 0.05 * _jitter("gsc", key + "i", label)))
            out.append({
                label_key: label,
                "clicks": clicks,
                "impressions": impressions,
                "ctr": clicks / impressions if impressions else 0,
                "position": pos * _jitter("gsc", key + "p", label),
            })
        return out

    top_queries = rows(
        [("janssen", 0.22, 1.2), ("janssen bv", 0.11, 1.4), ("janssen producten", 0.08, 3.1),
         ("janssen offerte", 0.06, 2.6), ("janssen contact", 0.05, 1.8),
         ("janssen openingstijden", 0.04, 2.2), ("janssen reviews", 0.04, 4.5),
         ("diensten janssen", 0.03, 5.2), ("janssen webshop", 0.03, 6.1),
         ("janssen vacatures", 0.02, 7.4)],
        "q", "query",
    )
    top_pages = rows(
        [(DEMO_SITE, 0.30, 1.6), (DEMO_SITE + "producten", 0.17, 4.2),
         (DEMO_SITE + "diensten", 0.12, 5.8), (DEMO_SITE + "contact", 0.09, 2.4),
         (DEMO_SITE + "over-ons", 0.07, 6.3), (DEMO_SITE + "blog/5-marketing-tips", 0.06, 8.9),
         (DEMO_SITE + "offerte", 0.05, 4.9), (DEMO_SITE + "vacatures", 0.03, 9.6)],
        "p", "page",
    )
    # Position 10-20 keywords: reachable wins (main derives these from all queries).
    opportunities = rows(
        [("marketing bureau tilburg", 0.03, 11.4), ("seo specialist janssen", 0.025, 12.8),
         ("janssen webshop kortingscode", 0.02, 13.6), ("duurzame producten janssen", 0.018, 15.1),
         ("janssen vs concurrent", 0.015, 16.9), ("janssen ervaringen forum", 0.012, 18.7)],
        "opp", "query",
    )
    by_impressions = sorted(top_queries, key=lambda q: q["impressions"], reverse=True)[:10]
    devices = rows(
        [("MOBILE", 0.56, 8.1), ("DESKTOP", 0.37, 7.9), ("TABLET", 0.07, 9.4)],
        "dev", "device",
    )
    countries = rows(
        [("nld", 0.79, 7.6), ("bel", 0.09, 9.2), ("deu", 0.05, 11.3),
         ("gbr", 0.04, 12.1), ("usa", 0.03, 13.5)],
        "ctry", "country",
    )

    return {
        "totals": cur,
        "deltas": deltas,
        "by_date": by_date,
        "top_queries": top_queries,
        "top_pages": top_pages,
        "opportunities": opportunities,
        "by_impressions": by_impressions,
        "devices": devices,
        "countries": countries,
    }


# ---------------------------------------------------------------- google ads


def _deltas(cur: dict, prev: dict, keys) -> dict:
    return {k: ((cur[k] - prev[k]) / prev[k] * 100) if prev.get(k) else None for k in keys}


def _ads_day(d: date) -> dict:
    """One day of Google Ads metrics, derived from that day's impressions."""
    weekday = [1.05, 1.10, 1.08, 1.03, 0.98, 0.80, 0.78][d.weekday()]
    trend = 1 + (d.toordinal() - date(2026, 1, 1).toordinal()) * 0.0006
    impressions = max(50, round(8200 * weekday * trend * _jitter("ads-impr", d, spread=0.3)))
    clicks = max(1, round(impressions * 0.045 * _jitter("ads-ctr", d, spread=0.2)))
    cost = round(clicks * 0.86 * _jitter("ads-cpc", d, spread=0.2), 2)
    conversions = round(clicks * 0.062 * _jitter("ads-cvr", d, spread=0.25), 1)
    return {
        "date": d.strftime("%Y%m%d"),
        "impressions": impressions,
        "clicks": clicks,
        "cost": cost,
        "conversions": conversions,
    }


def ads_overview(start: str, end: str, compare: tuple[str, str] | None = None) -> dict:
    """Same shape as google_ads.run_overview, but generated."""

    def totals_for(s, e):
        rows = [_ads_day(d) for d in _days(s, e)]
        cost = round(sum(r["cost"] for r in rows), 2)
        clicks = sum(r["clicks"] for r in rows)
        impressions = sum(r["impressions"] for r in rows)
        conversions = round(sum(r["conversions"] for r in rows), 1)
        conv_value = round(conversions * 88.0 * _jitter("ads-aov", s, e, spread=0.1), 2)
        return {
            "cost": cost,
            "clicks": clicks,
            "impressions": impressions,
            "conversions": conversions,
            "conversionsValue": conv_value,
            "ctr": (clicks / impressions * 100) if impressions else 0.0,
            "cpc": (cost / clicks) if clicks else 0.0,
            "roas": (conv_value / cost) if cost else 0.0,
        }

    kpis = totals_for(start, end)
    deltas = None
    if compare:
        deltas = _deltas(kpis, totals_for(compare[0], compare[1]),
                         ("cost", "clicks", "impressions", "conversions", "conversionsValue", "ctr", "cpc", "roas"))

    by_date = [_ads_day(d) for d in _days(start, end)]

    def campaign(name, share, ctr, roas):
        cost = round(kpis["cost"] * share * _jitter("ads-camp", name), 2)
        clicks = max(1, round(kpis["clicks"] * share * _jitter("ads-campc", name)))
        impressions = max(1, round(kpis["impressions"] * share * _jitter("ads-campi", name)))
        conversions = round(clicks * 0.062 * _jitter("ads-campv", name), 1)
        return {
            "name": name, "cost": cost, "clicks": clicks, "impressions": impressions,
            "conversions": conversions, "ctr": ctr * _jitter("ads-campctr", name),
            "roas": roas * _jitter("ads-camproas", name),
        }

    campaigns = [
        campaign("Merk · Zoeken", 0.28, 6.8, 8.4),
        campaign("Producten · Shopping", 0.24, 1.9, 5.1),
        campaign("Diensten · Zoeken", 0.18, 4.2, 4.6),
        campaign("Remarketing · Display", 0.12, 0.7, 3.2),
        campaign("Concurrenten · Zoeken", 0.09, 3.1, 2.4),
        campaign("Performance Max", 0.09, 2.6, 6.0),
    ]

    return {"kpis": kpis, "deltas": deltas, "by_date": by_date, "campaigns": campaigns}


# ----------------------------------------------------------------- meta ads


def _meta_ads_day(d: date) -> dict:
    weekday = [1.04, 1.08, 1.06, 1.05, 1.02, 0.86, 0.83][d.weekday()]
    trend = 1 + (d.toordinal() - date(2026, 1, 1).toordinal()) * 0.0007
    impressions = max(80, round(12500 * weekday * trend * _jitter("mads-impr", d, spread=0.3)))
    reach = round(impressions / (1.85 * _jitter("mads-freq", d, spread=0.1)))
    clicks = max(1, round(impressions * 0.0125 * _jitter("mads-ctr", d, spread=0.25)))
    spend = round(impressions / 1000 * 6.4 * _jitter("mads-cpm", d, spread=0.2), 2)
    return {
        "date": d.strftime("%Y%m%d"),
        "impressions": impressions,
        "reach": reach,
        "clicks": clicks,
        "spend": spend,
    }


def meta_ads_overview(start: str, end: str, compare: tuple[str, str] | None = None) -> dict:
    """Same shape as meta.ads_overview, but generated."""

    def totals_for(s, e):
        rows = [_meta_ads_day(d) for d in _days(s, e)]
        impressions = sum(r["impressions"] for r in rows)
        reach = sum(r["reach"] for r in rows)
        clicks = sum(r["clicks"] for r in rows)
        spend = round(sum(r["spend"] for r in rows), 2)
        link_clicks = round(clicks * 0.72)
        return {
            "spend": spend,
            "reach": reach,
            "impressions": impressions,
            "clicks": clicks,
            "linkClicks": link_clicks,
            "ctr": (clicks / impressions * 100) if impressions else 0.0,
            "cpc": (spend / clicks) if clicks else 0.0,
            "cpm": (spend / impressions * 1000) if impressions else 0.0,
            "frequency": (impressions / reach) if reach else 0.0,
        }

    kpis = totals_for(start, end)
    deltas = None
    if compare:
        deltas = _deltas(kpis, totals_for(compare[0], compare[1]),
                         ("spend", "reach", "impressions", "clicks", "linkClicks", "ctr", "cpc", "cpm", "frequency"))

    by_date = [_meta_ads_day(d) for d in _days(start, end)]

    def campaign(name, objective, status, share, ctr):
        spend = round(kpis["spend"] * share * _jitter("mads-camp", name), 2)
        clicks = max(1, round(kpis["clicks"] * share * _jitter("mads-campc", name)))
        results = max(1, round(clicks * 0.09 * _jitter("mads-campr", name)))
        return {
            "name": name, "objective": objective, "status": status, "spend": spend,
            "clicks": clicks, "ctr": ctr * _jitter("mads-campctr", name), "results": results,
        }

    campaigns = [
        campaign("Aankopen · Voorjaar", "OUTCOME_SALES", "ACTIVE", 0.34, 1.5),
        campaign("Leads · Offerteaanvraag", "OUTCOME_LEADS", "ACTIVE", 0.24, 1.1),
        campaign("Verkeer · Blog", "OUTCOME_TRAFFIC", "ACTIVE", 0.16, 1.9),
        campaign("Betrokkenheid · Merk", "OUTCOME_ENGAGEMENT", "PAUSED", 0.14, 0.9),
        campaign("Retargeting · Websitebezoekers", "OUTCOME_SALES", "ACTIVE", 0.12, 2.3),
    ]

    def result(goal, share, roas):
        count = max(1, round(kpis["clicks"] * share * _jitter("mads-res", goal)))
        value = round(count * 82.0 * _jitter("mads-resv", goal), 2)
        cpa = round((kpis["spend"] * share) / count, 2) if count else 0.0
        return {"goal": goal, "count": count, "value": value, "roas": roas * _jitter("mads-resr", goal), "cpa": cpa}

    results = [
        result("Aankopen", 0.05, 4.6),
        result("Leads", 0.07, 3.1),
        result("Toevoegen aan winkelwagen", 0.11, 2.2),
        result("Berichten", 0.04, 1.8),
    ]

    return {"kpis": kpis, "deltas": deltas, "by_date": by_date, "campaigns": campaigns, "results": results}


# ------------------------------------------------------------- meta organic


def _organic_day(d: date, seed: str, base_reach: int) -> dict:
    weekday = [1.03, 1.07, 1.05, 1.06, 1.09, 0.90, 0.88][d.weekday()]
    reach = max(20, round(base_reach * weekday * _jitter(seed + "reach", d, spread=0.35)))
    impressions = round(reach * 1.35 * _jitter(seed + "impr", d, spread=0.1))
    engagement = round(reach * 0.062 * _jitter(seed + "eng", d, spread=0.3))
    return {"date": d.strftime("%Y%m%d"), "reach": reach, "impressions": impressions, "engagement": engagement}


def meta_organic_overview(start: str, end: str) -> dict:
    """Same shape as meta.organic_overview, but generated (Facebook + Instagram)."""
    fb_days = [_organic_day(d, "fb", 1400) for d in _days(start, end)]
    ig_days = [_organic_day(d, "ig", 1900) for d in _days(start, end)]

    def posts(seed, texts):
        out = []
        for i, txt in enumerate(texts):
            out.append({
                "text": txt,
                "date": _days(start, end)[min(i * 3, len(_days(start, end)) - 1)].isoformat(),
                "engagement": max(5, round(320 * _jitter(seed, i, spread=0.6))),
            })
        return sorted(out, key=lambda p: p["engagement"], reverse=True)

    facebook = {
        "followers": round(8420 * _jitter("fb-fol", start, end, spread=0.02)),
        "followers_growth": round(120 * _jitter("fb-folg", start, end, spread=0.4)),
        "reach": sum(r["reach"] for r in fb_days),
        "impressions": sum(r["impressions"] for r in fb_days),
        "engagement": sum(r["engagement"] for r in fb_days),
        "by_date": fb_days,
        "top_posts": posts("fb-post", [
            "Nieuwe voorjaarscollectie is binnen! 🌷",
            "Achter de schermen bij Janssen",
            "5 tips om het meeste uit je aankoop te halen",
            "Klant in de spotlight: bedankt voor je review!",
            "Dit weekend: 10% korting in de webshop",
        ]),
    }
    instagram = {
        "followers": round(11240 * _jitter("ig-fol", start, end, spread=0.02)),
        "followers_growth": round(210 * _jitter("ig-folg", start, end, spread=0.4)),
        "reach": sum(r["reach"] for r in ig_days),
        "impressions": sum(r["impressions"] for r in ig_days),
        "profile_views": round(sum(r["reach"] for r in ig_days) * 0.04 * _jitter("ig-pv", start, end)),
        "by_date": ig_days,
        "top_posts": posts("ig-post", [
            "Reel: zo maak je het perfecte plekje ✨",
            "Nieuwe kleuren, wie is er fan? 💚",
            "Giveaway! Volg + tag 2 vrienden",
            "Sfeerbeeld van vandaag 📸",
            "Onze best verkochte producten deze maand",
        ]),
    }
    return {"facebook": facebook, "instagram": instagram}
