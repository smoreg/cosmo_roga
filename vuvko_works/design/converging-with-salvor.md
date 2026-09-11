# Converging with SALVOR

Two games are being built in this repository, and both are about a drone in a
derelict. This note reads both halves as they actually are — the code first, the
documents second — and asks whether they could be one game, what that would
cost, and which way round it should go.

Written 2026-09-11, by reading both halves of the repo: `smoreg_works/` (SALVOR,
the jam entry) and `vuvko_works/` (the generators, the design notes, and the
`game/` prototype). Nothing in `smoreg_works/` was changed to write it. Where a
document describes something the code does not do, that is said in the section
about that game, not left for the reader to discover.

One date matters for everything below: SALVOR is an entry to roguetemple's
Fortnight 2 and the deadline is **15 September 2026**, four days from now. Its
`main` is held submittable at all times and its scope rules forbid a new
mechanic. Nothing proposed here can touch SALVOR before the jam closes, and the
options at the end are written with that in mind.

## SALVOR, as it is

SALVOR is a monorepo: `packages/engine` (two world models sharing one turn
cycle), `packages/audio`, `games/salvor` (the entry), `games/fortnight2` (the
frozen tile-based insurance, tag `submission-v1`). The README claims 1905 tests;
`.claude-progress.md` from 7 September says 1777 green. I could not run them
from this side — the half has no `node_modules` installed and it is not mine to
install into — so treat the count as reported rather than verified.

### The world is a graph of rooms

`packages/engine/src/rooms/graph.ts`. A `Ship` is `rooms[]`, `doors[]`, and
`entry`. A room has `kind`, `name`, `depth` (doors from the airlock), `col`/`row`
(a place on the schematic, filled by the layout pass), `cover`, `hazard`,
`opaque?`, `explored`/`scanned`, `marks[]` and a free `data` bag. A door joins
two rooms and carries one of six states. **The drone stands in exactly one room;
there are no cells and no coordinates.** "How far" is a number of doors.

| State | Drone | Machine | See through | Noise loss | How it changes |
|---|---|---|---|---|---|
| `open` | yes | yes | yes | 1 | close (1 turn) · weld (2 turns, noise 5) → `sealed` |
| `closed` | opens on the way through | same | no | 3 | — |
| `locked` | no | only a `breacher` | no | 4 | keycard (0 noise, card spent) · CELL (noise 6, −1 integrity) · SPIKE (2 turns, noise 4) · CUTTER (3 turns, noise 9 each) → `broken` |
| `sealed` | no | only a `breacher` | no | 4 | CUTTER only, 3 turns → `broken` |
| `broken` | yes | yes | yes | 1 | never closes again |
| `airlock` | yes, it is the way home | never | no | ∞ | — |

Those numbers are `rooms/noise.ts` (`DOOR_LOSS`) and `games/salvor/src/systems/doors.ts`.
The engine owns the states and `Ship.passable(door, walker)`; the game owns what
a drone can do about a lock and which module each method spends. The generator
guarantees (`rooms/gen/validate.ts`) that `locked` sits only on spanning-tree
edges with its key in a body reachable *before* the door, and `sealed` only on
loop edges — so every required compartment is reachable by a drone that cannot
cut at all.

Noise is `propagateRooms`: a loudest-first queue over the adjacency list, losing
`DOOR_LOSS` per door, `vented` rooms passing nothing on, and two sources giving
the *maximum* that arrives rather than the sum. The engine rates an attack at 9
and a step through a door at 3 (`rooms/game.ts`, `commandNoise`); every other
verb reports its own loudness from the system that owns it (pulse 8, EMITTER 7,
EMP 6, CELL 6, weld 5, SPIKE 4, salvage 2). Sight is two rules (`rooms/sight.ts`):
you see the room you stand in, and with `sight >= 1` (an intact SCANNER) the next
room through an `open` or `broken` door. The same `canSee` table serves the
player and the machines, which is what keeps hiding honest.

Machine AI (`rooms/behaviours.ts`) is a port of the grid engine's desire-map
profiles onto `RoomDistance` (Dijkstra over rooms): `brute`, `coward`, `pack`,
`stalker` (walks to the loudest room within three doors), `skirmisher`,
`hunter` (walks to the last seen or heard room, searches it eight turns, then
rewrites itself to `brute`), `turret`, `static`. A door adds one rule the grid
never had — a `follow` policy for whether a machine steps into the drone's room.

### The drone has no hit points; it has a rack

`games/salvor/src/twist/rig.ts`, 1630 lines, and the pure part of it is small.
A `Rig` is six slots (seven on a SPARK, eight on a GHOST), each a module with an
`integrity`. Every player command sets `rig.exposed` (`exposureFor`): an attack
exposes the melee weapon, `go` the THRUSTERS, `wait`/`hide` the PLATING, a
door verb the module that did it, work on a ship system the tool that system
names. Then `routeDamage`:

```
chain = [exposed slot (or the weakest, for a `precise` attacker)] + [PLATING]
`corrosive` removes PLATING from the chain; `burst` puts 1 into every slot and stops
damage flows down the chain, each slot taking min(left, integrity)
what is left reaches CORE (hp 3 on a SCRAPPER, 4 on a SPARK, 5 on a GHOST)
integrity 0 → the slot is null, the ability is gone, the derived stats recompute
```

