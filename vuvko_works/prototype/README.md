# Boarding prototype

A fixed-mission tactical prototype on a real exported deck plan. It exists to
answer four questions and nothing else:

1. Does a hex fight between two drones and a handful of hostiles read at this
   size?
2. Does adjacent-only combat feel like fighting across a compartment rather than
   fencing?
3. Is cutting a resource node ever the right call instead of killing what it
   built?
4. Do doors, bulkheads and zone of control make the deck feel like a ship?

```
python3 -m http.server            # from vuvko_works/
# open localhost:8000/prototype/boarding.html
```

`fetch` is refused on `file://`, so opening the page directly shows a note and a
**Load map…** button that takes a JSON from `example-derelict/` by hand.

## Playing it

Click a hex to read it. Click one of your drones to take control, then click an
**adjacent** hex: a wide **white arrow** means the step is legal, a **red arrow**
means an attack, and a **crossed grey arrow** means it is refused — hover first
and the inspector says why.

Clicking an adjacent hostile opens the **attack chooser** over it: both weapons,
with the expected damage *in each direction* before you commit. It is a popup
rather than a panel section because it blocks the turn — it should sit over the
thing it is about, and leave the moment it is answered. Dismiss it with the
Cancel button, by clicking away from it, with Escape, or with a right-click.

**Right-click clears what the page is holding** — the open chooser first, then the
selected drone and the inspected hex. Escape does the same. Only over the board
and the chooser, so the browser's own menu still works over the log and the
inspector. Space ends the turn, and the log at the bottom folds away.

Movement is one hex per click on purpose. The tinted hexes show everything
reachable this turn, but stepping is deliberate so that doors, bulkheads and zone
of control are visible as they happen rather than resolved inside a pathfinder.

## What is on the map

Both exports are the same ship at two resolutions — `Hollow Compass — Cutter`,
11 rooms, 9 doors, identical topology. Two rooms are sealed and have no door at
all; the prototype leaves them alone rather than inventing access.

| | |
|---|---|
| **Drones** | Two, in **Plasma Conduit** — the boarding point the map itself marks. 12 hp, 4 mp. Welder 3-1 melee, emitter 2-2 ranged |
| **Spawn zones** | One hex in the Bridge, one per Weapons Bay — three in all. Destroy all three to win |
| **Resource nodes** | One per room of more than three hexes, skipping rooms no drone can reach. Seven, paying +1 each per turn into one shared pool |
| **Hostiles** | scout 4 hp, 1-2 melee, no ranged, **6** &middot; sentinel 8 hp, 3-2 melee, 1-2 ranged, **11** &middot; hunter 8 hp, 2-2 melee, 3-3 ranged, **15** |
| **Spending** | Every turn the ship spends everything it can afford, on random affordable types, at random spawn zones. No per-turn cap |
| **Loss** | Both drones destroyed |

## The rules that are actually implemented

**Adjacency is the only range.** Every attack is against a neighbouring hex, as
in Wesnoth. **Movement and the attack are gated separately**: a unit may attack so
long as it has not already attacked, whatever is left of its movement. Spending
the last point walking up to something must not be what stops you hitting it.
An open door is just a passable edge, so you attack across one exactly as you
would inside a room; only a *shut* door refuses the attack. "Ranged" is a weapon *class*, not a reach: the defender answers only
with a weapon of the attacker's class, so shooting a scout with the emitter draws
no reply at all, while closing with the welder lets it claw back. The forecast in
the inspector shows both sides of that bet before you commit.

**Rooms are joined only where the artwork put a door.** Two hexes in the same
room are always connected; two hexes in different rooms are connected only where
the export placed a door on that lattice edge. Everything else is a bulkhead,
drawn as a heavy line. This is what makes the deck a graph of chokepoints instead
of an open field.

**Doors are edges, not objects.** They sit on the edge two hexes share, exactly
as `hexmap.html` draws them. Moving into a shut door forces it open and consumes
the whole move. It stays open. The ship's own units will not force doors.

**Zone of control.** Ending a move next to a hostile stops you there. ZOC reaches
only through a passable edge — nothing pins you through a wall.

**Every strike is an independent 75%,** from a seeded generator, so a seed
reproduces a run exactly. Damage is `damage × strikes`, resolved as an
alternating exchange until both sides have spent their strikes or one dies.

## Deliberately absent

Terrain defence, armour and damage types, weapon specials, experience, the alarm,
noise, line of sight, inventory and loot, the hack-and-hold verb on nodes, and
extraction. All of them are in [`../design/derelict-extraction.md`](../design/derelict-extraction.md);
none of them are here, because this page is about whether the floor of the design
holds before anything is built on it.

## Decisions this page had to author

These were not in the brief. They are the first things to argue with.

- **Spawner 12 hp, node 6 hp, neither answers back.** A spawner is two or three
  turns of both drones' full attention; a node is about one. Both are editable in
  the toolbar.
- **Nodes are attackable.** The brief names them but the win condition is the
  spawn zones, which would leave nodes as scenery. Cutting one is the "cut it"
  verb from the design doc; **taking** one is not implemented.
- **Machinery fills its hex** and blocks movement — which means a badly placed
  node could wall off part of the deck. Placement therefore rejects any hex whose
  loss would disconnect what is walkable, and the log says how many placements
  were nudged. The generators next door refuse to fabricate a door; this refuses
  to remove one.
- **Newly built hostiles arrive spent** and act from the following turn, so a
  spawn is never an ambush out of nowhere.
- **The ship's units will not force shut doors.** Only drones do.

## What the numbers already say

A scripted player run 16 times per configuration on both maps, playing two ways —
straight at the spawn zones, or cutting every reachable node first:

| Income | Map | Cut nodes first | Straight at the spawners |
|---|---|---|---|
| +1/node | 35 ft | **12 wins / 4 losses** | **0 / 16** |
| +1/node | 25 ft | **10 / 6** | **0 / 16** |
| +0.75 | 35 ft | 15 / 1 | 0 / 16 |
| +0.75 | 25 ft | 15 / 1 | 0 / 16 |
| +0.5 | 35 ft | 16 / 0 | 8 / 8 |
| +0.25 | 35 ft | 16 / 0 | 16 / 0 |

Two things worth keeping:

**The design's central decision is measurably correct.** At any income of 0.75 or
above, going for the source wins and going for the symptoms loses every single
time. That is the "fight the source or the symptoms" call from the research
actually working, not just asserted.

**Below 0.5 the question disappears** — rushing the spawn zones works fine and the
nodes stop mattering. The income rate is what makes the node economy exist at all,
so it is a decimal field in the toolbar rather than a constant.

Income +1 is the default because it is what was asked for. It is hard — a little
under a coin flip even with correct play. **0.75 is the measured sweet spot** if
the aim is a mission that punishes the wrong plan without punishing the right one.

## Files

| File | Contents |
|---|---|
| `boarding.html` | The page: rendering, input, inspector, log |
| `rules.js` | Mission building, movement, ZOC, doors, the exchange, the economy, the AI. Touches no DOM |

`rules.js` is a classic script rather than a module for the same reason the pages
next door are: both must survive `file://`, where module loading and `fetch` are
equally refused.
