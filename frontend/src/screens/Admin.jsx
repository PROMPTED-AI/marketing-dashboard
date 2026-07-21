import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, LOGOUT_URL } from "../lib/api.js";
import { useMe } from "../lib/useMe.jsx";
import { invalidateAll } from "../lib/swr.js";
import Topbar from "../components/Topbar.jsx";
import AdminFeedback from "./AdminFeedback.jsx";
import AdminUsers from "./admin/AdminUsers.jsx";
import AdminConnections from "./admin/AdminConnections.jsx";
import AdminActivity from "./admin/AdminActivity.jsx";
import AdminBilling from "./admin/AdminBilling.jsx";
import { IcStar, IcUsers, IcPlug, IcCog, IcDoc, IcChat, IcChevDown, IcPlus } from "../components/icons.jsx";

const PROVIDERS = [
  { key: "google_analytics", letter: "G", bg: "#FFF3E0", on: "#E37400" },
  { key: "search_console", letter: "S", bg: "#E8F0FE", on: "#4285F4" },
  { key: "google_ads", letter: "A", bg: "#E8F0FE", on: "#1A73E8" },
  { key: "meta_ads", letter: "M", bg: "#E7F0FF", on: "#0866FF" },
];

function initials(name = "") {
  const p = name.replace(/^https?:\/\//, "").split(/[ .@]/).filter(Boolean);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || "—";
}
function orgStatus(o) {
  const vals = Object.values(o.providers || {});
  if (vals.some((p) => p.status === "revoked")) return { label: "Actie vereist", cls: "neg" };
  if (o.connected_count > 0) return { label: "Actief", cls: "pos" };
  return { label: "Onboarding", cls: "accent" };
}
function ago(iso) {
  if (!iso) return "nog niet gesynct";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "zojuist";
  if (mins < 60) return `${mins} min geleden`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} uur geleden`;
  return `${Math.floor(h / 24)} dagen geleden`;
}

export default function Admin() {
  const { me, loading: meLoading } = useMe();
  const nav = useNavigate();
  const [orgs, setOrgs] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState("klanten"); // 'klanten' | 'feedback'
  const [drawer, setDrawer] = useState(false);
  const pick = (key) => { setTab(key); setDrawer(false); };

  const reload = () => api("/api/admin/organizations").then((d) => setOrgs(d.organizations || [])).catch(setError);

  useEffect(() => { reload(); }, []);

  if (meLoading) return null;
  if (!me) return <Navigate to="/login" replace />;
  if (me.role !== "agency_admin") return <Navigate to="/app" replace />;

  const totalTools = (orgs || []).reduce((a, o) => a + o.connected_count, 0);
  const needAction = (orgs || []).filter((o) => Object.values(o.providers || {}).some((p) => p.status === "revoked")).length;

  return (
    <div style={{ height: "100vh", display: "flex", background: "var(--c-page)", color: "var(--c-ink)" }}>
      <div className={`app-scrim no-print${drawer ? " show" : ""}`} onClick={() => setDrawer(false)} />
      {/* admin sidebar: op mobiel een inschuifbare drawer (zelfde patroon als het dashboard) */}
      <div className={`app-sidebar no-print${drawer ? " open" : ""}`} style={{ background: "var(--c-sidebar)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "22px 20px 18px" }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--c-ink)", display: "flex", alignItems: "center", justifyContent: "center" }}><IcStar /></div>
          <div className="display" style={{ fontSize: 20 }}>kompas</div>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--c-surface)", background: "var(--c-ink)", padding: "3px 7px", borderRadius: 6 }}>admin</span>
        </div>
        <div style={menuLabel}>Platform</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "0 12px", fontSize: 14 }}>
          {[
            ["klanten", "Klanten", IcUsers],
            ["feedback", "Feedback", IcChat],
            ["gebruikers", "Gebruikers & rollen", IcUsers],
            ["koppelingen", "Koppelingen", IcPlug],
            ["pakketten", "Pakketten & facturatie", IcDoc],
            ["activiteit", "Activiteitenlog", IcDoc],
          ].map(([key, label, Icon]) => (
            <div key={key} className="icon-btn" style={tab === key ? navActive : { ...navItem, cursor: "pointer" }} onClick={() => pick(key)}>
              <Icon s={18} />{label}
            </div>
          ))}
          <div style={navItem}><IcCog s={18} />Instellingen</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ padding: 12 }}>
          <div onClick={() => nav("/app")} style={{ ...navItem, justifyContent: "center", cursor: "pointer", border: "1px solid var(--c-border)" }}>← naar dashboard</div>
        </div>
        <div style={userFoot}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--c-ink)", color: "var(--c-surface)", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{initials(me.email)}</div>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me.email}</div><div style={{ fontSize: 11, color: "var(--c-muted)" }}>platform-admin</div></div>
          <a href={LOGOUT_URL} onClick={() => invalidateAll()} style={{ color: "var(--c-muted)" }} title="uitloggen"><IcChevDown s={16} /></a>
        </div>
      </div>

      {/* main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar searchPlaceholder="zoek klant of domein…" showDateRange={false} onMenu={() => setDrawer(true)} />
        <div className="dash-content" style={{ flex: 1, overflow: "auto", padding: "26px 28px" }}>
          {tab === "feedback" ? <AdminFeedback />
            : tab === "gebruikers" ? <AdminUsers meEmail={me.email} />
            : tab === "koppelingen" ? <AdminConnections />
            : tab === "activiteit" ? <AdminActivity />
            : tab === "pakketten" ? <AdminBilling />
            : (<>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div className="display" style={{ fontSize: 30 }}>klanten</div>
              <div style={{ fontSize: 13.5, color: "var(--c-muted)", margin: "4px 0 20px" }}>Alle organisaties op het platform: koppelingen, status en activiteit</div>
            </div>
            <button className="btn-primary" style={{ height: 42, padding: "0 18px", fontSize: 13.5 }} onClick={() => setAdding(true)}>
              <IcPlus s={16} /> klant toevoegen
            </button>
          </div>

          {error && <div className="card" style={{ padding: 20, color: "var(--c-neg)" }}>Fout: {String(error.message || error)}</div>}

          <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
            <Stat label="Organisaties" value={orgs ? orgs.length : "…"} />
            <Stat label="Gekoppelde tools" value={orgs ? totalTools : "…"} />
            <Stat label="Koppeling vereist actie" value={orgs ? needAction : "…"} danger={needAction > 0} />
            <Stat label="MRR" value="—" />
          </div>

          <div className="card" style={{ overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
            <div style={{ ...headRow }}>
              <span>Klant</span><span>Gekoppelde tools</span><span>Status</span><span>Laatste sync</span><span>Proefperiode</span>
            </div>
            {(orgs || []).map((o) => {
              const st = orgStatus(o);
              return (
                <div key={o.id} style={dataRow}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--c-accent-soft)", color: "var(--c-accent)", fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{initials(o.name)}</div>
                    <div><div style={{ fontWeight: 700 }}>{o.name}</div><div style={{ fontSize: 11.5, color: "var(--c-muted)" }}>{o.domain}</div></div>
                  </div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {PROVIDERS.map((p) => {
                      const on = o.providers?.[p.key]?.status === "connected";
                      return <span key={p.key} title={p.key} style={{ width: 22, height: 22, borderRadius: 6, background: on ? p.bg : "var(--c-track)", color: on ? p.on : "var(--c-muted)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11 }}>{p.letter}</span>;
                    })}
                  </div>
                  <span><span className={`pill ${st.cls}`}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />{st.label}</span></span>
                  <span style={{ color: "var(--c-muted)", fontSize: 13 }}>{ago(o.last_sync)}</span>
                  <TrialCell org={o} onChanged={reload} />
                </div>
              );
            })}
            {orgs && orgs.length === 0 && <div style={{ padding: 24, color: "var(--c-muted)" }}>Nog geen organisaties.</div>}
            </div>
          </div>

          <ModelDiagnostics />
          </>)}
        </div>
      </div>

      {adding && <AddClientModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
    </div>
  );
}

function AddClientModal({ onClose, onDone }) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [org, setOrg] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const d = await api("/api/admin/organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, domain }) });
      setOrg(d.organization);
    } catch (e2) {
      setErr(e2);
      setBusy(false);
    }
  };

  return (
    <div style={overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card" style={{ width: 460, maxWidth: "calc(100vw - 32px)", padding: 26 }}>
        {org ? (
          <div>
            <div className="display" style={{ fontSize: 22, marginBottom: 8 }}>klant aangemaakt</div>
            <div style={{ fontSize: 13.5, color: "var(--c-muted)", lineHeight: 1.6, marginBottom: 18 }}>
              <strong style={{ color: "var(--c-ink)" }}>{org.name}</strong> ({org.domain}) staat klaar. Nodig de klant uit door iemand met een
              <strong style={{ color: "var(--c-ink)" }}> @{org.domain}</strong>-adres te laten inloggen op het dashboard. Ze worden automatisch aan deze organisatie gekoppeld en doorlopen de onboarding om hun tools te verbinden.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn-primary" style={{ height: 42, padding: "0 20px" }} onClick={onDone}>klaar</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="display" style={{ fontSize: 22, marginBottom: 4 }}>klant toevoegen</div>
            <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 18 }}>Maak een organisatie aan en nodig de klant uit via hun e-maildomein.</div>
            <label style={lbl}>Naam organisatie</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Voorbeeld B.V." style={inp} />
            <label style={lbl}>E-maildomein</label>
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="voorbeeld.nl" style={inp} />
            <div style={{ fontSize: 12, color: "var(--c-muted)", marginTop: 6 }}>Iedereen die met dit domein inlogt, hoort bij deze klant.</div>
            {err && <div style={{ color: "var(--c-neg)", fontSize: 13, marginTop: 12 }}>{String(err.message || err)}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
              <button type="button" className="pill-btn" onClick={onClose} style={btnGhost}>annuleren</button>
              <button type="submit" disabled={busy || !name.trim() || !domain.trim()} className="btn-primary" style={{ height: 42, padding: "0 20px", opacity: busy ? 0.7 : 1 }}>
                {busy ? "bezig…" : "aanmaken"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// AI-model-diagnostiek: lijst EuRouter-modellen en probe tool-calling-support,
// zodat je op basis van feiten een model kiest dat de assistent-tools aankan.
function ModelDiagnostics() {
  const [current, setCurrent] = useState(null);
  const [models, setModels] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({}); // model -> true tijdens probe

  const load = () => {
    setLoading(true);
    setError(null);
    api("/api/admin/assistant/models")
      .then((d) => { setModels(d.models || []); setCurrent(d.current); })
      .catch((e) => setError(e))
      .finally(() => setLoading(false));
  };

  const probe = (id) => {
    setBusy((b) => ({ ...b, [id]: true }));
    return api("/api/admin/assistant/models/probe", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: id }),
    })
      .then((r) => setModels((ms) => ms.map((m) => (m.id === id ? { ...m, supports_tools: r.supports_tools, detail: r.detail } : m))))
      .catch(() => {})
      .finally(() => setBusy((b) => ({ ...b, [id]: false })));
  };

  // Alleen de modellen proben die volgens de catalogus tools ondersteunen, ter
  // bevestiging tegen het echte endpoint (scheelt calls op de rest).
  const probeAll = async () => {
    const todo = (models || []).filter((m) => m.declares_tools && m.supports_tools == null).map((m) => m.id);
    for (const id of todo) await probe(id);
  };

  // Live probe (indien uitgevoerd) wint; anders wat de catalogus opgeeft.
  const badge = (m) => {
    if (m.supports_tools === true) return <span className="pill pos" style={{ fontSize: 11 }}>tools ✓ (getest)</span>;
    if (m.supports_tools === false) return <span className="pill neg" style={{ fontSize: 11 }}>geen tools (getest)</span>;
    if (m.declares_tools) return <span className="pill pos" style={{ fontSize: 11, opacity: 0.7 }}>tools ✓</span>;
    return <span className="pill muted" style={{ fontSize: 11 }}>geen tools</span>;
  };

  return (
    <div className="card" style={{ marginTop: 20, padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--c-border)", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>AI-model diagnostiek</div>
          <div style={{ fontSize: 12.5, color: "var(--c-muted)", marginTop: 2 }}>
            Welke EuRouter-modellen ondersteunen tool-calling{current ? ` · huidig: ${current}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {models && <button className="btn-ghost" onClick={probeAll} style={{ height: 38, padding: "0 14px", fontSize: 13 }}>Alles proben</button>}
          <button className="btn-primary" onClick={load} disabled={loading} style={{ height: 38, padding: "0 16px", fontSize: 13, opacity: loading ? 0.6 : 1 }}>
            {loading ? "laden…" : models ? "vernieuwen" : "modellen ophalen"}
          </button>
        </div>
      </div>

      {error && <div style={{ padding: 20, color: "var(--c-neg)", fontSize: 13 }}>{String(error.message || error)}</div>}
      {models && models.length === 0 && <div style={{ padding: 20, color: "var(--c-muted)", fontSize: 13 }}>Geen modellen teruggegeven.</div>}
      {models && models.length > 0 && (
        <div>
          {models.map((m) => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 20px", borderBottom: "1px solid var(--c-border-soft)", fontSize: 13.5 }}>
              <span style={{ flex: 1, minWidth: 0, fontWeight: m.id === current ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {m.id}{m.id === current && <span style={{ color: "var(--c-accent)", fontSize: 11, fontWeight: 700 }}> · huidig</span>}
              </span>
              {m.detail && m.supports_tools == null && <span title={m.detail} style={{ fontSize: 11, color: "var(--c-muted)" }}>{m.detail}</span>}
              {badge(m)}
              <button className="btn-ghost" onClick={() => probe(m.id)} disabled={busy[m.id]} style={{ height: 30, padding: "0 10px", fontSize: 12 }}>
                {busy[m.id] ? "…" : "probe"}
              </button>
            </div>
          ))}
        </div>
      )}
      {!models && !loading && !error && (
        <div style={{ padding: 20, color: "var(--c-muted)", fontSize: 13 }}>
          Klik op “modellen ophalen” om EuRouters modellen te laden en per model tool-calling te testen.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, danger }) {
  return (
    <div className="card" style={{ flex: 1, padding: "16px 18px", minWidth: 160 }}>
      <div style={{ fontSize: 12.5, color: "var(--c-muted)", fontWeight: 600 }}>{label}</div>
      <div className="display" style={{ fontSize: 30, marginTop: 6, color: danger ? "var(--c-neg)" : "var(--c-ink)" }}>{value}</div>
    </div>
  );
}

// Proefperiode-kolom in de klantentabel: status-pill plus beheerknoppen.
// Verlengen telt 14 dagen op bij het latere van nu of de huidige einddatum,
// stoppen beëindigt per direct (klant ziet het verloopscherm), activeren zet
// de organisatie op betaald/onbeperkt.
function TrialCell({ org, onChanged }) {
  const [busy, setBusy] = useState(false);
  const sub = org.subscription || { plan: "active", expired: false };

  const act = async (action) => {
    setBusy(true);
    try {
      await api(`/api/admin/organizations/${org.id}/trial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, days: 14 }),
      });
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const pill = sub.plan === "active"
    ? <span className="pill pos">Actief</span>
    : sub.expired
      ? <span className="pill neg">Verlopen</span>
      : <span className="pill accent">Nog {sub.days_left} {sub.days_left === 1 ? "dag" : "dagen"}</span>;

  const miniBtn = { height: 26, padding: "0 9px", fontSize: 11.5, borderRadius: 8 };
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {pill}
      {sub.plan === "trial" ? (
        <>
          <button className="btn-ghost" disabled={busy} style={miniBtn} onClick={() => act("extend")} title="Verleng de proefperiode met 14 dagen">+14 dagen</button>
          {!sub.expired && (
            <button className="btn-ghost" disabled={busy} style={{ ...miniBtn, color: "var(--c-neg)" }} onClick={() => act("stop")} title="Beëindig de proefperiode per direct">Stop</button>
          )}
          <button className="btn-ghost" disabled={busy} style={{ ...miniBtn, color: "var(--c-accent)" }} onClick={() => act("activate")} title="Zet deze organisatie op betaald/onbeperkt">Activeer</button>
        </>
      ) : (
        <button className="btn-ghost" disabled={busy} style={{ ...miniBtn, color: "var(--c-accent)" }} onClick={() => act("restart")} title="Start een nieuwe proefperiode van 14 dagen; de gebruikers zien dan de trial-balk">
          Proef starten
        </button>
      )}
    </span>
  );
}

const menuLabel = { padding: "0 12px", fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: "var(--c-muted)", textTransform: "uppercase", margin: "8px 0 6px 8px" };
const navActive = { display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10, background: "var(--c-accent-soft)", color: "var(--c-accent)", fontWeight: 700 };
const navItem = { display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10, color: "var(--c-muted)", fontWeight: 600, cursor: "pointer" };
const userFoot = { display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderTop: "1px solid var(--c-border)" };
const headRow = { display: "grid", gridTemplateColumns: "2fr 1.3fr 1fr 0.9fr 1.7fr", minWidth: 860, gap: 14, fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-muted)", padding: "14px 20px", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface-2)" };
const dataRow = { display: "grid", gridTemplateColumns: "2fr 1.3fr 1fr 0.9fr 1.7fr", minWidth: 860, gap: 14, alignItems: "center", padding: "15px 20px", borderBottom: "1px solid var(--c-border-soft)", fontSize: 13.5 };
const overlay = { position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 };
const lbl = { display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--c-ink-soft)", margin: "12px 0 6px" };
const inp = { width: "100%", height: 44, padding: "0 14px", fontSize: 14, borderRadius: 11, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", boxSizing: "border-box" };
const btnGhost = { height: 42, padding: "0 18px", fontSize: 13.5, borderRadius: 11, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink-soft)", cursor: "pointer", fontWeight: 600 };