It hooks the engine through exactly one seam: `Twist.onDamage`, which
`sim/damage.ts` runs before hit points for every blow. Machines keep ordinary
`hp`; the twist intercepts only what lands on the player. The engine's combat
is deliberately deterministic (`sim/combat.ts`: dice minus flat defence, always
hits) — "I missed four times in a row" is named as the commonest jam complaint.

Module integrities in `content/modules.ts`: CUTTER 11, THRUSTERS 12, SCANNER 8,
PLATING 13 (16 on a SCRAPPER), CELL 8, WELDER 5, LASER 4, EMP 3, SPIKE 3,
EMITTER 3, BAFFLE 4, plus three relics (Q-BLADE 14, SHOCKER 8, LATTICE 30 with
one point of flat armour). Salvaged modules come off wrecks at integrity 1–3;
grafting the same kind onto an installed one raises its ceiling by one, twice at
most.

### Pressure: the alert ladder

`systems/alert.ts`, 1014 lines. The gauge belongs to the *ship* — it lives in
`currentShip.data` and survives the drone leaving. It rises +1 every 40 turns
aboard (80 on the run's first derelict), +1 when any room hears noise ≥ 8 (no
more than once in 10 turns), +2 per ship system raised; it falls −1 after 15
quiet turns (8 in cover), −2 when the drone leaves, −3 when it dies, never
below the number of systems raised. It is a ladder, each rung climbed once:

| Level | Word | What the ship does |
|---|---|---|
| 1 | NOTICED | nothing but the word |
| 2 | SEARCHING | posts one machine in an explored room ≥ 2 doors away (not on the first derelict) |
| 3 | HUNTING | sends one machine to the drone's room; from here shuts one open door every 10 turns |
| 4 | HUNTER | the ENFORCER (`breacher`, `hunter`, `precise`, `keen`), +1 hp |
| 5 | SCUTTLE | a fresh ENFORCER every 15 turns (+2 hp); doors lock rather than close; after a 15-turn countdown the ship vents its farthest explored compartment every 12 turns |

Between sorties the ship musters `2 + 2 × level` machines into explored rooms
≥ 2 doors from the airlock, up to a ceiling (`MAX_MACHINES = 8`). A dead drone
leaves its wreckage where it fell and, next sortie, a GHOST with its rack one or
two doors away (`systems/ghost.ts`, at most two alive, a third death feeds the
oldest +2 hp). Raising all three systems (`ENGINE` in engineering with a CUTTER
or WELDER, 3 turns; `CORE` in the reactor with a CELL, 2 turns; `TERMINAL` in
control with a SPIKE or a keycard) switches the ladder off.

### The run: tug, charters, voyage

`systems/voyage.ts` is the largest file in the game (2268 lines) and it claims
the outcome: leaving through the airlock is "the sortie ended", and what that
costs, pays and leads to is decided there. One counter, credits, starting at 25;
one drone at a time; the tug is a ten-line menu (buy hull · fly · repair · graft
· stow · fit · sell · charter · jump). A voyage is three derelicts drawn at the
start (`content/derelicts.ts`, `derelictsForVoyage`): one starter of five
(freighter, barge, ferry, probe, tender — 7 to 14 rooms), one middle hull of five
(laboratory, military, smuggler, corsair, quarantine — 14 to 19), and always the
father's tug (20–25). Every derelict persists in `RoomGame.ships` for the run:
doors as they were left, loot taken, machines dead, systems raised, wrecks,
ghosts, a rival's progress. Charters (`content/charters.ts`) are plain data —
`SALVAGE` for 20/35/50 CR of loot by hull size, `RETRIEVE` 25, `UPLOAD` 30 —
judged by a table on the way out through the airlock, never on a drone that
died with the job done. `NEUTRALIZE` pays what the hull sells for (120–220 by
class). The run ends two ways: no drone and not enough for the cheapest hull,
or the father's tug raised.

### The ship generator, and the honeycomb it already lives on

`rooms/gen/shipgen.ts` grows a spanning tree of compartments from a `ShipSpec`
(kinds with weights, required and deep kinds, door-state weights, cards), adds
35–50 % loop edges, assigns door states, places locks and keys by Dormans's rule,
lays cards, validates, retries up to 14 times. Two ceilings — six rooms per
depth column, four doors per room — exist because the *terminal* schematic has
six rows and four ports per box.

The part that matters for this note: **`ShipSpec.lattice` is on for every hull
SALVOR ships** (`content/derelicts.ts`, `shipSpecOf`). With it, `growLattice`
puts every compartment on a pointy-top axial hex cell and a door may only join
two cells that touch; a shared edge is a door only sometimes. `rooms/gen/hexlayout.ts`
lays a finished graph back onto that lattice, and `ui/web/hex-svg.ts` draws it
as a honeycomb (`?view=hex`), spaced by `HEX_SPACING = 1.34` so corridors have
somewhere to be. The sandbox copy `experiments/hullforms/hexgrid.mjs` is the
lattice `hexmap.html` on this side was built to share. So SALVOR is *already* a
room graph that is also a hex map — at one cell per compartment.

