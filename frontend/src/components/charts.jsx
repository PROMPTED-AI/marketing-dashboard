// Lightweight SVG charts that mirror the design (no chart library).
import { useState, useRef } from "react";
import { num } from "../lib/format.js";

// Show at most 5 evenly spaced axis labels.
function pickAxis(all) {
  if (all.length <= 5) return all;
  const step = (all.length - 1) / 4;
  return [0, 1, 2, 3, 4].map((i) => all[Math.round(i * step)]);
}

const PALETTE = ["var(--c-accent)", "var(--c-sky)", "var(--c-mint)", "var(--c-orange)", "var(--c-purple)", "var(--c-yellow)"];
export const palette = PALETTE;

// Round a max up to a "nice" axis value so the Y-axis reads cleanly.
function niceMax(v) {
  if (!v || v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

// Area chart with soft fill + line, a labelled Y-axis and gridlines. Hovering
// reveals the exact value (+ comparison) for that point via a marker + tooltip.
// `labels` is one entry per value (the full series); the axis is downsampled.
// `compareValues` adds a dashed "previous" line. Baseline is 0.
export function AreaChart({ values = [], labels = [], compareValues = null, height = 220, unit = "" }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  if (!values.length) return <Empty height={height} />;
  const W = 940, H = 240;
  const n = values.length;
  const dataMax = Math.max(...values, ...(compareValues || []), 1);
  const max = niceMax(dataMax);
  const y = (v) => H - (v / max) * H;
  const xf = (arr, i) => (i / (arr.length - 1 || 1)) * W;
  const path = (arr) => "M" + arr.map((v, i) => `${xf(arr, i).toFixed(1)} ${y(v).toFixed(1)}`).join(" L");
  const line = path(values);
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => max * f);
  const axisLabels = pickAxis(labels);

  const onMove = (e) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - rect.left) / rect.width) * (n - 1))));
    setHover(i);
  };

  const hx = hover != null ? (hover / (n - 1 || 1)) * 100 : 0;
  const hy = hover != null ? (1 - values[hover] / max) * 100 : 0;
  const nearRight = hx > 70;

  return (
    <div style={{ display: "flex", gap: 10 }}>
      <div style={{ height, display: "flex", flexDirection: "column", justifyContent: "space-between", fontSize: 10.5, color: "var(--c-muted)", fontWeight: 600, textAlign: "right", minWidth: 30, flex: "none" }}>
        {ticks.map((t, i) => <span key={i}>{num(t)}</span>)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ position: "relative", height, cursor: "crosshair" }}>
          {ticks.map((_, i) => (
            <div key={i} style={{ position: "absolute", left: 0, right: 0, top: `${(i / (ticks.length - 1)) * 100}%`, borderTop: "1px solid var(--c-track)" }} />
          ))}
          <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: "relative", display: "block" }}>
            <path d={area} style={{ fill: "var(--c-accent-soft)" }} />
            {compareValues && compareValues.length > 0 && (
              <path d={path(compareValues)} fill="none" style={{ stroke: "var(--c-border-strong)" }} strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
            )}
            <path d={line} fill="none" style={{ stroke: "var(--c-accent)" }} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {hover != null && (
            <>
              <div style={{ position: "absolute", left: `${hx}%`, top: 0, bottom: 0, width: 1, background: "var(--c-border-strong)", transform: "translateX(-0.5px)", pointerEvents: "none" }} />
              <div style={{ position: "absolute", left: `${hx}%`, top: `${hy}%`, width: 11, height: 11, borderRadius: "50%", background: "var(--c-accent)", border: "2px solid var(--c-surface)", transform: "translate(-50%, -50%)", pointerEvents: "none", boxShadow: "0 0 0 1px var(--c-accent)" }} />
              <div style={{ position: "absolute", left: `${hx}%`, top: `${hy}%`, transform: `translate(${nearRight ? "calc(-100% - 12px)" : "12px"}, -50%)`, pointerEvents: "none", background: "var(--c-ink)", color: "#fff", borderRadius: 8, padding: "7px 10px", fontSize: 12, whiteSpace: "nowrap", boxShadow: "0 6px 20px rgba(0,0,0,.18)", zIndex: 5 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>{labels[hover] ?? `punt ${hover + 1}`}</div>
                <div>{num(values[hover])}{unit ? ` ${unit}` : ""}</div>
                {compareValues && compareValues.length > 0 && (
                  <div style={{ opacity: 0.7, fontSize: 11 }}>vorige: {num(compareValues[hover] ?? 0)}{unit ? ` ${unit}` : ""}</div>
                )}
              </div>
            </>
          )}
        </div>
        {axisLabels.length > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--c-muted)", fontWeight: 600, marginTop: 8 }}>
            {axisLabels.map((l, i) => <span key={i}>{l}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

// Donut from [{label, pct}] (+ center label). Colors come from the palette.
// Hovering a segment highlights it and shows its label + share in the centre.
export function Donut({ segments = [], centerTop, centerSub, size = 160 }) {
  const [active, setActive] = useState(null);
  const r = 70, C = 2 * Math.PI * r;
  let offset = 0;
  const seg = active != null ? segments[active] : null;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
      <svg width={size} height={size} viewBox="0 0 180 180">
        <g transform="rotate(-90 90 90)">
          {segments.map((s, i) => {
            const dash = (s.pct / 100) * C;
            const el = (
              <circle key={i} cx="90" cy="90" r={r} fill="none"
                style={{ stroke: PALETTE[i % PALETTE.length], cursor: "pointer", opacity: active == null || active === i ? 1 : 0.35, transition: "opacity .12s" }}
                strokeWidth={active === i ? 26 : 22} strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-offset}
                onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} />
            );
            offset += dash;
            return el;
          })}
        </g>
      </svg>
      <div style={{ position: "absolute", textAlign: "center", maxWidth: size - 44, pointerEvents: "none" }}>
        {seg ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis" }}>{seg.label}</div>
            <div style={{ fontSize: 12, color: "var(--c-muted)" }}>{seg.pct}%</div>
          </>
        ) : (
          <>
            <div className="display" style={{ fontSize: 24, lineHeight: 1 }}>{centerTop}</div>
            <div style={{ fontSize: 11, color: "var(--c-muted)" }}>{centerSub}</div>
          </>
        )}
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

export function Sparkline({ values = [], labels = [], unit = "", color = "var(--c-accent)", height = 34 }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  const W = 240, H = 40;
  if (!values.length) return <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} />;
  const n = values.length;
  const max = Math.max(...values, 1), min = Math.min(...values, 0), span = max - min || 1;
  const xp = (i) => (i / (n - 1 || 1)) * W;
  const yp = (v) => H - 4 - ((v - min) / span) * (H - 8);
  const pts = values.map((v, i) => `${xp(i).toFixed(1)},${yp(v).toFixed(1)}`).join(" ");

  const onMove = (e) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
  };
  const hx = hover != null ? (hover / (n - 1 || 1)) * 100 : 0;
  const hyPct = hover != null ? (yp(values[hover]) / H) * 100 : 0;
  const nearRight = hx > 65;

  return (
    <div ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ position: "relative", cursor: "crosshair" }}>
      <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
        <polyline points={pts} fill="none" style={{ stroke: color }} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {hover != null && (
        <>
          <div style={{ position: "absolute", left: `${hx}%`, top: `${hyPct}%`, width: 8, height: 8, borderRadius: "50%", background: color, border: "1.5px solid var(--c-surface)", transform: "translate(-50%, -50%)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", left: `${hx}%`, top: -6, transform: `translate(${nearRight ? "calc(-100% - 6px)" : "6px"}, -100%)`, pointerEvents: "none", background: "var(--c-ink)", color: "#fff", borderRadius: 6, padding: "4px 7px", fontSize: 11, whiteSpace: "nowrap", boxShadow: "0 4px 14px rgba(0,0,0,.18)", zIndex: 10 }}>
            {labels[hover] ? <span style={{ opacity: 0.7, marginRight: 5 }}>{labels[hover]}</span> : null}
            <span style={{ fontWeight: 700 }}>{num(values[hover])}</span>{unit ? <span style={{ opacity: 0.85, marginLeft: 4 }}>{unit}</span> : null}
          </div>
        </>
      )}
    </div>
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
