# Voorstel — view-templates per kanaal

Doel: per kanaal (**Analytics, Search Console, Google Ads, META**) een set
**kant-en-klare weergaven ("views")** aanbieden, zodat een gebruiker met één klik
een dashboard krijgt dat past bij een vraag of doelgroep — in plaats van elke
widget zelf te moeten samenstellen. Dit document analyseert per kanaal welke data
beschikbaar is en stelt daarop passende views voor.

## Uitgangspunt & aanpak

- Vandaag bestaat het **samenstelbare systeem alleen voor Analytics** (Overzicht):
  `SOURCES` (data) × `KINDS` (visualisatie) + 5 `TEMPLATES` in
  `frontend/src/lib/widgetCatalog.js`. Search Console, Google Ads en META zijn
  vaste schermen.
- **Voorstel:** het template-concept doortrekken naar alle vier de kanalen. Twee
  smaken, te combineren:
  1. **Preset-views** (aanrader om te starten): per kanaal een paar vaste,
     doordachte weergaven die je via een keuzemenu bovenin het tabblad kiest.
     Snel te bouwen, weinig risico.
  2. **Samenstelbaar** (zoals Analytics nu): de gebruiker past een view aan en
     slaat 'm op. Meer werk; kan later per kanaal worden aangezet.
- Elke view = een **naam + doelgroep + een vaste set widgets** tegen de bestaande
  API-payload van dat kanaal (geen extra API-calls nodig — alles komt uit het
  bestaande rapport-endpoint).
- **Doelgroepen** die telkens terugkomen: *Directie* (samenvatting), *Marketeer*
  (sturen/optimaliseren), *Specialist* (diepte).

> Notatie hieronder: elke view noemt de widgets die erin zitten. Waar een cijfer
> nu al in de payload zit staat het er gewoon; een enkel cijfer is nieuw af te
> leiden en wordt als *(nieuw)* gemarkeerd.

---

## 1. Analytics (GA4)

**Wat de bron biedt** (`app/analytics.py`, `run_ga_overview`): KPI's (users,
newUsers, sessions, pageViews, bounceRate, engagementRate, avgSessionDuration,
eventCount, conversions) met vergelijking; sessies-tijdreeks; verdelingen
(kanalen, bron/medium, apparaten, browsers, nieuw-vs-terugkerend, landen,
gebeurtenissen); tabellen (toppagina's, instappagina's, conversies per event);
realtime.

**Voorgestelde views:**

| View | Doelgroep | Inhoud | Waarom |
|---|---|---|---|
| **Directie-overzicht** | Directie | KPI's (users, sessions, conversies, betrokkenheid) + sessies-trend + kanalen-donut | Eén scherm met "hoe staan we ervoor" en de trend. |
| **Acquisitie & verkeer** | Marketeer | Kanalen, bron/medium, nieuw-vs-terugkerend, landen, apparaten + sessies-trend | Waar komen bezoekers vandaan en met welk apparaat. |
| **Gedrag & content** | Marketeer/Content | Toppagina's, instappagina's, gem. sessieduur, bouncepercentage, gebeurtenissen | Welke content werkt; waar haken mensen af. |
| **Conversie & doelen** | Marketeer | Conversies-totaal + per key event (filterbaar), conversieratio *(nieuw: conversions/sessions)*, top-converterende kanalen/pagina's | Sturen op resultaat, niet alleen verkeer. |
| **Realtime** | Iedereen | Actieve gebruikers nu, per-minuut, actieve pagina's | Live-moment (campagnelancering, nieuwsbrief). |

---

## 2. Search Console (SEO)

**Wat de bron biedt** (`app/search_console.py`): totalen (clicks, impressions,
CTR, positie) met vergelijking; clicks/impressies-tijdreeks; top-queries en
top-pagina's (met clicks, impressions, CTR, positie).

**Wat SEO'ers écht willen** vraagt om iets meer afleiding uit dezelfde data
(positie-buckets, kansen). Voorgestelde views:

| View | Doelgroep | Inhoud | Waarom |
|---|---|---|---|
| **SEO-overzicht** | Directie/Marketeer | KPI's (clicks, impressions, CTR, gem. positie) + clicks-trend | De vier kerncijfers plus richting. |
| **Zoekopdrachten** | SEO-specialist | Top-queries; *(nieuw)* stijgers/dalers t.o.v. vorige periode; *(nieuw)* branded vs. non-branded split | Waar word je op gevonden, en wat beweegt. |
| **Pagina's** | SEO-specialist | Top-pagina's op clicks; positie per pagina; *(nieuw)* pagina's met veel impressies & lage CTR | Welke pagina's presteren en welke onderbenut zijn. |
| **Kansen (quick wins)** | SEO-specialist | *(nieuw)* Queries op **positie 11–20** met veel impressies (net geen pagina 1); *(nieuw)* hoge-impressie/lage-CTR queries | Concrete, prioriteerbare optimalisatiekansen. |

> De "kansen"-view is de grootste toegevoegde waarde: die zet ruwe SC-data om in
> een actielijst. Vereist alleen een extra query-dimensie op positie/CTR (geen
> nieuwe bron).

---

## 3. Google Ads

