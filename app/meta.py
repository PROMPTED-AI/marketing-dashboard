"""Read-only Meta Graph API wrappers: ad accounts, pages, Instagram.

All calls go through `_get`, and every report block is wrapped so one failing
request degrades to a safe default instead of taking down the tab (same
discipline as the GA/Ads modules). Exact Graph metric names/periods may need
tuning against a live app once App Review is granted.
"""
import json
import logging
import re

import requests

from . import config

log = logging.getLogger(__name__)

# Graph node ids are alphanumeric/underscore (e.g. "act_12345", "1789..."); reject
# anything else so a caller-supplied id can't manipulate the Graph request path.
_NODE_RE = re.compile(r"^[A-Za-z0-9_]+$")


def _node(node_id: str) -> str:
    if not node_id or not _NODE_RE.match(node_id):
        raise ValueError(f"invalid graph node id: {node_id!r}")
    return node_id


def _graph(path: str) -> str:
    return f"https://graph.facebook.com/{config.META_GRAPH_VERSION}/{path}"


def _get(path: str, token: str, params: dict | None = None) -> dict:
    p = dict(params or {})
    p["access_token"] = token
    resp = requests.get(_graph(path), params=p, timeout=20)
    resp.raise_for_status()
    return resp.json()


def _paged(path: str, token: str, params: dict, cap_pages: int = 20) -> list:
    """Volg de Graph-paginatie (paging.next) tot een plafond en geef alle rijen.

    Zonder paginatie zag je alleen de eerste 100 accounts/pagina's; een groot
    partner-account (Business Manager) heeft er vaak meer.
    """
    items: list = []
    data = _get(path, token, params)
    for _ in range(cap_pages):
        items.extend(data.get("data", []))
        nxt = (data.get("paging") or {}).get("next")
        if not nxt:
            break
        resp = requests.get(nxt, timeout=20)
        resp.raise_for_status()
        data = resp.json()
    return items


def _num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _daily_series(ins_data: list, mapping: dict) -> list:
    """Fold a Graph insights response (metric -> daily values) into one series.

    `mapping` maps Graph metric names to output keys. Dates are normalised to the
    compact "YYYYMMDD" the frontend charts expect. One row per day, sorted.
    """
    by_date: dict[str, dict] = {}
    for m in ins_data:
        out_key = mapping.get(m.get("name"))
        if not out_key:
            continue
        for v in m.get("values", []):
            day = (v.get("end_time") or "")[:10]
            if not day:
                continue
            by_date.setdefault(day, {})[out_key] = int(_num(v.get("value")))
    return [{"date": day.replace("-", ""), **vals} for day, vals in sorted(by_date.items())]


# ----------------------------------------------------------------- assets


_ACC_FIELDS = "account_id,name,currency"
_PAGE_FIELDS = "id,name,instagram_business_account{id,username}"


