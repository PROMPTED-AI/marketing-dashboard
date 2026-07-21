import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.js";
import { useCachedApi } from "../../lib/swr.js";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { IcChevDown, IcPlus } from "../../components/icons.jsx";

// Het raamwerk: een vaste set KPI-rijen per maand, zoals een bureau die in een
// spreadsheet bijhoudt. Grijze cellen komen automatisch uit de gekoppelde
// kanalen of worden berekend; witte cellen vul je zelf in en worden per maand
// opgeslagen. Welke variant je ziet volgt het bedrijfstype van de organisatie
// (gekozen in de onboarding of aan te passen in de instellingen).
const ROWS_LEADGEN = [
  { key: "budget", label: "Bureaukosten", type: "manual", fmt: "euro", hint: "De maandelijkse kosten van het bureau" },
  {
    key: "ads_kosten", label: "Advertentiekosten", type: "auto", fmt: "euro",
    sub: [
      { key: "ads_google", label: "Google Ads", fmt: "euro" },
      { key: "ads_meta", label: "META Ads", fmt: "euro" },
    ],
  },
  { key: "conversies", label: "Aantal conversies", type: "auto", fmt: "num" },
  { key: "bezoekers", label: "Websitebezoekers", type: "auto", fmt: "num" },
  { key: "conversie_pct", label: "Conversiepercentage", type: "derived", fmt: "pct" },
  { key: "kosten_per_lead", label: "Kosten per lead", type: "derived", fmt: "euro" },
  { key: "kosten_per_klant", label: "Kosten per klant", type: "manual", fmt: "euro", hint: "Wat een nieuwe klant gemiddeld kost" },
];

const ROWS_ECOMMERCE = [
  { key: "budget", label: "Bureaukosten", type: "manual", fmt: "euro", hint: "De maandelijkse kosten van het bureau" },
  {
    key: "ads_kosten", label: "Advertentiekosten", type: "auto", fmt: "euro",
    sub: [
      { key: "ads_google", label: "Google Ads", fmt: "euro" },
      { key: "ads_meta", label: "META Ads", fmt: "euro" },
    ],
  },
  { key: "omzet_excl", label: "Opbrengst excl. btw", type: "auto", fmt: "euro" },
  { key: "omzet_incl", label: "Opbrengst incl. btw", type: "derived", fmt: "euro" },
  { key: "roi_marketing", label: "ROI marketing", type: "derived", fmt: "ratio" },
  { key: "roas", label: "ROAS campagne", type: "derived", fmt: "ratio" },
  { key: "orders", label: "Aantal orders", type: "auto", fmt: "num" },
  { key: "gem_orderwaarde", label: "Gemiddelde orderwaarde", type: "derived", fmt: "euro" },
  { key: "bezoekers", label: "Websitebezoekers", type: "auto", fmt: "num" },
  { key: "conversie_pct_orders", label: "Conversiepercentage", type: "derived", fmt: "pct" },
  { key: "inkoopwaarde", label: "Inkoopwaarde", type: "manual", fmt: "euro", hint: "Inkoopkosten van de verkochte producten" },
  { key: "returns", label: "Retouren", type: "manual", fmt: "euro", hint: "Waarde van retour gekomen orders" },
  { key: "poas", label: "POAS", type: "derived", fmt: "ratio" },
  { key: "poas_excl_bureau", label: "POAS excl. bureaukosten", type: "derived", fmt: "ratio" },
];

const MONTH_NAMES = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

const monthLabel = (m) => {
  const [y, mm] = m.split("-");
  return `${MONTH_NAMES[Number(mm) - 1]} ${y}`;
};

const nf0 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtValue(v, fmt) {
  if (v === null || v === undefined) return "—";
  if (fmt === "euro") return `€ ${nf2.format(v)}`;
  if (fmt === "pct") return `${nf2.format(v)}%`;
  if (fmt === "ratio") return nf2.format(v);
  return nf0.format(v);
}

const MONTHS_KEY = "kompas-framework-months";

