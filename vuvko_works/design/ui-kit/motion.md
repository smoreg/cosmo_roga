# Motion — the FX library, and driving it from a reducer

## 1. What `derelict-fx.js` is

534 lines, ESM with named exports and a `window.DerelictFX` global, no
dependencies. Its rule is in its header: *NOTHING INTERPOLATES. Every
visual state is one of a small set of discrete frames held for a fixed
number of ms. No easing curves, no tweens.* `FRAME = 225` ms; every
duration is a multiple of it or of `0.6 × 225 = 135`. All scheduling is
`setTimeout`/`setInterval`; one `requestAnimationFrame` kicks a ghost's
opacity transition. No Web Animations, no canvas, no promises — every call
returns `{ cancel() }` and signals completion only through `onDone`.

Fifteen functions in four groups:

| group | function | duration | what it touches |
|---|---|---|---|
| sequencer | `frames(steps, {frame, delay, onDone, skip})` | steps × 225 | nothing; runs your callbacks |
| text | `scrambleReveal(els, preset)`, `setAndReveal(els, texts, preset)` | preset | `el.innerHTML` with `<span style="opacity:.42">` for unresolved glyphs; caches original in `el.dataset.text` |
| tokens | `wake(el, path, {place, ghostMs 1350})` | (path+1) × 225, + 1350 ghost tail | clones `el` into `el.parentNode` per step as a fading scrambled ghost; moves `el` through `place(el, pos)` |
| | `blink(el, to)` | 7 × 135 = 945 (doc says 810) | opacity flicker then `place` |
| | `teleport(el, to)` | 8 × 135 = 1080 | scramble face, cut, reassemble |
| | `steppedTransit(el, path)` | path × 225 | `place` per frame, no ghosts |
| combat | `impact({attacker, target, edge, damageEl, damage})` | 7 × 225 = 1575 | attacker glyph → `▚`; edge `░▒▓`; target `background` flash; leaves `target.style.opacity = .62` |
| | `edgeBurst({target, edge, damageEl, damage})` | 5 × 225 = 1125 | edge `░ █ ▓`; target `filter: invert(1) brightness(2)`; same hurt-opacity tail |
| | `exchange(...)` | impact, one dead frame, reversed impact ≈ 3375 | |
| screen | `hitStop(ms = 60, {onResume})` | ms | **nothing** — a bare timeout; the docstring's "applies a class you define" is not implemented, and it ignores reduced motion |
| | `clearGhosts(root)` | — | removes `[data-fx-ghost]` |
| | `prefersReducedMotion()` | — | `matchMedia` |

Presets (`stagger / ticks / tickMs`): hover 0/4/84 (336ms), panel
135/4/114 (861ms), panelEdge 120/3/120, value 0/7/120 (840ms), log
360/4/150 (960ms for one line; four lines land over ~2s), name 165/5/105,
menu = boot 900/5/180.

**What it assumes about the host.** Plain DOM elements with text; a
positioned parent for tokens (ghosts are appended to `parentNode`, as the
*last* child); coordinates only through the injected `place(el, pos)`,
which defaults to `style.left/top` in px. It knows nothing about hexes,
SVG, React, or coordinate systems. The library's own note calls `place()`
"the whole portability story". It respects reduced motion by default on
every effect except `hitStop`, jumping to the final state synchronously.

**What it leaves behind.** `cancel()` stops timers and *leaves the DOM as
is*: a cancelled `wake` leaves its ghosts (they were to be removed by the
timers just cleared) — the demo pairs it with `clearGhosts`. `edgeBurst`
never restores `edge.style.color`; `impact`/`edgeBurst` intentionally leave
the target at `hurtOpacity`. The demo harness resets all inline styles by
hand before each run.

**What the animated screen does with it.** `Kit screen animated.dc.html`
is 1280×720 of absolutely positioned HTML hexes (62×70 divs with a
`clip-path` hexagon) and calls the module directly with `onDone`
callbacks — no events, no bus. Its two rhythms are the whole lesson:

- **Player action is sequential:** `busy = true` → `wake` the token →
  `onDone` commits position and cost → unit panel re-reveals (`panel`
  preset) → tile panel re-reveals → log line reveals (`log` preset). The
  log lands *after* the token does.
- **Turn end is one simultaneous burst:** turn number (`value`), enemy
  `wake`, alert dial repaint, log line, unit panel — all kicked off in one
  synchronous pass, done in ~1.1s.

Chrome (drawer, modal, log panel) uses CSS keyframes with easing
(`drawerIn 320ms cubic-bezier(.22,.61,.36,1)`, `riseIn 260ms ease-out`).
Everything on the board is frame-stepped JS. That split — **eased chrome,
stepped board** — is the one to keep.

## 2. Where it conflicts with the essay

*Why it reads as a dashboard* prescribes a motion budget: button press
scale 0.97 / 90ms, panel open 240ms with easing "everywhere else", **hp
meter counts down over 320ms**, hit-stop 60ms before a kill's log line,
alert dial advancing one segment over 600ms, jump transit 480ms, and
*everything else 0ms — no shake, no flash, no idle motion on data*. The FX
library says nothing interpolates. Both are in the kit; they cannot both
win on the same element.

