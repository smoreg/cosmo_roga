# Merging the halves — a plan

The decision has been taken: **the engine is SALVOR's, the face is
Extraction's.** The game logic comes from `smoreg_works/`; the UI, the
animation and the sound design come from `vuvko_works/`. This note is the plan
for doing that, and it exists to be argued with.

Written 2026-09-14, after reading both halves again. It builds on
[converging-with-salvor.md](converging-with-salvor.md), which priced every
piece in September and recommended exactly this direction; that note is still
the source of truth for *what the two halves are* and this one does not repeat
it. What this note adds is one new requirement, one correction to how the older
note priced the shell, and an order of work.

## Summary

The merge is **cheaper than the older note priced it**, for a reason that note
did not have in front of it: SALVOR's UI is already split into a tier of pure,
DOM-free functions and a 121-line file that writes a string into `innerHTML`.
The React shell does not have to be built over the engine. It replaces one
file and consumes a tier that already exists and is already tested.

The expensive part is somewhere else entirely, and the older note does not
mention it: **the 95×42 character grid is baked into the "pure" tier**. That,
not the engine, is what a fluid UI has to pay for.

## The one new requirement

> **The merged project must stay exportable to Claude Design.**

`vuvko_works/game/scripts/design-bundle.tsx` renders the real components to
static HTML so the kit cannot drift from the code it documents. It works by
calling `renderToStaticMarkup` on actual React components. That is why React
is in the plan at all.

**This has a precedent on the other side, and an objection recorded against
it.** `smoreg_works/docs/tasks/G61-web-design.md` is the task where the owner
brought Claude Design artboards and had them built as the web view — and the
artboard source was deliberately *not* committed, on the grounds that 145 KB of
markup with baked-in words must not become a second source of truth next to
`t()`. Not one word from the artboards was carried into the code.

That objection is correct and the export must be built to respect it:

- **The export runs code → artboard, never artboard → code.** The bundle is a
  picture of the components; it is never a source anything is generated from.
- **Every string in an exported component comes from `t()`.** Extraction's
  components have English inline today. Routing them through the i18n table is
  a precondition of the export, not a follow-up.

Get that wrong and the merge re-creates exactly the problem SALVOR's docs
refused.

## What the survey changed

Three findings move the plan more than anything in the older note.

### 1. The seam already exists, and it is one file

SALVOR's graphic view decides *what is on screen* with pure functions —
`schematic()`, `panelBlocks()`, `roomActions()`, `titleScreen()`, `helpPages()`,
`logFades()` — which return text and line structures and touch no DOM. Input is
`toIntent(key) → UiIntent`, and `appReducer(state, intent) → {state, effect}`
is an Elm-shaped reducer with a tagged-union `AppEffect`, tested, that **never
touches the game**. The shell applies the effects.

The entire DOM surface of that view is `ui/web/mount.ts` — 121 lines: one
element, one `innerHTML`, one click listener that turns a click into a line
index.

So the plan's earlier claim that a React shell means "a rewrite of `ui/app.ts`
and the two view mounts" is wrong. **React replaces `mount.ts` and consumes the
pure tier.** `appReducer` and `AppEffect` stay as the interface. This is the
cheapest thing in the whole merge and it should be done first, because it
proves the shape.

### 2. Undo is available after all

The older note left this open and this plan called it the highest-value
question for a spike. It is answered: a SALVOR run is reproducible as
`(seed, inputs)`, `replayRooms` is the proof, and
`games/salvor/tests/determinism.test.ts` and `replay.test.ts` enforce it.

That is the same property Extraction's undo is built on. Truncate the input
list, replay, and the Undo button survives the merge with its rule intact —
take back anything that revealed nothing. It is not free, because replay costs
more over a mutable game than over a reducer and the "revealed nothing" test
has to be re-derived from SALVOR's own log, but it is available, and it was the
thing most at risk.

### 3. The licence problem may simply dissolve

Extraction's best visual idea is the deck plan under the honeycomb, and it is
also its worst legal problem: the geomorph art is CC BY-NC, which the merged
game inherits the day it draws a tile.

SALVOR already draws hulls — `ui/web/hullart.ts`, 1342 lines of procedural SVG
hull silhouette, plus its own pixel tile set generated in-repo. If the merged
game takes SALVOR's hull art as the thing under the honeycomb, **it gets the
visual idea without the licence**, and `vuvko_works/game/src/render/*` — the
whole geomorph backdrop pipeline — does not move at all.

