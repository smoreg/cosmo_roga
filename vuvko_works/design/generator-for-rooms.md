# Repurposing the ship generator for SALVOR's rooms

How the geomorph hull generator in this half feeds the compartment graph in the
other one, and what the 90° rotation costs.

Written 2026-09-15. Companion to [merging-the-halves.md](merging-the-halves.md),
which covers the UI; this one is only about the world. **Rewritten the same day**
— the first draft raised a pile of difficulties that came from assuming the
tactical hex floor travelled with the ship. It does not. With that assumption
dropped, most of them are not problems, and the ones that remain are listed at
the end and are short.

## The shape of it

Three decisions, already taken, make this much smaller than it first looked.

**One room per tile, and zones come from tile tags.** There is no need to
rasterise the plan and hunt connected regions of floor — that is what
`hexmap.html` does, and it is the slow way round. The taxonomy already tags
every tile with its `roles`; a section *is* a compartment and its tag *is* its
kind. The raster pass exists because the tactical floor needed to know which
pixels were walkable, and the tactical floor is not coming.

**One hex per room.** SALVOR keeps compartments as graph nodes with a single
lattice cell each (`rooms/gen/hexlayout.ts`). This half's sections are a square
grid. That maps directly.

**Deployment and movement change anyway.** SALVOR moves a drone room to room
through doors; there is no per-hex walking, no zone of control, no reachable
set. So the multi-hex room, which is the whole reason this half's pipeline is
shaped the way it is, simply goes away.

Put together: **the generator produces a section grid with tags and doors, and
that is already a room graph.** Nothing in between is needed.

## The one thing worth checking was the lattice, and it holds

A square grid has four orthogonal neighbours. SALVOR's `HEX_DIRS` has six
directions and **none of them is vertical** — east, north-east, south-east,
north-west, south-west, west, with the file noting that corridors "run level or
diagonal and never vertical". That is the one place where a square section grid
could genuinely fail to become a honeycomb, and it would fail quietly, as doors
demoted from corridors to labelled chips.

It does not fail. Under an odd-r offset embedding, `(col, row) → (col −
⌊row/2⌋, row)`, every orthogonal neighbour of every square cell stays adjacent
on the lattice — 576 of 576 over a 12×12 grid, none lost. Two of the six hex
directions are left with no square counterpart, which costs nothing: they are
spare diagonals the layout may use or ignore.

So doors between neighbouring sections are corridors, and `MASK_FLOOR` — the
gate that hands a mask back when fewer than four fifths of doors can be drawn
as corridors — is not in danger. It stays worth asserting in a test, as a
tripwire rather than a risk.

Cells can therefore be written straight into `room.data[HEX_KEY]` rather than
grown: `hexLayout`'s placement search is for a game that has a graph and wants
a picture, and this is the other way round — the picture is what generated the
graph.

## The rotation, confirmed on the numbers

**This half builds vertically, bow up.** In `geomorph-core.js` the command
slots sit at the top and the drives at the bottom:

```
line  724:  bow   = {x:x0, y:-100,   … role:"command", tag:"bow"}
line  729:  slots.push({x:x0, y:span, … role:"drive", tag:"stern"})
line 1149:  slots.push({x:rim + i*100, y:0,     … role:"command"})
line 1150:  slots.push({x:rim + i*100, y:H-100, … role:"drive"})
```

**That half draws horizontally and derives which end is which.** `hullart.ts`
hard-codes nothing: `aftOf()` counts cells in the western and eastern thirds,
calls the heavy end the stern, and lets the airlock break a tie. Then
`sternX = box.minX`, `bowX = box.maxX`.

A 90° clockwise rotation maps `(x, y) → (H − y, x)`: top goes east, bottom goes
west. **Engines left, head right** falls out of exactly the rotation asked for,
and it is the orientation the other half's art already wants — `aftOf` will
agree on its own, because after the rotation the engineering block genuinely is
the western mass.

It is a coordinate transform on the section grid before cells are assigned.
Nothing upstream changes. One transform, one test asserting drive slots land
west and command slots east.

## What is actually left

Three things, and only the first is large.

### 1. The core is mid-WIP, and everything waits on it

`c896921 "WIP: lay the hull out in fifty foot sections"` is the last commit to
`geomorph-core.js`, it is on `main`, and its own message says the work is
unfinished — `src/core/missions.ts` profiles still need doubling in both axes.
It is what produces the hull with 50×50 sections loose inside it and two halves
with nothing joining them.

A hull in two disconnected pieces is not a ship graph at all: it is two, and
the second one is unreachable. Nothing downstream can be judged until it is
whole. This is step zero and it is the only real blocker.

### 2. The three systems need three compartments to stand in

SALVOR neutralises a derelict by raising `engine`, `core` and `terminal`
(`content/objectives.ts`), each standing in a compartment, and `zones.ts` marks
ENGINEERING, REACTOR and CONTROL as `required: true`. If compartments come from
tile tags, then a ship whose tiles happen to include no reactor has no mission
on it.

