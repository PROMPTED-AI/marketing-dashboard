"""Data access for organizations, users, connections, and dashboards."""
import json
import uuid
from datetime import datetime, timezone

from psycopg.types.json import Jsonb

from . import config, crypto, db

# ---------------------------------------------------------------- organizations


def get_company_org_by_domain(domain: str) -> dict | None:
    """Look up a real (non-personal) client org by its email domain. No create."""
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT id, name, domain FROM organizations "
            "WHERE domain = %s AND is_personal = false",
            (domain,),
        ).fetchone()
    return {"id": row[0], "name": row[1], "domain": row[2]} if row else None


def get_or_create_personal_org(email: str) -> dict:
    """An isolated org for one user (shared/public domain or unknown domain).

    Keyed by the full email address (stored in the unique ``domain`` column),
    so two users never share it. Flagged personal so it stays out of the admin
    client list and the org switcher.
    """
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT id, name, domain FROM organizations WHERE domain = %s",
            (email,),
        ).fetchone()
        if row:
            return {"id": row[0], "name": row[1], "domain": row[2]}
        org_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO organizations (id, name, domain, is_personal, plan, trial_ends_at) "
            "VALUES (%s, %s, %s, true, 'trial', now() + interval '14 days')",
            (org_id, email, email),
        )
        return {"id": org_id, "name": email, "domain": email}


def org_for_login(email: str) -> dict:
    """Resolve the org a signing-in user belongs to (invite-only model).

    A user only joins a shared org when an agency admin has pre-provisioned it
    for their (non-public) company domain. Everyone else — public/shared email
    providers, or company domains not yet added — gets an isolated personal org.
    This prevents unrelated users (e.g. any gmail.com account) from landing in
    the same org and seeing each other's data.
    """
    domain = email.split("@")[-1].lower()
    if not config.is_public_email_domain(domain):
        org = get_company_org_by_domain(domain)
        if org:
            return org
    return get_or_create_personal_org(email)


def create_or_rename_organization(name: str, domain: str) -> dict:
    """Admin adds a client org by domain. If the domain exists, rename it."""
    with db.get_conn() as conn:
        row = conn.execute("SELECT id FROM organizations WHERE domain = %s", (domain,)).fetchone()
        if row:
            conn.execute("UPDATE organizations SET name = %s WHERE id = %s", (name, row[0]))
            return {"id": row[0], "name": name, "domain": domain}
        org_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO organizations (id, name, domain, plan, trial_ends_at) "
            "VALUES (%s, %s, %s, 'trial', now() + interval '14 days')",
            (org_id, name, domain),
        )
        return {"id": org_id, "name": name, "domain": domain}


def get_organization(org_id: str) -> dict | None:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT id, name, domain, is_demo, business_type, plan, trial_ends_at, managed "
            "FROM organizations WHERE id = %s",
            (org_id,),
        ).fetchone()
    return (
        {
            "id": row[0], "name": row[1], "domain": row[2], "is_demo": row[3],
            "business_type": row[4], "plan": row[5],
            "trial_ends_at": row[6].isoformat() if row[6] else None,
            "managed": row[7],
        }
        if row
        else None
    )


# ------------------------------------------------------------------ abonnement
#
# Nieuwe organisaties starten met een proefperiode van 14 dagen. 'active' is
# betaald/onbeperkt. De agency admin beheert dit per organisatie: verlengen,
# per direct stoppen of activeren. Demo-organisaties zijn altijd actief.

TRIAL_DAYS = 14


def subscription_info(org: dict | None) -> dict:
    """Abonnementsstatus voor /api/me en de toegangscontrole.

    De demo-organisatie draait bewust wél in een proefperiode (de seed schuift
    de einddatum bij elke start vooruit), zodat de trial-ervaring en het
    beheer ervan op het demo-account te zien zijn.
    """
    if not org or org.get("plan") != "trial":
        return {"plan": "active", "trial_ends_at": None, "expired": False, "days_left": None}
    ends = org.get("trial_ends_at")
    ends_dt = datetime.fromisoformat(ends) if ends else None
    now = datetime.now(timezone.utc)
    expired = bool(ends_dt and ends_dt <= now)
    days_left = max(0, (ends_dt - now).days + 1) if ends_dt and not expired else 0
    return {"plan": "trial", "trial_ends_at": ends, "expired": expired, "days_left": days_left}


