# Conflicts — kit against game, kit against the presentation notes

A plan that adopts everything is not a plan. This note lists each
disagreement, says which side wins, and records what is thrown away.

## 1. Kit against game — layout and components

| topic | kit | game | verdict |
|---|---|---|---|
| map area | full-bleed, chrome floats over it | grid: header / (map \| 280px panel) / 168px log; 165px dead band in `game-now.png` | **kit.** Throw away the grid, `.screen__side`, `.screen__log`'s fixed height, and the 860px swiped-strip variant. |
| what the panel shows | the selected thing (tile card, unit card) | every drone, always, plus objective, lure, doors, legend, notes | **kit**, with a cost: the squad is no longer in view. Throw away the always-on squad list; keep `UnitCard`. Lure and door buttons need a home — see §4. |
| log | 30px strip + 200px drawer, lines arrive | fixed pane, autoscroll | **kit.** `MissionLog` survives as the drawer body. |
| hover | 226px cursor-following tooltip | none on map; nothing shown on hover but arrows | **neither** — the presentation notes' Pointing tier wins (§3). |
| attack | popover at `left:420 top:300`, opens on clicking any hostile | `AttackChooser` modal, opens on clicking a hostile in reach of the selected drone | **game's behaviour, kit's chrome.** The kit's "click hostile → forecast" ignores whether a drone is selected; the game's gating is right. Fixed position thrown away. |
| end turn | confirm if movement remains; confirming opens the log | immediate | **kit.** |
| undo | `[z]` button, no handler | none | **game.** No rule; see [screen.md](screen.md) §3.1. |
| alert dial | 8 segments, 2 lit, "spawn rate +1 at 4" | no alert level in `GameState`; `pool` only | **game.** Slot reserved. |
| rail | ☰ system, `i` help, sound | none; Settings is a screen | **kit**, trimmed. |
| icon-rail *System* fields | map, seed, income/node, spawner hp, node hp | header shows turn · pool · spawn zones · nodes · hostiles | **neither as written.** Name, seed, hex feet in the drawer; turn and pool on the title card; counts of spawn zones/nodes/hostiles are visible on the map and go. |
| room labels | none | `showLabels` exists, off | game; `rooms.md` §6 wants them at low zoom once tints go. |
| hex hit-testing | delegated `mousemove` on the container, `closest("polygon.hex")` | `toContent(clientX, clientY)` → `hexAt`, so touch works without a hover | **game.** |
| pan/zoom | `dsMountFor` letterbox + drag/wheel, no clamp | `usePanZoom`, tested `clientToUser`, no clamp | **game.** Both lack clamping; that is a game bug, not a kit question. |
| corner brackets | 14×14, 2px `--friendly`, one per card | none | kit, as `Card accent`; the essay's "housing" (cut corners, hatched ground) is the next iteration of the same atom and is *not* in this plan — see §5. |

## 2. Kit against game — tokens and type

**Colour.** The game's `index.css` says its tokens came from `hexmap.html`
"so a mission and the deck plan under it read as one drawing". The kit's
artboards keep the game's token *names* and change the *values* (the
adapter block on `#4a`/`#4b`). So: change the values, keep the names.

| token | game | kit | note |
|---|---|---|---|
| `--void` | `#0e1114` | `#0e1a2e` (navy) | the map ground. Bluer under the `#7ab0d6` blueprint ink; ship behind a flag and compare screenshots, as `rooms.md` §6 does for tints. |
| `--deck` | `#12161a` | `color-mix(navy 88%, #000)` ≈ `#0b1526` | |
| `--panel` | `#181d22` | `#0b1526` at 0.92–0.94 | |
| `--rule` | `#39434a` | `#2b3f5e` | |
| `--ink` / `--ink-text` | `#dfe6e6` / `#c7d0d0` | `#d7e3f6` / `#b3c3db` | the game's astigmatism note about `--ink-text` still applies; keep the two-level split, take the kit's hues. |
| `--dim` | `#8e9a9b` | `#8296b4` | |
| `--drone` | `#6fc3d6` | `#5fb8d9` | |
| `--ship`, `--spawn`, `--stamp` | `#c8503f`, `#d4574a`, `#c8503f` | all `#cf6a5a` | the game separates spawn from ship by a hair nobody sees; collapse to one, as the kit does. `--stamp` (locked doors, objective ring, damaging hazard) stays a separate *name* because `rooms.md` spends it on the map. |
| `--node` | `#5fbf9b` | `#5fbf9f` | |
| `--door` | `#e8c15a` | `#d8a94e` | |
| `--grid` | `#1d242a` | — | unused by `DeckView`; delete. |
| *(new)* hazard blue | — | — | `rooms.md` §3's seventh colour. Not in the kit; the kit has no hazard vocabulary at all. The presentation notes own it. |

**Type.** The kit loads IBM Plex Mono and Barlow Condensed from Google
Fonts. The game loads B612 and B612 Mono from Google Fonts in `index.html`
and uses neither — `--font-mono` is Courier-first, and the comment beside it
already regrets Courier's hairline stems. Verdict: **Plex Mono replaces the
Courier stack; Barlow Condensed is added for one role; B612 is removed;
both faces are self-hosted** under `public/fonts/` — the game deploys to
itch and must not depend on a third-party host at play time, and the repo's
licence discipline wants the licence file next to the asset. Both faces are
believed to be SIL OFL; **verify at vendoring time**.

