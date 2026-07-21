// App-brede chat-state voor de AI-assistent.
//
// Waarom een provider: de streaming-fetch leefde in het Assistent-scherm zelf.
// Navigeerde de gebruiker weg, dan unmountte het scherm en gingen de
// stream-updates verloren; verliet hij de browser, dan stierf de verbinding
// ("Load failed") en kwam er nooit meer een antwoord. Hier leeft de stream op
// app-niveau: binnen de app navigeren laat de assistent gewoon doorwerken, en
// een écht verbroken verbinding (tab dicht, mobiel op slot) wordt bij
// terugkomst gedetecteerd en automatisch hervat (of via een retry-knop).

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useActiveOrg } from "./ActiveOrgProvider.jsx";
import { useDateRange } from "./PeriodProvider.jsx";
import {
  newChatId, loadActiveChat, saveActiveChat, listConversations,
  loadConversation, deleteConversation, clearActiveChat, setActiveChat,
} from "./chatStore.js";

export const TOOL_LABELS = {
  list_connections: "je koppelingen",
  get_marketing_overview: "Alle kanalen",
  get_insights: "Signalen",
  get_analytics_overview: "Analytics",
  get_search_console: "Search Console",
  get_google_ads: "Google Ads",
  get_meta_ads: "Meta Ads",
  get_meta_organic: "Meta organisch",
  get_woocommerce: "WooCommerce",
};

// Vervolgvraag-suggesties per gebruikte bron: na elk antwoord maximaal drie
// chips waarmee de gebruiker in één klik doorvraagt.
const FOLLOWUPS = {
  "Alle kanalen": ["Waar kan ik besparen op mijn advertenties?", "Welk kanaal groeit het hardst?"],
  "Signalen": ["Leg het belangrijkste signaal verder uit"],
  "Analytics": ["Welke pagina's presteren het best?", "Waar komt mijn verkeer vandaan?"],
  "Search Console": ["Welke zoekwoorden zijn quick wins?", "Op welke zoekwoorden daal ik?"],
  "Google Ads": ["Welke campagne presteert het slechtst?", "Wat zijn mijn kosten per conversie?"],
  "Meta Ads": ["Wat leveren mijn Meta-campagnes op vergeleken met Google Ads?"],
  "Meta organisch": ["Welke posts deden het het best?"],
  "WooCommerce": ["Wat zijn mijn best verkochte producten?", "Hoe ontwikkelt mijn omzet zich?"],
};

function suggestFor(sources) {
  const out = [];
  for (const s of sources) for (const q of FOLLOWUPS[s] || []) if (!out.includes(q)) out.push(q);
  out.push("Vergelijk dit met de vorige periode");
  return out.slice(0, 3);
}

// Een onderbroken gesprek wordt alleen automatisch hervat als het zo recent is
// dat de gebruiker er duidelijk nog mee bezig was.
const RESUME_WINDOW_MS = 15 * 60 * 1000;

const isNetworkError = (e) =>
  e?.name === "TypeError" || /load failed|failed to fetch|network/i.test(String(e?.message || ""));

const Ctx = createContext(null);