def trial_expired(org_id: str) -> bool:
    return subscription_info(get_organization(org_id))["expired"]


def start_trial(org_id: str, days: int = TRIAL_DAYS) -> None:
    """Zet (of reset) een proefperiode van `days` dagen vanaf nu."""
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE organizations SET plan = 'trial', "
            "trial_ends_at = now() + make_interval(days => %s) WHERE id = %s",
            (days, org_id),
        )


def extend_trial(org_id: str, days: int = TRIAL_DAYS) -> None:
    """Verleng de proefperiode: `days` dagen bovenop het latere van nu of de huidige einddatum."""
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE organizations SET plan = 'trial', trial_ends_at = "
            "GREATEST(COALESCE(trial_ends_at, now()), now()) + make_interval(days => %s) "
            "WHERE id = %s",
            (days, org_id),
        )


def stop_trial(org_id: str) -> None:
    """Beëindig de proefperiode per direct (de organisatie ziet het verloopscherm)."""
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE organizations SET plan = 'trial', trial_ends_at = now() WHERE id = %s",
            (org_id,),
        )


def activate_org(org_id: str) -> None:
    """Zet de organisatie op betaald/onbeperkt."""
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE organizations SET plan = 'active', trial_ends_at = NULL WHERE id = %s",
            (org_id,),
        )


# ------------------------------------------------------- pakketten & facturatie

PACKAGES = ("start", "groei", "pro")


def set_package(org_id: str, package: str | None) -> None:
    with db.get_conn() as conn:
        conn.execute("UPDATE organizations SET package = %s WHERE id = %s", (package, org_id))


_BILLING_FIELDS = ("company_name", "billing_email", "address", "postal_city", "kvk", "btw", "reference")


def get_billing_details(org_id: str) -> dict:
    with db.get_conn() as conn:
        row = conn.execute(
            f"SELECT {', '.join(_BILLING_FIELDS)}, updated_at FROM billing_details "
            "WHERE organization_id = %s",
            (org_id,),
        ).fetchone()
    if not row:
        return {f: "" for f in _BILLING_FIELDS} | {"updated_at": None}
    out = dict(zip(_BILLING_FIELDS, row[:-1]))
    out["updated_at"] = row[-1].isoformat() if row[-1] else None
    return out


def save_billing_details(org_id: str, data: dict) -> dict:
    values = [str(data.get(f) or "")[:300] for f in _BILLING_FIELDS]
    with db.get_conn() as conn:
        conn.execute(
            f"""
            INSERT INTO billing_details (organization_id, {', '.join(_BILLING_FIELDS)}, updated_at)
            VALUES (%s, {', '.join(['%s'] * len(_BILLING_FIELDS))}, now())
            ON CONFLICT (organization_id) DO UPDATE SET
              {', '.join(f'{f} = EXCLUDED.{f}' for f in _BILLING_FIELDS)},
              updated_at = now()
            """,
            (org_id, *values),
        )
    return get_billing_details(org_id)


# -------------------------------------------------------------------- raamwerk


def get_framework_values(org_id: str, months: list[str]) -> dict:
    """Handmatige raamwerkwaarden per maand: {maand: {key: waarde}}."""
    if not months:
        return {}
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT month, key, value FROM framework_values "
            "WHERE organization_id = %s AND month = ANY(%s)",
            (org_id, months),
        ).fetchall()
    out: dict[str, dict] = {}
    for month, key, value in rows:
        out.setdefault(month, {})[key] = value
    return out


def save_framework_values(org_id: str, month: str, values: dict) -> None:
    """Sla handmatige raamwerkwaarden op; None wist de opgeslagen waarde."""
    with db.get_conn() as conn:
        for key, value in values.items():
            if value is None:
                conn.execute(
                    "DELETE FROM framework_values "
                    "WHERE organization_id = %s AND month = %s AND key = %s",
                    (org_id, month, key),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO framework_values (organization_id, month, key, value)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (organization_id, month, key)
                    DO UPDATE SET value = EXCLUDED.value, updated_at = now()
                    """,
                    (org_id, month, key, value),
                )


# ------------------------------------------------------------ gebruikersbeheer


def list_users() -> list[dict]:
    """Alle gebruikers met hun organisatie, voor de admin-pagina Gebruikers & rollen."""
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT u.id, u.email, u.role, u.created_at, u.password_hash IS NOT NULL,
                   o.id, o.name, o.is_demo
            FROM users u JOIN organizations o ON o.id = u.organization_id
            ORDER BY u.created_at DESC
            """
        ).fetchall()
    return [
        {
            "id": r[0], "email": r[1], "role": r[2],
            "created_at": r[3].isoformat() if r[3] else None,
            "has_password": r[4],
            "organization_id": r[5], "organization_name": r[6], "is_demo": r[7],
        }
        for r in rows
    ]


