# Derelict extraction — the design choices

Turn-based hexagonal tactics inside a generated derelict. Up to three operating
drones, an inventory of one-item slots, hostiles produced by spawner zones fed by
resource nodes you can cut — or take. Wesnoth for the fight, Invisible Inc. for the
clock, Duskers for the fact that you are not there.

Draft 2, 2026-09-10. Every claim about another game is sourced in
[`references/`](references/); this file is only the choices. Decisions are written
as decisions so they can be argued with — a paragraph that says "we could do
either" is not a design.

Changed since draft 1: the hex is 30 ft and the deck is one field (§1), which is
what lets Wesnoth's adjacent-only attack model stay exactly as it is (§2); nodes
have two verbs instead of one (§5); and **the alarm is driven by noise alone and can
be pushed back down** (§6).

## Pitch

> Three drones go into a dead ship you have never seen from the inside. You are on
> the tug, reading their sensors. The ship is not empty and it is not neutral: it
> is growing hostiles out of engineering, off the reactor, out of the fuel cells,
> and it grows them faster the louder you are. You can kill what it sends — or walk
> into engineering and take the thing that is paying for it, quietly if you have the
> patience and the right tool, loudly if you do not. Then you still have to get back
> to the airlock.

## What each reference is for

| Source | What it supplies | What we do *not* take |
|---|---|---|
| Battle for Wesnoth | Terrain defence, ZOC, adjacent-only attacks, capture-not-destroy, economy-as-territory | The leader, the keep, recruiting, the unit zoo |
| Invisible, Inc. | The alarm as an antagonist, legibility over balance | Its one-way ratchet; the 72-hour campaign, for now |
| The extraction genre | Extraction as a declared second objective; gear fear | PvP, and every mitigation that depends on other humans |
| Spawner economies | Node-fed spawn budgets, cut-offs, telegraphing | Anything that scales with the player's loot |
| Duskers | Drone loss as resource loss; sensors that lie | Friction in the interface itself |

---

## The decisions

### 1. The hex is 30 ft, and the deck is one field

**A hex is a compartment-sized chunk of ship, or a stretch of corridor.** Not a
floor tile. 30 ft by default; 35 is equally defensible and the overlay size is a
control on the page, so this is a tuning number rather than an architectural one.

The argument is about combat, not about space, and it runs the opposite way from
what it first looks like. **The hex is large so that adjacency is a believable
engagement distance.** At 10 ft, attacking only an adjacent hex means a rifle with a
ten-foot reach, which is absurd on sight. At 30 ft, two adjacent hex centres are
thirty feet apart — a completely ordinary distance to shoot someone across a
compartment or down a short run of corridor. The geometry stops fighting the
fiction, and Wesnoth's combat model can be kept whole (§2).

30 ft is also finer than `hexmap.html`'s 50 ft default, which matters for the reason
in the footnote below.

Consequences, none of them optional:

- **No per-compartment sub-grids.** At 30 ft a hex (~780 sq ft) is larger than most
  rooms in the export, whose threshold for being a room at all is 80 sq ft. Cutting
  the deck into local fields would cut it below the resolution of its own atoms.
- **Rooms overlay the lattice; they do not contain it.** A hex knows which rooms it
  covers (`over`), their trades, and what is in them. Rooms are identity and
  content. The lattice is position.
- **Doors are edges, which is how the generator already builds them.** A door lies
  *on* the lattice edge two hexes share, so it is a property of a *move*, not an
  object standing in a hex. That is precisely what a chokepoint should be.

> **Footnote to watch.** `hexmap.html:530` notes that two rooms touching only inside
> a single hexagon have no lattice edge between them and therefore no door. Coarser
> hexes swallow more doors. The mission generator must **count the doors it loses
> and say so** — the way the tile placer counts forced placements — rather than
> letting a compartment quietly become unreachable.

### 2. Attacks stay adjacent-only, exactly as in Wesnoth

