# Performance and access

A deck is 73 hexes on the shipped hand-made deck and, at `HEX_FEET = 25`,
100–130 on a generated hull today (`game-now.png`), with 200+ on the large
hulls in `example-missions/`. Every hex is at least one `<polygon>`, up to
four when the reach, hazard and extraction layers are on, plus a `<line>`
per wall edge and per threat edge — 1–2k SVG nodes, every one carrying
inline attributes computed per render. The player zooms 0.4×–8× and pans by
drag. That is the substrate the effects go on top of.

## 1. What is slow today, before any effect exists

`DeckView` re-runs its whole body, and React reconciles every child, on:

- **every pan/zoom tick** — `usePanZoom`'s `setView` fires per pointermove
  and per wheel event, though only one `transform` attribute changes;
- **every hover** — `onHover` lifts the pointer into `useMissionInput`'s
  `cursor` state, which recomputes `plan` and re-renders from the top;
- **every state change** — expected.

There is no `React.memo`, no `useCallback`, no `Map` from hex key to shape
(`ArrowMark` does two `layout.hexes.find` per arrow; objects and units do
one each; `hexShapeAt` is a linear scan). The backdrop `<image>` sits
under an `feGaussianBlur` *inside* the transformed group, so the browser
re-filters it as the transform changes; `disclosure.md` §2 already names
"repaints at pointer rate over a blurred `<image>` backdrop" as the ceiling.

None of this is visible at 73 hexes. It will be at 200 with a ghost
stepping every 225ms. Fix it before effects land, not after:

1. **Transform through a ref, not state.** `usePanZoom` writes
   `g.setAttribute("transform", …)` directly and keeps `view` in a ref;
   React renders only when the *hex under the pointer* changes, not when
   the pointer moves. `clientToUser` still needs the current view — read
   the ref.
2. **Hover by hex key.** `onHover` fires only when `hexAt(cursor)` changes
   key. Pointer position within a hex is not information the UI uses.
3. **Static layers memoised on `(deck, layout)`:** lattice, walls, tile
   rects, backdrop, room labels — one `React.memo` child each, rendered
   once per deck. Dynamic layers memoised on the narrow inputs they read
   (`doors` on `state.doors`; `units` on `state.units`; `reach` on
   `reachable`/`forceable`). This is the split the presentation notes'
   "every tier is one `<g>` keyed off state" already asks for.
4. **`hexKey → HexShape` Map** built once in `layoutDeck`.
5. **Pre-blur the backdrop in `backdrop.ts`** (`ctx.filter = "blur(…)"`
   on the canvas that already exists) and delete the SVG filter. The blur
   is in feet; `pxPerFoot = 3` gives the radius in px. **Not measured**
   that the SVG filter is the cost; measure with the Performance panel on
   `warden-tapered`'s hull before doing this.

`<symbol>`/`<use>` for the hexagon was considered and rejected: it shortens
markup but each `<use>` is still a node React reconciles, and the win over
a memoised static layer is nil.

## 2. What the effects cost

Designed so that a running effect never causes a React render:

- ghosts and damage floats live in a **stage `<g>`** React renders empty
  and never touches; the library appends and removes there;
- each frame is one `setAttribute("transform")` or one `textContent`
  write on ≤ 5 elements — the library's whole model is "held frames", so
  there is no per-rAF work at all; between frames the page is idle;
- `hidden` (the set of unit ids to draw at opacity 0) is the *only* thing
  that reaches React, once at effect start and once at end;
- text reveals write `innerHTML` on nodes React does not render into
  (`<Scramble>`), at 84–150ms ticks on ≤ 8 elements.

Under the pan/zoom transform, everything in the stage is in feet and scales
with the map; ghost opacity transitions (`1350ms linear`) are
compositor-only. The one thing to watch: a `wake` over a six-hex path spawns
six clones with a `transition`, and four hostiles do that at once — 24
fading clones plus the scrambling `<text>` on each. Fine in isolation;
**not measured** on a 200-hex deck at 8× zoom, where each clone is a large
filled circle. If it shows, `steppedTransit` (no ghosts) is one line away
and is what the library recommends for crowded hostile turns anyway.

Counter-scaled text (the hovered-hex number from `ground.md` §3, the
damage float) uses a `--inv-scale` CSS variable set on the pan/zoom group by
the ref write in §1.1, and `font-size: calc(var(--unit) * var(--inv-scale))`
— `vector-effect` does not apply to font size.

## 3. Reduced motion

Three layers, so that no single one has to be right:

1. **The library.** Every effect except `hitStop` defaults
   `skip = prefersReducedMotion()` and runs its steps synchronously to the
   final state. The player never calls `hitStop`.
2. **The player.** If `prefersReducedMotion()` or the setting below, it
   does not subscribe at all: `shownEvents` is pinned to `events.length`,
   `hidden` is always empty, `busy` never sets. The screen is the store.
   This is the *degrade to nothing* path, and it is also the path every
   existing test and the playtester already take, because no player is
   mounted there.