def set_user_role(user_id: str, role: str) -> None:
    with db.get_conn() as conn:
        conn.execute("UPDATE users SET role = %s WHERE id = %s", (role, user_id))


# --------------------------------------------------- bureau-model: toegewezen assets

_ASSET_FIELDS = ("ga_property_id", "gsc_site_url", "ads_customer_id")


def set_org_managed(org_id: str, managed: bool) -> None:
    with db.get_conn() as conn:
        conn.execute("UPDATE organizations SET managed = %s WHERE id = %s", (managed, org_id))


def get_org_assets(org_id: str) -> dict:
    """De aan een bedrijf toegewezen property/site/Ads-klant (of lege waarden)."""
    with db.get_conn() as conn:
        row = conn.execute(
            f"SELECT {', '.join(_ASSET_FIELDS)} FROM org_assets WHERE organization_id = %s",
            (org_id,),
        ).fetchone()
    if not row:
        return {f: None for f in _ASSET_FIELDS}
    return dict(zip(_ASSET_FIELDS, row))


def set_org_assets(org_id: str, values: dict) -> dict:
    """Sla de toegewezen assets op (alleen de bekende velden; None = wissen)."""
    data = {f: (values.get(f) or None) for f in _ASSET_FIELDS}
    with db.get_conn() as conn:
        conn.execute(
            f"""
            INSERT INTO org_assets (organization_id, {', '.join(_ASSET_FIELDS)}, updated_at)
            VALUES (%s, {', '.join(['%s'] * len(_ASSET_FIELDS))}, now())
            ON CONFLICT (organization_id) DO UPDATE SET
              {', '.join(f'{f} = EXCLUDED.{f}' for f in _ASSET_FIELDS)},
              updated_at = now()
            """,
            (org_id, *[data[f] for f in _ASSET_FIELDS]),
        )
    return get_org_assets(org_id)


def copy_google_connections(from_org: str, to_org: str) -> int:
    """Kopieer de Google-koppelingen (het manager-token) naar een klant-org.

    Zo hoeft het bureau niet per klant opnieuw toestemming te geven: het
    manager-token wordt hergebruikt. De toewijzing (welke property/site hoort
    bij dit bedrijf) wordt apart afgedwongen, zodat de klant nooit meer ziet
    dan zijn eigen bedrijf.
    """
    copied = 0
    for provider in config.GOOGLE_PROVIDERS:
        conn = get_connection(from_org, provider=provider)
        if conn and conn["status"] == "connected":
            save_connection(to_org, conn["google_email"], conn["creds"], provider=provider)
            copied += 1
    return copied


# ---------------------------------------------- uitnodigingen + wachtwoord-reset


def create_access_token(
    kind: str,
    email: str,
    token_hash: str,
    expires_at: datetime,
    organization_id: str | None = None,
    role: str | None = None,
    created_by: str | None = None,
) -> None:
    """Sla een eenmalige token op. Openstaande tokens van dezelfde soort voor
    hetzelfde e-mailadres worden eerst opgeruimd, zodat een nieuwe link de oude
    ongeldig maakt."""
    with db.get_conn() as conn:
        conn.execute(
            "DELETE FROM access_tokens WHERE kind = %s AND email = %s AND used_at IS NULL",
            (kind, email.lower()),
        )
        conn.execute(
            "INSERT INTO access_tokens "
            "(id, kind, email, organization_id, role, token_hash, expires_at, created_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (str(uuid.uuid4()), kind, email.lower(), organization_id, role,
             token_hash, expires_at, created_by),
        )


def get_access_token(token_hash: str, kind: str) -> dict | None:
    """Geef een geldige (niet-gebruikte, niet-verlopen) token, anders None."""
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT email, organization_id, role, expires_at, used_at "
            "FROM access_tokens WHERE token_hash = %s AND kind = %s",
            (token_hash, kind),
        ).fetchone()
    if not row:
        return None
    email, org_id, role, expires_at, used_at = row
    if used_at is not None:
        return None
    if expires_at <= datetime.now(timezone.utc):
        return None
    return {"email": email, "organization_id": org_id, "role": role}