This is a requirement on the tile picker, not an obstacle: the generator
already places by role — `command`, `drive`, `fuel` are slot roles it fills
deliberately — so the fix is to make the same guarantee for the three the
mission needs, and fail the seed if it cannot. That is how `validateShip`
already behaves on the other side, so it is the same discipline rather than a
new one.

The `roles → kind` mapping itself is a table of about twenty rows.

### 3. The drone docks aft

`hexLayout` roots the run on the **western end** of a mask, so that "a mask
longer than it is tall is walked end to end the way a ship is". After the
rotation, west is the engine end. So the docking bay lands at the stern and the
run walks forward toward the bridge.

That is not wrong — plenty of ships dock aft, and walking bow-ward is a good
shape for a run — but it is the opposite of the reading the geomorph art gives,
where the bridge caps the bow and the reactor sits with the engines. Accept it
and write it down, or rotate anticlockwise and have the entry at the bow. I
would accept it; it costs nothing and reads fine.

## Built: `roomgen.html`

The plan above is implemented at [`../roomgen.html`](../roomgen.html)
(pictured in [roomgen.png](roomgen.png)). It is one self-contained page, no
dependencies, no fetches — it runs from `file://` and needs none of the
artwork, because a hull silhouette is a profile and a profile is eight digits.

It emits a `ShipData` that `Ship.rehydrate` takes unchanged, with each room's
lattice cell already in `room.data.hex`. **Verified against that half's own
code rather than its own opinion**: `design/salvor-artboards/verify-ship.ts`
rehydrates the export, runs `layoutShip`, and runs `validateShip` against a
spec built from `content/zones.ts`. Forty-nine ships over seven profiles and
seven seeds come back with zero problems.

That verification was worth more than the page's own checks, because it found
three whole classes of rule the plan had not mentioned and I would not have
guessed:

- **`col`/`row` are the terminal schematic, not the honeycomb**, and column *is*
  depth. That is a second layout, `gen/layout.ts` already does it, and the page
  does not carry a copy — it emits a sane starting grid and the importing game
  runs `layoutShip` once.
- **A box has four walls and a wall takes two doors**, so no compartment may
  have three doors to deeper rooms. That is a cap of two children on the
  spanning tree, which is a constraint on generation and not on drawing.
- **A loop door is only safe between equals.** A shallower wall already carries
  the door the room was reached by, so a second one there is a coin toss
  against "two doors leave the same side the same way". Loops therefore join
  rooms at equal depth, one per compartment.

The entry gives up its loops as well: a grid cell has four neighbours, which is
the whole door budget, and the airlock takes one of them.

### The deck art under the hexes

Each compartment wears a hundred-foot tile, and the direction is the point.
`hexmap.html` reads a room's kind *off* whatever tile landed under it; this
decides the room first and then picks a tile to match, through the same
taxonomy roles — `docking` wants `airlock` or `bay`, `reactor` wants `drive` or
`fuel`, and so on down a table of nineteen rows. 280 of the 1789 tiles are a
hundred feet square, which is enough spread to never repeat a neighbour.

The plan is drawn **on the section grid, not on the lattice**, because a deck
plan has to be continuous or it is not a ship — and the lattice cannot carry
one. SALVOR spaces its hexagons apart on purpose: the gap between them is where
a corridor goes. Sections have no such gap, a hundred feet of deck meets the
next hundred feet, so the plan is laid out square and the honeycomb is placed
over it, one hexagon to a section.

**Every tile is turned ninety degrees clockwise with the ship.** The archive
draws upright — engines at the bottom, bridge at the top — and this hull is on
its side, so a tile's north edge ends up facing the bow, which is east. Getting
that wrong leaves the art merely sideways; getting it *silently* wrong matches
every wall and doorway against the wrong edge as well, which is why the
direction map is written down as a constant rather than folded into an angle.

Selection uses the taxonomy's `skin` as well as its roles. A tile's skin sides
are its hull plating, so a section at the edge of the ship wants plating
exactly where it has no neighbour, and a section in the middle wants none at
all — otherwise the plan grows a hull wall through its own centre and stops
reading as one ship. 176 of the 280 hundred-foot tiles carry no skin at all,
which is the interior pool; 70 carry three sides, which is what an end cap is.

**The hull is written in the lattice's own terms.** A profile used to be a
list of column widths, which quietly assumed a rectangular grid: on a honeycomb
a column is not a straight line, every other row sits half a cell across, and a
hull built that way cannot be symmetric about anything. It is now read from the
keel outward — `8-6-3` is a keel eight sections long with rows of six and three
either side — and only half is given, because the other half is the same half.

The mirror is exact and it is exact because of one identity. A cell's place
along the ship is `q + r/2`, so a row at `−r` matching a row at `+r` needs
`q' = q + r`, which is an integer, always. No rounding, no parity rule, no
column squared off to make the arithmetic come out.

