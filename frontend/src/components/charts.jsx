// Lightweight SVG charts that mirror the design (no chart library).

const PALETTE = ["var(--c-accent)", "var(--c-sky)", "var(--c-mint)", "var(--c-orange)", "var(--c-purple)", "var(--c-yellow)"];
export const palette = PALETTE;

// Area chart with soft fill + line, from an array of numbers.
export function AreaChart({ values = [], labels = [], height = 220 }) {
  const W = 940, H = 240;
  if (!values.length) return <Empty height={height} />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const x = (i) => (i / (values.length - 1 || 1)) * W;
  const y = (v) => H - 20 - ((v - min) / span) * (H - 50);
  const pts = values.map((v, i) => `${x(i).toFixed(1)} ${y(v).toFixed(1)}`);
  const line = "M" + pts.join(" L");
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {[40, 100, 160, 220].map((gy) => (
          <line key={gy} x1="0" y1={gy} x2={W} y2={gy} style={{ stroke: "var(--c-track)" }} strokeWidth="1" />
        ))}
        <path d={area} style={{ fill: "var(--c-accent-soft)" }} />
        <path d={line} fill="none" style={{ stroke: "var(--c-accent)" }} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {labels.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--c-muted)", fontWeight: 600, marginTop: 8 }}>
          {labels.map((l, i) => <span key={i}>{l}</span>)}
        </div>
      )}
    </div>
  );
}

// Donut from [{label, pct}] (+ center label). Colors come from the palette.
export function Donut({ segments = [], centerTop, centerSub, size = 160 }) {
  const r = 70, C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
      <svg width={size} height={size} viewBox="0 0 180 180">
        <g transform="rotate(-90 90 90)">
          {segments.map((s, i) => {
            const dash = (s.pct / 100) * C;
            const el = (
              <circle key={i} cx="90" cy="90" r={r} fill="none" style={{ stroke: PALETTE[i % PALETTE.length] }}
                strokeWidth="22" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-offset} />
            );
            offset += dash;
            return el;
          })}
        </g>
      </svg>
      <div style={{ position: "absolute", textAlign: "center" }}>
        <div className="display" style={{ fontSize: 24, lineHeight: 1 }}>{centerTop}</div>
        <div style={{ fontSize: 11, color: "var(--c-muted)" }}>{centerSub}</div>
      </div>
    </div>
  );
}

export function Legend({ segments = [] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, fontSize: 13 }}>
      {segments.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: PALETTE[i % PALETTE.length] }} />
          <span style={{ flex: 1, color: "var(--c-ink-soft)" }}>{s.label}</span>
          <span style={{ fontWeight: 700 }}>{s.pct}%</span>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({ values = [], color = "var(--c-accent)", height = 34 }) {
  const W = 240, H = 40;
  if (!values.length) return <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} />;
  const max = Math.max(...values, 1), min = Math.min(...values, 0), span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1 || 1)) * W).toFixed(1)},${(H - 4 - ((v - min) / span) * (H - 8)).toFixed(1)}`).join(" ");
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" style={{ stroke: color }} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RealtimeBars({ values = [], height = 56 }) {
  const W = 300, H = 56, n = values.length || 30;
  const max = Math.max(...values, 1);
  const bw = 7, gap = (W - n * bw) / (n - 1 || 1);
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <g fill="var(--c-accent)">
        {values.map((v, i) => {
          const h = Math.max(4, (v / max) * (H - 6));
          return <rect key={i} x={i * (bw + gap)} y={H - h} width={bw} height={h} rx="2" />;
        })}
      </g>
    </svg>
  );
}

function Empty({ height }) {
  return (
    <div style={{ height, display: "grid", placeItems: "center", color: "var(--c-muted)", fontSize: 13 }}>
      geen data in deze periode
    </div>
  );
}