export function ChatProvider({ children }) {
  const { orgId } = useActiveOrg();
  const { start, end } = useDateRange();
  const [messages, setMessages] = useState([]);
  const [convId, setConvId] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const [tool, setTool] = useState(null);
  const [pending, setPending] = useState(null); // { q, reuse } wachtend op verzenden

  const abortRef = useRef(null);
  const resumedRef = useRef(null); // convId waarvoor deze sessie al auto-hervat is
  const streamingRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const convIdRef = useRef(convId);
  convIdRef.current = convId;
  const periodRef = useRef({ start, end });
  periodRef.current = { start, end };
  const orgRef = useRef(orgId);
  orgRef.current = orgId;

  const setStreamingBoth = (v) => { streamingRef.current = v; setStreaming(v); };

  const updateLast = (patch) =>
    setMessages((ms) => {
      const c = [...ms];
      c[c.length - 1] = { ...(c[c.length - 1] || {}), role: "assistant", ...patch };
      return c;
    });

  // Herstel het actieve gesprek bij openen of klantwissel. Detecteer een
  // onderbroken antwoord (laatste bericht is een vraag, of een antwoord dat
  // nooit is afgerond): recent onderbroken wordt automatisch hervat, ouder
  // krijgt een "Opnieuw proberen"-knop.
  useEffect(() => {
    abortRef.current?.abort(); // klantwissel: lopende stream hoort bij de vorige klant
    const conv = loadActiveChat(orgId);
    let msgs = conv?.messages ?? [];
    if (msgs.length && msgs[msgs.length - 1].role === "assistant" && !msgs[msgs.length - 1].content) {
      msgs = msgs.slice(0, -1);
    }
    let resume = null;
    const last = msgs[msgs.length - 1];
    const interrupted = last && (last.role === "user" || (last.role === "assistant" && !last.done && !last.retry));
    if (interrupted) {
      const lastQ = [...msgs].reverse().find((m) => m.role === "user")?.content;
      const fresh = conv?.ts && Date.now() - conv.ts < RESUME_WINDOW_MS;
      if (lastQ && fresh && resumedRef.current !== conv.id) {
        if (last.role === "assistant") msgs = msgs.slice(0, -1); // deelantwoord vervangen
        resumedRef.current = conv.id;
        resume = { q: lastQ, reuse: true };
      } else if (lastQ) {
        const note = "Dit antwoord werd onderbroken.";
        msgs = last.role === "assistant"
          ? [...msgs.slice(0, -1), { ...last, done: true, retry: lastQ }]
          : [...msgs, { role: "assistant", content: note, done: true, retry: lastQ }];
      }
    }
    setMessages(msgs);
    setConvId(conv?.id ?? null);
    setTool(null);
    // Via de notificatiebel gekozen signaal gaat vóór hervatten.
    const q = sessionStorage.getItem("kompas-ask");
    if (q) { sessionStorage.removeItem("kompas-ask"); resume = { q, reuse: false }; }
    if (resume) setPending(resume);
  }, [orgId]);

  // Bewaar het lopende gesprek bij elke wijziging (ook tijdens streamen).
  useEffect(() => {
    if (convId && messages.length) saveActiveChat(orgId, convId, messages);
  }, [orgId, convId, messages]);

  // Uitgesteld verzenden (auto-hervatten, bel-signaal): na de herstel-render.
  useEffect(() => {
    if (pending && !streaming) {
      const p = pending;
      setPending(null);
      ask(p.q, { reuseLastUser: p.reuse });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, streaming]);

  async function ask(text, { reuseLastUser = false } = {}) {
    const question = (text ?? "").trim();
    if (!question || streamingRef.current) return;
    let id = convIdRef.current;
    if (!id) {
      id = newChatId();
      setConvId(id);
      setActiveChat(orgRef.current, id);
    }
    const base = messagesRef.current;
    const history = reuseLastUser && base[base.length - 1]?.role === "user"
      ? [...base]
      : [...base, { role: "user", content: question }];
    setMessages([...history, { role: "assistant", content: "", sources: [] }]);
    setStreamingBoth(true);
    setTool(null);

    let answer = "";
    const sources = [];
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const { start: pStart, end: pEnd } = periodRef.current;
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        credentials: "include",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          org_id: orgRef.current || undefined,
          start: pStart,
          end: pEnd,
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
      // Vangnet: stream klaar maar geen tekst ontvangen.
      if (!answer) {
        updateLast({ content: "Ik kreeg geen antwoord terug van het taalmodel. Stel je vraag nog een keer, eventueel iets anders geformuleerd.", done: true });
      } else {
        updateLast({ suggestions: suggestFor(sources), done: true });
      }
    } catch (e) {
      if (e?.name === "AbortError") {
        updateLast({ content: answer ? answer + "\n\n*(gestopt)*" : "*(gestopt)*", done: true });
      } else if (isNetworkError(e)) {
        // Verbinding weggevallen (tab dicht, mobiel op slot, netwerk weg):
        // vriendelijke melding met retry in plaats van een kale foutmelding.
        updateLast({
          content: answer
            ? answer + "\n\n*De verbinding werd onderbroken; het antwoord is mogelijk niet compleet.*"
            : "De verbinding werd onderbroken voordat het antwoord binnen was.",
          retry: question,
          done: true,
        });
      } else {
        updateLast({ content: answer || `Er ging iets mis: ${e.message}`, retry: answer ? undefined : question, done: true });
      }
    } finally {
      abortRef.current = null;
      setStreamingBoth(false);
      setTool(null);
    }
  }

  const send = (q) => ask(q);
  const stop = () => abortRef.current?.abort();

  // Opnieuw proberen: vervang het mislukte antwoord door een nieuwe poging op
  // dezelfde vraag (zonder de vraag te dupliceren in het gesprek).
  const retry = (q) => {
    if (streamingRef.current) return;
    setMessages((ms) => (ms[ms.length - 1]?.role === "assistant" ? ms.slice(0, -1) : ms));
    setPending({ q, reuse: true });
  };

  const newChat = () => {
    if (streamingRef.current) return;
    clearActiveChat(orgRef.current);
    setMessages([]);
    setConvId(null);
  };

  const openConversation = (id) => {
    if (streamingRef.current || id === convIdRef.current) return;
    const msgs = loadConversation(orgRef.current, id);
    if (!msgs) return;
    setMessages(msgs);
    setConvId(id);
    setActiveChat(orgRef.current, id);
  };

  const removeConversation = (id) => {
    deleteConversation(orgRef.current, id);
    if (id === convIdRef.current) { setMessages([]); setConvId(null); }
  };

  const listHistory = () => listConversations(orgId);

  const value = {
    messages, streaming, tool, convId,
    send, stop, retry, newChat, openConversation, removeConversation, listHistory,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChat() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChat vereist een ChatProvider");
  return ctx;
}
