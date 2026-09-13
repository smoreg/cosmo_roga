# Artboards 4a and 4b — the tactical screen, and how to build it

## 1. What they are

They exist, they are named 4a and 4b, and they are **one screen at two
breakpoints, not two states.** In `Derelict UI Kit.dc.html`:

| | 4a (lines 291–490) | 4b (lines 491–699) |
|---|---|---|
| caption, verbatim | *ported onto the design system · their deck-plan map, UnitCard, ForecastPanel, MissionLog, Tag, HitPointsBar — my layout, navy and type* | *landscape mobile ported · 844×390 · their deck map and cards, my layout · tabs swap tile ⇄ unit* |
| frame | 1280×720 | 844×390 |
| map | `ds-deck.js` SVG injected by `innerHTML`, letterboxed, pan by drag (3px slop), wheel zoom ×1.12, `+`/`−` ×1.15, `fit` | same |
| chrome | 46px icon rail; floating 300px title card; 104px alert dial; tile card (top right) and unit card (bottom right), both 300px; Undo 76×54 and End turn 152×54 bottom right; 30px log strip with a 200px drawer | 56px rail with 44px targets; one 46px strip holding title and a 34px dial; **one 250px card with Tile / Unit tabs**; Undo 78×46 and End turn 164×46, no keycaps; 28px strip with a 150px drawer |
| overlays | hover tooltip (226px, `pointer-events:none`, 2px left edge coloured by what is under the cursor); forecast popover at a fixed `left:420 top:300`; end-turn confirm; a left drawer for *System* and *Help · controls* | same, popover at `left:76 bottom:40` |

"Their" is the game: every card is one of `design-bundle.tsx`'s components
re-skinned. "My layout, navy and type" is the kit's contribution and it is
three things:

1. **The map is full-bleed.** `left:0 top:0 right:0 bottom:30px`. Nothing
   sits beside it; everything sits on it, at `rgba(11,21,38,0.92–0.94)`.
2. **Navy.** `--navy #0e1a2e`; panels `color-mix(navy 88%, #000)` ≈
   `#0b1526`; `--line #2b3f5e`; `--ink #d7e3f6`; `--dim #8296b4`; roles
   `--friendly #5fb8d9`, `--hostile #cf6a5a`, `--node #5fbf9f`, `--door
   #d8a94e`. The artboards carry an adapter block that maps these onto the
   game's names — `--void: var(--navy)`, `--drone: var(--friendly)`,
   `--ship`/`--spawn`/`--stamp: var(--hostile)`, `--rule: var(--line)`,
   `--font-mono: 'IBM Plex Mono'` — which is the kit telling us, in CSS, that
   the game's token names are the interface and only the values move.
3. **Two typefaces.** IBM Plex Mono for everything, Barlow Condensed
   (`--label-font`, tracking `--label-space: 0.16em`, uppercase) for the
   label role only: screen title 17px, End turn 19px, Undo 17px, dialog
   titles 19px, `LOG` 12px, tabs 13px, the alert label 11px.

What 4a/4b do **not** contain, which matters for scope: no reach wash, no
threat line, no route arrows, no hazard marks, no selection ring beyond a
stroke change (`#e8f2ff` @ 1.4) — the map is the *old* renderer's output,
frozen. No keyboard handling despite `[z]` and `[space]` keycaps and a help
table that lists `space`, `L`, `esc`. The *attack* button in the popover
and Undo have no handlers. The default selection `"3,3"` indexes a numeric
array, so on first paint neither card is shown; the `hint-placeholder-val`
attributes say the intended preview is "tile card shown, nothing else".

### Behaviour the artboards imply

- Click a hex → select it; the tile card fills (`room`, a role tag, a hold
  tag — *you hold it* in `--node` or *ship holds it* in `--hostile` — and one
  optional line: *node · pays 1 a turn*, *spawner · builds a Scout for 6*).
  Click a unit → the unit card fills too. Click a hostile → the forecast
  popover opens at once. Right-click → clear everything.
- Hover → tooltip with a title and two or three key/value rows; flips to the
  left of the cursor past x=1020 (560 on 4b).
- End turn → *End the turn?* / *Drone 1 still has 4 movement points. It will
  hold position and the ship acts next.* / **Keep playing** · **End turn**.
  Confirming **opens the log drawer** — that is the kit's "the ship acted,
  here is what happened" beat, and it is the beat [motion.md](motion.md)
  builds on.
- The log strip shows one line: a kind chip (`fight` in `--hostile`, `door`
  in `--door`) and the latest text, ellipsised, with *expand ▲ · 14 events*
  at the right. The drawer lists rows `turn / kind / text` at 12px with the
  kind column in `var(--rule)` — near-invisible by design.
- Rail: ☰ opens *System* (map, seed, income / node, spawner hp, node hp), `i`
  opens *Help · controls*, `◁))` toggles sound. Drawer wipes in with
  `panelExpand 0.24s cubic-bezier(.22,.61,.36,1)`; the scrim `dimIn .18s`.

## 2. What the game has today, against that

