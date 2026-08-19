# AI-assistent ("Kompas Assistent") — chat in de sidebar

## Objective

Een chat-item in de sidebar waar de gebruiker in gewone taal vragen stelt over de
data van de actieve klant. De assistent haalt via **echte dashboarddata** de cijfers
op (geen verzonnen getallen), analyseert die en geeft concreet advies met de cijfers
en periode erbij. Multi-tenant: de assistent ziet uitsluitend data van de actieve org.

## Gekozen uitgangspunten (beslist met de gebruiker)

- **Model:** `claude-sonnet-5`.
- **Privacy:** klantcijfers gaan naar de Claude-API met standaard (30-dagen) retentie —
  akkoord, direct bouwen. (Zero-data-retention is een latere optie, geen blokker.)
- **MVP-scope kanalen:** **Analytics + Search Console**. Google Ads en META zijn fase 2.
- **Historie:** gesprek leeft alleen in het scherm (per sessie). Geen database, geen
  opslag van gesprekken.

## Architectuur — tool-use agent

De assistent krijgt *tools* en beslist zelf welke data het ophaalt. De tools zijn dunne
wrappers om bestaande datafuncties; ze draaien gescoped op de actieve org + periode.

### Tools (MVP)
1. `list_connections` — welke kanalen zijn gekoppeld voor deze org (via `models.get_connection`),
   zodat de assistent weet wat beschikbaar is.
2. `get_analytics_overview` — GA4-overzicht via `analytics.run_ga_overview` (kerncijfers,
   verdelingen, tijdreeks) voor de actieve property + periode.
3. `get_search_console` — SEO-data via `search_console.run_search_analytics` (totalen,
   top-queries/pagina's, kansen, apparaten/landen) voor de actieve site + periode.

Elke tool die Google-data ophaalt loopt via de bestaande `_google_data`-afhandeling, zodat
een verlopen koppeling netjes als "opnieuw koppelen" terugkomt i.p.v. een crash.

## Scope

### In scope
- **Backend `app/assistant.py`:** tool-definities (JSON-schema), tool-executor
  (toolnaam → bestaande functie, gescoped op `org_id`, `start`, `end`), en de agent-loop
  met de Anthropic SDK (streaming).
- **`app/main.py`:** endpoint `POST /api/assistant/chat` dat `{messages, org_id?, start, end}`
  ontvangt, de org resolvet via `_resolve_org_id`, en het antwoord **streamt** (SSE /
  `StreamingResponse`).
- **`app/config.py`:** `ANTHROPIC_API_KEY` uit env inlezen.
- **`requirements.txt`:** `anthropic` toevoegen.
- **Frontend:** sidebar-item **"Assistent"**, route `/app/assistant`, scherm
  `Assistant.jsx` met chat-UI die de stream live rendert.
- **System-prompt** (Nederlands, wit-label marketinganalist).

### Out of scope (MVP)
- Google Ads- en META-tools (fase 2).
- Gesprekken opslaan / terugkijken (database).
- Proactieve inzichten / notificaties.
- Rapport-export vanuit de chat.

## Backend-details

### Model & parameters
- Model: `claude-sonnet-5`.
- Adaptive thinking: `thinking={"type": "adaptive"}`.
- `output_config={"effort": "medium"}`.
- **Streaming verplicht** (tool-loops + mogelijk lange output) — gebruik de SDK-stream en
  `get_final_message()` in de agent-loop.
- **Prompt caching** op de (vaste) system-prompt (`cache_control: ephemeral`) zodat
  vervolgvragen goedkoper zijn. System-prompt bevat géén per-request variabelen
  (datum/periode gaan als tool-argumenten of in de user-turn, niet in de system-prompt).

### Endpoint-gedrag
- `POST /api/assistant/chat`, ingelogd vereist (zoals andere endpoints).
- Body: `messages` (historie: rollen user/assistant), optioneel `org_id` (admins),
  `start`, `end` (periode).
- Org bepalen met `_resolve_org_id` (clients vast op eigen org).
- Agent-loop: stuur naar Sonnet 5 met de tools; zolang `stop_reason == "tool_use"` de tools
  uitvoeren (gescoped op de org/periode) en resultaten terugsturen; eindtekst streamen naar
  de client als SSE-tokens.
- Fouten: een 409 uit een tool (koppeling verlopen/ontbreekt) wordt als toolresultaat
  teruggegeven met een duidelijke tekst ("Search Console is niet gekoppeld voor deze klant"),
  zodat de assistent dat netjes kan uitleggen i.p.v. de stream te laten crashen.

### System-prompt (kern)
- Rol: de marketinganalist binnen dit dashboard.
- Taal: Nederlands, gewone taal, geen jargon/technische termen.
- Gedrag: **altijd eerst de tools gebruiken** om echte cijfers op te halen voordat je iets
  beweert; verzin nooit getallen. Noem concrete cijfers + de periode. Eindig met 1–3
  concrete acties.
- Grenzen: je ziet alleen data van de huidige klant; wit-label (geen leveranciersnamen
  tenzij relevant).

## Frontend-details

- **`Sidebar.jsx`:** nieuw nav-item "Assistent" met een chat-icoon (nieuw `IcChat` in
  `icons.jsx`).
- **`App.jsx`:** route `path="assistant"` → `Assistant.jsx`.
- **`Assistant.jsx`:**
  - Berichtenlijst (user rechts, assistent links) + invoerveld + verstuurknop.
  - Leest de SSE-stream en rendert tokens live; toont een subtiele "analyseert…"-indicator
    terwijl de assistent tools aanroept.
  - Stuurt de volledige historie mee (stateless backend) plus de actieve periode
    (`useDateRange`) en org (`useActiveOrg`).
  - Lege staat: 3–4 klikbare voorbeeldvragen ("Hoe presteert mijn verkeer deze maand?",
    "Geef me 3 SEO-quick-wins", "Welke pagina's kan ik verbeteren?").
  - Respecteert het bestaande design (kaarten, kleuren, mobiel-responsive).

## Buiten de code (handmatige stap voor de gebruiker)
- **`ANTHROPIC_API_KEY`** als Cloud Run env var zetten (zoals de andere secrets) vóór de
  eerste echte deploy waarin de assistent aanstaat. Zonder de key geeft het endpoint een
  nette foutmelding.

## Definition of done
- Er is een sidebar-item "Assistent" dat naar `/app/assistant` leidt.
- Een vraag als "Hoe presteert mijn verkeer deze maand?" levert een Nederlands antwoord met
  **echte cijfers** uit Analytics van de actieve klant, live gestreamd, eindigend met
  concrete acties.
- Een SEO-vraag ("waar liggen quick wins?") gebruikt Search Console-data (kansen/CTR).
- Wisselen van klant (admin) laat de assistent alleen de data van die klant zien.
- Een niet-gekoppeld kanaal geeft een nette uitleg, geen crash.
- Backend compileert; frontend bouwt schoon.
- `claude-sonnet-5` wordt gebruikt; de system-prompt wordt gecachet (verifieerbaar via
  `usage.cache_read_input_tokens > 0` bij een tweede vraag).
