# Google Ads — preset-views op het tabblad (view-switcher)

## Objective

Het Google Ads-tabblad krijgt dezelfde vaste view-switcher als Analytics/SC, met
vier views gericht op sturen en optimaliseren. Frontend-only: alle cijfers zitten
al in de bestaande `/api/google-ads/report`-payload; afgeleiden (CPM, CPA,
aandeel-uitgaven) worden client-side berekend.

## Scope

### In scope
- View-switcher op het Ads-tabblad: **Ads-overzicht**, **Campagnes**,
  **Efficiëntie & budget**, **Conversie & ROAS**.
- Afgeleiden client-side: CPM (`kosten/vertoningen*1000`), CPA
  (`kosten/conversies`), aandeel uitgaven per campagne.
- Gekozen view onthouden (localStorage).

### Out of scope
- Conversies **per type** (vereist extra backend-breakdown) — latere uitbreiding.
- Backend-wijzigingen.

## De vier views

1. **Ads-overzicht** — *Directie.* KPI's (kosten, klikken, conversies, ROAS) +
   kosten-over-tijd.
2. **Campagnes** — *Marketeer.* Campagnetabel + aandeel uitgaven per campagne (donut).
3. **Efficiëntie & budget** — *Marketeer.* KPI's CTR, CPC, CPM, CPA + campagnes
   gerangschikt op uitgaven met conversies/CPA (verspilling opsporen).
4. **Conversie & ROAS** — *Marketeer/Directie.* KPI's conversies, conversiewaarde,
   ROAS + ROAS per campagne.

## Requirements

- **R1.** View-switcher met de vier views + doelgroep-label; actieve view gemarkeerd.
- **R2.** Ads-overzicht: KPI's (met vergelijking) + kosten-trend.
- **R3.** Campagnes: campagnetabel + donut met aandeel uitgaven (top campagnes).
- **R4.** Efficiëntie: CTR, CPC, **CPM**, **CPA** getoond; campagnetabel met CPA.
- **R5.** Conversie & ROAS: conversies, conversiewaarde, ROAS + ROAS per campagne.
- **R6.** Account-keuze, periode, vergelijking en CSV-export blijven werken.
- **R7.** Gekozen view onthouden; lege staten netjes; `npm run build` slaagt.

## Edge cases

- **Geen conversies** → CPA/ROAS tonen 0/—, geen deling-door-nul.
- **Geen campagnes** → tabellen/donut tonen lege staat.
- **Geen account gekoppeld / geen data** → bestaande lege/koppel-staat.

## Definition of done

1. Ads-tabblad heeft de vier views met labels. (R1)
2. Elke view toont de juiste cijfers; CPM/CPA/aandeel client-side afgeleid. (R2–R5)
3. Account-keuze, periode, export werken; view blijft behouden. (R6, R7)
4. `npm run build` slaagt. (R7)
