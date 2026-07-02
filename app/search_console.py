"""Thin wrapper around the Google Search Console API (read-only)."""
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials


def _client(creds: Credentials):
    # cache_discovery=False avoids a noisy warning on serverless.
    return build("searchconsole", "v1", credentials=creds, cache_discovery=False)


def list_sites(creds: Credentials) -> list[dict]:
    """List the verified Search Console sites the user can access."""
    resp = _client(creds).sites().list().execute()
    return [
        {"site_url": s["siteUrl"], "permission": s.get("permissionLevel", "")}
        for s in resp.get("siteEntry", [])
        if s.get("permissionLevel") != "siteUnverifiedUser"
    ]


def run_search_analytics(
    creds: Credentials,
    site_url: str,
    start: str,
    end: str,
    compare: tuple[str, str] | None = None,
) -> dict:
    """Clicks/impressions/ctr/position totals (+ optional comparison deltas),
    a daily series, and top queries/pages. Dates are ISO (YYYY-MM-DD)."""
    api = _client(creds).searchanalytics()

    def query(s, e, dimensions, row_limit=25):
        body = {"startDate": s, "endDate": e, "dimensions": dimensions, "rowLimit": row_limit}
        return api.query(siteUrl=site_url, body=body).execute().get("rows", [])

    def totals_for(s, e):
        rows = query(s, e, [], row_limit=1)
        return rows[0] if rows else {}

    cur = totals_for(start, end)
    totals = {
        "clicks": cur.get("clicks", 0),
        "impressions": cur.get("impressions", 0),
        "ctr": cur.get("ctr", 0),
        "position": cur.get("position", 0),
    }

    deltas = None
    if compare:
        prev = totals_for(compare[0], compare[1])

        def delta(key):
            c, p = cur.get(key, 0), prev.get(key, 0)
            return ((c - p) / p * 100) if p else None

        deltas = {k: delta(k) for k in ("clicks", "impressions", "ctr", "position")}

    by_date = [
        {"date": r["keys"][0], "clicks": r.get("clicks", 0), "impressions": r.get("impressions", 0)}
        for r in query(start, end, ["date"], row_limit=500)
    ]
    # One broader query fetch feeds the top list + the "opportunities" view.
    # GSC returns rows ordered by clicks; we re-sort locally for impressions.
    all_queries = [
        {"query": r["keys"][0], "clicks": r.get("clicks", 0), "impressions": r.get("impressions", 0),
         "ctr": r.get("ctr", 0), "position": r.get("position", 0)}
        for r in query(start, end, ["query"], row_limit=500)
    ]
    top_queries = all_queries[:10]  # already clicks-desc from the API
    # Quick wins: queries just off page 1 (position ~11-20) with the most impressions.
    opportunities = sorted(
        [q for q in all_queries if 10 < q["position"] <= 20],
        key=lambda q: q["impressions"], reverse=True,
    )[:10]
    # High reach, low uptake: most-shown queries (eyeball the low CTRs).
    by_impressions = sorted(all_queries, key=lambda q: q["impressions"], reverse=True)[:10]

    top_pages = [
        {"page": r["keys"][0], "clicks": r.get("clicks", 0), "impressions": r.get("impressions", 0),
         "ctr": r.get("ctr", 0), "position": r.get("position", 0)}
        for r in query(start, end, ["page"], row_limit=10)
    ]

    return {
        "totals": totals, "deltas": deltas, "by_date": by_date,
        "top_queries": top_queries, "top_pages": top_pages,
        "opportunities": opportunities, "by_impressions": by_impressions,
    }
