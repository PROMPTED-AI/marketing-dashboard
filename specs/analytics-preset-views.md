# Analytics — preset-views (doelgroepgericht)

## Objective

Analytics krijgt een set **kant-en-klare, doelgroepgerichte preset-views** zodat
een gebruiker met één klik een passend dashboard opent, zonder zelf widgets samen
te stellen. Dit vervangt de huidige generieke start-templates door vier
doelgroep-views (Directie / Marketeer) en voegt één afgeleide metric toe
(conversieratio). Fase 1 uit `docs/view-templates-voorstel.md`, alleen Analytics.

## Scope

### In scope
- De `TEMPLATES` in `frontend/src/lib/widgetCatalog.js` herzien naar de vier
  preset-views hieronder, elk met een **doelgroep-label**.
- Eén nieuwe afgeleide bron **conversieratio** (`conversions / sessions`).
- De keuze-UI (TemplatePicker) toont naam + doelgroep + korte omschrijving.

### Out of scope (non-goals)
- **Realtime** als samenstelbare template — realtime komt uit een apart endpoint
  (`/api/analytics/realtime`) en blijft de bestaande live-sectie op het
  Analytics-scherm.
- Samenstelbaar maken van andere kanalen (SC/Ads/META) — latere fase.
- Nieuwe backend/API-calls: alle widgets renderen tegen de bestaande
  overview-payload (`run_ga_overview`).
- Wijzigingen aan het opslaan/delen/herordenen van dashboards (blijft werken zoals nu).

## De vier preset-views

1. **Directie-overzicht** — *Directie.* KPI's: bezoekers, sessies, conversies,
   betrokkenheid; + sessies-over-tijd (area); + kanalen (donut).
2. **Acquisitie & verkeer** — *Marketeer.* KPI's: sessies, bezoekers; +
   kanalen (donut), bron/medium (bars), apparaten (bars), landen (bars),
   nieuw-vs-terugkerend (donut); + sessies-over-tijd (area).
3. **Gedrag & content** — *Marketeer.* KPI's: paginaweergaven, gem. sessieduur,
   bouncepercentage; + toppagina's (tabel), instappagina's (tabel),
   gebeurtenissen (bars).
4. **Conversie & doelen** — *Marketeer.* KPI's: conversies (filterbaar op key
   event), **conversieratio**, bouncepercentage; + conversies-lijst (tabel),
   kanalen (donut).

## Requirements

- **R1.** `frontend/src/lib/widgetCatalog.js` bevat exact deze vier templates, met
  de widgets zoals hierboven, opgebouwd uit bestaande `SOURCES`/`KINDS`.
- **R2.** Er is een nieuwe scalar-bron **`conversion_rate`** (label
  "Conversieratio", groep `scalar`, kind `kpi`, formaat percentage) die
  `conversions / sessions * 100` berekent uit de overview-payload; deelt door nul
  → 0, geen fout.
- **R3.** `conversion_rate` is beschikbaar in de widget-keuze (SOURCE_GROUPS,
  Kerncijfers) zodat hij ook los toe te voegen is.
- **R4.** Elke template heeft een **doelgroep-label** (Directie/Marketeer) dat
  zichtbaar is in de TemplatePicker naast naam + omschrijving.
- **R5.** Bestaande, al opgeslagen dashboards blijven ongewijzigd werken;
  `sanitizeLayout` en de opslag/deel-functionaliteit veranderen niet.
- **R6.** De frontend bouwt schoon (`npm run build`).

## Constraints

- Alleen frontend (`widgetCatalog.js`, evt. TemplatePicker); geen backend-wijziging.
- Widgets renderen tegen de bestaande `run_ga_overview`-payload — geen extra
  API-calls per widget.
- Volg de bestaande conventies van het widget-systeem (id's, `newId()`,
  `instantiateTemplate`, `sanitizeLayout`).

## Edge cases

- **Conversies of sessies = 0** → conversieratio toont 0%, geen deling-door-nul.
- **Property zonder bepaalde data** (bv. geen events) → de betreffende widget
  toont de bestaande lege staat ("geen data in deze periode"), view blijft staan.
- **Oud opgeslagen dashboard met verwijderde/oude template-namen** → blijft
  werken; templates zijn slechts startpunten, geen referentie in opgeslagen layouts.
- **Onbekende bron in een opgeslagen layout** → `sanitizeLayout` filtert die er al uit.

## Definition of done

1. De TemplatePicker toont vier views: **Directie-overzicht, Acquisitie & verkeer,
   Gedrag & content, Conversie & doelen**, elk met een doelgroep-label. (R1, R4)
2. Elke view opent met de gespecificeerde widgets, gevuld uit de overview-data. (R1)
3. De KPI **Conversieratio** toont `conversies/sessies` als percentage en is ook
   los toe te voegen via "widget toevoegen". (R2, R3)
4. Een bestaand opgeslagen dashboard opent nog steeds correct. (R5)
5. `npm run build` slaagt. (R6)
6. Realtime blijft ongewijzigd als live-sectie op het Analytics-scherm. (scope)

## Open questions

- **"Alles (volledig)"-template** behouden als vijfde optie of laten vallen ten
  gunste van de vier gerichte views? *Aanname: behouden als extra.*
- Exacte volgorde/labels van de doelgroepen in de UI (Directie/Marketeer) —
  puur cosmetisch, makkelijk aan te passen.
