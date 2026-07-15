# Marketing Dashboard — Google Analytics (GA4) OAuth connection

A minimal Python/FastAPI skeleton that lets **external users log in with their
own Google account** and grant your app read access to their Google Analytics
4 data via the **Google Analytics Data API**.

We use **OAuth 2.0** (not a service account) on purpose: external users own
their own GA properties, so they must grant access themselves through Google's
consent screen. A service account would only reach properties you explicitly
shared with it — which doesn't scale to unknown external users.

## 1. Google Cloud setup

1. Create / pick a project at <https://console.cloud.google.com>.
2. **APIs & Services → Library** → enable **Google Analytics Data API**.
3. **OAuth consent screen**:
   - User type **External**.
   - Add scope `https://www.googleapis.com/auth/analytics.readonly`.
   - Add test users while in *Testing*; **publish** the app for real users.
4. **Credentials → Create credentials → OAuth client ID**:
   - Application type **Web application**.
   - Authorized redirect URI: `http://localhost:8000/api/auth/google/callback`
     (and your production URL later).
   - Copy the **Client ID** and **Client Secret**.

## 2. Local config

```bash
cp .env.example .env      # then fill in the values
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## 3. Run

```bash
uvicorn app.main:app --reload
```

Then in the browser:

1. Open <http://localhost:8000/api/auth/google/login> and complete the consent.
2. You'll be redirected back and "connected".
3. Open `http://localhost:8000/api/analytics/report?property_id=YOUR_GA4_PROPERTY_ID`
   (find the numeric Property ID under GA4 **Admin → Property Settings**).

## Demo account

On startup the app seeds a demo organization ("Janssen", flagged `is_demo`)
with a password login and generated sample data, so the product can be shown
without connecting a real Google account:

- **Email:** `info@janssen.nl`
- **Password:** `janssen123`

Demo organizations never call the Google APIs: `app/demo.py` generates
deterministic GA4 + Search Console sample data (same date range → same
numbers). Password sign-in (`POST /api/auth/login`) works for any user with a
`password_hash` set; everyone else keeps using the Google flow.

## Project layout

| File | Purpose |
|------|---------|
| `app/config.py` | Loads env vars, defines scopes + OAuth client config |
| `app/oauth.py` | Builds the auth URL, exchanges the code, (de)serializes credentials |
| `app/db.py` | Postgres connection pool + schema |
| `app/crypto.py` | Fernet encryption for tokens at rest |
| `app/token_store.py` | Per-user token storage (encrypted, in Postgres) |
| `app/analytics.py` | Sample GA4 Data API report |
| `app/main.py` | FastAPI routes: login, callback, report |
| `Dockerfile` | Container image for Cloud Run |

## Deployment (Google Cloud Run + Neon + Netlify)

Recommended architecture for external users:

```
prompted-ai.nl (Netlify)        ->  static frontend / dashboard UI
api.<your-domain>  (Cloud Run)  ->  this FastAPI backend (HTTPS, scales to zero)
Neon (serverless Postgres)      ->  encrypted token storage
```

### 1. Database — Neon

1. Create a project at <https://neon.tech> and copy the **pooled** connection
   string (host contains `-pooler`).
2. Use it as `DATABASE_URL`. The `ga_tokens` table is created automatically on
   first startup.

### 2. Secrets

```bash
# Fernet key for encrypting stored tokens
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
`SESSION_SECRET`, `DATABASE_URL` and `TOKEN_ENCRYPTION_KEY` as Cloud Run
environment variables (ideally backed by Secret Manager) — never in the repo.

### 3. Deploy to Cloud Run

```bash
gcloud run deploy ga-oauth-backend \
  --source . \
  --region europe-west4 \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_REDIRECT_URI=https://api.<your-domain>/api/auth/google/callback,..."
```

(`--source .` builds the `Dockerfile` for you. Add the remaining env vars, or
wire them via Secret Manager with `--set-secrets`.)

### 4. Wire up OAuth + DNS

- Add `https://api.<your-domain>/api/auth/google/callback` as an **Authorized
  redirect URI** on the OAuth client, and set `GOOGLE_REDIRECT_URI` to match.
- Map the Cloud Run service to your subdomain (Cloud Run **Custom domains**, or
  a Netlify proxy/redirect rule from `prompted-ai.nl` to the backend).
- **Publish** the OAuth consent screen so non-test users can sign in.

> **Note on Netlify:** Netlify hosts the *frontend* only — it runs static sites
> and short-lived JS/TS functions, not a persistent Python server, so this
> FastAPI backend runs on Cloud Run instead.

## Production notes

- **Never** commit `.env` or `client_secret*.json` (already git-ignored).
- Tokens are stored **encrypted** (Fernet) in Postgres, keyed by user id.
  Rotating `TOKEN_ENCRYPTION_KEY` invalidates stored tokens (users reconnect).
- Keep the **Client Secret** server-side only.
- Map the session to **your own authenticated user id** before going live; the
  skeleton uses a per-session UUID.
- Let users pick which GA property to query (the Analytics Admin API can list
  the properties they have access to).
