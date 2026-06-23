import { useEffect, useRef, useState } from "react";
import { exportCsv, printReport } from "../lib/exportData.js";
import { IcDownload } from "./icons.jsx";

// `sections` is a function returning [{title?, columns?, rows}] at click time.
export default function ExportButton({ filename = "rapport", sections }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }} className="no-print">
      <button className="btn-primary" style={{ height: 42, padding: "0 18px", fontSize: 13.5 }} onClick={() => setOpen((o) => !o)}>
        <IcDownload s={16} /> rapport exporteren
      </button>
      {open && (
        <div style={menu}>
          <div style={row} onClick={() => { exportCsv(filename + ".csv", sections()); setOpen(false); }}>Exporteer als CSV</div>
          <div style={row} onClick={() => { setOpen(false); setTimeout(printReport, 60); }}>Exporteer als PDF</div>
        </div>
      )}
    </div>
  );
}

const menu = { position: "absolute", top: "calc(100% + 6px)", right: 0, minWidth: 200, background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 12, boxShadow: "var(--sh-md)", overflow: "hidden", zIndex: 40, padding: 6 };
const row = { padding: "10px 12px", fontSize: 13.5, cursor: "pointer", color: "var(--c-ink-soft)", borderRadius: 8 };
