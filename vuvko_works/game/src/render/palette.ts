/** Which colour a room reads as. Trades come from the deck export's own roles. */

const BY_KIND: Readonly<Record<string, string>> = {
  command: "#18222e",
  quarters: "#241f2b",
  drive: "#2b2119",
  weapon: "#2a1a1a",
  service: "#16211f",
  bay: "#1a2430",
};

export function roomFill(kind: string): string {
  return BY_KIND[kind] ?? "#1a2020";
}

/** The backdrop is the same palette, lifted and blurred into a suggestion. */
export function backdropFill(kind: string): string {
  return BY_KIND[kind] ?? "#1a2020";
}

/**
 * What a door is drawn in. Red is the one you cannot simply walk through;
 * grey is the one that is no longer a door at all.
 */
export function doorStroke(state: string): string {
  if (state === "locked") return "var(--stamp)";
  if (state === "broken") return "#7d8a93";
  return "var(--door)";
}