### Architecture

Two engine world models (`sim/` grid, `rooms/` graph) share `Rng`, `Schedule`
(energy: 100 per turn, `speed 150` acts one and a half times), `Entity` (a flat
mutable struct with optional fields as components), `MessageLog`, `combat`,
`damage`, `status`, `spawn`, and the `Twist` hook interface. `RoomGame` is a
class; `playerCommand(cmd)` mutates it in place, pushes the command to
`inputs`, and `replayRooms(seed, inputs)` reproduces a run. Systems are
`Twist<RoomGame>` objects with optional hooks (`onRunStart`, `onLevelEnter`,
`beforeLevelLeave`, `afterPlayerTurn`, `afterActorTurn`, `performCommand`,
`offerActions`, `onDamage`, `onDeath`, `panelLines`) and SALVOR wires fifteen of
them in a stated order (`game.ts`). The engine imports no game words; the game
imports only `@jamrog/engine`. Text goes through `t(key)` in three languages;
sound and hints hang off log-line keys, not events. There are no events as such
— there is a log, and the rack's own lines.

### Where the document and the code part

`docs/design-doc.md` (v3, 3 September, kept in sync since) is close to the code,
and its own later sections correct its earlier ones. What is still off:

- **Hulls.** The document gives SPARK 55 CR and GHOST 70 CR with distinct
  starting rigs. The code (`content/hulls.ts`) prices them at 90 and 160, gives
  all three the *same* five starting modules, and sells the difference as slots
  (6/7/8) and core (3/4/5).
- **Repair.** The document says 4 CR a point; the code charges a credit a point
  capped at four per module, with a paragraph explaining why (mending a rack
  cost more than a new drone).
- **Derelict classes.** The document knows one starter (the freighter) and a
  size floor of 12 rooms; the code has five starters down to 7 rooms.
- **Population.** The document's per-room roll is disabled: `monsterChance()`
  returns 0 and every hull carries a budget (`DerelictSpec.machines`, 1–8).
- **Hazards.** The document says fire is not implemented and the mark is dead.
  It is; but `systems/hazards.ts` (453 lines) now places `frost`, `smoke` and
  mines by class, and `smoke` uses `Room.opaque`. The document's room table has
  not caught up.
- **The four-derelict voyage** in the risk table was cut to three; the code and
  the document agree on that, the document's older diagrams do not.

None of these is a hidden mechanic; they are balance numbers and content that
moved after the document was written. The design's *claims* — no hit points,
rooms as tiles, doors as the decision, the ship that answers between sorties —
are all built.

## Derelict Extraction, as it is

`vuvko_works/game/`. Note first that the folder is not yet in the repository's
history — `git ls-files` returns nothing under it, while `design/` and
`prototype/` are tracked — so the other half cannot read it by pulling. `src/core/`
is 3876 lines including tests, held to 90/85 % coverage and lint-walled from
React and the DOM. `npm test` runs 127
tests; 124 pass. The three failures are in `src/pages/flow.test.tsx`, which
asserts a `store.screen` field the store does not have and dialog text the
briefing does not render — the test is behind the code, not the code broken.

### The world is a hex lattice read off a deck plan

`core/deck.ts` parses a `hexmap.html` export: `zones` (id, name, `kind`,
`roles[]`, `areaSqFt`, `hazard`, `entry`, `sealed`, `marks`), `hexes` (`q, r,
zone, over[]`), `doors` (`a, b, state, loop, from, to, at`), and the tile `plan`
for the backdrop. The lattice is flat-top turned a sixth and stood on the keel
(`core/hex.ts`) — which is the same six axial neighbours, in the same order, as
SALVOR's `HEX_DIRS`. A hex belongs to one zone and may overlap others; two hexes
in the same zone are always joined; two hexes in different zones are joined only
where the export put a door on the edge they share, otherwise it is a bulkhead
(`core/topology.ts`). The one shipped deck is `assets/decks/hollow-tide-35ft.json`
— 35 ft hexes, not the 30 the design settled on.

Rooms with no door stay unreachable and are *reported* (`MissionReport.unreachableRooms`),
never patched. Objects are placed in the most central free hex of a room and
refused if their hex would disconnect the walkable deck (`mission.ts`,
`wouldDisconnect`), with the number of nudged placements reported too.

Door states are `open | closed | locked | broken` (`core/types.ts`). A closed
door yields to a shoulder and costs the rest of the move; a locked one is
attacked, has one hit point, never answers, and one landed strike leaves it
`broken`. There is no `sealed`, no key, no welding, no closing a door behind you.

### Adjacent-only Wesnoth combat with hit points

`core/combat.ts`. Units have `hp`, `movement` (4 for everything), and weapons
with a class, damage and strike count. An attack is an exchange: the attacker's
strikes alternate with the defender's, **the defender answers only with a weapon
of the attacker's class**, each strike an independent 75 % hit (`HIT_CHANCE`),
until both are spent or one dies. `forecast()` convolves the whole outcome
distribution strike by strike, so the chooser shows the real odds in both
directions before committing. Zone of control reaches only through a joinable
edge (`enemyExertingControl`); ending a step beside a hostile ends the move.
A unit attacks whether or not it has movement left, once per turn.