**No weapon ranges in hexes. No firing lanes down a corridor. You attack a
neighbour.** This is the whole reason the hex is 30 ft, and taking the hex size
seriously means taking the consequence seriously: the model comes across unchanged.

**"Ranged" keeps its Wesnoth meaning — a weapon class that avoids the counter, not
one that reaches further.** That distinction is doing more work than extra reach ever
would:

- A drone attacks an adjacent hostile with a boarding weapon (cutter, ram) or a
  ranged one (sidearm, carbine). Either way, one hex.
- **The defender strikes back only with a weapon of the same class.** Shoot something
  that has nothing but a cutting arm and it cannot answer you at all. Close on
  something with a sidearm and it answers every time.
- So a drone carrying only tools — welder, cutter, prybar — is a drone that can be
  shot at with impunity. **That is the inventory's teeth** (§9): the squad's slot
  budget has to buy an answer to being shot, and every slot spent on an answer is a
  slot not spent on the job you came to do.

What this buys us is large and mostly negative, in the good sense:

- **No line-of-fire raytracing.** [`substrate.md`](substrate.md) called line of sight
  the biggest missing piece in the pipeline. For *combat* it is no longer needed at
  all — adjacency is the test, and the lattice already knows adjacency. That deletes
  the single most expensive thing the design was going to demand.
- **The ink still matters, just not for shooting.** Open-floor share is cover (§3);
  a bulkhead is a lattice edge without a door, so it blocks movement; hazards are
  hazards. The artwork governs where you can *stand and walk*, which is exactly what
  the rasteriser was built to answer.
- **A corridor is a chokepoint, not a firing lane.** One hex wide means one hex can
  be attacked from, and ZOC (§4) makes holding it real. That is Wesnoth's actual
  geometry and it works.

Line of sight still has a job, but a different and much cheaper one: **knowing where
things are** (§11), at room granularity rather than per-ray. What a drone can *see*
is a sensor question. What it can *hit* is an adjacency question. Keeping those two
apart is what keeps the whole thing buildable.

### 3. Terrain comes from the taxonomy, not from an author

`hexmap.html` already gives every room a `kind`, a set of `roles`, an open-floor
share, and a one-in-seven `hazard`. That is a terrain table we did not have to
write:

| From the export | Tactical meaning |
|---|---|
| Open-floor share | Defence %. A hex that is 40% ink is full of consoles: cover |
| `roles: green` | Hydroponics — line of fire broken, defence high, movement slow |
| `roles: drive` | Loud. Noise from here does not carry; nothing hears you either |
| `roles: vertical` | A shaft. The only link between decks, and so the most contested hex on any map that has one |
| `hazard` | Terrain that hurts, already placed at a rate someone tuned |
| `sealed` | A room with no door: treasure behind a wall, to be cut into or left |

Defence is **the defender's hex only**, as in Wesnoth. No attacker's-high-ground
rule, no facing bonus. One number per (drone, terrain) pair, and at three drones
that fits on a card.

Damage-type resistance: **two types at most, or none.** A full matrix turns a
tactics game into a spreadsheet, and we have three units.

### 4. Zone of control, and one drone that ignores it

Port ZOC unchanged: ending a move adjacent to a hostile stops you. Drop Wesnoth's
level ≥ 1 exception, since we have no chaff. At 30 ft this reads exactly right — you
cannot stroll past something standing in a corridor.

Exactly one of the three chassis is a **skirmisher** and ignores it. That is its
whole identity and it is enough of one.

### 5. Nodes have two verbs: cut it, or take it

Every spawner zone has a **budget** per turn, equal to the summed output of the
**resource nodes** feeding it. Nodes are placed by a pass reading `roles` — the
reactor pays for things, the fuel cells pay for things, the fabricator pays for
things — so the economy is legible off the deck plan before anyone explains it.

The player has **two ways to take a node off the enemy's books, and they sit at
opposite ends of the noise axis.** This is the spine of the game.