This should be tested with a picture before it is decided. The geomorph plan is
a photograph of a real deck and the procedural art is a silhouette; they may
not read the same way at all. But it is the first thing to try, because the
version that works is dramatically cheaper and has no lawyer in it.

## The expensive part: the grid is baked into the pure tier

`ui/theme.ts` holds `LAYOUT` — `mapWidth: 66`, `sidebarWidth: 29`,
`logHeight: 7` — and those numbers leak into the functions that are otherwise
clean: `PANEL_WIDTH` in `ui/panel.ts`, `HELP_ROWS = SCREEN_HEIGHT - 8` in
`ui/input.ts`, `ACTION_WIDTH = 25` with `fitLabel`, `clipName` and `pad` in
`ui/actions.ts`. The tests assert against the clipped output.

A fluid HTML UI that consumes these inherits arbitrary truncation: names cut at
25 characters for a column that no longer exists. And Extraction's kit is
explicitly not a character grid — it is 300px panels, a condensed label face,
and a type scale.

This is the real work, and it is worth doing properly rather than working
around:

- **Separate content from fitting.** `roomActions()` should return the label
  and let the renderer decide whether it fits; `fitLabel` becomes something the
  ASCII renderer calls, not something the pure function does.
- **Parameterise the widths** rather than deleting them, so the ASCII view
  keeps working. It is a real view with real tests and dropping it is a
  separate decision — and not a clean one, because `ui/render.ts` also owns
  shared strings (`endingBanners`, `restartHint`, `cardTitles`, `runSummary`)
  that the web view imports.
- **Update the tests to assert on content**, with the fitting tested
  separately against the ASCII renderer.

Budget this as the largest single item in the plan.

## What moves from this half, by what it is bound to

### Band 1 — free. Bound to nothing.

Moves by copying. No engine knowledge, no Extraction types.

| Piece | What it is |
|---|---|
| `src/vendor/derelict-fx.js` + `.d.ts` | The animation library. 534 lines, no dependencies |
| `src/lib/tempo.ts` | Three frames where the kit had one, over the same span |
| `src/lib/running.ts`, `src/lib/keys.ts`, `src/lib/contrast.ts` | Cleanup, key binding, WCAG ratios |
| `src/hooks/useReveal.ts` | The descramble contract, in 76 lines |
| `src/hooks/usePanZoom.ts` | 231 lines; knows about pointers and a viewBox |
| `src/index.css`, `GameScreen.css` | The palette, the type scale, the keyframes |
| Atoms: `Tag`, `HitPointsBar`, `OddsBar`, `BuildStamp` | Take numbers and strings |
| `ConfirmEndTurn` | Takes a list of names and two callbacks |

The kit's identity — navy, mono, block glyphs, stepped frames, corner brackets
— lives almost entirely here, and it costs nothing to move. **Two caveats.**
The palette has to meet `content/palette.ts`, which is SALVOR's token source and
carries two documented invariants (amber means "a decision is required here"
and nothing else; only one element may carry three signals at once) — those are
good rules and the merged palette adopts them. And every string goes through
`t()`.

### Band 2 — bound to Extraction's shapes; re-point at SALVOR's pure tier.

`MissionLog`, `UnitCard`, `ForecastPanel`, `AttackChooser`, `OutcomeDialog`,
`MissionBriefing`, and the `GameScreen` layout. These read a handful of fields
and need a view model — and the view model is largely `panelBlocks()`,
`roomActions()` and `logFades()`, which already exist. The work per component
is small; the work is in there being a dozen of them.

The one genuine design question in this band: **rack or hit points.**
`UnitCard` and `HitPointsBar` draw a bar; SALVOR's rig is a chain of modules
and damage routes into it. Drawing the rack is the more interesting widget and
the more honest one. Recommend drawing the rack.

### Band 3 — bound to Extraction's engine. Port or drop.

| Piece | Verdict |
|---|---|
| `DeckView` (835 lines) | Port the *treatments* — hollow corridor, door segments, token styling — onto `hex-svg.ts`, which already draws the lattice. Do not port the file |
| `useBoardFx` | Needs an event stream. See below |
| `useMissionInput` | Drop. Selection, reachability and intent are Extraction's rules; SALVOR's are `toIntent` + `appReducer` |
| `stores/game-store.ts` | Drop the reducer, keep the undo *idea* on `replayRooms` |
| `src/render/*` | Drop, if SALVOR's hull art wins the picture test |

## Animation needs events, and there is half a stream already

