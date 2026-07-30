"""API-regressietests tegen een draaiende teststack.

Vereist: de app op BASE_URL (default http://127.0.0.1:8000) met de nep-EuRouter
als taalmodel, en een database die met tests/seed.py geseed is. De demo-org
(Janssen) wordt door de app zelf geseed. Draait met alleen `requests`.
"""
import json
import os
import sys

import requests

# Repo-root op het pad zodat losse unit-checks `from app import ...` kunnen doen
# (bij `python tests/api_test.py` staat alleen tests/ op sys.path).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8000")


def login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return s


def test_demo_basics(demo):
    conns = demo.get(f"{BASE}/api/connections").json()
    connected = [c["provider"] for c in conns["connections"] if c["status"] == "connected"]
    assert len(connected) >= 3, conns
    sub = demo.get(f"{BASE}/api/me").json()["subscription"]
    assert sub["plan"] == "trial" and not sub["expired"], sub
    print(f"demo: {len(connected)} kanalen gekoppeld, trial met {sub['days_left']} dagen")


def analyze(admin, feedback, msg_part):
    item = next(it for it in feedback if msg_part in it["message"])
    r = admin.post(f"{BASE}/api/admin/feedback/{item['id']}/analyze", stream=True)
    assert r.status_code == 200, (r.status_code, r.text)
    text, events = [], []
    for line in r.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data:"):
            continue
        ev = json.loads(line[5:].strip())
        events.append(ev["type"])
        if ev["type"] == "text":
            text.append(ev["text"])
        elif ev["type"] == "error":
            raise AssertionError(f"analyse-error: {ev['message']}")
    assert "thinking" in events and events[-1] == "done", events
    return "".join(text)


def test_feedback_analysis(demo, admin):
    for msg in (
        "De export knop werkt niet op de analytics pagina.",
        "leegdenk: soms zijn mijn kanalen ontkoppeld na een update.",
        "leegstil: de grafiek laadt traag op mobiel.",
    ):
        r = demo.post(f"{BASE}/api/feedback", json={"category": "bug", "message": msg, "page": "/app/analytics"})
        assert r.status_code == 200, (r.status_code, r.text)
    feedback = admin.get(f"{BASE}/api/admin/feedback").json()["feedback"]
    assert "Uitgewerkte omschrijving" in analyze(admin, feedback, "export knop")
    assert "Herkansing gelukt" in analyze(admin, feedback, "leegdenk")
    assert "denkstappen" in analyze(admin, feedback, "leegstil")
    print("feedback-analyse: normaal, herkansing en reasoning-vangnet slagen")


def test_trial_management(admin, tk_org_id):
    def post(action, days=14):
        return admin.post(f"{BASE}/api/admin/organizations/{tk_org_id}/trial", json={"action": action, "days": days})

    user = login("test@testklant.nl", "test123")
    assert post("restart").status_code == 200
    sub = user.get(f"{BASE}/api/me").json()["subscription"]
    assert sub["plan"] == "trial" and sub["days_left"] == 14, sub
    assert user.get(f"{BASE}/api/connections").status_code == 200

    assert post("stop").status_code == 200
    assert user.get(f"{BASE}/api/me").json()["subscription"]["expired"] is True
    r = user.get(f"{BASE}/api/connections")
    assert r.status_code == 402 and "proefperiode" in r.json()["detail"].lower(), (r.status_code, r.text)

    assert post("extend").status_code == 200
    assert user.get(f"{BASE}/api/connections").status_code == 200
    assert post("activate").status_code == 200
    assert user.get(f"{BASE}/api/me").json()["subscription"]["plan"] == "active"
    assert post("onzin").status_code == 400
    print("trial: restart, stop (402), extend, activate en validatie slagen")


def test_admin_pages(admin, tk_org_id):
    users = admin.get(f"{BASE}/api/admin/users").json()["users"]
    me_user = next(u for u in users if u["email"] == "admin@prompted-ai.nl")
    assert admin.patch(f"{BASE}/api/admin/users/{me_user['id']}", json={"role": "client"}).status_code == 400

    acts = admin.get(f"{BASE}/api/admin/activity").json()["activity"]
    assert len(acts) > 3 and {"org", "user"} <= {a["kind"] for a in acts}

    assert admin.post(f"{BASE}/api/admin/organizations/{tk_org_id}/package", json={"package": "groei"}).status_code == 200
    assert admin.post(f"{BASE}/api/admin/organizations/{tk_org_id}/package", json={"package": "fout"}).status_code == 400

    data = {"company_name": "Testklant B.V.", "billing_email": "administratie@testklant.nl", "kvk": "12345678"}
    assert admin.put(f"{BASE}/api/admin/organizations/{tk_org_id}/billing", json=data).status_code == 200
    saved = admin.get(f"{BASE}/api/admin/organizations/{tk_org_id}/billing").json()["billing"]
    assert saved["company_name"] == "Testklant B.V." and saved["updated_at"]

    # Zonder echte Google-koppeling faalt de diagnose netjes op laden of
    # verversen (afhankelijk van of er een testkoppeling in de database staat).
    d = admin.get(f"{BASE}/api/admin/diagnose/google?org_id={tk_org_id}&provider=google_analytics").json()
    assert d["ok"] is False and d["step"] in ("load", "refresh"), d
    print("adminpagina's: gebruikers, activiteit, pakketten, facturatie en diagnose slagen")


def test_framework(demo):
    # Zonder parameter: altijd de laatste 12 maanden, oplopend t/m de lopende maand.
    standaard = demo.get(f"{BASE}/api/framework").json()
    assert len(standaard["months"]) == 12, len(standaard["months"])
    maanden = [m["month"] for m in standaard["months"]]
    assert maanden == sorted(maanden) and all(m["auto"] for m in standaard["months"]), maanden

    d = demo.get(f"{BASE}/api/framework?months=3").json()
    assert len(d["months"]) == 3 and d["business_type"] in ("leadgen", "ecommerce"), d
    m = d["months"][-1]
    auto = m["auto"]
    assert auto["ads_kosten"] and auto["bezoekers"] and auto["conversies"], auto
    assert round(auto["ads_google"] + auto["ads_meta"], 2) == auto["ads_kosten"], auto

    month = m["month"]
    r = demo.put(f"{BASE}/api/framework/{month}",
                 json={"values": {"budget": 2500, "inkoopwaarde": 9000, "returns": 500}})
    assert r.status_code == 200, (r.status_code, r.text)
    upd = r.json()
    assert upd["manual"]["budget"] == 2500, upd["manual"]
    der, a = upd["derived"], upd["auto"]
    verwacht_poas = round((a["omzet_excl"] - 9000 - 500) / a["ads_kosten"], 2)
    assert der["poas"] == verwacht_poas, (der["poas"], verwacht_poas)
    verwacht_kpl = round(a["ads_kosten"] / a["conversies"], 2)
    assert der["kosten_per_lead"] == verwacht_kpl, (der["kosten_per_lead"], verwacht_kpl)

    r = demo.put(f"{BASE}/api/framework/{month}", json={"values": {"returns": None}})
    assert "returns" not in r.json()["manual"]
    assert demo.put(f"{BASE}/api/framework/{month}", json={"values": {"hack": 1}}).status_code == 400
    assert demo.put(f"{BASE}/api/framework/2099-01", json={"values": {"budget": 1}}).status_code == 400
    assert demo.put(f"{BASE}/api/framework/{month}", json={"values": {"budget": -5}}).status_code == 400
    demo.put(f"{BASE}/api/framework/{month}", json={"values": {"budget": None, "inkoopwaarde": None}})
    print("raamwerk: autowaarden, opslaan, afgeleide formules en validatie slagen")


