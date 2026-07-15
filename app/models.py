"""Data access for organizations, users, connections, and dashboards."""
import json
import uuid

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
            "INSERT INTO organizations (id, name, domain, is_personal) "
            "VALUES (%s, %s, %s, true)",
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
            "INSERT INTO organizations (id, name, domain) VALUES (%s, %s, %s)",
            (org_id, name, domain),
        )
        return {"id": org_id, "name": name, "domain": domain}


def get_organization(org_id: str) -> dict | None:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT id, name, domain, is_demo FROM organizations WHERE id = %s", (org_id,)
        ).fetchone()
    return {"id": row[0], "name": row[1], "domain": row[2], "is_demo": row[3]} if row else None


def is_demo_org(org_id: str) -> bool:
    org = get_organization(org_id)
    return bool(org and org.get("is_demo"))


def create_demo_organization(name: str, domain: str) -> dict:
    """Create (or fetch) an org flagged as demo: it serves generated sample data."""
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM organizations WHERE domain = %s", (domain,)
        ).fetchone()
        if row:
            conn.execute(
                "UPDATE organizations SET is_demo = true WHERE id = %s", (row[0],)
            )
            return {"id": row[0], "name": name, "domain": domain, "is_demo": True}
        org_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO organizations (id, name, domain, is_demo) "
            "VALUES (%s, %s, %s, true)",
            (org_id, name, domain),
        )
        return {"id": org_id, "name": name, "domain": domain, "is_demo": True}


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


def count_dashboards_by_owner(organization_id: str, created_by: str) -> int:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT count(*) FROM dashboards "
            "WHERE organization_id = %s AND created_by = %s",
            (organization_id, created_by),
        ).fetchone()
    return row[0] if row else 0


def get_user(user_id: str) -> dict | None:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT id, email, organization_id, role FROM users WHERE id = %s",
            (user_id,),
        ).fetchone()
    if not row:
        return None
    return {"id": row[0], "email": row[1], "organization_id": row[2], "role": row[3]}


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
            "SELECT id, name, domain FROM organizations "
            "WHERE is_personal = false ORDER BY name"
        ).fetchall()
        conns = conn.execute(
            "SELECT organization_id, provider, status, google_email, updated_at FROM connections"
        ).fetchall()

    by_org: dict[str, dict] = {}
    for org_id, provider, status, email, updated in conns:
        by_org.setdefault(org_id, {})[provider] = {
            "status": status,
            "google_email": email,
            "updated_at": updated.isoformat() if updated else None,
        }

    out = []
    for org_id, name, domain in orgs:
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
                "providers": providers,
                "connected_count": sum(1 for p in providers.values() if p["status"] == "connected"),
                "last_sync": last_sync,
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
