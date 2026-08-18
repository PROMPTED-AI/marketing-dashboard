// MetricMelon merk-assets. Het beeldmerk is een merkelement, geen icoon:
// app-icoon, avatar, lege staten. Nooit inline in een menu.

// Het beeldmerk. `size` is de breedte.
export function Mark({ size = 30, height, style }) {
  const box = height ? { height, width: "auto" } : { width: size, height: "auto" };
  return (
    <img
      src="/brand/metricmelon-beeldmerk.png"
      alt=""
      style={{ ...box, display: "block", flex: "none", ...style }}
    />
  );
}

// Het woordmerk zonder accenttekens; die zitten al in het beeldmerk ernaast.
export function Wordmark({ width, height, inverse = false, style }) {
  const box = height ? { height, width: "auto" } : { width: width ?? 132, height: "auto" };
  const base = { ...box, ...style };
  if (inverse) return <img src="/brand/metricmelon-wordmark-white.png" alt="MetricMelon" style={{ display: "block", ...base }} />;
  return (
    <>
      <img className="brand-on-light" src="/brand/metricmelon-wordmark.png" alt="MetricMelon" style={base} />
      <img className="brand-on-dark" src="/brand/metricmelon-wordmark-white.png" alt="" style={base} />
    </>
  );
}

// Horizontale lockup. `height` is de hoogte van het beeldmerk; het woordmerk
// staat daar volgens het design system op 80% van, zodat de meloen het merk
// draagt en het woordmerk hem gezelschap houdt (niet andersom).
const WORDMARK_RATIO = 0.8;

export function Logo({ height = 40, inverse = false, style }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: Math.round(height * 0.18), minWidth: 0, ...style }}>
      <Mark height={height} />
      <Wordmark height={Math.round(height * WORDMARK_RATIO)} inverse={inverse} />
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
