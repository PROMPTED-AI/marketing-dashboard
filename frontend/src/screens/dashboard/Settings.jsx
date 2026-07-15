import { useState } from "react";
import { api, setBusinessType } from "../../lib/api.js";
import { useMe } from "../../lib/useMe.jsx";
import { useTheme } from "../../lib/ThemeProvider.jsx";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDateRange, PRESETS, presetRange } from "../../lib/PeriodProvider.jsx";
import { invalidateOrg } from "../../lib/swr.js";
import { SectionCard } from "../../components/ui.jsx";
import { IcSun, IcMoon } from "../../components/icons.jsx";

const ROLE_LABEL = { agency_admin: "Bureau-admin", client: "Klant" };
const isoDate = (d) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

export default function Settings() {
  const { me, reload: reloadMe } = useMe();
  const { theme, toggle } = useTheme();
  const { preset, apply } = useDateRange();
  const { orgId, orgs, reload: reloadOrgs } = useActiveOrg();

  const isAdmin = me?.role === "agency_admin";
  const activeOrg = orgs.find((o) => o.id === orgId) || me?.organization || {};

  return (
    <div>
      <div className="display" style={{ fontSize: 30 }}>instellingen</div>
      <div style={{ fontSize: 13.5, color: "var(--c-muted)", margin: "4px 0 22px" }}>beheer je profiel, voorkeuren en organisatie</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
        {/* PROFIEL */}
        <SectionCard title="profiel & account">
          <Row label="E-mailadres" value={me?.email || "—"} />
          <Row label="Rol" value={ROLE_LABEL[me?.role] || me?.role || "—"} />
          <Row label="Organisatie" value={activeOrg?.name || "—"} last />
        </SectionCard>

        {/* VOORKEUREN */}
        <SectionCard title="voorkeuren">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--c-border-soft)" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Thema</div>
              <div style={{ fontSize: 12.5, color: "var(--c-muted)" }}>licht of donker</div>
            </div>
            <button className="btn-ghost" style={{ height: 40, padding: "0 14px", fontSize: 13 }} onClick={toggle}>
              {theme === "dark" ? <><IcSun s={16} /> licht</> : <><IcMoon s={16} /> donker</>}
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 0" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Standaard periode</div>
              <div style={{ fontSize: 12.5, color: "var(--c-muted)" }}>wordt overal in het dashboard gebruikt</div>
            </div>
            <select
              value={PRESETS.some((p) => p.id === preset) ? preset : ""}
              onChange={(e) => {
                const r = presetRange(e.target.value);
                apply({ preset: e.target.value, start: isoDate(r.start), end: isoDate(r.end) });
              }}
              style={selectStyle}
            >
              {!PRESETS.some((p) => p.id === preset) && <option value="">Aangepast</option>}
              {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
        </SectionCard>

        {/* ORGANISATIE */}
        <OrganisationCard
          isAdmin={isAdmin}
          org={activeOrg}
          orgId={orgId}
          onSaved={() => { invalidateOrg(orgId); reloadOrgs(); reloadMe(); }}
        />
      </div>
    </div>
  );
}

const BIZ_TYPES = [
  { value: "leadgen", label: "Leadgeneratie" },
  { value: "ecommerce", label: "E-commerce" },
];

function OrganisationCard({ isAdmin, org, orgId, onSaved }) {
  const [name, setName] = useState(org?.name || "");
  const [bizType, setBizType] = useState(org?.business_type || "leadgen");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);

  // keep the inputs in sync when the active org changes
  const orgKey = org?.id;
  const [seenKey, setSeenKey] = useState(orgKey);
  if (orgKey !== seenKey) {
    setSeenKey(orgKey); setName(org?.name || ""); setBizType(org?.business_type || "leadgen");
    setDone(false); setErr(null);
  }

  const nameDirty = isAdmin && name.trim() && name.trim() !== (org?.name || "");
  const bizDirty = bizType !== (org?.business_type || "leadgen");
  const dirty = nameDirty || bizDirty;

  const save = async () => {
    setBusy(true); setErr(null); setDone(false);
    try {
      if (isAdmin) {
        // Admins may edit any client org: name + type via the admin endpoint.
        await api(`/api/organizations/${orgId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() || org?.name, business_type: bizType }),
        });
      } else if (bizDirty) {
        // A client may set its own organization's profile (least-privilege).
        await setBusinessType(bizType);
      }
      setDone(true);
      onSaved();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard title="organisatie">
      <label style={lbl}>Naam</label>
      <input
        value={name}
        onChange={(e) => { setName(e.target.value); setDone(false); }}
        disabled={!isAdmin}
        style={{ ...inp, opacity: isAdmin ? 1 : 0.7 }}
      />
      <label style={lbl}>E-maildomein</label>
      <input value={org?.domain || ""} disabled style={{ ...inp, opacity: 0.7 }} />
      <label style={lbl}>Bedrijfstype</label>
      <select
        value={bizType}
        onChange={(e) => { setBizType(e.target.value); setDone(false); }}
        style={{ ...inp, cursor: "pointer" }}
      >
        {BIZ_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <div style={{ fontSize: 12, color: "var(--c-muted)", marginTop: 8 }}>
        Bepaalt welke dashboards en KPI's standaard vooraan staan (leadgeneratie of e-commerce).
      </div>
      {!isAdmin && <div style={{ fontSize: 12, color: "var(--c-muted)", marginTop: 8 }}>Alleen een bureau-admin kan de organisatienaam wijzigen.</div>}
      {err && <div style={{ color: "var(--c-neg)", fontSize: 13, marginTop: 10 }}>{String(err.message || err)}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
        <button className="btn-primary" style={{ height: 42, padding: "0 20px", opacity: dirty && !busy ? 1 : 0.6 }} disabled={!dirty || busy} onClick={save}>
          {busy ? "opslaan…" : "opslaan"}
        </button>
        {done && !dirty && <span style={{ fontSize: 13, color: "var(--c-pos)", fontWeight: 700 }}>opgeslagen ✓</span>}
      </div>
    </SectionCard>
  );
}

function Row({ label, value, last }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 0", borderBottom: last ? "none" : "1px solid var(--c-border-soft)" }}>
      <span style={{ fontSize: 13.5, color: "var(--c-muted)", fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

const selectStyle = { padding: "9px 12px", fontSize: 13, borderRadius: 999, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)" };
const lbl = { display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--c-ink-soft)", margin: "12px 0 6px" };
const inp = { width: "100%", height: 44, padding: "0 14px", fontSize: 14, borderRadius: 11, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", boxSizing: "border-box" };
