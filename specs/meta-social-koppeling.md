# META (Facebook + Instagram) koppeling — Ads & organisch

## Objective

Klanten kunnen hun **Meta-account** (Facebook + Instagram) aan het dashboard
koppelen, zodat het bureau hun **betaalde (META Ads)** én **organische**
resultaten in één omgeving kan presenteren. Net als bij Google Analytics,
Search Console en Google Ads is dit **multi-tenant**: elke organisatie koppelt
haar eigen Meta-account via een Meta-toestemming (Facebook Login), en de data
wordt per organisatie geïsoleerd getoond.

De data verschijnt in het bestaande **META/social-tabblad**, overzichtelijk
opgesplitst in betaald vs. organisch en Facebook vs. Instagram.

## Scope

### In scope
- Per-klant koppeling van een Meta-account via Facebook Login (OAuth), als een
  nieuwe niet-Google bron.
- Ophalen + tonen van META Ads-data (account­totalen + per campagne).
- Ophalen + tonen van organische data voor de Facebook-pagina en het
  Instagram-account.
- Een vernieuwd META/social-tabblad met een duidelijke opsplitsing.
- Integratie met de bestaande periode-/vergelijkingskiezer, caching en
  multi-tenant-isolatie.
- Een volledige **stap-voor-stap-handleiding** voor het opzetten van de Meta-app
  op developers.facebook.com (zie aparte sectie onderaan).

### Out of scope (non-goals)
- META-data als losse widgets in het samenstelbare Overzicht (kan later).
- Schrijfacties richting Meta (campagnes aanmaken/pauzeren, budgetten wijzigen).
  Alles is **alleen-lezen**.
- Advertentieset- en advertentie-niveau (alleen account + campagne in v1).
- Andere Meta-onderdelen (WhatsApp, Threads, Messenger-bots, catalogus).
- META Ads opnemen in het gecombineerde rapport/CSV-export buiten het
  META-tabblad zelf (de tab-export volstaat in v1).

## Requirements

Genummerd en individueel toetsbaar.

### Koppeling & authenticatie
- **R1.** Er is een nieuwe bron `meta` die los staat van de Google-OAuth-flow en
  een eigen Facebook Login-flow gebruikt (`/api/auth/meta/login` →
  `/api/auth/meta/callback`).
- **R2.** In *Integraties* en in de onboarding verschijnt META Ads niet langer
  als "binnenkort", maar met een werkende **koppelen**-knop; na koppelen toont
  het de status `verbonden` met het gekoppelde Meta-account.
- **R3.** De koppeling is **per organisatie** opgeslagen; een client ziet alleen
  de eigen Meta-data, een agency-admin kan via de org-switcher elke klant-org
  kiezen (zelfde `_resolve_org_id`-gedrag als de andere bronnen).
- **R4.** Het Meta-toegangstoken wordt **versleuteld** opgeslagen (Fernet, zoals
  de Google-tokens) en nooit naar de browser of de repo gelekt.
- **R5.** Kortlevende user-tokens worden omgezet naar een **long-lived token**
  (±60 dagen); de benodigde Page-/Instagram-tokens worden daaruit afgeleid en
  meegeslagen.
- **R6.** Verloopt of vervalt de toestemming, dan toont de bron de status
  `opnieuw koppelen` en geeft het dashboard een nette melding i.p.v. een
  foutscherm (zelfde patroon als de Google-bronnen).
- **R7.** Ontkoppelen verwijdert de opgeslagen Meta-koppeling van de organisatie
  en maakt de gecachte Meta-data van die org leeg.

### META Ads (betaald) — accounttotalen + per campagne
- **R8.** Per gekozen periode worden minimaal deze accounttotalen getoond:
  uitgaven, vertoningen, bereik, frequentie, (link)klikken, CTR, CPC, CPM.
- **R9.** **Resultaten per conversiedoel** worden dynamisch getoond op basis van
  de conversie-/actietypen die in het account voorkomen (bijv. aankopen +
  aankoopwaarde + ROAS, leads, toevoegen-aan-winkelwagen, checkout gestart,
  landingspaginaweergaven, berichtgesprekken), inclusief **kosten per resultaat
  (CPA)** per doel.
- **R10.** Er is een **uitsplitsing per campagne** met dezelfde kerncijfers, plus
  per campagne de **doelstelling/objective** en status.
- **R11.** Bij een actieve vergelijkingsperiode tonen de KPI's een verschil-%
  t.o.v. die periode (zelfde stijl als de andere tabbladen).

### Organisch — Facebook-pagina + Instagram (beide must-have)
- **R12.** **Facebook-pagina:** volgers/fans + groei in de periode, paginabereik,
  vertoningen, post-betrokkenheid, en een lijst met **top-posts** (op
  bereik/betrokkenheid).
