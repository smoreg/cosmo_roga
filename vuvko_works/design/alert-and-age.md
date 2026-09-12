# Alert and Age — the two things a derelict does to you

Draft 1, 2026-09-12. A plan, not an implementation. Numbers are first guesses
and are marked as such; the structure is the part to argue with.

[`rscore.md`](rscore.md) decides *what is aboard*. This decides *what happens
while you are*. Two systems, taken from two games:

- **Cogmind's alert** — a hidden meter, raised by what you do, that buys the
  ship's *response* and never touches what was already there.
- **Duskers' age** — a second pre-mission dial that says how far gone the hull
  is, unlocking *categories* of failure at thresholds rather than multiplying
  anything.

## The thesis: two clocks, and only one of them is about you

> **Alert is the ship noticing. Age is the ship dying. Neither is difficulty.**

That split is the whole reason to take both. A derelict that only reacts to you
is a security level with a spaceship painted on it. A derelict that only decays
is weather. Together they answer the question the extraction genre keeps
failing — what replaces the human opponent — with **one antagonist that
responds and one that does not care**, which between them cover the two ways a
real wreck kills people.

It also resolves an open question from
[`derelict-extraction.md`](derelict-extraction.md) §7: what punishes waiting,
now that the alarm can be pushed back down. **Age does.** The alarm comes down;
the hull does not come back.

Only one of these is a meter the player watches. Age is fixed before boarding
and reported in the briefing, so it reads as a property of the ship — like
weather, which you were told about and then have to live in.

---

## 1. Age is the allocation dial, not a fourth budget

The obvious mistake is to make Age a separate purse. It is not. **Age decides
how the one RScore pool is split**, which keeps us at two ledgers and makes the
two systems couple on their own.

| Band | Days derelict | Production + security | Hazard | Live failures unlocked |
|---|---|---|---|---|
| **Cold** | < 120 | 85% | 15% | none |
| **Settling** | 120–239 | 70% | 30% | doors seize |
| **Failing** | 240–399 | 50% | 50% | + hull breach |
| **Fatal** | 400+ | 30% | 70% | + reactor bleed |

*(Percentages are first guesses.)*

**The coupling falls out for free, and this is the point of doing it this way.**
Alert responses are built by spawn zones, and spawn zones come out of the
production share. So a Fatal hull, holding 30% of its capacity in production,
**reaches the top alert band and can barely act on it** — it is coming apart
and cannot fight back. A Cold hull is sound and awake.

That is a real choice at the mission screen, and it needs no second table:

- **Cold** — a fortress that does not leak. Bring the tools for a fight.
- **Fatal** — almost undefended, and the hull is trying to kill you.

Without this coupling, Age is pure downside and nobody picks the old ship.

### What the briefing shows

Three axes, after Duskers, and **no difficulty number**:

```
        HAULER — 8 sections, 300 × 500 ft
        FAILING — dead about a year. Hull integrity poor.
        Reads as: plasma conduit growth, something armoured
```

Size and reward scale together (they already do — capacity is summed from the
rooms). Age is separate and pure risk-shape. Infestations are reported **as
kinds, never as counts** — Duskers is explicit about this and it is most of why
its pre-mission screen creates dread rather than arithmetic.

---

## 2. Alert: the meter

A hidden integer — call it **influence**, as Cogmind does, so nobody mistakes
it for a health bar — surfaced as **six bands**, which is the number
[`derelict-extraction.md`](derelict-extraction.md) §6 already committed to on
Klei's reasoning that legibility outranks balance.

| Band | Influence | Name |
|---|---|---|
| 0 | 0–19 | Cold |
| 1 | 20–39 | Roused |
| 2 | 40–69 | Alert |
| 3 | 70–109 | Hunting |
| 4 | 110–159 | Lockdown |
| 5 | 160+ | Purge |

Bands widen as they climb, so early noise moves the needle visibly and late
noise does not whipsaw it.

### What raises it — the price list

Everything here is a thing you chose to do. Nothing is charged for loot, for
time, or for standing somewhere.

