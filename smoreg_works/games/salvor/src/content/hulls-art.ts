import { hexFit, hexKey, hexLayout, hexThickness, type HexLayout, type Ship } from "@jamrog/engine";
import { classOfShip } from "./derelicts.js";
import {
  HALF_CEILING,
  MASK_SLACK,
  SHAPES,
  SIZE_CEILING,
  fitSize,
  shipForm,
  type HullForm,
  type HullFormId,
} from "./hullforms.js";

/**
 * Which drawn hull each class of derelict wears on the honeycomb view
 * (`ui/web/hullart.ts`, `docs/tasks/G81-hull-silhouette.md`).
 *
 * All data. A profile names the **shape** the hull is built in — one of the
 * hexagon-built shapes in `hullforms.ts`, sized to the ship's own deck, whose
 * cells are the mask the honeycomb is grown inside and the figure the ship is
 * drawn over (G82) — and says what hangs off that shape: how many engine
 * pods, a bridge, what the plating looks like. Twenty shapes in the
 * sandbox came down to one rule the owner confirmed three times over: a hull
 * reads as a ship by its **ends**, not by an interesting edge. So the rest of
 * a profile is mostly about the ends.
 *
 * A class with no row here is drawn as a bare outline traced around the
 * cells, and nothing else. That is a fallback and not an error: the picture
 * must never be the reason a run fails to draw, and a hull the catalogue has
 * not dressed is still a hull.
 */
export interface HullProfile {
  /** The shape the hull is built in, and the honeycomb grown inside (`hullforms.ts`). */
  readonly form: HullFormId;
  /** Engine pods off the stern: none, one on the axis, or a pair. */
  readonly nacelles: 0 | 1 | 2;
  /** How long the pods are, in tiling-hexagon radii. */
  readonly podLength: number;
  /** A wedge past the bow, in tiling-hexagon radii. Zero is a blunt bow. */
  readonly nose: number;
  /** The bridge block astride the bow plate, with its lit windows. */
  readonly bridge: boolean;
  /** Hatches on the skin band, at most. */
  readonly hatches: number;
  /**
   * What the plating is made of: frames across the hull with seams along it,
   * rings around a tank, or bare plate.
   */
  readonly plating: "frames" | "tanks" | "bare";
  /** Portholes along the rim: a hab block has many, a tanker none. */
  readonly ports: number;
}

/**
 * The profiles, by the name the sandbox gave each shape
 * (`experiments/hullforms/shipform.mjs`, `CLASSES`).
 */
export const HULL_PROFILES = {
  /** The freighter: a box with two pods and a blunt bow. */
  boxcar: {
    form: "boxcar", nacelles: 2, podLength: 3.0, nose: 0, bridge: true, hatches: 4, plating: "frames", ports: 2,
  },
  /** The barge: tanks in a row, one pod pushing, no bridge of its own. */
  train: {
    form: "bargetrain", nacelles: 1, podLength: 3.4, nose: 0, bridge: false, hatches: 6, plating: "tanks", ports: 0,
  },
  /** The ferry: a hab block, lit along the whole rim. */
  habblock: {
    form: "whale", nacelles: 2, podLength: 2.4, nose: 0.4, bridge: true, hatches: 2, plating: "frames", ports: 8,
  },
  /** The probe: a needle, one pod, a long spike forward. */
  needle: {
    form: "teardrop", nacelles: 1, podLength: 3.2, nose: 1.6, bridge: false, hatches: 0, plating: "bare", ports: 0,
  },
  /** The tender: a dock that never moves — hatches everywhere, no engines. */
  drydock: {
    form: "drydock", nacelles: 0, podLength: 0, nose: 0, bridge: true, hatches: 6, plating: "frames", ports: 3,
  },
  /** The laboratory: a spindle, tapered both ways. */
  spindle: {
    form: "spindle", nacelles: 1, podLength: 2.8, nose: 1.0, bridge: true, hatches: 1, plating: "tanks", ports: 4,
  },
  /** The military hull: an arrow, two pods, a sharp bow. */
  arrow: {
    form: "dreadnought", nacelles: 2, podLength: 3.6, nose: 1.3, bridge: true, hatches: 2, plating: "frames", ports: 1,
  },
  /** The smuggler: a hammer, heavy pods and a blunt head. */
  hammer: {
    form: "hammerboat", nacelles: 2, podLength: 3.8, nose: 0, bridge: true, hatches: 3, plating: "frames", ports: 2,
  },
  /** The corsair: a harpoon, one big pod and the longest spike. */
  harpoon: {
    form: "harpoon", nacelles: 1, podLength: 3.8, nose: 1.8, bridge: true, hatches: 1, plating: "bare", ports: 1,
  },
  /** The quarantine hull: a station — a drum of tanks with a hole through it, no engines. */
  ring: {
    form: "ringstation", nacelles: 0, podLength: 0, nose: 0, bridge: false, hatches: 5, plating: "tanks", ports: 4,
  },
  /** The father's tug: the hammer again, but the pods are the biggest there are. */
  tug: {
    form: "tug", nacelles: 2, podLength: 4.2, nose: 0.5, bridge: true, hatches: 3, plating: "frames", ports: 2,
  },
} as const satisfies Record<string, HullProfile>;

