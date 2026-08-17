import { useState } from "react";
import { LOGIN_URL, passwordLogin } from "../lib/api.js";
import { useMe } from "../lib/useMe.jsx";
import { Logo, Illustration } from "../components/Brand.jsx";

export default function Login() {
  const { reload } = useMe();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await passwordLogin(email.trim(), password);
      reload(); // refresh /api/me -> the router redirects to /app
    } catch (err) {
      setError(
        err?.status === 401
          ? "Onjuiste combinatie van e-mailadres en wachtwoord."
          : "Inloggen is niet gelukt. Probeer het opnieuw."
      );
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", color: "var(--c-ink)", background: "var(--c-surface)" }}>
      {/* LEFT — form (fills the white half) */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "48px clamp(28px, 7vw, 110px)", background: "var(--c-surface)" }}>
        <div style={{ width: "100%", maxWidth: 420, marginInline: "auto" }}>
          <Logo size={34} style={{ marginBottom: 48 }} />
          <div className="display" style={{ fontSize: 42, lineHeight: 1.08, letterSpacing: "var(--ls-display)", marginBottom: 12 }}>Welkom terug</div>
          <div style={{ fontSize: 15, color: "var(--c-muted)", marginBottom: 34 }}>
            Log in om je marketingdata, koppelingen en rapporten te beheren.
          </div>

          <form onSubmit={submit}>
            <label htmlFor="login-email" style={{ fontSize: 13, fontWeight: 600, marginBottom: 7, display: "block" }}>E-mailadres</label>
            <div style={field}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--c-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m3 7 9 6 9-6" /></svg>
              <input id="login-email" type="email" autoComplete="email" required placeholder="jij@bureau.nl" style={input} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <label htmlFor="login-password" style={{ fontSize: 13, fontWeight: 600, margin: "18px 0 7px", display: "block" }}>Wachtwoord</label>
            <div style={field}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--c-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="10" width="16" height="11" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
              <input id="login-password" type="password" autoComplete="current-password" required placeholder="••••••••••" style={input} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            {error && (
              <div role="alert" style={{ marginTop: 14, padding: "10px 14px", borderRadius: 12, background: "color-mix(in srgb, var(--c-neg, #d33) 10%, transparent)", color: "var(--c-neg, #d33)", fontSize: 13.5, fontWeight: 600 }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "18px 0 26px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--c-ink-soft)" }}>
                <input type="checkbox" style={{ accentColor: "var(--c-accent)" }} /> Onthoud mij
              </label>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-link)", cursor: "pointer" }}>Wachtwoord vergeten?</span>
            </div>

            <button type="submit" className="btn-primary" style={{ width: "100%", height: 52, fontSize: 15 }} disabled={busy}>
              {busy ? "Bezig met inloggen…" : "Inloggen"}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
            </button>
          </form>

          <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "22px 0" }}>
            <div style={{ flex: 1, height: 1, background: "var(--c-border)" }} />
            <span style={{ fontSize: 12, color: "var(--c-muted)" }}>of</span>
            <div style={{ flex: 1, height: 1, background: "var(--c-border)" }} />
          </div>

          <a className="btn-ghost" href={LOGIN_URL} style={{ width: "100%", height: 50, fontSize: 14, textDecoration: "none" }}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.6a4.8 4.8 0 0 1-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.5z" /><path fill="#34A853" d="M12 23c2.8 0 5.2-1 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.7A10.4 10.4 0 0 0 12 23z" /><path fill="#FBBC05" d="M6.2 14.6a6.2 6.2 0 0 1 0-4V7.9H2.7a10.4 10.4 0 0 0 0 9.4z" /><path fill="#EA4335" d="M12 5.4c1.5 0 2.9.5 4 1.5l3-3A10.3 10.3 0 0 0 12 1 10.4 10.4 0 0 0 2.7 7.9l3.5 2.7C7 7.2 9.3 5.4 12 5.4z" /></svg>
            Inloggen met Google
          </a>
          <div style={{ fontSize: 13, color: "var(--c-muted)", marginTop: 24 }}>
            Nog geen account? <span style={{ color: "var(--text-link)", fontWeight: 600, cursor: "pointer" }}>Vraag toegang aan</span>
          </div>
        </div>
      </div>

      {/* RIGHT — merkpaneel: navy vlak met één subtiele groene glow. */}
      <div className="login-aside" style={aside}>
        <div style={glow} />
        <div className="mm-eyebrow" style={{ color: "rgba(255,255,255,.65)", position: "relative" }}>Partner in groei</div>
        <div style={{ position: "relative" }}>
          <div className="display" style={{ fontSize: "clamp(36px, 3.6vw, 48px)", lineHeight: 1.08, letterSpacing: "var(--ls-display)", color: "#fff", marginBottom: 18 }}>
            Al je marketingdata op één plek
          </div>
          <div style={{ fontSize: 16, lineHeight: 1.5, color: "rgba(255,255,255,.8)", maxWidth: 380 }}>
            Analytics, ads en SEO gebundeld in heldere dashboards. Minder schakelen, meer overzicht.
          </div>
        </div>
        {/* Illustratie staat op een rustig crème vlak, nooit direct op navy. */}
        <div style={illoCard}>
          <Illustration name="mascot-presenteert-dashboard" size={200} />
        </div>
      </div>
    </div>
  );
}

const field = {
  display: "flex", alignItems: "center", gap: 10, padding: "0 16px", height: 50,
  border: "1px solid var(--c-border)", borderRadius: "var(--radius-pill)", background: "var(--c-surface-2)", width: "100%",
};
const input = {
  flex: 1, border: "none", outline: "none", background: "transparent",
  fontFamily: "var(--font-body)", fontSize: 15, color: "var(--c-ink)",
};
const aside = {
  flex: 1, maxWidth: 640, background: "var(--mm-navy-800)", position: "relative", overflow: "hidden",
  display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 40,
  padding: "64px clamp(44px, 5vw, 76px)",
};
const glow = {
  position: "absolute", width: 620, height: 620, top: -220, right: -180, pointerEvents: "none",
  background: "radial-gradient(circle, rgba(8,152,72,.28) 0%, rgba(8,152,72,0) 70%)",
};
const illoCard = {
  position: "relative", background: "var(--mm-cream)", borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-lg)", padding: "20px 28px", display: "flex", justifyContent: "center", alignSelf: "flex-start",
};