def test_meta_login_redirect(demo):
    """De META-koppelknop moet naar Facebook doorsturen, nooit een 500 geven.

    Regressietest: na de router-opsplitsing ontbrak _safe_return in channels.py,
    wat in productie (met META geconfigureerd) elke koppelpoging liet crashen.
    CI zet daarom een dummy META-config zodat dit pad echt doorlopen wordt.
    """
    r = demo.get(f"{BASE}/api/auth/meta/login?return_to=/app/integrations", allow_redirects=False)
    assert r.status_code in (302, 307), (r.status_code, r.text[:200])
    assert "facebook.com" in r.headers.get("location", ""), r.headers.get("location")
    print("meta-login: nette redirect naar Facebook")


def test_meta_data_no_crash():
    """De META-databronnen mogen nooit 500'en, ook niet als de Graph-call faalt.

    Regressie: _meta_token in org_access.py gebruikte meta_oauth zonder import,
    waardoor elke META Ads-pagina (met een echte koppeling) crashte. De org
    metatest.nl heeft een neppe META-koppeling; de Graph-call mislukt en de
    endpoints horen netjes naar lege data te degraderen.
    """
    s = login("meta@metatest.nl", "metatest123")
    assert s.get(f"{BASE}/api/meta/accounts").status_code == 200
    r = s.get(f"{BASE}/api/meta/ads-report?ad_account_id=act_123&start=2026-06-01&end=2026-06-30")
    assert r.status_code == 200, (r.status_code, r.text)
    print("meta-data: geen 500 bij een falende Graph-call")


def test_shopify_flow(demo):
    """Shopify-installatieroute, strikte domeinvalidatie en 409 zonder koppeling."""
    r = demo.get(f"{BASE}/api/auth/shopify/login?shop=demoshop.myshopify.com", allow_redirects=False)
    assert r.status_code in (302, 307), (r.status_code, r.text[:150])
    assert "demoshop.myshopify.com/admin/oauth/authorize" in r.headers.get("location", ""), r.headers.get("location")
    # Alleen *.myshopify.com is toegestaan; alles anders wordt geweigerd.
    assert demo.get(f"{BASE}/api/auth/shopify/login?shop=kwaad.nl", allow_redirects=False).status_code == 400
    # Rapport zonder koppeling -> 409 (opnieuw koppelen), nooit 500.
    tk = login("test@testklant.nl", "test123")
    assert tk.get(f"{BASE}/api/shopify/report?start=2026-06-01&end=2026-06-30").status_code == 409
    print("shopify: login-redirect, domeinvalidatie en 409 zonder koppeling")


def test_shopify_app_launch(demo):
    """App Store-launch: Shopify opent de App URL met ?shop=&hmac=. Een geldige
    (correct ondertekende) launch moet meteen naar de OAuth-installatieflow
    redirecten; een ontbrekende/ongeldige HMAC toont gewoon de SPA (geen redirect)."""
    import hashlib
    import hmac as hmaclib
    from app import config

    shop = "launchtest.myshopify.com"

    def launch_hmac(params):
        pairs = "&".join(f"{k}={v}" for k, v in sorted(params.items()) if k != "hmac")
        return hmaclib.new(config.SHOPIFY_API_SECRET.encode(), pairs.encode(), hashlib.sha256).hexdigest()

    params = {"shop": shop, "timestamp": "1700000000", "host": "abc123"}
    params["hmac"] = launch_hmac(params)
    r = demo.get(f"{BASE}/", params=params, allow_redirects=False)
    assert r.status_code in (302, 307), (r.status_code, r.text[:150])
    assert f"{shop}/admin/oauth/authorize" in r.headers.get("location", ""), r.headers.get("location")
    # Ongeldige HMAC -> geen OAuth-redirect (SPA of 503, nooit naar Shopify).
    bad = demo.get(f"{BASE}/", params={**params, "hmac": "fout"}, allow_redirects=False)
    assert "oauth/authorize" not in bad.headers.get("location", ""), bad.headers.get("location")
    print("shopify-launch: geldige App URL-launch redirect naar OAuth, ongeldige HMAC niet")


def test_shopify_demo(demo):
    """De demo-organisatie heeft een ingebouwde Shopify-demowinkel met
    deterministische voorbeelddata (omzet, orders, topproducten, delta's)."""
    r = demo.get(f"{BASE}/api/shopify/report?start=2026-06-01&end=2026-06-30"
                 "&compare_start=2026-05-01&compare_end=2026-05-31")
    assert r.status_code == 200, (r.status_code, r.text)
    body = r.json()
    assert body["kpis"]["revenue"] > 0 and body["kpis"]["orders"] > 0, body
    assert body["by_date"] and body["top_products"], body
    assert "deltas" in body and body.get("recent_orders"), body
    print(f"shopify-demo: voorbeeldwinkel geeft {body['kpis']['orders']} orders en omzet")


def test_shopify_webhook_hmac():
    """De webhook-HMAC (base64 van HMAC-SHA256 over de rauwe body) accepteert een
    geldige handtekening en weigert een ongeldige/lege. Puur, zonder server."""
    import base64, hashlib
    import hmac as hmaclib
    from app import config, shopify_oauth
    body = b'{"shop_domain":"x.myshopify.com"}'
    sig = base64.b64encode(hmaclib.new(config.SHOPIFY_API_SECRET.encode(), body, hashlib.sha256).digest()).decode()
    assert shopify_oauth.verify_webhook_hmac(body, sig) is True
    assert shopify_oauth.verify_webhook_hmac(body, "fout") is False
    assert shopify_oauth.verify_webhook_hmac(body, "") is False
    print("shopify-webhook-HMAC: geldige handtekening geaccepteerd, ongeldige geweigerd")


