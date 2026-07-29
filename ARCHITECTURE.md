# Architectuur — kompas

White-label marketingdashboard waarmee externe organisaties hun Google-marketingdata
(GA4 + Search Console) via OAuth koppelen en in heldere dashboards bekijken.

## Het grote plaatje

```
Browser (klant)
   │  https://dashboard.prompted-ai.nl
   ▼
Google Cloud Run  ──►  één container (multi-stage Docker):
   ├─ FastAPI (Python)        = de backend / API  (app/)
   └─ React-SPA (Vite-build)  = de frontend, geserveerd door FastAPI  (frontend/)
   │
   ├──►  Neon (Postgres)      = organisaties, gebruikers, versleutelde tokens, cache
   └──►  Google API's         = GA4 Data API + Search Console (de marketingdata)

Inloggen:  Browser ──► Google OAuth ──► terug naar Cloud Run (/api/auth/google/callback)
Deployen:  GitHub merge ──► Cloud Build (cloudbuild.yaml) ──► nieuwe Cloud Run-revisie
DNS:       Netlify (CNAME `dashboard`) ──► Cloud Run domain mapping (+ managed SSL)
```

De kern: **één applicatie** (backend + frontend samen in één container) op Cloud Run,
die data uit Google haalt en haar staat in Neon bewaart.

## Onderdelen en waarom

### Frontend — React + Vite (`frontend/`)
De volledige UI (dashboard, grafieken, instellingen, rapporten). Vite bouwt dit tot
statische bestanden die door de backend worden geserveerd. Grafieken zijn handgemaakte
SVG's (geen zware chart-library) → lichte app. State via React context-providers
(thema, ingelogde gebruiker, actieve organisatie, periode).

### Backend — FastAPI (`app/`)
De API onder `/api/...`: inloggen, koppelingen, data ophalen, instellingen. Alle
gevoelige logica (tokens, Google-calls) draait **server-side**, nooit in de browser.
Python is gekozen om de officiële Google-client-libraries; FastAPI is snel en modern.

### Eén container (multi-stage `Dockerfile`)
Stap 1 bouwt de React-app, stap 2 plaatst die bij de FastAPI-backend. Een catch-all
route serveert de SPA; `/api/...` gaat naar de backend. Voordeel: één deploy, één URL,
**geen CORS** (alles op hetzelfde domein), goedkoper dan twee hostings.

### Google Cloud Run — hosting
Draait de container serverless achter HTTPS. **Schaalt naar nul** (bijna geen kosten bij
weinig gebruik) en automatisch op bij verkeer. Geen serverbeheer; custom domein + SSL
out of the box.

### Neon — database (serverless Postgres)
Cloud Run-containers zijn tijdelijk en hebben geen eigen opslag, dus de staat leeft in
Neon: organisaties, gebruikers + rollen, de versleutelde Google-tokens per organisatie,
en de rapport-cache. Neon schaalt ook naar nul (past bij het kostenmodel) en is gewoon
Postgres (geen lock-in). Schema in `app/db.py`, data-access in `app/models.py`.

### Google OAuth 2.0 — inloggen én data-toegang (`app/oauth.py`, `app/config.py`)
Inloggen identificeert de gebruiker (e-mail); dezelfde flow vraagt per tool toestemming
om GA4/Search Console te lezen (incrementele autorisatie). Geen eigen wachtwoordbeheer.
De **redirect-URI** (`/api/auth/google/callback`) moet exact overeenkomen tussen de
`GOOGLE_REDIRECT_URI`-env en de Authorized redirect URIs van de OAuth-client.

### Fernet-encryptie — tokens veilig opslaan (`app/crypto.py`)
Google-tokens worden versleuteld (AES-128 + HMAC) vóór opslag in Neon, met een sleutel
uit `TOKEN_ENCRYPTION_KEY`. Een gelekte database geeft zo geen directe toegang tot
Google-accounts.

### Caching — "direct inladen" (drie lagen)
Google-calls duren 1–3s, daarom:
1. **Frontend SWR** (`frontend/src/lib/swr.js`): toont eerder bekeken data meteen en
   ververst op de achtergrond.
2. **In-memory cache** in de backend (`app/cache.py`): warme hits per instance.
3. **`report_cache`-tabel in Neon**: overleeft cold starts en meerdere instances.

Historische periodes (einddatum < vandaag) zijn onveranderlijk → lange TTL; periodes
t/m vandaag → korte TTL.

Het Raamwerk cachet per máánd (zelfde TTL-regels) en toont standaard de laatste 12
maanden; alleen de maanden die niet in de cache staan gaan naar de kanalen, en die
calls (maand × kanaal) lopen parallel. Zo kost een extra maand alleen die maand, en is
een koude load zo snel als de traagste losse call in plaats van tientallen seriële.

### Docker + Cloud Build — automatisch deployen (`cloudbuild.yaml`)
Een Cloud Build-trigger op GitHub bouwt en rolt uit bij elke merge naar `main`. Code op
`main` = automatisch live, zonder handmatige `gcloud`-commando's.