def list_assets(user_token: str) -> dict:
    """Alle advertentie-accounts + pagina's die de gebruiker kan beheren.

    Naast de direct aan de gebruiker toegewezen assets (me/adaccounts,
    me/accounts) doorlopen we ook de businesses (Business Manager /
    partner-account) waar de gebruiker lid van is, en halen daar zowel de
    eigen als de via partners gedeelde advertentie-accounts en pagina's op.
    Zo zie je alles onder het partner-account, niet alleen wat rechtstreeks
    aan jouw persoon is gekoppeld. Alles wordt ontdubbeld op id.

    No access tokens are returned to the caller; page tokens are fetched
    server-side at report time.
    """
    ad_accounts: dict[str, dict] = {}
    pages: dict[str, dict] = {}

    def add_account(a: dict) -> None:
        acc_id = a.get("account_id") or (a.get("id") or "").removeprefix("act_")
        if not acc_id:
            return
        ad_accounts["act_" + acc_id] = {
            "id": "act_" + acc_id,
            "account_id": acc_id,
            "name": a.get("name") or acc_id,
            "currency": a.get("currency"),
        }

    def add_page(p: dict) -> None:
        if not p.get("id"):
            return
        ig = p.get("instagram_business_account") or None
        pages[p["id"]] = {
            "id": p["id"],
            "name": p.get("name"),
            "instagram": ({"id": ig.get("id"), "username": ig.get("username")} if ig else None),
        }

    def gather(path: str, params: dict, add, label: str) -> None:
        try:
            for row in _paged(path, user_token, params):
                add(row)
        except Exception as exc:  # noqa: BLE001 - één bron mag de rest niet blokkeren
            log.info("meta assets %s overslaan: %s", label, exc)

    # 1. Direct aan de gebruiker toegewezen.
    gather("me/adaccounts", {"fields": _ACC_FIELDS, "limit": 100}, add_account, "me/adaccounts")
    gather("me/accounts", {"fields": _PAGE_FIELDS, "limit": 100}, add_page, "me/accounts")

    # 2. Via de businesses (partner-account) waar de gebruiker beheerder is.
    try:
        businesses = _paged("me/businesses", user_token, {"fields": "id,name", "limit": 50})
    except Exception as exc:  # noqa: BLE001
        log.info("meta list businesses overslaan: %s", exc)
        businesses = []
    for biz in businesses:
        bid = biz.get("id")
        if not bid:
            continue
        for edge in ("owned_ad_accounts", "client_ad_accounts"):
            gather(f"{bid}/{edge}", {"fields": _ACC_FIELDS, "limit": 100}, add_account, f"{edge}")
        for edge in ("owned_pages", "client_pages"):
            gather(f"{bid}/{edge}", {"fields": _PAGE_FIELDS, "limit": 100}, add_page, f"{edge}")

    return {
        "ad_accounts": sorted(ad_accounts.values(), key=lambda a: (a.get("name") or "").lower()),
        "pages": sorted(pages.values(), key=lambda p: (p.get("name") or "").lower()),
    }


def _page_token(user_token: str, page_id: str) -> str | None:
    """The page access token (needed for page/IG insights), fetched server-side."""
    try:
        data = _get(page_id, user_token, {"fields": "access_token"})
        return data.get("access_token")
    except Exception as exc:  # noqa: BLE001
        log.warning("meta page token fetch failed: %s", exc)
        return None


# ----------------------------------------------------------------- ads (paid)


def _ads_totals(token: str, ad_account_id: str, start: str, end: str) -> dict:
    fields = ("spend,impressions,reach,frequency,clicks,inline_link_clicks,"
              "ctr,cpc,cpm,actions,action_values,purchase_roas")
    data = _get(f"{ad_account_id}/insights", token, {
        "fields": fields,
        "level": "account",
        "time_range": json.dumps({"since": start, "until": end}),
    })
    rows = data.get("data", [])
    row = rows[0] if rows else {}
    kpis = {
        "spend": _num(row.get("spend")),
        "impressions": int(_num(row.get("impressions"))),
        "reach": int(_num(row.get("reach"))),
        "frequency": _num(row.get("frequency")),
        "clicks": int(_num(row.get("clicks"))),
        "linkClicks": int(_num(row.get("inline_link_clicks"))),
        "ctr": _num(row.get("ctr")),
        "cpc": _num(row.get("cpc")),
        "cpm": _num(row.get("cpm")),
    }
    # Results per conversion goal, from the action breakdown.
    values = {a.get("action_type"): _num(a.get("value")) for a in row.get("action_values", [])}
    roases = {a.get("action_type"): _num(a.get("value")) for a in row.get("purchase_roas", [])}
    results = []
    for a in row.get("actions", []):
        goal = a.get("action_type")
        count = _num(a.get("value"))
        if not goal or count <= 0:
            continue
        results.append({
            "goal": goal,
            "count": count,
            "value": values.get(goal, 0.0),
            "roas": roases.get(goal, 0.0),
            "cpa": (kpis["spend"] / count) if count else 0.0,
        })
    results.sort(key=lambda r: r["count"], reverse=True)
    return {"kpis": kpis, "results": results}


