# UI kit — bringing `extra_design/` into the game

Planning notes, 13 September 2026, branch `missions-on-main-hulls`. Nothing
here has been built. The material studied is the exported design kit in
`vuvko_works/extra_design/` (468K, seven files); the target is
`vuvko_works/game` — Vite, React 19, zustand, the deck drawn as one SVG.

| file | contents |
|---|---|
| [screen.md](screen.md) | What artboards 4a and 4b are, component by component, and the React plan: which components, which props, what is replaced, what is wrapped, and in what order so the game is playable at every step |
| [motion.md](motion.md) | What `derelict-fx.js` provides, the smallest honest way to drive it from the reducer's event list, and how animation stays out of game state |
| [conflicts.md](conflicts.md) | Where the kit and the game disagree, where the kit and the presentation notes disagree, and what is thrown away on each side |
| [performance-and-access.md](performance-and-access.md) | 70–200 hexes in SVG under a player-controlled zoom; effects that degrade to nothing under `prefers-reduced-motion`; a map that a keyboard can play |
| [undo.md](undo.md) | The rule behind the kit's Undo button, and why this engine gets it almost free |
| [sequencing.md](sequencing.md) | The commits in order, the first one, and the smallest change that shows on screen |

## 1. What the kit is, in one paragraph

It is not a foreign design. `scripts/design-bundle.tsx` renders the game's
own `HitPointsBar`, `Tag`, `OddsBar`, `ForecastPanel`, `UnitCard`,
`MissionLog`, `DeckView` and `GameScreen` to static HTML for Claude Design;
`ds-deck.js` in the kit is a baked copy of `DeckView`'s output (same layer
order, same `#4a565f` hull walls, same `#7ab0d6` tile rectangles, same 73-hex
*Hollow Tide* deck). The canvas then went five rounds — the header line of
`Derelict UI Kit.dc.html` lists them: *turn 1 · 1a / 1b + storybook — turn 2
· 2a landscape mobile — turn 3 · 3a full-bleed desktop — turn 4 · 4a / 4b
ported to the design system — turn 5 · 5a / 5b the ship pile*. **4a and 4b
are the fourth round: the tactical screen at 1280×720 and 844×390, built from
the game's components under a new layout, palette and type.** The essay
*Why it reads as a dashboard* is a critique of exactly that round (its "2
animations in the build" are 4a's `panelExpand` and `dimIn`), and the FX
library is one answer to the essay's third item. 5a/5b is a different screen
— a run map with a jump counter — for a system the game does not have.

## 2. The answer

Adopt the **layout** of 4a/4b, the **palette values** and the two
**typefaces**, the **collapsible log strip**, the **end-turn confirmation**,
and the FX library's **discrete-frame board effects** driven from the event
list. Reject the kit's cursor-following tooltip, its hostile-room tint, its
9–10px labels, its fixed-position forecast popover, its alert dial (no state
behind it), the ship pile, and every line of
`ds-deck.js` and `support.js`. Keep the game's five-size type scale over the
kit's eleven. Where the kit and `design/presentation/` disagree about the
map, the presentation notes win every time, for a reason given in
[conflicts.md](conflicts.md) §3: they were argued from the rules and the
measured decks; the kit's map is a frozen snapshot of the old renderer.

The single strongest recommendation: **the map becomes the screen.**
`game-now.png` gives the deck about 78% of the width and leaves a 165px dead
band under it; 4a gives it 100% of both axes and floats six cards over it.
That one CSS change is worth more than everything else in the kit combined,
and it is the second commit ([sequencing.md](sequencing.md)).

## 3. What was read, and how far

Every file in `extra_design/` was opened. `derelict-fx.js`, `FX
Library.dc.html`, `Kit screen animated.dc.html` and *Why it reads as a
dashboard* were read end to end. `Derelict UI Kit.dc.html` (2356 lines) was
read in full for lines 1–37 and 291–699 (the header and 4a/4b) and sampled
elsewhere: 3a, 2a, 1a's lower half and 5a's briefing column were read as a
grep of positional styles and strings, not line by line. `ds-deck.js` was
parsed structurally, not eyeballed polygon by polygon. `support.js` (69K, a
generated bundle of the design-canvas runtime) was sampled at its module
boundaries and export block; its compiler internals were not read and hold
nothing for the game.

On the game side: `DeckView.tsx`, `layout.ts`, `palette.ts`, `usePanZoom.ts`,
`useMissionInput.ts`, `GameScreen.tsx`/`.css`, `index.css`, every file in
`pages/`, `stores/`, `lib/`, `core/events.ts`, `core/apply.ts`,
`core/commands.ts`, and `ship-turn.ts` far enough to know the ship's turn is
one synchronous `set()`. The presentation notes were read in full, as were
the mission renders and `game-now.png`.

## 4. Things found on the way that are not this plan's to fix

Recorded so they are not lost; none of them is a UI-kit decision.

- `index.html` loads B612 and B612 Mono from Google Fonts; nothing in
  `src/` references them. `--font-mono` is Courier-first, and `index.css`
  itself complains about Courier's hairline stems. The game pays for a web
  font it does not use. ([conflicts.md](conflicts.md) §2 spends this.)
- `MissionBriefing.tsx:74–90` renders the hull-error paragraph twice — a
  copy-paste duplicate.
- `GameScreen.css` uses `var(--size-small)` in four places; it is defined
  nowhere, so those sizes silently inherit.
- `palette.ts` `backdropFill` is identical to `roomFill` and never imported.
- `usePanZoom` has no pan clamping; the ship can be dragged wholly off
  screen and only `fit` brings it back.
- `commands.ts` has `useMachine`; no UI path dispatches it.
- The FX library's own documentation is wrong about `blink()` (says 6 frames
  · 810ms; the code runs 7 × 135 = 945ms) and about the panel preset ("45ms a
  line" in prose, `stagger: 135` in the table and the code).
