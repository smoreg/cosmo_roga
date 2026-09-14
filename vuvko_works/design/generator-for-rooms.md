# Repurposing the ship generator for SALVOR's rooms

How the geomorph hull generator in this half could feed the compartment graph
in the other one, what the 90° rotation actually costs, and which of the two
pipelines is the one worth carrying across.

Written 2026-09-15, by reading both. Companion to
[merging-the-halves.md](merging-the-halves.md), which covers the UI; this one
is only about the world.

## First, a correction to the premise

There is no second generator to choose. `vuvko_works/geomorph-core.js` is one
file, loaded by both `hexmap.html` and `geomorphs.html`, and vendored into the
game byte-for-byte by `game/scripts/sync-geomorph-core.mjs` with nothing but an
export shim appended — the diff between the two copies is twenty-six lines of
shim and a trailing newline. `shipyard.html` does not load it at all.

So "use the prototype's generator rather than the game's" cannot mean the core.
What it can mean is the **pipeline above** the core, and there the difference
is real and the instinct is right.

| | What it produces |
|---|---|
| `hexmap.html` | layout → raster → connected floor regions → **zones** → a lattice → **doors on shared hex edges**. Exports `zones[]`, `hexes[]`, `doors[]` |
| `game/src/render` | layout → a deck plan with a per-hex tactical floor, many hexes to a room |

SALVOR's world is a graph of compartments with **one cell per room**. The
game's per-hex floor is therefore the wrong output entirely, and `hexmap.html`'s
zone-and-door graph is the right one — minus its lattice, which SALVOR lays out
itself. That is the piece to carry.

## The seam already exists, and it is one option object

`packages/engine/src/rooms/gen/hexlayout.ts` takes this:

```ts
export interface HexLayoutOptions {
  readonly allowed?: ReadonlySet<string>;
}
```

and its own comment says what it is for:

> `allowed` is a set of `hexKey` strings: the cells the honeycomb may use and no
> others. The engine has no idea what shape they make — **a game that wants its
> deck plan inside a drawn hull hands over the hull's cells**, and this file
> sees coordinates.

That is the integration, in one parameter. The generator's job becomes:
produce a hull, reduce it to a set of hex cells, hand them over.

There is an acceptance test built in as well. `MASK_FLOOR = 0.8`: if fewer than
four fifths of the ship's doors can be drawn as corridors inside the mask, the
layout hands the mask back and lays out free instead, because "a picture that
says a fifth of its doors in chips is a picture the owner reads as teleports".
A geomorph hull that is too thin or too branchy will simply be refused, and it
will say so. That is a good gate to have before any of this is believed.

## Two ways to feed it, and they are different projects

**(a) Mask only.** Send the hull *silhouette* as allowed cells. SALVOR's own
`shipgen.ts` still makes the rooms, the doors and the guarantees; the geomorph
side only decides what shape the ship is. Small, and reversible.

**(b) Rooms as well.** Send `zones` as rooms and `doors` as doors, and let
SALVOR lay out a graph it did not generate.

**Take (a) first, and possibly only (a).** The reason is not effort, it is
`gen/validate.ts`. SALVOR guarantees things about a ship it built: `locked`
only on tree edges, `sealed` only on loops, the `required: true` kinds present
(ENGINEERING, REACTOR, CONTROL), the `deep: true` ones actually deep. A
geomorph-derived graph can satisfy none of those by construction — the artwork
decides what rooms exist — so (b) means either relaxing the validator or
post-processing a graph until it passes, and both of those trade away the
thing that makes the other half's generator trustworthy. The mask changes how
a ship *looks* without touching any of it.

If (b) is ever wanted, the honest version is a repair pass that adds what the
artwork did not provide, and it should be judged by `validateShip` reporting
zero problems over a few hundred seeds, which is the standard that half already
holds itself to.

## The rotation: confirmed, and the numbers agree

The instinct is right and the two halves already disagree in exactly the way
that requires it.

**This half builds vertically, bow up.** In `geomorph-core.js` the command
slots are at the top and the drives at the bottom:

```
line  724:  bow   = {x:x0, y:-100,   … role:"command", tag:"bow"}
line  729:  slots.push({x:x0, y:span, … role:"drive", tag:"stern"})
line 1149:  slots.push({x:rim + i*100, y:0,     … role:"command"})
line 1150:  slots.push({x:rim + i*100, y:H-100, … role:"drive"})
```

**The other half draws horizontally, and derives which end is which.**
`hullart.ts` does not hard-code it: `aftOf()` counts cells in the western and
eastern thirds and calls the heavy end the stern, with the airlock breaking a
tie. Then `sternX = box.minX`, `bowX = box.maxX` — engines left, nose right —
whenever the west is heavier. And `hexlayout.ts` says "the root goes on its
**western end**, so a mask longer than it is tall is walked end to end the way
a ship is".

