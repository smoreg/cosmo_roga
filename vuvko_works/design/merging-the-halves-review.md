# Review of "Merging the halves"

A review of [merging-the-halves.md](merging-the-halves.md), written 2026-09-14
by reading the plan, the note it builds on
([converging-with-salvor.md](converging-with-salvor.md)), and then the code and
documents on both sides. Nothing under `smoreg_works/` or `vuvko_works/game/src`
was changed. Nothing was installed or run: the half being reviewed is not mine
to install into, and the jam closes tomorrow. Every claim below is therefore a
claim about source, not about a running build, and where that matters it is
said.

The short version. The plan's central move is right: SALVOR's UI is split into
DOM-free functions and a thin DOM layer, and a React shell should consume the
former and replace the latter. Its second finding, that the character grid is
baked into that tier, is also right, and it is right to call it the largest
item. But the plan gets the *shape* of both findings wrong in ways that change
the estimate: the thin layer is not one file, the "pure tier" hands the web
view text and not a model, and the grid lives in the generator as well as the
UI. Two of its three headline findings are stale against the code it describes:
the sound fragility it wants to fix was fixed, and the undo it says survives is
forbidden by the other half's own rules and would in any case reach nothing.
And the plan says nothing about where the merged code lives, which toolchain
builds it, or how a package in one half imports source from the other, which
is the first question anyone typing `npm install` will hit.

## 1. What held

Taking the plan's load-bearing claims in the order the brief asked for them.

**The DOM surface of the graphic view is one element and one `innerHTML`.**
Confirmed. `games/salvor/src/ui/web/mount.ts` is 121 lines; its own header
(lines 8 to 17) says it is "the graphic view's only contact with the DOM", and
the body bears that out: `createElement` once (line 35), `innerHTML` once per
frame (line 70), one click listener that resolves `data-line` and `data-room`
attributes (lines 38 to 46, 103 to 113), and two `querySelector` calls to pin
scroll positions (lines 84 to 89). `web/index.ts` states that nothing else in
the game imports from that directory. That part of the plan is exactly as
described.

**The pure tier is DOM-free.** Confirmed by grep and by imports. Across
`games/salvor/src/ui/*.ts`, the tokens `document`, `window`, `HTMLElement`,
`localStorage`, `innerHTML` and `rot-js` appear in code only in `app.ts` and
`render.ts` (the rot.js renderer); every other hit is a doc comment. The
imports of `schematic.ts`, `panel.ts`, `actions.ts`, `appstate.ts` and
`input.ts` are `@jamrog/engine` types, `../content/*`, `../systems/*`,
`../twist/rig.js`, `../i18n.js` and each other. `view.ts` even injects its
storage (`ViewStore`, lines 53 to 56) so that it can be tested in node. The
plan can rely on this.

**A run replays from `(seed, inputs)`.** Confirmed.
`packages/engine/src/rooms/game.ts:405-412` is `replayRooms(seed, cmds, cfg)`:
construct, then `playerCommand` each command until the status leaves
`playing`. `RoomGame.inputs` (line 98) is appended on every command (line
296). `games/salvor/tests/replay.test.ts` replays three recorded voyages on
disk against a fingerprint of the whole world; `determinism.test.ts` runs two
voyages in one process to prove they do not touch each other (its header
explains the id-counter bug that motivated it, G58). The property the plan
leans on is real and tested. What the plan does with it is another matter; see
§2.3.

**The 95×42 grid is baked into the tier.** Confirmed, with the two numbers
the plan gives and a few it does not. `ui/theme.ts:12-21` holds `LAYOUT`
(`mapWidth: 66`, `mapHeight: 34`, `sidebarWidth: 29`, `logHeight: 7`) and
derives `SCREEN_WIDTH` and `SCREEN_HEIGHT`. `ui/panel.ts:49` sets
`PANEL_WIDTH = LAYOUT.sidebarWidth - 1` and its header (lines 44 to 45) says
every line is clipped to it because "rot.js wraps"; `PANEL_HEIGHT =
LAYOUT.mapHeight` (line 56). `ui/actions.ts:169` sets `ACTION_WIDTH = 25`;
`fitLabel` (line 809) and `clipName` (line 1315) cut to it; `Action.extra`
(lines 86 to 92) exists specifically to catch a price that overflowed twenty-
five columns. `ui/input.ts:471` and `ui/logline.ts:183` both derive
`HELP_ROWS`/`HISTORY_ROWS` from `SCREEN_HEIGHT - 8`. The tests do assert on
the clipped output: `tests/panel.test.ts:126,137,146,267,559-560` check line
lengths against `PANEL_WIDTH`; `tests/actions.test.ts:155,172,359,1091` check
against `ACTION_WIDTH`. `main.ts:15-24` fits the font to the window so the grid
lands at 14 px on a 1366×768 screen. All as the plan says. How bad it is, and
where else it lives, is in §2.4.

