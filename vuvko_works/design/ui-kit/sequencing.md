# Sequencing

The rule: every commit leaves `npm run check` green, the playtester
(`playtest.ts`) untouched, and the game finishable by hand. The order is by
visible benefit per line, with the structural change early while the tree
is small and the effects last, because they depend on the render split.

## 1. The first commit

**`Take the kit's palette and faces, and stop loading a font nobody uses`**

- `index.css`: token values from [conflicts.md](conflicts.md) §2 (`--void`
  navy family, `--rule`, `--ink`/`--ink-text`, `--dim`, the role colours;
  `--stamp`/`--ship`/`--spawn` collapse to `#cf6a5a`); `--font-mono` becomes
  `"IBM Plex Mono", ui-monospace, …`; a new `--font-label: "Barlow
  Condensed", sans-serif`; delete `--grid`; define `--size-small` or fix its
  four uses; add the `prefers-reduced-motion` rule and the `:focus-visible`
  rule while the file is open.
- `public/fonts/`: the two faces, WOFF2, with their licence files;
  `@font-face` in `index.css`; the B612 `<link>` removed from `index.html`.
- `scripts/design-bundle.tsx`: `FONT_LINK` follows.
- `npm run screenshot` before and after, both PNGs into
  `example-missions/` as the repo already does (`game-now.png`,
  `game-main-6382544.png`).

Why first: one file plus assets, zero behaviour change, every screen —
splash, title, briefing, mission, outcome — moves at once, and every later
commit's screenshot is then a like-for-like comparison. Also the cheapest
possible test of the one open question in [conflicts.md](conflicts.md) §6:
whether navy under the blueprint ink is better than near-black. If it is
not, the map's `--void` reverts in a one-line follow-up and the chrome
keeps the navy.

Cost: about an hour, most of it the fonts. Risk: `DeckView.test.tsx` or
the stories may snapshot colours — **not checked**.

## 2. The smallest change that shows

**The second commit: the screen becomes a map.** `GameScreen.css` only,
plus the minimum `GameScreen.tsx` edits to wrap the existing header, side
panel and log in three absolutely positioned boxes:

- `.screen { position: relative; height: 100% }`, `.screen__map { position:
  absolute; inset: 0 0 30px 0 }`;
- header → a card at `left:60px top:12px` (title, turn, pool) and the End
  turn button at `right:12px bottom:42px`, both over the map;
- side panel → a 300px column at `right:12px top:64px bottom:116px`,
  `overflow:auto`, translucent;
- log → 30px strip at the bottom, showing its last line, with a `details`
  toggle for the rest (the real `LogStrip` comes next; this is the
  structural cut).

`game-now.png` → the deck goes from a 345×630 region in a 1000×690 pane to
the full 1280×690, and the dead band goes. No component is new. The
container query at 860px keeps working because the boxes are still the
same elements; it just positions them differently until step 7. This is
the commit to show someone.

## 3. The rest, in order

Each line is one commit; the note in brackets is what changes on screen.

