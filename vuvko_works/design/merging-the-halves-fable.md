# Merging the halves, read again

An independent plan for the merge the owner has decided on: SALVOR's engine and
rules, with the face, the motion and the sound *discipline* of `vuvko_works`,
in a project that stays exportable to Claude Design. Written 2026-09-14 after
reading both halves and the two earlier notes
([converging-with-salvor.md](converging-with-salvor.md),
[merging-the-halves.md](merging-the-halves.md)); the review of the second is
[merging-the-halves-review.md](merging-the-halves-review.md) and this note does
not repeat its evidence, only cites it. Nothing under `smoreg_works/` was
changed and nothing was installed. The jam closes **15 September 2026, 17:00**;
until then SALVOR's `main` is held submittable and this note is reading only.

## 1. What the merge actually is

It is worth being blunt about this before ordering any work, because the two
earlier notes describe two different projects and the owner's decision picks
one of them.

The converging note's option A was a **rules** merge: SALVOR's world with four
Extraction mechanics carried in (the node pool instead of the time tick, the
forecast over a rack, the starve-the-ship win, possibly a second drone). The
plan under review is a **face** merge: SALVOR unchanged, with a React shell,
the kit's palette and type, discrete-frame motion, and a honeycomb that looks
like the kit's board. The owner's decision, "engine from SALVOR, UI and
animations and sound design from vuvko", is the second. No rule of
Extraction's survives it. `core/combat.ts`, `ship-turn.ts`, `mission.ts`,
`intent.ts` and the reducer are set aside; what crosses is CSS, a vendored
animation library, a handful of hooks, the component *shapes*, and the way
the kit thinks about a screen.

That is a smaller project than option A and a larger one than "replace
`mount.ts`". Named precisely, it is four things:

1. **A third renderer for `RoomGame`**, in React, hosting the existing two so
   nothing is lost, and eventually drawn from a structured model rather than
   from terminal strings.
2. **A design-language transplant**: the kit's tokens folded into
   `content/palette.ts` under its invariants, its faces, its log strip and
   cards, its stepped frames, driven from what the game already publishes.
3. **A workspace and toolchain decision**, because two TypeScript projects with
   different compilers, test runners and lint rules have to become one that
   installs and tests with one command.
4. **An export pipeline** that renders the React components over SALVOR
   fixtures to static HTML, so the kit in Claude Design cannot drift from the
   game, and that is held to G61's rule by the purity test rather than by a
   document.

Everything from Extraction's core that the converging note argued for is a
**fifth thing, deferred**: a later programme against SALVOR's rules, with its
own consent and its own balance pass. This note does not schedule it. It does
keep the door open by choosing a panel model that could carry a forecast if
one is ever computed.

## 2. Constraints that decide the order

**The jam.** Nothing in `smoreg_works/` moves before 15 September 17:00.
Running SALVOR's tests means `npm install` there, so even a read-only spike
against real code cannot run inside that tree until then. Anything done before
the gate is reading, or a scratch copy outside both halves.

**Consent.** No document in `smoreg_works/` mentions this merge. Its
`docs/tasks/README.md` is a working agent protocol with rules the owner has
repeated for a fortnight (`.claude-progress.md`, "Правила владельца"): no meta
between runs, permadeath, no browser testing of rules, three languages through
a table, ASCII as the base and the web view as a switchable addition. The
first artefact of the merge is not code. It is a one-page ADR in
`smoreg_works/docs/adr/0004-...md`, written *by that half's owner* after the
jam, saying which of those rules the merged project keeps. Until it exists,
every later step is provisional.

**Permadeath, and therefore no undo.** `.claude/CLAUDE.md:42` and
`docs/traditional-checklist.md:49`. The kit's Undo button does not come across
as an undo. What it becomes is in §5.6. If the owner wants a real undo, that
is a line in the ADR, and it will contradict two of his own documents; this
plan assumes he will not.