def test_shopify_webhooks(demo, tk_org_id):
    """De GDPR-webhooks: geldige HMAC -> 200 op alle drie de topics, ongeldige
    HMAC -> 401, en shop/redact verwijdert echt de Shopify-koppeling van die shop.
    Vereist de draaiende server (echte HTTP)."""
    import base64, hashlib
    import hmac as hmaclib
    from app import config, models
    secret = config.SHOPIFY_API_SECRET.encode()

    def sign(b):
        return base64.b64encode(hmaclib.new(secret, b, hashlib.sha256).digest()).decode()

    shop = "webhooktest.myshopify.com"
    body = json.dumps({"shop_domain": shop}).encode()
    hdr = {"X-Shopify-Hmac-Sha256": sign(body), "X-Shopify-Shop-Domain": shop, "Content-Type": "application/json"}
    for path in ("customers-data-request", "customers-redact", "shop-redact"):
        r = requests.post(f"{BASE}/api/webhooks/shopify/{path}", data=body, headers=hdr)
        assert r.status_code == 200, (path, r.status_code, r.text)
    # Ongeldige handtekening wordt geweigerd.
    assert requests.post(f"{BASE}/api/webhooks/shopify/shop-redact", data=body,
                         headers={"X-Shopify-Hmac-Sha256": "fout"}).status_code == 401
    # shop/redact verwijdert de koppeling van die shop.
    models.save_connection(tk_org_id, shop, {"shop": shop, "access_token": "x"}, provider="shopify")
    assert models.get_connection(tk_org_id, provider="shopify")
    assert requests.post(f"{BASE}/api/webhooks/shopify/shop-redact", data=body, headers=hdr).status_code == 200
    assert models.get_connection(tk_org_id, provider="shopify") is None
    # Het verzamel-endpoint dispatcht op de X-Shopify-Topic-header: dezelfde
    # HMAC-eis (401 zonder), 200 op elk topic, en shop/redact wist ook hier.
    for topic in ("customers/data_request", "customers/redact"):
        r = requests.post(f"{BASE}/api/webhooks/shopify/compliance", data=body,
                          headers={**hdr, "X-Shopify-Topic": topic})
        assert r.status_code == 200, (topic, r.status_code, r.text)
    assert requests.post(f"{BASE}/api/webhooks/shopify/compliance", data=body,
                         headers={"X-Shopify-Hmac-Sha256": "fout", "X-Shopify-Topic": "shop/redact"}).status_code == 401
    models.save_connection(tk_org_id, shop, {"shop": shop, "access_token": "x"}, provider="shopify")
    assert requests.post(f"{BASE}/api/webhooks/shopify/compliance", data=body,
                         headers={**hdr, "X-Shopify-Topic": "shop/redact"}).status_code == 200
    assert models.get_connection(tk_org_id, provider="shopify") is None
    print("shopify-webhooks: HMAC 200/401, shop/redact wist, ook via /compliance")


def test_shopify_aggregate():
    """Alleen betaalde orders tellen mee in de Shopify-omzetberekening."""
    from app import shopify
    orders = [
        {"financial_status": "paid", "total_price": "100.00", "created_at": "2026-06-02T10:00:00",
         "customer": {"id": 1}, "line_items": [{"name": "A", "quantity": 2, "price": "50.00"}]},
        {"financial_status": "pending", "total_price": "999.00", "created_at": "2026-06-02T10:00:00"},
    ]
    k = shopify._aggregate(orders)["kpis"]
    assert k["revenue"] == 100.0 and k["orders"] == 1 and k["avgOrderValue"] == 100.0 and k["itemsSold"] == 2, k
    print("shopify-aggregatie: alleen betaalde orders tellen mee")


def test_signalen(demo):
    """De signalen (insights) op de demo: het endpoint geeft een nette lijst met
    per signaal een kanaal, ernst, titel en vervolgvraag. Voedt de bel en de
    Signalen-pagina."""
    r = demo.get(f"{BASE}/api/insights?start=2026-06-01&end=2026-06-30")
    assert r.status_code == 200, (r.status_code, r.text)
    items = r.json()["insights"]
    assert isinstance(items, list), items
    for it in items:
        assert it.get("channel") and it.get("channel_label"), it
        assert it.get("severity") in ("positive", "negative", "neutral"), it
        assert it.get("title") and it.get("question"), it
    print(f"signalen: {len(items)} nette signalen op de demo")


def test_cross_channel_signals():
    """De cross-kanaal-regels vuren deterministisch en storten niet in op lege
    invoer. Puur, zonder server (net als de Shopify-aggregatietest)."""
    from app import insights
    base = {"advertentie_uitgaven_totaal": 1000, "blended_roas": 3.0, "verkeersverdeling_pct": {"betaald": 20}}
    # Uitgaven stijgen fors, conversies blijven achter -> 'let op'.
    r1 = insights.cross_channel(base, {"deltas": {"cost": 25, "conversions": 2}})
    assert any(s["severity"] == "negative" and "conversies" in s["detail"] for s in r1), r1
    # ROAS stijgt sterk -> opschaalkans.
    r2 = insights.cross_channel(base, {"deltas": {"roas": 30}})
    assert any(s["severity"] == "positive" for s in r2), r2
    # Lage blended ROAS -> staande waarschuwing.
    r3 = insights.cross_channel({**base, "blended_roas": 1.4}, {"deltas": {}})
    assert any(s["severity"] == "negative" and s["delta"] is None for s in r3), r3
    # Veel betaald verkeer -> informatief.
    r4 = insights.cross_channel({**base, "verkeersverdeling_pct": {"betaald": 62}}, {"deltas": {}})
    assert any(s["severity"] == "neutral" for s in r4), r4
    # Lege invoer mag nooit crashen.
    assert insights.cross_channel({"advertentie_uitgaven_totaal": None, "blended_roas": None, "verkeersverdeling_pct": None}, None) == []
    print("cross-kanaal-signalen: rendement, opschalen, lage ROAS en verkeersmix vuren correct")


def test_dashboard_spec_validation():
    """De server-side validatie van AI-gegenereerde widgets: onbekende bronnen
    worden gedropt, een ongeldige kind valt terug, en een custom-KPI-spec moet
    naar bestaande scalar-bronnen verwijzen. Puur, zonder server of model."""
    from app.routers import dashboards as d
    sources = {
        "cost": {"kinds": ["kpi"], "scalar": True, "label": "Kosten"},
        "orders": {"kinds": ["kpi"], "scalar": True, "label": "Bestellingen"},
        "channels": {"kinds": ["donut", "bars"], "scalar": False, "label": "Bronnen"},
    }
    assert d._clean_custom_spec({"op": "ratio", "refs": ["cost", "orders"], "fmt": "euro"}, sources) == {"op": "ratio", "refs": ["cost", "orders"], "fmt": "euro"}
    assert d._clean_custom_spec({"op": "ratio", "refs": ["cost"]}, sources) is None            # ratio vereist 2 refs
    assert d._clean_custom_spec({"op": "sum", "refs": ["channels"]}, sources) is None           # geen scalar
    assert d._clean_custom_spec({"op": "pow", "refs": ["cost", "orders"]}, sources) is None      # onbekende op
    widgets, dropped = d._sanitize_generated([
        {"source": "cost", "kind": "kpi", "size": 3, "title": "Kosten"},
        {"source": "channels", "kind": "pie", "size": 4, "title": "Bronnen"},   # pie ongeldig -> donut
        {"source": "weg", "kind": "kpi", "size": 3},                             # onbekend -> gedropt
        {"source": "custom", "kind": "kpi", "size": 3, "title": "CPO", "spec": {"op": "ratio", "refs": ["cost", "orders"]}},
    ], sources)
    assert dropped == 1, (dropped, widgets)
    pairs = {(w["source"], w["kind"]) for w in widgets}
    assert ("cost", "kpi") in pairs and ("channels", "donut") in pairs, pairs
    assert any(w["source"] == "custom" and w["spec"]["op"] == "ratio" for w in widgets), widgets
    print("dashboard-generatie: spec-validatie en sanering slagen")


