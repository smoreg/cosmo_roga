# Undo

The kit draws an Undo button. The first pass of these notes rejected it on the
grounds that no rule stood behind it. There is one, and it is a good one:

> **You may take back any action that told you nothing you did not already know.**

Move a drone and change your mind: free. Open a door onto a compartment you had
already seen: free. Swing at a hostile: gone, because the dice have spoken. Walk
into the dark and find out what is there: gone, because now you know.

That is the same rule Invisible Inc uses for its rewind and XCOM 2 does not use
at all, and it is the only version that is neither a cheat nor a formality. A
game that lets you undo an attack is a game where you attack until the roll is
good. A game that lets you undo nothing punishes a misclick exactly as hard as
a misjudgement, which teaches care about the mouse rather than about the ship.

## Why this game can afford it

The rules engine is already built for it and nothing new is needed in the core.
`applyCommand(deck, state, command)` is pure, the whole match is reproducible
from `{ seed, commands }`, and `applyAll` replays a list. So undo is *not* an
inverse operation — there are none to write — it is **truncate the command list
and replay from the start**.

```
undo():  commands.pop()  →  applyAll(deck, initialState, commands)
```

A mission is tens of commands and `applyAll` is microseconds a command. There
is no snapshot to keep, no diff to invert, and — the part that matters — no
second implementation of the rules that can disagree with the first.

## What makes an action final

A command is *sealed* when applying it produced an event that told the player
something. Two kinds, and both are already in the event stream:

1. **A die was rolled.** Any event carrying a strike: `attackDeclared`,
   `strikeLanded`. The roll consumed `state.rng`, and replaying would consume a
   different one — so allowing it would be re-rolling, which is the cheat.
2. **Something was revealed.** The deck has no fog today, so this is currently
   empty. It will not stay empty: `alert-and-age.md` wants a data centre that
   reveals sections, and the moment anything is hidden this is the rule that
   keeps undo honest. The check is written now so the answer is not retro-fitted
   later under pressure.

Everything else is unsealed: moving, opening and shutting doors, dropping a
canister, working a node, picking up from a cache. Ending the turn is sealed
too — the ship moves and builds on its own roll, and that is information.

## The shape in code

Nothing in `src/core/` changes. In the store:

```ts
commands: Command[]        // already the source of truth for replay
sealedAt: number           // how many commands are final
```

`sealedAt` advances whenever a command's events contain a seal. `canUndo` is
`commands.length > sealedAt`. `undo()` pops one and replays. The button is
disabled, not hidden, when `canUndo` is false — a disabled Undo says "this is a
game with undo, and that move was final", which is the more useful message.

**Redo is deliberately absent.** Undo exists so a misclick is not a punishment;
redo exists so a player can shuttle. The second is a different feature with a
different justification and it is not being smuggled in.

## What it costs

One number in the store, one replay on click, and a discipline: any future rule
that reveals information must add its event to the seal list. That is the real
cost, and it is a maintenance cost rather than a code one — which is why the
seal is a named list in one place with a comment saying why, rather than a
condition spread across the reducer.

## Not settled

- **Whether the ship's turn is one undo step or many.** Ending the turn is
  sealed, so the question is only about the boundary; it matters for the
  animation, not the rules.
- **Whether a sealed action should be *shown* as sealed before it is taken** —
  an attack button that says "this cannot be taken back" is either good
  telegraphing or nagging, and that is a question for play rather than for a
  document.
