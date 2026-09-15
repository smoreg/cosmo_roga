# What is here, and what is still in the project

Pulled from the Claude Design project **SALVOR — Screens as Built**
(`2b77ba4c-f54c-445d-a245-0224024bee1a`) on 2026-09-15.

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

## Still in the project, not pulled

Renderings rather than sources, and each is a large HTML file that can be
fetched on demand:

- `screens-reworked/` — `02-tug`, `04-hex`, `chrome-variants`, `door-map`
- `cards/` — `palette`, `type`, `motion`, `cogmind`
- `components/**/​*-card.html` — the component demo cards
- `templates/salvor-screen/` — the starting point for a new in-run screen
- `components/**/​*.d.ts` — generated from the JSX beside them
- `_ds_bundle.js`, `_ds_manifest.json`, `thumbnail.html` — build output
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