**The purity tests are the contract.** `games/salvor/tests/purity.test.ts`
scans the rules for `Math.random`, `Date.now`, `document`, `window` and
`process`, and scans `src/ui` as well for any string literal that reads as a
sentence (lines 159 to 260). Every component that crosses has to pass both
scans. This is the mechanism that keeps G61's objection honest and it costs
nothing to adopt because it already runs.

**Three languages stay.** The tables are 1100 lines each and the scan above
forbids inline English. The kit's label face, Barlow Condensed, has no
Cyrillic; IBM Plex Mono does. The type scale needs a Cyrillic-capable
condensed face for labels or accepts the mono for them in Russian. Decide it
when the tokens land (§5.2), not later.

## 3. Where the code lives

This is the decision the other plan leaves to the end and it is the one that
has to be made first, because it decides what "import the pure tier" means.

**Recommendation: a sibling game package inside the monorepo,
`smoreg_works/games/salvor-web`, made with the repo's own scaffold** (`npm run
new-game -- salvor-web`, `scripts/new-game.mjs`) after the jam closes. It
depends on `@jamrog/engine`, `@jamrog/audio` and `@jamrog/salvor`, and on
React 19. `games/salvor` is touched in exactly one place at the start: its
`package.json` gains an `exports` map pointing at `./src/*`, following the
precedent `packages/engine/package.json` already sets (`".": "./src/index.ts"`,
`"./testing": "./src/testing/index.ts"`). Nothing else in the jam entry changes
until the model work in §5.4, which is a change *to* SALVOR and is scheduled as
one.

Why there and not a third top-level directory or a growth of `vuvko_works/game`:

- The tier the shell consumes is not a package. `ui/panel.ts` imports twenty
  files from `systems/`, `content/` and `twist/`; the shell needs the whole
  game, and the whole game is a workspace member already.
- The monorepo's root `tsconfig.json` includes `games/*/src`, the root
  `vitest.config.ts` includes `games/*/tests`, `npm test` is one run. A sibling
  package is inside all of that for free. A third directory would need its own
  install, its own lockfile and a path import across a boundary that the repo
  README says nobody crosses.
- `games/fortnight2` shows the pattern is accepted: two games, one engine, one
  toolchain, one frozen.

What `vuvko_works/game` becomes: the generator project it always half was.
`render/*`, `core/deck.ts`, `mapgen/*`, the geomorph pipeline and its CC BY-NC
tiles stay there and are not part of the game. The design notes stay there.
The components, hooks, CSS and vendored library are *copied* into
`games/salvor-web` and re-linted under that package's rules; the originals are
left as a record and the folder is marked as such in its README.

**Toolchain.** The monorepo wins, because it has the tests: TypeScript `^5.6`,
Vite `^5.4`, Vitest `^2.1`, `moduleResolution: bundler`. The new package needs
three additions to the root: `jsx: "react-jsx"` in its own `tsconfig`, a
`jsdom` environment and `*.test.tsx` in the root Vitest include (scoped by
path so the 119 existing files stay in `node`), and `allowJs` or a types path
for `vendor/derelict-fx.js`. The kit's ESLint rules (`eslint-rules/index.js`:
no wrapper lambdas, no duplicate lambda bodies) come across as *that package's*
lint config and are not applied to the 30 000 lines next door. Storybook,
Playwright, knip, lefthook and oxlint do not come across in the first pass;
each can be argued for later on its own merits. Document language follows the
README's rule 6 for files under `smoreg_works/docs`; this note and its kin stay
where they are.

## 4. The shape of the shell

Before the order of work, the architecture the work is aimed at, in one
picture. Read `ui/app.ts` first; it is the shell, not `mount.ts`
(review §2.1).

```
                 RoomGame (mutable, @jamrog/salvor newGame)
                      │
   keys/clicks ─► toIntent ─► appReducer(state, intent, game) ─► AppEffect
                                                                   │
                                        useSalvorApp (hook/store) ◄┘
                                        · spends commands, runs walks & pulse
                                        · owns URL, sound, crash guard
                                        · after each frame builds a Beat
                                                  │
              ┌───────────────────────────────────┼───────────────────────┐
              ▼                                   ▼                       ▼
     <AsciiHost/>  (rot.js Renderer,      <Screen/>  React tree      <Motion/> <Sfx/>
      in a ref'd div, V still cycles)      from models:              consume the Beat
                                           · SchematicInput (exists)
                                           · PanelModel   (to build)
                                           · Action[]     (exists, unfitted label)
                                           · Log lines    (exist, keyed)
```

Three facts about this shape.

**`appReducer` and `AppEffect` are the interface, exactly as the other plan
says.** `appstate.ts:71-135` is a fourteen-arm tagged union and every arm is
something a hook can do. The two impurities in the reducer (`readCodex`,
`cycleLang`; review §2.1) are tolerated, not fixed: the reducer is called
once per intent and its result is stored, never memoised.

**The first React renderer is `screenHtml` itself.** `screenHtml(game, state,
flash, lit, map, debug, hull, tiles)` (`ui/web/screen.ts:58`) returns the whole
graphic screen as a string with every overlay in it. A `<div
dangerouslySetInnerHTML>` with the same click delegation `mount.ts:38-46`
does is a complete, playable web view inside React on the first day, with
the title menu, the codex, the history card, the tug board and the crash card,
and it costs a page of code. Every later component *replaces a region of that
string*, so the game is never less than whole while the tree grows. This is
also the cheapest possible proof of the export: `renderToStaticMarkup(<Screen
game={newGame(7)} .../>)` works the moment the wrapper exists.

**The ASCII view is not dropped.** `ui/view.ts:37` makes it the default and the
owner's rules call it the base. The rot.js `Renderer` takes a mount element
(`render.ts:335`); a React component that hands it a ref'd `div` and calls
`draw` in an effect keeps it alive with no change to `render.ts`. `V` cycles
three views as before.

## 5. Order of work

Estimates are in working days for one person who knows both halves; they are
guesses with the same standing as the earlier notes' hours.

### 5.0 Before the gate: read, and one scratch spike (now to 15 Sep)

Nothing in either half changes. Two things are worth doing anyway.

*Read `app.ts`, `appstate.ts`, `screen.ts`, `panel.ts` and `panel-html.ts` end
to end* and write the `PanelModel` type on paper (§5.4). Deciding its fields
from the twenty systems `panel.ts` imports is the design work of the whole
merge, and it needs no compiler.

*A scratch spike outside both halves*: copy `games/salvor` and
`packages/engine` and `packages/audio` into the scratch directory, `npm
install` *there*, and stand up the `screenHtml`-in-React wrapper with
`renderToStaticMarkup` over `newGame(seed)`. Half a day. It answers "does the
tier consume from React with no edits", "does the export pipeline run over a
`RoomGame`", and "what does the root Vitest config need", before the gate
opens, without touching a tracked file. Throw it away.

### 5.1 The gate opens: consent, ADR, package (1 to 2 days, mostly waiting)

The ADR (§2). Then `npm run new-game -- salvor-web`, the `exports` line in
`games/salvor/package.json`, React added to the new package, the three root
config additions (§3). `npm test` and `npm run typecheck` green across the
monorepo before anything else. The spike from 5.0 becomes the first commit of
the package: a React root that hosts `screenHtml` and the ASCII renderer and
plays the whole game.

### 5.2 The shell as a hook, and the tokens (3 to 4 days)

Port `App` (`app.ts:58-646`) into `useSalvorApp()`: the reducer loop, the
effect switch, the walk and pulse timers, the URL contract, sound wake-up,
music and sfx calls, crash guard. `useSyncExternalStore` over a tiny store is
enough; zustand is not needed for one game and one state, and not adding it
keeps the package's dependency list to React alone. This is the biggest single
port in the plan and it is mechanical: `app.ts` is already written as "what is
left once the transitions are gone" (`appstate.ts:40-45`).

In the same step, the kit's identity lands where it costs nothing:

- `content/palette.ts` absorbs the kit's values under its two invariants
  (amber means "a decision is required" and nothing else; one element carries
  three signals). The kit's navy family, `--rule`, `--ink`, `--dim` and the
  role colours from `ui-kit/conflicts.md` §2 are mapped token by token, and the
  design bundle reads a generated CSS file rather than a hand-kept one.
- The two faces, self-hosted; the Cyrillic decision for labels (§2).
- `vendor/derelict-fx.js` and its `.d.ts`, `lib/tempo.ts`, `lib/running.ts`,
  `lib/keys.ts`, `lib/contrast.ts`, `hooks/useReveal.ts`, `hooks/usePanZoom.ts`
  copied in. `useReveal` on the latest log line and the compartment name, over
  the *strings the current view already produces*, is the first motion the
  player sees, and it needs no model.

At the end of 5.2 the game plays in React, in the kit's colours and faces, with
the log line descrambling, and the export renders it. Nothing in
`games/salvor` has changed except `package.json`.

### 5.3 The board (4 to 5 days, parallel with 5.4)

The map is already a model: `schematicInputOf(game)` plus `hexLayout(ship)`
plus `hullLayer(...)` (review §2.4). `hexSvgOf` (`ui/web/hex-svg.ts`) is 461
lines of string SVG over exactly those inputs, and `svgOf` is the graph view
over the same. Port `hexSvgOf` to a React `<Honeycomb>` component, geometry
and classes intact (its tests in `tests/hex-svg.test.ts` assert on the SVG
structure and can be pointed at `renderToStaticMarkup` output), then bring the
kit's treatments across from `DeckView.tsx`: the hollow corridor, the door
segments, the token styling, `usePanZoom` for pan and wheel. Keep the
`DeckViewProps` shape (`DeckView.tsx:18-34`) as the guide to what a board takes;
drop the file and its `useGameStore` import.

The hull stays `hullart.ts`, under the honeycomb, exactly as G81/G82 draw it.
The review (§2.6) gives the reason this is not a compromise: at one cell per
compartment, what a backdrop can show is what lies between and around the
cells, and that is what `hullart.ts` draws and what the geomorph plan would
be reduced to. The picture that confirms it is `SHEET=1 npx vitest run
games/salvor/tests/hullview-sheet.test.ts`, extended with a third column
rendering the React component, and it is a thing the owner looks at, not a
thing anyone tests in a browser. The geomorph pipeline does not move.

### 5.4 The panel model, in SALVOR (6 to 8 days; the largest item)

This is the change *to* `games/salvor`, and it is where the other plan's
"un-bake the grid" belongs, renamed to what it is.

Add `ui/model.ts` (or `ui/panel-model.ts`) exporting a `PanelModel` built from
the same systems `panel.ts` imports: the ship heading and turn; the alert
level and its word; the rack as slots `{ index, kind, integrity, max, exposed,
burned, flash }` from `rigOf` and `rackIntegrity`; contacts `{ id, name, hp,
hpMax, here | behind door, lastBlow }` from `hostilesIn` and `strikersNear`;
the mission block from `charterDone` and `objectiveHere`; doors from
`doorsStand`; systems from `systemsAboard`; the keys held; the codex badge; the
foot. Every field is a value the text panel already computes somewhere in its
1202 lines; the work is lifting the computation out of the string
concatenation.

Then invert the dependency: `panelBlocks` becomes a renderer of `PanelModel`
to `PanelLine[]`, clipped to `PANEL_WIDTH` as before, and its sixteen width
assertions in `tests/panel.test.ts` do not move. `panel-html.ts` can then stop
parsing bar glyphs and `◀` marks, or be left as is until the React panel
replaces it. For the action list the change is one field: `Action.label` stays
fitted for the terminal, and a new `Action.text` carries the unfitted line with
`fitLabel` applied by the renderer that needs it; `tests/actions.test.ts:1088-1091`
keeps testing `fitLabel` directly.

Three things this step does *not* do. It does not touch `LAYOUT`; the terminal
keeps its grid. It does not lift the generator's six-per-column and four-doors
ceilings (`G62-hex-view.md`, "Два потолка сохранены"); that is a balance
decision with replay fixtures behind it and it goes to the owner as an open
question, not into this step. And it does not add a forecast; the model has
room for one and the rules have none.

### 5.5 The panel components, over the model (4 to 5 days)

`Rack` (the identity of the game; not a hit-points bar), `Contacts` in two
groups as G61 specified, `Mission`, `Doors`, `Systems`, the `ActionList` as
buttons firing `{ kind: "line", index }` exactly as `mount.ts` does, the log
strip and drawer from the kit with `useReveal` on each new line and
`logFades` for tone, the heading. Then the cards: title (seven rows, G84),
help, codex, history, the four endings, crash, the tug board. Each one
replaces its region of the `screenHtml` string; the string shrinks to nothing
over the step and `screen.ts` is then a test fixture rather than a renderer.
Every component takes model values and `t()` strings and passes the purity
scan; every one gets a card in the design bundle over a `shipFromText`
fixture.

`OddsBar`, `ForecastPanel` and `AttackChooser` do not come across: there is no
roll to show odds for. `ConfirmEndTurn` comes across as the confirmation the
game already has (§5.6). `UnitCard` and `HitPointsBar` are superseded by
`Rack`.

### 5.6 Motion and sound, from the Beat (3 to 4 days)

SALVOR already publishes what the animation layer needs, in two places: the
log, keyed (`LogLine.key`, `sfx.ts` `SOUNDS`), and the game's own state before
and after a command. Define a `Beat` in the shell, built once per frame:

```
Beat = {
  moved:   { from: RoomId, to: RoomId } | null   // game.player.room, before/after
  lines:   LogLine[]                              // linesSince(heard), keys and params
  rack:    { slotsHit: Set<number> }              // flashSlots(prev, next)
  sighted: EntityId[]                             // machinesInSight diff (trackPulse)
}
```

Nothing here needs the engine. A move is one door in SALVOR, so `wake` gets a
one-step path per command and the walk timer already paces multi-step travel
(`app.ts:357-369`); a blow is `log.hit.module` plus `flashSlots`; a death is
`engine.dies` or `log.drone.lost`; the machine coming into sight is
`trackPulse`, which already exists to flash a row on the beat. `useBoardFx`'s
DOM half (lines 93 to 254) is reused; its two extractors (`routeOf`, `blowOf`,
lines 35 to 78) are rewritten over `Beat` and are shorter.

Where a payload is missing, the fix is in `games/salvor/src`, not the engine:
give the keyed `log.add` calls the `params` the type was designed for
(`twist/rig.ts:1384` writes `log.hit.module` with none), which also retires the
substring match in `ui/strikers.ts:21-40`. This is the one "events" change
the merge needs, and it is additive.

Sound: `packages/audio` and the thirteen `.ogg` effects stay; `sfx.ts` already
keys off `LogLine.key`. What crosses from the kit is `motion.md`'s discipline,
cues fired from the shell's Beat and never from the rules, which is what
`sfx.ts` and the purity test already enforce. The one concrete addition is
that motion and sound read the *same* Beat, so a blow's spark and its sound
are the same frame. This half's music player and its unresolved-licence tracks
(`lib/audio.ts:18`) do not come across.

The kit's **Undo** becomes what SALVOR's rules allow: `0`/`Esc` backs out of a
nested list (`Action.step: null`), and a walk that stopped at a door asks
before it goes through (`Warning`, `appstate.ts:138-142`). The button is
labelled for what it does, `t("panel.back")` or the existing key row, and the
`ConfirmEndTurn` dialog becomes the visual form of the door question. A
disabled Undo that means "this game has undo" would be a lie in this game.

### 5.7 The export, made a gate (1 day, then continuous)

`design:bundle` in the new package renders every component in §5.5 and the
board in §5.3 over fixtures made with `shipFromText` and `newGame(seed)`,
never over hand-written data. It writes to a directory that is gitignored,
as G61 required; only the components and the fixtures are source. Add one
test that runs the bundle's render pass in Vitest and asserts (a) it produces
markup for every card and (b) no string in the markup is absent from the
English table. The second assertion is the G61 rule as a test.

### 5.8 Decisions left to the owner

Recorded, not taken:

1. **The generator ceiling.** Lift six-per-column and four-doors now that the
   honeycomb is the intended face? It changes ship shape, door counts and the
   three replay fixtures; G62 measured the last time the generator moved.
2. **The ASCII view's future.** This plan keeps it; the owner's rules make it
   the base. If it is ever dropped, `LAYOUT` and the width clipping go with
   it and `panelBlocks` becomes a test fixture.
3. **A label face with Cyrillic**, or mono for labels in Russian.
4. **Whether any Extraction rule comes in later** (the pool, the forecast, a
   second drone). Not this merge. The `PanelModel` and the `Beat` are designed
   not to preclude it.
5. **Where `vuvko_works/game` ends up**: archived as the generator project, or
   deleted once its pieces are copied. Its geomorph work is the one thing with
   no home in the merged game and a licence that says it should not have one.

## 6. Where this agrees with the plan under review, and where it does not

Agrees, for the same reasons: consent before code; nothing touches SALVOR
before the gate; `appReducer` and `AppEffect` as the seam; the export runs
code to artboard only and every string comes from `t()`; the palette adopts
SALVOR's invariants; keep `packages/audio` and take the cue discipline; draw
the rack; the geomorph pipeline does not move and SALVOR's hull art carries the
picture.

Disagrees:

- **What the shell is.** `app.ts` is ported, not `mount.ts` replaced. The
  first React renderer is `screenHtml` in a wrapper, so the game is whole from
  the first commit and components replace regions of it.
- **What Phase 2 is.** Not "separate content from fitting" and "parameterise
  widths" but "build the panel model that does not exist and make the text
  panel its renderer". Same size, different thing, and it is a change to
  `games/salvor` scheduled as one.
- **Undo.** Not carried. Forbidden by the other half's rules, and under this
  half's own seal rule every SALVOR command would be sealed. The button's
  honest meaning is "back out of what is not yet spent".
- **Events.** The keyed stream exists; the work is params on a handful of
  `log.add` calls in the game and a `Beat` built in the shell from two
  snapshots. Movement needs no stream at all in a one-door-per-command game.
- **Order.** Board and panel model run in parallel because the map is already
  a model. Tokens and motion land in 5.2 on the existing strings, not after
  the grid work, so the kit is visible in week one.
- **Package and toolchain first**, not last. `games/salvor-web` in the
  monorepo, monorepo toolchain, kit lint scoped to the new package.
- **Band 1 and 2 contents.** `OddsBar`, `ForecastPanel`, `AttackChooser` out;
  `UnitCard` and `HitPointsBar` superseded; the surface count is about fifteen
  including the cards, not seven.
- **The protocol.** Not a collision to resolve but two scoped configs and a
  document-language rule already written. Pictures are judged from generated
  sheets on one side and Playwright on the other, and both are allowed.

Roughly 25 to 30 working days after the gate to a React SALVOR in the kit's
face with a structured panel, an animated honeycomb over a drawn hull, one
Beat driving motion and sound, and an export that the purity test polices. The
rules merge the converging note argued for would start after that, against a
game whose face is already the one the owner wants.
