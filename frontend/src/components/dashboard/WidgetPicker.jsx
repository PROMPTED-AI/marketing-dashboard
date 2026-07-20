// "Widget toevoegen": een ruime galerij waarin elke metric uit de catalogus als
// een échte, live-gerenderde widget met data verschijnt (een preview van precies
// wat je krijgt). Klik op een preview om die widget aan het dashboard toe te
// voegen; het visualisatietype is daarna per widget te wijzigen.
import { useMemo, useState } from "react";
import Modal from "./Modal.jsx";
import WidgetRenderer from "../WidgetRenderer.jsx";
import WidgetErrorBoundary from "../WidgetErrorBoundary.jsx";
import { KINDS, newWidget } from "../../lib/widgets/kit.js";

export default function WidgetPicker({ catalog, data, ctx, onPick, onClose }) {
  return (
    <Modal title="Widget toevoegen" onClose={onClose} width={1040}>
      <div style={{ fontSize: 13, color: "var(--c-muted)", margin: "-4px 0 18px" }}>
        Elke tegel is een live voorbeeld met de data van deze klant en periode. Klik om toe te voegen.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
        {catalog.GROUPS.map((group) => (
          <section key={group.label}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
              {group.label}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 16,
                alignItems: "stretch",
              }}
            >
              {group.ids.map((id) => {
                const src = catalog.SOURCES[id];
                if (!src) return null;
                return (
                  <PreviewTile
                    key={id}
                    id={id}
                    src={src}
                    catalog={catalog}
                    data={data}
                    ctx={ctx}
                    onPick={onPick}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}

// Eén galerij-tegel: rendert de echte widget (default-visualisatie van de bron)
// als niet-interactieve preview, met een "toevoegen"-affordance bij hover.
function PreviewTile({ id, src, catalog, data, ctx, onPick }) {
  const [hover, setHover] = useState(false);
  const widget = useMemo(() => newWidget(catalog, id), [catalog, id]);
  const kindsLabel = src.kinds.map((k) => KINDS[k].label).join(" · ");

  const add = () => onPick(id);
  const onKey = (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); add(); }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={add}
      onKeyDown={onKey}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`${src.label} toevoegen`}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        border: `1px solid ${hover ? "var(--c-accent)" : "var(--c-border)"}`,
        borderRadius: 14,
        background: "var(--c-surface-2)",
        padding: 12,
        cursor: "pointer",
        boxShadow: hover ? "var(--sh-md)" : "none",
        transform: hover ? "translateY(-2px)" : "none",
        transition: "transform .12s, box-shadow .12s, border-color .12s",
        outline: "none",
      }}
    >
      {/* live preview van de echte widget (klik-doel = de hele tegel) */}
      <div style={{ position: "relative", maxHeight: 260, overflow: "hidden", pointerEvents: "none" }}>
        <WidgetErrorBoundary title={src.label} resetKey={id}>
          <WidgetRenderer widget={widget} data={data} catalog={catalog} ctx={ctx} />
        </WidgetErrorBoundary>
        {/* zachte fade onderaan als de widget hoger is dan de preview */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 34, background: "linear-gradient(to bottom, transparent, var(--c-surface-2))" }} />
      </div>

      {/* voettekst: bron + beschikbare visualisaties */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{src.label}</div>
          <div style={{ fontSize: 11, color: "var(--c-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kindsLabel}</div>
        </div>
        <span
          className="pill accent"
          style={{ flex: "none", fontSize: 11.5, padding: "4px 9px", opacity: hover ? 1 : 0.7, transition: "opacity .12s" }}
        >
          ＋ Toevoegen
        </span>
      </div>
    </div>
  );
}
