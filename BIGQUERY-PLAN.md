# Implementatieplan — BigQuery als databron

Doel: GA4-data op **event-niveau, ongesampled** ontsluiten en bronnen kunnen
**combineren** (GA4 × Search Console × later Ads/Meta), zonder de bestaande
live Data-API-flow te slopen. BigQuery komt er **naast**, hybride.

> Achtergrond en kosten-baten staan in de chatdiscussie die hieraan voorafging.
> Korte samenvatting: de cloudrekening is geen blokker (≈ €0–40/mnd bij nette
> voor-aggregatie); de echte kost is bouw + onderhoud. Daarom: gefaseerd,
> beginnend met één pilotklant.

---

## 1. Ontwerpbeslissingen (en waarom)

| Beslissing | Keuze | Waarom |
|---|---|---|
| Databron | **GA4→BigQuery-export in het GCP-project van de klant** | Alleen de native export levert ruwe, ongesamplede events. Een eigen ETL via de Data API zou de sampling/cardinaliteit niet oplossen → geen meerwaarde. |
| Toegang | Nieuwe provider `bigquery` met OAuth-scope `bigquery.readonly` | Past op het bestaande per-org-OAuth-model (`connections`-tabel, `_org_credentials`). Geen service-account-gedoe per klant. |
| Serveren | **Geplande voor-aggregatie**, niet live op ruwe events query'en | Dashboards lezen kleine samenvattingstabellen → sub-seconde én goedkoop. Direct op ruwe events query'en bij elke view schaalt qua kosten niet. |
| Opslag pre-agg | Per-org tabellen in **ons** BQ-project (niet Neon) | Aggregaties blijven in de warehouse waar ze berekend worden; Neon blijft voor app-state. `report_cache` blijft puur cache. |
| Scheduler | **Cloud Scheduler → beveiligd intern endpoint** in dezelfde container | Cloud Run schaalt naar nul, heeft geen eigen cron. Eén container, geen extra deploy-artefact. |
| Realtime | Blijft via de **Data API** (`run_realtime`) | De BQ-export is batch (dagelijks). Realtime via BQ kan alleen met streaming-export (kost geld) — niet nodig. |

**Kernprincipe:** Data API blijft de bron voor *realtime + recente standaard-KPIs*;
BigQuery wordt de bron voor *diepe, historische en cross-source* widgets.

---

## 2. Architectuur (aanvulling op ARCHITECTURE.md)

```
Klant-GCP-project                         Ons GCP-project (Cloud Run)
┌─────────────────────────┐               ┌────────────────────────────────┐
│ GA4 BigQuery-export      │  bq.readonly  │ Cloud Scheduler (1×/dag/org)   │
│  events_YYYYMMDD (ruw)   │◄──────────────│   └─► POST /api/internal/etl   │
└─────────────────────────┘  (org-OAuth)   │         app/bigquery_etl.py    │
                                           │            │ pre-aggregeert     │
                                           │            ▼                    │
                                           │   BQ dataset  org_<id>          │
                                           │     daily_metrics, channels, …  │
                                           │            │ leest              │
                                           │            ▼                    │
                                           │   app/bigquery.py  ─► /api/bq/* │
                                           └────────────────────────────────┘
```

Datastroom dashboards: `browser → /api/bq/overview → app/bigquery.py → ons BQ
(pre-agg) → aggregaten`. Geen ruwe events richting de browser, zoals nu.

---

## 3. Datamodel

**Neon (nieuw), naast bestaande tabellen in `app/db.py`:**

```sql
-- Per-org BigQuery-configuratie (welke export hoort bij welke org)
CREATE TABLE bq_sources (
    organization_id  TEXT PRIMARY KEY REFERENCES organizations(id),
    gcp_project      TEXT NOT NULL,      -- project van de klant
    dataset_id       TEXT NOT NULL,      -- bv. analytics_123456789
    property_id      TEXT,               -- GA4-property voor labeling
    status           TEXT NOT NULL DEFAULT 'pending',  -- pending|active|error
    last_sync        TIMESTAMPTZ,
    last_error       TEXT
);
```