- **R13.** **Instagram:** volgers + groei, bereik, vertoningen, profielbezoeken,
  betrokkenheid (likes/reacties/opslaan) en een lijst met **top-posts/reels**.
- **R14.** Als een klant wél een gekoppeld Meta-account heeft maar geen
  Facebook-pagina óf geen gekoppeld Instagram-account, toont het betreffende deel
  een nette lege staat in plaats van een fout.

### META/social-tabblad (UI)
- **R15.** Het META/social-tabblad is **opgesplitst** in duidelijk gescheiden
  secties: **Betaald (META Ads)** en **Organisch**, en binnen organisch
  **Facebook** vs. **Instagram**.
- **R16.** Het tabblad gebruikt de bestaande **periode-/vergelijkingskiezer**
  bovenin; data herlaadt bij periodewissel.
- **R17.** Bij meerdere advertentieaccounts/pagina's/IG-accounts kan de gebruiker
  kiezen welke wordt getoond (selector, zoals de GA-property en het Ads-account).
- **R18.** De data is exporteerbaar naar CSV via de bestaande exportknop op het
  tabblad.

### Cross-cutting
- **R19.** Meta-rapporten worden **gecachet** met dezelfde TTL-logica als de
  andere bronnen (korte TTL voor periodes t/m vandaag, lange voor historische),
  per org + account + periode.
- **R20.** Elke Meta-API-call is **defensief**: één mislukt blok degradeert naar
  leeg + een logregel, en legt nooit het hele tabblad of de app plat (zelfde les
  als bij de GA-tokenfix).
- **R21.** App ID, App Secret en eventuele vaste tokens staan als **server-side
  env-variabelen** op Cloud Run, niet in de repo.

## Meta-app setup (stap voor stap, developers.facebook.com)

Uit te voeren door de beheerder (jij). Voorwaarde: Meta **Business Manager** en
een **developer-account** (beide aanwezig).

1. **Bedrijfsverificatie.** In Meta Business Manager → *Bedrijfsinstellingen →
   Beveiligingscentrum*: rond **Business Verification** af. Dit is vereist voor
   "Advanced Access" tot de meeste benodigde permissies bij andere klanten dan
   jijzelf.
2. **App aanmaken.** developers.facebook.com → *My Apps → Create App* → type
   **Business** → koppel de app aan je Business-portfolio.
3. **Producten toevoegen** in de app:
   - **Facebook Login** (voor de klant-OAuth).
   - **Marketing API** (advertentiedata).
   - **Instagram** / **Instagram Graph API** (organische IG-insights).
   - Pagina-insights lopen via de Graph API met de pagina-permissies (geen apart
     product nodig).
4. **Facebook Login configureren:** zet als **Valid OAuth Redirect URI**
   `https://dashboard.prompted-ai.nl/api/auth/meta/callback` en vul het
   App-domein (`prompted-ai.nl`) in.
