"""Thin wrappers around the Google Analytics Data and Admin APIs (GA4)."""
from google.analytics.admin_v1beta import AnalyticsAdminServiceClient
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    DateRange,
    Dimension,
    Metric,
    RunReportRequest,
)
from google.oauth2.credentials import Credentials


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