De OAuth-credentials zelf gaan via de bestaande `connections`-tabel met
`provider = 'bigquery'` (versleuteld, hergebruikt `save_connection`).

**Ons BigQuery-project:** één dataset per org (`org_<organization_id>`),
met voor-geaggregeerde, partitioned tabellen:
- `daily_metrics` (date, users, sessions, conversions, …) — voedt KPIs + tijdreeks
- `channels`, `source_medium`, `devices`, `geography` — breakdowns
- `top_pages`, `landing_pages`, `events`, `conversions` — tabellen
- (fase 3) `blended_daily` — GA4 × GSC × Ads gejoind op datum/landingspagina

Dataset-per-org geeft harde isolatie via IAM én voorkomt dat een querybug
ooit org-grenzen overschrijdt — in lijn met `_resolve_org_id`.

---

## 4. Fasering

### Fase 0 — Pilot / spike (1 klant, geen productieverkeer)
- GA4→BQ-export handmatig aanzetten voor één bevriende klant.
- `bigquery.readonly` toevoegen, query handmatig draaien, kosten meten.
- **Go/no-go** op basis van echte querykosten + datakwaliteit.

### Fase 1 — Provider + connectie
- Provider `bigquery` toevoegen, OAuth-connect-flow werkend.
- `bq_sources` vastleggen via een onboarding-stap (klant kiest project/dataset).
- Connectiestatus zichtbaar in `/api/connections` + sidebar-voortgang.

### Fase 2 — ETL + serveren (read-path)
- `app/bigquery_etl.py`: pre-aggregatie per org, idempotent per dag.
- Cloud Scheduler → `/api/internal/etl/run`.
- `app/bigquery.py`: leest pre-agg, levert `run_ga_overview`-compatibele payload.
- `/api/bq/overview`-endpoint + nieuwe widget-`group` in de frontend.

### Fase 3 — Cross-source (de echte meerwaarde)
- `blended_daily`: GA4 × GSC joinen; nieuwe widgets (blended ROAS, organisch×betaald).
- Pas hier wordt BQ onderscheidend t.o.v. standaard-GA-dashboards.

### Fase 4 — Hardening
- Backfill historie, retry/alerting op ETL-jobs, kostenmonitoring/quota-caps,
  per-org dataset-opruiming bij disconnect.

---

## 5. Concrete codewijzigingen

**Backend**

- `app/config.py`
  - `PROVIDER_SCOPES["bigquery"] = ["https://www.googleapis.com/auth/bigquery.readonly"]`
    (komt automatisch in `GOOGLE_PROVIDERS` en `ALL_SCOPES`).
  - Nieuwe env: `BQ_OUTPUT_PROJECT` (ons project), `INTERNAL_ETL_TOKEN`
    (gedeelde secret voor Cloud Scheduler), `BQ_MAX_BYTES_BILLED` (kostencap).
- `app/db.py` — `bq_sources`-tabel toevoegen in `init_schema()` (idempotent, zoals de rest).
- `app/models.py` — CRUD voor `bq_sources` (`get/upsert/set_status`), analoog aan de connection-helpers.
- `app/bigquery_etl.py` *(nieuw)* — leest ruwe export uit klant-BQ met
  `_org_credentials(org, "bigquery")`, schrijft pre-agg naar `org_<id>` in ons project.
  Idempotent per dag (overschrijf de dagpartitie). Zet `MAXIMUM_BYTES_BILLED`.
- `app/bigquery.py` *(nieuw)* — leest pre-agg en bouwt dezelfde dict-vorm als
  `analytics.run_ga_overview`, zodat `WidgetRenderer` ongewijzigd blijft.
