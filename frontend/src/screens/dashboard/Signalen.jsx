import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../../lib/api.js";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDateRange } from "../../lib/PeriodProvider.jsx";
import {
  IcBars, IcChat, GaGlyph, GscGlyph, AdsGlyph, MetaGlyph, WooGlyph,
} from "../../components/icons.jsx";

// Signalen: proactieve, regelgebaseerde observaties per kanaal plus cross-kanaal
// verbanden (blended ROAS, uitgaven vs. conversies, verkeersverdeling). Per
// signaal vraag je in één klik AI-advies dat inline uitklapt; bovenaan vat de
// assistent alles samen en prioriteert hij de acties. Dezelfde data voedt de
// notificatiebel in de topbar.

const SEV_COLOR = { positive: "var(--c-pos)", negative: "var(--c-neg)", neutral: "var(--c-accent)" };
const SEV_LABEL = { positive: "kans", negative: "let op", neutral: "info" };

// Kanaal-icoon per `channel`-key uit de backend. 'cross' = alle kanalen samen.
const CHANNEL_ICON = {
  cross: IcBars,
  analytics: GaGlyph,
  search_console: GscGlyph,
  google_ads: AdsGlyph,
  meta_ads: MetaGlyph,
  woocommerce: WooGlyph,
};
// Volgorde van de groepen: de cross-kanaal-signalen eerst, dan de losse kanalen.
const CHANNEL_ORDER = ["cross", "analytics", "google_ads", "meta_ads", "search_console", "woocommerce"];

const SUMMARY_KEY = "__summary__";
const SUMMARY_Q =
  "Vat de belangrijkste signalen van deze periode samen en geef me de 2 tot 3 acties die ik als eerste zou moeten oppakken. Noem per actie kort waarom, op basis van de cijfers.";

// Groepeer de platte signalenlijst op kanaal, in een vaste, logische volgorde.
function groupByChannel(items) {
  const groups = {};
  for (const it of items) {
    const key = it.channel || "cross";
    (groups[key] ||= { channel: key, label: it.channel_label || "Signalen", items: [] }).items.push(it);
  }
  return CHANNEL_ORDER.filter((k) => groups[k]).map((k) => groups[k])
    .concat(Object.keys(groups).filter((k) => !CHANNEL_ORDER.includes(k)).map((k) => groups[k]));
}