export type HullProfileId = keyof typeof HULL_PROFILES;

/**
 * Class of derelict → profile. Every id in `content/derelicts.ts` (and the
 * training hull, which is a freighter built to be learned on) has a row;
 * `tests/hullart.test.ts` holds the table to that, the way `content.test.ts`
 * holds the other tables to each other.
 */
export const HULL_ART: Readonly<Record<string, HullProfileId>> = {
  freighter: "boxcar",
  tutorial: "boxcar",
  barge: "train",
  ferry: "habblock",
  probe: "needle",
  tender: "drydock",
  laboratory: "spindle",
  military: "arrow",
  smuggler: "hammer",
  corsair: "harpoon",
  quarantine: "ring",
  "fathers-tug": "tug",
};

/** The profile a class wears, or nothing for a class the table has not dressed. */
export function hullProfileOf(classId: string | undefined): HullProfile | undefined {
  if (classId === undefined) return undefined;
  const id = HULL_ART[classId];
  return id === undefined ? undefined : HULL_PROFILES[id];
}

/**
 * What the honeycomb renderer needs to dress one hull: the profile, a seed
 * for the plating's small variations, and — for a class the table has
 * dressed — the hull's shape fitted to this ship and the cells inside it.
 *
 * The seed is a string and not a number on purpose: it is the ship's store id
 * (`RoomGame.shipId`), which survives a save and never changes for a hull, so
 * two frames of one ship — and two loads of one save — draw the same rivets
 * and the same shape. Nothing about the drawing may come from the run's rng:
 * the picture is a pure function of the graph, like `hexLayout` is.
 *
 * `form` is the hull built in cells and the polygons drawn over them, in
 * radii of the tiling hexagon with the stern plate at the origin; `mask` is
 * the `hexKey` of every one of its cells: what `hexLayout` is handed as
 * `allowed` (`ui/web/screen.ts`). Both are absent for a class the table has
 * not dressed, and the honeycomb is then laid out and drawn as it was before
 * there was a shape to build.
 */
export interface HullArt {
  readonly profile: HullProfile | undefined;
  readonly seed: string;
  readonly form: HullForm | undefined;
  readonly mask: ReadonlySet<string> | undefined;
}

/**
 * The dressing for the ship the drone is aboard, read off the ship's own
 * class stamp and sized to its compartment count.
 *
 * Fitting the shape is a search over a few dozen polygons and layouts and
 * it is asked for on every frame, so the answer is kept per ship and id: a
 * pure function's cache, keyed by everything it depends on. The graph of a
 * ship never changes once it is built, and the id never changes at all.
 */
