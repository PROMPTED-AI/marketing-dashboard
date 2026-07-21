// Feedbackbeheer in de beheeromgeving: kanban-bord (alle nieuwe items starten
// in de kolom Requests) met een lijstweergave als toggle. Per item kan de
// beheerder de feedback door AI (EuRouter) laten uitwerken tot een volledig
// verzoek plus advies voor verwerking in het dashboard.
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../lib/api.js";
import Modal from "../components/dashboard/Modal.jsx";

const COLUMNS = [
  { key: "requests", label: "Requests" },
  { key: "in_progress", label: "In behandeling" },
  { key: "done", label: "Klaar" },
  { key: "rejected", label: "Afgewezen" },
];

const CAT_LABEL = { bug: "Bug", idee: "Idee", vraag: "Vraag", compliment: "Compliment", anders: "Anders" };
const CAT_COLOR = {
  bug: "var(--c-neg)", idee: "var(--c-accent)", vraag: "var(--c-purple)",
  compliment: "var(--c-pos)", anders: "var(--c-muted)",
};

const fmtDate = (iso) => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });

export default function AdminFeedback() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState(() => localStorage.getItem("kompas-feedback-view") || "kanban");
  const [openItem, setOpenItem] = useState(null);
  const [dragId, setDragId] = useState(null);

  const reload = () =>
    api("/api/admin/feedback")
      .then((d) => { setItems(d.feedback || []); setError(null); })
      .catch(setError);

  useEffect(() => { reload(); }, []);

  const pickView = (v) => { setView(v); localStorage.setItem("kompas-feedback-view", v); };

  const setStatus = (id, status) => {
    // optimistisch bijwerken, daarna bevestigen bij de server
    setItems((list) => (list || []).map((f) => (f.id === id ? { ...f, status } : f)));
    setOpenItem((o) => (o?.id === id ? { ...o, status } : o));
    api(`/api/admin/feedback/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => reload());
  };

  const onDrop = (status) => {
    if (dragId) setStatus(dragId, status);
    setDragId(null);
  };

  if (error) return <div className="card" style={{ padding: 20, color: "var(--c-neg)" }}>Fout: {String(error.message || error)}</div>;
  if (items === null) return <div style={{ display: "grid", placeItems: "center", padding: 60 }}><div className="spin" /></div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <div className="display" style={{ fontSize: 30 }}>feedback</div>
          <div style={{ fontSize: 13.5, color: "var(--c-muted)", marginTop: 4 }}>
            Alles wat gebruikers via de feedbackknop doorgeven. Nieuwe items starten in Requests.
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[["kanban", "Kanban"], ["lijst", "Lijst"]].map(([k, lbl]) => (
            <button key={k} className="pill-btn" onClick={() => pickView(k)} style={{ ...toggleBtn, ...(view === k ? toggleOn : {}) }}>{lbl}</button>
          ))}
        </div>
      </div>

      {view === "kanban" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(220px, 1fr))", gap: 14, alignItems: "start", overflowX: "auto" }}>
          {COLUMNS.map((col) => {
            const cards = items.filter((f) => f.status === col.key);
            return (
              <div
                key={col.key}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(col.key)}
                style={{ background: "var(--c-surface-2)", border: "1px solid var(--c-border-soft)", borderRadius: 14, padding: 10, minHeight: 120 }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 6px 10px" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800 }}>{col.label}</span>
                  <span className="pill muted" style={{ fontSize: 11 }}>{cards.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {cards.map((f) => (
                    <div
                      key={f.id}
                      draggable
                      onDragStart={() => setDragId(f.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => setOpenItem(f)}
                      className="card pill-btn"
                      style={{ padding: 12, cursor: "pointer", opacity: dragId === f.id ? 0.5 : 1 }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                        <span style={{ ...catPill, color: CAT_COLOR[f.category] }}>{CAT_LABEL[f.category] || f.category}</span>
                        {f.severity && <span className="pill muted" style={{ fontSize: 10.5 }}>{f.severity}</span>}
                        {f.ai_analysis && <span className="pill accent" style={{ fontSize: 10.5 }} title="AI-uitwerking beschikbaar">AI ✦</span>}
                      </div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {f.message}
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--c-muted)", marginTop: 8 }}>
                        {f.org_name || f.user_email} · {fmtDate(f.created_at)}
                      </div>
                    </div>
                  ))}
                  {cards.length === 0 && <div style={{ fontSize: 12, color: "var(--c-muted)", padding: "8px 6px" }}>Leeg</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
          <div style={listHead}>
            <span>Datum</span><span>Categorie</span><span>Van</span><span>Status</span><span>Bericht</span>
          </div>
          {items.map((f) => (
            <div key={f.id} className="icon-btn" onClick={() => setOpenItem(f)} style={listRow}>
              <span style={{ color: "var(--c-muted)", fontSize: 12.5 }}>{fmtDate(f.created_at)}</span>
              <span style={{ ...catPill, color: CAT_COLOR[f.category] }}>{CAT_LABEL[f.category] || f.category}</span>
              <span style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.org_name || f.user_email}</span>
              <span>{statusPill(f.status)}</span>
              <span style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.ai_analysis && <span className="pill accent" style={{ fontSize: 10, marginRight: 6 }}>AI ✦</span>}
                {f.message}
              </span>
            </div>
          ))}
          {items.length === 0 && <div style={{ padding: 24, color: "var(--c-muted)" }}>Nog geen feedback ontvangen.</div>}
          </div>
        </div>
      )}

      {openItem && (
        <FeedbackDetail
          item={openItem}
          onClose={() => setOpenItem(null)}
          onStatus={(s) => setStatus(openItem.id, s)}
          onAnalyzed={(analysis) => {
            setItems((list) => (list || []).map((f) => (f.id === openItem.id ? { ...f, ai_analysis: analysis } : f)));
            setOpenItem((o) => ({ ...o, ai_analysis: analysis }));
          }}
        />
      )}
    </div>
  );
}

function statusPill(status) {
  const map = {
    requests: ["Requests", "accent"], in_progress: ["In behandeling", "muted"],
    done: ["Klaar", "pos"], rejected: ["Afgewezen", "neg"],
  };
  const [label, cls] = map[status] || [status, "muted"];
  return <span className={`pill ${cls}`} style={{ fontSize: 11 }}>{label}</span>;
}

function FeedbackDetail({ item, onClose, onStatus, onAnalyzed }) {
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState(null);

  // De uitwerking komt als SSE-stream binnen (thinking/text/done/error), zodat
  // de beheerder ziet dat de AI bezig is en de tekst live verschijnt.
  const analyze = async () => {
    setBusy(true);
    setError(null);
    setPartial("");
    let text = "";
    try {
      const res = await fetch(`/api/admin/feedback/${item.id}/analyze`, { method: "POST", credentials: "include" });
      if (!res.ok || !res.body) {
        let msg = "De AI-uitwerking is niet gelukt.";
        try { msg = JSON.parse(await res.text()).detail || msg; } catch { /* platte tekst */ }
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 2);
          if (!line.startsWith("data:")) continue;
          const ev = JSON.parse(line.slice(5).trim());
          if (ev.type === "text") { text += ev.text; setPartial(text); }
          else if (ev.type === "error") throw new Error(ev.message);
        }
      }
      if (!text) throw new Error("De AI-uitwerking kwam leeg terug. Probeer het opnieuw.");
      onAnalyzed(text);
    } catch (e) {
      setError(e?.message || "De AI-uitwerking is niet gelukt.");
    } finally {
      setBusy(false);
      setPartial("");
    }
  };

  return (
    <Modal title="Feedback" onClose={onClose} width={640}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ ...catPill, color: CAT_COLOR[item.category] }}>{CAT_LABEL[item.category] || item.category}</span>
        {item.severity && <span className="pill muted" style={{ fontSize: 11 }}>{item.severity}</span>}
        {statusPill(item.status)}
        <span style={{ fontSize: 12, color: "var(--c-muted)" }}>{fmtDate(item.created_at)}</span>
      </div>

      <div style={{ fontSize: 12.5, color: "var(--c-muted)", marginBottom: 4 }}>
        Van {item.user_email}{item.org_name ? ` (${item.org_name})` : ""}{item.page ? ` · pagina ${item.page}` : ""}
      </div>
      <div className="card" style={{ padding: 14, fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap", marginBottom: 16 }}>
        {item.message}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <label style={{ fontSize: 12.5, fontWeight: 700 }}>Status:</label>
        <select value={item.status} onChange={(e) => onStatus(e.target.value)} style={statusSelect}>
          {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button className="btn-primary" onClick={analyze} disabled={busy} style={{ height: 38, padding: "0 16px", fontSize: 13, opacity: busy ? 0.6 : 1 }}>
          {busy ? "AI werkt uit…" : item.ai_analysis ? "✦ Opnieuw uitwerken" : "✦ Werk uit met AI"}
        </button>
      </div>

      {error && <div style={{ fontSize: 13, color: "var(--c-neg)", fontWeight: 600, marginBottom: 12 }}>{error}</div>}

      {busy && (
        <div className="card" style={{ padding: 16, background: "var(--c-surface-2)" }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "var(--c-accent)", marginBottom: 8 }}>✦ AI-uitwerking en advies</div>
          {partial && (
            <div className="assistant-md" style={{ fontSize: 13, marginBottom: 10 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{partial}</ReactMarkdown>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--c-muted)" }}>
            <span className="typing-dots" aria-hidden="true">
              <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
            </span>
            <span className="thinking-label">{partial ? "schrijft verder…" : "de AI denkt na over deze feedback…"}</span>
          </div>
        </div>
      )}

      {!busy && item.ai_analysis && (
        <div className="card" style={{ padding: 16, background: "var(--c-surface-2)" }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "var(--c-accent)", marginBottom: 8 }}>✦ AI-uitwerking en advies</div>
          <div className="assistant-md" style={{ fontSize: 13 }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.ai_analysis}</ReactMarkdown>
          </div>
        </div>
      )}
    </Modal>
  );
}

const toggleBtn = { padding: "8px 16px", borderRadius: 999, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const toggleOn = { border: "1px solid var(--c-accent)", background: "var(--c-accent)", color: "#fff" };
const catPill = { fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".03em" };
const listHead = { display: "grid", gridTemplateColumns: "90px 90px 180px 120px 1fr", minWidth: 720, gap: 12, padding: "12px 16px", fontSize: 11.5, fontWeight: 700, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "1px solid var(--c-border)" };
const listRow = { display: "grid", gridTemplateColumns: "90px 90px 180px 120px 1fr", minWidth: 720, gap: 12, padding: "12px 16px", alignItems: "center", borderBottom: "1px solid var(--c-border-soft)", cursor: "pointer" };
const statusSelect = { height: 36, padding: "0 10px", borderRadius: 9, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 13, fontWeight: 600, fontFamily: "inherit" };
