# What is here, and what is still in the project

Pulled from the Claude Design project **SALVOR — Screens as Built**
(`2b77ba4c-f54c-445d-a245-0224024bee1a`) on 2026-09-15, twice: the system
itself at 05:25, a second pass at 05:46 and a third at 05:49.

## The third pull

One change, in `LogStrip`. The collapsed ticker now descrambles when a new
line arrives, keyed on the line itself rather than on any open/close state, at
the `hover` preset. The note in the source draws the distinction it turns on:
this is the one log animation that is about **news** rather than about
reading — the expanded record still resolves all at once, because a record was
already written and a log you have to wait through is a log you stop opening.

The manifest was byte-identical across this pull, so no component appeared,
moved or changed its exports. Content changes in files this repo does not
track — the screens, the cards, the template — would not show up in that
comparison and have not been checked.

## The second pull

Three components appeared and two changed their minds about something.

**`SlashMeter`** writes stability the way the machine prints it — one struck
mark per step of capacity, lit where the module holds it and dim where it has
been lost. Left aligned and never stretched, so two modules of different size
are directly comparable and no number has to restate the count. `CoreRack` now
builds out of it rather than out of `SegmentMeter`, and has dropped both the
slot numbers and the "N slots gone" tally.

**A burned slot and an empty slot are now the same thing to look at**: a dotted
bay reading `empty`. The note in the source says why — naming what used to be
in it is a fact for the log, not a permanent label on the rack.

**`Knowledge`** replaces the loose `knows()` / `knownName()` pair with a named
model (`Knowledge.of(state)`, `Knowledge.name(room)`), so nothing has to
re-derive how much the drone is allowed to know. A readout must never out-know
the board.

**`MoverMark`** is a body in transit, drawn with the same silhouette as its
chip so the thing that arrives is recognisably the thing that left. `HexMap`
takes a `moves` array and plays every reported relocation **at once** rather
than in sequence, because a watch passes for all of them together.

**Movement changed idiom.** The drone no longer walks with `wake()`; it hops
with one `teleport()` per compartment, dissolving out of each room and
reassembling in the next, so a three-room move reads as three hops. The drone
also moved out of the panned wrapper into its own layer, positioned with
`left`/`top` rather than a transform, so board pixels stay board pixels while
the animation plays.

**Hover and door menus grew grace timers.** A menu offset clear of its door
leaves a gap the pointer has to cross, and leaving the door was closing the
menu before the pointer got there. Two frames of grace, and the hover readout
is now clickable — it carries the same intent the cell does.

## Here

| Path | What it is |
|---|---|
| `README.md` | The design system's own account of itself — read this first |
| `styles.css` | 54 tokens: ground, ink, one accent, five type roles, the geometry and motion vocabulary |
| `derelict-fx.js` | The animation library, **newer than the one vendored into the game** — see below |
| `components/board/HexTile.jsx` | `HexTile`, `HexMap`, `DroneMark`, `DroneGhost`, `Popover`, `Readout`, `ContentIcon`, `ObjectRow` |
| `components/chrome/Panel.jsx` | `Panel` in five housings, `Tag`, `MenuSheet`, `Rail` |
| `components/action/Lever.jsx` | `Lever`, `ActionList`, `LogStrip` |
| `components/meters/SegmentMeter.jsx` | `SegmentMeter`, `CorePips`, `CoreRack`, `AlertDial` |

## Running them locally

    cd vuvko_works/design/salvor-design-system
    python3 -m http.server
    # localhost:8000

`index.html` lists what is here. It wants a **server**, not `file://` — the
screens load the FX library as an ES module and a browser will not fetch one
off the filesystem — and it wants a **network**, because React, ReactDOM and
Babel are fetched from unpkg rather than bundled.

`_ds_bundle.js` is the compiled components and the screens will not start
without it. It is build output, so it goes stale the moment a `.jsx` here
changes: **re-pull it alongside any component change**, or the preview will
keep showing the previous build.

## Still in the project, not pulled

Renderings rather than sources, and each is a large HTML file that can be
fetched on demand:

- `screens-reworked/chrome-variants.html`, `screens-reworked/door-map.html`
- `cards/` — `palette`, `type`, `motion`, `cogmind`
- `components/**/​*-card.html` — the component demo cards
- `templates/salvor-screen/` — the starting point for a new in-run screen
- `components/**/​*.d.ts` — generated from the JSX beside them
- `_ds_manifest.json`, `thumbnail.html`, `_adherence.oxlintrc.json` — build output
- `uploads/` — copies of the kit files this repo already holds in
  `vuvko_works/extra_design/`

## The library is ahead of ours

`vuvko_works/game/src/vendor/derelict-fx.js` is a copy of an older build. The
version here adds:

- **`wake(el, path, {faceEl})`** — the token moves and only the child marked
  `data-fx-face` scrambles. The game works around the absence of this by flying
  a separate `<text>` element along the route and hiding the real token
  (`src/hooks/useBoardFx.ts`); with `faceEl` that whole device can go.
- **`teleport`** gains the same `faceEl`.
- **`arrive(els)`** — the stepped arrival flash, three held frames rather than
  Cogmind's 400ms fade.
- **`scrambleLike(text)`** — scramble that holds a string's shape, class for
  class, so the line never changes width.
- **`scrambleReveal`** gains `staggerTotal` and `block`. `staggerTotal` spends a
  bounded budget across however many rows there are, so a long list reveals in
  the same wall-clock time as a short one; `block` groups lines into slots so a
  thirty-line sheet costs six.
- **`PRESETS.list`, `PRESETS.sheet`, `PRESETS.all`** for those.

Updating the vendored copy is a code change with tests behind it, so it has not
been done here. The pull is the design; adopting it is a separate step.
