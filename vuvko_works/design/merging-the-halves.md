# Merging the halves — a plan

The decision has been taken: **the engine is SALVOR's, the face is
Extraction's.** The game logic comes from `smoreg_works/`; the UI, the
animation and the sound design come from `vuvko_works/`. This note is the plan
for doing that, and it exists to be argued with.

Written 2026-09-14. It builds on
[converging-with-salvor.md](converging-with-salvor.md), which read both halves
in September and priced every piece; that note is still the source of truth for
*what the two halves are*, and this one does not repeat it. What this note adds
is the requirement the older one did not weigh, the layer-by-layer inventory of
what actually moves, and an order of work.

## The decision, and the one thing it changes

The choice is Option A of the older note — "one game, rooms win" — which that
note recommended, for a reason worth restating because it still holds: the
parts of Extraction that are new to SALVOR are pure functions and days of work,
while the parts of SALVOR that are new to Extraction are thousands of lines of
stateful logic and months. The asymmetry decides it, and nothing since has
changed the asymmetry.

But Option A as written set Extraction's React shell aside. That is no longer
free, because of a requirement that was not on the table when it was written:

> **The merged project must stay exportable to Claude Design.**

`vuvko_works/game/scripts/design-bundle.tsx` renders the real components to
static HTML so the design kit cannot drift from the code it documents. It works
by calling `renderToStaticMarkup` on actual React components. SALVOR's UI is
rot.js and hand-built SVG. There is no version of "keep the export" that does
not end with a React presentation layer over SALVOR's engine.

So the shell is not optional scenery to be added later. **It is the merge.**
Everything below is organised around that.

## Three layers, three prices

Extraction's presentation layer sorts cleanly into three bands by what it is
bound to. The bands are not a judgement of quality; they are a schedule.

### Band 1 — free. Bound to nothing.

These import React, the FX library, or each other, and nothing from
`src/core/`. They move by being copied.

| Piece | What it is |
|---|---|
| `src/vendor/derelict-fx.js` + `.d.ts` | The animation library. 534 lines, no dependencies, no DOM assumptions beyond `style` and `textContent` |
| `src/lib/tempo.ts` | Three frames where the kit had one, over the same span |
| `src/lib/running.ts`, `src/lib/keys.ts` | Cleanup and key binding |
| `src/lib/contrast.ts` | WCAG ratios, carried in-repo rather than as a dependency |
| `src/hooks/useReveal.ts` | The whole descramble contract, in 76 lines |
| `src/hooks/usePanZoom.ts` | 231 lines, knows about pointers and a viewBox and nothing else |
| `src/index.css`, `GameScreen.css` | The palette, the type scale, the keyframes |
| `src/lib/audio.ts`, `src/hooks/useMusic.ts` | A music player and its settings binding |
| Atoms: `Tag`, `HitPointsBar`, `OddsBar`, `BuildStamp` | Take numbers and strings |
| `ConfirmEndTurn` | Takes a list of names and two callbacks |
| Framing screens: `Splash`, `Title`, `Credits`, `Settings`, `Loading` | Nothing about a derelict is in them |

This band is most of the *look* and all of the *motion vocabulary*. It is worth
saying plainly: the kit's identity — navy, mono, block glyphs, stepped frames,
corner brackets — lives almost entirely here, and it costs nothing to move.

### Band 2 — an adapter. Bound to Extraction's shapes, not its rules.

These take Extraction's types but only read a handful of fields from them.

| Piece | What it actually needs |
|---|---|
| `MissionLog` | A list of `{channel, text, tone}`. Its only import is a local type |
| `UnitCard` | A name, hp/maxHp, movement, a list of weapon labels |
| `ForecastPanel` | A distribution over outcomes |
| `AttackChooser` | A target name, its hp, and a list of options |
| `OutcomeDialog`, `MissionBriefing` | A verdict, a count, some strings |
| `GameScreen` | The 4a layout: where the panels sit, what the rail holds, how the log opens |

None of these needs a `DeckMap`, a `GameState` or a `Command`. They need a
**view model** — one module that turns SALVOR's world into the props these
already take. That module is the merge's real seam, and it is the thing to
build first and argue about most.

### Band 3 — a rewrite. Bound to Extraction's engine.

| Piece | Why it cannot move |
|---|---|
| `DeckView` | 835 lines of SVG over a hex lattice built from a `DeckMap`, with the geomorph plan underneath |
| `useBoardFx` | Plays a *beat* — a batch of `GameEvent`s. SALVOR has log lines with keys, not an event stream |
| `useMissionInput` | Selection, reachability, routes, intent — all Extraction's rules |
| `stores/game-store.ts` | A reducer plus undo-by-replay |
| `src/render/*` | The geomorph backdrop pipeline |

The older note priced `DeckView` optimistically ("2–3 days to draw a `Ship`")
on the grounds that SALVOR's `hex-svg.ts` already draws the same lattice. That
is true of the honeycomb and not of the rest: the plan underneath, the door
segments, the hollow corridor, the thirteen layers. Budget it as a port of the
lattice code with the visual treatments carried over, not as a copy.

## The seam: one view model

The whole plan in one sentence: **write `view/` — a pure module that turns
SALVOR's state into the props Extraction's components already take — and then
Band 2 moves by import.**

Concretely it owes:

- `rooms → cells`: SALVOR's `Ship` already has `col`/`row` from the layout
  pass, and both halves share six directions in one order. This is the piece
  the older note calls out as the cheapest overlap in the repository.
- `rack → hit points`: `UnitCard` and `HitPointsBar` want a bar. A rig is a
  chain of modules. Either the card learns to draw a rack (better, and it is
  the more interesting widget) or the view model derives a total.
- `log lines → LogLine[]`: SALVOR's lines have keys and an i18n table;
  `MissionLog` wants `{channel, text, tone}`. A mapping, plus a decision about
  whether the merged game keeps three languages.
- `what just happened → a beat`: this is the one that is not a mapping. See
  below.

## The two things that are not free, and must be decided early

### 1. Animation needs an event stream

`useBoardFx` is driven by `lastBatch` — what one player *action* produced. It
is the reason a walk animates as a walk. SALVOR's `RoomGame.playerCommand` runs
its hooks and mutates; what comes out is log lines, not events.

So either SALVOR grows an event stream (the older note prices this at a week
and calls it "a new seam"), or the motion layer is reduced to what can be
diffed from before/after state — which kills `wake()` specifically, because a
route cannot be recovered from two snapshots.

**Recommendation: build the event stream.** It is the load-bearing piece for
every animation, and it is also what a replay and a test harness want. It
should be additive: hooks append to a batch, the batch is published at the end
of the command, nothing else changes.

### 2. Undo is not free any more

In Extraction undo cost nothing: the reducer is pure and a match is
reproducible from `{seed, commands}`, so undo truncates the list and replays.
There is no inverse operation and no second implementation of the rules.

SALVOR mutates through fifteen hooks and an energy scheduler. Truncate-and-
replay needs the run to be reproducible from its inputs — `replayRooms(seed,
inputs)` suggests it *is*, which would make undo nearly as cheap on that side.
**This is the single highest-value thing to verify in the spike**, because the
answer decides whether the Undo button survives the merge, and the rule it
carries (take back anything that revealed nothing) is good design that would be
a shame to lose.

## Sound: correct the assumption

"Sound design from `vuvko_works`" needs qualifying, because on the code the
traffic runs the other way:

- `smoreg_works/packages/audio` — 327 lines, `adaptive.ts` and `plan.ts`.
- `vuvko_works/game/src/lib/audio.ts` — 131 lines, a music player.

What Extraction contributes to sound is the **design**, in
`design/ui-kit/motion.md`: five cues, fired from the player's own event switch,
so presentation pacing never enters the rules. That is a good rule and it fits
SALVOR's audio package without argument.

**Recommendation: keep SALVOR's audio package, drive it from the same event
stream that drives the animations, and take the cue list and the
never-in-the-rules discipline from the kit.** One event stream, two consumers.

## Order of work

**Phase 0 — the spike (days, not weeks).** One throwaway branch. Answer three
questions with code, not argument: (a) can `RoomGame` be replayed from seed and
inputs, i.e. is undo available; (b) what does an event stream cost; (c) render
one SALVOR `Ship` through a React `DeckView` with the kit's palette. Nothing
from this phase is kept. Everything after it is planned against the answers.

**Phase 1 — Band 1, and the export.** Move the free layer. Stand up
`design:bundle` against it immediately, so the export path is proven before
anything depends on it. At the end of this phase there is a React app with the
kit's look, the framing screens, and no game in it.

**Phase 2 — the view model and Band 2.** Build `view/`, then bring the panels
across one at a time behind it. At the end there is a screen that shows a
SALVOR run without being able to play it.

**Phase 3 — the board.** Port `DeckView` onto SALVOR's lattice, then
`useBoardFx` onto the event stream. Input last, because input is where the two
rule sets actually differ.

**Phase 4 — sound, polish, and the decisions deferred.** Cues on the event
stream; undo if Phase 0 said yes; the language question.

## What could sink it

- **The jam.** SALVOR is an entry to roguetemple's Fortnight 2 with a **15
  September** deadline — tomorrow. Its `main` is held submittable at all times
  and its scope rules forbid a new mechanic. Nothing here touches
  `smoreg_works/` before it closes. Phase 0 can be done entirely by reading.
- **Consent.** The older note says plainly that Option A needs SALVOR's
  authors' agreement and that it could not assume it. That is still true and it
  is not a technical question.
- **Licence.** The geomorph art is CC BY-NC. The merged game inherits that the
  day it draws a tile. If the merged game is meant to be commercial, the
  backdrop pipeline is the thing to leave behind — which would be a real loss,
  because the plan under the honeycomb is Extraction's best visual idea.
- **Two lint disciplines.** Extraction forbids wrapper lambdas and duplicate
  lambda bodies and holds `core/` to 90% coverage; SALVOR is written in arrows.
  Code moved across is reformatted and re-linted. Decide the house style once,
  at the start, rather than per file.
- **Undo.** If Phase 0 says no, say so out loud rather than letting the button
  quietly not appear.

## Open questions

1. Does `replayRooms(seed, inputs)` reproduce a whole run, or only a ship?
2. Is there anything in SALVOR that already resembles an event stream?
3. Does the merged game keep three languages, and if so does the kit's type
   scale survive German?
4. Rack or hit points on the unit card — which widget does the merged game want?
5. Is the merged game commercial? The answer decides the backdrop.
6. Where does the merged project live — a third directory, or does one half
   grow into the other?
