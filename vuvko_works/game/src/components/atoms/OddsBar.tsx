export interface OddsBarProps {
  /** Probability in [0, 1]. */
  readonly chance: number;
  readonly label: string;
  readonly tone?: "good" | "bad";
}

/**
 * One row of the forecast. The point of showing the odds before an attack is
 * that a fair fight stops feeling rigged — so the number is always written
 * out, not just drawn.
 */
export function OddsBar({ chance, label, tone = "good" }: OddsBarProps) {
  const clamped = Math.max(0, Math.min(1, chance));
  const percent = Math.round(clamped * 100);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        font: "400 var(--font-xs)/var(--line-xs) var(--font-mono)",
      }}
    >
      <span style={{ color: "var(--dim)", minWidth: 96 }}>{label}</span>
      <div
        style={{ flex: 1, height: 4, background: "var(--deck)", border: "1px solid var(--rule)" }}
      >
        <div
          style={{
            height: "100%",
            width: `${percent}%`,
            background: tone === "bad" ? "var(--stamp)" : "var(--node)",
          }}
        />
      </div>
      <span style={{ minWidth: 34, textAlign: "right" }}>{percent}%</span>
    </div>
  );
}