export default function Framework() {
  const { orgId, businessType } = useActiveOrg();
  const [monthCount, setMonthCount] = useState(() => {
    const n = Number(localStorage.getItem(MONTHS_KEY));
    return n >= 1 && n <= 24 ? n : 3;
  });

  const property = localStorage.getItem("kompas-property");
  const url = orgId
    ? `/api/framework?months=${monthCount}&org_id=${encodeURIComponent(orgId)}${property ? `&property_id=${encodeURIComponent(property)}` : ""}`
    : null;
  const { data, loading, error } = useCachedApi(url);

  // Bewerkingen komen als volledige maand-payload terug uit de PUT; die winnen
  // van de (mogelijk verouderde) GET-data tot de volgende verversing.
  const [patched, setPatched] = useState({});
  useEffect(() => { setPatched({}); }, [url]);

  const months = useMemo(() => {
    if (!data?.months) return null;
    return data.months.map((m) => patched[m.month] || m);
  }, [data, patched]);

  // De variant volgt het bedrijfstype van de organisatie: de server geeft het
  // actuele type mee; tot de eerste load valt de UI terug op het type uit de
  // org-context, zodat er geen verkeerde rijenset opflitst.
  const activeType = data?.business_type || businessType || "leadgen";
  const rows = activeType === "ecommerce" ? ROWS_ECOMMERCE : ROWS_LEADGEN;

  const addMonth = () => {
    const n = Math.min(monthCount + 1, 24);
    setMonthCount(n);
    try { localStorage.setItem(MONTHS_KEY, String(n)); } catch { /* best effort */ }
  };

  const saveValue = async (month, key, value) => {
    const params = new URLSearchParams();
    if (orgId) params.set("org_id", orgId);
    if (property) params.set("property_id", property);
    const d = await api(`/api/framework/${month}?${params}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: { [key]: value } }),
    });
    setPatched((p) => ({ ...p, [month]: d }));
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <div className="display" style={{ fontSize: 30 }}>raamwerk</div>
          <div style={{ fontSize: 13.5, color: "var(--c-muted)", marginTop: 4 }}>
            Je marketingcijfers per maand in één overzicht. Grijze velden worden automatisch gevuld, witte velden vul je zelf in. De variant volgt het bedrijfstype uit de instellingen.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span
            className="pill accent"
            title="Het raamwerk volgt het bedrijfstype van de organisatie. Aan te passen via Instellingen."
          >
            {activeType === "ecommerce" ? "E-commerce" : "Leadgeneratie"}
          </span>
          <button type="button" className="btn-primary" onClick={addMonth} disabled={monthCount >= 24}
            style={{ height: 38, padding: "0 14px", fontSize: 13, display: "flex", alignItems: "center", gap: 7 }}>
            <IcPlus s={14} />
            Maand toevoegen
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: 20, color: "var(--c-neg)" }}>
          Fout: {String(error.message || error)}
        </div>
      )}
      {!error && !months && (
        <div style={{ display: "grid", placeItems: "center", padding: 60 }}><div className="spin" /></div>
      )}
      {!error && months && (
        <FrameworkTable rows={rows} months={months} onSave={saveValue} refreshing={loading} />
      )}
    </div>
  );
}

function FrameworkTable({ rows, months, onSave, refreshing }) {
  const gridCols = `minmax(210px, 1.5fr) repeat(${months.length}, minmax(128px, 1fr))`;
  return (
    <div className="card" style={{ overflow: "hidden", opacity: refreshing ? 0.75 : 1, transition: "opacity .15s" }}>
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 210 + months.length * 128 }}>
          <div style={{ ...headRow, gridTemplateColumns: gridCols }}>
            <span style={{ textAlign: "left" }}>KPI</span>
            {months.map((m) => <span key={m.month} style={{ textAlign: "right" }}>{monthLabel(m.month)}</span>)}
          </div>
          {rows.map((row) => <FrameworkRow key={row.key} row={row} months={months} onSave={onSave} />)}
        </div>
      </div>
      <div style={{ padding: "10px 20px", fontSize: 12, color: "var(--c-muted)", borderTop: "1px solid var(--c-border-soft)" }}>
        Automatische velden komen uit je gekoppelde kanalen. Ontbreekt een koppeling, dan blijft het veld leeg.
      </div>
    </div>
  );
}

function FrameworkRow({ row, months, onSave }) {
  const [open, setOpen] = useState(false);
  const hasSub = !!row.sub?.length;
  return (
    <>
      <div style={{ ...bodyRow, gridTemplateColumns: `minmax(210px, 1.5fr) repeat(${months.length}, minmax(128px, 1fr))` }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 700 }}>
          {hasSub ? (
            <button type="button" className="icon-btn" onClick={() => setOpen((o) => !o)} title="Toon de uitsplitsing"
              style={{ ...expandBtn, transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}>
              <IcChevDown s={14} />
            </button>
          ) : (
            <span style={{ width: 24, flex: "none" }} />
          )}
          <span title={row.hint || undefined}>{row.label}</span>
        </span>
        {months.map((m) => <Cell key={m.month} row={row} month={m} onSave={onSave} />)}
      </div>
      {hasSub && open && row.sub.map((s) => (
        <div key={s.key} style={{ ...bodyRow, gridTemplateColumns: `minmax(210px, 1.5fr) repeat(${months.length}, minmax(128px, 1fr))`, background: "var(--c-surface-2)" }}>
          <span style={{ paddingLeft: 31, fontSize: 12.5, color: "var(--c-muted)", fontWeight: 600 }}>{s.label}</span>
          {months.map((m) => (
            <span key={m.month} style={{ ...autoCell, fontSize: 12.5 }}>{fmtValue(m.auto?.[s.key], s.fmt)}</span>
          ))}
        </div>
      ))}
    </>
  );
}

function Cell({ row, month, onSave }) {
  if (row.type === "manual") return <ManualCell row={row} month={month} onSave={onSave} />;
  const source = row.type === "auto" ? month.auto : month.derived;
  return <span style={autoCell}>{fmtValue(source?.[row.key], row.fmt)}</span>;
}

// Wit invulveld: opslaan gebeurt bij het verlaten van het veld. Leegmaken wist
// de opgeslagen waarde weer.
function ManualCell({ row, month, onSave }) {
  const stored = month.manual?.[row.key];
  const [text, setText] = useState(() => (stored !== null && stored !== undefined ? String(stored) : ""));
  const [state, setState] = useState("idle"); // idle | saving | error
  useEffect(() => {
    setText(stored !== null && stored !== undefined ? String(stored) : "");
  }, [stored, month.month]);

  const commit = async () => {
    const trimmed = text.trim().replace(",", ".");
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (!Number.isFinite(value) || value < 0)) { setState("error"); return; }
    if (value === (stored ?? null)) { setState("idle"); return; }
    setState("saving");
    try {
      await onSave(month.month, row.key, value);
      setState("idle");
    } catch {
      setState("error");
    }
  };

  return (
    <span style={{ display: "flex", justifyContent: "flex-end" }}>
      <input
        value={text}
        inputMode="decimal"
        placeholder={row.fmt === "euro" ? "€" : "0"}
        aria-label={`${row.label} ${monthLabel(month.month)}`}
        onChange={(e) => { setText(e.target.value); if (state === "error") setState("idle"); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        style={{
          ...manualInput,
          borderColor: state === "error" ? "var(--c-neg)" : "var(--c-border)",
          opacity: state === "saving" ? 0.6 : 1,
        }}
      />
    </span>
  );
}

const headRow = {
  display: "grid", gap: 12, alignItems: "center", padding: "13px 20px",
  fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase",
  color: "var(--c-muted)", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface-2)",
};
const bodyRow = {
  display: "grid", gap: 12, alignItems: "center", padding: "9px 20px",
  borderBottom: "1px solid var(--c-border-soft)", fontSize: 13.5,
};
const autoCell = {
  display: "block", textAlign: "right", padding: "8px 10px", borderRadius: 8,
  background: "var(--c-surface-2)", color: "var(--c-ink-soft)", fontVariantNumeric: "tabular-nums",
};
const manualInput = {
  width: "100%", maxWidth: 128, height: 36, padding: "0 10px", borderRadius: 8,
  border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)",
  fontSize: 13, fontWeight: 600, fontFamily: "inherit", textAlign: "right",
};
const expandBtn = {
  width: 24, height: 24, borderRadius: 7, border: "none", background: "transparent",
  color: "var(--c-muted)", cursor: "pointer", display: "flex", alignItems: "center",
  justifyContent: "center", flex: "none", transition: "transform .15s",
};
