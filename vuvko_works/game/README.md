# Derelict Extraction

Turn-based hexagonal extraction tactics in a generated derelict. This is the
game project; the design it implements is in [`../design/`](../design/), and the
rules experiment it grew out of is frozen in [`../prototype/`](../prototype/).

```
npm install
npm run dev          # play it: http://localhost:5173
npm run storybook    # the component library
npm run check        # format, lint, typecheck, test — everything CI runs
```

## Playing it

Click a drone to take control. Hover anywhere it could reach and the route
appears as a chain of arrows — **white** to step, **struck through** when it is
refused, with the reason in the log strip. Click to walk the whole route; it is
sent as one command per step, so a move stays undoable and replayable.

Hover a hostile and the drone plans to walk up and swing: the last arrow turns
**red**, and **which side it comes at it from follows your cursor** — lean left
of a sentinel and it approaches from the left. A drone already beside its target
stays put rather than shuffling around it, unless you lean hard the other way.
Clicking runs the walk and then opens the chooser, which states the odds in both
directions before you commit.

Hexes the drone can walk to this turn are tinted **blue**; ones it could only
get to by shouldering a shut door open are tinted in the **door's own yellow**,
because that costs the whole move. Between them they cover everywhere the
arrows will actually take it — the highlight and the plan must never disagree.

Drag to pan, wheel or pinch to zoom, double-click or **fit** to reset.
**Right-click** clears the selection.

A drone attacks whether or not it has movement left; it just cannot attack
twice. Walk into a shut door to force it, and cut a locked one open.

## Layout

```
src/
  core/         the rules engine — pure, seeded, no DOM, no React
  components/   atoms / molecules / organisms
  stores/       zustand; drives the reducer, decides nothing
  lib/          adapters between core and UI (events -> prose)
  pages/        screens
  stories/      Storybook
  assets/decks/ exported deck maps
eslint-rules/   the two local lambda rules
scripts/        asset baking (Python), as in Stillpoint
```

## The architecture

**Commands in, events out.** `applyCommand(deck, state, command)` returns a new
state and a list of events. Nothing mutates what it was handed.

```ts
const { state, events } = applyCommand(deck, state, moveUnit(0, { q: 1, r: 4 }));
```

Three things follow from that, and they are the reason for it:

- **A match is `{ seed, commands }`.** Randomness is counter-based — a draw is a
  pure function of the seed and a cursor the state carries — so replaying a
  command list reproduces a match exactly. A bug report is a string.
- **The renderer animates events**, rather than diffing state after the fact.
  `attackDeclared`, then a `strikeLanded` per blow, then `unitDestroyed`.
- **Tests assert on what happened**, not on what things ended up looking like.

**Events are built by name.** Every event has a constructor in
[`src/core/events.ts`](src/core/events.ts) — never an inline object literal — so
the set of things the game can report is a list you can read in one file.

**`src/core` is walled off.** It may not import React, a store, a component, or
touch the DOM, and that is a lint error rather than a convention. It is the
thing that has to stay pure for any of the above to hold.

## The lambda policy

Logic is written as named function declarations. Arrow functions are for short
inline callbacks doing something not already named somewhere. Two custom rules
in [`eslint-rules/`](eslint-rules/index.js) enforce the part `func-style` cannot:

```ts
units.filter((u) => isDrone(u)); // house/no-wrapper-lambda — pass isDrone
units.map((u) => u.hp / u.maxHp); // house/no-duplicate-lambda, if written twice
```

The second rule shares state across a whole lint run, so it catches a body
repeated in a different file and names the place it first appeared. It found a
real duplicate in `actions.ts` the first time it ran.

## Checks

| Command                 | What it does                                                                |
| ----------------------- | --------------------------------------------------------------------------- |
| `npm run format`        | Prettier, which owns whitespace; ESLint owns everything semantic            |
| `npm run lint:fast`     | oxlint — a Rust pre-pass for the obvious, in the commit hook                |
| `npm run lint`          | ESLint: `strictTypeChecked`, boundaries, the lambda rules. CI, not the hook |
| `npm run typecheck`     | `tsc -b` across both project references                                     |
| `npm test`              | Vitest, split into a `core` project (node) and `components` (jsdom)         |
| `npm run coverage`      | Thresholds are 60% overall and **90/85% for `src/core`**                    |
| `npm run knip`          | Dead code and unused dependencies                                           |
| `npm run design:bundle` | Renders the components to static previews for Claude Design                 |

The core is held to a different standard than the React chrome because it is
pure, cheap to test exhaustively, and a bug there is a gameplay bug. It is at
100% of functions and ~99% of lines, including a property-based check that the
same seed and command list always produce the same state.

A **pre-push hook** runs all of this before anything reaches the remote, and
refuses the push if it fails. Hooks are not installed by cloning, so once per
checkout: `git config core.hooksPath .githooks`. See
[`../../.githooks/README.md`](../../.githooks/README.md).

Type-aware linting is the slowest step, so the pre-commit hook
([`lefthook.yml`](lefthook.yml)) runs only format, oxlint and typecheck — a hook
people wait ten seconds for is a hook people skip.

## Claude Design

`npm run design:bundle` renders the **real components** to static HTML with
`react-dom/server` and writes them to `design-bundle/`, one card per component
with an `@dsCard` group marker. Previews are generated rather than hand-written,
so a card cannot quietly drift from the code it documents — the 56% on the
forecast card is the convolution's own output, not a typed-in number.

