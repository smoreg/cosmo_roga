import type { LogLine } from "../../lib/log";

export interface MissionLogProps {
  readonly lines: readonly LogLine[];
}

/**
 * How many lines the drawer holds.
 *
 * The kit shows seven and does not scroll: the panel is a fixed height and the
 * rows fill it. A log you have to scroll is a log you read instead of playing,
 * and the strip above already carries the one line that just arrived.
 */
const SHOWN = 7;

function colourFor(tone: LogLine["tone"]): string {
  if (tone === "good") return "var(--node)";
  if (tone === "bad") return "var(--stamp)";
  if (tone === "loud") return "var(--door)";
  if (tone === "quiet") return "var(--dim)";
  return "var(--ink)";
}

export function MissionLog({ lines }: MissionLogProps) {
  const shown = lines.slice(-SHOWN);
  return (
    /* Reversed, so the newest sits at the top and the rows below it are the
       ones already read. The channel carries the colour and the text stays
       even: in a column of seven, colouring every line makes none of them
       stand out. */
    <div
      style={{
        font: "400 var(--font-sm)/var(--line-sm) var(--font-mono)",
        display: "flex",
        flexDirection: "column-reverse",
        gap: 4,
      }}
    >
      {shown.map(function showLine(line, index) {
        return (
          <div key={lines.length - shown.length + index} style={{ display: "flex", gap: 10 }}>
            <span style={{ color: colourFor(line.tone), flex: "none", width: 54 }}>
              {line.channel}
            </span>
            {/* `data-sc-line` is what the descramble is run over, and
                `data-text` is the truth it resolves back to. */}
            <span data-sc-line="1" data-text={line.text} style={{ color: "var(--ink-text)" }}>
              {line.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}