Decision: **the board is stepped, the chrome is eased, and numbers are
neither tweened nor scrambled — they cut.** Reasons: a hex game's moves
*are* discrete, so a token stepping hex to hex is honest where a tween is
a lie about what the rules did; stepping is one `setAttribute` per frame,
which is what an SVG of 200 hexes can afford under a transform (see
[performance-and-access.md](performance-and-access.md)); and the essay's
"no idle motion on data" is a better rule than its own counting-down
meter — the essay's segmented meter (12 cells) dropping cells per frame
satisfies both documents, so that is what `Meter` does. The `value` preset
(a number resolving from block glyphs for 840ms) is rejected for HP and
pool: 840ms is longer than the strike it reports, and the essay's "no
flash on data" applies. It is kept for the turn number alone, once per
turn, because that is the one number whose change *is* the event.

`hitStop` is kept as an idea and not as a call: it does nothing. The
player's queue (§3) simply holds 60ms before the `unitDestroyed` beat.

## 3. Driving it from the reducer

### 3.1 What the game already has

`applyCommand(deck, state, command): { state, events }` — pure, `rng`
threaded through state, no `Math.random`. The header of `apply.ts` says why
the event list exists: *lets the renderer animate from the event list
rather than diffing state*. `game-store.dispatch` commits `result.state`
at once and appends `result.events` to a **mission-long cumulative array**.
The only consumer is `describeAll(events)` → `MissionLog`. The ship's turn
is one dispatch: `endTurn` runs `runShipTurn` to completion, income →
build → every hostile acts → turrets → outcome, and the board teleports.
There is no per-dispatch batch boundary, no cursor, no `animating` flag,
no subscriber. `unitMoved` carries `from`, `to`, `enteredZone` — not the
path.

### 3.2 The rule

**The store commits immediately, as now. Nothing about animation enters
`GameState`, the store, or `core/`.** A separate, droppable *presentation*
layer decides how much of the committed truth is *shown yet*, and it can be
thrown away at any instant (skip, reduced motion, unmount) leaving the
screen showing exactly the store. If the presentation layer and the store
ever disagree, the store is right and the presentation layer is at fault;
there is no path by which an effect writes a fact.

### 3.3 The smallest honest mechanism

Three additions, none in `core/`:

**(a) A batch boundary.** `dispatch` keeps its shape and also records
`lastBatch: { seq: number, events: readonly GameEvent[] }`. One field. It
is not consulted by anything that decides rules; it is the message from
the store to the player.

**(b) A presentation store** (`src/stores/presentation-store.ts`, zustand
like the others, or a plain `useSyncExternalStore` ref — it does not
matter): `{ shownEvents: number; hidden: ReadonlySet<number>; busy:
boolean }`. `shownEvents` is how many of `game-store.events` the log may
render. `hidden` is the set of unit ids the token layer draws at `opacity
0` because a ghost is standing in for them. `busy` locks input. Under
reduced motion, or with no player mounted, `shownEvents === events.length`,
`hidden` is empty, `busy` is false, and the screen is the store.

**(c) A player** (`src/hooks/useEventPlayer.ts`) that subscribes to
`lastBatch.seq`, walks the batch, and for each event either advances
`shownEvents` or runs an effect and *then* advances it. It holds every
`{cancel}` handle; `skip()` (click on the map, space, or a new batch
arriving) cancels all, calls `clearGhosts`, empties `hidden`, sets
`shownEvents = events.length`, `busy = false`. The player owns a `Stage`:
an empty `<g>` inside `DeckView`'s pan/zoom group that React renders once
with a ref and never gives children, so React never reconciles the ghosts
appended there.

The map draws from `state` throughout. A unit that has moved is *already*
at `to` in React's tree; the player hides it (`hidden`), clones its `<g>`
into the stage at `from`, walks the clone along the path with `wake` (or
`steppedTransit` for hostiles, as the library's own note recommends for
"hostile turns with four movers at once"), then un-hides. `place` is
`(el, p) => el.setAttribute("transform", \`translate(${p.x} ${p.y})\`)` in
ship feet, so effects zoom with the map for free.

### 3.4 Event → effect

