export interface TagProps {
  readonly children: React.ReactNode;
  readonly tone?: "plain" | "warn" | "good";
}

function colourFor(tone: NonNullable<TagProps["tone"]>): string {
  if (tone === "warn") return "var(--stamp)";
  if (tone === "good") return "var(--node)";
  return "var(--dim)";
}

/** A small uppercase label: a room role, a weapon class, a hazard. */
export function Tag({ children, tone = "plain" }: TagProps) {
  return (
    <span
      style={{
        display: "inline-block",
        font: "700 var(--font-xs)/1 var(--font-mono)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        padding: "3px 5px",
        border: "1px solid var(--rule)",
        color: colourFor(tone),
        marginRight: 3,
        marginBottom: 3,
      }}
    >
      {children}
    </span>
  );
}