The project is _Derelict Extraction — Design System_. Re-run the bundle and push
the changed paths; it is an incremental sync, never a wholesale replace.

## The map

`src/render/` turns a deck into things to draw — bounds, hex polygons, hull and
bulkhead segments, door leaves — in feet, with no DOM and no React. The
`DeckView` organism draws it: the ship underneath behind a Gaussian blur, the
lattice over it.

The backdrop is out of focus on purpose. It is there to say what kind of place
this is — the shape of the compartments, where the structure is dense — without
competing with the grid you play on. **The rooms are the map; the hexagons are
guidance.**

`src/render/backdrop.ts` is `hexmap.html`'s own raster routine, kept: each
placement is drawn rotated about its centre with the whole tile image, bleed
included, at 12 px to the foot in the source. Reusing it rather than baking the
plan offline means one implementation — and it works just as well on a plan a
generator produced a moment ago as on one loaded from an export.

**The lattice is flat-top, turned a sixth and stood on the keel**, and column
zero sits at `(shipWidth / 2, 0)` — the origin `hexmap.html` builds the map
with. `deckGeometry()` owns that so nothing else has to remember it, and
`deck-geometry.test.ts` guards it: get the origin wrong and the blueprint lands
half a ship away from the hexes over it. An export made with the older
pointy-top lattice will look rotated under this one; `example-derelict/` holds
only current exports for that reason.

Without the tile library the map falls back to a schematic drawn from the
deck's own shapes and the tile footprints in the plan — enough structure to
read as a plan rather than a stain, and it needs no assets at all.

### Two things the tiles taught us the hard way

**Never assume the artwork's resolution.** What ships is a downscaled bake, not
the source. Reading a 2 px/ft bake as though it were the 12 px/ft source makes
every tile a sixth of its size, and the deck plan looks as though it has simply
gone. The bake now writes `atlas.json` beside the tiles saying what it did, and
the renderer reads it. `tileGeometry()` is pulled out on its own so the
arithmetic can be checked without a canvas.

**The atlas resolution is set by map generation, not by how it looks.**
Generation rasterises a hull at 4 px/ft, so a 4 px/ft atlas goes down one for
one with no resampling and the rooms match the source exactly. Below that,
thin walls fall under a pixel, smear, and cut compartments in half. On one
ship:

| Atlas             | Rooms found | Floor found      |
| ----------------- | ----------- | ---------------- |
| 12 px/ft (source) | 26          | 44,810 sq ft     |
| **4 px/ft**       | **26**      | **44,810 sq ft** |
| 3 px/ft           | 33          | 41,474 sq ft     |
| 2 px/ft           | 53          | 36,883 sq ft     |

It is resolution that does this and not compression — lossless at 2 px/ft is no
better than quality 70.

**Tiles are clipped to their own footprints.** The 10 ft bleed exists so a
tile's art runs past its edge to meet its neighbour's, which means neighbours
draw the same strip twice. Painted one over the other, two antialiased edges do
not overlay, they accumulate, and the join reads as a denser band once
everything is flattened to one ink — 0.4% of one measured plan, up to a third
of an alpha step too dark, most of it along tile boundaries. Clipping drops the
duplicate strip so there is nothing to accumulate, and snapping the clip to
whole pixels stops a hairline appearing instead.

Blurring tiles individually would make this worse, not better: each tile's blur
fades its own edges into the bleed, and the composite then joins two
artificially faded edges. The blur belongs after compositing, on the whole
image, where the only edge left is the real outside of the ship.

`GameScreen` is responsive by **container query**, not media query: it responds
to the space it is given rather than the browser window, so it lays out
correctly inside a Storybook frame and a design-system preview card as well as
at a real viewport. Below 860px the squad column becomes a strip you swipe and
the map keeps the space.

## What is not here yet

- **Tiles in a shipped build.** `vite-plugin-geomorphs.mjs` serves the library
  at `/geomorphs/` in dev and in Storybook, but the artwork lives outside the
  project and is not committed. A build needs those tiles copied into `public/`
  — or, once missions are generated, a downscaled atlas of them.
- **Undo.** The reducer makes it nearly free — the command list is already the
  save format — but nothing calls it yet.
- **Animation.** Events arrive as a list per command; the renderer still draws
  the end state rather than playing them out.
- **Procedural map generation.** Today a deck is an exported JSON from
  `hexmap.html`. `parseDeck` is the seam; a generator produces the same shape.
- **Everything in the design doc past the tactical floor** — the alarm, noise,
  inventory and loot, the hack-and-hold verb on nodes, extraction.

## Deploying to itch

```
butler login                  # once
cp .env.example .env          # then set ITCH_TARGET to your user/game-slug
npm run deploy:itch           # builds, then pushes dist with butler
```

`npm run build` first runs `assets:tiles`, which copies **only the tiles the
shipped decks reference** into `public/geomorphs` — eight files, 0.8 MB, out of
a 634 MB library — so a deployed build still draws the real blueprint. Without
the library present the step says so and the build continues; the map falls back
to its schematic.

The tiles path is resolved against `import.meta.env.BASE_URL`, because itch
serves a game from a subdirectory and an absolute path would miss.

## Licence

The deck artwork is **CC BY-NC** (RPG Mobius Geomorphs). This game stays
non-commercial; see [`../ATTRIBUTION.md`](../ATTRIBUTION.md).