def _ads_by_date(token: str, ad_account_id: str, start: str, end: str) -> list:
    """Daily spend/impressions/reach/clicks for the account (for trend charts)."""
    data = _get(f"{ad_account_id}/insights", token, {
        "fields": "spend,impressions,reach,clicks",
        "level": "account",
        "time_increment": 1,
        "time_range": json.dumps({"since": start, "until": end}),
        "limit": 500,
    })
    out = []
    for r in data.get("data", []):
        out.append({
            "date": (r.get("date_start") or "").replace("-", ""),
            "spend": _num(r.get("spend")),
            "impressions": int(_num(r.get("impressions"))),
            "reach": int(_num(r.get("reach"))),
            "clicks": int(_num(r.get("clicks"))),
        })
    return out


def ads_overview(user_token: str, ad_account_id: str, start: str, end: str,
                 compare: tuple[str, str] | None = None) -> dict:
    ad_account_id = _node(ad_account_id)

    def safe(fn, default):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            log.warning("meta ads block failed: %s", exc)
            return default

    base = safe(lambda: _ads_totals(user_token, ad_account_id, start, end),
                {"kpis": {}, "results": []})
    kpis, results = base.get("kpis", {}), base.get("results", [])

    deltas = None
    if compare and kpis:
        prev = safe(lambda: _ads_totals(user_token, ad_account_id, compare[0], compare[1]),
                    {"kpis": {}}).get("kpis", {})

        def delta(key):
            c, p = kpis.get(key, 0) or 0, prev.get(key, 0) or 0
            return ((c - p) / p * 100) if p else None
        deltas = {k: delta(k) for k in ("spend", "impressions", "reach", "clicks", "ctr", "cpc", "cpm")}

    def _campaigns():
        # Metrics per campaign...
        ins = _get(f"{ad_account_id}/insights", user_token, {
            "fields": "campaign_id,campaign_name,spend,impressions,clicks,ctr,actions",
            "level": "campaign",
            "time_range": json.dumps({"since": start, "until": end}),
            "limit": 50,
        }).get("data", [])
        # ...enriched with objective + status.
        meta = {}
        try:
            for c in _get(f"{ad_account_id}/campaigns", user_token, {
                "fields": "id,objective,effective_status", "limit": 200,
            }).get("data", []):
                meta[c.get("id")] = {"objective": c.get("objective"), "status": c.get("effective_status")}
        except Exception as exc:  # noqa: BLE001
            log.info("meta campaign meta fetch failed: %s", exc)
        out = []
        for c in ins:
            cid = c.get("campaign_id")
            conv = sum(_num(a.get("value")) for a in c.get("actions", []))
            m = meta.get(cid, {})
            out.append({
                "name": c.get("campaign_name") or cid,
                "objective": m.get("objective"),
                "status": m.get("status"),
                "spend": _num(c.get("spend")),
                "impressions": int(_num(c.get("impressions"))),
                "clicks": int(_num(c.get("clicks"))),
                "ctr": _num(c.get("ctr")),
                "results": conv,
            })
        out.sort(key=lambda r: r["spend"], reverse=True)
        return out[:10]

    return {"kpis": kpis, "results": results, "deltas": deltas,
            "by_date": safe(lambda: _ads_by_date(user_token, ad_account_id, start, end), []),
            "campaigns": safe(_campaigns, [])}


# --------------------------------------------------------------- organic