def use_access_token(token_hash: str) -> None:
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE access_tokens SET used_at = now() WHERE token_hash = %s",
            (token_hash,),
        )


# ------------------------------------------------------------- activiteitenfeed


def activity_feed(limit: int = 60) -> list[dict]:
    """Recente gebeurtenissen, afgeleid uit bestaande tabellen.

    Geen aparte log-tabel: nieuwe klanten en gebruikers, bijgewerkte
    koppelingen, opgeslagen dashboards en binnengekomen feedback hebben elk al
    een tijdstempel. Samengevoegd en gesorteerd geeft dat een bruikbaar
    activiteitenoverzicht zonder overal schrijf-hooks te hoeven plaatsen.
    """
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            (SELECT 'org' AS kind, o.created_at AS ts, o.name, NULL, NULL
               FROM organizations o WHERE o.is_personal = false)
            UNION ALL
            (SELECT 'user', u.created_at, o.name, u.email, u.role
               FROM users u JOIN organizations o ON o.id = u.organization_id)
            UNION ALL
            (SELECT 'connection', c.updated_at, o.name, c.provider, c.status
               FROM connections c JOIN organizations o ON o.id = c.organization_id)
            UNION ALL
            (SELECT 'dashboard', d.updated_at, o.name, d.name, d.page
               FROM dashboards d JOIN organizations o ON o.id = d.organization_id)
            UNION ALL
            (SELECT 'feedback', f.created_at, COALESCE(o.name, f.user_email), f.category, f.status
               FROM feedback f LEFT JOIN organizations o ON o.id = f.organization_id)
            ORDER BY ts DESC LIMIT %s
            """,
            (limit,),
        ).fetchall()
    return [
        {"kind": r[0], "ts": r[1].isoformat() if r[1] else None, "org": r[2], "a": r[3], "b": r[4]}
        for r in rows
    ]


def is_demo_org(org_id: str) -> bool:
    org = get_organization(org_id)
    return bool(org and org.get("is_demo"))


BUSINESS_TYPES = ("leadgen", "ecommerce")


def set_business_type(org_id: str, business_type: str) -> dict | None:
    """Set an organization's company profile (leadgen | ecommerce)."""
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE organizations SET business_type = %s WHERE id = %s",
            (business_type, org_id),
        )
    return get_organization(org_id)


def create_demo_organization(name: str, domain: str, business_type: str = "ecommerce") -> dict:
    """Create (or fetch) an org flagged as demo: it serves generated sample data."""
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM organizations WHERE domain = %s", (domain,)
        ).fetchone()
        if row:
            conn.execute(
                "UPDATE organizations SET is_demo = true, business_type = %s WHERE id = %s",
                (business_type, row[0]),
            )
            return {"id": row[0], "name": name, "domain": domain, "is_demo": True, "business_type": business_type}
        org_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO organizations (id, name, domain, is_demo, business_type, plan) "
            "VALUES (%s, %s, %s, true, %s, 'active')",
            (org_id, name, domain, business_type),
        )
        return {"id": org_id, "name": name, "domain": domain, "is_demo": True, "business_type": business_type}


def rename_organization(org_id: str, name: str) -> dict | None:
    """Rename an organization by id (used by the settings screen)."""
    with db.get_conn() as conn:
        conn.execute("UPDATE organizations SET name = %s WHERE id = %s", (name, org_id))
    return get_organization(org_id)


# ----------------------------------------------------------------------- users


def upsert_user(email: str, organization_id: str, role: str) -> dict:
    """Create or update a user, keyed by email."""
    with db.get_conn() as conn:
        row = conn.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()
        if row:
            user_id = row[0]
            conn.execute(
                "UPDATE users SET organization_id = %s, role = %s WHERE id = %s",
                (organization_id, role, user_id),
            )
        else:
            user_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO users (id, email, organization_id, role) "
                "VALUES (%s, %s, %s, %s)",
                (user_id, email, organization_id, role),
            )
    return {
        "id": user_id,
        "email": email,
        "organization_id": organization_id,
        "role": role,
    }


