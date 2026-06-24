import { useEffect, useRef, useState } from "react";
import { useProperties } from "../../lib/useProperties.jsx";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDateRange } from "../../lib/PeriodProvider.jsx";
import { useCachedApi } from "../../lib/swr.js";
import { useDashboards } from "../../lib/useDashboards.jsx";
import { overviewUrl } from "../../lib/urls.js";
import { TabState } from "../../components/ui.jsx";
import ExportButton from "../../components/ExportButton.jsx";
import WidgetFrame from "../../components/dashboard/WidgetFrame.jsx";
import WidgetPicker from "../../components/dashboard/WidgetPicker.jsx";
import TemplatePicker from "../../components/dashboard/TemplatePicker.jsx";
import NameDialog from "../../components/dashboard/NameDialog.jsx";
import { TEMPLATES, instantiateTemplate, sanitizeLayout, newWidget } from "../../lib/widgetCatalog.js";

const serialize = (l) => JSON.stringify(l?.widgets ?? []);

export default function Overview() {
  const { props, selected, loading: pLoading, error: pError } = useProperties();
  const { orgId } = useActiveOrg();
  const { start, end, compare, label } = useDateRange();
  const { data, loading, error } = useCachedApi(overviewUrl(selected, start, end, compare, orgId));
  const dash = useDashboards(orgId);

  const [activeId, setActiveId] = useState(null);
  const [activeMeta, setActiveMeta] = useState({ is_owner: true, visibility: "private" });
  const [working, setWorking] = useState(null); // { widgets: [...] } currently shown/edited
  const [baseline, setBaseline] = useState(null); // last saved layout (null = unsaved template)
  const [editing, setEditing] = useState(false);
  const [modal, setModal] = useState(null); // 'template' | 'widget' | 'saveas' | 'rename'
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState(null);

  const storeKey = orgId ? `kompas-dash-overview-${orgId}` : null;
  const initRef = useRef(null);
  const isOwner = activeId == null || activeMeta.is_owner; // unsaved template -> owner-to-be

  // Load a dashboard's layout into the working copy.
  function selectDashboard(id) {
    setActiveId(id);
    if (storeKey) localStorage.setItem(storeKey, id);
    setEditing(false);
    dash
      .fetchOne(id)
      .then((d) => {
        const l = sanitizeLayout(d.layout);
        setWorking(l);
        setBaseline(l);
        setActiveMeta({ is_owner: d.is_owner, visibility: d.visibility });
      })
      .catch(() => setBaseline(null));
  }

  // Initialise selection once per org (after the list has loaded).
  useEffect(() => {
    if (!orgId || dash.loading) return;
    if (initRef.current === orgId) return;
    initRef.current = orgId;
    const list = dash.list;
    if (!list.length) {
      setActiveId(null);
      setWorking(instantiateTemplate(TEMPLATES[0]));
      setBaseline(null);
      setEditing(false);
      return;
    }
    const stored = storeKey && localStorage.getItem(storeKey);
    const pick = list.find((d) => d.id === stored) || list.find((d) => d.is_default) || list[0];
    selectDashboard(pick.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, dash.loading, dash.list]);

  const dirty = working != null && (baseline == null || serialize(working) !== serialize(baseline));

  // --- layout edits (working copy only) ---
  const patchWidget = (id, patch) =>
    setWorking((w) => ({ widgets: w.widgets.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const removeWidget = (id) =>
    setWorking((w) => ({ widgets: w.widgets.filter((x) => x.id !== id) }));
  // Drag & drop: drop the dragged widget just before the target widget.
  const dropOn = (targetId) => {
    setWorking((w) => {
      if (!dragId || dragId === targetId) return w;
      const arr = [...w.widgets];
      const from = arr.findIndex((x) => x.id === dragId);
      if (from < 0) return w;
      const [moved] = arr.splice(from, 1);
      const to = arr.findIndex((x) => x.id === targetId);
      arr.splice(to < 0 ? arr.length : to, 0, moved);
      return { widgets: arr };
    });
    setDragId(null);
  };
  const addWidget = (sourceId) => {
    setWorking((w) => ({ widgets: [...(w?.widgets ?? []), newWidget(sourceId)] }));
    setModal(null);
  };

  // --- persistence ---
  const guard = (fn) => async (...args) => {
    setBusy(true);
    try {
      return await fn(...args);
    } catch (e) {
      alert("Er ging iets mis: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const saveCurrent = guard(async () => {
    if (!working) return;
    if (activeId) {
      await dash.update(activeId, { layout: working });
      setBaseline(working);
    } else {
      setModal("saveas"); // unsaved template -> ask for a name
    }
  });

  const saveAs = guard(async (name) => {
    const created = await dash.create({ name, layout: working });
    setModal(null);
    setActiveId(created.id);
    if (storeKey) localStorage.setItem(storeKey, created.id);
    setBaseline(working);
    setActiveMeta({ is_owner: true, visibility: created.visibility });
  });

  const createFromTemplate = guard(async (tpl) => {
    const layout = instantiateTemplate(tpl);
    const created = await dash.create({ name: tpl.name, layout });
    setModal(null);
    setActiveId(created.id);
    if (storeKey) localStorage.setItem(storeKey, created.id);
    setWorking(layout);
    setBaseline(layout);
    setActiveMeta({ is_owner: true, visibility: created.visibility });
    setEditing(true);
  });

  const renameCurrent = guard(async (name) => {
    await dash.update(activeId, { name });
    setModal(null);
  });

  const makeDefault = guard(async () => {
    if (activeId) await dash.update(activeId, { is_default: true });
  });

  const toggleShare = guard(async () => {
    if (!activeId) return;
    const next = activeMeta.visibility === "shared" ? "private" : "shared";
    await dash.update(activeId, { visibility: next });
    setActiveMeta((m) => ({ ...m, visibility: next }));
  });

  const removeCurrent = guard(async () => {
    if (!activeId) return;
    if (!confirm("Dit dashboard verwijderen?")) return;
    initRef.current = null; // let the init effect pick a new selection
    setWorking(null);
    await dash.remove(activeId);
  });

  const switchTo = (id) => {
    if (dirty && !confirm("Niet-opgeslagen wijzigingen gaan verloren. Doorgaan?")) return;
    selectDashboard(id);
  };

  // Export keeps working off the raw data (independent of the chosen layout).
  const sections = () => {
    if (!data) return [];
    const conversiesTotal = (data.conversions || []).reduce((a, c) => a + c.count, 0);
    return [
      { title: "Overzicht — " + label },
      { columns: ["Metric", "Waarde"], rows: [
        ["Bezoekers", data.kpis.users],
        ["Sessies", data.kpis.sessions],
        ["Conversies", conversiesTotal],
        ["Bouncepercentage %", (data.kpis.bounceRate * 100).toFixed(1)],
      ] },
      { title: "Verkeersbronnen", columns: ["Kanaal", "Sessies", "%"], rows: (data.channels || []).map((c) => [c.label, c.sessions, c.pct]) },
      { title: "Sessies per dag", columns: ["Datum", "Sessies"], rows: (data.sessions_by_date || []).map((d) => [d.date, d.sessions]) },
    ];
  };

  if (pLoading) return <TabState loading />;
  if (pError) return <TabState error={pError} onConnect />;
  if (!props?.length) return <TabState empty />;
  if (working == null) return <TabState loading />; // dashboards still initialising

  const widgets = working?.widgets ?? [];

  return (
    <div>
      {/* header + dashboard switcher */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18, gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="display" style={{ fontSize: 30 }}>overzicht</div>
          <div style={{ fontSize: 13.5, color: "var(--c-muted)", marginTop: 4 }}>
            prestaties van de {label} · live uit Google Analytics
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <DashboardSwitcher list={dash.list} activeId={activeId} onSwitch={switchTo} onNew={() => setModal("template")} />
          {activeId && activeMeta.visibility === "shared" && <span className="pill accent">gedeeld</span>}
          {activeId && !isOwner && <span className="pill muted">van een collega</span>}
          {dirty && <span className="pill muted">niet opgeslagen</span>}
          {!editing ? (
            <button className="btn-ghost" onClick={() => setEditing(true)} style={{ height: 40, padding: "0 16px" }}>Aanpassen</button>
          ) : (
            <button className="btn-ghost" onClick={() => setEditing(false)} style={{ height: 40, padding: "0 16px" }}>Klaar</button>
          )}
          <ExportButton filename="overzicht" sections={sections} />
        </div>
      </div>

      {/* edit toolbar */}
      {editing && (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 16, flexWrap: "wrap" }}>
          <button className="btn-primary" onClick={() => setModal("widget")} style={{ height: 38, padding: "0 16px" }}>＋ Widget toevoegen</button>
          <button className="btn-ghost" onClick={saveCurrent} disabled={busy || !dirty || !isOwner} title={!isOwner ? "Alleen de eigenaar kan dit dashboard overschrijven" : undefined} style={{ height: 38, padding: "0 16px", opacity: !dirty || busy || !isOwner ? 0.5 : 1 }}>Opslaan</button>
          <button className="btn-ghost" onClick={() => setModal("saveas")} disabled={busy} style={{ height: 38, padding: "0 14px" }}>Opslaan als…</button>
          <div style={{ flex: 1 }} />
          {!isOwner && <span style={{ fontSize: 12.5, color: "var(--c-muted)" }}>Dit is andermans dashboard — gebruik “Opslaan als…” voor je eigen kopie.</span>}
          {activeId && isOwner && <button className="btn-ghost" onClick={toggleShare} disabled={busy} style={{ height: 38, padding: "0 14px" }}>{activeMeta.visibility === "shared" ? "Delen stoppen" : "Delen met organisatie"}</button>}
          {activeId && isOwner && <button className="btn-ghost" onClick={() => setModal("rename")} disabled={busy} style={{ height: 38, padding: "0 14px" }}>Hernoemen</button>}
          {activeId && isOwner && <button className="btn-ghost" onClick={makeDefault} disabled={busy} style={{ height: 38, padding: "0 14px" }}>Als standaard</button>}
          {activeId && isOwner && <button className="btn-ghost" onClick={removeCurrent} disabled={busy} style={{ height: 38, padding: "0 14px", color: "var(--c-neg)" }}>Verwijderen</button>}
        </div>
      )}

      <TabState loading={loading && !data} error={error} onConnect />

      {!error && (data || !loading) && (
        widgets.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--c-muted)" }}>
            <div style={{ marginBottom: 14 }}>Dit dashboard heeft nog geen widgets.</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button className="btn-primary" onClick={() => { setEditing(true); setModal("widget"); }} style={{ height: 40, padding: "0 18px" }}>Widget toevoegen</button>
              <button className="btn-ghost" onClick={() => setModal("template")} style={{ height: 40, padding: "0 18px" }}>Kies een template</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 16, alignItems: "stretch" }}>
            {widgets.map((w) => (
              <WidgetFrame
                key={w.id}
                widget={w}
                data={data}
                editing={editing}
                onChange={(patch) => patchWidget(w.id, patch)}
                onRemove={() => removeWidget(w.id)}
                onDragStart={() => setDragId(w.id)}
                onDragEnd={() => setDragId(null)}
                onDropOn={() => dropOn(w.id)}
                isDragging={dragId === w.id}
                isDropTarget={dragId != null && dragId !== w.id}
              />
            ))}
          </div>
        )
      )}

      {/* modals */}
      {modal === "template" && (
        <TemplatePicker onPick={createFromTemplate} onClose={() => setModal(null)} />
      )}
      {modal === "widget" && (
        <WidgetPicker onPick={addWidget} onClose={() => setModal(null)} />
      )}
      {modal === "saveas" && (
        <NameDialog
          title="Dashboard opslaan"
          label="Naam van het dashboard"
          initial=""
          confirmLabel="Opslaan"
          onConfirm={saveAs}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "rename" && (
        <NameDialog
          title="Dashboard hernoemen"
          label="Nieuwe naam"
          initial={dash.list.find((d) => d.id === activeId)?.name || ""}
          confirmLabel="Opslaan"
          onConfirm={renameCurrent}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function DashboardSwitcher({ list, activeId, onSwitch, onNew }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <select
        value={activeId || ""}
        onChange={(e) => (e.target.value === "__new__" ? onNew() : onSwitch(e.target.value))}
        style={{
          height: 40, padding: "0 12px", borderRadius: 999, border: "1px solid var(--c-border)",
          background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 13.5, fontWeight: 600,
          fontFamily: "inherit", cursor: "pointer", maxWidth: 240,
        }}
      >
        {!activeId && <option value="">Niet opgeslagen (template)</option>}
        {list.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}{d.is_default ? " ★" : ""}{d.is_owner ? "" : " (collega)"}
          </option>
        ))}
        <option value="__new__">＋ Nieuw dashboard…</option>
      </select>
    </div>
  );
}
