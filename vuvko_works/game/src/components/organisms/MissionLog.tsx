import type { LogLine } from "../../lib/log";

export interface MissionLogProps {
  readonly lines: readonly LogLine[];
}

function colourFor(tone: LogLine["tone"]): string {
  if (tone === "good") return "var(--node)";
  if (tone === "bad") return "var(--stamp)";
  if (tone === "loud") return "var(--door)";
  if (tone === "quiet") return "var(--dim)";
  return "var(--ink)";
}

export function MissionLog({ lines }: MissionLogProps) {
  return (
    <div
      style={{
        font: "400 var(--font-sm)/var(--line-sm) var(--font-mono)",
        overflow: "auto",
        display: "grid",
        gap: 2,
        alignContent: "start",
      }}
    >
      {lines.map(function showLine(line, index) {
        return (
          <div key={index} style={{ display: "flex", gap: 8 }}>
            <span style={{ color: "var(--rule)", flex: "none", width: 60 }}>{line.channel}</span>
            <span style={{ color: colourFor(line.tone), whiteSpace: "pre-wrap" }}>{line.text}</span>
          </div>
        );
      })}
    </div>
  );
}
