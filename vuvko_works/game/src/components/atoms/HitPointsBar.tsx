export interface HitPointsBarProps {
  readonly current: number;
  readonly max: number;
  /** Shows the numbers beside the bar. */
  readonly showNumbers?: boolean;
}

function toneFor(fraction: number): string {
  if (fraction > 0.6) return "var(--node)";
  if (fraction > 0.3) return "var(--door)";
  return "var(--stamp)";
}

export function HitPointsBar({ current, max, showNumbers = false }: HitPointsBarProps) {
  const safeMax = max > 0 ? max : 1;
  const fraction = Math.max(0, Math.min(1, current / safeMax));

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        role="meter"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label="hit points"
        style={{
          flex: 1,
          height: 6,
          background: "var(--deck)",
          border: "1px solid var(--rule)",
          minWidth: 60,
        }}
      >
        <div
          style={{ height: "100%", width: `${fraction * 100}%`, background: toneFor(fraction) }}
        />
      </div>
      {showNumbers ? (
        <span style={{ font: "400 var(--font-sm)/1 var(--font-mono)", color: "var(--dim)" }}>
          {current}/{max}
        </span>
      ) : null}
    </div>
  );
}