| event | effect | beat |
|---|---|---|
| `unitMoved` (drone) | hide, clone, `wake` along the path | sequential; log line after |
| `unitMoved` (hostile) | `steppedTransit`; several may overlap | part of the turn burst |
| `unitShoved` | `blink` from → to | |
| `attackDeclared` | place the edge glyph at the midpoint of attacker and target (as the animated screen does: `(a+b)/2`) | 0ms |
| `strikeLanded` | `edgeBurst` with `damage: "-N"`; damage float is an SVG `<text>` in the stage | 1125ms; consecutive strikes queue |
| `strikeMissed` | edge `░` for one frame, no target flash | 225ms |
| `unitDestroyed` | hold 60ms (the essay's hit-stop), then `frames` `▓▒` → `░░` → opacity 0 over 3 × 225 as the animated screen does; **then** the log line | |
| `objectDestroyed` | same dissolve on the object glyph | |
| `hostileBuilt` | `blink` in at the spawner | |
| `doorForced` / `doorShut` / `doorCut` | the leaf changes state in React already; one frame of `--ink` stroke on the leaf from the stage | 225ms |
| `turnBegan` (ship) | `busy = true`; the turn number `value`-scrambles once; nothing else | starts the burst |
| `turnBegan` (drones) | `busy = false`; unit card re-reveals with `panel` | ends it |
| `incomePaid`, `buildBlocked`, `hazardBit`, `workBanked`, `shipRoused` … | log line only | 0ms |
| `missionEnded` | nothing; `OutcomeDialog` is already conditional on `state.outcome` and should mount only after `shownEvents` reaches the end | |
| `commandRefused` | nothing | |

The text side: `LogStrip` reveals each newly shown line with the `log`
preset; `UnitCard` and `TileCard` reveal with `panel` on selection change,
`hover` never (the tile card is not a tooltip and should not flicker).
Text reveals stay in HTML; the library writes `innerHTML` with `<span>`,
which does not render inside `<svg>`, and porting `paint()` to `<tspan>`
buys nothing the board needs.

**React and `innerHTML`.** An element React owns will be overwritten on the
next render. So a `<Scramble text>` atom owns its node: it renders an empty
`<span ref>` plus a visually hidden `<span>{text}</span>` for assistive
tech, and runs `setAndReveal` in an effect keyed on `text`. React never
renders children into the visible span. That is the only way to keep the
library's DOM writes and React's from fighting, and it is a ten-line
component.

**The path.** `unitMoved` has no path. Two options: reconstruct
presentation-side with `distanceField` from `core/paths.ts` (cosmetic;
may differ from the route the rules used when two are equal), or add
`path: readonly Axial[]` to the event in `core/` — a one-line change in
`moveUnitTo` if `intentFor` already has the route. The second is honest and
preferred; **not verified** whether `intent.kind === "move"` carries the
route or only the destination.

### 3.5 Turn end, end to end

Space (or the button) → `EndTurnConfirm` if any drone has movement →
`finishTurn` → one `dispatch(endTurn())` → the store now holds the
post-ship-turn state and `lastBatch` holds 10–40 events → the player sets
`busy`, and — as the kit does on confirming — **opens the log drawer**;
the turn number scrambles; hostiles step, in parallel, one `steppedTransit`
each; strikes queue after moves; a kill holds 60ms then dissolves; each
event's log line arrives as its effect ends; `turnBegan(drones)` closes
the burst, `busy` clears, the drawer stays open until the next input. A
click anywhere skips to the end. Reduced motion: the drawer opens with
every line present, and the board is already there.

Total for a four-hostile turn with two strikes: ~2.5s, skippable. The
animated screen's burst is ~1.1s; the game has more movers.

## 4. Where the library lives

`src/vendor/derelict-fx.js` verbatim with a hand-written
`derelict-fx.d.ts`, lint-ignored like `geomorph-core.js` — the house
pattern for someone else's code. Not a TypeScript port: 534 lines that
work are worth more than 534 lines that are ours, and the doc/code
mismatches (§1) are fixed by the `.d.ts` comments, not by editing the
file. `impact`, `exchange`, `teleport`, `scrambleLike` and `hitStop` are
simply not called.

A new boundary element `fx` (`src/fx/**`: the player, the stage, the
scramble atom's helper) may import `core` types and `stores`, may not be
imported by `core` or `render`. `render/` stays a renderer.

## 5. Rejected

- **A "presented state" that trails the store.** Tempting — the map draws
  from a snapshot the player advances event by event — but events are not
  state deltas, and `applyAll(history.slice(0,n))` gives states at
  *command* boundaries, not per event; a ship turn is one command. Two
  states on screen is also two sources of truth, which is the thing the
  brief forbids. Hiding-and-cloning costs a set of ids and nothing else.
- **Making the ship's turn step-able in `core/`** (a generator yielding
  after each hostile). It would give the player real per-event states, but
  it puts presentation pacing into the rules engine, which is "pure, seeded,
  replayable" by lint rule, and `playtest.ts` folds thousands of turns
  through it.
- **A CSS-transition approach** (`transition: transform 225ms` on tokens).
  Cheaper to write, but it tweens — the library's rule exists for a reason,
  and a token sliding *through* a bulkhead reads as a bug.
- **Scrambling numbers on the board** (`showHexHp`-style HP text). "No
  idle motion on data."
- **Sound cues from the player.** The essay wants five; `lib/audio.ts`
  exists; the player is the right place to fire them. Out of scope for this
  note, but the player's event switch is where they go.

## 6. Not verified

- That React 19 leaves foreign children of a ref'd empty `<g>` alone across
  re-renders of its parent. It should (React reconciles only its own
  children), and the design-bundle's `useId` note shows the team has been
  here before with SVG ids, but it needs a test with StrictMode double
  effects.
- The 60ms hit-stop and the 225ms frame are both single-source numbers; the
  essay says so of its own timings. `FRAME` is one constant, which is the
  point.
- Whether `intentFor` exposes the route (§3.4).
