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

## Project layout

| File | Purpose |
|------|---------|
| `app/config.py` | Loads env vars, defines scopes + OAuth client config |
| `app/oauth.py` | Builds the auth URL, exchanges the code, (de)serializes credentials |
| `app/token_store.py` | Per-user token storage (demo: JSON files — see notes) |
| `app/analytics.py` | Sample GA4 Data API report |
| `app/main.py` | FastAPI routes: login, callback, report |

## Production notes

- **Never** commit `.env` or `client_secret*.json` (already git-ignored).
- Store refresh tokens **encrypted** in a database / secret manager, keyed by
  your own user id — `token_store.py` writes plaintext JSON for demo purposes
  only.
- Keep the **Client Secret** server-side only.
- Let users pick which GA property to query (the Analytics Admin API can list
  the properties they have access to).
