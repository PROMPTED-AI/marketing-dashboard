import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMe } from "../lib/useMe.jsx";
import {
  invitationInfo, acceptInvitation, resetInfo, resetPassword,
} from "../lib/api.js";

const MIN = 8;

// Gedeeld scherm om een wachtwoord in te stellen, gebruikt door zowel de
// uitnodigingslink als de wachtwoord-resetlink. `load` haalt de gegevens op bij
// de token, `submit` slaat het wachtwoord op; beide loggen de gebruiker in.
function SetPasswordScreen({ title, intro, load, submit, cta }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const { reload } = useMe();
  const [info, setInfo] = useState(undefined); // undefined = laden, null = ongeldig
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    load(token).then((d) => { if (alive) setInfo(d); }).catch(() => { if (alive) setInfo(null); });
    return () => { alive = false; };
  }, [token]);

  const problem =
    pw.length < MIN ? `Minimaal ${MIN} tekens.` :
    pw !== pw2 ? "De wachtwoorden komen niet overeen." : null;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy || problem) return;
    setBusy(true);
    setError(null);
    try {
      await submit(token, pw);
      reload();
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err?.message || "Er ging iets mis. Probeer het opnieuw.");
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--c-page)", color: "var(--c-ink)", padding: 20 }}>
      <div className="card" style={{ width: "100%", maxWidth: 440, padding: "34px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 22 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--c-accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" /></svg>
          </div>
          <div className="display" style={{ fontSize: 22 }}>kompas</div>
        </div>

        {info === undefined ? (
          <div style={{ display: "grid", placeItems: "center", padding: 40 }}><div className="spin" /></div>
        ) : info === null ? (
          <div>
            <div className="display" style={{ fontSize: 24, marginBottom: 8 }}>link is verlopen</div>
            <div style={{ fontSize: 14, color: "var(--c-muted)", lineHeight: 1.6, marginBottom: 22 }}>
              Deze link is verlopen of al gebruikt. Vraag een nieuwe aan of neem contact op met je beheerder.
            </div>
            <button className="btn-primary" style={{ height: 46, width: "100%" }} onClick={() => navigate("/login")}>naar inloggen</button>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="display" style={{ fontSize: 26, marginBottom: 6 }}>{title}</div>
            <div style={{ fontSize: 13.5, color: "var(--c-muted)", lineHeight: 1.55, marginBottom: 22 }}>{intro(info)}</div>

            <label htmlFor="pw" style={lbl}>Nieuw wachtwoord</label>
            <input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="minimaal 8 tekens" style={input} />

            <label htmlFor="pw2" style={{ ...lbl, marginTop: 14 }}>Herhaal wachtwoord</label>
            <input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="••••••••••" style={input} />

            {pw && pw2 && problem && <div style={{ fontSize: 12.5, color: "var(--c-neg)", marginTop: 10 }}>{problem}</div>}
            {error && <div role="alert" style={{ marginTop: 12, padding: "10px 13px", borderRadius: 11, background: "var(--c-neg-soft, #fdecea)", color: "var(--c-neg, #c0392b)", fontSize: 13, fontWeight: 600 }}>{error}</div>}

            <button type="submit" className="btn-primary" disabled={busy || !!problem} style={{ height: 48, width: "100%", marginTop: 22, fontSize: 15, opacity: busy || problem ? 0.6 : 1 }}>
              {busy ? "bezig…" : cta}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export function Invite() {
  return (
    <SetPasswordScreen
      title="welkom"
      cta="wachtwoord instellen en inloggen"
      load={invitationInfo}
      submit={acceptInvitation}
      intro={(info) => (
        <>Je bent uitgenodigd{info.organization_name ? <> voor <strong style={{ color: "var(--c-ink)" }}>{info.organization_name}</strong></> : ""}. Stel een wachtwoord in voor <strong style={{ color: "var(--c-ink)" }}>{info.email}</strong> om te beginnen.</>
      )}
    />
  );
}

export function ResetPassword() {
  return (
    <SetPasswordScreen
      title="nieuw wachtwoord"
      cta="wachtwoord opslaan"
      load={resetInfo}
      submit={resetPassword}
      intro={(info) => (
        <>Stel een nieuw wachtwoord in voor <strong style={{ color: "var(--c-ink)" }}>{info.email}</strong>.</>
      )}
    />
  );
}

const lbl = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 7 };
const input = {
  width: "100%", height: 48, padding: "0 15px", boxSizing: "border-box",
  border: "1px solid var(--c-border)", borderRadius: 12, background: "var(--c-surface-2)",
  fontFamily: "Montserrat, sans-serif", fontSize: 15, color: "var(--c-ink)", outline: "none",
};