| | **Cut it** | **Take it** |
|---|---|---|
| What happens | Node destroyed, permanently | Node changes hands and keeps producing — for you |
| Time | A turn or two | Longer, and you must hold the hex while you work |
| Noise | Very loud. **Local pressure spikes while you work** | Quiet |
| Reversible | No | **Yes — the ship can come and take it back** |
| Ancestor | Doom Eternal's gore nests | Wesnoth's villages |

Cutting is the panic button and the clean answer: instant, total, same-tick removal
of that node's contribution, flagged on the map — Company of Heroes' supply cut-off
rather than Dawn of War's decay curve, because severing supply should be a
turn-defining strike rather than a slow bleed. The price is that you spend the two
loudest turns of the run doing it, and the zone spawns *harder* while you do. That
front-loaded risk is what stops "cut every node on turn one" from being strictly
dominant.

Taking is the patient answer, and it is the one that pays. A held node feeds *your*
side — repairs, charges, a place to work from — which is the Wesnoth village's real
lesson: the tile is worth fighting over because it does four jobs at once. And
because the ship can retake it, holding is an ongoing commitment of bodies you only
have three of.

Two more rules on top, each from a specific precedent:

- **Telegraph one full turn ahead.** A spawn hex is marked, with what is coming and
  roughly where it intends to go, before it exists. (Into the Breach.)
- **A global heat meter sits over the per-node maths and is allowed to fall.** Peaks
  and valleys, not a monotone ramp — the L4D Director deliberately backs off after a
  hard fight. Per-node budgets alone give you Nex Machina's illegible pile of
  uncoordinated timers.

### 6. The alarm is made of noise, and only noise

**The alarm never sees your loot.** Not its value, not its weight, not its count.

This is the loudest lesson in the research and it is not a matter of taste. RimWorld
ties raid strength to colony wealth, and the documented player response is to refuse
to accumulate wealth — exporting it by caravan, disassembling valuables, modding the
mechanic out. In a game whose whole objective is picking things up, that failure
mode is fatal.

**What raises it is noise, and noise is something you chose to make**: weapons fire,
destroying a hostile in a way that leaves wreckage, cutting a door, cutting a node,
an active scan, forcing a lock. Every action carries a loudness, and the quiet path
through a compartment always exists — it is just slower, and slower has its own
price (§7).

**And the alarm comes down.** Hacking a security node lowers it. This is a real
departure from Invisible Inc., whose alarm is a strict one-way ratchet, and it is
the better design *for this game*: it makes the ship's alert state a **resource with
two directions** rather than a countdown, so going quiet is a strategy rather than a
delaying tactic, and it gives the patient player something to actually do with their
patience.

Guard rails, so it does not become a grind-the-clock-down loop:

- Security nodes are **few** — two or three on a map — and each is spent when used.
- One node buys back **one full band**, not a trickle. It is a decision, not a dial.
- A security node is a *place*, deep and defended, so the trip costs you what the
  band was worth.

Six visible levels, sub-ticked underneath. Not twenty. The reason is on the record:
Klei collapsed thirty to six because consequences must be predictable enough to plan
against, and *"our goal was not to make the alarm levels balanced… our goal was to
create movie-like tension and drama above all else."* Legibility outranks balance.

The driver is **the ship waking up** — power routing back through dead sections,
pressure doors re-arming, the reactor coming off standby. It should read as
physically caused, not as a security company being annoyed.

Each band does a **different kind** of thing, following Invisible Inc.'s ladder
rather than adding bodies five times:

| Band | What changes |
|---|---|
| 1 | Sensors come back: hostiles start knowing roughly where you are |
| 2 | Doors re-arm — cutting and forcing get more expensive. Taxes your tool economy directly |
| 3 | A new spawner zone comes online |
| 4 | Compartments start venting. Terrain itself turns against you |
| 5 | Something that was inert stands up |
| 6 | The ship stops treating the airlock as yours |

### 7. What punishes waiting, now that the alarm does not

Making the alarm purely noise-driven removes the anti-turtling clock, and that clock
was load-bearing: Klei's whole reason for the passive tick is that a
perfect-information tactics game with peek tools degenerates into unbounded analysis
without an external ramp.