3. **`LogStrip`** — `MissionLog` gains `collapsed`; kind chip coloured by
   channel; *expand ▲ · N events*. [the bottom edge is 4a's]
4. **`TitleCard`, `TurnControls`, `EndTurnConfirm`, `Card`, `Keycap`** —
   the header is gone; End turn is 152×54 in the label face; the confirm
   fires when movement remains. [the top-left and bottom-right are 4a's]
5. **`TileCard`; the panel goes selection-driven** — `useMissionInput`
   exports the hovered hex; `UnitCard` shows the selected drone; lure and
   door actions move onto it. The squad list goes. **Flagged**: this is
   the step that changes play; screenshot and, if it is worse, the squad
   list comes back as a row of 28px discs in the title card (the kit's
   5a *Squad* block), not as the panel. [the right edge is 4a's]
6. **`Rail`, `SystemDrawer`, `HelpDrawer`** — `MapLegend` moves into Help;
   the sound glyph binds to `settings-store.muted`; the key map in Help is
   the one the keyboard commit will implement. [the left edge is 4a's]
7. **`TabCard`; the 860px container query becomes 4b** — one 56px rail
   on both sizes. [the mobile arrangement]
8. **`AttackChooser` re-chromed and anchored** — `--deck` ground,
   `--friendly` border, bottom-left of the pane. [the Trading tier looks
   like the kit]
9. **`DeckView` render split** — transform via ref; hover by key; static
   layers memoised; the `hexKey` map; the stage `<g>`; `hidden` prop.
   No visible change; **measure** on `warden-tapered`. This is the
   prerequisite for everything after and it is the riskiest commit in
   the list, because it touches the file every layer lives in.
10. **Keyboard** — cursor hex, `Enter`, `Tab`, `space`, `l`, `Escape`;
    `aria-describedby` summary; live region on the log. [the game is
    playable without a mouse]
11. **Presentation store and the player, log gating only** — `lastBatch`
    in the game store; `shownEvents`; the confirm opens the drawer and the
    ship's turn's lines *arrive* one per 225ms; click skips; reduced
    motion and the motion setting. No board effects yet. [turn end has a
    rhythm]
12. **Vendor `derelict-fx.js` + `.d.ts`; board effects** — `wake` for
    drones, `steppedTransit` for hostiles, `edgeBurst` for strikes, the
    three-frame dissolve after a 60ms hold for kills, `blink` for builds.
    [the board moves]
13. **Text reveals** — `<Scramble>`; `log` preset on the strip, `panel`
    on the cards, `value` on the turn number only. [the panels resolve]
14. **`Card` housing** — the essay's item 1: cut corners, struck top edge,
    hatched ground; one atom, six panels. [the chrome stops being a web
    page]

Steps 1–8 are the kit. 9–10 are debts the kit exposes. 11–13 are the FX
library. 14 is the essay. The presentation notes' map work (rims, wash,
rings) is *not* in this list — it is its own plan, it touches `DeckView`
and `layout.ts` only, and it can land anywhere after step 9 without
disturbing anything here.

## 4. What to measure at each step

- After 1, 2, 5: `npm run screenshot` into `example-missions/`, side by
  side with `game-now.png`.
- After 9: Chrome's Performance panel over a drag across `warden-tapered`
  at 1× and 8×; the number to write down is scripting ms per pointermove
  before and after.
- After 11: a four-hostile ship turn timed end to end with and without
  reduced motion; the target is under 3s and 0ms respectively.
- After 12: the same turn with the stage's node count logged at its peak.

## 5. The biggest risk

**Step 9.** `DeckView` is 835 lines with thirteen layers in one function
body, and both the presentation notes and the effects need it split. Done
carelessly it breaks the thing the whole game is played on; done well it
is invisible. It should be its own branch, with `DeckView.test.tsx`
extended to assert layer *order* before the split so the split cannot
silently reorder them, and it should land before the presentation notes'
map work so that both do not fight over the same lines.

The second risk is step 5: hiding the squad list is a play-feel change
dressed as a layout change, and the kit did not test it either — its
artboards were captured with nothing selected.

## 6. Rejected orderings

- **Effects first.** The animated kit page is the most seductive thing in
  the folder. Without step 9 every ghost frame is a full reconcile of
  1–2k nodes, and without step 3 there is nowhere for the log line to
  arrive. It would work on the 73-hex deck and be wrong on the 200-hex
  one.
- **Shell last.** Tokens, then components one by one into the existing
  grid, then the layout. Every intermediate screenshot would be a
  re-skinned dashboard, which is the essay's diagnosis, and nobody would
  be able to judge step 5 until the end.
- **One big branch.** The kit is five rounds of a canvas; this is fourteen
  commits, each of which is a screenshot someone can say no to.