| Action | Influence | Stream |
|---|---|---|
| Welder strike (melee) | 3 | percussive |
| Emitter volley (ranged) | 6 | percussive |
| Kill that leaves wreckage | +3 | percussive |
| Losing a drone | 10 | percussive |
| Forcing a shut door | 4 | structural |
| Cutting a locked or seized door | 10 | structural |
| Cutting a node | 15 | structural |
| Destroying a spawn zone | 25 | structural |
| Opening a breach deliberately | 12 | structural |
| Being seen by a hostile | 6 | observed |
| Seen, then losing the pursuer | 4 | observed |
| **Hacking a node with the right tool** | **0** | — |
| Hacking a node improvised | 8 | structural |

*(All first guesses, calibrated against a 30–50 turn mission.)*

Two of these rows are load-bearing.

**The free hack.** Cogmind's rule is one line — *"alert does not increase at all
from hacks with a success rate ≥ 30%"* — and it does the work of a table:
routine access is free, desperate access is loud. Ours is the same shape.
Hacking a node with the tool for it costs **nothing**, which is what finally
gives §5's cut-it-or-take-it choice real teeth: cutting is 15 influence and
instant, hacking is silent and slow.

**Escaping is not free.** Cogmind charges for being forgotten by a hostile
(+10) and for being spotted and then losing it (+15). Ours charges 4. It sounds
petty and it is not: without it, breaking line of sight erases the mistake, and
stealth becomes a save-scum rather than a resource.

### What lowers it

- **Going quiet: −2 per turn in which no drone did anything on the list.** Ten
  clean turns is a band. That is a real price in a forty-turn mission, and it
  is what makes patience a strategy rather than a stall.
- **A security node: down to the floor of the band below.** One node, one full
  band, and the node is spent — the decision, not the dial, that
  [`derelict-extraction.md`](derelict-extraction.md) §6 asked for. Two or three
  on a map, deep and defended.
- Nothing else. In particular there is no decay while a hostile has you.

### What it buys — responses only, never the garrison

**Decision: alert never changes the number of spawn zones, nodes, or anything
placed at generation.** This is Cogmind's line, stated flatly in its own
documentation: *"Alert level does not increase the number of patrols or guards
on the map in any way."* Standing forces are RScore's; alert buys reactions.

Keeping that boundary is what stops the two systems becoming one difficulty
slider with two names.

| Band | What changes |
|---|---|
| 0 Cold | Nothing. Hostiles are where the ship left them. |
| 1 Roused | Sensors come back — hostiles know roughly where you are. No more free approaches. |
| 2 Alert | The ship begins responding: one response every 3 turns. |
| 3 Hunting | One response every 2 turns, and spawn zones build at a discount. |
| 4 Lockdown | Doors re-arm ship-wide; forcing costs double. Taxes the tool economy directly. |
| 5 Purge | A response every turn, and the count climbs. **Leave.** |

Band 5 is deliberately divergent rather than saturating. Invisible Inc. caps at
six and keeps ticking to no effect; Cogmind's High Security instead escalates
forever, *because that design wants flight rather than attrition*. Ours is an
extraction game. The top band should mean "the answer is the airlock," and a
security node still exists to buy your way back down if you would rather fight
your way to one.

### Three flavours of response, from one meter

This is the best idea in Cogmind's system and the one we would not have
invented. Influence is tracked in **three streams**, and the dominant stream at
the moment a band is crossed decides what the ship sends:

| Stream | Earned by | Response |
|---|---|---|
| **Percussive** | weapons fire, wreckage, losing a drone | **Hunters.** The nearest spawn zone builds a combat unit and sends it to your last known position. |
| **Structural** | cutting, forcing, breaching | **Containment.** Doors re-arm and lock behind you; the ship isolates the damaged section. Fewer bodies, less room. |
| **Observed** | being seen, losing a pursuer | **Search.** Cheap scouts sweep toward where you were. Many, weak, and they are looking rather than fighting. |

Cogmind's version of this — non-combat influence buys *search patrols* instead
of *assault squads*, and dispatching one refunds influence — makes the meter
answer **how** you played rather than **how much** you did. It means a quiet
crew that keeps getting spotted has a different mission from a loud one that
never is, on the same hull at the same band.

---

## 3. Age: the live failure table

Age unlocks **categories**, not amounts. Every failure below is telegraphed a
turn ahead, on the compartment, per the hazard checklist in
[`rscore.md`](rscore.md) §2 — an untelegraphed hazard is a tax.