**The answer is the spawn budget, not the alarm.** Nodes accrue every turn whether
or not anyone hears you. Sitting still costs you nothing in alert level and
everything in what is now standing between you and the airlock. The pressure is
*material* rather than *procedural*, which is more on-theme anyway: the ship is not
getting angrier, it is getting more numerous.

Backed by an **early-finish bonus** — Wesnoth's cheapest anti-grind lever, and here
it is thematically free, because the reason to leave a derelict early is the reason
anyone leaves a derelict early.

### 8. Extraction is a second objective, not the absence of one

Getting the thing and getting out are two separate win conditions. The exit is the
`entry` airlock the map already marks.

**And the extraction point heats up once you call it.** Helldivers 2's trick —
calling the ride starts a timer *and* actively pulls threat toward the fixed point
you must stand on — is exactly right for a turn-based game, because it makes the
last five turns the climax rather than a walk home. "Call it and loot one more room"
has to be a real gamble.

### 9. Inventory: two tiers, one item per slot, and loot competes for the same slots

Per drone: **one permanent slot** (the chassis' fitted system, changed between
missions, rarely) and **two mission slots**, chosen before launch.

- Every item is some combination of weapon / tool / consumable. The welder is the
  design's thesis statement and it obeys the billhook rule: **a dual-purpose tool
  must be visibly worse in a fight than a dedicated weapon.** If the welder is a fine
  gun, nobody ever carries a gun.
- **No duplicate categories across the squad.** XCOM 2's hard type-exclusion applied
  at squad level is what forces three different drones instead of three copies of the
  best one.
- **Loot occupies mission slots.** Not a separate bag, not a weight number. Putting
  the cutter down to carry what you came for is the whole game in one decision, and
  it exists only if loot and tools compete for identical slots.
- **Charges are small integers and refill between missions.** No durability
  spreadsheet; in-mission counts are the only live decision.
- **Keep the catalogue small.** One item per slot produces decisions only if every
  item is genuinely different. Five grades of repair kit smuggle the spreadsheet back
  in through catalogue depth.

Note how this meshes with §5 and §6: cutting a node needs the loud tool, taking one
needs the quiet tool, and hacking a security node to buy back a band needs a third.
**You cannot carry all three answers.** The loadout is a prediction about which kind
of run this will be.

### 10. What is lost when a drone is lost

A destroyed drone's inventory is **gone permanently** — Mordheim's rule, which is
what makes a loadout choice weigh anything — *unless the other two reach the wreck
and carry it out*, spending their own slots to do it. A secondary objective that
appears exactly when you can least afford it, and a self-inflicted version of
Tarkov's insurance: there, whether you get your rifle back depends on your killer's
behaviour; here it depends on your own greed.

The chassis itself is **recoverable at a cost between missions**, not permanently
dead. Invisible Inc.'s captured agents are guaranteed to reappear as the next rescue
target; capture costs tempo and a build, not the run. At three units, hard
permadeath on one bad turn is a death spiral we have no economy to absorb.

### 11. Information: informed dread

Be **transparent about mechanics, opaque about position.** Mothership's stated
philosophy and Alien: Isolation's practice agree: the fear is knowing exactly what
will happen and having no good option, not being denied the numbers.

Once a hostile is observed, its stats, reach and intent are fully visible. What is
hidden is *where things are*.

- Sensors report **direction and radius**, not a hex, until something is seen.
- A sensor does not register something that has stopped moving.
- **An active scan is loud** — and by §6 that means it raises the alarm. The thing
  that tells you where they are tells them where you are, and now it does so through
  the same mechanic as everything else.
- Peeking through a door costs the same currency as moving, so information is bought
  with tempo — Invisible Inc.'s single best economy.

The friction lives in the drone's *senses*, never in the interface. Duskers' command
line is admired for what it conveys and criticised for punishing typos; take the
first half only.

