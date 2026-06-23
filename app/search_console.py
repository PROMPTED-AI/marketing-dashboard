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


def run_search_analytics(creds: Credentials, site_url: str, days: int = 28) -> dict:
    """Return clicks/impressions/ctr/position totals, a daily series, and top queries."""
    from datetime import date, timedelta

    end = date.today()
    start = end - timedelta(days=days)
    api = _client(creds).searchanalytics()

    def query(dimensions, row_limit=25):
        body = {
            "startDate": start.isoformat(),
            "endDate": end.isoformat(),
            "dimensions": dimensions,
            "rowLimit": row_limit,
        }
        return api.query(siteUrl=site_url, body=body).execute().get("rows", [])

    totals_rows = query([], row_limit=1)
    totals = totals_rows[0] if totals_rows else {}

    by_date = [
        {
            "date": r["keys"][0],
            "clicks": r.get("clicks", 0),
            "impressions": r.get("impressions", 0),
        }
        for r in query(["date"], row_limit=days + 1)
    ]
    top_queries = [
        {
            "query": r["keys"][0],
            "clicks": r.get("clicks", 0),
            "impressions": r.get("impressions", 0),
            "ctr": r.get("ctr", 0),
            "position": r.get("position", 0),
        }
        for r in query(["query"], row_limit=10)
    ]
    top_pages = [
        {
            "page": r["keys"][0],
            "clicks": r.get("clicks", 0),
            "impressions": r.get("impressions", 0),
            "ctr": r.get("ctr", 0),
            "position": r.get("position", 0),
        }
        for r in query(["page"], row_limit=10)
    ]

    return {
        "totals": {
            "clicks": totals.get("clicks", 0),
            "impressions": totals.get("impressions", 0),
            "ctr": totals.get("ctr", 0),
            "position": totals.get("position", 0),
        },
        "by_date": by_date,
        "top_queries": top_queries,
        "top_pages": top_pages,
    }