def get_user(user_id: str) -> dict | None:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT id, email, organization_id, role FROM users WHERE id = %s",
            (user_id,),
        ).fetchone()
    if not row:
        return None
    return {"id": row[0], "email": row[1], "organization_id": row[2], "role": row[3]}


def get_user_by_email(email: str) -> dict | None:
    """User lookup for password sign-in (includes the stored hash)."""
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT id, email, organization_id, role, password_hash "
            "FROM users WHERE email = %s",
            (email.lower(),),
        ).fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "email": row[1],
        "organization_id": row[2],
        "role": row[3],
        "password_hash": row[4],
    }


def set_user_password(email: str, password_hash: str) -> None:
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE users SET password_hash = %s WHERE email = %s",
            (password_hash, email.lower()),
        )


# ----------------------------------------------------------------- connections


def save_connection(
    organization_id: str,
    google_email: str,
    creds: dict,
    provider: str = "google_analytics",
) -> None:
    """Store (or refresh) an organization's encrypted OAuth connection."""
    blob = crypto.encrypt(json.dumps(creds))
    with db.get_conn() as conn:
        conn.execute(
            """
            INSERT INTO connections (id, organization_id, provider, google_email,
                                     encrypted_creds, status, updated_at)
            VALUES (%s, %s, %s, %s, %s, 'connected', now())
            ON CONFLICT (organization_id, provider)
            DO UPDATE SET google_email = EXCLUDED.google_email,
                          encrypted_creds = EXCLUDED.encrypted_creds,
                          status = 'connected',
                          updated_at = now()
            """,
            (str(uuid.uuid4()), organization_id, provider, google_email, blob),
        )


def get_connection(
    organization_id: str, provider: str = "google_analytics"
) -> dict | None:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT google_email, encrypted_creds, status FROM connections "
            "WHERE organization_id = %s AND provider = %s",
            (organization_id, provider),
        ).fetchone()
    if not row:
        return None
    return {
        "google_email": row[0],
        "creds": json.loads(crypto.decrypt(row[1])),
        "status": row[2],
    }


def set_connection_status(
    organization_id: str, status: str, provider: str = "google_analytics"
) -> None:
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE connections SET status = %s, updated_at = now() "
            "WHERE organization_id = %s AND provider = %s",
            (status, organization_id, provider),
        )


def delete_connection(organization_id: str, provider: str) -> None:
    with db.get_conn() as conn:
        conn.execute(
            "DELETE FROM connections WHERE organization_id = %s AND provider = %s",
            (organization_id, provider),
        )


def count_google_connections(organization_id: str) -> int:
    """How many Google-provider connections remain for an org."""
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT count(*) FROM connections "
            "WHERE organization_id = %s AND provider = ANY(%s)",
            (organization_id, list(config.GOOGLE_PROVIDERS)),
        ).fetchone()
    return row[0] if row else 0