`useBoardFx` plays a *beat* — what one player action produced — which is why a
walk animates as a walk rather than as four one-hex jumps. A route cannot be
recovered from two snapshots, so this is load-bearing and not optional.

SALVOR has something adjacent: `sim/log.ts`, and `ui/sfx.ts` already triggers
sound **by reading new log lines**. So a stream is being consumed today. The
problem is that it is keyed off wording — the survey flags it plainly, and a
text rewrite silently kills a sound.

**Recommendation: promote log lines to keyed events.** `sfx.ts` stops matching
on prose and matches on a key; `useBoardFx` gets the same stream; i18n stops
being load-bearing for audio. This is one change that fixes an existing
fragility and unblocks the animation layer, and it is additive — hooks append,
the batch is published at the end of the command, nothing else changes.

## Sound: correct the assumption

"Sound design from `vuvko_works`" needs qualifying, because on the code the
traffic runs the other way. SALVOR has `packages/audio` (pure `plan.ts` with
equal-power crossfades and phrase-aligned transitions, plus `adaptive.ts`), a
music state machine, 13 tested SFX, the `.ogg` assets, and Strudel-style
authoring scripts. This half has a 131-line music player.

What this half contributes is the **design**, in `design/ui-kit/motion.md`:
cues fired from the player's own event switch, so presentation pacing never
enters the rules. That is a good rule, it is the same rule SALVOR's purity test
enforces, and it fits `packages/audio` without argument.

**Keep SALVOR's audio. Take the cue discipline and drive it from the same event
stream as the animations.** One stream, two consumers.

## Order of work

**Phase 0 — prove the shape (days).** Three spikes, throwaway: React root
replacing `mount.ts`, rendering the existing pure tier with the kit's palette;
one picture comparing SALVOR's hull art against a geomorph backdrop; one
`replayRooms`-based undo. Everything after is planned against the answers.

**Phase 1 — Band 1 and the export.** Move the free layer. Stand up
`design:bundle` immediately, with `t()` wired, so the export is proven before
anything depends on it and the G61 objection is answered in code.

**Phase 2 — un-bake the grid.** Separate content from fitting in the pure tier;
parameterise the widths; move the fitting tests to the ASCII renderer. Largest
item. Nothing visual gets good until this is done.

**Phase 3 — the panels.** Band 2 against the pure tier. Rack widget.

**Phase 4 — events, board, motion.** Keyed events; `hex-svg.ts` gains the
kit's treatments; `useBoardFx` on the stream; SFX re-pointed at keys.

**Phase 5 — undo, and the deferred decisions.** Languages, the ASCII view's
future, the grid world's future.

## What could sink it

- **The jam.** SALVOR is an entry to roguetemple's Fortnight 2, deadline **15
  September** — tomorrow. Its `main` is held submittable and its scope rules
  forbid a new mechanic. Nothing touches `smoreg_works/` before it closes;
  Phase 0 can be done entirely by reading.
- **Consent.** No document in `smoreg_works/` discusses merging with another
  codebase at all — this is new to that half, and `converging-with-salvor.md`
  says plainly it cannot assume its authors' agreement. That is not a technical
  question and it is the first one to settle.
- **The protocol.** `docs/tasks/README.md` is a real agent protocol with a task
  ledger, waves and gates, and a rule that says *do not test the game in a
  browser* — everything is proved by vitest and pure functions. This half's
  practice is the opposite: screenshots against references, Playwright, a
  visual kit. Both are defensible and they will collide on day one. Decide
  which discipline governs the merged repo before writing code, not after.
- **Two lint disciplines and two doc languages.** Extraction forbids wrapper
  lambdas and holds `core/` to 90% coverage; SALVOR is written in arrows, and
  its docs are Russian while its game texts are English. Decide the house style
  once, at the start.
- **Dead weight.** If the merged game does not want the grid world, roughly
  half of `packages/engine` plus `games/fortnight2` becomes unused — and the
  docs are explicit that deleting it was never sanctioned.

## Open questions

1. Does SALVOR's hull art carry the picture, or is the geomorph plan worth its
   licence? One screenshot decides it.
2. Rack or hit points on the unit card?
3. Does the merged game keep three languages — and does the kit's type scale
   survive Russian and German?
4. Does the ASCII view live on? It is a real view with real tests, and
   `ui/render.ts` holds strings the web view imports.
5. Whose protocol governs the merged repo — vitest-and-pure-functions, or
   screenshots-against-references?
6. Where does the merged project live: a third directory, or does one half grow
   into the other?
