"""Data access for organizations, users, and connections."""
import json
import uuid

from . import config, crypto, db

# ---------------------------------------------------------------- organizations


def get_or_create_org_by_domain(domain: str, name: str | None = None) -> dict:
    """Find the organization for an email domain, creating it on first sight."""
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT id, name, domain FROM organizations WHERE domain = %s",
            (domain,),
        ).fetchone()
        if row:
            return {"id": row[0], "name": row[1], "domain": row[2]}
        org_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO organizations (id, name, domain) VALUES (%s, %s, %s)",
            (org_id, name or domain, domain),
        )
        return {"id": org_id, "name": name or domain, "domain": domain}


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
            "SELECT id, name, domain FROM organizations WHERE id = %s", (org_id,)
        ).fetchone()
    return {"id": row[0], "name": row[1], "domain": row[2]} if row else None


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
            "SELECT id, name, domain FROM organizations ORDER BY name"
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