def _fb_page(token: str, page_id: str, start: str, end: str) -> dict:
    info = _get(page_id, token, {"fields": "fan_count,followers_count,name"})
    followers = int(_num(info.get("followers_count") or info.get("fan_count")))

    reach = impressions = engagement = 0
    fan_adds = fan_removes = 0
    by_date = []
    try:
        ins = _get(f"{page_id}/insights", token, {
            "metric": ("page_impressions,page_post_engagements,page_impressions_unique,"
                       "page_fan_adds,page_fan_removes"),
            "period": "day", "since": start, "until": end,
        }).get("data", [])
        by_date = _daily_series(ins, {
            "page_impressions_unique": "reach",
            "page_impressions": "impressions",
            "page_post_engagements": "engagement",
        })
        for m in ins:
            total = sum(_num(v.get("value")) for v in m.get("values", []))
            name = m.get("name")
            if name == "page_impressions":
                impressions = int(total)
            elif name == "page_impressions_unique":
                reach = int(total)
            elif name == "page_post_engagements":
                engagement = int(total)
            elif name == "page_fan_adds":
                fan_adds = int(total)
            elif name == "page_fan_removes":
                fan_removes = int(total)
    except Exception as exc:  # noqa: BLE001
        log.info("meta fb page insights failed: %s", exc)

    posts = []
    try:
        data = _get(f"{page_id}/posts", token, {
            "fields": "message,created_time,likes.summary(true),comments.summary(true),shares",
            "limit": 25,
        }).get("data", [])
        for p in data:
            likes = (p.get("likes", {}).get("summary", {}) or {}).get("total_count", 0)
            comments = (p.get("comments", {}).get("summary", {}) or {}).get("total_count", 0)
            shares = (p.get("shares", {}) or {}).get("count", 0)
            posts.append({
                "text": (p.get("message") or "")[:120],
                "date": (p.get("created_time") or "")[:10],
                "engagement": int(likes) + int(comments) + int(shares),
            })
        posts.sort(key=lambda x: x["engagement"], reverse=True)
        posts = posts[:10]
    except Exception as exc:  # noqa: BLE001
        log.info("meta fb posts failed: %s", exc)

    return {"followers": followers, "followers_growth": fan_adds - fan_removes,
            "reach": reach, "impressions": impressions,
            "engagement": engagement, "by_date": by_date, "top_posts": posts}


def _instagram(token: str, ig_id: str, start: str, end: str) -> dict:
    info = _get(ig_id, token, {"fields": "followers_count,media_count,username"})
    followers = int(_num(info.get("followers_count")))

    reach = impressions = profile_views = growth = 0
    by_date = []
    try:
        ins = _get(f"{ig_id}/insights", token, {
            "metric": "reach,impressions,profile_views,follower_count",
            "period": "day", "since": start, "until": end,
        }).get("data", [])
        by_date = _daily_series(ins, {
            "reach": "reach",
            "impressions": "impressions",
            "profile_views": "profile_views",
        })
        for m in ins:
            total = sum(_num(v.get("value")) for v in m.get("values", []))
            name = m.get("name")
            if name == "reach":
                reach = int(total)
            elif name == "impressions":
                impressions = int(total)
            elif name == "profile_views":
                profile_views = int(total)
            elif name == "follower_count":
                growth = int(total)
    except Exception as exc:  # noqa: BLE001
        log.info("meta ig insights failed: %s", exc)

    posts = []
    try:
        data = _get(f"{ig_id}/media", token, {
            "fields": "caption,like_count,comments_count,media_type,timestamp,permalink",
            "limit": 25,
        }).get("data", [])
        for p in data:
            posts.append({
                "text": (p.get("caption") or "")[:120],
                "date": (p.get("timestamp") or "")[:10],
                "type": p.get("media_type"),
                "engagement": int(_num(p.get("like_count"))) + int(_num(p.get("comments_count"))),
            })
        posts.sort(key=lambda x: x["engagement"], reverse=True)
        posts = posts[:10]
    except Exception as exc:  # noqa: BLE001
        log.info("meta ig media failed: %s", exc)

    return {"username": info.get("username"), "followers": followers,
            "followers_growth": growth, "reach": reach, "impressions": impressions,
            "profile_views": profile_views, "by_date": by_date, "top_posts": posts}


def organic_overview(user_token: str, page_id: str, ig_id: str | None,
                     start: str, end: str) -> dict:
    """Facebook page + (optional) Instagram organic metrics for the range."""
    page_id = _node(page_id)
    if ig_id:
        ig_id = _node(ig_id)
    token = _page_token(user_token, page_id) or user_token

    def safe(fn, default):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            log.warning("meta organic block failed: %s", exc)
            return default

    facebook = safe(lambda: _fb_page(token, page_id, start, end), {})
    instagram = safe(lambda: _instagram(token, ig_id, start, end), None) if ig_id else None
    return {"facebook": facebook, "instagram": instagram}
