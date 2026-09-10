# What the generators already decided

Before any borrowed mechanic, a plain reading of what `geomorphs.html` and
`hexmap.html` hand a tactical layer, and which design doors that opens and shuts.
Written 2026-09-09, before the reference reading, so it can be checked against it
rather than bent to fit. Revised 2026-09-10: the hex size is settled at 30 ft and
the per-compartment sub-grid idea is withdrawn.

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

## The hex/room split — resolved at 30 ft

The README is emphatic: **the rooms are the map; the hexagons are guidance.** The
overlay is decorative at 50 ft, rooms are the thing with doors and contents, and a
hex can straddle several rooms (`over` is a list).

A Wesnoth-like layer wants the opposite — one occupant per hex, terrain per hex.
The first draft of this note proposed cutting the deck into per-compartment hex
fields at 10 ft. **That was wrong, and the reason is a combat argument, not a
spatial one.**

At 10 ft a hex is a slice of corridor, and Wesnoth's rule that you may only attack
an adjacent hex becomes a rifle with a ten-foot reach — absurd on sight. The fix is
not to give weapons ranges; it is to **make the hex big enough that adjacency is
already a believable engagement distance.** Thirty feet apart is an ordinary
distance to shoot someone across a compartment, so the combat model can be kept
whole and the geometry stops fighting the fiction.

**So: 30 ft**, or 35 — the overlay size is a control on the page, so this is a
tuning number rather than an architectural one. One hex is a compartment-sized chunk
of ship or a stretch of corridor. Some consequences follow directly and none of them are optional:

- **The whole deck is one hex field.** No per-compartment sub-grids. At 30 ft a hex
  is larger than most rooms in the export — the sample deck's cutoff for a room at
  all is 80 sq ft against a hex's ~780 — so cutting the deck into local fields
  would be cutting it below the resolution of its own atoms.
- **Rooms become an overlay on the lattice rather than a container for it.** A hex
  knows which rooms it covers (`over`), what trades they are, and what is in them.
  That is content and identity; the lattice is position.
- **Doors are edges, and the generator already builds them that way.** `hexmap.html`
  puts a door *on* the lattice edge two hexes share. A door is therefore a property
  of a move between two hexes, not an object standing in one — which is exactly what
  a chokepoint should be.
- **Attacks stay adjacent-only.** That is the point of the size, not a casualty of
  it. Which means **line of sight is not needed for combat at all** — the largest
  missing piece named below turns out to be optional for the fight, and is required
  only for knowing where things are. See the design draft.

**One thing to watch.** The generator notes, at `hexmap.html:530`, that where two
rooms touch only *inside* a single hexagon there is no lattice edge between them and
so no door to place. Coarser hexes swallow more doors this way. 30 ft is finer than
the current 50 ft default, so this gets better rather than worse — but the mission
generator must count the doors it loses and say so, the way the tile placer counts
forced placements, rather than letting a compartment quietly become unreachable.

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

- **Line of sight — for sensing, not for shooting.** The rasteriser knows where the
  ink is; nothing yet traces a ray through it. With adjacent-only combat this is no
  longer needed to resolve an attack, which removes it from the critical path. It is
  still wanted at room granularity for what a drone can *observe*, which is a much
  cheaper problem than a per-ray firing solution.
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
