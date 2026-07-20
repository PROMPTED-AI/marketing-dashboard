import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LOGIN_URL, passwordLogin } from "../lib/api.js";
import { useMe } from "../lib/useMe.jsx";

const Star = ({ s = 20 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" />
  </svg>
);

export default function Login() {
  const { reload } = useMe();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await passwordLogin(email, password);
      reload();          // refresh /api/me so the router lets us into /app
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err?.message || "Inloggen mislukt. Probeer het opnieuw.");
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", color: "var(--c-ink)", background: "var(--c-surface)" }}>
      {/* LEFT — form (fills the white half) */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "48px clamp(28px, 7vw, 110px)", background: "var(--c-surface)" }}>
        <div style={{ width: "100%", maxWidth: 420, marginInline: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 48 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: "var(--c-accent)", display: "flex", alignItems: "center", justifyContent: "center" }}><Star /></div>
            <div className="display" style={{ fontSize: 24 }}>kompas</div>
          </div>
          <div className="display" style={{ fontSize: 42, lineHeight: 0.98, marginBottom: 12 }}>welkom terug.</div>
          <div style={{ fontSize: 15, color: "var(--c-muted)", marginBottom: 34 }}>
            log in om je marketingdata, koppelingen en rapporten te beheren.
          </div>

          <form onSubmit={submit}>
            <label htmlFor="login-email" style={{ fontSize: 13, fontWeight: 600, marginBottom: 7, display: "block" }}>E-mailadres</label>
            <div style={field}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--c-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m3 7 9 6 9-6" /></svg>
              <input id="login-email" type="email" autoComplete="username" placeholder="jij@bureau.nl" style={input}
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <label htmlFor="login-password" style={{ fontSize: 13, fontWeight: 600, margin: "18px 0 7px", display: "block" }}>Wachtwoord</label>
            <div style={field}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--c-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="10" width="16" height="11" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
              <input id="login-password" type="password" autoComplete="current-password" placeholder="••••••••••" style={input}
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            {error && (
              <div role="alert" style={{ marginTop: 14, padding: "10px 14px", borderRadius: 12, background: "var(--c-neg-soft, #fdecea)", color: "var(--c-neg, #c0392b)", fontSize: 13, fontWeight: 600 }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "18px 0 26px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--c-ink-soft)", fontWeight: 500 }}>
                <input type="checkbox" /> onthoud mij
              </label>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--c-accent)", cursor: "pointer" }}>Wachtwoord vergeten?</span>
            </div>

            <button type="submit" className="btn-primary" style={{ width: "100%", height: 52, fontSize: 15, opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }} disabled={busy}>
              {busy ? "bezig met inloggen…" : "inloggen"}
              {!busy && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>}
            </button>
          </form>

          <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "22px 0" }}>
            <div style={{ flex: 1, height: 1, background: "var(--c-border)" }} />
            <span style={{ fontSize: 12, color: "var(--c-muted)" }}>of</span>
            <div style={{ flex: 1, height: 1, background: "var(--c-border)" }} />
          </div>

          <a className="btn-ghost" href={LOGIN_URL} style={{ width: "100%", height: 50, fontSize: 14, textDecoration: "none" }}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.6a4.8 4.8 0 0 1-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.5z" /><path fill="#34A853" d="M12 23c2.8 0 5.2-1 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.7A10.4 10.4 0 0 0 12 23z" /><path fill="#FBBC05" d="M6.2 14.6a6.2 6.2 0 0 1 0-4V7.9H2.7a10.4 10.4 0 0 0 0 9.4z" /><path fill="#EA4335" d="M12 5.4c1.5 0 2.9.5 4 1.5l3-3A10.3 10.3 0 0 0 12 1 10.4 10.4 0 0 0 2.7 7.9l3.5 2.7C7 7.2 9.3 5.4 12 5.4z" /></svg>
            inloggen met Google
          </a>
          <div style={{ fontSize: 13, color: "var(--c-muted)", marginTop: 24 }}>
            nog geen account? <span style={{ color: "var(--c-accent)", fontWeight: 700 }}>vraag toegang aan</span>
          </div>
        </div>
      </div>

      {/* RIGHT — marketing panel (fills the blue half) */}
      <div className="login-aside" style={{ flex: 1, maxWidth: 640, background: "var(--c-accent)", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px clamp(44px, 5vw, 76px)" }}>
        <div style={{ position: "absolute", width: 420, height: 420, borderRadius: "50%", border: "1px solid rgba(255,255,255,.16)", top: -140, right: -140 }} />
        <div style={{ position: "absolute", width: 280, height: 280, borderRadius: "50%", border: "1px solid rgba(255,255,255,.16)", top: -70, right: -70 }} />
        <div style={{ position: "absolute", width: 220, height: 220, borderRadius: 34, background: "rgba(255,255,255,.07)", bottom: -50, left: -60, transform: "rotate(20deg)" }} />
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "rgba(255,255,255,.7)", position: "relative" }}>partner in groei</div>
        <div style={{ position: "relative" }}>
          <div className="display" style={{ fontSize: "clamp(38px, 4vw, 54px)", lineHeight: 0.98, color: "#fff", marginBottom: 20 }}>al je marketing<br />op één plek.</div>
          <div style={{ fontSize: 16, lineHeight: 1.6, color: "rgba(255,255,255,.82)", maxWidth: 360 }}>Analytics, ads en SEO gebundeld in heldere dashboards. Minder schakelen, meer overzicht.</div>
        </div>
        <div style={{ position: "relative", display: "flex", gap: 10 }}>
          <div style={{ width: 34, height: 6, borderRadius: 3, background: "#fff" }} />
          <div style={{ width: 14, height: 6, borderRadius: 3, background: "rgba(255,255,255,.4)" }} />
          <div style={{ width: 14, height: 6, borderRadius: 3, background: "rgba(255,255,255,.4)" }} />
        </div>
      </div>
    </div>
  );
}

const field = {
  display: "flex", alignItems: "center", gap: 10, padding: "0 16px", height: 50,
  border: "1px solid var(--c-border)", borderRadius: 999, background: "var(--c-surface-2)", width: "100%",
};
const input = {
  flex: 1, border: "none", outline: "none", background: "transparent",
  fontFamily: "Montserrat, sans-serif", fontSize: 15, color: "var(--c-ink)",
};
