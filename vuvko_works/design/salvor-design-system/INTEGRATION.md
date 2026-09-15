# What integrating this system into the game taught it

This system was built as screens, then put on SALVOR's real engine. Everything
below is a thing that only showed up once real data and a real framework were
behind it, and every one of them is now fixed **here**, in the system, so the
next screen starts from the answer rather than rediscovering it.

Read this before changing `derelict-fx.js`, `Panel.jsx` or `HexTile.jsx`.

---

## A cancelled reveal used to blank the screen

**`scrambleReveal` empties every line it is given synchronously**, then fills it
back over held frames. `cancel` stops the frames and leaves the DOM where they
got to — right on the library's own terms, wrong under any framework, because a
framework cancels routinely.

React's StrictMode runs every effect, cleans it up, and runs it again. The first
pass blanked every line, the cleanup cancelled it, and the second pass asked the
DOM *which elements hold text* — none did, because the first pass had emptied
them. It revealed nothing and the blanks stood. A whole screen shipped empty.

**Use `FX.reveal(FX.linesOf(host), preset)`** — both now in `derelict-fx.js`:

```js
React.useEffect(() => FX.reveal(FX.linesOf(ref.current), FX.PRESETS.sheet), [deps]);
```

- `reveal` remembers each line first and puts it back if the animation does not
  finish, so a cut-short reveal is never the last thing that touched the screen.
  It returns the cleanup function directly, so it drops into an effect as-is.
- `linesOf` counts a line that has been revealed before **even while it is
  blank**. Mid-reveal the DOM says those elements have no text, and a filter
  that believes it drops exactly the lines that need putting back.

Never call `scrambleReveal` straight from a component again.

## Test it with the motion on

The reason that shipped is that every render test turned motion **off** — under
`prefers-reduced-motion` the library puts the true text straight in, which is
the only way a test can read the words. So no test had ever run a reveal.

Keep doing that for tests about *content*, and keep **one** test with motion on
and StrictMode's double pass that asserts the screen ends up saying its own
name. That one test is the whole guard.

## A readout must not outlive its subject

A hovered thing that dies unmounts its own chip, so no pointer ever leaves it
and `onMouseLeave` never fires. Killing a hostile left its card floating beside
an empty hex. `HexTile` now drops a readout whose subject is no longer in
`contents`. Any component that keeps hover state about an item in a list needs
the same guard.

## A hover-only menu is a menu you race

The door popover lived only while the pointer was on it, with a grace timer to
cross the gap. Grace timers are a way of racing the user more slowly. **A click
pins it**, and nothing but another click or a choice takes it down.

## Objects carry verbs, so objects need ids

The single biggest structural finding. The view model that fed the old picture
had no id on a thing — it was built to be *drawn*, not pressed — so no verb
could bind to it and half the game's actions were unreachable.

If a thing can be acted on, its model carries **the id the engine will answer
to**, and the prefix says which numbering it came from (`m12` an entity, `s12`
one of the ship's own things). A bare integer looked up in two lists is one
number meaning two things, and the wrong one gets spent the first time they
collide.

## Everything interactable is an icon *and* a line

A thing gets a chip on the hex and a row in the panel. Both, because they fail
differently: a shape is quicker to read and impossible to find when it is under
the pointer; a list is slower and always there. A thing with no verb is still
listed — knowing a crate is present and cannot be opened from here is knowing
something.

And whatever the board cannot carry goes in the panel, so **nothing is lost**:
ask the compartment what it already draws, and take everything else. An action
aimed at something the board does not draw used to fall out of both.

## Reveal is three things at once

When a compartment stops being a rumour: the cell opens out of its **waist**
(`sv-hex-grow`), the name band draws from the **middle to both ends**
(`sv-draw-x`), and the name **resolves out of scramble**. Pass `HexTile` a
`fresh` prop — a number that changes each time — because a CSS animation
replays when the element is new, not when a property returns to a value it
already had.

Out from the middle rather than wiped in from one end: a band with a reading
direction would be the only thing on the board that has one.

Work out *what* is new in an effect, never while rendering. A render that
remembers the last frame lies the second time it runs, which is every time under
StrictMode. Exempt the first sight of a ship — a hull that unfolds itself
compartment by compartment on arrival is a title sequence, not a scan.

## The sides have one job each

The middle is **the thing being done** — the honeycomb aboard a hull, the orders
at home. The right is **the state** — the rack, then the compartment or the
dock. Nothing is drawn in both. Two panels called Dock, and one action list said
twice, were the symptoms that produced this rule.

## Say a number once

A screen that prints one number twice makes the reader look for a difference
that is not there. Two numbers that look alike but are not — banked credits and
carried loot — must both be shown, because the gap between them is the decision.

And a gauge belongs to whatever it is about: an alarm drawn under the tug's own
name reads as the tug's, however it is labelled.

## Progress is counted from the player's end

The engine keeps how many turns are **left**, because that is what tells a bot
harness the job moved. A player counts how far **in** they are. Turn it round in
the view. Without it, stepping away for a turn shows a line reading exactly as
it did before they started, and the sensible response is to start over.

Draw it with the threat meter's geometry in another tone — "three of these, this
many so far" is one idea and a screen should not have two drawings of it.

## One setting is not worth a menu

Sound is what a player reaches for mid-turn: someone walks in, the room goes
quiet. A menu to open, a page to find and a row to press is three presses for a
one-press thing, so it is a rail key that toggles where it stands.

## Menus are drawers, not dialogs

`MenuSheet drawer`, anchored to the left edge of the play area, standing its
full height. The scrim covers the play area and the readout but **never the
rail** — so one key goes straight to another without a shut and an open in
between — and **never the log**, which is the game still talking while the
player is in a menu.

Stepping between sheets does not slide. The housing stays and its contents
change, which is what makes Settings a page of the menu rather than a second
menu.