def test_extract_json_robust():
    """De JSON-extractie uit modelantwoorden is bestand tegen denkblokken
    (qwen3), code-fences en trailing komma's. Puur, zonder model."""
    from app import assistant as a
    assert a._extract_json('{"widgets": []}') == {"widgets": []}
    assert a._extract_json("<think>even nadenken over {haakjes}</think>\n{\"widgets\": [1]}") == {"widgets": [1]}
    assert a._extract_json("```json\n{\"a\": 1}\n```") == {"a": 1}
    assert a._extract_json('Hier is het:\n{"a": 1, "b": [2,],}') == {"a": 1, "b": [2]}   # trailing komma's
    # kimi-achtige redeneertekst met losse accolades, gevolgd door de echte JSON:
    # pak het laatste object met 'widgets', niet de losse accolade ervoor.
    assert a._extract_json('Ik gebruik {bron: users} en dan... {"widgets": [{"source": "users"}]}') == {"widgets": [{"source": "users"}]}
    assert a._extract_json("<think>onafgemaakt denken zonder json") is None
    assert a._extract_json("geen json hier") is None
    print("JSON-extractie: denkblokken, losse accolades, fences en trailing komma's worden correct verwerkt")


def test_dashboard_generate(demo):
    """AI stelt een dashboard samen: het endpoint valideert tegen de meegestuurde
    catalogus, dropt een ongeldige widget, accepteert een custom-KPI, en het
    concept is als dashboard te bewaren en terug te laden. Vereist de nep-EuRouter."""
    manifest = {
        "page": "analytics",
        "kinds": ["kpi", "area", "donut", "bars", "table"],
        "sizes": [3, 4, 6, 12],
        "custom_ops": ["ratio", "sum", "diff", "product", "identity"],
        "sources": [
            {"key": "users", "label": "Bezoekers", "kinds": ["kpi"], "scalar": True},
            {"key": "sessions", "label": "Sessies", "kinds": ["kpi"], "scalar": True},
            {"key": "channels", "label": "Verkeersbronnen", "kinds": ["donut", "bars", "table"], "scalar": False},
        ],
    }
    r = demo.post(f"{BASE}/api/dashboards/generate", json={
        "prompt": "laat mijn verkeer zien met sessies per bezoeker", "page": "analytics", "manifest": manifest,
    })
    assert r.status_code == 200, (r.status_code, r.text)
    body = r.json()
    widgets = body["layout"]["widgets"]
    srcs = [w["source"] for w in widgets]
    assert "users" in srcs and "channels" in srcs, srcs
    assert "bestaat_niet_xyz" not in srcs and body["dropped"] >= 1, body
    custom = next((w for w in widgets if w["source"] == "custom"), None)
    assert custom and custom["kind"] == "kpi" and set(custom["spec"]["refs"]) == {"users", "sessions"}, custom
    assert body["requests"], body
    # Het concept is een geldige, bewaarbare layout.
    created = demo.post(f"{BASE}/api/dashboards", json={"name": "AI-concept", "layout": body["layout"], "page": "analytics"})
    assert created.status_code == 200, (created.status_code, created.text)
    got = demo.get(f"{BASE}/api/dashboards/{created.json()['id']}").json()
    assert any(w["source"] == "custom" for w in got["layout"]["widgets"]), got
    print("dashboard-generatie (end-to-end): valideren, custom-KPI, opslaan en herladen slagen")


def test_dashboard_generate_reasoning(demo):
    """Kimi-achtig gedrag: het model eindigt met lege content en levert de JSON
    via reasoning_content (met een losse accolade in de denktekst). De generatie
    moet daar doorheen prikken. Vereist de nep-EuRouter."""
    manifest = {
        "page": "analytics", "kinds": ["kpi", "donut"], "sizes": [3, 4, 6, 12],
        "custom_ops": ["ratio", "sum", "diff", "product", "identity"],
        "sources": [
            {"key": "users", "label": "Bezoekers", "kinds": ["kpi"], "scalar": True},
            {"key": "sessions", "label": "Sessies", "kinds": ["kpi"], "scalar": True},
        ],
    }
    r = demo.post(f"{BASE}/api/dashboards/generate", json={
        "prompt": "denkmodel: geef mijn kerncijfers", "page": "analytics", "manifest": manifest,
    })
    assert r.status_code == 200, (r.status_code, r.text)
    widgets = r.json()["layout"]["widgets"]
    assert any(w["source"] == "users" for w in widgets), widgets
    print("dashboard-generatie (redeneermodel): JSON uit reasoning_content wordt correct verwerkt")


def test_account_flow(admin, tk_org_id):
    invitee = "nieuw@testklant.nl"
    # 1. uitnodiging aanmaken (zonder SMTP komt de link terug, niet gemaild)
    r = admin.post(f"{BASE}/api/admin/invitations", json={"email": invitee, "org_id": tk_org_id, "role": "client"})
    assert r.status_code == 200, (r.status_code, r.text)
    inv = r.json()
    assert inv["emailed"] is False and "/invite/" in inv["invite_url"], inv
    token = inv["invite_url"].rsplit("/", 1)[1]

    # 2. info + 3. te kort wachtwoord + 4. accepteren logt in
    info = requests.get(f"{BASE}/api/invitations/{token}").json()
    assert info["email"] == invitee and info["organization_name"], info
    assert requests.post(f"{BASE}/api/invitations/{token}/accept", json={"password": "kort"}).status_code == 400
    s = requests.Session()
    assert s.post(f"{BASE}/api/invitations/{token}/accept", json={"password": "geheim123"}).status_code == 200
    assert s.get(f"{BASE}/api/me").json()["email"] == invitee
    # 5. token is eenmalig + 6. login met nieuw wachtwoord werkt
    assert requests.get(f"{BASE}/api/invitations/{token}").status_code == 404
    assert requests.post(f"{BASE}/api/auth/login", json={"email": invitee, "password": "geheim123"}).status_code == 200

    # 7. forgot geeft altijd 200 (geen enumeratie)
    assert requests.post(f"{BASE}/api/auth/forgot", json={"email": "bestaatniet@nergens.nl"}).status_code == 200
    assert requests.post(f"{BASE}/api/auth/forgot", json={"email": invitee}).status_code == 200

    # 8. admin-resetlink -> nieuw wachtwoord -> eenmalig -> login
    uid = next(u for u in admin.get(f"{BASE}/api/admin/users").json()["users"] if u["email"] == invitee)["id"]
    rt = admin.post(f"{BASE}/api/admin/users/{uid}/reset-link").json()["reset_url"].rsplit("/", 1)[1]
    assert requests.get(f"{BASE}/api/auth/reset/{rt}").json()["email"] == invitee
    assert requests.post(f"{BASE}/api/auth/reset/{rt}", json={"password": "nieuwpass1"}).status_code == 200
    assert requests.post(f"{BASE}/api/auth/reset/{rt}", json={"password": "weer"}).status_code == 404
    assert requests.post(f"{BASE}/api/auth/login", json={"email": invitee, "password": "nieuwpass1"}).status_code == 200

    # 9. validatie + 10. autorisatie (klant mag niet uitnodigen)
    assert admin.post(f"{BASE}/api/admin/invitations", json={"email": "geenmail", "org_id": tk_org_id}).status_code == 400
    assert admin.post(f"{BASE}/api/admin/invitations", json={"email": "a@b.nl", "org_id": "nope"}).status_code == 404
    client = login(invitee, "nieuwpass1")
    assert client.post(f"{BASE}/api/admin/invitations", json={"email": "x@y.nl", "org_id": tk_org_id}).status_code == 403
    print("accountflow: uitnodigen, wachtwoord instellen, reset en autorisatie slagen")


