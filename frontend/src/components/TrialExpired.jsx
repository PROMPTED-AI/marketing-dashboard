import { LOGOUT_URL } from "../lib/api.js";
import { IcStar } from "./icons.jsx";

const CONTACT_EMAIL = "info@prompted-ai.nl";

// Volledig scherm dat het dashboard vervangt zodra de proefperiode van de
// organisatie is verlopen. De gebruiker kan alleen nog contact opnemen voor
// een betaalde verlenging of uitloggen; de agency admin ziet dit scherm nooit
// en beheert de proefperiodes via Klantenbeheer.
export default function TrialExpired({ me }) {
  const orgName = me?.organization?.name || "je organisatie";
  const mailto =
    `mailto:${CONTACT_EMAIL}` +
    `?subject=${encodeURIComponent("Verlenging Kompas voor " + orgName)}` +
    `&body=${encodeURIComponent("Hallo,\n\nOnze proefperiode van Kompas is verlopen. Wij willen graag een betaalde verlenging bespreken.\n\nOrganisatie: " + orgName + "\nContactpersoon: " + (me?.email || ""))}`;

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--c-page)", color: "var(--c-ink)", padding: 24 }}>
      <div className="card" style={{ maxWidth: 480, width: "100%", padding: "42px 40px", textAlign: "center" }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: "var(--c-accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
          <IcStar />
        </div>
        <div className="display" style={{ fontSize: 26, marginBottom: 10 }}>je proefperiode is verlopen</div>
        <div style={{ fontSize: 14.5, color: "var(--c-muted)", lineHeight: 1.6, marginBottom: 26 }}>
          De proefperiode van 14 dagen voor <strong style={{ color: "var(--c-ink)" }}>{orgName}</strong> is
          afgelopen. Je gegevens en koppelingen blijven veilig bewaard. Neem contact met ons op voor een
          betaalde verlenging, dan zetten we je account direct weer aan.
        </div>
        <a className="btn-primary" href={mailto} style={{ height: 46, padding: "0 24px", textDecoration: "none", width: "100%", boxSizing: "border-box" }}>
          Neem contact op
        </a>
        <div style={{ marginTop: 12 }}>
          <a className="btn-ghost" href={LOGOUT_URL} style={{ height: 42, padding: "0 20px", textDecoration: "none", width: "100%", boxSizing: "border-box" }}>
            Uitloggen
          </a>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--c-muted)", marginTop: 18 }}>
          Of mail ons direct via {CONTACT_EMAIL}
        </div>
      </div>
    </div>
  );
}
