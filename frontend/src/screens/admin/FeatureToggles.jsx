// Functieschakelaars: welke onderdelen krijgt deze klantomgeving? Het bureau
// zet ze per account aan of uit; de klant ziet alleen wat aanstaat en de API
// weigert de rest. Gebruikt in de klant-wizard (vóór het aanmaken, zonder
// server) en in het omgevingsscherm (met opslaan per klant).

export const FEATURE_LABELS = {
  signalen: "Signalen",
  assistant: "AI-assistent",
  integrations: "Integraties",
  framework: "Raamwerk",
  dashboards: "Mijn dashboards",
};

const FEATURE_HINTS = {
  signalen: "Automatisch gedetecteerde veranderingen per kanaal, plus de notificatiebel.",
  assistant: "Chatten met de data en AI-advies bij signalen en dashboards.",
  integrations: "De klant koppelt zelf bronnen. Uit = jij richt de omgeving in.",
  framework: "Maandelijkse KPI-tabel met handmatige velden (budget, marge, retouren).",
  dashboards: "Eigen dashboards samenstellen uit widgets.",
};

// De volgorde waarin de functies getoond worden (vast, niet uit de server).
export const FEATURE_ORDER = ["signalen", "assistant", "integrations", "framework", "dashboards"];

export default function FeatureToggles({ features, onChange, disabled = false }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {FEATURE_ORDER.map((key) => {
        const on = features?.[key] !== false;
        return (
          <label key={key} style={{ ...row, opacity: disabled ? 0.6 : 1, cursor: disabled ? "default" : "pointer" }}>
            <input
              type="checkbox"
              checked={on}
              disabled={disabled}
              onChange={(e) => onChange({ ...features, [key]: e.target.checked })}
              style={{ width: 16, height: 16, accentColor: "var(--c-accent)", flex: "none", marginTop: 2 }}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>{FEATURE_LABELS[key]}</span>
              <span style={{ display: "block", fontSize: 12, color: "var(--c-muted)", marginTop: 1 }}>{FEATURE_HINTS[key]}</span>
            </span>
            <span className={`pill ${on ? "pos" : "muted"}`} style={{ fontSize: 11, flex: "none" }}>{on ? "aan" : "uit"}</span>
          </label>
        );
      })}
    </div>
  );
}

// Kanalen die het bureau per klantaccount kan toestaan. Alleen relevant als de
// functie Integraties aanstaat: uit = geen enkel kanaal zichtbaar, aan = de
// klant ziet (en koppelt) precies de aangevinkte kanalen.
//
// De lijst komt uit de meegegeven `channels`-stand (de server kent alle kanalen,
// inclusief kanalen die er later bij komen). Alleen het label is hier netter
// gemaakt; een onbekende sleutel wordt afgeleid, zodat een nieuw kanaal meteen
// verschijnt zonder aanpassing.
const CHANNEL_LABEL_OVERRIDES = {
  google_analytics: "Google Analytics",
  search_console: "Search Console",
  google_ads: "Google Ads",
  meta_ads: "META (Ads en Organisch)",
  woocommerce: "WooCommerce",
  shopify: "Shopify",
};

export function channelLabel(key) {
  return CHANNEL_LABEL_OVERRIDES[key]
    || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ChannelToggles({ channels, onChange, disabled = false }) {
  const keys = Object.keys(channels || {});
  if (!keys.length) {
    return <div style={{ fontSize: 12.5, color: "var(--c-muted)" }}>Kanalen worden geladen…</div>;
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {keys.map((key) => {
        const on = channels?.[key] !== false;
        return (
          <label key={key} style={{ ...chip, opacity: disabled ? 0.6 : 1, cursor: disabled ? "default" : "pointer", borderColor: on ? "var(--c-accent)" : "var(--c-border)" }}>
            <input
              type="checkbox"
              checked={on}
              disabled={disabled}
              onChange={(e) => onChange({ ...channels, [key]: e.target.checked })}
              style={{ width: 15, height: 15, accentColor: "var(--c-accent)", flex: "none" }}
            />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: on ? "var(--c-ink)" : "var(--c-muted)" }}>{channelLabel(key)}</span>
          </label>
        );
      })}
    </div>
  );
}

// Korte samenvatting voor in een tabel: "alle functies" of de uitgezette namen.
export function featureSummary(features) {
  const off = FEATURE_ORDER.filter((k) => features?.[k] === false);
  if (!off.length) return "alle functies";
  if (off.length === FEATURE_ORDER.length) return "geen functies";
  return `zonder ${off.map((k) => FEATURE_LABELS[k].toLowerCase()).join(", ")}`;
}

const row = {
  display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
  borderRadius: 11, border: "1px solid var(--c-border-soft)", background: "var(--c-surface-2)",
};
const chip = {
  display: "flex", alignItems: "center", gap: 7, padding: "7px 11px",
  borderRadius: 10, border: "1px solid var(--c-border)", background: "var(--c-surface-2)",
};