def test_agency_environments(admin):
    """Bureau-model: koppeling hergebruiken, bron toewijzen en afdwinging."""
    # Verse klant-org om als bureau-omgeving in te richten.
    org = admin.post(f"{BASE}/api/admin/organizations",
                     json={"name": "AgencyKlant", "domain": "agencyklant.nl"}).json()["organization"]
    oid = org["id"]
    # Hergebruik de (geseede) bureau-koppeling voor dit bedrijf.
    r = admin.post(f"{BASE}/api/admin/organizations/{oid}/link-agency")
    assert r.status_code == 200 and r.json()["copied"] >= 1, (r.status_code, r.text)
    assert admin.put(f"{BASE}/api/admin/organizations/{oid}/assets",
                     json={"ga_property_id": "properties/111"}).status_code == 200
    got = admin.get(f"{BASE}/api/admin/organizations/{oid}/assets").json()
    assert got["managed"] is True and got["assets"]["ga_property_id"] == "properties/111", got

    # Afdwinging (deterministisch, zonder Google): een managed bedrijf gebruikt
    # uitsluitend de toegewezen bron, en de keuzelijst wordt daartoe beperkt.
    from app import org_access
    assert org_access._effective_asset(oid, "ga_property_id", "properties/999") == "properties/111"
    assert org_access._limit_assets(
        oid, [{"property_id": "properties/111"}, {"property_id": "properties/222"}],
        "property_id", "ga_property_id") == [{"property_id": "properties/111"}]
    # Managed zonder toewijzing voor een kanaal -> 409.
    try:
        org_access._effective_asset(oid, "gsc_site_url", None)
        assert False, "verwachtte 409"
    except Exception as e:
        assert getattr(e, "status_code", None) == 409, e

    # Autorisatie: een klant kan geen omgeving inrichten.
    client = login("test@testklant.nl", "test123")
    assert client.post(f"{BASE}/api/admin/organizations/{oid}/link-agency").status_code == 403
    assert client.get(f"{BASE}/api/admin/organizations/{oid}/available-assets").status_code == 403
    assert client.put(f"{BASE}/api/admin/organizations/{oid}/assets", json={"ga_property_id": "x"}).status_code == 403
    print("bureau-omgevingen: hergebruik, toewijzen, afdwinging en autorisatie slagen")


def test_account_features(admin):
    """Functies per klantaccount: instellen, meegeven bij aanmaken en afdwingen."""
    # Klant klaarzetten met twee functies uit. De rest staat standaard aan.
    org = admin.post(f"{BASE}/api/admin/organizations", json={
        "name": "FeatureKlant", "domain": "featureklant.nl",
        "features": {"signalen": False, "framework": False},
    }).json()["organization"]
    oid = org["id"]
    assert org["features"]["signalen"] is False and org["features"]["assistant"] is True, org
    # De klant hangt onder het bureau van de admin, zodat alleen dat bureau hem beheert.
    assert org["agency_id"], org

    got = admin.get(f"{BASE}/api/admin/organizations/{oid}/features").json()
    assert got["features"]["framework"] is False and got["features"]["dashboards"] is True, got
    assert [f["key"] for f in got["catalog"]] == \
        ["signalen", "assistant", "integrations", "framework", "dashboards"], got["catalog"]
    # Onbekende functies worden geweigerd.
    assert admin.put(f"{BASE}/api/admin/organizations/{oid}/features",
                     json={"features": {"onzin": True}}).status_code == 400

    # Uitnodigen + inloggen als deze klant: de functiestand komt mee naar de app.
    invite = admin.post(f"{BASE}/api/admin/invitations",
                        json={"email": "gebruiker@featureklant.nl", "org_id": oid}).json()
    token = invite["invite_url"].rsplit("/", 1)[1]
    s = requests.Session()
    assert s.post(f"{BASE}/api/invitations/{token}/accept", json={"password": "geheim123"}).status_code == 200
    me = s.get(f"{BASE}/api/me").json()
    assert me["features"]["signalen"] is False and me["is_platform_admin"] is False, me
    assert s.get(f"{BASE}/api/organizations").json()["organizations"][0]["features"]["framework"] is False

    # Uitgezette functies zijn server-side dicht, aangezette blijven bereikbaar.
    assert s.get(f"{BASE}/api/insights?start=2026-01-01&end=2026-01-31").status_code == 403
    assert s.get(f"{BASE}/api/framework").status_code == 403
    assert s.post(f"{BASE}/api/assistant/chat", json={
        "messages": [{"role": "user", "content": "hoi"}],
        "start": "2026-01-01", "end": "2026-01-31"}).status_code != 403
    assert s.get(f"{BASE}/api/dashboards").status_code == 200

    # Integraties uitzetten sluit koppelen en ontkoppelen af.
    assert admin.put(f"{BASE}/api/admin/organizations/{oid}/features",
                     json={"features": {"integrations": False}}).status_code == 200
    assert s.get(f"{BASE}/api/auth/google/connect?providers=google_analytics",
                 allow_redirects=False).status_code == 403
    assert s.post(f"{BASE}/api/connections/google_analytics/disconnect").status_code == 403
    assert s.post(f"{BASE}/api/woocommerce/connect-demo").status_code == 403

    # Weer aanzetten werkt meteen; een klant zet zijn eigen functies niet.
    assert admin.put(f"{BASE}/api/admin/organizations/{oid}/features",
                     json={"features": {"signalen": True}}).status_code == 200
    assert s.get(f"{BASE}/api/me").json()["features"]["signalen"] is True
    assert s.put(f"{BASE}/api/admin/organizations/{oid}/features",
                 json={"features": {"framework": True}}).status_code == 403

    # Kanalen per account: standaard alles aan; uitgezet kanaal is voor de
    # klant geblokkeerd om te koppelen, en /api/me draagt de stand mee.
    assert admin.put(f"{BASE}/api/admin/organizations/{oid}/features",
                     json={"features": {"integrations": True},
                           "channels": {"woocommerce": False, "onzin": True}}).status_code == 400
    r = admin.put(f"{BASE}/api/admin/organizations/{oid}/features",
                  json={"features": {"integrations": True}, "channels": {"woocommerce": False}})
    assert r.status_code == 200 and r.json()["channels"]["woocommerce"] is False, r.text
    assert r.json()["channels"]["shopify"] is True, r.text
    me = s.get(f"{BASE}/api/me").json()
    assert me["channels"]["woocommerce"] is False and me["channels"]["google_ads"] is True, me["channels"]
    assert s.post(f"{BASE}/api/woocommerce/connect-demo").status_code == 403
    assert s.get(f"{BASE}/api/auth/google/connect?providers=google_analytics",
                 allow_redirects=False).status_code in (302, 307)  # toegestaan kanaal
    # De admin mag het kanaal nog wél koppelen voor deze klant.
    assert admin.post(f"{BASE}/api/woocommerce/connect-demo?org_id={oid}").status_code == 200

    # Een uitgevinkt kanaal telt ook in de aggregaties (raamwerk, signalen) als
    # niet gekoppeld: er is nu een Woo-koppeling, maar het kanaal staat uit.
    from app import models, org_access
    assert org_access._connected(oid, "woocommerce") is False
    models.set_org_channels(oid, {"woocommerce": True})
    assert org_access._connected(oid, "woocommerce") is True

    # Generiek: elk kanaal dat de app kent valt onder de allowlist, en de
    # datapagina's ervan zijn dicht zolang het kanaal uitstaat. Zo werkt een
    # kanaal dat er later bij komt automatisch mee.
    data_endpoints = {
        "google_analytics": "/api/analytics/properties",
        "search_console": "/api/search-console/sites",
        "google_ads": "/api/google-ads/accounts",
        "meta_ads": "/api/meta/accounts",
        "woocommerce": "/api/woocommerce/report?start=2026-01-01&end=2026-01-31",
        "shopify": "/api/shopify/report?start=2026-01-01&end=2026-01-31",
    }
    assert set(models.CHANNELS) == set(data_endpoints), models.CHANNELS
    models.set_org_channels(oid, {k: False for k in models.CHANNELS})
    conns = s.get(f"{BASE}/api/connections").json()
    assert conns["connections"] == [] and conns["connected"] == 0, conns
    for channel, endpoint in data_endpoints.items():
        r = s.get(f"{BASE}{endpoint}")
        assert r.status_code == 403, (channel, r.status_code, r.text)
        assert "niet beschikbaar" in r.json()["detail"], (channel, r.text)
    # Weer aanzetten: de kanalen staan meteen weer in de lijst.
    models.set_org_channels(oid, {k: True for k in models.CHANNELS})
    assert len(s.get(f"{BASE}/api/connections").json()["connections"]) == len(models.CHANNELS)

    admin.delete(f"{BASE}/api/admin/organizations/{oid}")
    print("functies per account: aanmaken, instellen, kanalen en autorisatie slagen")


