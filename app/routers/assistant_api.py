"""AI-assistent (chat met tools) en de signalen/insights."""
import json
import logging
import time
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from google.auth.exceptions import RefreshError
from pydantic import BaseModel

from .. import (
    analytics, assistant, auth, cache, config, demo, google_ads, insights, meta,
    meta_oauth, models, oauth, ratelimit, search_console, woocommerce,
)
from ..org_access import (
    _compact, _connected, _google_data, _GOOGLE_TRANSIENT_MSG, _is_grant_revoked,
    _meta_token, _org_credentials, _previous_period, _require_period,
    _resolve_org_id, _wc_creds,
)

log = logging.getLogger("dashboard")
router = APIRouter()

class ChatBody(BaseModel):
    messages: list
    org_id: str | None = None
    start: str
    end: str
    property_id: str | None = None
    site: str | None = None


@router.post("/api/assistant/chat")
def assistant_chat(request: Request, body: ChatBody):
    """Stream the AI assistant's answer (SSE). Tools read the active org's data."""
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, body.org_id)
    if not config.EUROUTER_API_KEY:
        raise HTTPException(status_code=503, detail="Assistent is niet geconfigureerd.")
    if not ratelimit.allow(f"assistant|{target_org}", limit=20, window_s=60):
        raise HTTPException(status_code=429, detail="Te veel vragen achter elkaar - probeer het zo weer.")

    # Only trust user/assistant text turns from the client — never a client-supplied
    # "system"/"tool" role (the server owns the system prompt and tool results).
    safe_messages = [
        {"role": m["role"], "content": m["content"]}
        for m in body.messages
        if isinstance(m, dict) and m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str)
    ]
    if not safe_messages:
        raise HTTPException(status_code=400, detail="Geen geldige vraag.")
    if len(safe_messages) > 40 or sum(len(m["content"]) for m in safe_messages) > 20000:
        raise HTTPException(status_code=413, detail="Gesprek te lang - begin een nieuw gesprek.")

    def _tool_period(tool_input: dict) -> tuple[str, str]:
        """Model-supplied start/end (validated) win over the dashboard period."""
        s, e = tool_input.get("start"), tool_input.get("end")
        try:
            if s and e and date.fromisoformat(s) <= date.fromisoformat(e):
                return s, e
        except (TypeError, ValueError):
            pass
        return body.start, body.end

    # --- per-channel fetchers (raise HTTPException 409 when not connected) ---
    # Reused by both the single-channel tools and the cross-channel overview, so
    # the org-scoping and property/site/account selection live in one place. Demo
    # orgs serve generated sample data, mirroring the dashboard endpoints.
    demo_org = models.is_demo_org(target_org)
    # Bureau-omgeving: de assistent gebruikt de aan dit bedrijf toegewezen bron,
    # zodat een klant nooit cijfers van een ander bedrijf te zien krijgt.
    assigned = models.get_org_assets(target_org)

    def _fetch_analytics(start, end, compare):
        if demo_org:
            return demo.overview(start, end, compare)
        creds = _org_credentials(target_org)
        prop = assigned.get("ga_property_id") or body.property_id
        if not prop:
            props = _google_data(target_org, "google_analytics", lambda: analytics.list_properties(creds))
            if not props:
                raise HTTPException(status_code=409, detail="Geen Analytics-property gekoppeld.")
            prop = props[0]["property_id"]
        return _google_data(target_org, "google_analytics",
                            lambda: analytics.run_ga_overview(creds, prop, start, end, compare))

    def _fetch_gsc(start, end, compare):
        if demo_org:
            return demo.gsc_report(start, end, compare)
        creds = _org_credentials(target_org, provider="search_console")
        site = assigned.get("gsc_site_url") or body.site
        if not site:
            sites = _google_data(target_org, "search_console", lambda: search_console.list_sites(creds))
            if not sites:
                raise HTTPException(status_code=409, detail="Geen Search Console-site gekoppeld.")
            site = sites[0]["site_url"]
        return _google_data(target_org, "search_console",
                            lambda: search_console.run_search_analytics(creds, site, start, end, compare))

    def _fetch_google_ads(start, end, compare):
        if demo_org:
            return demo.ads_overview(start, end, compare)
        creds = _org_credentials(target_org, provider="google_ads")
        cust = assigned.get("ads_customer_id")
        if not cust:
            accounts = google_ads.list_accounts(creds)
            if not accounts:
                raise HTTPException(status_code=409, detail="Geen Google Ads-account gekoppeld.")
            cust = accounts[0]["customer_id"]
        return google_ads.run_overview(creds, cust, start, end, compare)

    def _fetch_meta_ads(start, end, compare):
        if demo_org:
            return demo.meta_ads_overview(start, end, compare)
        token = _meta_token(target_org)
        accounts = (meta.list_assets(token).get("ad_accounts") or [])
        if not accounts:
            raise HTTPException(status_code=409, detail="Geen Meta-advertentieaccount gekoppeld.")
        return meta.ads_overview(token, accounts[0]["id"], start, end, compare)

    def _fetch_meta_organic(start, end):
        if demo_org:
            return demo.meta_organic_overview(start, end)
        token = _meta_token(target_org)
        pages = (meta.list_assets(token).get("pages") or [])
        if not pages:
            raise HTTPException(status_code=409, detail="Geen Facebook-pagina gekoppeld.")
        page = pages[0]
        ig_id = (page.get("instagram") or {}).get("id")
        return meta.organic_overview(token, page["id"], ig_id, start, end)

    def _fetch_woo(start, end, compare):
        store, ck, cs = _wc_creds(target_org)
        return woocommerce.run_overview(store, ck, cs, start, end, compare)

    def _marketing_overview(start, end, compare) -> dict:
        """Cross-channel figures with the relationships computed server-side, so the
        assistant states facts (blended ROAS, total spend, paid vs organic) instead
        of deriving them from separate blocks. Missing channels are simply skipped."""
        def safe(fn):
            try:
                return fn()
            except Exception:  # not connected / no data / API error -> skip channel
                return None

        ga = safe(lambda: _fetch_analytics(start, end, compare))
        gsc = safe(lambda: _fetch_gsc(start, end, compare))
        ads = safe(lambda: _fetch_google_ads(start, end, compare))
        mads = safe(lambda: _fetch_meta_ads(start, end, compare))
        woo = safe(lambda: _fetch_woo(start, end, compare))

        connected = []
        if ga: connected.append("google_analytics")
        if gsc: connected.append("search_console")
        if ads: connected.append("google_ads")
        if mads: connected.append("meta_ads")
        if woo: connected.append("woocommerce")

        def r2(v):
            return round(v, 2) if isinstance(v, (int, float)) else v

        # De combinatiecijfers komen uit één gedeelde, pure functie (insights.combine),
        # zodat de assistent en de cross-kanaal-signalen exact dezelfde getallen tonen.
        combined = insights.combine(ga, gsc, ads, mads, woo)
        per_channel = {}
        if ga: per_channel["google_analytics"] = {"kpis": ga.get("kpis"), "deltas": ga.get("deltas"), "channels": _compact(ga.get("channels", []), 6)}
        if gsc: per_channel["search_console"] = {"totals": gsc.get("totals"), "deltas": gsc.get("deltas")}
        if ads: per_channel["google_ads"] = {"kpis": ads.get("kpis"), "deltas": ads.get("deltas")}
        if mads: per_channel["meta_ads"] = {"kpis": mads.get("kpis"), "deltas": mads.get("deltas"), "results": _compact(mads.get("results", []), 6)}
        if woo: per_channel["woocommerce"] = {"kpis": woo.get("kpis")}

        return {
            "periode": {"start": start, "end": end, "vergelijking": {"start": compare[0], "end": compare[1]} if compare else None},
            "gekoppelde_kanalen": connected,
            "combinatie": combined,
            "per_kanaal": per_channel,
            "let_op": "De combinatiecijfers zijn server-side berekend en kloppend; gebruik ze zoals ze zijn.",
        }

    def execute(name: str, tool_input: dict) -> str:
        """Run one tool, org-scoped. Returns a JSON string; never raises."""
        start, end = _tool_period(tool_input or {})
        compare = _previous_period(start, end)  # deltas so the model states real trends
        try:
            if name == "list_connections":
                return json.dumps(_connections_payload(target_org), ensure_ascii=False, default=str)
            if name == "get_marketing_overview":
                return json.dumps(_marketing_overview(start, end, compare), ensure_ascii=False, default=str)
            if name == "get_insights":
                return json.dumps(
                    _compute_insights(target_org, start, end, body.property_id, body.site),
                    ensure_ascii=False, default=str,
                )
            if name == "get_analytics_overview":
                return json.dumps(_compact(_fetch_analytics(start, end, compare)), ensure_ascii=False, default=str)
            if name == "get_search_console":
                return json.dumps(_compact(_fetch_gsc(start, end, compare)), ensure_ascii=False, default=str)
            if name == "get_google_ads":
                try:
                    data = _fetch_google_ads(start, end, compare)
                except google_ads.AdsNotConfigured:
                    return json.dumps({"error": "Google Ads is nog niet geconfigureerd op de server."})
                return json.dumps(_compact(data), ensure_ascii=False, default=str)
            if name == "get_meta_ads":
                return json.dumps(_compact(_fetch_meta_ads(start, end, compare)), ensure_ascii=False, default=str)
            if name == "get_meta_organic":
                return json.dumps(_compact(_fetch_meta_organic(start, end)), ensure_ascii=False, default=str)
            if name == "get_woocommerce":
                return json.dumps(_compact(_fetch_woo(start, end, compare)), ensure_ascii=False, default=str)
            return json.dumps({"error": f"Onbekende tool: {name}"})
        except HTTPException as e:
            return json.dumps({"error": str(e.detail)}, ensure_ascii=False)
        except Exception:  # noqa: BLE001 - surface a generic tool error, log detail server-side
            log.exception("assistant tool failed name=%s org=%s", name, target_org)
            return json.dumps({"error": "Kon deze gegevens niet ophalen."}, ensure_ascii=False)

    def gather_context() -> str:
        """Data van alle gekoppelde kanalen als context voor modellen zonder
        tool-calling. Begint met het cross-kanaal overzicht (berekende verbanden),
        gevolgd door de losse kanalen; niet gekoppelde kanalen worden overgeslagen."""
        blocks = [f"## Cross-kanaal overzicht (verbanden)\n{execute('get_marketing_overview', {})}"]
        for name, label in (
            ("get_analytics_overview", "Google Analytics"),
            ("get_search_console", "Search Console"),
            ("get_google_ads", "Google Ads"),
            ("get_meta_ads", "META Ads"),
            ("get_meta_organic", "META Organisch"),
            ("get_woocommerce", "WooCommerce"),
        ):
            out = execute(name, {})
            try:
                parsed = json.loads(out)
            except (TypeError, ValueError):
                parsed = None
            if isinstance(parsed, dict) and parsed.get("error"):
                continue
            blocks.append(f"## {label}\n{out}")
        return "\n\n".join(blocks)

    stream = assistant.stream_chat(
        safe_messages, execute, gather_context,
        api_key=config.EUROUTER_API_KEY, base_url=config.EUROUTER_BASE_URL,
        model=config.EUROUTER_MODEL, period=(body.start, body.end),
    )
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )



def _compute_insights(
    target_org: str, start: str, end: str,
    property_id: str | None = None, site: str | None = None,
) -> dict:
    """Rule-based signalen (opvallende periode-op-periode-veranderingen per
    kanaal), gecachet. Gedeeld door het insights-endpoint (bel + zijpaneel) en
    de `get_insights`-tool van de assistent, zodat alle drie hetzelfde tonen."""
    key = f"{target_org}|insights|{start}|{end}|{property_id}|{site}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    try:
        compare = _previous_period(start, end)
    except ValueError:
        raise HTTPException(status_code=400, detail="Ongeldige periode")

    found: list[dict] = []
    # Bureau-omgeving: signalen alleen op de aan dit bedrijf toegewezen bron.
    assigned = models.get_org_assets(target_org)

    # Demo-organisatie: bereken de signalen op de gegenereerde voorbeelddata,
    # zodat bel, zijpaneel en assistent ook in de demo iets laten zien.
    if models.is_demo_org(target_org):
        data = demo.overview(start, end, compare)
        found += insights.from_channel("analytics", data.get("kpis", {}), data.get("deltas"))
        g = demo.gsc_report(start, end, compare)
        found += insights.from_channel("search_console", g.get("totals", {}), g.get("deltas"))
        found += insights.search_opportunities(g)
        a = demo.ads_overview(start, end, compare)
        found += insights.from_channel("google_ads", a.get("kpis", {}), a.get("deltas"))
        m = demo.meta_ads_overview(start, end, compare)
        found += insights.from_channel("meta_ads", m.get("kpis", {}), m.get("deltas"))
        # De demo-omzet komt uit Analytics (kpis.revenue); dat volstaat voor de
        # blended ROAS in de cross-kanaal-signalen.
        found += insights.cross_channel(insights.combine(data, g, a, m, None), a)
        payload = {"org_id": target_org, "insights": insights.rank(found, limit=30)}
        cache.set(key, payload, cache.ttl_for_range(end))
        return payload

    # Bewaar de per-kanaal-overzichten zodat we na afloop de cross-kanaal-signalen
    # (blended ROAS, uitgaven vs. conversies, verkeersverdeling) kunnen berekenen.
    ga_d = gsc_d = ads_d = meta_d = woo_d = None

    if _connected(target_org, "google_analytics"):
        try:
            creds = _org_credentials(target_org)
            prop = assigned.get("ga_property_id") or property_id
            if not prop:
                props = analytics.list_properties(creds)
                prop = props[0]["property_id"] if props else None
            if prop:
                ga_d = analytics.run_ga_overview(creds, prop, start, end, compare)
                found += insights.from_channel("analytics", ga_d.get("kpis", {}), ga_d.get("deltas"))
        except Exception:
            log.exception("insights: analytics failed org=%s", target_org)

    if _connected(target_org, "search_console"):
        try:
            creds = _org_credentials(target_org, provider="search_console")
            s = assigned.get("gsc_site_url") or site
            if not s:
                sites = search_console.list_sites(creds)
                s = sites[0]["site_url"] if sites else None
            if s:
                gsc_d = search_console.run_search_analytics(creds, s, start, end, compare)
                found += insights.from_channel("search_console", gsc_d.get("totals", {}), gsc_d.get("deltas"))
                found += insights.search_opportunities(gsc_d)
        except Exception:
            log.exception("insights: search console failed org=%s", target_org)

    if _connected(target_org, "google_ads"):
        try:
            creds = _org_credentials(target_org, provider="google_ads")
            cust = assigned.get("ads_customer_id")
            if not cust:
                accounts = google_ads.list_accounts(creds)
                cust = accounts[0]["customer_id"] if accounts else None
            if cust:
                ads_d = google_ads.run_overview(creds, cust, start, end, compare)
                found += insights.from_channel("google_ads", ads_d.get("kpis", {}), ads_d.get("deltas"))
        except google_ads.AdsNotConfigured:
            pass
        except Exception:
            log.exception("insights: google ads failed org=%s", target_org)

    if _connected(target_org, "meta_ads"):
        try:
            token = _meta_token(target_org)
            accounts = meta.list_assets(token).get("ad_accounts") or []
            if accounts:
                meta_d = meta.ads_overview(token, accounts[0]["id"], start, end, compare)
                found += insights.from_channel("meta_ads", meta_d.get("kpis", {}), meta_d.get("deltas"))
        except Exception:
            log.exception("insights: meta failed org=%s", target_org)

    # WooCommerce alleen voor de blended ROAS (omzet); geen eigen delta-signalen.
    if _connected(target_org, "woocommerce"):
        try:
            store, ck, cs = _wc_creds(target_org)
            woo_d = woocommerce.run_overview(store, ck, cs, start, end, compare)
        except Exception:
            log.exception("insights: woocommerce failed org=%s", target_org)

    found += insights.cross_channel(insights.combine(ga_d, gsc_d, ads_d, meta_d, woo_d), ads_d)

    payload = {"org_id": target_org, "insights": insights.rank(found, limit=30)}
    cache.set(key, payload, cache.ttl_for_range(end))
    return payload


@router.get("/api/insights")
def insights_endpoint(
    request: Request, start: str, end: str,
    org_id: str | None = None, property_id: str | None = None, site: str | None = None,
):
    """Proactive, rule-based insights: notable period-over-period changes per channel."""
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    return _compute_insights(target_org, start, end, property_id, site)