### 12. Randomness

At three drones, one bad roll costs a third of the squad, so Wesnoth's independent
per-strike Bernoulli is riskier here than there. Three things, in order:

1. **Decompose damage into several small strikes** — four hits of 4 rather than one
   of 16. Wesnoth's own variance lever, and it does most of the work.
2. **Show the full outcome distribution before committing.** Cheap at this scale, and
   it addresses "feels rigged" directly even when the odds are untouched.
3. **Seed deterministically per turn.** Undo, replay and a shareable seed depend on
   it, and in this repository a seed is already the thing you send someone.

Whether hit/miss survives at all is question B below.

---

## Open questions

**A. One alarm or one per zone?** A single ship-wide counter is simpler and copies a
proven design. Per-compartment counters let you say "these three rooms are getting
worse while I finish this one", which is more interesting on a hex map and risks
becoming three clocks to babysit. *Leaning: one global band, plus a purely local,
visible "this zone is agitated" state that decays — which is also where a cut node's
pressure spike lives.*

**B. Hit/miss, or deterministic damage?** The "no randomness" approach — every attack
lands for expected-value damage, so 10 damage into 60% defence always deals 4 — keeps
terrain and resistance meaningful while removing the run-ending swing. Against it:
bluffing, tension, and the joy of a 30% that lands. *Leaning: deterministic for the
drones, random for the ship — the player plans, the derelict surprises. Untested, and
the first thing to prototype.*

**C. Does the campaign exist yet?** A 72-hour-style macro clock over several
derelicts reproduces the "always slightly behind" pacing, but half-importing it —
permanent upgrades and no clock — removes exactly the pressure that made it work.
*Leaning: build one derelict first and decide nothing about the meta until that fight
is good.*

**D. Overclock, yes or no?** Alien RPG's Stress Dice and Death in Space's Void Points
port cleanly: push a drone's sensors, weapon or speed for a turn against an
accumulating malfunction meter. Thematically perfect; may fight the calm, deliberate
pacing that makes turn-based tactics readable. *Note it now interacts with §6 — the
obvious cost of an overclock is noise, which makes it a fourth way to spend the
alarm.*

**E. Can a taken node be used to lower the alarm too, or only a security node?** §5
gives held nodes a payoff and §6 gives security nodes a unique one. If a held reactor
node also quietens the ship, the two systems collapse into one and the security node
stops being special. *Leaning: keep them distinct — nodes pay in materiel, security
nodes pay in silence.*

**F. What replaces the human opponent?** The sharpest unsolved problem in the
research. PvE extraction modes lose the adversarial read — another crew racing you to
the same exit — and more monsters do not restore it. Three partial answers: tie
escalation to *player action* so the opponent is reactive rather than a clock (which
§6 now does completely); telegraph ruthlessly, because an illegible threat reads as
unfair rather than tense; and consider a director that adapts per compartment to how
you are actually playing. None is solved. Prototype before committing.

---

## The smallest thing worth building

One compartment cluster off a real `hexmap.html` export at 30 ft. Three drones,
three hostiles, one spawner zone, two resource nodes, one security node, one door
out.

It answers, in this order:

1. **Does a 30 ft hex read as a place?** A hex covers a chunk of ship and part of
   another — the inspector already reports what it covers and in what proportion. If a
   player cannot tell what standing there means, the size is wrong and 35 or 25 is the
   knob to turn first. This is a rendering problem as much as a rules problem.
2. **Does adjacent-only combat feel right at that size?** It should read as fighting
   across a compartment, not as fencing. If it reads as fencing, the hex needs to be
   bigger before anything else is considered.
3. Is the cut-it/take-it choice ever genuinely close, and does the pressure spike
   while cutting make it a decision rather than a formality?
4. Is spending a trip to a security node to buy back a band ever worth it?
5. Does putting a tool down to pick loot up hurt the way it should?

If (2) is no, the answer is a larger hex, not a range stat. Adding ranges is the
change that quietly turns this into a different and much more expensive game.
