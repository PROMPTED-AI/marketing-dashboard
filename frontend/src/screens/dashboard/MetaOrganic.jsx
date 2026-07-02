import { useEffect, useState } from "react";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDateRange } from "../../lib/PeriodProvider.jsx";
import { useCachedApi } from "../../lib/swr.js";
import { metaAccountsUrl, metaOrganicReportUrl } from "../../lib/urls.js";
import { num } from "../../lib/format.js";
import { SectionCard, TabState } from "../../components/ui.jsx";
import ExportButton from "../../components/ExportButton.jsx";
import { MetaGlyph } from "../../components/icons.jsx";

const growth = (v) => ((v || 0) >= 0 ? "+" : "") + num(v);

const VIEWS = [
  { id: "overview", name: "Organisch-overzicht" },
  { id: "facebook", name: "Facebook" },
  { id: "instagram", name: "Instagram" },
];

export default function MetaOrganic() {
  const { orgId } = useActiveOrg();
  const { start, end, label } = useDateRange();
  const [view, setView] = useState(() => localStorage.getItem("kompas-meta-organic-view") || "overview");
  const pickView = (id) => { setView(id); localStorage.setItem("kompas-meta-organic-view", id); };

  const { data: assets, loading, error: assetsErr } = useCachedApi(metaAccountsUrl(orgId));
  const pages = assets?.pages || null;

  const [pageId, setPageId] = useState("");
  useEffect(() => { if (pages) setPageId((c) => (c && pages.some((p) => p.id === c) ? c : pages[0]?.id || "")); }, [pages]);

  const page = pages?.find((p) => p.id === pageId) || null;
  const ig = page?.instagram || null;

  const { data: organic, error: orgErr } = useCachedApi(pageId ? metaOrganicReportUrl(pageId, ig?.id, start, end, orgId) : null);
  const fb = organic?.facebook && Object.keys(organic.facebook).length ? organic.facebook : null;
  const insta = organic?.instagram || null;

  const sections = () => {
    const out = [];
    if (fb)
      out.push({ title: "Facebook (organisch) — " + label, columns: ["Metric", "Waarde"], rows: [
        ["Volgers", fb.followers], ["Volgersgroei", fb.followers_growth],
        ["Bereik", fb.reach], ["Vertoningen", fb.impressions], ["Betrokkenheid", fb.engagement]] });
    if (insta)
      out.push({ title: "Instagram (organisch) — " + label, columns: ["Metric", "Waarde"], rows: [
        ["Volgers", insta.followers], ["Volgersgroei", insta.followers_growth],
        ["Bereik", insta.reach], ["Vertoningen", insta.impressions], ["Profielbezoeken", insta.profile_views]] });
    return out;
  };

  if (loading) return <TabState loading />;
  if (assetsErr) return <TabState error={assetsErr} onConnect />;
  if (!pages?.length)
    return (
      <div>
        <Header label={label} />
        <div className="card" style={{ padding: 28, color: "var(--c-muted)" }}>Geen Meta-pagina's gevonden voor deze koppeling.</div>
      </div>
    );

  return (
    <div>
      <Header
        label={label}
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {pages?.length > 1 && (
              <select value={pageId} onChange={(e) => setPageId(e.target.value)} style={selectStyle} title="Pagina">
                {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            {organic && <ExportButton filename="meta-organisch" sections={sections} />}
          </div>
        }
      />

      {/* view-switcher */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {VIEWS.map((v) => {
          const on = v.id === view;
          return (
            <button key={v.id} onClick={() => pickView(v.id)} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 999,
              border: "1px solid " + (on ? "var(--c-accent)" : "var(--c-border)"),
              background: on ? "var(--c-accent)" : "var(--c-surface)",
              color: on ? "#fff" : "var(--c-ink)", fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}>
              {v.name}
            </button>
          );
        })}
      </div>

      <TabState error={orgErr} />
      {!orgErr && !organic && <TabState loading />}

      {/* ---- Organisch-overzicht ---- */}
      {view === "overview" && organic && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <SectionCard title="Facebook" style={{ flex: 1, minWidth: 280 }}>
            {fb ? (
              <KpiRow items={[
                ["Volgers", num(fb.followers)],
                ["Groei", growth(fb.followers_growth)],
                ["Bereik", num(fb.reach)],
                ["Betrokkenheid", num(fb.engagement)],
              ]} />
            ) : <Empty>geen Facebook-paginadata.</Empty>}
          </SectionCard>
          <SectionCard title={"Instagram" + (insta?.username ? " · @" + insta.username : "")} style={{ flex: 1, minWidth: 280 }}>
            {insta ? (
              <KpiRow items={[
                ["Volgers", num(insta.followers)],
                ["Groei", growth(insta.followers_growth)],
                ["Bereik", num(insta.reach)],
                ["Profielbezoeken", num(insta.profile_views)],
              ]} />
            ) : <Empty>geen gekoppeld Instagram-account.</Empty>}
          </SectionCard>
        </div>
      )}

      {/* ---- Facebook ---- */}
      {view === "facebook" && (
        <SectionCard title="Facebook-pagina">
          {fb ? (
            <>
              <KpiRow items={[
                ["Volgers", num(fb.followers)],
                ["Volgersgroei", growth(fb.followers_growth)],
                ["Bereik", num(fb.reach)],
                ["Vertoningen", num(fb.impressions)],
                ["Betrokkenheid", num(fb.engagement)],
              ]} />
              <PostList posts={fb.top_posts} />
            </>
          ) : <Empty>geen Facebook-paginadata.</Empty>}
        </SectionCard>
      )}

      {/* ---- Instagram ---- */}
      {view === "instagram" && (
        <SectionCard title={"Instagram" + (insta?.username ? " · @" + insta.username : "")}>
          {ig == null ? <Empty>geen gekoppeld Instagram-account.</Empty> : insta ? (
            <>
              <KpiRow items={[
                ["Volgers", num(insta.followers)],
                ["Volgersgroei", growth(insta.followers_growth)],
                ["Bereik", num(insta.reach)],
                ["Vertoningen", num(insta.impressions)],
                ["Profielbezoeken", num(insta.profile_views)],
              ]} />
              <PostList posts={insta.top_posts} />
            </>
          ) : <Empty>geen Instagram-data.</Empty>}
        </SectionCard>
      )}
    </div>
  );
}

function Header({ right, label }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: "#E7F0FF", display: "flex", alignItems: "center", justifyContent: "center" }}><MetaGlyph s={20} /></div>
        <div><div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1 }}>META Organisch</div><div style={{ fontSize: 11.5, color: "var(--c-muted)" }}>Facebook & Instagram — organische resultaten</div></div>
        <div style={{ flex: 1 }} />
        {right}
      </div>
      <div className="display" style={{ fontSize: 28, marginBottom: 4 }}>meta organisch</div>
      <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 16 }}>{label} · live via je Meta-koppeling</div>
    </div>
  );
}

function KpiRow({ items }) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
      {items.map(([kk, v], i) => (
        <div key={i} style={{ flex: 1, minWidth: 110 }}>
          <div style={{ fontSize: 11.5, color: "var(--c-muted)", fontWeight: 600 }}>{kk}</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function PostList({ posts }) {
  if (!posts?.length) return <div style={{ color: "var(--c-muted)", fontSize: 13 }}>geen posts in deze periode.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
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

function Empty({ children }) {
  return <div style={{ color: "var(--c-muted)", fontSize: 13, padding: "8px 0" }}>{children}</div>;
}

const selectStyle = { padding: "8px 12px", fontSize: 13, borderRadius: 999, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", maxWidth: 260 };