`GameScreen.css` is a three-row grid: a header bar (ship name, `turn · pool
· spawn zones · nodes · hostiles`, End turn), a body of `minmax(0,1fr)
280px` (map | side panel), and a 168px log. Under `@container (max-width:
860px)` the side panel becomes a horizontally swiped strip of 240px columns.
`game-now.png` shows the result at 1280×900: the deck occupies a 345×630
region in a 1000×690 pane, and a 165px band below it is empty.

The side panel holds `ObjectivePanel`, a `UnitCard` per drone, a lure
button, door buttons, `MapLegend`, and a note about unreachable rooms. The
kit's tile card and unit card are the same information at a different
address: the game shows *all* drones always; the kit shows *the selected
thing*.

## 3. The plan

### 3.1 Decisions

**Adopt the full-bleed map and the floating cards.** Cost: the panel's
always-visible squad list goes; the player sees one drone's card at a time
and finds the others by clicking them on the map. That is how every game
in `presentation/survey.md` does it, and the map gains ~30% width and the
whole dead band.

**Adopt the log strip and drawer, replacing the 168px log.** Cost: the log
is one line unless opened. Mitigated by [motion.md](motion.md): lines
*arrive* in the strip in sequence at turn end, which the fixed pane never
made anyone look at.

**Adopt 4b as the container-query variant**, replacing the swiped strip.
The tab card is a better answer to 390px of height than a strip of
240px columns.

**Do not adopt the hover tooltip.** `presentation/disclosure.md` §6 rejects
a cursor-following tooltip on the map (it occludes the thing it describes;
"the side panel is the tooltip, and it is always in the same place"), and
it is right. The tile card takes the Pointing tier instead: it shows *the
hovered hex* — room name, hazard by name, what stands there — and holds the
last hovered hex when the pointer leaves the map. The kit's tooltip rows
(hp, move, weapon) are what the unit card already shows.

**Do not adopt the alert dial.** `GameState` has `pool` and no alert level;
`alert-and-age.md` is a design note, not a rule. A dial with nothing behind
it is the dashboard the essay complains about. The title card carries
`turn`, and `pool +income` in `--node`. When the alert clock is built the
dial slot is `right:12px top:12px`, and the kit's storybook card 10 variant
B is the drawing.

**Do not adopt Undo.** There is no rule for it. `history: Command[]` and
`applyAll` make it *possible* — replay history minus one — but an undo
across a resolved attack shows the player a roll and lets them take it
back, and that is a rules decision for `tactical-diversity.md`, not a
button. The End turn button takes the full 152px until then.

**Do not adopt the fixed-position forecast popover.** `AttackChooser` stays
a modal (it is the Trading tier and the notes want the map knocked back
under it), takes the popover's chrome — `--deck` ground, 1px `--friendly`
border, the two-bar layout from `ForecastPanel`, *cancel* / *attack* — and
anchors bottom-left of the map pane as 4b does, not at `left:420 top:300`.

**Adopt the end-turn confirmation**, gated as the storybook says: *fires
only when a drone has movement left*. The game has `unit.movement` per
drone; the copy is generated from it.

**Adopt the rail**, trimmed: ☰ System (name, seed, hex feet, income per
node — `ObjectivePanel`'s contract text moves to the title card's second
line), `i` Help (the key map plus `MapLegend`, which leaves the side panel
and lives here), sound (bound to `settings-store.muted`). Settings volume
stays on the Settings screen.

**Keep the game's type scale.** Five sizes, floor 11px, is already the
essay's "five roles" done; the kit's 9px keycaps and 10px eyebrows are
under the essay's own floor. Keycaps render at `--font-xs`. See
[conflicts.md](conflicts.md) §2.

### 3.2 Components

New or changed, all under `src/components/`, obeying
`eslint.config.ts`'s boundaries (atoms → molecules → organisms → pages;
`render/` knows nothing of React).

