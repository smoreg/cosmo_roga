# The machinery — what the budget buys, and what it locks

Draft 1, 2026-09-12. A plan, not an implementation. Prices are first guesses in
a single currency; the structure is the part to argue with.

[`rscore.md`](rscore.md) says capacity is summed from the rooms and spent during
placement. [`alert-and-age.md`](alert-and-age.md) says what the ship does while
you are aboard. This says **what is actually in the rooms**, what it costs, and
how the pieces lock each other — Cogmind's machine vocabulary, arranged the way
Duskers arranges a derelict, as a thing you have to open before you can use it.

---

## 1. One currency, and it is the spawn pool

Everything is priced in the units the ship already spends on bodies — **scout 6,
sentinel 11, hunter 15**. That keeps the exchange rate honest: a thing costs
what it costs *in hunters*, and nobody has to reason about an abstract point.

| Thing | Price | Acts? | Verb |
|---|---|---|---|
| **Resource node** | 20 | no — funds | cut · hack · sever |
| **Spawn zone** | 40 | yes | destroy |
| **Camera** | 2 | triggers once | disable · hack |
| **Turret** | 11 | every turn | destroy · hack |
| **Security node** | −/25 | no | hack (spent) |
| **Data centre** | 15 | no | hack |
| **Production node** | 30 | no | hack, then feed |
| **Repair node** | 20 | no | use (limited) |
| **Reactor** | guaranteed, 0 | no | route power |

The camera-to-turret ratio is Pathfinder's 5:1 for simple against complex
hazards, applied to our own numbers: a camera fires once when tripped, a turret
takes a turn every round.

**Everything below the line is relief and is bought from the same pool at a
positive price**, per [`rscore.md`](rscore.md) §3. A repair node genuinely does
cost the ship one sentinel and change, and that is the intended feel: a derelict
that was well found is a derelict that could not afford a garrison.

---

## 2. Spawn zones and nodes are one purchase, not two

**Decision: a spawn zone and the nodes that feed it are bought together as a
single item — a _plant_ — and priced as one.**

This is the direct answer to how placement affects the budget, and it is also
the fix for two of the four degenerate missions we have actually generated.
Neither half is worth anything alone: a spawn zone with no income never builds,
and nodes with no spawn zone fund nothing. Buying them separately is what let
the generator produce **a ship with seven nodes and no spawn zone**, and another
with a spawn zone and three nodes it could not reach.

A plant is:

```
plant = one spawn zone + 1..4 nodes, all mutually reachable
price  = 40 + Σ (20 × seclusion(node))
```

Which means **the generator cannot buy a spawner it cannot feed, and cannot buy
income with nothing to spend it on.** The anti-degeneracy rules in
[`rscore.md`](rscore.md) §9 stop being checks bolted on afterwards and become
properties of the thing being purchased — which is what §6 of that document
asked for: spend by construction, never validate after.

### Price the integral, not the object

A node yields 1 materiel a turn for as long as it stands. Over a forty-turn
mission that is forty materiel — about six scouts, or **forty points of future
hostiles from a twenty-point purchase.** Production is priced by its integral
and therefore dwarfs everything else on the list, which is exactly the warning
in [`rscore.md`](rscore.md) §4 made concrete.

Two consequences, both deliberate:

- **The mission-type proportions must cap production**, or every ship is a node
  farm and nothing else. This is what the named shapes are for.
- **Cutting a node early is worth enormously more than cutting one late**, which
  is the tension the whole design is built on and the prototype's balance sweep
  already confirmed — at income ≥ 0.75/node, cutting wins and rushing the
  spawners loses sixteen times out of sixteen.

### The third verb: sever

Nodes currently have two verbs — cut it (loud, instant) or take it (quiet,
slow). Income has to *travel*, and the ship is a graph of doors.

**A node funds a spawn zone only while a path exists between them.** Shut the
door on the corridor between engineering and the bays and the bays stop paying,
without a shot fired and without touching the node. The ship can reopen it; that
costs the ship a turn and tells you it is trying.

That is Wesnoth's village economy read through Company of Heroes' cut-offs —
both already written up in
[`references/spawner-economies.md`](references/spawner-economies.md) — and it
gives a crew with no tools and no noise budget something to do. It also makes
the plant's *shape* matter: a plant whose nodes all sit behind one door is cheap
for the ship and fragile; one with four independent routes is expensive and
robust. **Pay for the topology, not just the parts.**

*Leaning: build it.* It is the verb that makes doors interesting, and doors are
the thing the whole map is made of. The risk is that severing trivialises the
economy; the guard is that the ship repairs links, loudly.

---

## 3. Seclusion prices position

