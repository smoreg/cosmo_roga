/**
 * One place for every colour. Changing the game's look must be a one-file diff.
 * Palette from design-doc.md ("Интерфейс"): cold terminal, amber accent.
 */
export const THEME = {
  bg: "#0a0d10",
  panelBg: "#10151a",
  fgDim: "#3f4a52",
  fg: "#b9c4cc",
  accent: "#e0a458",
  /** Burned-out module slots. */
  burned: "#4a3a3a",
  /** Deck schematic: zone names and links, and the zone labels on the map. */
  zone: "#6f8a9a",
  /** The only passage between two zones. Muted accent: worth spotting, not loud. */
  airlock: "#a07a44",
  /** A sealed bulkhead: a wall that reads as a door that will not open. */
  bulkhead: "#5a4e42",
  good: "#7fc97f",
  bad: "#d96a6a",
  warn: "#d9b56a",
  hpFull: "#7fc97f",
  hpLow: "#d96a6a",
  /** Colour of remembered-but-not-visible tiles. */
  memoryFg: "#2a3238",
  memoryBg: "#07090b",
} as const;

export const LAYOUT = {
  mapWidth: 70,
  mapHeight: 34,
  sidebarWidth: 26,
  logHeight: 7,
  fontSize: 18,
} as const;

export const SCREEN_WIDTH = LAYOUT.mapWidth + LAYOUT.sidebarWidth;
export const SCREEN_HEIGHT = LAYOUT.mapHeight + LAYOUT.logHeight + 1;