The roster (`core/roster.ts`): drone 12 hp, welder (melee 3×1) and emitter
(ranged 2×2); scout 4 hp, claw 1×2, cost 6; sentinel 8 hp, ram 3×2 and arc 1×2,
cost 11; hunter 8 hp, blade 2×2 and lance 3×3, cost 15. Two drones are placed in
the entry compartment (`mission.ts`); the design says three.

### The spawn economy

`core/ship-turn.ts`. Spawners (12 hp) go in reachable rooms of four or more hexes
whose `roles` include `weapon`, `command` or `drive`; a resource node (6 hp) goes
in every reachable room of four or more hexes. Each ship turn: income = live
nodes × `incomePerNode` (1) into a shared pool; the ship then builds everything
it can afford, in random affordable type and random free hex beside a spawner,
and what it builds arrives spent (moves next turn, which is the only
telegraphing there is). Hostiles then take the best-scored adjacent attack
(expected dealt minus expected answered) or step along a BFS route toward the
nearest drone, never forcing a door. The pool never sees what the drones carry;
the file says why in its first comment.

Win when no spawner is alive, *or* when nothing hostile is aboard and the ship
can never afford another build (`canStillBuild`: no live node and pool below
the cheapest unit). Lose when both drones are dead.

### The run: a mission roll

`core/missions.ts`: one mission type ("Secure the ship"), four hull profiles
(`1-2-1`, `1-2-3`, `2-1-2`, `3-2-1`), and a seed a person can read over a radio.
`rollMission` draws a type and a profile; the store (`stores/game-store.ts`)
shows a briefing, launches on the bundled deck, and rolls the next one when the
mission ends. There is no money, no persistence, no second mission type, nothing
carried between missions. The hull profile is shown and not used — the deck is
the one JSON.

### Architecture

Commands in, events out. `applyCommand(deck, state, command)` returns a new
state and a list of events; nothing mutates. Randomness is counter-based
(`core/rng.ts`, splitmix32 mixed with a cursor the state carries), so a match
is `{ seed, commands }` and a property test holds that the same pair gives the
same state. Three commands (`moveUnit`, `attackWith`, `endTurn`); fifteen event
kinds, each with a named constructor. Turn order is I-go-you-go by side, not an
energy scheduler. React 19 and zustand on top, Storybook for the components,
custom lint rules that forbid wrapper lambdas and duplicated lambda bodies.

### Where the document and the code part

Most of `derelict-extraction.md` is not built, and the game's own README says
so under "What is not here yet". Naming it precisely:

- **Three drones** in the design; **two** placed by the code.
- **Nodes have two verbs** (cut it, take it); the code has one, and it is an
  ordinary attack on a 6-hp object. No noise, no local pressure spike.
- **The alarm made of noise, six bands, security nodes that lower it** — none of
  it. There is no noise model at all.
- **Inventory, loot competing for slots, the welder-as-weapon rule** — the
  drone has a fixed welder and emitter and no slots.
- **Extraction as a second objective, the airlock heating up** — the win is
  clearing or starving the ship; nobody walks home.
- **Telegraph a full turn ahead** — a built unit is visible for a turn before it
  acts, which is the weak form.
- **Terrain from the taxonomy** (open-floor defence, `green` blocking sight,
  `hazard` hurting) — none; every hex is the same hex.
- **Procedural generation** — a deck is an exported JSON; `parseDeck` is the
  seam and the README says a generator "produces the same shape".

What *is* built is exactly the tactical floor the design said to build first:
the lattice, the doors as edges, ZOC, the exchange with the class-answering
rule, the forecast, and the spawner-and-node economy with its starvation win.

## The genuine overlap

The two halves agree on more than the pitch suggests, and in specific places.

**A door is an edge with a state, and the generator decides which edges may be
shut.** SALVOR: `locked` only on tree edges, `sealed` only on loops, guaranteed
by `validateShip`. Extraction: `Door.isLoop` from the export, so the game knows
which doors it may weld without stranding the deck. That is the same idea from
two directions and the two door vocabularies overlap on `open`, `closed`,
`locked`, `broken`.

**A room is typed, and the type does economic work.** SALVOR's 22 zone kinds
decide which cards may land, which items appear, which system is here.
Extraction's `roles` decide where spawners go (`weapon`, `command`, `drive`) and
the design wants them to price the nodes. `Room.kind` and `Zone.kind` are both
strings the rules read and the engine does not.

**The generator refuses to invent.** SALVOR reports `ShipProblem`s and retries;
Extraction reports unreachable rooms and nudged placements in the mission
report. `substrate.md`'s rule — "every override should be a named pass with a
flag in the export" — is already how `shipgen.ts` behaves.

**A run is a seed and a command list.** `replayRooms(seed, inputs)` and
`applyAll(deck, state, commands)`. Neither half lets `Math.random` or
`Date.now` into the rules (SALVOR has a purity test for it; Extraction has a
lint boundary and a property test).

**The same lattice.** SALVOR's `hexlayout.ts`, the hullforms sandbox and
`hexmap.html` share six directions in one order. A cell on one side is a cell
on the other.

