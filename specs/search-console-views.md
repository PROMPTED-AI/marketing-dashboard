# Search Console — preset-views op het tabblad (view-switcher)

## Objective

Het Search Console-tabblad krijgt dezelfde **vaste view-switcher** als Analytics,
met vier SEO-views. Nieuw t.o.v. de andere kanalen is de **Kansen**-view: die zet
ruwe SC-data om in een concrete optimalisatielijst.

## Scope

### In scope
- View-switcher op het SC-tabblad met vier views: **SEO-overzicht**,
  **Zoekopdrachten**, **Pagina's**, **Kansen (quick wins)**.
- Backend-uitbreiding in `run_search_analytics`: naast top-queries ook
  **opportunities** (queries op positie ~11–20, veel impressies) en
  **by_impressions** (queries met de meeste impressies, om lage CTR te spotten).
- Gekozen view onthouden (localStorage).

### Out of scope
- Views bewerken/opslaan (vast, zoals Analytics).
- Andere kanalen (Ads/META) — aparte stappen.

## De vier views

1. **SEO-overzicht** — *Directie/Marketeer.* KPI's (klikken, vertoningen, CTR,
   gem. positie) + klikken-over-tijd.
2. **Zoekopdrachten** — *SEO-specialist.* Top-zoekopdrachten (klikken, vertoningen,
   CTR, positie).
3. **Pagina's** — *SEO-specialist.* Top-pagina's (klikken, vertoningen, CTR, positie).
4. **Kansen (quick wins)** — *SEO-specialist.* Zoekopdrachten op **positie 11–20**
   met veel impressies (bijna pagina 1) + queries met veel impressies & lage CTR.

## Requirements

- **R1.** Het SC-tabblad toont een view-switcher met de vier views; actieve view
  gemarkeerd + label.
- **R2.** `run_search_analytics` levert extra: `opportunities` (positie tussen 10
  en 20, gesorteerd op impressies, top 10) en `by_impressions` (top 10 queries op
  impressies), elk met query, clicks, impressions, ctr, position.
- **R3.** De **Kansen**-view toont beide lijsten met een korte uitleg wat de
  gebruiker ermee kan.
- **R4.** SEO-overzicht toont de vier KPI's (met vergelijking) + klikken-trend.
- **R5.** Zoekopdrachten en Pagina's tonen de bestaande top-lijsten.
- **R6.** Site-keuze, periodekiezer, vergelijking en CSV-export blijven werken.
- **R7.** Gekozen view blijft behouden (localStorage).
- **R8.** Frontend bouwt schoon; alles defensief (lege staten, geen 500).

## Constraints

- Opportunities/by_impressions worden afgeleid uit één ruimere query-fetch
  (GSC sorteert op klikken; we halen een grotere set op en sorteren zelf op
  impressies). Dit is een benadering — bij zeer grote sites kan een query buiten
  de opgehaalde set vallen; acceptabel voor v1.
- Alleen `app/search_console.py` (backend) + `SearchConsole.jsx` (frontend).

## Edge cases

- **Geen queries in de periode** → lege lijsten, nette lege staat.
- **Geen queries op positie 11–20** → Kansen-view toont "geen directe kansen".
- **Site zonder data / geen koppeling** → bestaande lege/koppel-staat.

## Definition of done

1. SC-tabblad heeft een view-switcher met de vier views + labels. (R1)
2. Kansen-view toont opportunities (positie 11–20) en high-impression/lage-CTR. (R2, R3)
3. SEO-overzicht toont KPI's + trend; Zoekopdrachten/Pagina's tonen de lijsten. (R4, R5)
4. Site-keuze, periode, vergelijking en export werken; view blijft behouden. (R6, R7)
5. `npm run build` slaagt; lege staten netjes. (R8)