export default function Signalen() {
  const nav = useNavigate();
  const { orgId } = useActiveOrg();
  const { start, end, label } = useDateRange();
  const [signals, setSignals] = useState(null);
  const [error, setError] = useState(null);

  // Advies per signaal: { [key]: { text, streaming, done, error } }. Eén stream
  // tegelijk; een nieuwe start breekt de vorige af.
  const [advice, setAdvice] = useState({});
  const abortRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setSignals(null);
    setError(null);
    setAdvice({});
    abortRef.current?.abort();
    const q = new URLSearchParams({ start, end });
    if (orgId) q.set("org_id", orgId);
    const prop = localStorage.getItem("kompas-property");
    if (prop) q.set("property_id", prop);
    const site = localStorage.getItem("kompas-gsc-site");
    if (site) q.set("site", site);
    api("/api/insights?" + q.toString())
      .then((d) => { if (alive) setSignals(d.insights || []); })
      .catch((e) => { if (alive) setError(e); });
    return () => { alive = false; abortRef.current?.abort(); };
  }, [orgId, start, end]);

  const patch = (key, p) => setAdvice((a) => ({ ...a, [key]: { ...(a[key] || {}), ...p } }));

  // Stream een advies-antwoord van de assistent inline (zelfde SSE-endpoint als
  // de chat, maar zonder het gesprek te bewaren). Eén vraag = één losstaand
  // bericht; tools en Markdown werken identiek aan de chat.
  async function runAdvice(key, question) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    patch(key, { text: "", streaming: true, done: false, error: null });
    let answer = "";
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        credentials: "include",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: question }],
          org_id: orgId || undefined,
          start, end,
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
          if (ev.type === "text") { answer += ev.text; patch(key, { text: answer }); }
          else if (ev.type === "error") { answer += (answer ? "\n\n" : "") + ev.message; patch(key, { text: answer }); }
        }
      }
      patch(key, { streaming: false, done: true, text: answer || "Ik kreeg geen antwoord terug. Probeer het zo nog eens." });
    } catch (e) {
      if (e?.name === "AbortError") { patch(key, { streaming: false }); return; }
      patch(key, { streaming: false, done: true, error: e, text: answer });
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }

  // Doorvragen in de volwaardige chat (met historie): geef de vraag mee via de
  // bestaande sessionStorage-brug die het Assistent-scherm oppikt.
  const openInChat = (question) => {
    sessionStorage.setItem("kompas-ask", question);
    nav("/app/assistant");
  };

  const groups = signals ? groupByChannel(signals) : [];
  const summary = advice[SUMMARY_KEY];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <div className="display" style={{ fontSize: 30 }}>signalen</div>
          <div style={{ fontSize: 13.5, color: "var(--c-muted)", marginTop: 4, maxWidth: 620 }}>
            Opvallende veranderingen en verbanden in je cijfers voor {label || "de gekozen periode"}. Vraag per signaal om advies, of laat de assistent alles samenvatten en prioriteren.
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: 20, color: "var(--c-neg)" }}>
          Kon de signalen niet laden: {String(error.message || error)}
        </div>
      )}

      {!error && signals === null && (
        <div style={{ display: "grid", placeItems: "center", padding: 60 }}><div className="spin" /></div>
      )}

      {!error && signals && (
        <>
          {/* Samenvatten en prioriteren over alle signalen heen. */}
          <div className="card" style={{ padding: 18, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontWeight: 800, fontSize: 15 }}>Wat moet ik als eerste oppakken?</div>
                <div style={{ fontSize: 12.5, color: "var(--c-muted)", marginTop: 2 }}>
                  {signals.length ? `${signals.length} ${signals.length === 1 ? "signaal" : "signalen"} deze periode.` : "Geen opvallende signalen deze periode."} De assistent weegt ze en geeft je de belangrijkste acties.
                </div>
              </div>
              <button className="btn-primary" style={{ height: 40, padding: "0 16px", fontSize: 13 }}
                disabled={summary?.streaming}
                onClick={() => runAdvice(SUMMARY_KEY, SUMMARY_Q)}>
                {summary?.streaming ? "Bezig…" : summary?.done ? "Opnieuw samenvatten" : "Vat samen en prioriteer"}
              </button>
            </div>
            {summary && (summary.text || summary.streaming || summary.error) && (
              <div style={adviceBox}>
                {summary.streaming && !summary.text
                  ? <span style={{ color: "var(--c-muted)", fontSize: 13 }}>De assistent bekijkt je cijfers…</span>
                  : summary.text
                    ? <Answer text={summary.text} />
                    : <span style={{ color: "var(--c-neg)", fontSize: 13 }}>{String(summary.error?.message || "Kon geen advies ophalen.")}</span>}
              </div>
            )}
          </div>

          {signals.length === 0 && (
            <div className="card" style={{ padding: 28, textAlign: "center", color: "var(--c-muted)" }}>
              Er zijn deze periode geen opvallende veranderingen gevonden. Probeer een langere periode of kom later terug.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {groups.map((g) => {
              const Icon = CHANNEL_ICON[g.channel] || IcBars;
              return (
                <div key={g.channel} className="card" style={{ overflow: "hidden" }}>
                  <div style={groupHead}>
                    <span style={{ display: "flex", color: g.channel === "cross" ? "var(--c-accent)" : "var(--c-ink-soft)" }}><Icon s={17} /></span>
                    <span style={{ fontWeight: 800, fontSize: 14 }}>{g.label}</span>
                    <span style={{ fontSize: 12, color: "var(--c-muted)" }}>{g.items.length}</span>
                  </div>
                  {g.items.map((it, i) => {
                    const key = `${g.channel}:${i}:${it.title}`;
                    const adv = advice[key];
                    return (
                      <div key={key} style={{ padding: "14px 18px", borderTop: "1px solid var(--c-border-soft)" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                          <span style={{ width: 9, height: 9, borderRadius: "50%", background: SEV_COLOR[it.severity] || "var(--c-accent)", marginTop: 5, flex: "none" }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 700, fontSize: 14 }}>{it.title}</span>
                              <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: SEV_COLOR[it.severity] || "var(--c-accent)" }}>
                                {SEV_LABEL[it.severity] || "info"}
                              </span>
                            </div>
                            <div style={{ fontSize: 13, color: "var(--c-muted)", marginTop: 3, lineHeight: 1.5 }}>{it.detail}</div>
                          </div>
                          <div style={{ display: "flex", gap: 6, flex: "none" }}>
                            <button className="btn-ghost" style={{ height: 32, padding: "0 12px", fontSize: 12.5 }}
                              disabled={adv?.streaming}
                              onClick={() => runAdvice(key, it.question)}>
                              {adv?.streaming ? "Bezig…" : adv?.done ? "Opnieuw" : "Vraag advies"}
                            </button>
                            <button className="btn-ghost icon-btn" title="Doorvragen in de chat" aria-label="Doorvragen in de chat"
                              style={{ height: 32, width: 34, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                              onClick={() => openInChat(it.question)}>
                              <IcChat s={15} />
                            </button>
                          </div>
                        </div>
                        {adv && (adv.text || adv.streaming || adv.error) && (
                          <div style={{ ...adviceBox, marginLeft: 21 }}>
                            {adv.streaming && !adv.text
                              ? <span style={{ color: "var(--c-muted)", fontSize: 13 }}>De assistent bekijkt je cijfers…</span>
                              : adv.text
                                ? <Answer text={adv.text} />
                                : <span style={{ color: "var(--c-neg)", fontSize: 13 }}>{String(adv.error?.message || "Kon geen advies ophalen.")}</span>}
                            {adv.done && adv.text && (
                              <button className="btn-ghost" style={{ height: 30, padding: "0 11px", fontSize: 12, marginTop: 8 }}
                                onClick={() => openInChat(it.question)}>
                                Verder praten in de chat →
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// Antwoord als Markdown (GFM), zelfde compacte weergave als het Assistent-scherm.
function Answer({ text }) {
  return (
    <div className="assistant-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

const groupHead = { display: "flex", alignItems: "center", gap: 10, padding: "13px 18px", background: "var(--c-surface-2)" };
const adviceBox = { marginTop: 12, padding: "12px 14px", borderRadius: 11, background: "var(--c-surface-2)", border: "1px solid var(--c-border-soft)" };