3. **CSS.** `@media (prefers-reduced-motion: reduce) { *, *::before,
   *::after { animation-duration: 0.01ms !important; transition-duration:
   0.01ms !important } }` in `index.css` catches `dimIn`, `panelExpand`, the
   ghost transition, and anything a future `Card` housing adds.

Plus a **setting** — *Motion: system / full / reduced* — persisted in
`settings-store` beside volume, default *system*. Some players want the
stepped board and have the OS flag set for other reasons; some want it off
on a machine that does not expose the flag. The player reads the setting;
the setting's default reads the media query.

The animated kit page shows the reduced-motion consequence honestly: on a
kill the token vanishes with no beat and the log line is simply there. That
is correct.

## 4. Access

**Keyboard.** There is none. `grep onKeyDown src/` returns nothing; the
`<svg>` is `role="img"` and the only focusable things on the tactical
screen are four zoom buttons. The kit documents `space`, `L`, `esc`, `z` in
its help table and implements none of them. Plan:

- a **keyboard cursor**: arrow keys (and `q/e` or `,/.` for the two
  diagonal directions a hex needs — the exact map is a decision for the
  help table) move a cursor hex; `Enter` picks it, which is exactly
  `onPick`; `Tab` cycles the selected drone. One extra nullable field in
  `useMissionInput` (`keyCursor: Axial | null`) that feeds `cursor` the
  same way the pointer does, so `plan` and the tile card work unchanged.
  Drawn as the selection-ring polygon in `--ink` at half weight.
- `space` End turn (opens the confirm when it would), `l` log, `Escape`
  closes the topmost of confirm → drawer → chooser → selection, and
  `Escape`/click also **skip** a running playback.
- 200 focusable polygons was considered and rejected: a screen reader
  reading "polygon" 200 times is not access, and focus order over a hex
  lattice is meaningless.

**Assistive text.** The `<svg>` keeps `role="img"` and its `aria-label`,
and gains an `aria-describedby` pointing at a visually hidden summary
(turn, drones and their HP, hostiles in sight) that `GameScreen` renders
from state — the same sentences `log.ts` already knows how to write. The
log strip's newest line is `aria-live="polite"` on the *hidden* final-text
span, never on the scrambling span, or the reader speaks block glyphs.
Every `Card` that opens (drawer, confirm, chooser) is `role="dialog"` with
`aria-modal` and focus moved in and restored on close — `OutcomeDialog`
already does this and is the pattern.

**Contrast.** On the kit's `#0b1526` panel: `--ink #d7e3f6` ≈ 14:1,
`#b3c3db` ≈ 9.5:1, `--dim #8296b4` ≈ 5.6:1 (passes at 11px+ bold or 14px+),
`--friendly #5fb8d9` ≈ 8:1, `--door #d8a94e` ≈ 8:1, `--hostile #cf6a5a` ≈
5:1, the log gutter in `--rule #2b3f5e` ≈ 1.6:1 — rejected in
[conflicts.md](conflicts.md) §4. These are computed from the hex values,
not measured on a rendered frame with the 0.94 alpha over the map; **the
map under a translucent card lowers every one of them by a little** and the
`--dim` labels are the ones to check.

**Focus.** The kit draws no focus rings. `:focus-visible { outline: 2px
solid var(--drone); outline-offset: 2px }` on everything interactive, in
`index.css`, is the whole rule. `--tap-target: 44px` already exists and 4b's
rail honours it; 4a's 32px rail cells do not and should, at the cost of a
56px rail on desktop too — which is what 4b has, and one rail is simpler.

**Colour as the only channel.** `rooms.md` §2 names red-green colour vision
for the hazard rims; the same applies to the kit's *kind* chip in the log
(`fight` in red, `door` in yellow) and the HP tone ramp. Both already carry
the word or the number beside the colour; keep it that way.

## 5. Rejected

- **Canvas for the board.** Would remove the reconciliation question
  entirely and make every effect a draw call. Rejected because the SVG
  *is* the deliverable the design-bundle exports, the presentation notes
  are written against its layers, and 200 hexes is well inside what a
  memoised SVG handles. Revisit above ~1,000 hexes, which no hull in the
  corpus approaches.
- **`will-change: transform` on the pan group.** Promotes 1–2k nodes to a
  layer; the memory cost is real and the win is speculative. Measure first.
- **Virtualising the lattice to the viewport.** Culling hexes outside the
  view at 8× zoom — the win is real but the code is a second coordinate
  pipeline; a memoised static layer makes the off-screen nodes cost only
  rasterisation, which browsers already cull.

## 6. Not verified

- Every "≈" contrast ratio above.
- The frame cost of the SVG blur filter under transform (§1.5).
- That `hexAt` is cheap enough to run per pointermove (it is cube rounding
  — it should be — but `plan` behind it is not, hence §1.2).
- Whether Safari respects `transition` on an SVG `<g>` clone's `opacity`
  the way Chromium does; the library has only been seen running in the
  design canvas.
