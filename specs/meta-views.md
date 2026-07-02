# META — preset-views op het tabblad (view-switcher)

## Objective

Het META/social-tabblad krijgt dezelfde vaste view-switcher als de andere
kanalen. Het tabblad was al gesplitst betaald/organisch; dit zet die splitsing om
in aparte views. Frontend-only: alle cijfers zitten al in de bestaande
`/api/meta/ads-report` en `/api/meta/organic-report`-payloads.

## Scope

### In scope
- View-switcher met vijf views: **Betaald-overzicht**, **Campagnes**,
  **Organisch — Facebook**, **Organisch — Instagram**, **Betaald vs. organisch**.
- Gekozen view onthouden (localStorage).

### Out of scope
- Backend-wijzigingen; conversies-per-type-uitsplitsing.

## De vijf views

1. **Betaald-overzicht** — *Directie/Marketeer.* KPI's (spend, bereik, frequentie,
   klikken, CTR, CPC, CPM) + resultaten per conversiedoel (ROAS/CPA).
2. **Campagnes** — *Marketeer.* Campagnetabel (doelstelling, status, spend, klikken,
   CTR, resultaten).
3. **Organisch — Facebook** — *Social.* Volgers + groei, bereik, vertoningen,
   betrokkenheid, top-posts.
4. **Organisch — Instagram** — *Social.* Volgers + groei, bereik, profielbezoeken,
   betrokkenheid, top-posts/reels.
5. **Betaald vs. organisch** — *Directie.* Betaald bereik naast organisch bereik en
   betrokkenheid, zodat je ziet wat advertenties toevoegen.

## Requirements

- **R1.** View-switcher met de vijf views + label; actieve view gemarkeerd.
- **R2.** Betaald-overzicht: KPI's + resultaten per doel (bestaande ads-data).
- **R3.** Campagnes: campagnetabel met doelstelling + status.
- **R4.** Facebook/Instagram-views: de bestaande organische blokken, incl.
  volgersgroei en top-posts; nette lege staten (geen pagina/IG/data).
- **R5.** Betaald vs. organisch: vergelijkt betaald bereik met organisch
  bereik/betrokkenheid (FB + IG opgeteld).
- **R6.** Advertentieaccount- en pagina-keuze, periode en CSV-export blijven werken.
- **R7.** Gekozen view onthouden; `npm run build` slaagt; alles defensief.

## Edge cases

- **Geen advertentieaccount** → betaalde views tonen lege staat.
- **Geen pagina / geen IG** → betreffende organische view toont lege/meldingsstaat.
- **Token verlopen / niet gekoppeld** → bestaande koppel-/foutstaat.

## Definition of done

1. META-tabblad heeft de vijf views met labels; gekozen view blijft behouden. (R1, R7)
2. Betaald-overzicht en Campagnes tonen de betaalde data. (R2, R3)
3. Facebook/Instagram-views tonen de organische data + lege staten. (R4)
4. Betaald vs. organisch vergelijkt bereik/betrokkenheid. (R5)
5. Selectors, periode, export werken; `npm run build` slaagt. (R6, R7)