- `app/main.py`
  - `/api/bq/overview` (cache hergebruiken via `cache.get/set`, `ttl_for_range`).
  - `/api/internal/etl/run` — header-token check tegen `INTERNAL_ETL_TOKEN`,
    draait ETL voor één of alle actieve orgs.
  - `_connections_payload`: `bigquery` schuift mee uit `GOOGLE_PROVIDERS`; in
    `disconnect` ook `bq_sources` opruimen + (fase 4) het org-dataset droppen.

**Frontend**

- `frontend/src/screens/Onboarding.jsx` / `Integrations.jsx` — BigQuery-tegel +
  veld voor project/dataset (de export-link is niet één-klik zoals GA4-OAuth).
- `frontend/src/lib/widgetCatalog.js` — nieuwe `SOURCES` met een eigen `group`
  (bv. `"blended"`) voor cross-source widgets; bestaande KPIs/breakdowns kunnen
  optioneel een `source: "bq"`-vlag krijgen om uit de pre-agg te lezen.
- `frontend/src/lib/urls.js` + `Overview.jsx` — `/api/bq/overview` bevragen voor
  BQ-widgets; SWR-caching werkt ongewijzigd.

**Infra**

- `cloudbuild.yaml` — geen structurele wijziging (zelfde container).
- Cloud Scheduler-job (1×/dag) → `POST /api/internal/etl/run` met bearer-token.
- IAM: Cloud Run-service-account `bigquery.dataEditor` op ons project,
  `bigquery.jobUser` voor query's.

---

## 6. Multi-tenancy & security

- Elke read/ETL gaat via `_resolve_org_id`; een client blijft vastgepind op de
  eigen org, een admin kan via `?org_id=` targeten — exact zoals de bestaande endpoints.
- Dataset-per-org → isolatie ook op IAM-niveau, niet alleen in querylogica.
- `/api/internal/etl/run` is **niet** publiek bruikbaar: token-check + geen
  org-data in de response; alleen Cloud Scheduler roept het aan.
- Klant-OAuth-token voor BQ wordt net als nu **versleuteld** opgeslagen (Fernet,
  `app/crypto.py`); disconnect revoket de grant als het de laatste Google-bron is.

---

## 7. Kosten & observability

- Harde querycap via `MAXIMUM_BYTES_BILLED` op elke ETL-job → geen verrassingen.
- Pre-agg draait **1×/dag/org** op de ruwe events; dashboards raken alleen de
  kleine tabellen. Verwachting: binnen of net boven de gratis 1 TiB/mnd.
- ETL schrijft `last_sync`/`last_error` in `bq_sources` → zichtbaar in het
  admin-klantentabel (`list_organizations_with_connections`).
- Alerting op mislukte jobs (fase 4).

---

## 8. Risico's & rollback

- **Risico:** export-setup verzwaart de onboarding. *Mitigatie:* heldere
  klantinstructie + statusveld; BQ is optioneel bovenop de bestaande GA4-OAuth.
- **Risico:** querykosten lopen op bij naïef ontwerp. *Mitigatie:* voor-aggregatie
  + `MAXIMUM_BYTES_BILLED` + monitoring vanaf fase 0.
- **Risico:** GA4-exportschema wijzigt. *Mitigatie:* ETL geïsoleerd in één module,
  versie-tolerant lezen.
- **Rollback:** BQ-widgets en `/api/bq/*` zijn additief. Bij problemen: provider
  uitschakelen en op de Data-API-widgets terugvallen — niets aan de bestaande
  flow verandert.

---

## 9. Open vragen (vóór fase 1)

1. Export naar **het project van de klant** (klant betaalt opslag) of naar **ons
   project** (wij betalen, simpeler voor de klant)? Beïnvloedt scope + facturatie.
2. Wordt cross-source (fase 3) een **betaalde premiumlaag**? Dat bepaalt of de
   bouwkosten terugverdiend worden.
3. Hoeveel historie backfillen bij onboarding (kosten-eenmalig)?