[`rscore.md`](rscore.md) §7 borrows Cogmind's **seclusion** — a room's distance
from the fastest route between the boarding point and the way out. Here is what
it is for.

**Decision: seclusion multiplies a threat's price up and a relief's price down.**

| | On the boarding route | Four rooms off it |
|---|---|---|
| Resource node | × 0.75 | × 1.5 |
| Spawn zone | × 0.8 | × 1.3 |
| Repair node, cache | × 1.25 | × 0.6 |

A node you walk past is a node you will cut, so it is a weak asset and should
cost the ship less. A node four compartments off the path funds the ship for the
whole mission unless you make a special trip, so it is a strong asset and costs
more. Relief inverts exactly: a repair node by the airlock is worth having, one
buried at the far end of a dying ship may never be reached.

This is not a difficulty knob. It is the same object priced by what it will
actually do, and it makes the generator prefer to hide the things that matter —
which is the behaviour we want and would otherwise have to fake.

---

## 4. Power is the lock, and you and the ship share it

This is Duskers' contribution and the spine of the whole thing.

**Most machinery is inert until its section has power.** The reactor is
guaranteed on every hull and costs nothing, because a derelict without one is
not a derelict, it is a hulk. It has a **power budget smaller than the number of
sections** — first guess, enough for about half — and a terminal where you
choose the routing.

Powering a section:

- brings its **data centre, production node, repair node and security node**
  online — none of them work cold;
- brings its **doors** under control, so they can be opened and closed rather
  than forced;
- and brings its **turrets, cameras and spawn zones** online too.

**That last line is the whole design.** The lights you need are the lights the
ship needs. Turning on engineering to print a tool is also turning on the thing
that builds hunters in engineering. There is no version of this where you take
the good half.

And it settles what the loudest action in the game is.
[`derelict-extraction.md`](derelict-extraction.md) §6 says the alarm should read
as *the ship waking up* — power routing back through dead sections. It should
therefore be the most expensive thing on the influence list, well above cutting
a node. *First guess: 25 influence to bring a section up.* You are not sneaking
past the ship; you are switching it on.

### Dormant purchases — the generator buys cheap, you complete the sale

**Decision: a threat placed in an unpowered section is bought at a fraction of
its price, because it may never act.** *First guess: one third.*

The generator can therefore afford to seed a Cold hull with far more machinery
than its capacity would otherwise allow, because most of it is asleep — and
**the player decides how much of it wakes up.** A spawn zone bought for 13 in a
dark section becomes a 40-point spawn zone the moment you need the fabricator
next door.

Nothing in the survey does this. It falls straight out of combining Duskers'
power routing with a budget, and it is the most interesting thing in this
document: **the budget's cheapest purchases are the ones the player pays for
later.**

---

## 5. The machinery, and what each one is for

Cogmind's rule is that a machine is worth having because of what it *tells you*
or *makes you*, not because it is a pickup. Each of ours has one job and one
failure mode.

**Data centre.** Reveals the deck: which sections hold what, where the plants
are, where the ways out are. Duskers' `survey` and Cogmind's `Download(Registry)`
do the same work. **The first thing worth powering**, because everything else on
this list is a decision you cannot make blind. Failure mode: if it reveals
everything, the map stops being explored — so it should reveal *categories and
sections*, never contents and never hostiles. You learn there is a fabricator
aft; you do not learn what is standing next to it.

**Production node.** Prints an item into a free inventory slot, consuming
materiel — the same materiel the ship spends on hostiles, taken from cut nodes.
This is where the **hacking tool** comes from, which closes the open question in
[`alert-and-age.md`](alert-and-age.md) §5E: hacking is free *if you have the
tool*, and the tool costs a slot, a trip, and materiel the ship would rather
keep. The cost that is not influence.

**Repair node.** Restores a drone, or a spent tool. Limited uses — two, first
guess — so it is a place you plan around rather than a fountain. Cogmind's
repair stations are the model, and the important part is that using one takes
turns you are not spending elsewhere.

**Security node.** Already specified in
[`alert-and-age.md`](alert-and-age.md) §2: one node, one full alert band,
consumed. Two or three per hull, deep and defended.

**Reactor.** Guaranteed, free, and the only guaranteed machine. Routing power is
its verb. Destroying it is possible and ends the mission's power entirely —
every section dark, every machine dead, including yours. A scorched-earth option
that should exist and should almost never be right.

**Turret and camera.** The security layer, priced 11 and 2. Both invert when
hacked, after Invisible Inc.: a taken turret shoots the ship's units, a taken
camera watches for you. **The security budget converts into the player's
toolkit**, which is what stops security reading as a tax.

---

## 6. The key graph

