# Derelict extraction — first draft of the design choices

Turn-based hexagonal tactics inside a generated derelict. Up to three operating
drones, an inventory of one-item slots, hostiles produced by spawner zones fed by
resource nodes you can cut. Wesnoth for the fight, Invisible Inc. for the clock,
Duskers for the fact that you are not there.

Draft 1, 2026-09-09. Every claim about another game is sourced in
[`references/`](references/); this file is only the choices. Decisions are written
as decisions so they can be argued with — a paragraph that says "we could do
either" is not a design.

## Pitch

> Three drones go into a dead ship you have never seen from the inside. You are on
> the tug, reading their sensors. The ship is not empty and it is not neutral: it
> is growing hostiles out of engineering, off the reactor, out of the fuel cells,
> and it grows them faster the longer you are aboard and the louder you are. You
> can kill what it sends — or you can walk into engineering and cut the thing that
> is paying for it, which will cost you the loudest two turns of the run. Then you
> still have to get back to the airlock.

## What each reference is for

| Source | What it supplies | What we do *not* take |
|---|---|---|
| Battle for Wesnoth | Terrain defence, ZOC, the economy-as-territory idea | The leader, the keep, recruiting, the unit zoo |
| Invisible, Inc. | The alarm as an antagonist, and legibility over balance | The 72-hour campaign, for now |
| The extraction genre | Extraction as a declared second objective; gear fear | PvP, and every mitigation that depends on other humans |
| Spawner economies | Node-fed spawn budgets, cut-offs, telegraphing | Anything that scales with the player's loot |
| Duskers | Drone loss as resource loss; sensors that lie | Friction in the interface itself |

---

## The decisions

### 1. Space: room-scoped hex fields, doors as the only seams

A mission is six to ten **compartments** taken from the `hexmap.html` export, not a
whole deck. Each compartment is a small local hex field at roughly 10 ft, twenty to
thirty hexes. Compartments connect only through **doors**, which are already
first-class objects in the export with a state and a `loop` flag.

Rejected: a single deck-wide hex grid at combat resolution (thousands of hexes for
three drones), and a pure room graph with no hexes (throws away flanking, facing
and every reason to have a grid at all).

Why it works: the generators' own principle — *the rooms are the map, the hexagons
are guidance* — stays true at the strategic scale, while the hexes get to be a real
tactical grid at the scale where a firefight happens. It also sits in the
Traveller deck-plan lineage rather than being a novel bet.

**A door costs most of a turn to cross, and one body blocks it.** If a door is one
move point it is a hallway, not a chokepoint. Doors are therefore the natural home
of overwatch, the natural place to lose a drone, and — because `loop` tells us
which doors are not load-bearing — the natural place for the player to *weld the
ship shut behind them*. That last verb only exists because the generator already
computed which corridors the level can survive losing.

### 2. Terrain comes from the taxonomy, not from an author

`hexmap.html` already gives every room a `kind`, a set of `roles`, an open-floor
share, and a one-in-seven `hazard`. That is a terrain table we did not have to
write:

| From the export | Tactical meaning |
|---|---|
| Open-floor share | Defence %. A hex that is 40% ink is full of consoles: cover |
| `roles: green` | Hydroponics — line of sight broken, defence high, movement slow |
| `roles: drive` | Loud. Noise from here does not carry; nothing hears you either |
| `roles: vertical` | A shaft. The only link between decks and therefore the most contested hex on any map that has one |
| `hazard` | Terrain that hurts, already placed at a rate someone tuned |
| `sealed` | A room with no door: treasure behind a wall, to be cut into or left |

Defence is **the defender's hex only**, as in Wesnoth. No attacker's-high-ground
rule, no facing bonus. One number per (drone, terrain) pair, and at three drones
that table fits on a card.

Damage-type resistance: **two types at most, or none.** The reference is clear that
a full matrix turns a tactics game into a spreadsheet, and we have three units.

### 3. Zone of control, and one drone that ignores it

Port ZOC unchanged: ending a move adjacent to a hostile stops you. Drop Wesnoth's
level ≥ 1 exception, since we have no chaff. This single rule is what turns the hex
field into a game about lines and flanks instead of kiting, and it costs almost
nothing.

Exactly one of the three drone chassis is a **skirmisher** and ignores it. That is
its whole identity and it is enough of one.

### 4. Enemies are grown, not placed

Every spawner zone has a **budget** per turn. The budget is the sum of the output of
the **resource nodes** currently feeding it. Nodes are placed by a pass that reads
`roles` — the reactor pays for things, the fuel cells pay for things, the
fabricator pays for things — so the economy is legible from the deck plan before
anyone explains it.