| component | kind | props | replaces / wraps |
|---|---|---|---|
| `Card` | atom | `accent?: "tl" \| "br"`, `translucent?: boolean`, children | the panel chrome: `rgba(11,21,38,.94)`, 1px `--rule`, `12px 14px`, optional 14×14 2px `--friendly` corner bracket. Used by every floating panel. New. |
| `Keycap` | atom | `keys: string` | the `[space]` / `[z]` / `esc ×` sublabels at `--font-xs`. New. |
| `Meter` | atom | `value, max, tone: "hp" \| "move"` | wraps `HitPointsBar` for the kit's 6px track on `--deck`; tone thresholds >60% `--node`, >30% `--door`, else `--hostile` are already `HitPointsBar`'s job — confirm and delete the duplicate if so. |
| `TitleCard` | molecule | `deck, state` | the header bar's left half: ship name in the label face, `turn N`, `pool N +income`. New. |
| `TileCard` | molecule | `hex: Axial \| null, deck, state` | the Pointing tier. Room, role `Tag`, hazard name, occupant. New; consumes the hovered hex that `useMissionInput.plan` already computes (`hexAt(geometry, cursor)`) — export it from there, as `ground.md` §3 asks, so the card and the arrows never disagree. |
| `UnitCard` | molecule | unchanged + `held?: string` | keeps its API; re-skinned by tokens only. The kit's *Held in a zone of control.* line in `--door` is `heldInPlace` with copy. |
| `TurnControls` | molecule | `state, onEndTurn` | End turn 152×54 in the label face, `--friendly` at 20% over panel, hover 34%; disabled while `outcome !== null`. New. |
| `EndTurnConfirm` | organism | `drones: Unit[], onKeep, onEnd` | modal, `dimIn .14s`, copy from remaining movement. New. |
| `LogStrip` | organism | `lines: LogLine[], shown: number, open, onToggle` | replaces the 168px pane; `MissionLog` becomes its drawer body. `shown` is the playback cursor from [motion.md](motion.md); until that lands it is `lines.length`. |
| `Rail` | organism | `open: "system" \| "help" \| null, muted, onOpen, onMute` | New. `SystemDrawer` and `HelpDrawer` are its children; `MapLegend` moves into `HelpDrawer`. |
| `AttackChooser` | organism | unchanged | re-chromed, re-anchored. |
| `GameScreen` | organism | unchanged props | the composition: `.screen` becomes `position:relative; height:100%`; `.screen__map` is `inset:0 0 30px 0`; everything else absolute over it. The container query at 860px switches to the 4b arrangement (`TabCard` wrapping `TileCard`/`UnitCard`). |
| `DeckView` | organism | unchanged | untouched by this document except for the token values it already reads. Its changes belong to the presentation notes and to [performance-and-access.md](performance-and-access.md). |

`GamePage` is unchanged: it already owns `useMissionInput`, the store, and
the log lines. `App.tsx`'s screen switch is unchanged. `Shell.css` (the
out-of-mission card) gets the token values and nothing else.

### 3.3 Order of landing

Each step leaves `npm run check` green and the game playable end to end.
The order is by visible benefit per line, with the risky structural change
early while the tree is small. Full commit list in
[sequencing.md](sequencing.md).

1. **Tokens and faces.** `index.css` values only; vendored fonts. Every
   screen changes colour; nothing changes shape.
2. **The shell.** `GameScreen.css` and the `GameScreen` composition: map
   full-bleed, existing header/panel/log positioned over it as three
   cards. No new components yet — the existing `ObjectivePanel`, the squad
   `UnitCard`s and `MissionLog` are simply *placed* differently. The dead
   band vanishes; the map doubles.
3. **LogStrip.** `MissionLog` gains a collapsed mode. The screen's bottom
   30px is now what 4a draws.
4. **TitleCard, TurnControls, EndTurnConfirm.** The header bar goes.
5. **TileCard, and the panel becomes selection-driven.** The squad list
   goes; `UnitCard` shows the selected drone; the tile card shows the
   hovered hex. This is the step that changes how the game *feels* to
   play, and the step to screenshot against `game-now.png`.
6. **Rail and drawers.** `MapLegend` moves; the sound toggle binds.
7. **4b via the container query.** `TabCard`.
8. **AttackChooser** re-chromed and re-anchored.

Steps 1–4 are a day. 5 is the one to argue about, and the one to ship
behind a flag and compare, as `rooms.md` §6 does for the room tint.

## 4. Rejected

- **Porting `ds-deck.js` or the kit's `dsMountFor` pan/zoom.** It is the
  game's own `DeckView` output from a previous commit, with an
  `innerHTML` mount and delegated listeners. The game already has the
  live version, with `usePanZoom` and a `clientToUser` that is unit-tested.
- **The kit's hand-drawn hex maps (1a–3a) and their `threatTint` /
  `showHexHp` / `gridLines` knobs.** `--hex-foe` is the room-kind tint
  with a new name; `presentation/rooms.md` §6 cuts room tints. `showHexHp`
  is per-object HP always on, which `disclosure.md` §4 moves to the
  Selected tier.
- **Two cards on desktop, tabs on mobile, as separate component trees.**
  One `TabCard` that renders both children stacked above 860px and tabbed
  below keeps one tree and one set of tests.
- **The 5a/5b ship pile.** A run-map screen for jumping between ships. No
  system in `core/` produces a field of ships or a jump count; `missions.ts`
  rolls one contract at a time. Recorded, not planned.
- **A hold tag on the tile card** (*you hold it* / *ship holds it*). The
  game has `holdsGround` on a unit type, not zone ownership; the tag would
  be invented. Out until a rule reads it.
- **The kit's *System* fields as written** (`spawner hp 12`, `node hp 6`).
  Numbers the player cannot act on; the essay's item 5 would rewrite them
  in-world anyway. The drawer shows name, seed and hex size, which are
  what a bug report needs.

## 5. Not verified

- Whether `HitPointsBar` already implements the three-tone threshold; if
  it does, `Meter` is not needed.
- Whether `flow.test.tsx` / `shell.test.tsx` / `GameScreen.stories.tsx`
  assert on the current DOM structure of the screen; step 2 may need to
  carry test edits.
- The kit's colours were judged from the export's CSS, not from a rendered
  canvas; `color-mix(in oklab, …)` results were taken from the literal
  fallbacks the kit itself uses (`#0b1526` for the panel).