def list_organizations_with_status() -> list[dict]:
    """Agency admin overview: every org and its GA connection status."""
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT o.id, o.name, o.domain,
                   c.google_email, c.status, c.updated_at
            FROM organizations o
            LEFT JOIN connections c
              ON c.organization_id = o.id AND c.provider = 'google_analytics'
            WHERE o.is_personal = false
            ORDER BY o.name
            """
        ).fetchall()
    return [
        {
            "id": r[0],
            "name": r[1],
            "domain": r[2],
            "google_email": r[3],
            "status": r[4] or "not_connected",
            "updated_at": r[5].isoformat() if r[5] else None,
        }
        for r in rows
    ]


def list_organizations_with_connections() -> list[dict]:
    """Admin client table: every org with its per-provider status + last sync."""
    with db.get_conn() as conn:
        orgs = conn.execute(
            "SELECT id, name, domain, business_type, is_demo, plan, trial_ends_at, package, managed "
            "FROM organizations WHERE is_personal = false ORDER BY name"
        ).fetchall()
        conns = conn.execute(
            "SELECT organization_id, provider, status, google_email, updated_at FROM connections"
        ).fetchall()
        assets = conn.execute(
            f"SELECT organization_id, {', '.join(_ASSET_FIELDS)} FROM org_assets"
        ).fetchall()

    by_org: dict[str, dict] = {}
    for org_id, provider, status, email, updated in conns:
        by_org.setdefault(org_id, {})[provider] = {
            "status": status,
            "google_email": email,
            "updated_at": updated.isoformat() if updated else None,
        }
    assets_by_org = {r[0]: dict(zip(_ASSET_FIELDS, r[1:])) for r in assets}

    out = []
    for org_id, name, domain, business_type, is_demo, plan, trial_ends_at, package, managed in orgs:
        providers = by_org.get(org_id, {})
        last_sync = max(
            (p["updated_at"] for p in providers.values() if p["updated_at"]),
            default=None,
        )
        out.append(
            {
                "id": org_id,
                "name": name,
                "domain": domain,
                "business_type": business_type,
                "providers": providers,
                "connected_count": sum(1 for p in providers.values() if p["status"] == "connected"),
                "last_sync": last_sync,
                "package": package,
                "managed": managed,
                "assets": assets_by_org.get(org_id, {f: None for f in _ASSET_FIELDS}),
                "subscription": subscription_info({
                    "is_demo": is_demo, "plan": plan,
                    "trial_ends_at": trial_ends_at.isoformat() if trial_ends_at else None,
                }),
            }
        )
    return out


# ------------------------------------------------------------------- dashboards
#
# Custom widget layouts. Private by default: only the owner (`created_by`) sees
# a dashboard, until they flip `visibility` to 'shared' so the rest of their
# organization can view it. Editing/renaming/deleting/default stay owner-only.
# `page` scopes a dashboard to a screen. `is_default` is the owner's default
# for that page (used to pick what opens first).


def list_dashboards(
    organization_id: str, viewer_email: str, page: str = "overview"
) -> list[dict]:
    """Dashboards the viewer may see: their own + others' shared ones (no layout)."""
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, is_default, visibility, created_by, updated_at "
            "FROM dashboards "
            "WHERE organization_id = %s AND page = %s "
            "  AND (created_by = %s OR visibility = 'shared') "
            "ORDER BY (created_by = %s) DESC, is_default DESC, lower(name)",
            (organization_id, page, viewer_email, viewer_email),
        ).fetchall()
    return [
        {
            "id": r[0],
            "name": r[1],
            "is_default": r[2],
            "visibility": r[3],
            "is_owner": r[4] == viewer_email,
            "updated_at": r[5].isoformat() if r[5] else None,
        }
        for r in rows
    ]


def get_dashboard(
    organization_id: str, dashboard_id: str, viewer_email: str
) -> dict | None:
    """One dashboard with its layout, if the viewer may see it (owner or shared)."""
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT id, page, name, layout, is_default, visibility, created_by "
            "FROM dashboards WHERE id = %s AND organization_id = %s",
            (dashboard_id, organization_id),
        ).fetchone()
    if not row:
        return None
    is_owner = row[6] == viewer_email
    if not is_owner and row[5] != "shared":
        return None  # private dashboard of another user
    return {
        "id": row[0],
        "page": row[1],
        "name": row[2],
        "layout": row[3],
        "is_default": row[4],
        "visibility": row[5],
        "is_owner": is_owner,
    }


def create_dashboard(
    organization_id: str,
    name: str,
    layout: dict,
    page: str = "overview",
    created_by: str | None = None,
    visibility: str = "private",
    is_default: bool = False,
) -> dict:
    """Create a dashboard. The owner's first one for a page becomes their default."""
    dashboard_id = str(uuid.uuid4())
    visibility = "shared" if visibility == "shared" else "private"
    with db.get_conn() as conn:
        existing = conn.execute(
            "SELECT count(*) FROM dashboards "
            "WHERE organization_id = %s AND page = %s AND created_by = %s",
            (organization_id, page, created_by),
        ).fetchone()[0]
        make_default = is_default or existing == 0
        if make_default:
            conn.execute(
                "UPDATE dashboards SET is_default = false "
                "WHERE organization_id = %s AND page = %s AND created_by = %s",
                (organization_id, page, created_by),
            )
        conn.execute(
            "INSERT INTO dashboards "
            "(id, organization_id, page, name, layout, visibility, is_default, created_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (dashboard_id, organization_id, page, name, Jsonb(layout), visibility, make_default, created_by),
        )
    return {
        "id": dashboard_id,
        "page": page,
        "name": name,
        "layout": layout,
        "visibility": visibility,
        "is_default": make_default,
        "is_owner": True,
    }


