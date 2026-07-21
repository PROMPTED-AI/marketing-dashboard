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


def run_ga_overview(
    creds: Credentials,
    property_id: str,
    start: str,
    end: str,
    compare: tuple[str, str] | None = None,
) -> dict:
    """Rich GA4 overview for a date range, with optional comparison deltas.

    `start`/`end` and `compare` are ISO dates (YYYY-MM-DD). When `compare` is
    given, KPI deltas (% change vs the comparison period) are included.
    """
    client = BetaAnalyticsDataClient(credentials=creds)
    prop = f"properties/{property_id}"
    cur = DateRange(start_date=start, end_date=end, name="current")
    cur_only = [cur]

    def report(dims, metrics, date_ranges, order_bys=None, limit=None):
        req = RunReportRequest(
            property=prop,
            date_ranges=date_ranges,
            dimensions=[Dimension(name=d) for d in dims],
            metrics=[Metric(name=m) for m in metrics],
            order_bys=order_bys or [],
            limit=limit,
        )
        return client.run_report(req)

    def safe(fn, default):
        """Run a supplementary report; degrade to `default` if GA rejects it.

        GA4 properties differ in which dimensions/metrics they support and which
        combinations are compatible, so one unsupported block must never take the
        whole overview down with a 500. Core blocks (KPIs, time series) are not
        wrapped — if those fail something fundamental is wrong.
        """
        try:
            return fn()
        except Exception:
            return default

    # --- KPIs (current + optional comparison) ---
    # One report covers all scalar metrics, so adding more KPI widgets here is
    # effectively free (no extra GA call). `conversions` is the total of all key
    # events; the per-event breakdown lives in `conversions` further down. It is
    # the one metric some migrated properties may lack, so fall back without it.
    stable_metrics = [
        "totalUsers", "newUsers", "sessions", "screenPageViews",
        "bounceRate", "averageSessionDuration", "engagementRate", "eventCount",
    ]
    kpi_metrics = stable_metrics + ["conversions"]
    ranges = [cur]
    if compare:
        ranges.append(DateRange(start_date=compare[0], end_date=compare[1], name="previous"))
    try:
        k = report([], kpi_metrics, ranges)
    except Exception:
        # Nieuwere properties kennen alleen keyEvents (de opvolger van
        # conversions); probeer die eerst voordat de metric helemaal vervalt.
        try:
            kpi_metrics = stable_metrics + ["keyEvents"]
            k = report([], kpi_metrics, ranges)
        except Exception:
            kpi_metrics = stable_metrics
            k = report([], kpi_metrics, ranges)
    cur_vals, prev_vals = {}, {}
    for row in k.rows:
        which = row.dimension_values[0].value if row.dimension_values else "current"
        target = prev_vals if which == "previous" else cur_vals
        for i, m in enumerate(kpi_metrics):
            target[m] = float(row.metric_values[i].value)
    for vals in (cur_vals, prev_vals):
        if "keyEvents" in vals:
            vals["conversions"] = vals["keyEvents"]

    kpis = {
        "users": int(cur_vals.get("totalUsers", 0)),
        "newUsers": int(cur_vals.get("newUsers", 0)),
        "sessions": int(cur_vals.get("sessions", 0)),
        "pageViews": int(cur_vals.get("screenPageViews", 0)),
        "bounceRate": cur_vals.get("bounceRate", 0.0),
        "avgSessionDuration": cur_vals.get("averageSessionDuration", 0.0),
        "engagementRate": cur_vals.get("engagementRate", 0.0),
        "eventCount": int(cur_vals.get("eventCount", 0)),
        "conversions": int(cur_vals.get("conversions", 0)),
    }
    deltas = None
    if compare:
        def delta(metric):
            c, p = cur_vals.get(metric, 0.0), prev_vals.get(metric, 0.0)
            return ((c - p) / p * 100) if p else None
        deltas = {
            "users": delta("totalUsers"),
            "newUsers": delta("newUsers"),
            "sessions": delta("sessions"),
            "pageViews": delta("screenPageViews"),
            "bounceRate": delta("bounceRate"),
            "avgSessionDuration": delta("averageSessionDuration"),
            "engagementRate": delta("engagementRate"),
            "eventCount": delta("eventCount"),
            "conversions": delta("conversions"),
        }

    # --- extra KPIs (GA4-interface parity) ---
    # A second no-dimension report keeps each request under GA4's 10-metric limit
    # while adding the rest of the headline metrics you see in the GA4 UI. safe():
    # a property lacking one (e.g. no ecommerce -> totalRevenue) degrades cleanly.
    extra_metrics = [
        "activeUsers", "engagedSessions", "userEngagementDuration",
        "screenPageViewsPerSession", "sessionsPerUser", "totalRevenue",
    ]

    def _extra_kpis():
        r = report([], extra_metrics, ranges)
        for row in r.rows:
            which = row.dimension_values[0].value if row.dimension_values else "current"
            target = prev_vals if which == "previous" else cur_vals
            for i, m in enumerate(extra_metrics):
                target[m] = float(row.metric_values[i].value)

    safe(_extra_kpis, None)

    au = cur_vals.get("activeUsers", 0.0)
    kpis.update({
        "activeUsers": int(au),
        "engagedSessions": int(cur_vals.get("engagedSessions", 0)),
        "engagementDuration": cur_vals.get("userEngagementDuration", 0.0),
        # GA4's headline "gemiddelde betrokkenheidstijd" = engagement time / active user.
        "avgEngagementTime": (cur_vals.get("userEngagementDuration", 0.0) / au) if au else 0.0,
        "viewsPerSession": cur_vals.get("screenPageViewsPerSession", 0.0),
        "sessionsPerUser": cur_vals.get("sessionsPerUser", 0.0),
        "revenue": cur_vals.get("totalRevenue", 0.0),
    })
    if deltas is not None:
        def edelta(metric):
            c, p = cur_vals.get(metric, 0.0), prev_vals.get(metric, 0.0)
            return ((c - p) / p * 100) if p else None
        deltas.update({
            "activeUsers": edelta("activeUsers"),
            "engagedSessions": edelta("engagedSessions"),
            "viewsPerSession": edelta("screenPageViewsPerSession"),
            "sessionsPerUser": edelta("sessionsPerUser"),
            "revenue": edelta("totalRevenue"),
        })

    # --- e-commerce KPI's (GA4 monetization) ---
    # Eigen safe()-report: een property zonder e-commerce-meting levert dan
    # gewoon nullen in plaats van een fout. averagePurchaseRevenue is de
    # "gemiddelde orderwaarde" zoals de GA4-interface die toont; addToCarts en
    # checkouts vormen samen met transactions de winkelfunnel.
    ecom_metrics = [
        "transactions", "averagePurchaseRevenue", "addToCarts",
        "checkouts", "firstTimePurchasers",
    ]

    def _ecom_kpis():
        r = report([], ecom_metrics, ranges)
        for row in r.rows:
            which = row.dimension_values[0].value if row.dimension_values else "current"
            target = prev_vals if which == "previous" else cur_vals
            for i, m in enumerate(ecom_metrics):
                target[m] = float(row.metric_values[i].value)

    safe(_ecom_kpis, None)
    kpis.update({
        "transactions": int(cur_vals.get("transactions", 0)),
        "avgOrderValue": cur_vals.get("averagePurchaseRevenue", 0.0),
        "addToCarts": int(cur_vals.get("addToCarts", 0)),
        "checkouts": int(cur_vals.get("checkouts", 0)),
        "firstTimePurchasers": int(cur_vals.get("firstTimePurchasers", 0)),
    })
    if deltas is not None:
        deltas.update({
            "transactions": edelta("transactions"),
            "avgOrderValue": edelta("averagePurchaseRevenue"),
            "addToCarts": edelta("addToCarts"),
            "checkouts": edelta("checkouts"),
            "firstTimePurchasers": edelta("firstTimePurchasers"),
        })

    # --- metrics over time ---
    # One dated report covers every scalar KPI, so each KPI-card can show its own
    # daily trend (sparkline), not just sessions. Same fallback as the KPI block
    # if `conversions` is unsupported on a migrated property.
    date_order = [OrderBy(dimension=OrderBy.DimensionOrderBy(dimension_name="date"))]
    series_metrics = stable_metrics + ["conversions"]
    try:
        sd = report(["date"], series_metrics, cur_only, order_bys=date_order)
    except Exception:
        series_metrics = stable_metrics
        sd = report(["date"], series_metrics, cur_only, order_bys=date_order)
    sidx = {m: i for i, m in enumerate(series_metrics)}

    def _sv(row, metric):
        i = sidx.get(metric)
        if i is None:
            return 0.0
        try:
            return float(row.metric_values[i].value)
        except (TypeError, ValueError):
            return 0.0

    series_by_date, sessions_by_date = [], []
    for r in sd.rows:
        d = r.dimension_values[0].value
        item = {
            "date": d,
            "users": int(_sv(r, "totalUsers")),
            "newUsers": int(_sv(r, "newUsers")),
            "sessions": int(_sv(r, "sessions")),
            "pageViews": int(_sv(r, "screenPageViews")),
            "eventCount": int(_sv(r, "eventCount")),
            "conversions": int(_sv(r, "conversions")),
            "bounceRate": _sv(r, "bounceRate"),
            "avgSessionDuration": _sv(r, "averageSessionDuration"),
            "engagementRate": _sv(r, "engagementRate"),
        }
        series_by_date.append(item)
        sessions_by_date.append({"date": d, "sessions": item["sessions"]})

    # Enrich the daily series with the extra headline metrics (their own trend +
    # sparkline). Separate report to stay within the per-request metric limit.
    def _extra_series():
        r = report(["date"], ["activeUsers", "engagedSessions", "totalRevenue", "transactions"],
                   cur_only, order_bys=date_order)
        by_d = {row.dimension_values[0].value: row for row in r.rows}
        for item in series_by_date:
            row = by_d.get(item["date"])
            if not row:
                continue
            item["activeUsers"] = _int(row.metric_values[0].value)
            item["engagedSessions"] = _int(row.metric_values[1].value)
            item["revenue"] = float(row.metric_values[2].value)
            item["transactions"] = _int(row.metric_values[3].value)

    safe(_extra_series, None)

    compare_series = None
    if compare:
        try:
            sdp = report(
                ["date"], ["sessions"],
                [DateRange(start_date=compare[0], end_date=compare[1])],
                order_bys=date_order,
            )
            compare_series = [_int(r.metric_values[0].value) for r in sdp.rows]
        except Exception:
            compare_series = None

    # --- breakdowns (current range only) ---
    # Generic: any dimension ranked by any metric. Rows carry `value` (the metric
    # total) so the frontend can render sessions, events, users, etc. uniformly.
    def breakdown(dim, limit, metric="sessions"):
        rep = report([dim], [metric], cur_only, order_bys=[_metric_desc(metric)], limit=limit)
        rows = [(r.dimension_values[0].value, _int(r.metric_values[0].value)) for r in rep.rows]
        total = sum(v for _, v in rows) or 1
        out = []
        for label, v in rows:
            item = {"label": label, "value": v, "pct": _pct(v, total)}
            if metric == "sessions":
                item["sessions"] = v  # back-compat: existing screens/exports read .sessions
            out.append(item)
        return out

    channels = safe(lambda: breakdown("sessionDefaultChannelGroup", 6), [])
    devices = safe(lambda: breakdown("deviceCategory", 5), [])
    geography = safe(lambda: breakdown("country", 8), [])
    source_medium = safe(lambda: breakdown("sessionSourceMedium", 8), [])
    # Conversies per sessiebron/medium: welke bron levert de key events op.
    conversions_by_source = safe(lambda: breakdown("sessionSourceMedium", 8, metric="conversions"), [])
    browsers = safe(lambda: breakdown("browser", 6), [])
    new_vs_returning = safe(lambda: breakdown("newVsReturning", 3), [])
    events = safe(lambda: breakdown("eventName", 10, metric="eventCount"), [])
    # Extra GA4-interface dimensions. Each is an independent, safe() report so an
    # unsupported one (e.g. age/gender need Google Signals) never breaks the rest.
    cities = safe(lambda: breakdown("city", 8), [])
    languages = safe(lambda: breakdown("language", 6), [])
    operating_systems = safe(lambda: breakdown("operatingSystem", 6), [])
    platforms = safe(lambda: breakdown("platform", 4), [])
    screen_resolutions = safe(lambda: breakdown("screenResolution", 8), [])
    session_campaigns = safe(lambda: breakdown("sessionCampaignName", 8), [])
    first_user_channels = safe(lambda: breakdown("firstUserDefaultChannelGroup", 6), [])
    first_user_source_medium = safe(lambda: breakdown("firstUserSourceMedium", 8), [])
    age = safe(lambda: breakdown("userAgeBracket", 6, metric="activeUsers"), [])
    gender = safe(lambda: breakdown("userGender", 4, metric="activeUsers"), [])

    # `views` holds whatever ranking metric the dimension supports. pagePath ranks
    # by screenPageViews; landingPage is session-scoped and is NOT compatible with
    # screenPageViews, so it ranks by sessions instead.
    def page_table(dim, limit, metric="screenPageViews"):
        rep = report(
            [dim], [metric, "bounceRate"],
            cur_only, order_bys=[_metric_desc(metric)], limit=limit,
        )
        return [
            {
                "path": r.dimension_values[0].value,
                "views": _int(r.metric_values[0].value),
                "bounceRate": float(r.metric_values[1].value),
            }
            for r in rep.rows
        ]

    top_pages = safe(lambda: page_table("pagePath", 8), [])
    page_titles = safe(lambda: page_table("pageTitle", 8), [])
    landing_pages = safe(lambda: page_table("landingPage", 8, metric="sessions"), [])

    def _conversions():
        cv = report(["eventName"], ["conversions"], cur_only, order_bys=[_metric_desc("conversions")], limit=8)
        return [
            {"name": r.dimension_values[0].value, "count": _int(r.metric_values[0].value)}
            for r in cv.rows
            if _int(r.metric_values[0].value) > 0
        ]

    conversions = safe(_conversions, [])

    # Top verkochte producten (GA4 item-scope): itemName gerangschikt op
    # itemomzet. Eigen safe()-report, want item-metrics mogen niet met
    # event-metrics gemixt worden en niet elke property meet e-commerce.
    def _top_items():
        rep = report(
            ["itemName"], ["itemsPurchased", "itemRevenue"],
            cur_only, order_bys=[_metric_desc("itemRevenue")], limit=10,
        )
        return [
            {
                "name": r.dimension_values[0].value,
                "qty": _int(r.metric_values[0].value),
                "revenue": float(r.metric_values[1].value),
            }
            for r in rep.rows
        ]

    top_items = safe(_top_items, [])

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
        "conversions_by_source": conversions_by_source,
        "browsers": browsers,
        "new_vs_returning": new_vs_returning,
        "events": events,
        "cities": cities,
        "languages": languages,
        "operating_systems": operating_systems,
        "platforms": platforms,
        "screen_resolutions": screen_resolutions,
        "session_campaigns": session_campaigns,
        "first_user_channels": first_user_channels,
        "first_user_source_medium": first_user_source_medium,
        "age": age,
        "gender": gender,
        "top_pages": top_pages,
        "page_titles": page_titles,
        "landing_pages": landing_pages,
        "conversions": conversions,
        "top_items": top_items,
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
