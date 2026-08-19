import { useEffect, useMemo, useRef, useState } from "react";
import { IcChevDown, IcSearch } from "../../components/icons.jsx";

// Doorzoekbare keuzelijst voor het toewijzen van een bron (GA-property,
// Search Console-site, Google Ads-klant). Een gewone <select> is onwerkbaar
// zodra een bureau-account onder een MCC tientallen of honderden klanten ziet;
// hier typ je een naam of nummer en filtert de lijst mee.
//
// Zoekt op zowel het label als de onderliggende id, zodat "529244129" net zo
// goed werkt als "Prompted".
export default function AssetPicker({
  value,
  onChange,
  options,
  idKey,
  labelFn,
  emptyLabel = "— niet toegewezen —",
  searchPlaceholder = "zoek op naam of nummer…",
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const items = useMemo(() => (options || []).map((o) => ({
    id: o[idKey], label: labelFn(o) || o[idKey],
  })), [options, idKey, labelFn]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => `${i.label} ${i.id}`.toLowerCase().includes(q));
  }, [items, query]);

  const selected = items.find((i) => i.id === value);

  // Sluiten bij een klik buiten de keuzelijst.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) { setQuery(""); setActive(0); inputRef.current?.focus(); }
  }, [open]);

  const pick = (id) => { onChange(id || null); setOpen(false); };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[active]) pick(filtered[active].id); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="pill-btn"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{ ...trigger, opacity: disabled ? 0.6 : 1, cursor: disabled ? "default" : "pointer" }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selected ? "var(--c-ink)" : "var(--c-muted)" }}>
          {selected ? selected.label : emptyLabel}
        </span>
        <span style={{ display: "flex", color: "var(--c-muted)", flex: "none" }}><IcChevDown s={16} /></span>
      </button>

      {open && (
        <div style={menu}>
          <div style={searchRow}>
            <span style={{ display: "flex", color: "var(--c-muted)", flex: "none" }}><IcSearch s={15} /></span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              style={searchInput}
            />
            {items.length > 0 && (
              <span style={{ fontSize: 11, color: "var(--c-muted)", flex: "none" }}>{filtered.length}/{items.length}</span>
            )}
          </div>
          <div style={{ maxHeight: 260, overflowY: "auto", padding: 6 }}>
            <div
              className="icon-btn"
              onClick={() => pick("")}
              style={{ ...row, color: "var(--c-muted)", ...(value ? {} : rowActive) }}
            >
              {emptyLabel}
            </div>
            {filtered.map((i, idx) => (
              <div
                key={i.id}
                className="icon-btn"
                onMouseEnter={() => setActive(idx)}
                onClick={() => pick(i.id)}
                title={i.label}
                style={{ ...row, ...(i.id === value ? rowActive : idx === active ? rowHover : {}) }}
              >
                {i.label}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: "12px 10px", fontSize: 12.5, color: "var(--c-muted)" }}>
                {items.length ? "Geen resultaten." : "Dit Google-account ziet hier (nog) geen bronnen."}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const trigger = {
  width: "100%", height: 42, padding: "0 12px", borderRadius: 10,
  border: "1px solid var(--c-border)", background: "var(--c-surface)",
  display: "flex", alignItems: "center", gap: 8, fontSize: 13.5,
  fontFamily: "inherit", textAlign: "left",
};
const menu = {
  position: "absolute", top: "calc(100% + 5px)", left: 0, right: 0, zIndex: 70,
  background: "var(--c-surface)", border: "1px solid var(--c-border)",
  borderRadius: 12, boxShadow: "var(--sh-md)", overflow: "hidden",
};
const searchRow = {
  display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
  borderBottom: "1px solid var(--c-border-soft)", background: "var(--c-surface-2)",
};
const searchInput = {
  flex: 1, minWidth: 0, height: 24, border: "none", background: "transparent",
  color: "var(--c-ink)", fontSize: 13.5, fontFamily: "inherit", outline: "none",
};
const row = {
  display: "block", width: "100%", padding: "9px 10px", borderRadius: 8,
  fontSize: 13, cursor: "pointer", color: "var(--c-ink)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};
const rowHover = { background: "var(--c-surface-2)" };
const rowActive = { background: "var(--c-accent-soft)", color: "var(--c-accent)", fontWeight: 700 };