**A `hexmap.html` export is a `ShipData`.** This is the overlap that turns into
code cheapest. Extraction's `DeckMap` has `zones` with kinds, roles and an
entry, and `doors` with `a`, `b`, `state`, `loop`. SALVOR's `Ship` is `rooms`
with `kind`, `depth`, `cover`, `hazard`, and `doors` with `a`, `b`, `state`.
The adapter is a BFS for `depth`, a mapping of `roles` to a `kind`, a rule for
which doors to mark `sealed` (loops only, as SALVOR requires), and one
`airlock` self-edge at the entry. Two hundred lines. It would let SALVOR's
whole rules layer — noise, sight, behaviours, the rig, the alert, the voyage —
run on a deck drawn by the geomorph pipeline, with the picture underneath.

**Pressure is the ship, not a timer.** SALVOR's alert lives on the ship and
wakes machines in rooms the drone has walked; Extraction's pool lives on the
ship and builds beside spawners. Both halves reject "the alarm sees your loot":
Extraction's `ship-turn.ts` says so in its header, and SALVOR's alert reads
noise, time and raised systems and nothing about the hold.

## The genuine conflicts

These are forks, not gaps. In each one a model has to win, or both have to be
kept at a cost.

### One drone or a squad

SALVOR has `game.player`, singular, read in every system — sight, alert, ghost,
rig, voyage, the action list. The whole interface is "what can *the* drone do
here", ten numbered lines. Extraction has `units` with a side and a per-unit
`hasAttacked`, and its entire tactical content — ZOC, approach direction,
holding a corridor, the answering rule making a tool-only drone shootable with
impunity — exists *because* there is more than one body to position. A single
drone on a hex lattice is a drone with a longer walk; a squad on a room graph
is three drones in one room with nothing between them. Neither reduction keeps
what the other side built.

### Modules burn, or hit points and strikes

SALVOR's twist is that damage lands on the ability you used, and the only
health is what is left of the rack. Extraction's exchange is Wesnoth's: several
small strikes, each a 75 % roll, retaliation by weapon class, a forecast over
hit points. These can be composed — the section below says how — but they
disagree on a value: SALVOR's engine *always hits* and says why; Extraction
rolls every strike and shows the distribution to make the roll fair. Both are
defensible. They are not the same game.

### A room is the atom, or a hex is

SALVOR's design says it in the exclusions: "a cell map inside a compartment —
the compartment is atomic; this is a decision, not a saving". Extraction's
design settled the hex at 30 ft *because* that is roughly a compartment, and
then made rooms an overlay on the lattice rather than a container for it. At
one cell per compartment — which is what SALVOR's lattice hulls already are —
the two coincide. At 30–35 ft on a geomorph plan the sample deck has rooms
smaller than a hex and rooms spanning several, and a hex straddles rooms
(`over`). So the conflict is not "rooms or hexes"; it is **whether the cell and
the compartment are the same object**. If they are, SALVOR's graph is the
model and the honeycomb is its picture. If they are not, position inside a
room exists, doors are edges between cells rather than between rooms, and
SALVOR's `Ship` cannot represent the deck.

### Which clock drives the ship

SALVOR: a gauge, raised by time and noise and raised systems, climbed once per
rung, with each rung doing a different *kind* of thing, persisting between
sorties and mustering bodies from it. Extraction: a pool, fed by nodes every
turn regardless of anything the player does, spent on bodies at spawners; and
in the design, an alarm driven by noise alone and allowed to fall. SALVOR's
gauge is procedural pressure (the ship gets angrier); Extraction's pool is
material pressure (the ship gets more numerous); `derelict-extraction.md` §7
argues explicitly for the second over the first. Two clocks together is the
thing Nex Machina is cited for getting wrong.

### What a run is

SALVOR: a voyage — money, one drone at a time, a persistent derelict you go back
into, ghosts of your dead, three hulls, a father's tug. Extraction: a rolled
mission with nothing before or after it, and an open question (C) about whether
the campaign should exist yet. SALVOR answered that question with 2268 lines.
Extraction's design wants loadout choice to weigh something and names
Mordheim and Tarkov; SALVOR's rack-that-stays-aboard-and-comes-back-as-a-ghost
is that idea, built.

### The architectures

A mutable `RoomGame` with an energy scheduler, systems mutating state through
hooks, a log of translated lines with keys — against an immutable reducer with
side turns, counter-based rng carried in state, and a closed list of events
the renderer animates. These are not styles; they are commitments the code on
each side is built around. SALVOR's `Entity` is one flat struct for the drone
and every machine; Extraction's `Unit` and `MapObject` are separate and
readonly. SALVOR's hooks decide *while* the turn happens; Extraction's events
say what happened *after*. SALVOR's lint would pass Extraction's code;
Extraction's `no-wrapper-lambda` rule would reject most of SALVOR.

### Interface

ASCII on rot.js, a Duskers schematic, a numbered action list, no cursor over the
world by decision — against React, a pannable hex map you click, a route drawn
under the cursor, an attack chooser with odds. SALVOR's second and third views
prove it can be drawn as SVG and as a honeycomb; they do not add a cursor.

### Licence

The geomorph artwork is CC BY-NC and this game stays non-commercial for it.
SALVOR ships its own art and audio and is a jam entry with its own credits. A
merged game inherits the NC clause the moment it draws a Mobius tile, and the
tiles are what make the deck plan a picture. That is a real cost and it is
named here so it is not discovered later.

