// Opslag voor assistent-gesprekken, per organisatie, in localStorage.
//
// Waarom: de chatberichten leefden als component-state in Assistant.jsx en
// verdwenen dus zodra de gebruiker naar een ander scherm navigeerde (unmount).
// Door de gesprekken hier te bewaren overleeft de chat navigatie, refresh en
// zelfs een nieuwe sessie, en krijgen we gratis een historie-overzicht.
//
// Model: één lijst met gesprekken per org (nieuwste eerst, gecapt) plus een
// pointer naar het actieve gesprek. Het actieve gesprek staat óók in de lijst;
// "nieuw gesprek" verplaatst alleen de pointer.

const MAX_CONVERSATIONS = 15;

const histKey = (orgId) => `kompas-chat-history-${orgId || "default"}`;
const activeKey = (orgId) => `kompas-chat-active-${orgId || "default"}`;

function readHistory(orgId) {
  try {
    const raw = localStorage.getItem(histKey(orgId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeHistory(orgId, list) {
  try {
    localStorage.setItem(histKey(orgId), JSON.stringify(list.slice(0, MAX_CONVERSATIONS)));
  } catch {
    // localStorage vol: oudste helft weggooien en nog één keer proberen.
    try {
      localStorage.setItem(histKey(orgId), JSON.stringify(list.slice(0, Math.ceil(MAX_CONVERSATIONS / 2))));
    } catch {
      /* dan maar niet persistent */
    }
  }
}

export function newChatId() {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Titel voor de historielijst: de eerste gebruikersvraag, ingekort.
function titleFor(messages) {
  const q = messages.find((m) => m.role === "user")?.content || "Gesprek";
  return q.length > 60 ? q.slice(0, 57) + "…" : q;
}

// Het actieve gesprek (of null als er geen is). `ts` = laatst opgeslagen, zodat
// de ChatProvider weet of een onderbroken antwoord recent genoeg is om
// automatisch te hervatten.
export function loadActiveChat(orgId) {
  const id = localStorage.getItem(activeKey(orgId));
  if (!id) return null;
  const conv = readHistory(orgId).find((c) => c.id === id);
  return conv ? { id: conv.id, messages: conv.messages, ts: conv.ts } : null;
}

// Sla het actieve gesprek op (upsert in de lijst + pointer bijwerken).
export function saveActiveChat(orgId, id, messages) {
  if (!id || !messages?.length) return;
  const rest = readHistory(orgId).filter((c) => c.id !== id);
  writeHistory(orgId, [{ id, ts: Date.now(), title: titleFor(messages), messages }, ...rest]);
  try { localStorage.setItem(activeKey(orgId), id); } catch { /* ignore */ }
}

// Historielijst (zonder berichten; nieuwste eerst).
export function listConversations(orgId) {
  return readHistory(orgId).map(({ id, ts, title, messages }) => ({ id, ts, title, count: messages?.length ?? 0 }));
}

export function loadConversation(orgId, id) {
  return readHistory(orgId).find((c) => c.id === id)?.messages ?? null;
}

export function deleteConversation(orgId, id) {
  writeHistory(orgId, readHistory(orgId).filter((c) => c.id !== id));
  if (localStorage.getItem(activeKey(orgId)) === id) localStorage.removeItem(activeKey(orgId));
}

// "Nieuw gesprek": alleen de pointer wissen; het oude gesprek blijft in de lijst.
export function clearActiveChat(orgId) {
  try { localStorage.removeItem(activeKey(orgId)); } catch { /* ignore */ }
}

export function setActiveChat(orgId, id) {
  try { localStorage.setItem(activeKey(orgId), id); } catch { /* ignore */ }
}
