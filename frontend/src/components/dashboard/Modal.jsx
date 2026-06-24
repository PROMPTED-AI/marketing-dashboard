// Eenvoudige modale overlay met een kaart in het midden.
import { useEffect } from "react";

export default function Modal({ title, onClose, children, width = 520 }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,18,40,0.45)",
        display: "grid", placeItems: "center", padding: 20, zIndex: 100,
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: width, maxHeight: "85vh", overflowY: "auto", padding: 22 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div className="display" style={{ fontSize: 20 }}>{title}</div>
          <button className="btn-ghost" onClick={onClose} style={{ height: 32, width: 32, padding: 0, fontSize: 16 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