## Meeting in the middle

Decisions, with the trade named. Where I think one side should simply win, I
say so.

### The room graph is the world; the hex lattice is the layout and the scale

**The compartment and the cell should be the same object**, and the reason is
on both sides already. SALVOR grows every hull on the lattice with a door only
between touching cells, and draws it as a honeycomb. Extraction's design chose
a hex "large enough that adjacency is a believable engagement distance" — a
compartment-sized chunk — and then discovered that at that size the whole deck
is one field and rooms are an overlay. Take that one step further and the hex
*is* the compartment: `Room` gains `q, r` (SALVOR already stores `HEX_KEY` in
`room.data`), a door is the shared edge of two cells that is not a wall, and
adjacency in the lattice is adjacency in the graph. Nothing in SALVOR's rules
changes. Extraction's ZOC and adjacent-only attack become "a machine in the
next room through an open door", which is exactly SALVOR's range-1 rule for
turrets and the EMITTER.

What the geomorph pipeline would then have to do is what `hexmap.html` already
does with its hex-size slider, at the coarser end: one cell per zone, or zones
merged until each cell is a room worth standing in. The design's own footnote
warns that coarser hexes swallow doors; the answer is `substrate.md`'s — count
the doors lost and say so — and SALVOR's `validateShip` already refuses a hull
whose required rooms are unreachable.

*Given up:* position inside a room, the 40 %-ink cover hex, the corridor you
hold one hex wide. *Kept:* every one of SALVOR's tested invariants, the door
table, the noise model, the picture with the plan underneath. *Trade:* the
tactical floor Extraction built is mostly not this, and the honest version of
this decision is that it keeps the exchange and the forecast and discards ZOC
and routes.

The alternative — a hex per 30 ft with rooms as overlay, SALVOR's graph
retired — is described under option B below. It is not a middle.

### Modules burn; hit points stay for the ship's things

**"Modules burn" replaces hit points for drones and replaces nothing for
machines.** That is already the case on both sides: SALVOR's machines have
`hp`; Extraction's drone has `hp` because there is no rack yet. The rig's
`routeDamage` is a pure function over a `Rig` with no game in it, and it can sit
inside Extraction's exchange without changing the exchange's shape:

- The attacker's *weapon* is the exposed module. Attack with the welder and the
  answer lands on the welder. This is `exposureFor` and the Wesnoth
  answering-by-class rule agreeing with each other without being told to.