The kit's *sizes* are rejected in favour of the game's. The game has five
(`11 / 13 / 14 / 18 / 44`) and a stated floor of 11px; the kit uses
9/10/11/12/13/15/16/17/18/19/22/24/30 and the essay it came with counts
"eleven ad-hoc sizes" as a defect and sets a 14px floor for readable roles.
Mapping: kit 9–10px eyebrows and keycaps → `--font-xs` (11); 11–13 → `--font-sm`
or `--font-md`; 15–19 titles and End turn → `--font-lg`; nothing on the
tactical screen uses `--font-display`. The label face carries
`--tracking-label` (0.08em) rather than the kit's 0.14–0.2em; **not
verified** that Barlow at 18px/0.08em reads as intended — it may want the
kit's 0.16em, which would become `--tracking-display`, a sixth token and
the only one this note adds.

## 3. Kit against the presentation notes — the map

`design/presentation/` was written from the rules and from 7,205 measured
hexes; the kit's map is `ds-deck.js`, a snapshot of the renderer the notes
are arguing against. **On the map, the notes win every conflict.**

| topic | kit | notes | verdict |
|---|---|---|---|
| hostile-room tint (`--hex-foe`, `threatTint`) | 3a/2a/1a tint rooms a hostile holds | `rooms.md` §6: room tints go; one neutral fill at ~0.4; colour is spent on things that change | notes. 4a/4b do not use it anyway. |
| cursor tooltip | yes | `disclosure.md` §6: no; the panel is the tooltip | notes. |
| per-object HP under tokens (`showHexHp`) | yes, always | `disclosure.md` §4 item 10: objects' HP only on the Selected tier, in reach | notes. |
| hover with nothing selected | tooltip fills | Pointing tier: one panel line, *no map layer* | notes; the tile card is that line. |
| room hold state | *you hold it* / *ship holds it* | not mentioned; no rule | neither (no rule). |
| "light the map" (essay item 4: rim light, cast shadow on hulls and hexes) | — | the art is the identity; edge weight is triple-booked (`ground.md` §2) | notes. Reject lighting *hexes*. Allow one `drop-shadow` filter on the **token layer** only (≤15 elements) so pieces sit on the board — the essay's point, at a cost the notes can bear. **Not measured.** |
| route shown by movement (ghost trail) | `wake` leaves a decaying ghost per hex | route arrows on the Routing tier | both, different tiers: arrows before the move (a decision), ghosts during it (a report). No conflict. |
| a number on the hovered hex | none | `ground.md` §3 wants one, fixed screen size, halo; `disclosure.md` §6 rejects "a per-hex label on the routing hex" | the notes disagree with themselves. Recommend §3's version (one number, counter-scaled, matched by the panel) and say so in `presentation/README.md` when it is next edited. Nothing in this plan depends on it. |
| animation | the kit's whole third act | `README` §5: "do not propose animation" | not a conflict: the notes declined to propose, they did not reject. [motion.md](motion.md) proposes. |

Where the kit and the notes agree, note it: both drop the legend from the
always-visible panel; both put hazard *names* in text, not on the map; both
keep the doors yellow.

## 4. What is thrown away, by side

**From the kit, entirely:** `ds-deck.js`; `support.js`; the DC template
runtime and `class Component extends DCLogic`; the hand-drawn hex maps of
1a/1b/2a/3a and their three knobs; the cursor tooltip; the alert dial (for
now); Undo (for now); 5a/5b and storybook cards 14–15 (ship node, jump
counter); the `System` field list; the log drawer's kind column in
`var(--rule)` (1.6:1 on its ground — deliberate, and still unreadable; use
`--dim`); every size under 11px; hover-only affordances that 4b then drops
(design touch first); `impact`, `exchange`, `teleport`, `scrambleLike`,
`hitStop` from the FX library (unused or HTML-only); the FX `value`
preset on HP and pool.

**From the game, entirely:** the three-row grid and the 280px panel; the
always-on squad list; the header stat strip; the 168px log; the 860px
swiped strip; `MapLegend` as a panel resident (it moves to Help);
`--grid`; B612 from `index.html`; the Courier-first stack;
`backdropFill`; `var(--size-small)`.

**Homeless after this, and needing a decision:** the lure button and the
door buttons in the side panel. They are the Selected tier's *actions on
the selected drone*, so they belong on the unit card as a row of `Tag`-
sized buttons — *drop lure (2)*, *shut door d8* — which is what the kit's
weapon-tag row already looks like. Recorded as the recommendation; not
drawn in the kit.

## 5. What the essay wants that this plan defers

*Why it reads as a dashboard* orders seven moves. This plan does the
layout (which the essay says not to touch — it agrees with 4a), takes the
essay's motion budget as amended in [motion.md](motion.md) §2, keeps the
game's type scale (the essay's item 2, already done), and adopts the two
faces (item 7, "last, not first" — but the kit already committed to them
and they are a value swap). It **defers** item 1 (cut-corner housing,
struck edges, hatched grounds — one `Card` atom, half a day, after the
screen exists), item 4 (see §3), item 5 (in-world copy — a writing task on
`log.ts` and the labels, not a UI-kit task), and item 6 (five sound cues
— `lib/audio.ts` exists; the player in [motion.md](motion.md) is where they
fire). None of these changes a component boundary, so deferring them costs
nothing structural.

## 6. Not verified

- That the navy ground reads better under the blueprint ink than the
  current near-black. Flag and screenshot.
- Both fonts' licences.
- Whether the game's astigmatism argument for `--ink-text` survives the
  kit's slightly bluer `#b3c3db`; contrast on `#0b1526` is ≈ 9.5:1 either
  way.
