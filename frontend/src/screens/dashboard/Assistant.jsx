import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.js";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDateRange } from "../../lib/PeriodProvider.jsx";
import { IcChat } from "../../components/icons.jsx";

const TOOL_LABELS = {
  list_connections: "je koppelingen",
  get_analytics_overview: "Analytics",
  get_search_console: "Search Console",
  get_google_ads: "Google Ads",
  get_meta_ads: "Meta Ads",
  get_meta_organic: "Meta organisch",
};

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

  const setLast = (txt) =>
    setMessages((ms) => {
      const c = [...ms];
      c[c.length - 1] = { role: "assistant", content: txt };
      return c;
    });

  async function send(text) {
    const question = (text ?? input).trim();
    if (!question || streaming) return;
    const history = [...messages, { role: "user", content: question }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);
    setTool(null);

    let answer = "";
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
          if (ev.type === "text") { answer += ev.text; setTool(null); setLast(answer); }
          else if (ev.type === "tool") setTool(TOOL_LABELS[ev.name] || ev.name);
          else if (ev.type === "error") { answer += (answer ? "\n\n" : "") + ev.message; setLast(answer); }
        }
      }
    } catch (e) {
      setLast(answer || `Er ging iets mis: ${e.message}`);
    } finally {
      setStreaming(false);
      setTool(null);
    }
  }

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 140px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--c-accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-accent)" }}><IcChat s={19} /></div>
        <div>
          <div className="display" style={{ fontSize: 24, lineHeight: 1 }}>assistent</div>
          <div style={{ fontSize: 12.5, color: "var(--c-muted)" }}>{label} · vraag alles over je cijfers</div>
        </div>
      </div>

      {/* messages */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
        {messages.length === 0 && insights?.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-muted)", margin: "2px 2px 10px" }}>
              opvallend deze periode
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {insights.map((it, i) => (
                <button key={i} onClick={() => send(it.question)} className="card" style={insightCard}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: SEV_COLOR[it.severity] || "var(--c-accent)", marginTop: 6, flex: "none" }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: 13.5 }}>{it.title}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--c-muted)" }}>{it.channel_label}</span>
                    </span>
                    <span style={{ display: "block", fontSize: 12.5, color: "var(--c-muted)", marginTop: 2 }}>{it.detail}</span>
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--c-accent)", whiteSpace: "nowrap", alignSelf: "center" }}>vraag →</span>
                </button>
              ))}
            </div>
          </div>
        )}

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
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={m.role === "user" ? userBubble : botBubble}>
              {m.content
                ? <span style={{ whiteSpace: "pre-wrap" }}>{m.content}</span>
                : <span style={{ color: "var(--c-muted)" }}>{tool ? `analyseert ${tool}…` : "denkt na…"}</span>}
            </div>
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
  );
}

const chip = { padding: "8px 13px", borderRadius: 999, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const insightCard = { display: "flex", gap: 11, alignItems: "flex-start", padding: "13px 15px", textAlign: "left", cursor: "pointer", width: "100%" };
const userBubble = { maxWidth: "80%", padding: "10px 14px", borderRadius: "14px 14px 4px 14px", background: "var(--c-accent)", color: "#fff", fontSize: 13.5, lineHeight: 1.5 };
const botBubble = { maxWidth: "80%", padding: "10px 14px", borderRadius: "14px 14px 14px 4px", background: "var(--c-surface)", border: "1px solid var(--c-border)", color: "var(--c-ink)", fontSize: 13.5, lineHeight: 1.55 };
const textareaStyle = { flex: 1, resize: "none", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 13.5, fontFamily: "Montserrat, sans-serif", lineHeight: 1.4, maxHeight: 160 };
