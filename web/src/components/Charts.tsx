interface Segment {
  value: number;
  color: string;
  label: string;
}

/** Dependency-free SVG donut chart with a centered figure and a legend. */
export function Donut({
  segments,
  centerLabel,
  centerSub,
  size = 160,
  thickness = 22,
}: {
  segments: Segment[];
  centerLabel?: string;
  centerSub?: string;
  size?: number;
  thickness?: number;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;

  let offset = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const frac = total ? s.value / total : 0;
      const len = frac * c;
      const arc = (
        <circle
          key={s.label}
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke={s.color}
          strokeWidth={thickness}
          strokeDasharray={`${len} ${c - len}`}
          strokeDashoffset={-offset}
          strokeLinecap="butt"
          transform={`rotate(-90 ${cx} ${cx})`}
        />
      );
      offset += len;
      return arc;
    });

  return (
    <div className="row" style={{ gap: '1.2rem', alignItems: 'center' }}>
      <svg width={size} height={size} style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#f1e6d3" strokeWidth={thickness} />
        {total > 0 && arcs}
        {centerLabel && (
          <>
            <text x={cx} y={cx - 2} textAnchor="middle" dominantBaseline="central"
              style={{ font: '800 1.5rem "Baloo 2", sans-serif', fill: '#2a2117' }}>
              {centerLabel}
            </text>
            {centerSub && (
              <text x={cx} y={cx + 20} textAnchor="middle"
                style={{ font: '600 0.72rem "Plus Jakarta Sans", sans-serif', fill: '#8a7a63' }}>
                {centerSub}
              </text>
            )}
          </>
        )}
      </svg>
      <ul className="list" style={{ display: 'grid', gap: '0.4rem' }}>
        {segments.map((s) => (
          <li key={s.label} className="row" style={{ gap: '0.5rem' }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: s.color, display: 'inline-block' }} />
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{s.label}</span>
            <span className="muted" style={{ fontSize: '0.85rem' }}>{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