Duskers makes a derelict a lock-and-key puzzle without ever calling it one: the
key is power, the lock is a door, and the cost of turning the key is a drone
standing still. Ours, drawn out:

```
  reactor ──power──> section
                       ├──> data centre ──> where everything is
                       ├──> production node ──(+ materiel)──> hack tool
                       │                                        │
                       │                                        v
                       ├──> doors under control          node: hack (silent)
                       ├──> repair node ──> a drone that lives
                       ├──> security node ──> one alert band back
                       │
                       └──> turrets · cameras · spawn zones  (the ship's half)
```

Read it and the shape of a mission appears without anyone authoring one:

1. Board dark. You can walk, force doors, and cut things. Nothing else.
2. Find the reactor. Power the section with the data centre — **loudly**.
3. Now you know where the plants are, and can choose: print the tool and take
   nodes quietly, or cut your way through and pay in attention.
4. Every section you light up to get something gives the ship something.

That is four decisions deep with no scripting, and it is the same structure
Duskers gets from power and Cogmind gets from machines.

### Materiel is one currency, both directions

The ship spends materiel on hostiles. The production node spends materiel on
your items. **Cutting a node does not just deny the ship income — it is where
your own income comes from.** One resource, two claimants, which is the tightest
version of the cut-it-or-take-it choice we have had: the node you take quietly
keeps paying *the ship*; the node you cut pays *you*, once, and loudly.

*This inverts the existing design and needs checking.* [`derelict-extraction.md`](derelict-extraction.md)
§5 has cutting as denial and taking as profit. Under one shared materiel pool it
is closer to the reverse. Flagged in §8.

---

## 7. Guarantees, exclusions, and what is never bought

Some things are structural and paid off-budget, because a mission without them
is not a mission. RoR2 reserves the teleporter *before* spending; Duskers gives
every derelict exactly one fuel access point; Invisible Inc guarantees a
fabricator every level.

**Guaranteed, off-budget:** the boarding point, one reactor, at least one data
centre, and at least one plant. *That last is rule 1 and 2 of the anti-degeneracy
list, moved from a check to a guarantee.*

**Bought:** everything else.

**Exclusion pairs**, after Duskers' placement rules, which cost nothing to write
and do most of the shaping:

- A reactor is never in the same room as a turret.
- A data centre is never in the same room as a spawn zone.
- A security node is never on the boarding route (seclusion floor).
- No two machines of the same kind in one compartment.
- A plant's spawn zone is never in the boarding compartment — already enforced.

And one pairing rule in the other direction, taking Draw Steel's *upgrade*
pricing: a camera in a room that already has a turret costs 1 rather than 2,
because the pair is one problem. Buy variations on what is already placed rather
than more places.

---

## 8. Open questions

**A. Does the shared materiel pool invert the node economy?** §6 says the node
you cut pays you once and the node you take keeps paying the ship. That is a
better decision than the current one but it contradicts
[`derelict-extraction.md`](derelict-extraction.md) §5, and "taking" needs to
mean the income redirects rather than continues. Probably: *taken* nodes pay
you, *cut* nodes pay nobody, and cutting is what you do when you cannot afford
the trip. Needs one prototype.

**B. Is the power budget a routing puzzle or a single choice?** Duskers gets
real texture from inlets each powering a set number of rooms, with a ship
upgrade to reassign them. At two or three drones we cannot also ask the player
to manage a switchboard. *Leaning: one reactor, a budget of N section-lights,
re-routable at the reactor terminal only — so changing your mind costs the walk
back.*

**C. How much does the data centre give away?** Too little and it is not worth
powering; too much and exploration ends. Categories and sections, not contents —
but that is an assertion, not a tested answer.

**D. Do dormant purchases read as unfair?** A section that was cheap because it
was dark becomes expensive the moment you light it. That is the design working,
but only if the player *knew* — so a section's contents must be legible before
powering it, which argues the data centre is nearly mandatory and pushes back on
(C).

**E. Does severing want the ship to repair links?** If the ship cannot reopen a
cut route the economy collapses on one closed door. If it can, the player needs
to see it happening. *Leaning: the ship reopens a severed link after a few
turns, loudly and visibly, and that is a response bought from the alert budget
rather than a free action.*

---

## Sources

Cogmind's machine vocabulary, hack options and seclusion metric; Duskers' power
inlets, terminals, exclusion rules and the one-guaranteed-fuel-point rule;
Invisible Inc.'s invertible security devices and guaranteed fabricator;
Pathfinder 2e's 5:1 simple-to-complex ratio; Draw Steel's upgrade pricing; RoR2's
reserved-before-spending teleporter. Read properly in the research behind
[`rscore.md`](rscore.md); the Cogmind and Duskers material should become
`references/` files of their own.