5. **Benodigde permissies (scopes):**
   - `public_profile`, `email` — identiteit.
   - `ads_read` — META Ads-statistieken.
   - `business_management` — toegang tot bedrijfsassets (accounts/pagina's).
   - `pages_show_list`, `pages_read_engagement`, `read_insights` — pagina-data &
     -insights.
   - `instagram_basic`, `instagram_manage_insights` — Instagram-insights.
6. **App-gegevens veilig opslaan:** noteer **App ID** en **App Secret** en zet ze
   als env-variabelen op de Cloud Run-service (bijv. `META_APP_ID`,
   `META_APP_SECRET`), nooit in de repo.
7. **Ontwikkelen/testen eerst met je eigen account:** in *Development*-modus
   werken de geavanceerde permissies alleen voor gebruikers met een app-rol
   (beheerder/ontwikkelaar/tester). Hiermee bouw en test je de koppeling met je
   eigen Meta-account.
8. **App Review + Live.** Dien de geavanceerde permissies (`ads_read`,
   `pages_read_engagement`, `read_insights`, `instagram_basic`,
   `instagram_manage_insights`, `business_management`) in voor **App Review**
   (met use-case-uitleg + schermopname) en zet de app **Live**. Pas daarna kunnen
   andere klanten dan jijzelf koppelen.
9. **Tokenmodel:** klant logt in via Facebook Login → kortlevend user-token →
   omzetten naar long-lived token (±60 dagen) → versleuteld opslaan; pagina- en
   IG-tokens daaruit afleiden. Plan **heraanmelding** rond het verlopen van het
   long-lived token (zie R6).

## Constraints

- **Andere auth dan Google.** Meta gebruikt Facebook Login + Graph API; dit is
  een volledig aparte OAuth-flow naast de bestaande Google-flow (geen
  incrementele Google-scope).
- **App Review/verificatie is blokkerend** voor productiegebruik door externe
  klanten; tot die tijd werkt alleen het eigen (app-rol) account.
- **Tokenlevensduur ±60 dagen** (geen oneindige refresh zoals Google); re-auth is
  periodiek nodig.
- Past binnen de bestaande architectuur: FastAPI-backend, versleutelde
  tokenopslag in Neon, caching, multi-tenant via `_resolve_org_id`, React-SPA.
- Alleen-lezen; geen wijzigingen aan Meta-zijde.
- Rate limits van de Graph/Marketing API respecteren (caching helpt).

## Edge cases

- **Geen advertentieaccount gekoppeld** → Ads-sectie toont nette lege staat (geen fout).
- **Geen Facebook-pagina of geen Instagram-account** → dat organische deel toont een lege staat (R14).
- **Instagram niet gekoppeld aan de pagina** (komt vaak voor) → IG-sectie meldt "geen gekoppeld Instagram-account".
- **Token verlopen/ingetrokken** → status `opnieuw koppelen`, nette melding, geen 500 (R6).
- **Conversiedoelen verschillen per account** → de resultaten-per-doel zijn dynamisch; ontbreekt een doel, dan wordt het niet getoond (R9).
- **Periode zonder data / nieuw account** → KPI's tonen 0 en lege lijsten, geen fout.
- **Meerdere accounts/pagina's** → selector; er is altijd een geldige standaardkeuze (R17).
- **Eén Meta-API-blok faalt** (bijv. IG-insights) → alleen dat blok degradeert naar leeg, de rest van het tabblad blijft staan (R20).
- **Rate limit/tijdelijke API-fout** → nette melding + de echte oorzaak in de server-logs.

## Definition of done

Concrete, controleerbare checklist.

1. Op *Integraties* staat **META Ads** met een werkende **koppelen**-knop; na de
   Facebook-toestemming wordt de status `verbonden` met het gekoppelde account
   getoond. (R2, R3)
2. Het Meta-token staat **versleuteld** in de database; in repo en
   browser-netwerkverkeer is geen token zichtbaar. (R4, R21)
3. Het **META/social-tabblad** toont, voor een gekoppelde org en de gekozen
   periode, gescheiden secties **Betaald** en **Organisch (Facebook / Instagram)**. (R15)
4. **Ads-totalen** (uitgaven, vertoningen, bereik, frequentie, klikken, CTR, CPC,
   CPM) kloppen met wat Meta Ads Manager voor dezelfde periode toont (binnen
   afrondingsmarge). (R8)
5. **Resultaten per conversiedoel** met ROAS en CPA worden getoond voor de doelen
   die in het account voorkomen. (R9)
6. Er is een **tabel per campagne** met kerncijfers, objective en status. (R10)
7. **Facebook-pagina**: volgers + groei, bereik, vertoningen, betrokkenheid en
   top-posts worden getoond. (R12)
8. **Instagram**: volgers + groei, bereik, vertoningen, profielbezoeken,
   betrokkenheid en top-posts/reels worden getoond. (R13)
9. De **periodekiezer + vergelijking** werkt op het tabblad; KPI's tonen het
   verschil-% bij een vergelijkingsperiode. (R11, R16)
10. Bij ontbrekende onderdelen (geen pagina/IG/ads) en bij een verlopen token
    verschijnt een **nette lege/melding-staat**, geen 500. (R6, R14, R20)
11. Een agency-admin kan via de org-switcher de Meta-data van **verschillende
    klanten** los bekijken; een client ziet alleen de eigen data. (R3)
12. De **CSV-export** op het tabblad levert de getoonde Ads- en organische data. (R18)
13. Meta-rapporten zijn **gecachet** (zichtbaar als snelle herbezoeken/geen
    dubbele API-calls binnen de TTL). (R19)
14. De **stap-voor-stap Meta-app-handleiding** in dit document is gevolgd en de
    app staat (na App Review) Live, zodat externe klanten kunnen koppelen. (setup-sectie)

## Open questions

- **Valuta:** uitgaven/ROAS in de valuta van het advertentieaccount tonen, of
  alles normaliseren naar euro? *Aanname: tonen in de accountvaluta.*
- **Standaard-attributievenster** voor conversies/ROAS (bijv. 7-dagen-klik /
  1-dag-weergave)? *Aanname: Meta-standaard aanhouden tenzij anders gewenst.*
- **Aantal top-posts/campagnes** in de lijsten. *Aanname: top 10.*
- **App Review-doorlooptijd** bij Meta is onzeker; tot goedkeuring werkt de
  koppeling alleen met het eigen (app-rol) account.
