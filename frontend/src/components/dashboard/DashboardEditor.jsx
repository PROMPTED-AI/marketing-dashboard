// Generieke, samenstelbare dashboard-editor. Werkt voor elk kanaal: geef een
// catalogus (welke metrics/visualisaties), de kanaalpayload en de bijbehorende
// asset-keuze mee. Beheer van de opgeslagen indelingen (privé/gedeeld/standaard)
// gaat via /api/dashboards, gescoped op `page` (= de kanaalsleutel).

import { useEffect, useRef, useState } from "react";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDashboards } from "../../lib/useDashboards.jsx";
import { TabState } from "../ui.jsx";
import ExportButton from "../ExportButton.jsx";
import WidgetFrame from "./WidgetFrame.jsx";
import WidgetPicker from "./WidgetPicker.jsx";
import TemplatePicker from "./TemplatePicker.jsx";
import NameDialog from "./NameDialog.jsx";
import GenerateDialog from "./GenerateDialog.jsx";
import { instantiateTemplate, sanitizeLayout, newWidget, defaultTemplateFor, buildManifest } from "../../lib/widgets/kit.js";
import { api, generateDashboard } from "../../lib/api.js";

const serialize = (l) => JSON.stringify(l?.widgets ?? []);

export default function DashboardEditor({
  catalog, page, data, loading, error, ctx,
  title, subtitle, assetControls, exportFilename, exportSections,
}) {
  const { orgId, businessType } = useActiveOrg();
  const dash = useDashboards(orgId, page);

  const [activeId, setActiveId] = useState(null);
  const [activeMeta, setActiveMeta] = useState({ is_owner: true, visibility: "private" });
  const [working, setWorking] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [editing, setEditing] = useState(false);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [genNotice, setGenNotice] = useState(null); // {notes, requests, dropped} na AI-samenstellen

  const storeKey = orgId ? `kompas-dash-${page}-${orgId}` : null;
  const initRef = useRef(null);
  const isOwner = activeId == null || activeMeta.is_owner;

  function selectDashboard(id) {
    setActiveId(id);
    if (storeKey) localStorage.setItem(storeKey, id);
    setEditing(false);
    dash
      .fetchOne(id)
      .then((d) => {
        const l = sanitizeLayout(catalog, d.layout);
        setWorking(l);
        setBaseline(l);
        setActiveMeta({ is_owner: d.is_owner, visibility: d.visibility });
      })
      .catch(() => setBaseline(null));
  }

  // Re-initialise selection when the org/page (and thus the dashboard list) changes.
  useEffect(() => {
    if (!orgId || dash.loading) return;
    const token = `${orgId}|${page}`;
    if (initRef.current === token) return;
    initRef.current = token;
    const list = dash.list;
    if (!list.length) {
      setActiveId(null);
      setWorking(instantiateTemplate(catalog, defaultTemplateFor(catalog, businessType)));
      setBaseline(null);
      setEditing(false);
      return;
    }
    const stored = storeKey && localStorage.getItem(storeKey);
    const pick = list.find((d) => d.id === stored) || list.find((d) => d.is_default) || list[0];
    selectDashboard(pick.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, page, dash.loading, dash.list]);

  const dirty = working != null && (baseline == null || serialize(working) !== serialize(baseline));

  const patchWidget = (id, patch) =>
    setWorking((w) => ({ widgets: w.widgets.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const removeWidget = (id) =>
    setWorking((w) => ({ widgets: w.widgets.filter((x) => x.id !== id) }));
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
    setWorking((w) => ({ widgets: [...(w?.widgets ?? []), newWidget(catalog, sourceId)] }));
    setModal(null);
  };

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
      setModal("saveas");
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
    const layout = instantiateTemplate(catalog, tpl);
    const created = await dash.create({ name: tpl.name, layout });
    setModal(null);
    setActiveId(created.id);
    if (storeKey) localStorage.setItem(storeKey, created.id);
    setWorking(layout);
    setBaseline(layout);
    setActiveMeta({ is_owner: true, visibility: created.visibility });
    setEditing(true);
  });

  // AI stelt een indeling samen uit de catalogus; het concept komt als
  // niet-opgeslagen werkversie in de editor, zodat de gebruiker het eerst
  // bekijkt en bijschaaft voor hij het via "Opslaan als…" bewaart. Gooit door
  // naar de dialoog bij een fout (die toont hem daar) i.p.v. een alert.
  const applyGenerated = async (prompt) => {
    const manifest = buildManifest(catalog);
    const res = await generateDashboard({ prompt, page, manifest, orgId });
    const layout = sanitizeLayout(catalog, res.layout);
    if (!layout.widgets.length) {
      throw new Error("De AI kon met deze gegevens geen widgets samenstellen. Formuleer je vraag eventueel anders.");
    }
    setActiveId(null);
    setWorking(layout);
    setBaseline(null); // niet-opgeslagen concept -> als gewijzigd gemarkeerd
    setActiveMeta({ is_owner: true, visibility: "private" });
    setEditing(true);
    setModal(null);
    setGenNotice({ notes: res.notes, requests: res.requests || [], dropped: res.dropped || 0 });
  };

  // Widgets die de AI niet kon bouwen als verbeterverzoek naar het team sturen,
  // via het bestaande feedbacksysteem (komt in de kanban-kolom Requests).
  const requestWidgets = guard(async (requests) => {
    const message = "Widget-aanvraag vanuit Mijn dashboards (" + page + "):\n- " + requests.join("\n- ");
    await api("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "idee", message, page: `dashboard:${page}`, org_id: orgId || undefined }),
    });
    setGenNotice((n) => (n ? { ...n, requests: [], sent: true } : n));
    alert("Bedankt, je aanvraag is doorgestuurd naar het team.");
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
    initRef.current = null;
    setWorking(null);
    await dash.remove(activeId);
  });

  const switchTo = (id) => {
    if (dirty && !confirm("Niet-opgeslagen wijzigingen gaan verloren. Doorgaan?")) return;
    selectDashboard(id);
  };

  if (working == null) return <TabState loading />;

  const widgets = working?.widgets ?? [];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18, gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="display" style={{ fontSize: 28 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 13.5, color: "var(--c-muted)", marginTop: 4 }}>{subtitle}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {assetControls}
          <button className="btn-ghost" onClick={() => setModal("generate")} style={{ height: 40, padding: "0 14px" }} title="Stel een dashboard samen met AI">✨ Genereer met AI</button>
          <DashboardSwitcher list={dash.list} activeId={activeId} onSwitch={switchTo} onNew={() => setModal("template")} />
          {activeId && activeMeta.visibility === "shared" && <span className="pill accent">gedeeld</span>}
          {activeId && !isOwner && <span className="pill muted">van een collega</span>}
          {dirty && <span className="pill muted">niet opgeslagen</span>}
          {!editing ? (
            <button className="btn-ghost" onClick={() => setEditing(true)} style={{ height: 40, padding: "0 16px" }}>Aanpassen</button>
          ) : (
            <button className="btn-ghost" onClick={() => setEditing(false)} style={{ height: 40, padding: "0 16px" }}>Klaar</button>
          )}
          {exportSections && <ExportButton filename={exportFilename || page} sections={exportSections} />}
        </div>
      </div>

      {editing && (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 16, flexWrap: "wrap" }}>
          <button className="btn-primary" onClick={() => setModal("widget")} style={{ height: 38, padding: "0 16px" }}>＋ Widget toevoegen</button>
          <button className="btn-ghost" onClick={saveCurrent} disabled={busy || !dirty || !isOwner} title={!isOwner ? "Alleen de eigenaar kan dit dashboard overschrijven" : undefined} style={{ height: 38, padding: "0 16px", opacity: !dirty || busy || !isOwner ? 0.5 : 1 }}>Opslaan</button>
          <button className="btn-ghost" onClick={() => setModal("saveas")} disabled={busy} style={{ height: 38, padding: "0 14px" }}>Opslaan als…</button>
          <div style={{ flex: 1 }} />
          {!isOwner && <span style={{ fontSize: 12.5, color: "var(--c-muted)" }}>Dit is andermans dashboard. Gebruik “Opslaan als…” voor je eigen kopie.</span>}
          {activeId && isOwner && <button className="btn-ghost" onClick={toggleShare} disabled={busy} style={{ height: 38, padding: "0 14px" }}>{activeMeta.visibility === "shared" ? "Delen stoppen" : "Delen met organisatie"}</button>}
          {activeId && isOwner && <button className="btn-ghost" onClick={() => setModal("rename")} disabled={busy} style={{ height: 38, padding: "0 14px" }}>Hernoemen</button>}
          {activeId && isOwner && <button className="btn-ghost" onClick={makeDefault} disabled={busy} style={{ height: 38, padding: "0 14px" }}>Als standaard</button>}
          {activeId && isOwner && <button className="btn-ghost" onClick={removeCurrent} disabled={busy} style={{ height: 38, padding: "0 14px", color: "var(--c-neg)" }}>Verwijderen</button>}
        </div>
      )}

      {genNotice && (
        <div className="card" style={{ padding: "12px 16px", marginBottom: 16, borderLeft: "3px solid var(--c-accent)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--c-ink-soft)", lineHeight: 1.55 }}>
              <span style={{ fontWeight: 700 }}>Concept samengesteld met AI.</span>{" "}
              Bekijk en schaaf bij, en bewaar met “Opslaan als…”.
              {genNotice.notes ? <div style={{ marginTop: 4 }}>{genNotice.notes}</div> : null}
              {genNotice.dropped > 0 && (
                <div style={{ marginTop: 4, color: "var(--c-muted)" }}>{genNotice.dropped} voorgestelde widget(s) waren niet geldig en zijn weggelaten.</div>
              )}
              {genNotice.requests?.length > 0 && (
                <div style={{ marginTop: 6, color: "var(--c-muted)" }}>
                  Niet beschikbaar als widget: {genNotice.requests.join("; ")}.{" "}
                  <button className="btn-ghost" style={{ height: 26, padding: "0 10px", fontSize: 12 }} onClick={() => requestWidgets(genNotice.requests)}>Widget aanvragen</button>
                </div>
              )}
            </div>
            <button className="icon-btn" onClick={() => setGenNotice(null)} title="Sluiten" style={{ flex: "none", fontSize: 16, lineHeight: 1, padding: 4, color: "var(--c-muted)" }}>×</button>
          </div>
        </div>
      )}

      <TabState loading={loading && !data} error={error} onConnect />

      {!error && (data || !loading) && (
        widgets.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--c-muted)" }}>
            <div style={{ marginBottom: 14 }}>Dit dashboard heeft nog geen widgets.</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button className="btn-primary" onClick={() => setModal("generate")} style={{ height: 40, padding: "0 18px" }}>✨ Genereer met AI</button>
              <button className="btn-ghost" onClick={() => { setEditing(true); setModal("widget"); }} style={{ height: 40, padding: "0 18px" }}>Widget toevoegen</button>
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
                catalog={catalog}
                ctx={ctx}
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

      {modal === "template" && (
        <TemplatePicker catalog={catalog} businessType={businessType} onPick={createFromTemplate} onClose={() => setModal(null)} />
      )}
      {modal === "widget" && (
        <WidgetPicker catalog={catalog} data={data} ctx={ctx} onPick={addWidget} onClose={() => setModal(null)} />
      )}
      {modal === "saveas" && (
        <NameDialog title="Dashboard opslaan" label="Naam van het dashboard" initial="" confirmLabel="Opslaan" onConfirm={saveAs} onClose={() => setModal(null)} />
      )}
      {modal === "rename" && (
        <NameDialog title="Dashboard hernoemen" label="Nieuwe naam" initial={dash.list.find((d) => d.id === activeId)?.name || ""} confirmLabel="Opslaan" onConfirm={renameCurrent} onClose={() => setModal(null)} />
      )}
      {modal === "generate" && (
        <GenerateDialog onGenerate={applyGenerated} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function DashboardSwitcher({ list, activeId, onSwitch, onNew }) {
  return (
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
  );
}