**`hullart.ts` is 1342 lines of procedural SVG hull.** Confirmed. Its header
(`ui/web/hullart.ts:5-38`) describes two modes: hull-first, where the
honeycomb was grown inside a profile from `content/hullforms.ts` (G82), and
cells-first, where a skin is traced around the laid-out cells (G81). It is
pure ("No `document`, no `window`, no `Math.random()`: a string in, a string
out", line 38), keyed variation is a hash of the ship id, and
`content/hulls-art.ts` gives fifteen classes a profile. Whether it can stand in
for the geomorph backdrop is §2.5.

**G61 used Claude Design artboards and did not commit them.** Confirmed.
`docs/tasks/G61-web-design.md:8-10`: the artboard source "lies outside the
repository (`~/Downloads`)" and is not committed because "145 KB of markup with
baked-in words must not become a second source of truth next to `t()`". Section
"Что правим против артбордов", item 4, lists the invented content that was
refused word by word. The plan's reading of this document is accurate, and its
conclusion, that the export must run code to artboard and never back, is the
right one.

**The events consumed by `useBoardFx`.** Confirmed as described:
`game/src/hooks/useBoardFx.ts:35-51` reassembles a route from consecutive
`unitMoved` events, `53-78` finds the blow from `attackDeclared` and
`strikeLanded`, and the rest is DOM plumbing against `data-unit`, `data-glyph`
and `data-fx-*` attributes. `useReveal.ts` is 76 lines and is the whole text
contract (its header says so). `scripts/design-bundle.tsx:60` calls
`renderToStaticMarkup` on real components. `t()` in
`games/salvor/src/i18n.ts:106` is `t(key, params)` over three tables of about
1100 lines each.

## 2. What is wrong, or not what it looks like

### 2.1 The seam is not one file; the shell is `app.ts`

The plan says "React replaces `mount.ts`" and calls this "the cheapest thing in
the whole merge". `mount.ts` is the renderer's DOM contact. The **shell** is
`ui/app.ts`, 673 lines, and it is what a React root actually replaces:

- the reducer loop: `apply` (lines 223 to 230) calls `appReducer` and then
  `run(effect)` (lines 306 to 348), a fourteen-arm switch that spends turns,
  starts walks, cycles views, flips sound, makes new runs;
- two timers: the auto-explore walk (`walk`, lines 357 to 369, paced by
  `AUTO_DELAY_MS`) and the appearance pulse (`schedulePulse`, lines 509 to
  523, timed against the music's beat);
- sound: `wakeSound` on the first key (lines 461 to 466), `music.update` and
  `sfx.play(sfxFor(linesSince(...)))` on every redraw (lines 478 to 483);
- the URL contract (`?seed`, `?training`, `?debug`, `?hull`, `?tiles`,
  `?sound`, `?view`, lines 124 to 150, `newRun` writing the seed back at 444
  to 448);
- the crash guard (`window.addEventListener("error"...)`, lines 157 to 172,
  `fail` at 625 to 635) that turns any exception into the crash card;
- and the two renderers held side by side so `V` is not a reset (lines 536 to
  555).

None of that is in `mount.ts`, and all of it has to exist in the React shell or
the game regresses. Most of it is not DOM-bound and ports cleanly into a hook
or a small store; but it is a port of 673 lines of orchestration, not a
replacement of 121 lines of `innerHTML`. The plan's own `converging` note had
this right ("a rewrite of `ui/app.ts` and the two view mounts", line 621); the
correction the plan makes to it is the wrong correction.

There is a second, quieter error here. `appstate.ts:66-70` says the reducer
"never touches the game itself", and the plan repeats it. Two paths do:
`codexOpened` and `codexTurned` call `readCodex(game, ...)`
(`appstate.ts:839,848`), which splices the game's own codex record
(`systems/codex.ts:83-87`), and the language intent calls `cycleLang()`
(`appstate.ts:402,549`), a module-global in `i18n.ts`. Both are benign, but a
React shell that treats `appReducer` as pure and memoises around it will find
the codex badge not clearing. Worth knowing before the first spike, not after.

### 2.2 The "view model" the panels need does not exist

The plan's Band 2 says the view model for `MissionLog`, `UnitCard`,
`ForecastPanel`, `AttackChooser`, `OutcomeDialog` and friends "is largely
`panelBlocks()`, `roomActions()` and `logFades()`, which already exist". This
is the claim that most needs correcting, because it sets the price of Phase 3.

`panelBlocks(game, actions, cursor)` (`panel.ts:134-138`) returns
`PanelLine[]`, where a `PanelLine` (`panel.ts:96-110`) is `{ text, fg?, id? }`:
a worded, coloured, clipped string, with an entity id only on contact lines
and only so the pulse can flash the right row. It is not a model of the rack,
the alert, the mission or the doors. It is the terminal panel, as text.

The existing web view proves the point by what it has to do to draw it.
`ui/web/panel-html.ts:9-27` says plainly that lines "arrive already worded,
already coloured and already clipped from `panelBlocks`", and that it recovers
the layout "by grouping on empty rows". To turn the rack's text into bars it
runs a regex over the bar glyphs (`BAR_RUN = /[▮▯]+/g`, line 47); to find the
exposed slot it looks for the `◀` mark (line 53); to find which slot a line is
about it reads the first character (`slotNumberOf`, `panel.ts:1148-1149`); to
find where the action list goes it matches the translated heading
`t("panel.actions")` (lines 39 to 41), with a comment recording the bug when
the heading was hard-coded in English. That is a renderer parsing prose back
into structure. It works, and it was a reasonable way to get a second view
quickly, but it is not a view model, and a React `Rack` component that wants
`{ slot, kind, integrity, max, exposed, burned }` cannot get it from
`panelBlocks`.

The map is different, and the plan should have said so. `schematicInputOf(game)`
(`ui/schematic-input.ts:88`) produces a `SchematicInput` of rooms, doors and
things with typed states (`schematic.ts:35-160`), and all three drawings
consume it: the terminal via `schematic()`, the SVG graph via `svgOf(input)`
(`schematic-svg.ts:120`), the honeycomb via `hexSvgOf(input, layout, ...)`.
That *is* a view model, and the board half of Band 2 and 3 can build on it as
is. `roomActions()` is in between: `Action` (`actions.ts:76`) carries `key`,
`label`, `cmd`, `enabled`, `why`, `head`, `step`, `extra` and is a decent
model of a list row; only `label` is already fitted.

So the honest statement of Phase 2 and 3 is not "separate content from
fitting" and "re-point a dozen components". It is: **build a structured panel
model that does not exist**, from the same twenty systems `panel.ts:1-31`
imports, and turn `panelBlocks` into a text renderer of that model so the
terminal and its 16 width assertions do not move. That is an inversion of a
1202-line file, and it is the largest item in the plan for a different reason
than the plan gives.

### 2.3 Undo is available and forbidden, and would reach nothing

Three things the plan does not say.

First, the other half has a rule against it. `smoreg_works/.claude/CLAUDE.md:42`:
"**Permadeath.** Нет undo, нет откатов хода." `docs/traditional-checklist.md:49`
lists "возможность откатить ход" under anti-patterns that mark an entry as not
traditional, with the ⛔ the file uses for hard exclusions. The owner's
accumulated rules in `.claude-progress.md` repeat "пошаговость, permadeath".
Whether a post-jam merged game keeps that rule is the owner's decision, but
the plan presents undo as a technical question that has been "answered" when
it is a design decision that has been taken, the other way, in writing.

Second, Extraction's own rule would seal every SALVOR command. `design/ui-kit/undo.md`
is careful: a command is final when a die was rolled or something was revealed,
and "ending the turn is sealed too: the ship moves and builds on its own roll".
`GameScreen.tsx:122-125` repeats it. In SALVOR there is no intra-turn phase:
`RoomGame.playerCommand` runs the systems' hooks and then the energy scheduler
runs every machine until the player is ready again (converging note, lines
631 to 634). Every command *is* an end of turn. Machines move, the alert
ticks, noise propagates. Under the rule Extraction wrote for itself, `canUndo`
would be false after every key. The plan says the "revealed nothing" test "has
to be re-derived from SALVOR's own log"; what it would find is that nothing
qualifies. To have an undo at all the rule has to be abandoned, which makes it
the cheat `undo.md` argues against.

Third, the cost and the fidelity. `replayRooms` rebuilds the whole voyage
from the seed: `shipgen` with up to fourteen retries per hull, every turn of
every sortie, on a `RoomGame` that is a mutable class with fifteen systems.
Extraction's replay is "microseconds a command" over a reducer; SALVOR's is
not measured, and a voyage is hundreds of commands. And the replay is not bit-
identical: `determinism.test.ts:45-51` explains that the fingerprint drops the
log and empty records because "a driver that presses a refused key writes a
line its own replay never writes" and "several systems write their record the
first time they are asked". An undo that replays would also lose the codex
reads from §2.1. None of this is fatal, but "available" is doing a lot of
work in the plan's sentence.

What the kit's Undo button *can* honestly become in SALVOR is already in
`appstate.ts`: the nested lists have `0` as the way back (`Action.step: null`,
`actions.ts:96-116`), and a walk that stopped at a door remembers the question
(`Warning`, `appstate.ts:126-142`, the interface at 138) so the second press is an answer. That is
"take back the thing you have not yet spent", which is the only version the
rules allow. The `ConfirmEndTurn` dialog in Band 1 maps onto the same
mechanism. The plan should say that instead of promising the button with its
rule intact.

### 2.4 The grid is in the generator too, and the map is already free of it

The plan is right that the grid is the expensive part and right about which
constants carry it. Three corrections to the shape of the problem.

The **map** is not baked. `schematic.ts` has its own hard-coded character
geometry (`HEIGHT = 34`, `HULL_X = 64`, `BOX_W = 9`, `COL_STEP = 13`, lines
184 to 193), but those belong to the terminal drawing `schematic()` produces,
and the two SVG drawings never call it; they consume `SchematicInput` directly
and have their own pixel geometry (`schematic-svg.ts:30-38`, `hex-svg.ts:47-63`).
`schematic-svg.ts:24-28` even notes that the SVG has no viewport window and
draws every door as a line. The plan's "Band 3: port the treatments onto
`hex-svg.ts`" is therefore not blocked on Phase 2 at all and could run in
parallel with it.

The **generator** is baked. `docs/tasks/G62-hex-view.md`, section "Генератор
на решётке", says it outright: the two ceilings of six compartments per depth
column and four doors per compartment "are what the terminal schematic can
draw (six rows in a column, four ports on a box)", and were kept on the
lattice generator because "ASCII is the jam entry's main view". The same
document records what the lattice cost (a table: doors per ship 20.8 to 17.8,
median run 222 to 169 turns) and that the loop budget was raised to compensate.
So a fluid UI that un-bakes the panel and the action list still gets ships
shaped for a 4×6 window, and lifting *that* is a generator and balance change
with replay fixtures to re-record, not a UI change. The plan's Phase 2 does
not mention it; its "Open questions" should.

And the **web view already lives with the grid**, which softens the plan's
urgency a little. `ui/web/styles.ts:73` gives the panel
`clamp(340px, 31vw, 460px)`; the lines inside it are 28 characters clipped.
This is the truncation the plan complains of, and the owner has shipped with
it and playtested it. The bug that made it matter (`actions.test.ts:1062-1065`:
52 distinct lines longer than `ACTION_WIDTH` in three languages, 3470
sightings) was fixed by `fitLabel` moving the price to a second row rather
than by widening anything. It is a real cost. It is not "nothing visual gets
good until this is done"; the kit's palette, faces, log strip and motion can
land on the clipped strings and look like the kit while the model work
proceeds underneath.

### 2.5 The sound fragility was fixed before the plan was written

The plan says SFX are "keyed off wording" and that "a text rewrite silently
kills a sound", cites the survey, and recommends "promote log lines to keyed
events" as "one change that fixes an existing fragility".

It was done. `packages/engine/src/sim/log.ts:11-43`: `LogLine` has `key?:
string` ("what happened, as an opaque id the writer chose, never the wording")
and `params?: LogParams` ("what the key needs to become a sentence again").
`MessageLog.add(text, turn, tone, key, params)` (lines 53 to 59) folds repeats
on key as well as text. And `ui/sfx.ts:62-77` says, in so many words, that the
substring table "used to be" the design, that "rewording a line silenced an
effect", and that `SOUNDS` "is a lookup now: one key, one sound". Thirty-odd
keys follow. The paragraph the plan quotes (`sfx.ts:16-27`) is the *old*
rationale left above the new table; the survey read the top of the file.

What remains fragile is elsewhere and smaller. `ui/strikers.ts:21-40`
(`blowsLastTurn`) finds which module took a blow by `line.text.includes(name)`
over the module names, because the `log.hit.module` line at
`twist/rig.ts:1384` is written with a key but *no params*. So the keys exist
and the payloads are patchy. For animation that matters more than for sound:
a sound needs a key, a spark needs to know which slot and, ideally, who. The
right recommendation is not "promote lines to events" but "give the keyed
lines the params they were designed to carry, at the `log.add` calls in
`games/salvor/src`". That is a game-side change, it needs no engine change,
and it also retires the substring match in `strikers.ts`.

One more correction under the same heading. The plan says "a route cannot be
recovered from two snapshots, so this is load-bearing". True for Extraction,
where one command moves a unit four hexes and the reducer emits one
`unitMoved` per hex (`useBoardFx.ts:28-34`). Not true for SALVOR, where a
command is one door: `go` moves the drone one room, and a multi-room walk is
already a sequence of commands paced by `app.ts:357-369` with a redraw each.
The route *is* two snapshots, one per step, and the shell already has the
clock. The animation layer's need for a stream is real for blows and deaths;
for movement it is met by `game.player.room` before and after.

### 2.6 Hull art against the geomorph: right conclusion, wrong reason, and a tool the plan missed

The plan hopes the hull art "gets the visual idea without the licence" and
asks for a picture. Two things it should have found.

They do not read the same way, and it does not matter. `game/src/render/backdrop.ts:1-13`
describes the geomorph backdrop as the tile *artwork* rasterised, "recoloured
to a single ink" at low opacity, "a blueprint, not a blur": interior line
work, corridors and furniture inside the hexes. `hullart.ts:5-8` describes its
own premise: the ship is laid "**under** the hexagons so that the map the
player reads is exactly the map, and the picture is only what shows between
and around the cells". In the merged game the cell is the compartment
(converging note, "The room graph is the world", lines 466 to 493). The
interior detail the geomorph provides is precisely what a compartment-sized
hex covers. What shows is the hull between and around, which is what
`hullart.ts` draws: pods, bridge, hatches, plating, a bow. So the procedural
art does not imitate the geomorph; it answers the question the geomorph would
be reduced to at that scale. That is a stronger argument for the plan's
recommendation than "try it first because it is cheaper".

And the picture test already exists. `games/salvor/tests/hullview-sheet.test.ts`
(header, lines 13 to 22) writes `~/reports/salvor-hullview.html` under
`SHEET=1`: real hulls from the generator, each class once, drawn with and
without the hull, "so the picture can be judged by eye without a run, which is
the one way a drawing gets judged here". That is the plan's Phase 0 spike, and
it is also the answer to the plan's worry about the protocol collision (see
§2.9): SALVOR does not forbid looking at pictures; it forbids *testing the
rules* in a browser, and it generates its own contact sheets to look at.

The licence point itself is also incomplete. The plan is right that
`render/*` carries CC BY-NC into anything that draws a tile (`game/README.md:276-279`).
It misses that this half's *audio* has a licence problem of its own:
`game/src/lib/audio.ts:18` says "Licence unresolved; see
`public/audio/ATTRIBUTION.md` before any release", and that file says of the
menu track "Permission, not a licence". Since the plan already recommends
keeping SALVOR's `packages/audio` and its `.ogg` assets, this dissolves too,
but it should be listed, because "sound design from `vuvko_works`" read
literally would carry it across.

### 2.7 The export is bound to Extraction's engine, not just to React

The plan treats `design:bundle` as a React concern and a Band 1 deliverable.
Read `scripts/design-bundle.tsx:7-24`: it imports `scene` from
`stories/fixtures`, `makeUnit` and `ROSTER` from `core`, `reachableHexes` from
`core/intent`, and `REFERENCE_HEX_FEET`. Every card is a component rendered
*over an Extraction game state*. In the merged project every one of those
fixtures has to be replaced with a SALVOR scene, and the natural source is the
one SALVOR's tests already use: `shipFromText` from `@jamrog/engine/testing`
plus `newGame(seed)`. That is fine, and arguably better (a fixture drawn as
text is reviewable), but it means the export cannot stand up in Phase 1 ahead
of the shell; it stands up the moment the first component takes a `RoomGame`.

The plan's precondition, "every string in an exported component comes from
`t()`", already has an enforcement mechanism on the other side that the plan
should name and adopt rather than re-invent: `tests/purity.test.ts:159-260`
scans `games/salvor/src/ui` (among others) for any string literal that reads
as a sentence, with a short allow-list. The kit's components, ported, would
have to pass that scan. That is the G61 objection as a test, and it is a
better answer than a rule in a document.

Two smaller export notes. `renderToStaticMarkup` runs on the server with no
effects, so `useReveal`'s and `useBoardFx`'s `useEffect` bodies never execute
during export, which is why the bundle is safe today; any component that
reads `window` during *render* rather than in an effect will break it. And
the bundle inlines the two CSS files by reading them as text (lines 29 to 32),
so the palette merge into `content/palette.ts` has to leave a CSS artefact for
it to read, or the bundle has to learn to emit tokens from TypeScript.

### 2.8 Nothing about where the code lives or what builds it

The plan's last open question is "where does the merged project live". It
should be the first, because two things the plan takes for granted depend on
the answer.

**Importing across the boundary.** The pure tier is not a package. It is
`games/salvor/src/ui/*`, and it imports `../systems`, `../content`,
`../twist`: the whole game. `@jamrog/salvor` exists as a private workspace
package (`games/salvor/package.json`) with no `exports` and no build other than
Vite. A React shell anywhere else cannot `import { panelBlocks } from
"@jamrog/salvor/ui/panel"` today. Either the shell lives inside `games/salvor`
(and then it is a change to the jam entry's package, after the jam), or
`games/salvor` grows an `exports` map (a one-line change, but in the other
half), or the shell is a sibling workspace `games/salvor-web` that imports the
game's source by path. Any of the three is fine; none is free, and the plan
does not choose.

**Two toolchains.** `smoreg_works/package.json` pins TypeScript `^5.6`, Vite
`^5.4`, Vitest `^2.1`, one root lockfile across workspaces, `moduleResolution: bundler`
(`tsconfig.base.json`) with `.js`-suffixed imports by convention, a root
`vitest.config.ts` that includes only `*.test.ts` under `environment: node`. `vuvko_works/game/package.json` pins TypeScript
`^6.0.3`, Vite `^8.3`, Vitest `^5.0`, React 19, Storybook 10, ESLint 10 with
custom rules, oxlint, knip, lefthook, Playwright, extensionless imports. The
plan's "two lint disciplines" line covers the smallest of these differences.
A merged workspace has to run on one TypeScript and one Vitest; the root
Vitest config has to learn `.tsx` tests and a `jsdom` environment for the one
package that needs it (the import-suffix difference is a style only, since
`bundler` resolution accepts both); and the vendored `derelict-fx.js` is plain JS
with a `.d.ts`, which needs `allowJs` or an explicit types path in whichever
config wins. None of this is hard. All of it is the first day, and the plan's
Phase 0 "three spikes, throwaway" does not budget it.

### 2.9 The protocol collision is overstated, and the real one is under-stated

The plan lists "whose protocol governs" as something that "will collide on day
one", framing it as vitest-and-pure-functions against screenshots-against-
references. `docs/tasks/README.md`, rule 9, says: "Не тестировать игру в
браузере. Всё проверяется vitest'ом ... Скриншот делает владелец сам." The rule
is about *verification of rules*, and this half agrees with it: `core/` is
lint-walled from the DOM and held to 90 % coverage. Both halves judge pictures
by eye, one from a generated contact sheet (§2.6), the other from a Playwright
screenshot (`npm run screenshot`). Those coexist without anyone changing.

The collision that will actually happen is `eslint-rules/index.js`
(no wrapper lambdas, no duplicate lambda bodies) against 30 000 lines written
in arrows, plus rule 6 of the same README ("comments English, documents
Russian") against a half whose design notes are English. Neither can be
enforced repo-wide without rewriting the other half, so the answer is scoped
lint configs per package and a decision about the language of *new* documents.
The plan says "decide the house style once"; it should say that the only
workable decision is *not* to unify, and name the seams.

### 2.10 Smaller things

- `derelict-fx.js` is 744 lines in `game/src/vendor/`, not 534; the vendored
  copy has grown past the note in `FX-SOURCE.md` and `motion.md:4`, which also
  say 534. `DeckView.tsx` is 653 lines, not 835. `lib/audio.ts` is 131, as
  stated.
- The converging note (line 211) says `game/` was not tracked. It is now: `git
  ls-files vuvko_works/game` returns 164 files. The plan should not inherit
  that caveat.
- `DeckView.tsx:4` imports `useGameStore` directly, so it is bound to the
  zustand store as well as to `core` types; "port the treatments, not the
  file" is right, but the props interface (`DeckViewProps`, lines 18 to 34) is
  the part worth keeping and the plan does not say so.
- `OddsBar` and `ForecastPanel` are in Band 1 and 2 as things that "take
  numbers". SALVOR's combat always hits (`sim/combat.ts`, converging note line
  92). There are no odds to show. Unless the rules merge the older note argued
  for happens (the forecast over a rack), these two have nothing to render and
  should be in Band 3 as "drop unless".
- Band 2 lists seven components. `appstate.ts:48-60` has ten overlays: title,
  help, codex, history, dead, won, lost, sold, crash, plus the tug board
  (`ui/tugboard.ts`) and the debug overlay. A React shell that ships without
  the codex, the history card, the seven-row title menu (G84) or the crash
  card is a regression from the current web view. The count is closer to
  fifteen surfaces than seven.
- The kit's label face is Barlow Condensed (`design-bundle.tsx:35`,
  `ui-kit/screen.md:30`). Google's Barlow family ships Latin and Vietnamese
  only. The plan's open question 3 asks whether "the kit's type scale survives
  Russian"; the answer for the label face is no, it falls back, and the
  fallback has to be chosen. IBM Plex Mono has Cyrillic.
- "Roughly half of `packages/engine`" becomes dead weight if the grid world is
  dropped: `sim/` is 6107 lines to `rooms/`' 3913, so a little more than half,
  and `rooms/` imports `sim/`'s shared pieces (`Rng`, `Schedule`, `Entity`,
  `MessageLog`, `combat`, `damage`), so it cannot simply be deleted either.
  The plan's caution here is correct.
