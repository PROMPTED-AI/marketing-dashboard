"""Read-only Meta Graph API wrappers: ad accounts, pages, Instagram.

All calls go through `_get`, and every report block is wrapped so one failing
request degrades to a safe default instead of taking down the tab (same
discipline as the GA/Ads modules). Exact Graph metric names/periods may need
tuning against a live app once App Review is granted.
"""
import json
import logging

import requests

from . import config

log = logging.getLogger(__name__)


def _graph(path: str) -> str:
    return f"https://graph.facebook.com/{config.META_GRAPH_VERSION}/{path}"


def _get(path: str, token: str, params: dict | None = None) -> dict:
    p = dict(params or {})
    p["access_token"] = token
    resp = requests.get(_graph(path), params=p, timeout=20)
    resp.raise_for_status()
    return resp.json()


def _num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


# ----------------------------------------------------------------- assets


def list_assets(user_token: str) -> dict:
    """Ad accounts + pages (with linked Instagram) the user can access.

    No access tokens are returned to the caller; page tokens are fetched
    server-side at report time.
    """
    ad_accounts, pages = [], []
    try:
        data = _get("me/adaccounts", user_token,
                    {"fields": "account_id,name,currency", "limit": 100})
        for a in data.get("data", []):
            ad_accounts.append({
                "id": "act_" + a.get("account_id", ""),
                "account_id": a.get("account_id"),
                "name": a.get("name") or a.get("account_id"),
                "currency": a.get("currency"),
            })
    except Exception as exc:  # noqa: BLE001
        log.warning("meta list ad accounts failed: %s", exc)
    try:
        data = _get("me/accounts", user_token,
                    {"fields": "id,name,instagram_business_account{id,username}", "limit": 100})
        for p in data.get("data", []):
            ig = p.get("instagram_business_account") or None
            pages.append({
                "id": p.get("id"),
                "name": p.get("name"),
                "instagram": ({"id": ig.get("id"), "username": ig.get("username")} if ig else None),
            })
    except Exception as exc:  # noqa: BLE001
        log.warning("meta list pages failed: %s", exc)
    return {"ad_accounts": ad_accounts, "pages": pages}


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


def ads_overview(user_token: str, ad_account_id: str, start: str, end: str,
                 compare: tuple[str, str] | None = None) -> dict:
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
            "campaigns": safe(_campaigns, [])}


# --------------------------------------------------------------- organic


def _fb_page(token: str, page_id: str, start: str, end: str) -> dict:
    info = _get(page_id, token, {"fields": "fan_count,followers_count,name"})
    followers = int(_num(info.get("followers_count") or info.get("fan_count")))

    reach = impressions = engagement = 0
    try:
        ins = _get(f"{page_id}/insights", token, {
            "metric": "page_impressions,page_post_engagements,page_impressions_unique",
            "period": "day", "since": start, "until": end,
        }).get("data", [])
        for m in ins:
            total = sum(_num(v.get("value")) for v in m.get("values", []))
            if m.get("name") == "page_impressions":
                impressions = int(total)
            elif m.get("name") == "page_impressions_unique":
                reach = int(total)
            elif m.get("name") == "page_post_engagements":
                engagement = int(total)
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

    return {"followers": followers, "reach": reach, "impressions": impressions,
            "engagement": engagement, "top_posts": posts}


def _instagram(token: str, ig_id: str, start: str, end: str) -> dict:
    info = _get(ig_id, token, {"fields": "followers_count,media_count,username"})
    followers = int(_num(info.get("followers_count")))

    reach = impressions = profile_views = 0
    try:
        ins = _get(f"{ig_id}/insights", token, {
            "metric": "reach,impressions,profile_views",
            "period": "day", "since": start, "until": end,
        }).get("data", [])
        for m in ins:
            total = sum(_num(v.get("value")) for v in m.get("values", []))
            if m.get("name") == "reach":
                reach = int(total)
            elif m.get("name") == "impressions":
                impressions = int(total)
            elif m.get("name") == "profile_views":
                profile_views = int(total)
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
            "reach": reach, "impressions": impressions,
            "profile_views": profile_views, "top_posts": posts}


def organic_overview(user_token: str, page_id: str, ig_id: str | None,
                     start: str, end: str) -> dict:
    """Facebook page + (optional) Instagram organic metrics for the range."""
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