def test_agency_scope(admin):
    """Bureau-scope: een bureau-admin beheert alleen de eigen klantomgevingen."""
    from app import auth as app_auth, models

    # Tweede bureau met een eigen klant en een eigen (niet-platform) admin.
    ander = models.create_or_rename_organization("Ander Bureau", "ander-bureau-test.nl")
    models.set_org_is_agency(ander["id"], True)
    models.upsert_user("baas@ander-bureau-test.nl", ander["id"], "agency_admin")
    models.set_user_password("baas@ander-bureau-test.nl", app_auth.hash_password("geheim123"))
    vreemd = models.create_or_rename_organization(
        "Vreemde BV", "vreemde-bv-test.nl", agency_id=ander["id"])
    try:
        andere_admin = login("baas@ander-bureau-test.nl", "geheim123")
        me = andere_admin.get(f"{BASE}/api/me").json()
        assert me["role"] == "agency_admin" and me["is_platform_admin"] is False, me

        # Ziet uitsluitend het eigen bureau en de eigen klant.
        namen = sorted(o["name"] for o in
                       andere_admin.get(f"{BASE}/api/admin/organizations").json()["organizations"])
        assert namen == ["Ander Bureau", "Vreemde BV"], namen
        assert sorted(o["name"] for o in
                      andere_admin.get(f"{BASE}/api/organizations").json()["organizations"]) == namen

        # En komt nergens bij een klant van een ander bureau.
        tk = next(o for o in admin.get(f"{BASE}/api/admin/organizations").json()["organizations"]
                  if o["domain"] == "testklant.nl")
        for r in (andere_admin.get(f"{BASE}/api/admin/organizations/{tk['id']}/features"),
                  andere_admin.put(f"{BASE}/api/admin/organizations/{tk['id']}/features",
                                   json={"features": {"signalen": False}}),
                  andere_admin.get(f"{BASE}/api/admin/organizations/{tk['id']}/billing"),
                  andere_admin.post(f"{BASE}/api/admin/organizations/{tk['id']}/link-agency"),
                  andere_admin.delete(f"{BASE}/api/admin/organizations/{tk['id']}"),
                  andere_admin.get(f"{BASE}/api/framework?org_id={tk['id']}"),
                  andere_admin.post(f"{BASE}/api/admin/invitations",
                                    json={"email": "x@vreemde-bv-test.nl", "org_id": tk["id"]})):
            assert r.status_code == 403, (r.url, r.status_code, r.text)

        # Bureaubeheer is voorbehouden aan de platform-admin.
        assert andere_admin.get(f"{BASE}/api/admin/agencies").status_code == 403
        assert andere_admin.patch(f"{BASE}/api/admin/organizations/{vreemd['id']}/agency",
                                  json={"is_agency": True}).status_code == 403
        data = admin.get(f"{BASE}/api/admin/agencies").json()
        eigen = next(a for a in data["agencies"] if a["domain"] == "ander-bureau-test.nl")
        assert eigen["client_count"] == 1 and eigen["admin_count"] == 1, eigen
        # De organisatielijst bevat álle organisaties met hun bureau, niet alleen
        # de niet-toegewezen: anders valt er na de migratie niets te promoveren.
        rij = next(o for o in data["organizations"] if o["domain"] == "vreemde-bv-test.nl")
        assert rij["agency_id"] == eigen["id"] and rij["is_agency"] is False, rij
        # De platform-admin ziet de klanten van dat bureau wél.
        assert admin.get(f"{BASE}/api/admin/organizations/{vreemd['id']}/features").status_code == 200
        print("bureau-scope: eigen klanten zichtbaar, andermans klanten overal 403")
    finally:
        models.delete_organization(vreemd["id"])
        models.delete_organization(ander["id"])


def test_agency_promotion(admin):
    """Een organisatie die al onder een bureau hangt, tot bureau maken en terug."""
    from app import models

    org = admin.post(f"{BASE}/api/admin/organizations",
                     json={"name": "PromoBureau", "domain": "promobureau-test.nl"}).json()["organization"]
    oid = org["id"]
    assert org["agency_id"], org  # hangt eerst onder het bureau van de admin
    try:
        # Promoveren: bureau worden en tegelijk losgekoppeld van het eigen bureau.
        r = admin.patch(f"{BASE}/api/admin/organizations/{oid}/agency",
                        json={"is_agency": True, "agency_id": ""})
        assert r.status_code == 200, r.text
        got = r.json()["organization"]
        assert got["is_agency"] is True and got["agency_id"] is None, got
        assert any(a["id"] == oid for a in admin.get(f"{BASE}/api/admin/agencies").json()["agencies"])

        # Een klant onder het verse bureau hangen, en dan terugzetten weigeren.
        klant = models.create_or_rename_organization("PromoKlant", "promoklant-test.nl")
        try:
            assert admin.patch(f"{BASE}/api/admin/organizations/{klant['id']}/agency",
                               json={"agency_id": oid}).status_code == 200
            r = admin.patch(f"{BASE}/api/admin/organizations/{oid}/agency", json={"is_agency": False})
            assert r.status_code == 400 and "klantomgevingen" in r.json()["detail"], r.text
        finally:
            models.delete_organization(klant["id"])

        # Zonder klanten mag het wel.
        r = admin.patch(f"{BASE}/api/admin/organizations/{oid}/agency", json={"is_agency": False})
        assert r.status_code == 200 and r.json()["organization"]["is_agency"] is False, r.text
        print("bureau promoveren: toegewezen organisatie wordt bureau, terugzetten pas zonder klanten")
    finally:
        admin.delete(f"{BASE}/api/admin/organizations/{oid}")