- The plan's Phase 0 cannot be run before the jam closes, because running
  anything under `smoreg_works/` means `npm install` there. "Phase 0 can be
  done entirely by reading" is true only of the first spike if the spike lives
  in a scratch directory and copies files in; the plan should say that is the
  intent.

## 3. Too optimistic, too pessimistic

Too optimistic: that the shell is 121 lines (it is 673 plus 121); that Band 2
has a view model waiting (it has text); that undo survives with its rule (it is
forbidden, and the rule would seal everything); that the event stream is a
missing piece (the keys exist; the payloads are the gap); that the export can
stand up in Phase 1 (it needs a SALVOR scene first).

Too pessimistic: that "nothing visual gets good until the grid is un-baked"
(the map is already un-baked; the palette and motion land on strings); that
the protocol collision is a day-one fight (it is two lint configs and a
decision about document language); that the hull-art question is open (the
premise argument in §2.6 decides it, and the contact sheet confirms it).

Right, and worth saying so: the code-to-artboard direction and the `t()`
precondition; keep `packages/audio`, take the cue discipline; draw the rack,
not a bar; consent first; do not touch `smoreg_works/` before 15 September
17:00; the geomorph pipeline does not move.

## 4. What a corrected plan would add

Not the plan itself; that is [merging-the-halves-fable.md](merging-the-halves-fable.md).
The list of things this plan would need before anyone acts on it:

1. A package decision (§2.8) and a toolchain decision, before Phase 0.
2. Phase 1 reordered: port `app.ts` into the shell first, with `screenHtml`
   as the first renderer, so the game is playable in React with every overlay
   on day one and the kit's palette and motion land on it immediately.
3. Phase 2 renamed to what it is: a panel model, with `panelBlocks` as its text
   renderer.
4. Undo replaced by "back out of what is not yet spent", or taken to the owner
   as a design change against `CLAUDE.md:42`.
5. The event work rescoped to "params on the keyed `log.add` calls in
   `games/salvor/src`", plus a per-frame `Beat` built in the shell from two
   snapshots and the new lines.
6. The generator's 4×6 ceiling added to the open questions as a balance
   decision, not a UI one.
7. `OddsBar`/`ForecastPanel` moved to Band 3; the surface count for Band 2
   corrected.
8. The picture test named as `SHEET=1 hullview-sheet.test.ts`, run after the
   jam.
