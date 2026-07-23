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
    assert a._extract_json("<think>onafgemaakt denken zonder json") is None
    assert a._extract_json("geen json hier") is None
    print("JSON-extractie: denkblokken, fences en trailing komma's worden correct verwerkt")


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
    assert custom and custom["kind"] == "kpi" and custom["spec"]["refs"] == ["sessions", "users"], custom
    assert body["requests"], body
    # Het concept is een geldige, bewaarbare layout.
    created = demo.post(f"{BASE}/api/dashboards", json={"name": "AI-concept", "layout": body["layout"], "page": "analytics"})
    assert created.status_code == 200, (created.status_code, created.text)
    got = demo.get(f"{BASE}/api/dashboards/{created.json()['id']}").json()
    assert any(w["source"] == "custom" for w in got["layout"]["widgets"]), got
    print("dashboard-generatie (end-to-end): valideren, custom-KPI, opslaan en herladen slagen")


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
    test_meta_login_redirect(demo)
    test_meta_data_no_crash()
    test_shopify_flow(demo)
    test_shopify_aggregate()
    test_account_flow(admin, tk_org_id)
    test_agency_environments(admin)
    test_org_profile_and_delete(admin, tk_org_id, demo_org_id)
    test_authorization(tk_org_id)
    print("API-TESTS OK")
