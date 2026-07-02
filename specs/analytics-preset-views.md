# Analytics — preset-views op het tabblad (view-switcher)

## Objective

Elk kanaal-tabblad krijgt **eigen, vaste preset-views** die je bovenin het tabblad
kiest via een **view-switcher** — niet op een aparte Overzicht-pagina. Dit
document beschrijft de **Analytics**-implementatie (fase 1, top-naar-beneden). De
oude samenstelbare **Overzicht-pagina wordt verwijderd**; de kanaal-tabbladen
vervangen die.

## Scope

### In scope
- Op het **Analytics-tabblad** een view-switcher met vijf views:
  **Directie-overzicht**, **Acquisitie & verkeer**, **Gedrag & content**,
  **Conversie & doelen** (doelgroepgericht) en **Realtime**.
- De vier data-views renderen tegen de bestaande overview-payload via het
  bestaande widget-systeem (`WidgetRenderer` + `TEMPLATES`); Realtime rendert de
  live-sectie (apart endpoint).
- De **Overzicht-pagina verwijderen** uit het menu en de routing; standaard-landing
  na login/onboarding wordt **Analytics**.
- De gekozen view onthouden per gebruiker (localStorage).

### Out of scope (non-goals)
- Views **bewerken/opslaan/delen** op het tabblad — deze zijn **vast** (alleen
  bekijken). Samenstelbaar per kanaal kan een latere fase zijn.
- Search Console / Google Ads / META — volgen als aparte stappen (zelfde patroon).
- Backend-wijzigingen: geen; alles draait op bestaande endpoints.
- Verwijderen van de dashboards-API/opslag in de backend (blijft ongebruikt staan;
  opruimen kan later).

## De vijf views (Analytics)

1. **Directie-overzicht** — *Directie.* KPI's (bezoekers, sessies, conversies,
   betrokkenheid) + sessies-over-tijd + kanalen.
2. **Acquisitie & verkeer** — *Marketeer.* Kanalen, bron/medium, apparaten, landen,
   nieuw-vs-terugkerend + sessies-over-tijd.
3. **Gedrag & content** — *Marketeer.* Paginaweergaven, gem. sessieduur, bounce +
   toppagina's, instappagina's, gebeurtenissen.
4. **Conversie & doelen** — *Marketeer.* Conversies, **conversieratio**, bounce +
   conversies-lijst, kanalen.
5. **Realtime** — *Live.* Actieve gebruikers nu, per-minuut, actieve pagina's.

## Requirements

- **R1.** Het Analytics-tabblad toont bovenin een **view-switcher** met de vijf
  bovenstaande views; de actieve view is duidelijk gemarkeerd en toont een
  doelgroep-/Live-label.
- **R2.** De vier data-views renderen hun widgets (uit `TEMPLATES`) via
  `WidgetRenderer` tegen de `run_ga_overview`-payload — geen extra API-calls.
- **R3.** De **Realtime**-view toont de live-gegevens (`/api/analytics/realtime`)
  en ververst elke 30s.
- **R4.** De **conversieratio**-KPI (`conversions/sessions`) bestaat als bron en
  zit in de "Conversie & doelen"-view; deling door nul → 0.
- **R5.** De gekozen view blijft behouden tussen bezoeken (localStorage).
- **R6.** De **Overzicht-pagina is weg** uit het menu en de routes; `/app` en de
  onboarding leiden naar **/app/analytics**. Bestaande links naar `/app/overview`
  bestaan niet meer.
- **R7.** Property-keuze, "live verbonden"-badge, periodekiezer en CSV-export
  blijven werken op het tabblad.
- **R8.** De frontend bouwt schoon (`npm run build`).

## Constraints

- Alleen frontend; geen backend-wijziging.
- Hergebruik het bestaande widget-systeem (`SOURCES`/`KINDS`/`WidgetRenderer`/
  `TEMPLATES`) i.p.v. een nieuw renderpad.
- Views zijn **vast** (niet bewerkbaar) — bewust, conform de gekozen aanpak.

## Edge cases

- **Property zonder bepaalde data** → de betreffende widget toont zijn lege staat;
  de view blijft staan.
- **Conversies/sessies = 0** → conversieratio 0%, geen deling-door-nul.
- **Geen realtime activiteit** → Realtime-view toont 0 / "geen actieve pagina's".
- **Geen GA-property/koppeling** → bestaande lege/koppel-staat (`TabState`).
- **Onbekende bron in een view** → `sanitizeLayout`/`WidgetRenderer` vangt dat af
  ("onbekende bron"), geen crash.

## Definition of done

1. Analytics toont een view-switcher met **Directie-overzicht, Acquisitie &
   verkeer, Gedrag & content, Conversie & doelen, Realtime**, met labels. (R1)
2. Elke data-view rendert de juiste widgets uit de overview-data. (R2, R4)
3. De Realtime-view toont live actieve gebruikers + per-minuut + pagina's. (R3)
4. De gekozen view blijft na herladen behouden. (R5)
5. **Overzicht** staat niet meer in het menu; login/onboarding komt uit op
   Analytics; er zijn geen dode `/app/overview`-links. (R6)
6. Property-keuze, live-badge, periode en CSV-export werken. (R7)
7. `npm run build` slaagt. (R8)

## Open questions

- **Overzicht-code opruimen?** De route/menu zijn weg; `Overview.jsx` en de
  dashboards-API blijven voorlopig ongebruikt staan. Opruimen kan als aparte
  schoonmaak-PR. *Aanname: later opruimen.*
- **Standaard-view** bij eerste bezoek. *Aanname: Directie-overzicht.*