### Netlify DNS + Cloud Run domain mapping — eigen domein
DNS van `prompted-ai.nl` staat bij Netlify; een CNAME voor `dashboard` wijst naar Cloud
Run, dat zelf een SSL-certificaat regelt. Klanten zien het merk (`dashboard.prompted-ai.nl`)
in plaats van een `…run.app`-URL.

### GA4 Data API + Search Console API — de databron (`app/analytics.py`, `app/search_console.py`)
De backend roept met de organisatie-token deze API's aan en geeft **aggregaten** terug.
Data stroomt alleen **browser ↔ backend ↔ Google** — geen externe trackers.

## Multi-tenancy & rollen

- **organizations**: één per klant, gegroepeerd op (niet-publiek) e-maildomein. Een
  bureau is óók een organisatie (`is_agency`); de klantomgevingen die het klaarzet
  wijzen er via `agency_id` naar terug.
- **users**: ingelogde personen, met rol `client` of `agency_admin`.
- **connections**: één Google-grant per organisatie, per provider, versleuteld opgeslagen.
- **org_features**: welke functies een bureau per klantaccount heeft geactiveerd.

Isolatie: elk data-endpoint draait via `_resolve_org_id` (`app/org_access.py`) — een
client is vastgepind op de eigen organisatie; een agency-admin kan wisselen tussen de
omgevingen van het **eigen bureau**. **Invite-only**: nieuwe gebruikers op een
gedeeld/publiek domein (gmail e.d.) of een nog onbekend domein krijgen een geïsoleerde
persoonlijke org, zodat onbekenden nooit in dezelfde org belanden.

### Bureaus (agencies)

Een bureau zoals TriplePro — met een MCC/manager-account — heeft een eigen omgeving:
het zet klantaccounts klaar (klant-wizard), hergebruikt zijn Google-koppeling per klant
(`link-agency` + toegewezen property/site/Ads-klant) en beheert uitsluitend zijn eigen
klanten. Drie niveaus:

| Rol | Bepaald door | Ziet en beheert |
|-----|--------------|-----------------|
| `client` | standaard | alleen de eigen organisatie |
| `agency_admin` | uitnodiging met rol, of `AGENCY_ADMIN_EMAILS` | de klantomgevingen van het eigen bureau |
| platform-admin | e-mail in `AGENCY_ADMIN_EMAILS` | alle bureaus en alle organisaties |

`auth.admin_agency_id()` bepaalt de scope (None = platform-breed) en `auth.can_admin_org()`
of een admin een organisatie mag aanraken; elk `/api/admin/...`-endpoint gaat daar langs.
Bij de migratie worden bestaande klanten aan het enige bestaande bureau gehangen; zijn er
meerdere bureaus, dan wijst de platform-admin ze toe (beheerscherm **Bureaus**).

### Functies per account

Het bureau bepaalt per klantomgeving welke onderdelen aanstaan: **Signalen**,
**AI-assistent**, **Integraties**, **Raamwerk** en **Mijn dashboards** (te zetten in de
klant-wizard en op **Omgevingen**). Alleen afwijkingen staan in `org_features`; geen rij
= aan, dus bestaande omgevingen blijven ongewijzigd. De frontend verbergt uitgeschakelde
onderdelen (sidebar, routes, notificatiebel), maar de grens ligt server-side:
`_require_feature()` weigert de bijbehorende endpoints met een 403, zodat een directe
URL niets extra's opent.

## Verzoek-flow (voorbeeld: Overzicht)

1. Browser laadt `dashboard.prompted-ai.nl` → Cloud Run serveert de React-app.
2. React vraagt `/api/me` → backend leest de sessie-cookie, haalt de gebruiker uit Neon.
3. React vraagt `/api/analytics/overview?...` → backend kijkt eerst in de **cache**; zo
   niet: organisatie-token (versleuteld) uit Neon → **ontsleutelen** → **GA4 API** →
   resultaat in cache → aggregaten terug.
4. React tekent de grafieken.

## Tech-stack in één tabel

| Laag | Keuze | Waarom |
|------|-------|--------|
| Frontend | React + Vite | standaard voor interactieve dashboards; snelle build |
| Backend | FastAPI (Python) | officiële Google-libraries; snel & onderhoudbaar |
| Hosting | Google Cloud Run | serverless, schaalt naar nul, geen serverbeheer |
| Database | Neon (Postgres) | serverless Postgres, geen lock-in, externe opslag nodig |
| Auth + data | Google OAuth 2.0 | geen wachtwoordbeheer; meteen toegang tot de data |
| Encryptie | Fernet (cryptography) | tokens versleuteld at rest |
| Deploy | Docker + Cloud Build | automatische deploy bij merge naar `main` |
| Domein/DNS | Netlify DNS + Cloud Run mapping | white-label eigen domein + managed SSL |
| Databron | GA4 Data API + Search Console | de marketingdata zelf |

## Configuratie (env-variabelen)

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `SESSION_SECRET`,
`DATABASE_URL` (Neon), `TOKEN_ENCRYPTION_KEY` (Fernet), `AGENCY_ADMIN_EMAILS`,
optioneel `PUBLIC_EMAIL_DOMAINS`. Worden op de Cloud Run-service gezet en blijven
behouden over revisies heen.
