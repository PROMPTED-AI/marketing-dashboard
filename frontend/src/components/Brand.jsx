// MetricMelon merk-assets. Het beeldmerk is een merkelement, geen icoon:
// app-icoon, avatar, lege staten. Nooit inline in een menu.
// Het woordmerk staat nooit los uitgelijnd naast het beeldmerk: gebruik <Logo />.

export function Mark({ size = 30, style }) {
  return (
    <img
      src="/brand/metricmelon-beeldmerk.png"
      alt=""
      width={size}
      style={{ width: size, height: "auto", display: "block", flex: "none", ...style }}
    />
  );
}

// `inverse` dwingt het witte woordmerk af (navy vlakken). Zonder die prop volgt
// het woordmerk het thema: navy in light, wit in dark.
export function Wordmark({ width = 132, inverse = false, style }) {
  const base = { width, height: "auto", ...style };
  if (inverse) return <img src="/brand/metricmelon-wordmark-white.png" alt="MetricMelon" style={{ display: "block", ...base }} />;
  return (
    <>
      <img className="brand-on-light" src="/brand/metricmelon-wordmark.png" alt="MetricMelon" style={base} />
      <img className="brand-on-dark" src="/brand/metricmelon-wordmark-white.png" alt="" style={base} />
    </>
  );
}

// Beeldmerk + woordmerk naast elkaar, zoals de horizontale lockup.
export function Logo({ size = 30, wordmarkWidth, inverse = false, style }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, ...style }}>
      <Mark size={size} />
      <Wordmark width={wordmarkWidth ?? Math.round(size * 4.4)} inverse={inverse} />
    </div>
  );
}

// Illustraties: één per vlak, nooit hertinten of roteren, altijd zonder eigen kader.
export function Illustration({ name, size = 120, alt = "", style }) {
  return (
    <img
      src={`/brand/${name}.png`}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      style={{ width: size, height: "auto", display: "block", ...style }}
    />
  );
}