**Door seizure** *(Settling and worse)*
A working door reports a fault, and on the following turn becomes permanently
locked. It can still be cut — for 10 influence and a turn. This reuses the door
states the deck already parses, and it attacks routes rather than hit points:
the way you came in may not be the way out.

**Hull breach** *(Failing and worse)*
Two warnings, as in Duskers: a compartment is stressed, then it goes. The
compartment vents. Everything loose in it is destroyed and vacuum propagates
through open doors until something is shut. **Drones are not killed outright —
they are dragged toward the breach**, which is exactly what makes venting a
tool rather than an instant loss.

**Reactor bleed** *(Fatal only)*
A room fills with radiation and it spreads through open doors. Unlike vacuum it
**never dissipates**. The ship becomes progressively smaller.

### Hazards are symmetric, and that is the whole point

**Decision: every age failure damages hostiles on exactly the same terms.**

In Duskers you have no real weapon, and venting a compartment *is* the weapon —
which is why the hazards are the game rather than the scenery. We have weapons,
so ours should make venting the *efficient* answer to a crowd rather than the
only one. A breach you open on purpose costs 12 influence and kills whatever is
in the room.

That also satisfies two entries on the hazard checklist at once: the hazard is
aimable, and it pays in position rather than in hit points.

### Time as an information channel

Duskers' vents are silent for the first 2:30, may spawn twice inside a window,
and are permanently safe after 10:00 — so **a vent that has stayed quiet past
ten minutes proves the ship has no swarm aboard**. The clock is a sensor.

The cheap version for us: failure checks run on a known cadence, so a Settling
hull with no seizure by turn 12 was over-rated by the survey, and you can spend
that knowledge. Worth having; not worth complicating.

---

## 4. What this does to the existing design

**It answers §7 of [`derelict-extraction.md`](derelict-extraction.md).** That
section asked what punishes waiting once the alarm is two-directional. Age
does, and it does so without touching the alarm: you can quiet the ship, and
the hull still fails on its own schedule. Patience costs hull, noise costs
attention, and they are different currencies.

**It sharpens §5's cut-it-or-take-it.** Cutting a node is 15 influence and
instant; hacking it with the right tool is silent. That is the sharpest the
choice has been, and it comes free from Cogmind's one-line hacking rule.

**It gives the mission screen something to choose between.** Old-and-rich
against fresh-and-defended is a decision; two hulls of different size is not.

**It leaves the alarm bands from §6 mostly intact** — sensors, then re-arming
doors, then bodies — but re-labels them as *responses* and forbids them from
adding to the garrison.

---

## 5. Open questions

**A. Are three streams one too many?** Percussive, structural and observed each
produce a distinct response, which is the appeal. But the player has to *feel*
the distinction for it to be a decision rather than noise, and three is on the
edge of what a hex map can telegraph. *Leaning: build three, and be willing to
fold observed into percussive if it does not read.*

**B. Does Age also gate what the hazard share may buy?** A Cold hull spending
15% on hazards buys something — but a spreading fire on a ship dead four months
is odd, and radiation on a fresh one is odder. Probably the hazard *catalogue*
is age-banded too, not only the live failure table. Not worked out.

**C. Where does the extraction leg sit?** The trip back is where alert most
naturally bites, and Tarkov has the sharpest published idea here: on some maps,
**reinforcements are bound to the player's own use of an exit** — opening your
escape route is what buys the ambush. That is a spend of the *player's*
resource rather than the designer's, and it fits an extraction game exactly.

**D. Does age visibly progress during a mission?** It should not — a ship does
not decay in forty turns. The failures are the *consequence* of a decay that
already happened. Worth saying out loud so nobody adds a rising age meter.

**E. Is the free hack too strong?** If hacking is silent and always available,
cutting only exists for players without the tool. It needs a cost that is not
influence — time, an inventory slot, or a chance of failure that is itself
loud. The last of those is closest to Cogmind, where a failed hack starts a
trace.

---

## Sources

Cogmind's alert numbers, response types, sinks and the hacking rule; Duskers'
class/grade/age dials, failure categories, spawn clocks and information denial;
Invisible Inc.'s six-band saturation and legibility argument; Tarkov's
exit-triggered reinforcements. Read properly in the research streams behind
[`rscore.md`](rscore.md); not yet written up as `references/` files, which they
should be.
