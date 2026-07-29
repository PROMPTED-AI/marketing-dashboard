import { useActiveOrg, ALL_FEATURES_ON } from "../lib/ActiveOrgProvider.jsx";

// Functies die het bureau per klantomgeving aan- of uitzet. De sidebar verbergt
// een uitgeschakeld onderdeel al; deze poort vangt de directe link (bookmark,
// oude tab) op met een uitleg in plaats van een lege pagina of een API-fout.
// De echte grens ligt in de API — die weigert het endpoint hoe dan ook.
const LABELS = {
  signalen: "Signalen",
  assistant: "AI-assistent",
  integrations: "Integraties",
  framework: "Raamwerk",
  dashboards: "Mijn dashboards",
};

export default function FeatureGate({ feature, children }) {
  const { features } = useActiveOrg() || {};
  const on = (features ?? ALL_FEATURES_ON)[feature] !== false;
  if (on) return children;
  return (
    <div className="card" style={{ padding: 28, maxWidth: 560 }}>
      <div className="display" style={{ fontSize: 22, marginBottom: 6 }}>
        {LABELS[feature] || "Dit onderdeel"} staat uit
      </div>
      <div style={{ fontSize: 13.5, color: "var(--c-muted)", lineHeight: 1.6 }}>
        Dit onderdeel is niet geactiveerd voor deze omgeving. Vraag je bureau om
        het aan te zetten als je het wilt gebruiken.
      </div>
    </div>
  );
}

// Kanaalpoort: een kanaalpagina is alleen bereikbaar als Integraties aanstaat
// voor deze omgeving én het bureau dit kanaal heeft toegestaan. De sidebar
// verbergt het item al; dit vangt directe links en oude bookmarks op.
export function ChannelGate({ provider, children }) {
  const { features, channels } = useActiveOrg() || {};
  const visible = (features ?? ALL_FEATURES_ON).integrations !== false
    && (channels ?? {})[provider] !== false;
  if (visible) return children;
  return (
    <div className="card" style={{ padding: 28, maxWidth: 560 }}>
      <div className="display" style={{ fontSize: 22, marginBottom: 6 }}>
        Dit kanaal is niet beschikbaar
      </div>
      <div style={{ fontSize: 13.5, color: "var(--c-muted)", lineHeight: 1.6 }}>
        Dit kanaal is niet geactiveerd voor deze omgeving. Vraag je bureau om
        het beschikbaar te maken als je het wilt gebruiken.
      </div>
    </div>
  );
}