export function hullArtOf(ship: Ship, shipId: string): HullArt {
  const classId = classOfShip(ship);
  const profile = hullProfileOf(classId);
  if (profile === undefined) return { profile, seed: shipId, form: undefined, mask: undefined };
  const kept = FITTED.get(ship)?.get(shipId);
  if (kept !== undefined) return kept;
  const seed = fnv(shipId);
  const form = fitted(ship, profile.form, seed);
  const mask: ReadonlySet<string> = new Set(form.cells.map(hexKey));
  const art: HullArt = { profile, seed: shipId, form, mask };
  const byId = FITTED.get(ship) ?? new Map<string, HullArt>();
  byId.set(shipId, art);
  FITTED.set(ship, byId);
  return art;
}

/**
 * One `HullArt` per ship and id, handed back as the same object so a frame
 * can be keyed by it. Keyed by the ship object and not by its id alone: a
 * second run in the same page numbers its ships from one again, and the
 * freighter of the last run must not lend its hull to the barge of this one.
 */
const FITTED = new WeakMap<Ship, Map<string, HullArt>>();

/**
 * How many keel cells longer the hull is tried each time the layout turns it
 * down, and how many of those tries are spent looking for a layout with no
 * link in it once one with links has been found.
 */
const GROW_TRIES = 4;
const LINKLESS_TRIES = 1;

/**
 * The hull built for a ship: the shape at the size the honeycomb lies well
 * inside.
 *
 * As thick as the ship's own deck is across, at its thinnest turn — a deck
 * five cells across cannot lie in a hull three cells tall, and grown again
 * from scratch in one it loses the loops that make it worth drawing — and
 * no thicker than the frame allows. Then as long as it needs to be: enough
 * cells for the compartments and the slack the search needs (`MASK_SLACK`),
 * and the layout asked whether it can honour that mask — every compartment
 * in it and at least `MASK_FLOOR` of the doors drawn. Most hulls pass at
 * once. A hull honoured with links in it is kept unless one cell longer
 * draws every door; a hull turned down outright is tried longer a few
 * times; past that it is made long enough for the ship's own honeycomb to
 * fit inside under some turn of the lattice (`hexFit`), which the layout
 * then keeps outright — so a ship is never drawn around a mask it could not
 * use. A hull that was never on the lattice has no honeycomb of its own to
 * fit, and stops at the tries. Every size is bounded by the frame
 * (`SIZE_CEILING`): a hull the pane cannot hold is smaller hexagons on every
 * ship of its class.
 */
function fitted(ship: Ship, kind: HullFormId, seed: number): HullForm {
  const own = hexLayout(ship);
  const grownHere = own.links.size === 0 && own.offLattice.length === 0;
  const across = hexThickness(own.cells.values());
  const half = Math.min(HALF_CEILING, Math.max(0, Math.ceil((across - 1) / 2)));
  const laid = (form: HullForm): HexLayout => hexLayout(ship, { allowed: new Set(form.cells.map(hexKey)) });

  let size = fitSize(kind, seed, half, Math.ceil(ship.rooms.length * (1 + MASK_SLACK)));
  let honoured: HullForm | undefined;
  let since = 0;
  for (let i = 0; i <= GROW_TRIES && size <= SIZE_CEILING; i++, size++) {
    const form = shipForm(kind, seed, size, half);
    const layout = laid(form);
    if (layout.masked && layout.links.size === 0) return form;
    if (layout.masked && honoured === undefined) honoured = form;
    if (honoured !== undefined && since++ >= LINKLESS_TRIES) return honoured;
  }
  if (honoured !== undefined) return honoured;
  if (grownHere) {
    for (; size <= SIZE_CEILING; size++) {
      const form = shipForm(kind, seed, size, half);
      if (hexFit(own.cells, new Set(form.cells.map(hexKey))) !== undefined) return form;
    }
  }
  return shipForm(kind, seed, Math.min(size, SIZE_CEILING), half);
}

/** Every shape the catalogue may name, for the tests that hold the two tables to each other. */
export const HULL_SHAPES = SHAPES;
/** FNV-1a over the ship's id: the number the shape's jitter is seeded with. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
