"""Thin wrapper around the Google Analytics Data API (GA4)."""
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    DateRange,
    Dimension,
    Metric,
    RunReportRequest,
)
from google.oauth2.credentials import Credentials


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
