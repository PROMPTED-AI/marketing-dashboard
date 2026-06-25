import { useEffect, useState } from "react";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDateRange } from "../../lib/PeriodProvider.jsx";
import { useCachedApi } from "../../lib/swr.js";
import { metaAccountsUrl, metaAdsReportUrl, metaOrganicReportUrl } from "../../lib/urls.js";
import { num, pct1, deltaProps } from "../../lib/format.js";
import { KpiCard, SectionCard, TabState } from "../../components/ui.jsx";
import ExportButton from "../../components/ExportButton.jsx";
import { MetaGlyph } from "../../components/icons.jsx";

const growth = (v) => ((v || 0) >= 0 ? "+" : "") + num(v);
const statusLabel = (s) => {
  if (!s) return "—";
  const map = { ACTIVE: "actief", PAUSED: "gepauzeerd", ARCHIVED: "gearchiveerd", DELETED: "verwijderd" };
  return map[s] || s.toLowerCase();
};

const money = (v, cur) =>
  new Intl.NumberFormat("nl-NL", cur ? { style: "currency", currency: cur } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
const roas = (v) => (v || 0).toFixed(2).replace(".", ",") + "×";

export default function Meta() {
  const { orgId } = useActiveOrg();
  const { start, end, compare, label } = useDateRange();

  const { data: assets, loading, error: assetsErr } = useCachedApi(metaAccountsUrl(orgId));
  const adAccounts = assets?.ad_accounts || null;
  const pages = assets?.pages || null;

  const [adAccount, setAdAccount] = useState("");
  const [pageId, setPageId] = useState("");

  useEffect(() => {
    if (adAccounts) setAdAccount((cur) => (cur && adAccounts.some((a) => a.id === cur) ? cur : adAccounts[0]?.id || ""));
  }, [adAccounts]);
  useEffect(() => {
    if (pages) setPageId((cur) => (cur && pages.some((p) => p.id === cur) ? cur : pages[0]?.id || ""));
  }, [pages]);

  const page = pages?.find((p) => p.id === pageId) || null;
  const ig = page?.instagram || null;
  const currency = adAccounts?.find((a) => a.id === adAccount)?.currency;

  const { data: ads, error: adsErr } = useCachedApi(metaAdsReportUrl(adAccount, start, end, compare, orgId));
  const { data: organic, error: orgErr } = useCachedApi(metaOrganicReportUrl(pageId, ig?.id, start, end, orgId));

  const sections = () => {
    const out = [];
    if (ads?.kpis) {
      out.push({ title: "META Ads — " + label });
      out.push({ columns: ["Metric", "Waarde"], rows: [
        ["Uitgaven", (ads.kpis.spend || 0).toFixed(2)],
        ["Vertoningen", ads.kpis.impressions],
        ["Bereik", ads.kpis.reach],
        ["Frequentie", (ads.kpis.frequency || 0).toFixed(2)],
        ["Klikken", ads.kpis.clicks],
        ["CTR %", (ads.kpis.ctr || 0).toFixed(2)],
        ["CPC", (ads.kpis.cpc || 0).toFixed(2)],
        ["CPM", (ads.kpis.cpm || 0).toFixed(2)],
      ] });
      if (ads.results?.length)
        out.push({ title: "Resultaten per doel", columns: ["Doel", "Aantal", "Waarde", "ROAS", "CPA"],
          rows: ads.results.map((r) => [r.goal, r.count, (r.value || 0).toFixed(2), (r.roas || 0).toFixed(2), (r.cpa || 0).toFixed(2)]) });
      if (ads.campaigns?.length)
        out.push({ title: "Campagnes", columns: ["Campagne", "Doelstelling", "Status", "Uitgaven", "Klikken", "CTR %", "Resultaten"],
          rows: ads.campaigns.map((c) => [c.name, c.objective || "", c.status || "", (c.spend || 0).toFixed(2), c.clicks, (c.ctr || 0).toFixed(2), c.results]) });
    }
    if (organic?.facebook && Object.keys(organic.facebook).length)
      out.push({ title: "Facebook (organisch)", columns: ["Metric", "Waarde"], rows: [
        ["Volgers", organic.facebook.followers], ["Volgersgroei", organic.facebook.followers_growth],
        ["Bereik", organic.facebook.reach], ["Vertoningen", organic.facebook.impressions], ["Betrokkenheid", organic.facebook.engagement],
      ] });
    if (organic?.instagram)
      out.push({ title: "Instagram (organisch)", columns: ["Metric", "Waarde"], rows: [
        ["Volgers", organic.instagram.followers], ["Volgersgroei", organic.instagram.followers_growth],
        ["Bereik", organic.instagram.reach], ["Vertoningen", organic.instagram.impressions], ["Profielbezoeken", organic.instagram.profile_views],
      ] });
    return out;
  };

  if (loading) return <TabState loading />;
  if (assetsErr) return <TabState error={assetsErr} onConnect />;
  if (!adAccounts?.length && !pages?.length)
    return (
      <div>
        <Header label={label} />
        <div className="card" style={{ padding: 28, color: "var(--c-muted)" }}>
          Geen Meta-advertentieaccounts of pagina's gevonden voor deze koppeling.
        </div>
      </div>
    );

  return (
    <div>
      <Header
        label={label}
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {adAccounts?.length > 1 && (
              <select value={adAccount} onChange={(e) => setAdAccount(e.target.value)} style={selectStyle} title="Advertentieaccount">
                {adAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            {pages?.length > 1 && (
              <select value={pageId} onChange={(e) => setPageId(e.target.value)} style={selectStyle} title="Pagina">
                {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            {(ads || organic) && <ExportButton filename="meta-social" sections={sections} />}
          </div>
        }
      />

      {/* ---------------- BETAALD ---------------- */}
      <SectionTitle>Betaald — META Ads</SectionTitle>
      {!adAccount ? (
        <Empty>Geen advertentieaccount gekoppeld.</Empty>
      ) : (
        <>
          <TabState error={adsErr} />
          {!adsErr && !ads && <TabState loading />}
          {ads?.kpis && (
            <>
              <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
                <KpiCard label="Uitgaven" value={money(ads.kpis.spend, currency)} {...(ads.deltas ? deltaProps(ads.deltas.spend, false) : {})} />
                <KpiCard label="Vertoningen" value={num(ads.kpis.impressions)} {...(ads.deltas ? deltaProps(ads.deltas.impressions, true) : {})} />
                <KpiCard label="Bereik" value={num(ads.kpis.reach)} {...(ads.deltas ? deltaProps(ads.deltas.reach, true) : {})} />
                <KpiCard label="Klikken" value={num(ads.kpis.clicks)} {...(ads.deltas ? deltaProps(ads.deltas.clicks, true) : {})} />
                <KpiCard label="CTR" value={pct1(ads.kpis.ctr)} {...(ads.deltas ? deltaProps(ads.deltas.ctr, true) : {})} />
                <KpiCard label="CPC" value={money(ads.kpis.cpc, currency)} {...(ads.deltas ? deltaProps(ads.deltas.cpc, false) : {})} />
                <KpiCard label="Frequentie" value={(ads.kpis.frequency || 0).toFixed(2).replace(".", ",")} />
                <KpiCard label="CPM" value={money(ads.kpis.cpm, currency)} {...(ads.deltas ? deltaProps(ads.deltas.cpm, false) : {})} />
              </div>

              <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
                <SectionCard title="resultaten per conversiedoel" style={{ flex: 1, minWidth: 320 }}>
                  {ads.results?.length ? (
                    <Table
                      head={["Doel", "Aantal", "Waarde", "ROAS", "CPA"]}
                      cols="2fr 1fr 1fr 0.8fr 1fr"
                      rows={ads.results.map((r) => [r.goal, num(r.count), money(r.value, currency), roas(r.roas), money(r.cpa, currency)])}
                    />
                  ) : <Empty>geen conversieresultaten in deze periode.</Empty>}
                </SectionCard>
              </div>

              <SectionCard title="campagnes">
                {ads.campaigns?.length ? (
                  <Table
                    head={["Campagne", "Doelstelling", "Status", "Uitgaven", "Klikken", "CTR", "Resultaten"]}
                    cols="1.8fr 1.1fr 0.9fr 1fr 0.8fr 0.7fr 0.9fr"
                    rows={ads.campaigns.map((c) => [c.name, c.objective || "—", statusLabel(c.status), money(c.spend, currency), num(c.clicks), pct1(c.ctr), num(c.results)])}
                  />
                ) : <Empty>geen campagnedata in deze periode.</Empty>}
              </SectionCard>
            </>
          )}
        </>
      )}

      {/* ---------------- ORGANISCH ---------------- */}
      <SectionTitle>Organisch</SectionTitle>
      <TabState error={orgErr} />
      {!orgErr && !organic && pageId && <TabState loading />}
      {!pageId && <Empty>Geen Facebook-pagina gekoppeld.</Empty>}

      {organic && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {/* Facebook */}
          <SectionCard title="Facebook-pagina" style={{ flex: 1, minWidth: 320 }}>
            {organic.facebook && Object.keys(organic.facebook).length ? (
              <>
                <KpiRow items={[
                  ["Volgers", num(organic.facebook.followers)],
                  ["Volgersgroei", growth(organic.facebook.followers_growth)],
                  ["Bereik", num(organic.facebook.reach)],
                  ["Vertoningen", num(organic.facebook.impressions)],
                  ["Betrokkenheid", num(organic.facebook.engagement)],
                ]} />
                <PostList posts={organic.facebook.top_posts} />
              </>
            ) : <Empty>geen Facebook-paginadata.</Empty>}
          </SectionCard>

          {/* Instagram */}
          <SectionCard title={"Instagram" + (organic.instagram?.username ? " · @" + organic.instagram.username : "")} style={{ flex: 1, minWidth: 320 }}>
            {ig == null ? (
              <Empty>geen gekoppeld Instagram-account.</Empty>
            ) : organic.instagram ? (
              <>
                <KpiRow items={[
                  ["Volgers", num(organic.instagram.followers)],
                  ["Volgersgroei", growth(organic.instagram.followers_growth)],
                  ["Bereik", num(organic.instagram.reach)],
                  ["Vertoningen", num(organic.instagram.impressions)],
                  ["Profielbezoeken", num(organic.instagram.profile_views)],
                ]} />
                <PostList posts={organic.instagram.top_posts} />
              </>
            ) : <Empty>geen Instagram-data.</Empty>}
          </SectionCard>
        </div>
      )}
    </div>
  );
}

function Header({ right, label }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: "#E7F0FF", display: "flex", alignItems: "center", justifyContent: "center" }}><MetaGlyph s={20} /></div>
        <div><div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1 }}>META / social</div><div style={{ fontSize: 11.5, color: "var(--c-muted)" }}>Facebook & Instagram — betaald en organisch</div></div>
        <div style={{ flex: 1 }} />
        {right}
      </div>
      <div className="display" style={{ fontSize: 28, marginBottom: 4 }}>meta / social</div>
      <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 18 }}>{label} · live via je Meta-koppeling</div>
    </div>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--c-accent)", margin: "10px 0 14px" }}>{children}</div>;
}

