# META-app aanmaken & koppelen — stap voor stap

Praktische handleiding om de Meta-app op te zetten die het dashboard gebruikt om
**Facebook + Instagram** (betaald én organisch) te koppelen. Volg dit één keer
als beheerder. Doorlooptijd: het aanmaken kost ~30 min; **App Review +
bedrijfsverificatie** bij Meta kan enkele dagen duren — start daarom op tijd.

Voorwaarden (heb je al): een **Meta Business Manager** en een **developer-account**.

---

## 1. Bedrijfsverificatie (Business Verification)

Nodig voordat andere klanten dan jijzelf mogen koppelen.

1. Ga naar **business.facebook.com** → ⚙️ *Bedrijfsinstellingen*.
2. *Beveiligingscentrum* (Security Center) → start **Bedrijfsverificatie** en
   doorloop de stappen (bedrijfsgegevens + documenten).

> Je kunt al bouwen/testen vóór de verificatie rond is — alleen niet met externe
> klantaccounts.

## 2. App aanmaken

1. Ga naar **developers.facebook.com** → *My Apps* → **Create App**.
2. Kies app-type **Business**.
3. Geef een naam (bijv. "Kompas Dashboard") en koppel de app aan je
   **Business-portfolio**.

## 3. Producten toevoegen

In het app-dashboard, onder *Add products*:

- **Facebook Login** → *Set up*. (voor het koppelen door klanten)
- **Marketing API** → *Set up*. (advertentiedata)
- **Instagram** / **Instagram Graph API** → *Set up*. (organische IG-data)

Pagina-insights lopen via de Graph API met de pagina-permissies — daarvoor is
geen apart product nodig.

## 4. Facebook Login configureren

Onder *Facebook Login → Settings*:

- **Valid OAuth Redirect URIs:**
  ```
  https://dashboard.prompted-ai.nl/api/auth/meta/callback
  ```
- Onder *App settings → Basic*: vul **App Domains** in met `prompted-ai.nl` en
  stel de privacybeleid-URL in (vereist om Live te kunnen gaan).

## 5. Permissies (scopes)

Het dashboard vraagt deze permissies bij het koppelen:

| Permissie | Waarvoor |
|---|---|
| `public_profile` | identiteit van de koppelende gebruiker |
| `ads_read` | META Ads-statistieken |
| `business_management` | toegang tot advertentieaccounts/pagina's in het bedrijf |
| `pages_show_list`, `pages_read_engagement` | Facebook-pagina + insights |
| `instagram_basic`, `instagram_manage_insights` | Instagram-insights |

> De Instagram-permissies verschijnen pas nadat je het **Instagram-product** aan
> de app hebt toegevoegd én er een zakelijk/creator IG-account aan de
> Facebook-pagina is gekoppeld. Zoek permissies op via de **zoekbalk** in
> *App Review → Permissions and Features* (of via *Use cases*). De scopes `email`
> en `read_insights` zijn voor dit app-type **niet** geldig — gebruik ze niet.

## 6. App-gegevens veilig op de server zetten

Onder *App settings → Basic* vind je **App ID** en **App Secret**. Zet deze als
omgevingsvariabelen op de Cloud Run-service (**niet** in de repo):

| Variabele | Waarde |
|---|---|
| `META_APP_ID` | je App ID |
| `META_APP_SECRET` | je App Secret |
| `META_REDIRECT_URI` | `https://dashboard.prompted-ai.nl/api/auth/meta/callback` |
| `META_GRAPH_VERSION` | `v21.0` (of laat leeg voor de standaard) |

Het makkelijkst via de Google Cloud-console (zoals je de Google Ads-token hebt
gezet): **Cloud Run → ga-oauth-backend → Edit & deploy new revision →
Variables & Secrets → + Add variable**. App Secret eventueel via Secret Manager.

## 7. Eerst testen met je eigen account

Zolang de app in **Development**-modus staat, werken de geavanceerde permissies
alleen voor mensen met een **app-rol** (beheerder/ontwikkelaar/tester). Voeg
jezelf toe onder *App roles* en koppel zo je eigen Meta-account om de werking te
testen vóór App Review.

## 8. App Review + Live

Voor gebruik door externe klanten:

1. *App Review → Permissions and Features*: vraag **Advanced Access** aan voor:
   `ads_read`, `pages_read_engagement`, `instagram_basic`,
   `instagram_manage_insights`, `business_management`.
2. Lever de gevraagde uitleg + een **schermopname** van de koppel-flow aan.
3. Zet de app op **Live** (schakelaar bovenin het app-dashboard).

Pas na goedkeuring + Live kunnen andere klanten dan jijzelf koppelen.

## 9. Koppelen in het dashboard

Zodra de bovenstaande env-variabelen zijn gezet en de code live staat:

1. Dashboard → **Integraties** → bij **META Ads** op **koppelen** klikken.
2. Doorloop de Facebook-toestemming (kies de pagina('s)/advertentieaccount).
3. Open het **META / social**-tabblad → je ziet betaald en organisch,
   opgesplitst per Facebook en Instagram.

---

## Token & verloop

- Bij het koppelen wordt een kortlevend token omgezet naar een **long-lived
  token (~60 dagen)** en versleuteld opgeslagen.
- Rond het verlopen toont de bron **"opnieuw koppelen"**; de klant doorloopt dan
  kort opnieuw de Facebook-toestemming. (Meta kent geen oneindige refresh zoals
  Google.)

## Veelvoorkomende valkuilen

- **Geen data terwijl je wél gekoppeld bent** → check of de app **Live** staat en
  of de permissies via App Review op **Advanced Access** staan.
- **Instagram leeg** → het IG-account moet een **zakelijk/creator-account** zijn
  dat aan de Facebook-pagina gekoppeld is.
- **Redirect-fout bij koppelen** → de redirect-URI in stap 4 moet **exact** gelijk
  zijn aan `META_REDIRECT_URI` (inclusief https en pad).
