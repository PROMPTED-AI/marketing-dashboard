import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../../lib/api.js";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDateRange } from "../../lib/PeriodProvider.jsx";
import { IcChat } from "../../components/icons.jsx";

const TOOL_LABELS = {
  list_connections: "je koppelingen",
  get_marketing_overview: "Alle kanalen",
  get_analytics_overview: "Analytics",
  get_search_console: "Search Console",
  get_google_ads: "Google Ads",
  get_meta_ads: "Meta Ads",
  get_meta_organic: "Meta organisch",
  get_woocommerce: "WooCommerce",
};

// Renders an assistant answer as Markdown (GFM tables/lists) with compact,
// theme-aware styling. User messages stay plain text.
function Answer({ text }) {
  return (
    <div className="assistant-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

const SEV_COLOR = { positive: "var(--c-pos)", negative: "var(--c-neg)", neutral: "var(--c-accent)" };

const EXAMPLES = [
  "Hoe presteert mijn verkeer deze periode?",
  "Geef me 3 SEO-quick-wins",
  "Waar kan ik besparen op mijn advertenties?",
  "Hoe presteert mijn social media?",
];

export default function Assistant() {
  const { orgId } = useActiveOrg();
  const { start, end, label } = useDateRange();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [tool, setTool] = useState(null);
  const [insights, setInsights] = useState(null);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, tool]);

  // Proactive insights for the active client + period (rule-based, cached server-side).
  useEffect(() => {
    let alive = true;
    setInsights(null);
    const q = new URLSearchParams({ start, end });
    if (orgId) q.set("org_id", orgId);
    const prop = localStorage.getItem("kompas-property");
    if (prop) q.set("property_id", prop);
    const site = localStorage.getItem("kompas-gsc-site");
    if (site) q.set("site", site);
    api("/api/insights?" + q.toString())
      .then((d) => { if (alive) setInsights(d.insights || []); })
      .catch(() => { if (alive) setInsights([]); });
    return () => { alive = false; };
  }, [orgId, start, end]);

  // Merge a patch into the last (assistant) message.
  const updateLast = (patch) =>
    setMessages((ms) => {
      const c = [...ms];
      c[c.length - 1] = { ...(c[c.length - 1] || {}), role: "assistant", ...patch };
      return c;
    });

  async function send(text) {
    const question = (text ?? input).trim();
    if (!question || streaming) return;
    const history = [...messages, { role: "user", content: question }];
    setMessages([...history, { role: "assistant", content: "", sources: [] }]);
    setInput("");
    setStreaming(true);
    setTool(null);

    let answer = "";
    const sources = []; // ordered, unique tool labels used for this answer
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          org_id: orgId || undefined,
          start,
          end,
          property_id: localStorage.getItem("kompas-property") || undefined,
          site: localStorage.getItem("kompas-gsc-site") || undefined,
        }),
      });
      if (!res.ok || !res.body) throw new Error(res.status === 503 ? "De assistent is nog niet geconfigureerd." : "Serverfout");

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
          if (ev.type === "text") { answer += ev.text; setTool(null); updateLast({ content: answer }); }
          else if (ev.type === "tool") {
            const lbl = TOOL_LABELS[ev.name] || ev.name;
            setTool(lbl);
            if (lbl !== "je koppelingen" && !sources.includes(lbl)) { sources.push(lbl); updateLast({ sources: [...sources] }); }
          }
          else if (ev.type === "error") { answer += (answer ? "\n\n" : "") + ev.message; updateLast({ content: answer }); }
        }
      }
    } catch (e) {
      updateLast({ content: answer || `Er ging iets mis: ${e.message}` });
    } finally {
      setStreaming(false);
      setTool(null);
    }
  }

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="assistant-layout">
      <div className="assistant-main">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--c-accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-accent)" }}><IcChat s={19} /></div>
        <div>
          <div className="display" style={{ fontSize: 24, lineHeight: 1 }}>assistent</div>
          <div style={{ fontSize: 12.5, color: "var(--c-muted)" }}>{label} · vraag alles over je cijfers</div>
        </div>
      </div>

      {/* messages */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
        {messages.length === 0 && (
          <div className="card" style={{ padding: 22 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Waarmee kan ik je helpen?</div>
            <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 14 }}>
              Ik kijk mee in de cijfers van deze klant en geef advies. Bijvoorbeeld:
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {EXAMPLES.map((q) => (
                <button key={q} onClick={() => send(q)} style={chip}>{q}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={m.role === "user" ? userBubble : botBubble}>
              {m.content
                ? (m.role === "user"
                    ? <span style={{ whiteSpace: "pre-wrap" }}>{m.content}</span>
                    : <Answer text={m.content} />)
                : <span style={{ color: "var(--c-muted)" }}>{tool ? `analyseert ${tool}…` : "denkt na…"}</span>}
            </div>
            {m.role !== "user" && m.sources?.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", margin: "6px 2px 0" }}>
                <span style={{ fontSize: 10.5, color: "var(--c-muted)", fontWeight: 600 }}>Bronnen:</span>
                {m.sources.map((s) => (
                  <span key={s} style={sourceChip}>{s}</span>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* composer */}
      <div style={{ position: "sticky", bottom: 0, background: "var(--c-page)", paddingTop: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder="Stel een vraag over je cijfers…"
            style={textareaStyle}
          />
          <button onClick={() => send()} disabled={streaming || !input.trim()} className="btn-primary" style={{ height: 44, padding: "0 20px", opacity: streaming || !input.trim() ? 0.6 : 1 }}>
            {streaming ? "…" : "Vraag"}
          </button>
        </div>
        <div style={{ fontSize: 11, color: "var(--c-muted)", marginTop: 6 }}>
          De assistent gebruikt de live data van de geselecteerde klant en periode.
        </div>
      </div>
      </div>

      {/* signals panel — its own fixed place next to (or above) the chat */}
      <aside className="assistant-side no-print">
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800 }}>Signalen</div>
            <div style={{ fontSize: 11, color: "var(--c-muted)" }}>{label}</div>
          </div>
          {insights === null && (
            <div style={{ fontSize: 12.5, color: "var(--c-muted)" }}>signalen laden…</div>
          )}
          {insights?.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--c-muted)" }}>
              Geen opvallende veranderingen deze periode.
            </div>
          )}
          {insights?.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {insights.map((it, i) => (
                <button
                  key={i}
                  onClick={() => send(it.question)}
                  disabled={streaming}
                  title={it.detail}
                  style={{ ...signalRow, opacity: streaming ? 0.6 : 1 }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: SEV_COLOR[it.severity] || "var(--c-accent)", marginTop: 5, flex: "none" }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: 12.5 }}>{it.title}</span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--c-muted)", marginTop: 1 }}>{it.channel_label}</span>
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--c-accent)", alignSelf: "center" }}>→</span>
                </button>
              ))}
            </div>
          )}
          <div style={{ fontSize: 10.5, color: "var(--c-muted)", marginTop: 12 }}>
            Klik op een signaal en de assistent zoekt het uit.
          </div>
        </div>
      </aside>
    </div>
  );
}

const chip = { padding: "8px 13px", borderRadius: 999, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const sourceChip = { padding: "2px 8px", borderRadius: 999, border: "1px solid var(--c-border)", background: "var(--c-surface-2)", color: "var(--c-muted)", fontSize: 10.5, fontWeight: 700 };
const signalRow = { display: "flex", gap: 9, alignItems: "flex-start", padding: "9px 10px", textAlign: "left", cursor: "pointer", width: "100%", borderRadius: 10, border: "1px solid var(--c-border-soft)", background: "var(--c-surface-2)", color: "var(--c-ink)" };
const userBubble = { maxWidth: "80%", padding: "10px 14px", borderRadius: "14px 14px 4px 14px", background: "var(--c-accent)", color: "#fff", fontSize: 13.5, lineHeight: 1.5 };
const botBubble = { maxWidth: "80%", padding: "10px 14px", borderRadius: "14px 14px 14px 4px", background: "var(--c-surface)", border: "1px solid var(--c-border)", color: "var(--c-ink)", fontSize: 13.5, lineHeight: 1.55 };
const textareaStyle = { flex: 1, resize: "none", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 13.5, fontFamily: "Montserrat, sans-serif", lineHeight: 1.4, maxHeight: 160 };
