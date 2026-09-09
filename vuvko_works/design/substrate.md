# What the generators already decided

Before any borrowed mechanic, a plain reading of what `geomorphs.html` and
`hexmap.html` hand a tactical layer, and which design doors that opens and shuts.
Written 2026-09-09, before the reference reading, so it can be checked against
it rather than bent to fit.

## The export is already a wargame map

`hexmap.html` exports four things, and they line up suspiciously well with what
a Wesnoth-style scenario file needs:

| Export | Tactical reading |
|---|---|
| `zones` — id, name, `kind`, `roles`, `areaSqFt`, `hazard`, `sealed`, `entry` | Terrain type, cover, objectives, spawn candidates, boarding points |
| `hexes` — `q, r, zone, over` | The movement lattice |
| `doors` — `a, b, state, loop, from, to` | Chokepoints, and the only real edges in the graph |
| `plan` — tile paths | Provenance; the picture under the numbers |

Three of those have no equivalent in Wesnoth and are the interesting part.

**`roles` is a functional vocabulary, not a look.** A zone knows it is `drive`,
`command`, `quarters`, `fuel`, `weapon`, `bay`, `service`, `green`, `vertical`,
`airlock`. That is exactly the vocabulary a spawner-and-resource economy wants:
the enemy does not draw income from "a hex", it draws it from *engineering*.
Wesnoth villages are interchangeable; ours are typed for free.

**`doors` are first-class objects with state.** Wesnoth has no doors — a castle
gate is just a terrain hex. Ours are edges between two rooms, carrying a state
and a `loop` flag saying whether the ship stays connected without them. That
flag is a gift: it tells the game which doors can be welded shut without
stranding the level. Sealing a corridor is a legal player verb only because the
generator already computed which corridors are load-bearing.

**`sealed` zones are honest holes.** Eight of 68 rooms on the sample deck have
no door: air-raft bays, weapon mounts, a plasma conduit. The generator refused
to fabricate access. A game should read that as *treasure behind a wall* — a
room you can only enter by cutting, by an airlock and a spacewalk, or not at
all. Reported gaps become content.

## The hex/room split is the first real fork

The README is emphatic: **the rooms are the map; the hexagons are guidance.**
The hex overlay is decorative at 50 ft, and rooms are the thing with doors,
contents and hazards. A hex can straddle several rooms (`over` is a list).

A Wesnoth-like tactical layer needs the opposite: the hex must be the atom, one
occupant per hex, terrain defined per hex. So one of three:

**A. Fine hexes.** Drop the overlay to 10 ft and every hex belongs to one room.
Firmly Wesnoth. Cost: a deck of 68 rooms becomes thousands of hexes — far too
big for three drones, and the coarse-position philosophy is thrown away.

**B. Room graph, no hexes.** Fight on the room adjacency graph, doors as edges.
This is `navmap.html`'s model and it is what the fiction wants — Duskers-shaped,
a drone is *in the galley*, not on a coordinate. Cost: throws away the hex work,
and loses flanking, facing, and the whole spatial texture of positioning.

**C. Room-scoped hexes** — one deck's worth of rooms is cut down to a handful of
*compartments*, and each compartment is a small local hex field, 10 ft, twenty
or thirty hexes. Doors are the only links between fields. You fight inside a
compartment on hexes; you travel between compartments through doors.

C is the one worth prototyping. It keeps both halves honest: the hex grid does
the job it is good at (a firefight in one room, positioning, cover, ZOC) and the
room graph does the job *it* is good at (routes, chokepoints, sealing, sensor
range, "where is it now"). It also fixes the scale problem by never rendering
the whole ship at combat resolution — a mission is six to ten compartments, not
sixty-eight rooms.

The open question C raises: what is the cost of a door? If crossing a door is
one move point, a door is not a chokepoint, it is a hallway. It should probably
cost most of a turn to pass, be blockable by one body, and be the natural place
for overwatch.

## Terrain we already have, for free

Nothing in the pipeline was built for combat, but three fields do combat work:

- **`areaSqFt` and open-floor share.** The inspector already reports how much of
  a hex is open floor. That is cover, without authoring it: a hex that is 40%
  ink is a hex full of consoles and machinery.
- **`hazard`.** One room in seven. Already a terrain effect looking for a rule.
- **`kind` / `roles`.** Terrain identity: a `drive` room is hot and loud, a
  `green` room has line-of-sight broken by hydroponics, `vertical` is a lift
  shaft — the only link between decks, and therefore the most contested hex on
  the map.

## What is missing and must be authored

- **Line of sight.** The rasteriser knows where the ink is; nothing yet traces
  a ray through it. This is the largest missing piece and it is the one that
  makes or breaks a stealth-adjacent game.
- **Vertical.** Everything is one deck. `vertical` roles exist but no generator
  stacks decks or links them. Multi-deck is a whole second project — the first
  game should be one deck and say so.
- **Enemy-side objects.** No spawners, no resource nodes. These have to be
  placed by a pass that reads `roles` — which is precisely why `roles` matters.

## The thing to be careful about

The generators are beautiful because they refuse to invent. The taxonomy reads
the artwork rather than trusting filenames; sealed rooms stay sealed; doors go
where the artist drew a wall thin enough. A game layer is under constant
pressure to invent — to add a door because the level needs one, to move a
spawner because the fight is boring. Every such override should be a *named*
pass with a flag in the export, the way `forced` placements are counted in the
title block, so a bad level is legible rather than mysterious.
