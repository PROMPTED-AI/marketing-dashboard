"""Demo account + generated sample data.

The demo organization (flagged ``is_demo``) serves realistic, deterministic
sample data instead of live Google data, so the product can be demonstrated
without connecting a real Google account.

Everything is derived from SHA-256 of the inputs (dates, labels), so the same
date range always renders the same numbers — across restarts and instances —
while different ranges still look naturally different.
"""
import hashlib
import time
from datetime import date, datetime, timedelta

from . import auth, models

DEMO_ORG_NAME = "Janssen"
DEMO_ORG_DOMAIN = "janssen.nl"
DEMO_EMAIL = "info@janssen.nl"
DEMO_PASSWORD = "janssen123"
DEMO_SITE = "https://www.janssen.nl/"

DEMO_PROPERTIES = [
    {"property_id": "demo-janssen", "display_name": "janssen.nl — website", "account": "Janssen"},
]

DEMO_SITES = [{"site_url": DEMO_SITE, "permission": "siteFullUser"}]


# --------------------------------------------------------------------- seeding


def seed() -> None:
    """Create the demo org, user and a starter dashboard. Idempotent."""
    org = models.create_demo_organization(DEMO_ORG_NAME, DEMO_ORG_DOMAIN)
    models.upsert_user(DEMO_EMAIL, org["id"], auth.role_for(DEMO_EMAIL))
    user = models.get_user_by_email(DEMO_EMAIL)
    if not user.get("password_hash"):
        models.set_user_password(DEMO_EMAIL, auth.hash_password(DEMO_PASSWORD))
    if models.count_dashboards_by_owner(org["id"], DEMO_EMAIL) == 0:
        models.create_dashboard(
            org["id"],
            "Janssen — overzicht",
            _starter_layout(),
            page="overview",
            created_by=DEMO_EMAIL,
            visibility="shared",
            is_default=True,
        )


def _starter_layout() -> dict:
    """A filled example dashboard (mirrors the 'full' frontend template)."""
    widgets = [
        ("users", "kpi", 3), ("sessions", "kpi", 3),
        ("conversions_total", "kpi", 3), ("engagementRate", "kpi", 3),
        ("sessions_by_date", "area", 12),
        ("channels", "donut", 6), ("source_medium", "bars", 6),
        ("devices", "bars", 6), ("geography", "bars", 6),
        ("top_pages", "table", 6), ("conversions", "table", 6),
    ]
    return {
        "widgets": [
            {"id": f"demo-w{i}", "source": s, "kind": k, "size": size}
            for i, (s, k, size) in enumerate(widgets, start=1)
        ]
    }


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


def _period_totals(start: str, end: str) -> dict:
    days = _days(start, end)
    sessions = sum(_daily_sessions(d) for d in days)
    j = lambda key, spread=0.1: _jitter(key, start, end, spread=spread)  # noqa: E731
    users = round(sessions * 0.78 * j("users"))
    return {
        "sessions": sessions,
        "users": users,
        "newUsers": round(users * 0.42 * j("new")),
        "pageViews": round(sessions * 3.4 * j("pv")),
        "bounceRate": 0.41 * j("bounce"),
        "avgSessionDuration": 168.0 * j("dur"),
        "engagementRate": 0.58 * j("eng"),
        "eventCount": round(sessions * 9.2 * j("ev")),
        "conversions": round(sessions * 0.031 * j("conv")),
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
    cur = _period_totals(start, end)
    kpis = {
        "users": cur["users"],
        "newUsers": cur["newUsers"],
        "sessions": cur["sessions"],
        "pageViews": cur["pageViews"],
        "bounceRate": cur["bounceRate"],
        "avgSessionDuration": cur["avgSessionDuration"],
        "engagementRate": cur["engagementRate"],
        "eventCount": cur["eventCount"],
        "conversions": cur["conversions"],
    }

    deltas = None
    if compare:
        prev = _period_totals(compare[0], compare[1])
        deltas = {
            k: ((cur[c] - prev[c]) / prev[c] * 100) if prev[c] else None
            for k, c in [
                ("users", "users"), ("newUsers", "newUsers"), ("sessions", "sessions"),
                ("pageViews", "pageViews"), ("bounceRate", "bounceRate"),
                ("avgSessionDuration", "avgSessionDuration"),
                ("engagementRate", "engagementRate"), ("eventCount", "eventCount"),
                ("conversions", "conversions"),
            ]
        }

    # GA returns dates as YYYYMMDD.
    sessions_by_date = [
        {"date": d.strftime("%Y%m%d"), "sessions": _daily_sessions(d)}
        for d in _days(start, end)
    ]
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

    conv_total = cur["conversions"]
    conv_defs = [("form_submit", 0.38), ("offerte_aanvraag", 0.27),
                 ("telefoon_klik", 0.21), ("nieuwsbrief_aanmelding", 0.14)]
    conversions = [
        {"name": name, "count": max(1, round(conv_total * share * _jitter(seed, "cv", name)))}
        for name, share in conv_defs
    ]

    return {
        "kpis": kpis,
        "deltas": deltas,
        "sessions_by_date": sessions_by_date,
        "compare_series": compare_series,
        "channels": channels,
        "devices": devices,
        "geography": geography,
        "source_medium": source_medium,
        "browsers": browsers,
        "new_vs_returning": new_vs_returning,
        "events": events,
        "top_pages": top_pages,
        "landing_pages": landing_pages,
        "conversions": conversions,
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

    by_date = [
        {"date": d.isoformat(), "clicks": _daily_clicks(d),
         "impressions": round(_daily_clicks(d) / 0.034)}
        for d in _days(start, end)
    ]

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

    return {
        "totals": cur,
        "deltas": deltas,
        "by_date": by_date,
        "top_queries": top_queries,
        "top_pages": top_pages,
    }
