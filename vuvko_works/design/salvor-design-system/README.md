# SALVOR — the design system

Near-black and amber, with the derelict kit's geometry, depth and frame-stepped
motion. Colour is the shipped game's own; everything else in here is the rework.

The diagnosis this answers: our screens were legible, dense and correct, which
is exactly what an admin panel is. Five levers got pulled — housings, a real
type scale, a motion budget, a lit board, and in-world copy — and none of them
added a thing to read.

## Foundations

- **`styles.css`** — 46 tokens. Ground in six values lit top to bottom, one
  interactive colour (amber), four state colours, five type roles, and the
  geometry vocabulary: `--sv-hex`, `--sv-hull`, `--sv-hatch`, `--sv-notch`,
  `--sv-cast`.
- **Type — five roles, hard floor 14px.** `display`, `title`, `value`, `body`,
  `stencil`. Set a role (`font: var(--sv-body)`), never a size. The old 10–11px
  labels sat under the legibility floor and did eleven different jobs.
- **Motion — nothing interpolates.** Every visual state is a discrete frame held
  for a multiple of `FRAME = 225ms`, and offsets quantise to `--sv-cell` /
  `--sv-cell-map` so nothing lands between cells. `derelict-fx.js` sequences
  state; the keyframes in `styles.css` only hold it, which is why all of them
  step. `PRESETS.list` spends a bounded stagger budget so a long list reveals
  in the same wall-clock time as a short one, and `FX.arrive` is the stepped
  arrival flash.
- **Cogmind, read closely.** What SALVOR's ancestor's interface is made of
  structurally — subconsoles, two type metrics, ten rows for ten number keys,
  the grid rule — and which of those we adopted. Sourced from Kyzrati's own
  dev writing.

## Components

All ten live on `window.SALVORScreensAsBuilt_2b77ba`.

| Component | What it is |
|---|---|
| `Panel` | A housing, in five materials — see below |
| `Tag` | Stencilled chip, notched, 14px |
| `Rail` | The left rail — plates, one lit at a time |
| `HexMap` | The honeycomb: one hex per compartment, corridors, doors, one drone |
| `HexTile` | One compartment, in one of four states |
| `DroneMark` | The drone. There is only ever one on the board |
| `SegmentMeter` | A module's stability, cell by cell: lit, spent, or burned out |
| `CorePips` | Core stability read as pips — ●●○ |
| `CoreRack` | The drone: its core, then six numbered slots |
| `AlertDial` | Alert, five steps; only the fifth sweeps |
| `ActionList` | Numbered, keyed rows — the whole interface |
| `Lever` | The one commit a turn has, built as hardware |
| `LogStrip` | Collapsed ticker, expanded record |

`Panel` takes a **`variant`**, and each one answers a named tell from the
dashboard audit rather than being a skin:

| `variant` | What it is | Answers |
|---|---|---|
| `plate` | Bolted to a screen edge — cut corner, struck header, hatched ground | panels float unattached |
| `stencil` | No housing; the title is painted on the hull with registration ticks | one border weight |
| `bracket` | Four corners imply the frame; the edges are never drawn | rectangles only |
| `riveted` | Top-lit plate, bolted rail, engraved title, content in a recessed well | no light direction |
| `readout` | The machine's own printout — title knocked out of the accent, scanlined body | nothing is diegetic |

**`readout` is the system's house style** — both screens use it, and every other
component is built in the same language: a solid accent strip with the ink
knocked out (`--sv-knock`), scanlines on the body (`--sv-scan`), one clipped
bottom-left corner (`--sv-cut-bl`), and no metallic gradients or drop shadows
anywhere in the chrome. `Tag` is a printed stamp, `Rail` keys are knocked out
when active, `Lever` is a solid slab with the label reversed out, the
`ActionList` cursor row is a solid amber band, `LogStrip` leads with an amber
tab, and `AlertDial` is a flat gauge rather than a bezel. The board keeps its
lighting — it is the world, not chrome.

The other four variants stay available and documented. Pick per surface, not per
screen: more than two on one screen puts the tell back.

Two components answer things the kit had no model for.

**`CoreRack`** is where damage lands. There is no hull bar in SALVOR: a hit
lands on a named system, that system's stability bar drops, and when it burns
out its slot is empty for the rest of the sortie. Underneath is the core, read
as pips — when the pips are gone, so is the run.

**`HexTile`** encodes state as information density. The four states are how
much the drone knows, and each step reveals one more slot on the face:

| State | Band | Name | Contents | Drone |
|---|---|---|---|---|
| `undetected` | none | — | — | — |
| `detected` | striped | shown | — | — |
| `monitored` | solid zone | shown | shown | — |
| `current` | solid amber | shown | shown | on top |

Two states show full contents, not three — they differ only in whether the drone
is standing there. Slots never move: loot above the band, the name in it,
threats below it, the drone crowning the hex. Amber means exactly one thing on
the board (the drone is here), so hover highlights in `--sv-rim`. Contents are
shapes, never letters, and the same shape appears in the compartment panel.

**`HexMap`** owns the board's geometry. Callers pass rooms at `q, r` and links
by id; the component does the pointy-top offset-row tiling, draws the corridors
centre to centre beneath the hexes, puts the door id on a chip at the midpoint,
and places the single drone by room id. No caller does step arithmetic, so the
tiling cannot drift.

## Copy

The words are SALVOR's own, because the screens have to feel like the game:
**turn**, **sortie**, **core**, **slot**, **module**, **burned**, **ALERT**,
**CREDITS / CR**, compartment names in caps with an id like `r2`, doors as
`d1 → DOCKING open`. Every string still goes through `t()` on the engine side —
nothing here is a source of truth for text.

## Screens

`screens/` holds the eight artboards as built — pictures of `screenHtml`, kept
for comparison and never a source anything is generated from.
`screens-reworked/` holds the two rebuilt on this system: the tug between
sorties (rack left, action list right, no map at all) and aboard on the
honeycomb (one hex per compartment, one drone, the rack and the action list).

`templates/salvor-screen/` is the starting point for a new in-run screen: rail,
lit board, edge-mounted housings, the commit lever, the log.

## The rule that still holds

When a reworked screen comes back, the markup does not come with it. What comes
back is the design — spacing, weight, colour, hierarchy, motion. It lands in the
components, and every string in it goes through `t()` first.