- Each of the defender's answering strikes is one `routeDamage(rig, damage,
  tags)` call: exposed slot, then PLATING, then core. Several small strikes
  suit the chain better than one blow — a 3-point strike into a 5-point WELDER
  is a decision, a 12-point blow is a burn.
- The forecast convolves over the chain instead of over `hp`: the axis becomes
  "integrity of the exposed module, then PLATING, then CORE", which is a fixed
  sequence once the exposure is known, so the distribution stays a
  one-dimensional convolution and the chooser can say *"31 % the WELDER burns"*
  next to *"56 % the scout dies"*.

*Given up by SALVOR:* always-hit. Its reason (the four-misses complaint) is
answered by Extraction's answer (show the distribution, decompose the damage).
*Given up by Extraction:* the drone's hit-point bar, and the design's hedge
about deterministic drone damage (question B) is settled the other way by the
rack — the rack *is* the deterministic part: what burns is chosen, only whether
the strike lands is rolled. *Trade:* a squad of three with six to eight slots
each is up to twenty-four integrity bars on one screen; SALVOR's panel is
designed for six. That is a real UI cost and it argues for a squad of two.

### The pool feeds the bodies; the ladder decides what the ship does with them

Keep both, and give each one job.

- **The node economy is the count.** Replace SALVOR's `+1 alert per 40 turns`
  and its between-sortie `2 + 2 × level` muster with income from live nodes
  spent at spawners, as Extraction does it. The ship gets more numerous
  whether or not you are loud; sitting still costs bodies, not gauge. Cutting a
  node is SALVOR's `act work` on a system in reverse: several turns, a tool
  exposed, noise 8–9, and the ship's income drops that turn. Taking one — the
  design's second verb — is the same work with a quiet tool and a held room,
  and SALVOR's "raise ENGINE with a CUTTER or WELDER" is *already* a take verb on
  a system with an exposed tool; only what it pays differs.
- **The alert ladder is the quality.** Noise still climbs it (the threshold and
  the cooldown stay), raised or taken systems still add to it, silence and
  cover still bring it down. But the rungs stop *posting* machines — the pool
  does that — and keep the things only a ladder can do: doors shutting from
  level 3, locking at 5, the ENFORCER at 4, the scuttle at 5. That is
  Invisible Inc.'s ladder as the design asked for it, each band a different
  kind of thing, and it is what `alert.ts` already is once `posted` and `sent`
  are set to zero on every rung.

One gauge on the panel, one pool the player can read off the nodes on the map.
The two never add bodies for the same reason.

*Given up by SALVOR:* the time tick as the anti-turtle spine, and the muster
formula. *Given up by Extraction:* the alarm-that-can-be-bought-down as a
distinct security-node mechanic (question E is settled: nodes pay in bodies not
built, silence pays in the gauge). *Trade:* Extraction's "no per-turn cap, spend
everything" build rule meets SALVOR's `MAX_MACHINES = 8`; the cap has to win or
a big hull becomes a wall of machines, which SALVOR measured (420 machines in a
freighter over ten sorties, G33).

### The voyage is the run; the mission roll is the charter board

SALVOR's tug, credits, three-hull itinerary, persistent derelicts and ghosts
should simply win. They exist, they are measured by bots over two hundred seeds,
and they are what makes "a drone is equipment, not a life" true — a claim both
designs make and only one has built. Extraction's `rollMission` becomes what a
charter is: a type, a hull profile, a seed, offered on the tug. Its one mission
type, "secure the ship", is SALVOR's `NEUTRALIZE` with the win condition
Extraction found — level the spawners *or* starve them — which is a better
condition than "raise three systems" because the second route is a strategy
rather than a checklist.

*Given up by Extraction:* nothing it built, and the open question C is answered
by inheritance. *Given up by SALVOR:* the three named systems as the only route
to a sale.

### One drone, or two

This is the fork the rest does not resolve, and it should be decided by a
playtest rather than in this note. The two honest positions:

- **One drone.** The action list stays, the schematic stays, every SALVOR
  system stays, the hex is a picture. The exchange and the rack compose as
  above. Extraction contributes decks, the plan under the map, the node
  economy and the forecast. This is the cheapest merged game and it is
  recognisably SALVOR.
- **Two drones.** One is a `skirmisher` chassis that ignores ZOC (the design's
  §4, "one chassis and it is enough of an identity"); each has a rack; the
  ship's machines answer whichever is in reach. This needs `RoomGame.player`
  to become `players` and every system that reads it to say which — sight,
  alert (whose noise does it hear), ghost (whose wreck), the rig (whose
  exposure), the voyage (which one leaves). It is a two-to-three-week change
  with a large test surface and it is the only way anything Wesnoth-shaped
  survives.

The playtest that decides it is the one `derelict-extraction.md` already
describes as "the smallest thing worth building", run on a SALVOR lattice hull
at one cell per compartment instead of on a 35 ft geomorph overlay. If holding
a door with one drone while the other cuts a node is a decision the player
notices, the squad earns its cost. If it is two racks to babysit, one drone.

## What is cheap and what is expensive

Both halves are TypeScript with vitest, and both keep their rules pure of the
DOM. That is where the ease ends. The table is about *code moving across the
boundary*, and "rewrite" means the logic survives and the file does not.

| Piece | Where | Reused as-is | Rewritten | Roughly |
|---|---|---|---|---|
| Room graph, noise, sight, paths, behaviours | `engine/rooms/` | in a rooms-wins game | — | 0 |
| Ship generator, validator, hex layout | `engine/rooms/gen/` | in a rooms-wins game | in a hex-wins game, as a reducer-side generator producing `DeckMap` | 0 / 2 weeks |
| `routeDamage`, `Rig`, `derivedStats` | `salvor/twist/rig.ts` lines 150–530 | yes, either way: pure over a `Rig` | the other 1100 lines (verbs, wrecks, carry) are `RoomGame` hooks | 0 / 1 week |
| Alert ladder | `salvor/systems/alert.ts` | in a rooms-wins game, with `posted`/`sent` zeroed | as a reducer module reading a noise field | 1 day / 1 week |
| Voyage, tug, charters, ghosts, rival | `salvor/systems/` | in a rooms-wins game | ~5000 lines against `RoomGame`, i18n and the action list | 0 / 4–6 weeks |
| `parseDeck`, `hex.ts`, `deckGeometry` | `game/src/core/` | yes; add a `deckToShip` adapter | — | 200 lines |
| Exchange and forecast | `game/src/core/combat.ts` | yes: pure over numbers; the forecast needs a chain instead of an hp axis | — | 2–3 days to route through a `Rig` |
| Spawner/node placement and the pool | `game/src/core/mission.ts`, `ship-turn.ts` | placement logic yes (`wouldDisconnect` is over cells; over rooms it is trivial) | the build loop as a `Twist` hook on `afterPlayerTurn` | 3–4 days |
| Counter-based rng | `game/src/core/rng.ts` | in a hex-wins game | SALVOR's `Rng` is sequential and forked; the two do not mix in one state | — |
| Events | `game/src/core/events.ts` | in a hex-wins game | SALVOR has log lines with keys; an events layer over `RoomGame` is a new seam | 1 week |
| Backdrop, layout, `DeckView` | `game/src/render/`, `components/` | yes, given a `Ship` with cells: SALVOR's `hex-svg.ts` draws the same lattice already, without the plan under it | — | 2–3 days to draw a `Ship` |
| React, zustand, Storybook | `game/` | in a hex-wins game | SALVOR's `ui/` is rot.js + hand-built SVG; a React shell over `RoomGame` is a rewrite of `ui/app.ts` and the two view mounts | 2 weeks |
| i18n, three languages | `salvor/content/i18n/` | in a rooms-wins game | Extraction has English strings inline; a hex-wins game either drops the languages or adopts the table | — |
| Audio package | `packages/audio` | yes, either way | — | 0 |

Where the architectures fight, and where they do not:

- **They do not fight at the data boundary.** `ShipData` is plain JSON by design
  (`Ship.rehydrate`), `DeckMap` is plain data with two `Map`s. An adapter each
  way is small, and either renderer can draw either world once it has cells.
- **They fight at the turn.** `RoomGame.playerCommand` runs fifteen hooks that
  mutate state, then an energy scheduler runs every machine until the player
  is ready again. `applyCommand` returns a new state and the ship moves on
  `endTurn`. You cannot host a `Twist` in a reducer or a reducer in a `Twist`
  without one of them pretending. A hex-wins game re-implements each SALVOR
  system as a pure `(deck, state) → (state, events)` step; a rooms-wins game
  re-implements Extraction's build loop as a hook. The second is a fraction of
  the first because there is a fraction as much of it.
- **They fight on randomness.** A sequential `Rng` forked per ship and per
  attempt cannot be carried inside an immutable state; a counter rng cannot be
  forked the way `shipgen.ts` forks it. Whichever core wins, the other side's
  generator or reducer adopts its rng.
- **They fight on style, and lint will say so.** Extraction forbids wrapper
  lambdas and duplicate lambda bodies and holds `core/` to 90 % coverage;
  SALVOR is written in arrows and holds itself to invariants over seeds. Code
  moved across is reformatted and re-linted whichever way it goes; the
  repository rule that neither half edits the other stands until someone
  decides otherwise.

## Options

### A. One game, rooms win

SALVOR is the game. After the jam, `vuvko_works` contributes: `deckToShip`, so a
geomorph deck is a hull with the plan drawn under the honeycomb; the node
economy as a `Twist`, replacing the time tick and the muster; the exchange and
the forecast routed through the rack, replacing always-hit; the starve-the-ship
win beside the three systems. The squad question is run as the playtest above
on a lattice hull, and taken only if it wins.

*Costs:* Extraction's reducer, events, React shell and lint discipline are set
aside; ZOC and routes are lost unless the squad wins the playtest; the merged
game inherits CC BY-NC the day it draws a tile. *Gains:* every tested SALVOR
system, the voyage, three languages, a playable game now; and the four
Extraction pieces that matter are pure functions that move in days. Order of
magnitude: three to four weeks after 15 September to a build that plays on a
geomorph deck with nodes and a forecast.

### B. One game, hex wins

Extraction's reducer is the core. SALVOR's rig, doors, noise, alert, ghosts and
voyage are re-implemented as reducer modules with events; the generator is
ported to produce `DeckMap`s on the lattice; the tug is a screen; the languages
come across as a table or not at all.

*Costs:* roughly five thousand lines of tested game logic rewritten into a
different discipline, the energy scheduler dropped for side turns (which changes
what `speed 150` means, and half the machine table with it), and SALVOR's
authors' own consent, which this note cannot assume. Two to three months. *Gains:*
the cleaner architecture — undo for free, animation from events, a state that
is a value; a squad from the start; the only route on which Wesnoth's
positioning survives intact.

### C. Two games sharing a core

Neither loop changes. What is shared is data and pure functions: `ShipData` /
`DeckMap` with an adapter each way and the same door vocabulary (add `sealed`
and `airlock` to Extraction's union, add `isLoop` to SALVOR's `Door`); the hex
lattice as one module with one origin rule; `routeDamage` and `forecast` as a
library both can call; noise propagation as a pure function over an adjacency
list, which `propagateRooms` already is; the taxonomy's `roles` as the room
vocabulary both generators emit. Each game keeps its turn, its UI and its run.

*Costs:* drift, because two games that share a library and not a loop will
diverge on what a door *does*; and two half-games instead of one, which the
repository README already is. *Gains:* nothing has to be decided before the jam
closes; nothing on either side is thrown away; every shared piece is a pure
function, so sharing it is cheap and testable on both sides; and it is the
state the repository can be in on 16 September without anyone having lost a
week.

### Recommendation

**C until the jam closes, then A.** Not because the room graph is the better
model in the abstract — Extraction's design argues well for the 30 ft hex and
the argument stands — but because SALVOR has already built the thing the two
designs agree the hex should be: a lattice where every cell is a compartment
and every door is a shared edge, drawn as a honeycomb, generated with
guarantees and tested over two hundred seeds a class. On that lattice, the
parts of Extraction that are genuinely new to SALVOR (the deck plan under the
map, the node economy, the exchange with a forecast, the starve win) are pure
functions and days of work, while the parts of SALVOR that are new to
Extraction (the voyage, the persistent derelict, the ghost, the ladder) are
thousands of lines of stateful logic and months. The asymmetry decides it.

What A must not do is quietly become "SALVOR with a prettier map". The two
things Extraction should insist on carrying across are the ones SALVOR does not
have and its own design does not argue against: **the pool instead of the time
tick** — material pressure, so waiting costs bodies and not gauge — and **the
forecast** — the whole distribution before committing, which is the one
answer to a hit roll that SALVOR's always-hit rule was a substitute for. If the
squad playtest wins as well, Extraction's tactical floor was not wasted; it
was the experiment that earned two drones a place on SALVOR's honeycomb.