def test_org_profile_and_delete(admin, tk_org_id, demo_org_id):
    """Bedrijfsprofiel instellen/bewerken, publiek-domein-blokkade en verwijderen."""
    # Klant stelt eigen bedrijfsprofiel in (naam los van e-mailadres).
    tk = login("test@testklant.nl", "test123")
    r = tk.patch(f"{BASE}/api/organizations/me/profile",
                 json={"name": "Testklant B.V.", "website": "https://testklant.nl", "industry": "mode"})
    assert r.status_code == 200 and r.json()["organization"]["website"] == "https://testklant.nl", r.text
    assert tk.get(f"{BASE}/api/me").json()["organization"]["name"] == "Testklant B.V."
    # Admin bewerkt profiel van een klant-org.
    assert admin.patch(f"{BASE}/api/organizations/{tk_org_id}",
                       json={"name": "Testklant", "industry": "horeca"}).status_code == 200
    # Publiek e-maildomein kan niet als klant worden toegevoegd.
    assert admin.post(f"{BASE}/api/admin/organizations", json={"name": "X", "domain": "gmail.com"}).status_code == 400
    # Verwijderen met cascade: maak een losse org, hang er data aan, verwijder.
    stray = admin.post(f"{BASE}/api/admin/organizations", json={"name": "Stray", "domain": "stray-test.nl"}).json()["organization"]
    assert admin.delete(f"{BASE}/api/admin/organizations/{stray['id']}").status_code == 200
    assert admin.get(f"{BASE}/api/admin/organizations/{stray['id']}/assets").json()["managed"] is False
    # Vangrails: demo en klant-403.
    assert admin.delete(f"{BASE}/api/admin/organizations/{demo_org_id}").status_code == 400
    assert tk.delete(f"{BASE}/api/admin/organizations/{tk_org_id}").status_code == 403
    print("bedrijfsprofiel + verwijderen: eigen/admin-profiel, publiek-domein-blokkade en vangrails slagen")


def test_feedback_scope(admin):
    """Feedback is per bureau afgeschermd, ook wijzigen en AI-analyse."""
    from app import auth as app_auth, models

    # Tweede bureau met een eigen klant, een eigen admin en eigen feedback.
    ander = models.create_or_rename_organization("Bureau Feedback", "bureau-fb-test.nl")
    models.set_org_is_agency(ander["id"], True)
    models.upsert_user("baas@bureau-fb-test.nl", ander["id"], "agency_admin")
    models.set_user_password("baas@bureau-fb-test.nl", app_auth.hash_password("geheim123"))
    klant = models.create_or_rename_organization("Klant FB", "klant-fb-test.nl", agency_id=ander["id"])
    models.upsert_user("info@klant-fb-test.nl", klant["id"], "client")
    models.set_user_password("info@klant-fb-test.nl", app_auth.hash_password("geheim123"))
    try:
        klant_sessie = login("info@klant-fb-test.nl", "geheim123")
        assert klant_sessie.post(f"{BASE}/api/feedback", json={
            "category": "bug", "message": "Vertrouwelijk: onze omzetcijfers kloppen niet.",
        }).status_code == 200

        # De eigen bureau-admin ziet hem wel.
        andere_admin = login("baas@bureau-fb-test.nl", "geheim123")
        eigen = andere_admin.get(f"{BASE}/api/admin/feedback").json()["feedback"]
        item = next(f for f in eigen if "Vertrouwelijk" in f["message"])

        # De platform-admin van een ánder bureau ziet hem niet in zijn lijst en
        # kan hem niet wijzigen of laten analyseren.
        tp_admin = login("admin@prompted-ai.nl", "admin123")
        # (admin@prompted-ai.nl is platform-admin en ziet dus wél alles)
        assert any("Vertrouwelijk" in f["message"] for f in tp_admin.get(f"{BASE}/api/admin/feedback").json()["feedback"])

        # Andersom: de bureau-admin van bureau-fb ziet de feedback van het
        # demo-account (ander bureau) niet, en raakt die ook niet aan.
        demo_items = [f for f in tp_admin.get(f"{BASE}/api/admin/feedback").json()["feedback"]
                      if f["org_name"] == "Janssen"]
        assert demo_items, "verwacht demo-feedback uit een eerdere test"
        vreemd = demo_items[0]["id"]
        assert not any(f["id"] == vreemd for f in eigen), "feedback van een ander bureau lekt"
        assert andere_admin.patch(f"{BASE}/api/admin/feedback/{vreemd}",
                                  json={"status": "done"}).status_code == 403
        assert andere_admin.post(f"{BASE}/api/admin/feedback/{vreemd}/analyze").status_code == 403
        # Eigen feedback mag hij wel bijwerken.
        assert andere_admin.patch(f"{BASE}/api/admin/feedback/{item['id']}",
                                  json={"status": "done"}).status_code == 200
        print("feedback-scope: eigen feedback beheerbaar, andermans feedback onzichtbaar en 403")
    finally:
        models.delete_organization(klant["id"])
        models.delete_organization(ander["id"])


def test_session_hardening():
    """Sessies vervallen bij een wachtwoordwijziging; login is per account geremd."""
    from app import auth as app_auth, models

    org = models.create_or_rename_organization("Sessie BV", "sessie-test.nl")
    models.upsert_user("gebruiker@sessie-test.nl", org["id"], "client")
    models.set_user_password("gebruiker@sessie-test.nl", app_auth.hash_password("eerste123"))
    try:
        s = login("gebruiker@sessie-test.nl", "eerste123")
        assert s.get(f"{BASE}/api/me").status_code == 200

        # Wachtwoord wijzigen (zoals bij een reset) maakt de oude sessie ongeldig.
        models.set_user_password("gebruiker@sessie-test.nl", app_auth.hash_password("tweede123"))
        assert s.get(f"{BASE}/api/me").status_code == 401

        # Met het nieuwe wachtwoord werkt inloggen weer.
        s2 = login("gebruiker@sessie-test.nl", "tweede123")
        assert s2.get(f"{BASE}/api/me").json()["email"] == "gebruiker@sessie-test.nl"

        # Rem per account op mislukte pogingen: na tien keer fout volgt 429.
        codes = [
            requests.post(f"{BASE}/api/auth/login",
                          json={"email": "gebruiker@sessie-test.nl", "password": "fout"}).status_code
            for _ in range(12)
        ]
        assert 429 in codes, codes
        # Zelfs het juiste wachtwoord komt er nu niet meer door (account op slot).
        assert requests.post(f"{BASE}/api/auth/login",
                             json={"email": "gebruiker@sessie-test.nl", "password": "tweede123"}).status_code == 429
        # Een ánder account is niet geblokkeerd door die pogingen, en geslaagde
        # logins verbruiken zelf geen budget (anders liepen demo's en tests vast).
        for _ in range(15):
            assert requests.post(f"{BASE}/api/auth/login",
                                 json={"email": "test@testklant.nl", "password": "test123"}).status_code == 200
        print("sessies: oude sessie vervalt na wachtwoordwijziging, loginrem geldt per account en alleen op fouten")
    finally:
        models.delete_organization(org["id"])


def test_security_headers():
    """Elke respons draagt de security-headers, ook de SPA en een API-fout."""
    for url in (f"{BASE}/login", f"{BASE}/api/me"):
        h = requests.get(url).headers
        csp = h.get("content-security-policy", "")
        assert "default-src 'self'" in csp and "script-src 'self'" in csp, (url, csp)
        assert "frame-ancestors 'none'" in csp, (url, csp)
        # Het lettertype komt van Google Fonts; dat moet toegestaan blijven.
        assert "https://fonts.gstatic.com" in csp, csp
        assert h.get("x-content-type-options") == "nosniff", url
        assert h.get("x-frame-options") == "DENY", url
        assert h.get("referrer-policy") == "strict-origin-when-cross-origin", url
        # SESSION_COOKIE_SECURE staat in de tests op false, dus geen HSTS.
        assert "strict-transport-security" not in h, url
    print("security-headers: CSP, nosniff, frame-options en referrer-policy staan op elke respons")