A 90° clockwise rotation maps `(x, y) → (H − y, x)`: the top goes east, the
bottom goes west. So **engines left, head right** falls out of exactly the
rotation asked for, and it is the orientation the other half's art already
wants. Nothing has to be told; `aftOf` will agree on its own, because after the
rotation the engineering block genuinely is the western mass.

It is worth being clear about how small this is. The rotation is a coordinate
transform applied when the hull is reduced to hex cells — the mask is built in
the rotated frame and nothing upstream changes. If the deck-plan artwork is
ever drawn under the honeycomb it has to rotate too, which is a transform on
one `<image>`; but per the merge plan, `hullart.ts` most likely wins the
picture and the geomorph artwork may not travel at all. In that case the whole
rotation is a handful of lines in the reducer that builds the mask.

## One conflict to settle before any of this is built

`hexLayout` puts the **root** — the compartment the drone starts in — on the
**western end** of the mask. After the rotation, west is the engine end.

So the docking bay lands at the stern, beside the drives, and the `deep` rooms
(REACTOR, CONTROL) end up forward in the bow. That is not wrong — plenty of
ships dock aft, and walking bow-ward toward the bridge is a perfectly good
shape for a run — but it is a decision, and it is the opposite of the reading
the geomorph art gives, where the bridge is the cap at the bow and the reactor
sits with the engines.

Three ways out, in order of how much they cost:

1. **Accept it.** Dock aft, walk forward. Nothing to build; say it out loud in
   the design so nobody treats it as a bug later.
2. **Rotate anticlockwise instead** — head left, engines right — so the entry is
   at the bow. Costs nothing technically, but it reads backwards against the
   other half's existing art and against every screenshot already taken.
3. **Give `hexLayoutOptions` a root-end knob.** Honest, small, and a change to
   the other half's engine, which means the jam gate and consent.

I would take 1, and revisit only if it plays badly.

## The elephant: the core is mid-WIP

`c896921 "WIP: lay the hull out in fifty foot sections"` is the last commit to
`geomorph-core.js`, it is on `main`, and its own message says the work is not
finished — `src/core/missions.ts` profiles still need doubling in both axes. It
is what produced the ship you saw with 50×50 sections inside the hull and two
halves with nothing joining them.

`hexmap.html` loads that same file. **Switching pipelines does not escape it.**
Nothing downstream of the generator can be judged — not the mask, not the
rotation, not `MASK_FLOOR` — until the hull is whole again, because a hull in
two disconnected pieces fails the mask test for reasons that have nothing to do
with the mask.

Fix or revert first. That is step zero and everything else waits on it.

## Mission design: a smaller adapter than it looks

SALVOR's missions are not a map format. A derelict is neutralised by raising
three systems — `engine`, `core`, `terminal` (`content/objectives.ts`) — each
standing in a compartment, each worked with a named tool for a number of turns
at a stated loudness, marked `E`/`O`/`T` by `systems/populate.ts`. Charters sit
on top as contracts. None of that reads a deck plan; all of it reads
`Room.kind`.

So the whole mission-side adapter is **roles → kind**. This half's taxonomy
tags tiles with `roles` (`command`, `drive`, `weapon`, `fuel`…); that half has
22 `RoomKindSpec`s carrying `weight`, `cover`, `required` and `deep`. The
mapping is a table of about twenty rows.

Under plan (a) even that is optional, because SALVOR is still choosing the
kinds. It becomes necessary only if the geomorph side starts naming rooms —
which is plan (b), which is the part I am arguing against.

## Order of work

0. **Make the hull whole.** Fix or revert `c896921`. Nothing below is
   measurable before this.
1. **Mask spike.** Reduce a generated hull to a hex-cell set in the rotated
   frame; call `hexLayout` with it; report `masked` and the corridor share over
   a few hundred seeds. The answer is a number, and `MASK_FLOOR` already says
   what counts as passing.
2. **Rotation, properly.** One transform, one test asserting the drive slots
   land west and the command slots east.
3. **Settle the entry end.** Write down which of the three, and why.
4. **Roles → kinds**, only if plan (b) is ever wanted.

Steps 1–3 touch only this half; step 1 reads the other half's engine without
changing it. Nothing here is blocked on the merge, and nothing here should be
started before the jam gate closes.

## Open questions

1. Does a geomorph hull reduce to a mask that passes `MASK_FLOOR` at all? This
   is the whole plan's load-bearing assumption and step 1 answers it.
2. How many hexes wide is a mask meant to be? SALVOR puts one cell per
   compartment; a 450 ft hull at a 25 ft hex is eighteen cells long, which is a
   lot of ship for twenty rooms. The hex size may need to become a room size.
3. Does the deck-plan artwork travel at all, or does `hullart.ts` win the
   picture? If it travels, the rotation grows an image transform and the
   CC BY-NC question comes back with it.
4. Dock aft or dock forward?