**Wat de bron biedt** (`app/google_ads.py`): accounttotalen (kosten, klikken,
vertoningen, conversies, conversiewaarde, CTR, CPC, ROAS) met vergelijking;
kosten/klikken-dagreeks; top-campagnes.

**Voorgestelde views:**

| View | Doelgroep | Inhoud | Waarom |
|---|---|---|---|
| **Ads-overzicht** | Directie | KPI's (kosten, klikken, conversies, ROAS) + kosten-trend | Wat kost het en wat levert het op. |
| **Campagnes** | Marketeer | Campagnetabel (kosten, klikken, CTR, conversies, ROAS) + *(nieuw)* aandeel uitgaven per campagne (donut) | Waar gaat het budget heen en wat rendeert. |
| **Efficiëntie & budget** | Marketeer | CPC, CPM, CTR, *(nieuw)* kosten per conversie (CPA), *(nieuw)* campagnes met hoge uitgaven & lage conversie | Verspilling opsporen, bijsturen. |
| **Conversie & ROAS** | Marketeer/Directie | *(nieuw)* conversies per type, ROAS per campagne, conversiewaarde-trend | Focus op opbrengst i.p.v. alleen klikken. |

---

## 4. META (Facebook + Instagram)

**Wat de bron biedt** (`app/meta.py`): betaald — accounttotalen (spend, reach,
frequentie, klikken, CTR, CPC, CPM), resultaten per conversiedoel (ROAS/CPA),
top-campagnes; organisch — Facebook-pagina (volgers + groei, bereik, vertoningen,
betrokkenheid, top-posts) en Instagram (volgers + groei, bereik, vertoningen,
profielbezoeken, top-posts).

**Voorgestelde views** (het tabblad is al gesplitst betaald/organisch — deze
views verfijnen dat):

| View | Doelgroep | Inhoud | Waarom |
|---|---|---|---|
| **Betaald-overzicht** | Directie/Marketeer | KPI's (spend, bereik, resultaten, ROAS) + resultaten per doel | Prestaties van de advertenties in één oog. |
| **Campagnes (betaald)** | Marketeer | Campagnetabel (doelstelling, status, spend, klikken, CTR, resultaten) | Sturen per campagne en doelstelling. |
| **Organisch — Facebook** | Social-beheerder | Volgers + groei, bereik, vertoningen, betrokkenheid, top-posts | Hoe groeit en presteert de pagina. |
| **Organisch — Instagram** | Social-beheerder | Volgers + groei, bereik, profielbezoeken, betrokkenheid, top-posts/reels | Idem voor Instagram. |
| **Betaald vs. organisch** | Directie | *(nieuw)* Gecombineerd bereik & betrokkenheid betaald naast organisch | Zien wat advertenties tóevoegen bovenop organisch. |

---

## 5. (Optioneel) Cross-channel view

Los van de kanalen: een **"Directie-overzicht (alle kanalen)"** dat de kern-KPI's
van elk kanaal naast elkaar zet — sessies (GA), clicks (SC), Ads-ROAS, META-bereik
— met per kanaal een mini-trend. Dit is de natuurlijke opstap naar geblende
metrics (en sluit aan op het eerdere BigQuery-voorstel voor echte cross-source
rapportage). Aanrader als aparte fase ná de per-kanaal views.

---

## Implementatie-aanpak & fasering

1. **Fase 1 — Preset-views per kanaal (aanrader om te starten).**
   Per tabblad een keuzemenu "view" met de bovenstaande vaste weergaven. Voor
   Analytics sluit dit aan op de bestaande `TEMPLATES`; voor SC/Ads/META voegen we
   een klein `VIEWS`-register per kanaal toe (naam → set widgets). Weinig risico,
   snel zichtbaar resultaat.
2. **Fase 2 — Afgeleide cijfers.** De *(nieuw)* gemarkeerde items (SEO-kansen,
   CPA, conversieratio, aandeel-uitgaven, betaald-vs-organisch) toevoegen aan de
   rapport-endpoints/afleidingen. Grootste inhoudelijke meerwaarde zit in de
   **SEO-kansen** en **Ads-efficiëntie** views.
3. **Fase 3 — Samenstelbaar maken** (optioneel). Het widget-systeem van Analytics
   uitbreiden naar SC/Ads/META, zodat gebruikers eigen views opslaan/delen — net
   als de bestaande opslagbare dashboards.
4. **Fase 4 — Cross-channel view** (zie §5), eventueel op BigQuery.

## Open punten (graag jouw sturing)

1. **Preset-views of direct samenstelbaar?** Ik raad preset-views aan om te
   starten (fase 1), samenstelbaar later.
2. **Doelgroep-indeling** — herken je Directie / Marketeer / Specialist, of wil je
   andere rollen (bijv. per klant een vaste "klantrapport"-view)?
3. **Prioriteit** — welke kanalen/views eerst? (Mijn suggestie: Analytics +
   SEO-kansen + Ads-efficiëntie leveren het snelst waarde.)

> Dit is een voorstel, geen implementatie. Na jouw akkoord kan ik hier een
> concrete `/spec` van maken (per gekozen fase) en daarna `/build` draaien.