Four rules, each taken from a specific precedent:

1. **Telegraph one full turn ahead.** A spawn hex is marked, with what is coming
   and where it intends to go, before it exists. (Into the Breach.)
2. **Cutting a node stops its contribution instantly and completely** — same tick,
   no decay curve, flagged on the map. Severing supply should be a turn-defining
   strike, not a slow bleed. (Company of Heroes, over Dawn of War.)
3. **But attacking a node raises local pressure while you work on it.** Killing a
   node takes a turn or two, and during them the zone spawns *harder*. Front-loaded
   risk, back-loaded total reward. (Doom Eternal's gore nests.) This is what stops
   "cut every node on turn one" from being strictly dominant.
4. **A global heat meter sits over the per-node maths and is allowed to fall.**
   Peaks and valleys, not a monotone ramp — the L4D Director deliberately backs off
   after a hard fight. Per-node budgets alone give you Nex Machina's illegible pile
   of uncoordinated timers.

**And one prohibition, which is the loudest lesson in the research:**

> **Spawn pressure must never scale with the loot you are carrying.**

RimWorld ties raid strength to colony wealth and the documented player response is
to avoid accumulating wealth — to export it, disassemble it, mod it out. In a game
whose entire objective is to pick things up, that failure mode is fatal. Pressure
comes from nodes, from noise, and from turns. Never from the bag.

### 5. The alarm: six bands, a diegetic driver, and no two bands alike

Six visible levels, sub-ticked underneath. Not twenty. The reason is on the record:
Klei collapsed thirty levels to six because consequences have to be predictable
enough to plan against, and *"our goal was not to make the alarm levels balanced…
our goal was to create movie-like tension and drama above all else."* Legibility
outranks balance.

The driver is **the ship waking up**, not a security company — power routing back
through dead sections, pressure doors re-arming, the reactor coming off standby. It
should read as physically caused.

It rises with: turns elapsed; **noise**, per action, with loud actions costing
much more than quiet ones; destroying a hostile in a way that leaves wreckage; and
working on a node.

Each band must do a **different kind** of thing, following Invisible Inc.'s ladder
rather than adding bodies five times:

| Band | What changes |
|---|---|
| 1 | Sensors come back: hostiles start knowing roughly where you are |
| 2 | Doors re-arm — cutting and forcing gets more expensive. Taxes your tool economy directly |
| 3 | A new spawner zone comes online |
| 4 | Compartments start venting. Terrain itself turns against you |
| 5 | Something that was inert stands up |
| 6 | The ship stops treating the airlock as yours |

### 6. Extraction is a second objective, not the absence of one

Getting the thing and getting out are two separate win conditions. The exit is the
`entry` airlock the map already marks.

**And the extraction point heats up once you call it.** Helldivers 2's trick —
calling the dropship starts a timer *and* actively pulls threat toward the fixed
point you must stand on — is exactly right for a turn-based game, because it turns
the last five turns into the climax instead of a walk home. "Call it and loot one
more room" must be a real gamble.

### 7. Inventory: two tiers, one item per slot, and loot competes for the same slots

Per drone: **one permanent slot** (the chassis' fitted system, changed between
missions, rarely) and **two mission slots**, chosen before launch.

- Every item is some combination of weapon / tool / consumable. The welder is the
  design's thesis statement and it obeys the billhook rule: **a dual-purpose tool
  must be visibly worse in a fight than a dedicated weapon.** If the welder is a
  fine gun, nobody ever carries a gun.
- **No duplicate categories across the squad.** XCOM 2's hard type-exclusion,
  applied at squad level, is what forces three different drones instead of three
  copies of the best one.
- **Loot occupies mission slots.** Not a separate bag, not a weight number. The
  moment where you have to put down the cutter to carry the thing you came for is
  the whole game in one decision, and it is only available if loot and tools
  compete for the identical slot.
- **Charges are small integers and refill between missions.** No durability
  spreadsheet. In-mission counts are the only live decision.
- **Keep the catalogue small.** One item per slot produces decisions only if every
  item is genuinely different; five grades of repair kit smuggle the spreadsheet
  back in through catalogue depth.

### 8. What is lost when a drone is lost

A destroyed drone's inventory is **gone permanently** — Mordheim's rule, which is
what makes a loadout choice weigh anything at all — *unless the other two reach the
wreck and carry it out*, spending their own slots to do it.

That is a secondary objective that appears exactly when the player can least afford
it, it is on-theme, and it is a self-inflicted version of Tarkov's insurance
(where whether you get your rifle back depends on your killer's behaviour). Here it
depends on your own greed.

The drone chassis itself is **recoverable at a cost between missions**, not
permanently dead. Invisible Inc.'s captured agents are guaranteed to reappear as
the next rescue target; capture costs tempo and a build, not the run. At three
units, hard permadeath on a bad turn is a death spiral we have no economy to absorb.

### 9. Information: informed dread

Be **transparent about mechanics, opaque about position.** This is Mothership's
stated philosophy and Alien: Isolation's practice, and they agree: the fear is
knowing exactly what will happen and having no good option, not being denied the
numbers.

So: once a hostile is observed, its stats, its reach and its intent are fully
visible. What is hidden is *where things are*.

- Sensors report **direction and radius**, not a hex, until something is actually
  seen.
- A sensor does not register something that has stopped moving.
- **An active scan is loud.** Using the thing that tells you where they are tells
  them where you are.
- Peeking through a door costs the same currency as moving, so information is
  bought with tempo — Invisible Inc.'s single best economy.

The friction lives in the drone's *senses*, never in the interface. Duskers'
command line is admired for what it conveys and criticised for typos being
punished; take the first half only.

### 10. Randomness

At three drones, one bad roll costs a third of the squad, so Wesnoth's independent
per-strike Bernoulli is riskier here than it is there. Three things, in order:

1. **Decompose damage into several small strikes.** Four hits of 4 rather than one
   of 16. This is Wesnoth's own variance lever and it does most of the work.
2. **Show the full outcome distribution before committing.** Cheap to compute at
   this scale, and it addresses the "feels rigged" problem directly even when the
   odds are untouched.
3. **Seed deterministically per turn.** Undo, replay and a shareable seed all
   depend on it — and in this repository a seed is already the thing you send
   someone.

Whether hit/miss survives at all is question B below.

---

## Open questions — the ones that need a decision, not more reading

**A. One alarm or one per zone?** A single ship-wide counter is simpler and
directly copies a proven design. Per-compartment counters let you say "these three
rooms are getting worse while I finish this one", which is more interesting on a
hex map and risks becoming three clocks to babysit. *Leaning: one global band, plus
a purely local, visible "this zone is agitated" state that decays.*

**B. Hit/miss, or deterministic damage?** The "no randomness" approach — every
attack lands for expected-value damage, so 10 damage into 60% defence always deals
4 — keeps terrain and resistance meaningful while removing the run-ending swing.
Against: bluffing, tension, and the joy of a 30% that lands. *Leaning:
deterministic for the drones' own damage, random for the ship's — the player plans,
the derelict surprises. This is untested and is the first thing to prototype.*

**C. Does the campaign exist yet?** A 72-hour-style macro clock over several
derelicts, with upgrade stops and recovery missions, reproduces the "always
slightly behind" pacing. But half-importing it — permanent upgrades and no clock —
removes exactly the pressure that made it work. *Leaning: build one derelict first
and decide nothing about the meta until that fight is good.*

**D. Overclock, yes or no?** Alien RPG's Stress Dice and Death in Space's Void
Points are a ratchet of escalating commitment that ports cleanly: push a drone's
sensors, weapon or speed for a turn against an accumulating malfunction meter. It
is thematically perfect and it may fight the calm, deliberate pacing that makes
turn-based tactics readable.

**E. How much of the node economy is visible?** Full transparency risks making
source-versus-symptom a solvable optimisation rather than a tense call. Some fog
over remaining capacity may be right — but it contradicts decision 9's transparency
rule, so if we fog it, fog it *diegetically*: you can see a node and what it feeds
only once a drone has physically read a terminal in that compartment.

**F. What replaces the human opponent?** The sharpest unsolved problem in the
research. PvE extraction modes lose the adversarial read — another crew racing you
to the same exit — and more monsters do not restore it. The three partial answers
are: tie escalation to *player action* so the opponent is reactive rather than a
clock; telegraph escalation ruthlessly, because an illegible threat reads as unfair
rather than tense; and consider a director that adapts per compartment to how you
are actually playing. None is a solved answer. It deserves prototyping before we
commit.

---

## The smallest thing worth building

One compartment. Three drones, three hostiles, one spawner zone, two resource
nodes, one door out, hexes at 10 ft read from a real `hexmap.html` export.

It answers, in this order:

1. Does a hex fight between three and a handful read at all at this scale?
2. Is cutting a node ever the right call, and does the alarm spike while you cut
   make it a *choice*?
3. Does putting a tool down to pick loot up hurt in the way it should?

If those three are yes, everything else in this document is tuning. If the first is
no, the whole hex/room split in [`substrate.md`](substrate.md) is wrong and the
right answer was the room graph all along.
