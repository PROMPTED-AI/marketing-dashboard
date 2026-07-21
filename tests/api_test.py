"""API-regressietests tegen een draaiende teststack.

Vereist: de app op BASE_URL (default http://127.0.0.1:8000) met de nep-EuRouter
als taalmodel, en een database die met tests/seed.py geseed is. De demo-org
(Janssen) wordt door de app zelf geseed. Draait met alleen `requests`.
"""
import json
import os

import requests

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

    test_demo_basics(demo)
    test_feedback_analysis(demo, admin)
    test_trial_management(admin, tk_org_id)
    test_admin_pages(admin, tk_org_id)
    test_authorization(tk_org_id)
    print("API-TESTS OK")