def update_dashboard(
    organization_id: str,
    dashboard_id: str,
    owner_email: str,
    name: str | None = None,
    layout: dict | None = None,
    visibility: str | None = None,
    is_default: bool | None = None,
) -> dict | None:
    """Patch an owned dashboard. Returns None if it doesn't exist or isn't owned."""
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT page FROM dashboards "
            "WHERE id = %s AND organization_id = %s AND created_by = %s",
            (dashboard_id, organization_id, owner_email),
        ).fetchone()
        if not row:
            return None
        page = row[0]
        if name is not None:
            conn.execute(
                "UPDATE dashboards SET name = %s, updated_at = now() WHERE id = %s",
                (name, dashboard_id),
            )
        if layout is not None:
            conn.execute(
                "UPDATE dashboards SET layout = %s, updated_at = now() WHERE id = %s",
                (Jsonb(layout), dashboard_id),
            )
        if visibility is not None:
            conn.execute(
                "UPDATE dashboards SET visibility = %s, updated_at = now() WHERE id = %s",
                ("shared" if visibility == "shared" else "private", dashboard_id),
            )
        if is_default:
            conn.execute(
                "UPDATE dashboards SET is_default = false "
                "WHERE organization_id = %s AND page = %s AND created_by = %s",
                (organization_id, page, owner_email),
            )
            conn.execute(
                "UPDATE dashboards SET is_default = true, updated_at = now() WHERE id = %s",
                (dashboard_id,),
            )
    return get_dashboard(organization_id, dashboard_id, owner_email)


def delete_dashboard(
    organization_id: str, dashboard_id: str, owner_email: str
) -> bool:
    """Delete an owned dashboard; promote another of the owner's to default if needed."""
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT page, is_default FROM dashboards "
            "WHERE id = %s AND organization_id = %s AND created_by = %s",
            (dashboard_id, organization_id, owner_email),
        ).fetchone()
        if not row:
            return False
        page, was_default = row
        conn.execute("DELETE FROM dashboards WHERE id = %s", (dashboard_id,))
        if was_default:
            nxt = conn.execute(
                "SELECT id FROM dashboards "
                "WHERE organization_id = %s AND page = %s AND created_by = %s "
                "ORDER BY lower(name) LIMIT 1",
                (organization_id, page, owner_email),
            ).fetchone()
            if nxt:
                conn.execute(
                    "UPDATE dashboards SET is_default = true WHERE id = %s", (nxt[0],)
                )
    return True


# ------------------------------------------------------------------ feedback

def create_feedback(
    organization_id: str | None, user_email: str, category: str,
    message: str, page: str | None = None, severity: str | None = None,
) -> dict:
    fid = str(uuid.uuid4())
    with db.get_conn() as conn:
        conn.execute(
            "INSERT INTO feedback (id, organization_id, user_email, category, "
            "message, page, severity) VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (fid, organization_id, user_email, category, message, page, severity),
        )
    return {"id": fid}


def _feedback_row(row) -> dict:
    return {
        "id": row[0], "organization_id": row[1], "org_name": row[2],
        "user_email": row[3], "category": row[4], "message": row[5],
        "page": row[6], "severity": row[7], "status": row[8],
        "ai_analysis": row[9], "created_at": row[10],
    }


_FEEDBACK_SELECT = (
    "SELECT f.id, f.organization_id, o.name, f.user_email, f.category, "
    "f.message, f.page, f.severity, f.status, f.ai_analysis, f.created_at "
    "FROM feedback f LEFT JOIN organizations o ON o.id = f.organization_id "
)


def list_feedback() -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(_FEEDBACK_SELECT + "ORDER BY f.created_at DESC").fetchall()
    return [_feedback_row(r) for r in rows]


def get_feedback(feedback_id: str) -> dict | None:
    with db.get_conn() as conn:
        row = conn.execute(_FEEDBACK_SELECT + "WHERE f.id = %s", (feedback_id,)).fetchone()
    return _feedback_row(row) if row else None


def set_feedback_status(feedback_id: str, status: str) -> None:
    with db.get_conn() as conn:
        conn.execute("UPDATE feedback SET status = %s WHERE id = %s", (status, feedback_id))


def set_feedback_analysis(feedback_id: str, analysis: str) -> None:
    with db.get_conn() as conn:
        conn.execute("UPDATE feedback SET ai_analysis = %s WHERE id = %s", (analysis, feedback_id))