**The plan is laid on the lattice, brick fashion.** A honeycomb puts alternate
rows half a column across, and half a column is fifty feet — exactly the offset
a hundred-foot tile is allowed to take. So neighbours meet along a full edge
east and west and along a half edge on each diagonal, and the deck comes out
continuous without anything becoming a square grid. Hexagons are inset inside
their own cells, which is what leaves the gap a corridor runs through.

**Four things decide which tile a compartment wears**, all of them read off the
art by `geomorph_taxonomy.py`, which finds a wall as a white line and a door as
a black break in it:

- **Role** — what kind of deck it is.
- **Skin** — hull plating. Wanted exactly where the section has no neighbour,
  refused everywhere else, or the plan grows a hull wall through its own middle.
- **Proud** — ink measured *outside* the tile's own bounds. Art that runs off
  its edge has to have somewhere to run to, so a proud side must face space; laid
  against a neighbour it paints over it.
- **Doors, and where they sit.** 1625 of the 1768 openings on a hundred-foot
  tile are a quarter or three quarters along the edge. Those are the ones that
  line up — neighbour to neighbour on a whole section, and across a half-section
  step as well, where the one at 25 meets the one at 75. An opening anywhere
  else meets its neighbour's wall.

**Fifty-foot corners chamfer the steps.** A hundred-foot grid can only change
beam a hundred feet at a time, so an outline comes out as a flight of stairs.
145 of the archive's fifty-foot pieces have plating on two adjoining sides and
no art spilling off them — real corner plating rather than the masts, scoops
and shuttles that make up most of that pool — and one laid into a notch, turned
so its plating faces the two open sides, carries the hull line across the step.
The first three attempts used the whole fifty-foot pool and looked like debris
floating beside the ship; that is what `proud` is for.

**The ship is placed rather than merely validated.** The drives are aft because
that is where the thrust goes and the bridge is forward because that is where
the windows are — a reactor amidships satisfies every rule the validator has
and still looks like nobody drew the ship. Boarding is amidships by default,
which is the only place all three systems can lie past the deep line at once:
reactor and bridge are both marked `deep` and they sit at opposite ends.

**A hexagon has six neighbours and a tile has four edges, and that is not a
mismatch.** Laid brick fashion a cell meets east and west along a whole edge
and its four diagonals along half an edge each — two sharing the northern edge,
two the southern. So a north edge owes up to two doorways and they are not
interchangeable: the one to the north-east is the eastern of the two. Which is
exactly why the archive puts its doors a quarter and three quarters along an
edge, and why matching them is a count per edge rather than a yes or no.

**Still open: loop doors.** A loop joins two compartments at the same depth,
which the schematic draws as a wire inside one column — and it will only draw
it where that game's `layoutShip` happens to put them in neighbouring rows.
This side cannot know: it does not assign those rows. Restricting loops to
siblings did not help, so they are off by default and the page says why when
they are turned on. A hull with no loops always draws.

**Otherwise clean.** Sixty-three ships over seven profiles, three boarding
points and three seeds, all passing `validateShip`.

**Was open, now enforced:** Every 100×100 tile carries doors
at roughly 25 and 75 feet along each edge, so on a whole-section grid they line
up by construction, and across a half-section offset a door at 25 meets one at
75. Neither is *checked* yet — selection matches plating, not openings. That is
the remaining work if the plan is to be structurally honest rather than merely
continuous.

Two things follow from turning it round this way. The ship is a ship before
there is any artwork at all, so the broken core cannot produce a broken graph.
And the artwork can be missing without the ship changing: the tiles are fetched
rather than bundled, so the page wants `python3 -m http.server` from
`vuvko_works/` to show them, and draws bare compartments from `file://`.

They are also **not in the repository** — `geomorphs/` is 634 MB of CC BY-NC
art, fetched by `fetch_geomorphs.py` from the authors' own hosting. That is the
same licence question the merge plan raises against carrying the deck plan
across at all, and this page does not settle it; it only makes the picture
available to look at while it is being decided.

## Order of work

0. **Make the hull whole.** Fix or revert `c896921`.
1. **Sections to cells.** Rotate, embed odd-r, write `room.data[HEX_KEY]`
   directly. Assert the corridor share over a few hundred seeds as a tripwire.
2. **Guarantee the three required roles**, and fail the seed otherwise.
3. **Write down that the drone docks aft.**

Steps 1–3 touch only this half. Nothing here is blocked on the rest of the
merge, and nothing should start before the jam gate closes.

## What was wrong in the first draft

Recorded because the reasoning is worth not repeating. It framed a choice
between `hexmap.html`'s pipeline and the game's, worried about many-hex rooms
against one-cell compartments, and priced a mask-versus-rooms decision against
`validateShip`. All three came from carrying the tactical floor across in my
head. Once rooms are tiles, hexes are rooms, and movement is room-to-room, the
question is not which pipeline to port — it is that most of the pipeline is not
needed at all.