def test_cache_purge():
    """Verlopen cache-rijen worden opgeruimd in plaats van eeuwig te blijven."""
    from app import cache as app_cache, db

    app_cache.set("purge-test|vers", {"x": 1}, 300)
    app_cache.set("purge-test|oud", {"x": 2}, -10)  # al verlopen
    assert app_cache.get("purge-test|oud") is None  # niet zichtbaar
    with db.get_conn() as conn:
        aanwezig = conn.execute(
            "SELECT count(*) FROM report_cache WHERE cache_key = 'purge-test|oud'"
        ).fetchone()[0]
    assert aanwezig == 1, "verlopen rij hoort er nog te staan vóór het opruimen"
    app_cache.purge_expired()
    with db.get_conn() as conn:
        weg = conn.execute(
            "SELECT count(*) FROM report_cache WHERE cache_key = 'purge-test|oud'"
        ).fetchone()[0]
        blijft = conn.execute(
            "SELECT count(*) FROM report_cache WHERE cache_key = 'purge-test|vers'"
        ).fetchone()[0]
    assert weg == 0 and blijft == 1, (weg, blijft)
    print("cache-opruiming: verlopen rijen verdwijnen, geldige blijven staan")


def test_asset_validation(demo):
    """Een bron die niet bij de omgeving hoort wordt geweigerd (cachesleutel-misbruik)."""
    # De demo-org serveert voorbeelddata en cachet geen property-lijst, dus de
    # toets grijpt daar niet aan; op de testklant (met een gecachete lijst) wel.
    from app import cache as app_cache, models

    org = models.create_or_rename_organization("Bron BV", "bron-test.nl")
    try:
        app_cache.set(f"{org['id']}|props", {"properties": [{"property_id": "111"}]}, 300)
        from app import org_access
        assert org_access._checked_asset(org["id"], "ga_property_id", "111") == "111"
        try:
            org_access._checked_asset(org["id"], "ga_property_id", "999")
            assert False, "verwachtte een 400 voor een onbekende property"
        except Exception as e:
            assert getattr(e, "status_code", None) == 400, e
        print("bron-validatie: onbekende property geweigerd, bekende toegestaan")
    finally:
        models.delete_organization(org["id"])


def test_request_cache():
    """De per-request memo hergebruikt reads maar geeft nooit verouderde data."""
    from app import models, reqcache

    org = models.create_or_rename_organization("Memo BV", "memo-test.nl")
    try:
        # Buiten een verzoek is er geen memo: elke read gaat naar de database.
        assert reqcache.memo(("x",), lambda: 1) == 1
        assert reqcache.memo(("x",), lambda: 2) == 2

        # Binnen een verzoek wordt dezelfde sleutel hergebruikt...
        token = reqcache._current.set({})
        try:
            assert reqcache.memo(("x",), lambda: 1) == 1
            assert reqcache.memo(("x",), lambda: 2) == 1, "memo hoort te blijven staan"

            naam = models.get_organization(org["id"])["name"]
            assert naam == "Memo BV"
            # ...maar een schrijfactie leegt de memo, dus de volgende read is vers.
            models.set_org_profile(org["id"], name="Memo BV nieuw")
            assert models.get_organization(org["id"])["name"] == "Memo BV nieuw"
            assert reqcache.memo(("x",), lambda: 3) == 3, "write hoort de memo te legen"

            # Functie- en kanaalstand lopen via dezelfde memo en blijven correct.
            models.set_org_features(org["id"], {"signalen": False})
            assert models.feature_enabled(org["id"], "signalen") is False
            models.set_org_features(org["id"], {"signalen": True})
            assert models.feature_enabled(org["id"], "signalen") is True
            models.set_org_channels(org["id"], {"shopify": False})
            assert models.channel_allowed(org["id"], "shopify") is False
        finally:
            reqcache._current.reset(token)
        print("per-request memo: hergebruikt binnen een verzoek, leeg na elke schrijfactie")
    finally:
        models.delete_organization(org["id"])


def test_connection_status_no_decrypt(demo_org_id):
    """De statuscheck leest alleen de status, zonder credentials te ontsleutelen."""
    from unittest import mock

    from app import crypto, models

    org = models.create_or_rename_organization("Status BV", "status-test.nl")
    try:
        models.save_connection(org["id"], "koppel@status-test.nl",
                               {"token": "geheim"}, provider="woocommerce")
        with mock.patch.object(crypto, "decrypt", side_effect=AssertionError("mag niet ontsleutelen")):
            assert models.connection_status(org["id"], "woocommerce") == "connected"
            assert models.connection_status(org["id"], "shopify") is None
            meta = models.connection_meta(org["id"], "woocommerce")
            assert meta["google_email"] == "koppel@status-test.nl", meta
        # De volledige lezer ontsleutelt uiteraard wél.
        assert models.get_connection(org["id"], provider="woocommerce")["creds"]["token"] == "geheim"
        print("koppelstatus: status en account zonder ontsleutelen, volledige lezer ongewijzigd")
    finally:
        models.delete_organization(org["id"])


def test_authorization(tk_org_id):
    user = login("test@testklant.nl", "test123")
    for ep in ("/api/admin/users", "/api/admin/activity", "/api/admin/feedback",
               f"/api/admin/organizations/{tk_org_id}/billing"):
        assert user.get(f"{BASE}{ep}").status_code == 403, ep
    print("autorisatie: klant krijgt overal 403")


if __name__ == "__main__":
    demo = login("info@janssen.nl", "janssen123")
    admin = login("admin@prompted-ai.nl", "admin123")
    orgs = admin.get(f"{BASE}/api/admin/organizations").json()["organizations"]
    tk_org_id = next(o["id"] for o in orgs if o["domain"] == "testklant.nl")
    demo_org_id = next(o["id"] for o in orgs if o["domain"] == "janssen.nl")

    test_demo_basics(demo)
    test_feedback_analysis(demo, admin)
    test_trial_management(admin, tk_org_id)
    test_admin_pages(admin, tk_org_id)
    test_framework(demo)
    test_signalen(demo)
    test_cross_channel_signals()
    test_dashboard_spec_validation()
    test_extract_json_robust()
    test_dashboard_generate(demo)
    test_dashboard_generate_reasoning(demo)
    test_meta_login_redirect(demo)
    test_meta_data_no_crash()
    test_shopify_flow(demo)
    test_shopify_demo(demo)
    test_shopify_webhook_hmac()
    test_shopify_webhooks(demo, tk_org_id)
    test_shopify_aggregate()
    test_account_flow(admin, tk_org_id)
    test_agency_environments(admin)
    test_account_features(admin)
    test_agency_scope(admin)
    test_agency_promotion(admin)
    test_feedback_scope(admin)
    test_session_hardening()
    test_security_headers()
    test_cache_purge()
    test_asset_validation(demo)
    test_request_cache()
    test_connection_status_no_decrypt(demo_org_id)
    test_org_profile_and_delete(admin, tk_org_id, demo_org_id)
    test_authorization(tk_org_id)
    print("API-TESTS OK")
