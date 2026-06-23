"""Thin wrappers around the Google Analytics Data and Admin APIs (GA4)."""
from google.analytics.admin_v1beta import AnalyticsAdminServiceClient
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    DateRange,
    Dimension,
    Metric,
    OrderBy,
    RunRealtimeReportRequest,
    RunReportRequest,
)
from google.oauth2.credentials import Credentials


def _metric_desc(name: str) -> OrderBy:
    return OrderBy(metric=OrderBy.MetricOrderBy(metric_name=name), desc=True)


def _int(v: str) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def _pct(part: int, total: int) -> int:
    return round(part * 100 / total) if total else 0


def list_properties(creds: Credentials) -> list[dict]:
    """List the GA4 properties the authenticated user can access.

    Uses the Admin API's account summaries, which return every property the
    user has access to, grouped by account.
    """
    client = AnalyticsAdminServiceClient(credentials=creds)
    properties = []
    for summary in client.list_account_summaries():
        for prop in summary.property_summaries:
            properties.append(
                {
                    # prop.property looks like "properties/123456789"
                    "property_id": prop.property.split("/")[-1],
                    "display_name": prop.display_name,
                    "account": summary.display_name,
                }
            )
    return properties


def run_basic_report(creds: Credentials, property_id: str) -> list[dict]:
    """Run a small active-users-by-country report for the given GA4 property."""
    client = BetaAnalyticsDataClient(credentials=creds)
    request = RunReportRequest(
        property=f"properties/{property_id}",
        date_ranges=[DateRange(start_date="7daysAgo", end_date="today")],
        dimensions=[Dimension(name="country")],
        metrics=[Metric(name="activeUsers")],
    )
    response = client.run_report(request)
    return [
        {
            "country": row.dimension_values[0].value,
            "activeUsers": row.metric_values[0].value,
        }
        for row in response.rows
    ]


def run_ga_overview(creds: Credentials, property_id: str, days: int = 30) -> dict:
    """Rich GA4 overview for the Analytics tab (last `days` days)."""
    client = BetaAnalyticsDataClient(credentials=creds)
    prop = f"properties/{property_id}"
    rng = [DateRange(start_date=f"{days}daysAgo", end_date="today")]

    def report(dims, metrics, order_bys=None, limit=None):
        req = RunReportRequest(
            property=prop,
            date_ranges=rng,
            dimensions=[Dimension(name=d) for d in dims],
            metrics=[Metric(name=m) for m in metrics],
            order_bys=order_bys or [],
            limit=limit,
        )
        return client.run_report(req)

    # KPIs (single totals row)
    k = report([], ["totalUsers", "sessions", "bounceRate", "averageSessionDuration"])
    kv = k.rows[0].metric_values if k.rows else None
    kpis = {
        "users": _int(kv[0].value) if kv else 0,
        "sessions": _int(kv[1].value) if kv else 0,
        "bounceRate": float(kv[2].value) if kv else 0.0,
        "avgSessionDuration": float(kv[3].value) if kv else 0.0,
    }

    sd = report(
        ["date"], ["sessions"],
        order_bys=[OrderBy(dimension=OrderBy.DimensionOrderBy(dimension_name="date"))],
    )
    sessions_by_date = [
        {"date": r.dimension_values[0].value, "sessions": _int(r.metric_values[0].value)}
        for r in sd.rows
    ]

    def breakdown(dim, limit):
        rep = report([dim], ["sessions"], order_bys=[_metric_desc("sessions")], limit=limit)
        rows = [(r.dimension_values[0].value, _int(r.metric_values[0].value)) for r in rep.rows]
        total = sum(v for _, v in rows) or 1
        return [{"label": label, "sessions": v, "pct": _pct(v, total)} for label, v in rows]

    channels = breakdown("sessionDefaultChannelGroup", 6)
    devices = breakdown("deviceCategory", 5)
    geography = breakdown("country", 5)

    tp = report(
        ["pagePath"], ["screenPageViews", "bounceRate"],
        order_bys=[_metric_desc("screenPageViews")], limit=6,
    )
    top_pages = [
        {
            "path": r.dimension_values[0].value,
            "views": _int(r.metric_values[0].value),
            "bounceRate": float(r.metric_values[1].value),
        }
        for r in tp.rows
    ]

    cv = report(["eventName"], ["conversions"], order_bys=[_metric_desc("conversions")], limit=6)
    conversions = [
        {"name": r.dimension_values[0].value, "count": _int(r.metric_values[0].value)}
        for r in cv.rows
        if _int(r.metric_values[0].value) > 0
    ]

    return {
        "kpis": kpis,
        "sessions_by_date": sessions_by_date,
        "channels": channels,
        "devices": devices,
        "geography": geography,
        "top_pages": top_pages,
        "conversions": conversions,
    }


def run_realtime(creds: Credentials, property_id: str) -> dict:
    """Active users now + per-minute series (last 30 min) + active screens."""
    client = BetaAnalyticsDataClient(credentials=creds)
    prop = f"properties/{property_id}"

    total = client.run_realtime_report(
        RunRealtimeReportRequest(property=prop, metrics=[Metric(name="activeUsers")])
    )
    active = _int(total.rows[0].metric_values[0].value) if total.rows else 0

    bm = client.run_realtime_report(
        RunRealtimeReportRequest(
            property=prop,
            dimensions=[Dimension(name="minutesAgo")],
            metrics=[Metric(name="activeUsers")],
        )
    )
    per_minute = {_int(r.dimension_values[0].value): _int(r.metric_values[0].value) for r in bm.rows}
    by_minute = [per_minute.get(m, 0) for m in range(29, -1, -1)]

    pages = []
    try:
        pg = client.run_realtime_report(
            RunRealtimeReportRequest(
                property=prop,
                dimensions=[Dimension(name="unifiedScreenName")],
                metrics=[Metric(name="activeUsers")],
                limit=5,
            )
        )
        pages = [
            {"name": r.dimension_values[0].value, "active": _int(r.metric_values[0].value)}
            for r in pg.rows
        ]
    except Exception:
        pages = []

    return {"active_users": active, "by_minute": by_minute, "pages": pages}
