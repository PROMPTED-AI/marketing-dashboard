// Klein dialoogje om een naam in te voeren (nieuw dashboard / opslaan als / hernoemen).
import { useState } from "react";
import Modal from "./Modal.jsx";

export default function NameDialog({ title, label = "Naam", initial = "", confirmLabel = "Opslaan", onConfirm, onClose }) {
  const [name, setName] = useState(initial);
  const submit = (e) => {
    e.preventDefault();
    const v = name.trim();
    if (v) onConfirm(v);
  };
  return (
    <Modal title={title} onClose={onClose} width={420}>
      <form onSubmit={submit}>
        <label style={{ fontSize: 13, fontWeight: 600, color: "var(--c-muted)" }}>{label}</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            width: "100%", marginTop: 8, marginBottom: 18, height: 42, padding: "0 12px",
            borderRadius: 10, border: "1px solid var(--c-border)", background: "var(--c-surface)",
            color: "var(--c-ink)", fontSize: 14, fontFamily: "inherit",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" className="btn-ghost" onClick={onClose} style={{ height: 40, padding: "0 16px" }}>Annuleren</button>
          <button type="submit" className="btn-primary" disabled={!name.trim()} style={{ height: 40, padding: "0 18px", opacity: name.trim() ? 1 : 0.5 }}>{confirmLabel}</button>
        </div>
      </form>
    </Modal>
  );
}