function KpiRow({ items }) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
      {items.map(([k, v], i) => (
        <div key={i} style={{ flex: 1, minWidth: 110 }}>
          <div style={{ fontSize: 11.5, color: "var(--c-muted)", fontWeight: 600 }}>{k}</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function PostList({ posts }) {
  if (!posts?.length) return <div style={{ color: "var(--c-muted)", fontSize: 13 }}>geen posts in deze periode.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-muted)" }}>top-posts</div>
      {posts.map((p, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, borderBottom: "1px solid var(--c-border-soft)", paddingBottom: 8 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.text || "(zonder tekst)"} <span style={{ color: "var(--c-muted)" }}>· {p.date}</span></span>
          <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{num(p.engagement)} ⟡</span>
        </div>
      ))}
    </div>
  );
}

function Table({ head, cols, rows }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ ...headStyle, gridTemplateColumns: cols }}>
        {head.map((h, i) => <span key={i} style={i === 0 ? {} : { textAlign: "right" }}>{h}</span>)}
      </div>
      {rows.map((r, ri) => (
        <div key={ri} style={{ ...rowStyle, gridTemplateColumns: cols }}>
          {r.map((cell, ci) => (
            <span key={ci} style={{ textAlign: ci === 0 ? "left" : "right", fontWeight: ci === 0 ? 600 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: ci === 0 ? "var(--c-ink)" : "var(--c-muted)" }}>{cell}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ color: "var(--c-muted)", fontSize: 13, padding: "8px 0 18px" }}>{children}</div>;
}

const selectStyle = { padding: "8px 12px", fontSize: 13, borderRadius: 999, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", maxWidth: 260 };
const headStyle = { display: "grid", gap: 12, fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-muted)", paddingBottom: 10, borderBottom: "1px solid var(--c-border)" };
const rowStyle = { display: "grid", gap: 12, fontSize: 13, padding: "11px 0", borderBottom: "1px solid var(--c-border-soft)", alignItems: "center" };
