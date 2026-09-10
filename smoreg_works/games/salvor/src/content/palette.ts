/**
 * Every colour the game can show, as data — cold terminal, amber accent
 * (design-doc.md, "Экран").
 *
 * This is the one source of truth: `ui/theme.ts` re-exports it as `THEME` for
 * the renderer, and `twist/rig.ts` and `systems/alert.ts` import it directly,
 * because a rule that colours a panel line is still a rule and may not reach
 * into `src/ui` to do it (`tests/purity.test.ts`, "the rules never import the
 * renderer"). Before this file the same two hex strings were typed out by hand
 * in `systems/alert.ts` with a comment pointing back at `ui/theme.ts`
 * (`docs/tasks/G13-release.md`, "Техдолг, найденный G33") — one table instead
 * means a palette change is one file's diff again, not a search for every copy.
 *
 * Plain data, nothing else: no DOM, no randomness, safe for `sim`-adjacent code
 * to import.
 */
export const PALETTE = {
  bg: "#0a0d10",
  panelBg: "#10151a",
  /** Frames, wires and everything structural on the schematic. */
  fgDim: "#3f4a52",
  fg: "#b9c4cc",
  /** A room the drone can see right now: the one colour brighter than `fg`. */
  bright: "#dfe9f0",
  accent: "#e0a458",
  /** Burned-out module slots. */
  burned: "#4a3a3a",
  /**
   * The hairline between blocks, and the ground a spent integrity bar runs on.
   * Darker than `fgDim`, which is ink: this one is never read, only bounded by.
   */
  line: "#1d242a",
  /**
   * Second-rank text: a note beside a row, a unit after a number. Between `fg`
   * and `fgDim`, where the graphic view needed a step the terminal never did —
   * a character cell has no room for a note, so it either fits or is cut.
   */
  soft: "#8f9aa2",
  /** A room known only from a sensor pulse: seen, never entered. */
  zone: "#6f8a9a",
  /** The hull line down the right edge of the schematic. */
  hull: "#8a3a3a",
  /** The drone's own airlock: muted accent, worth spotting, not loud. */
  airlock: "#a07a44",
  /** A sealed bulkhead: a wall that reads as a door that will not open. */
  bulkhead: "#5a4e42",
  good: "#7fc97f",
  bad: "#d96a6a",
  warn: "#d9b56a",
  hpFull: "#7fc97f",
  hpLow: "#d96a6a",
  /**
   * Door labels by state. The order is the order of trouble: a door you can
   * walk through is quiet, one that costs a turn or a tool shouts.
   */
  door: {
    open: "#3f4a52",
    broken: "#3f4a52",
    closed: "#6f8a9a",
    locked: "#e0a458",
    sealed: "#5a4e42",
    airlock: "#a07a44",
  },
  /**
   * The drawn hull under the honeycomb (`ui/web/hullart.ts`), as three steps
   * of tone and no fewer: `bg` under the ship, `body` for its mass, `plate`
   * for anything sitting on that mass. A hull filled a shade off the
   * background read as an outline over nothing and swallowed every frame and
   * seam drawn inside it (`experiments/hullforms/README.md`). Nothing here is
   * amber: amber is the doors' and the airlock's, and a hull that spent it on
   * portholes lost the doors among them.
   */
  hullArt: {
    body: "#1b242c",
    plate: "#28343e",
    /** A panel caught in a different light: the bridge, a dish. */
    plateLit: "#33414d",
    /** A vent, a bell, a hatch: darker than the background. */
    deep: "#080b0e",
    /** The skin line, the one stroke brighter than the steel. */
    rim: "#8fa8b6",
  },
} as const;
