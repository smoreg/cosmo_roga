# RScore — constraining what a mission generates

Draft 1, 2026-09-12. A plan, not an implementation.

The generator makes a ship. Nothing yet decides what is *aboard* it, and the
result is a lottery: of sixteen rolled missions, **four had no spawn zone at
all** and were therefore won on turn one, one shipped seventeen sealed rooms,
and node counts ran from 0 to 9 — a 2.7× swing in the rate the ship produces
hostiles, chosen by nobody.

**RScore is the budget that decides what a derelict is carrying.** Its capacity
comes from the ship; it is spent on hazards, security, hostiles and the things
that help you; and it is spent *while* the mission is being built rather than
checked afterwards.

Every claim about another game is sourced in [`references/`](references/) or
named inline. Decisions are written as decisions so they can be argued with.

---

## 1. Capacity is measured from the extracted deck, not predicted from the hull

**Decision: RScore capacity is a sum over the rooms the generator actually
produced, computed after extraction and before anything is placed.**

The tempting version is a scalar from the hull — sections, or beam × length —
because the briefing screen names a ship before generating it. Measured over
sixteen real missions, every pre-generation predictor is too weak to budget
from:

| Predictor of playable size | r |
|---|---|
| tiled floor (Σ section w×h) | 0.494 |
| architecture sections | 0.399 |
| bounding rectangle | 0.269 |

The regression on sections is `hexes ≈ 135 + 10 × sections`, which moves the
spread from sd 25 to sd 23 on a mean of 220 — about 16% of the variance
explained. Hexes per section run 21 to 32. The bounding rectangle is worst
because a cross-shaped hull is mostly empty air; sections are better; neither
is good, because a section's *box* is not its *deck* — a fuel wedge is drawn
inset inside its tile.

There is no need to predict. The pipeline already runs

```
layout → rasterise → flood rooms → contacts → doors → dress → [populate]
```

so by the time anything needs paying for, the truth is in hand: every room with
its `kind`, `roles`, `areaSqFt`, `sealed`, `isEntry`, `hazard` and `sourceTile`,
plus the door graph and the reachable set. Capacity is a sum over that.

**Consequence for the briefing.** It can no longer quote an exact figure before
boarding. Two honest options, and this is a real choice:

- **Show a band.** "Hazard rating: moderate (6–9)." The exact number appears on
  boarding. (Settled in [`alert-and-age.md`](alert-and-age.md) §1: three axes,
  no number.) Cheap, and the imprecision is thematically free — you are reading a
  derelict from a tug.
- **Generate at briefing time.** Exact, and it also lets the briefing show the
  hull. Costs a rasterise per reroll, which is the expensive stage.

*Leaning: show a band*, and Duskers has already built the version of this we
want. Its pre-mission readout is **three axes, none of them a difficulty
number**:

- **Class and grade** — the hull type and its size tier, which set dimensions
  *and* scrap capacity together. Size and reward scale as one.
- **Age**, in days derelict, banded Stable / Volatile / Hazardous / Fatal. This
  is a separate purse from size, and it does not multiply anything: **it unlocks
  hazard categories at thresholds.** Past 200 days doors start failing
  permanently; later, airlock seals fail, pipes burst, and very rarely the ship
  stops accepting the `close` command at all for the rest of the mission.
- **Infestation types** — *which* things are aboard, and explicitly **not how
  many**.

That is the whole shape we need: one axis for how big and how rich, one for how
broken, one for what kind of trouble — and a deliberate refusal to quote counts.
A scan that reports "Volatile, two infestation types" is better fiction *and*
better design than a scan that reports 7.

### What a room is worth

Priced per room, not per hex. A first table, to be tuned against play:

```
capacity(room) = areaSqFt × weight(kind) × modifier(architecture)
```

`kind` is already computed by `zoneKind()` from the taxonomy roles, and the
roles the generator actually rolls are known. Across 120 hulls, tiles carrying
each role, per hull:

| Role | min | median | max | hulls with none |
|---|---|---|---|---|
| service | 3 | 6 | 10 | 0 |
| quarters | 2 | 5 | 10 | 0 |
| drive | 2 | 5 | 9 | 0 |
| fuel | 1 | 4 | 7 | 0 |
| bay | 0 | 2 | 6 | 5 |
| command | 1 | 2 | 5 | 0 |
| weapon | 0 | 1 | 4 | 22 |
| airlock | 0 | 1 | 3 | 47 |
| green | 0 | 0 | 2 | 98 |

A drive hall should be worth more than a bunk: it is where the ship's own
systems are, it is where a spawn zone can sit, and it is somewhere you have a
reason to go. Quarters and service are the filler roles and should price low —
they are 40% of every hull between them.

**This is where "faction" enters.** With one faction it is a multiplier of 1.0
and a set of weights; the structure exists so a second faction is a different
weight table over the same rooms rather than a second generator. A scavenger
crew values the bays; something grown out of the reactor values the drive.

---

## 2. What the budget may buy — the test is whether it takes a turn

**Decision: RScore pays for anything that acts. Scenery is free and unbudgeted.**

This is the cross-cutting finding from the tabletop survey, and it explains why
terrain is almost universally unpriced while the systems that *do* price it
price exactly the terrain that acts.

**ICON encodes it literally in its data.** A base foe costs 1; `Elite` is
`{"Description": "Takes 2 turns.", "EncounterBudget": 2}`; `Legend` is "takes 1
turn for each player character" and costs the entire budget. An additive trait
that grants an extra turn a round adds exactly 1.

**Pathfinder 2e prices the gap, and gives us the only published ratio for it.**
A *complex* hazard — one with its own initiative, acting every round — costs the
same as a same-level monster. A *simple* hazard, which triggers once, costs
**one fifth** of that. Against a 40 XP same-level creature: 40 for complex, 8
for simple.

> The XP for a complex hazard is equal to the XP for a monster of the same
> level, and the XP for a simple hazard is one-fifth of that.

That 5:1 is the distinction between "rolls initiative" and "doesn't," and it is
the number to start from. (A warning, because it circulates widely in the wrong
form: the inverted version — "simple = same-level creature, complex = four
levels higher" — is not the rule. Discard it on sight.)

Note also what PF2e charges for and what it does not. The XP is for the
hazard's *presence in the scene*: characters earn it "whether they disable it,
avoid it, or simply endure its attacks." A budget pays for a thing being there,
not for how it gets resolved.

The test is clean and it settles arguments:

- A vented compartment that costs movement is **scenery**. Free.
- A fire that spreads on its own turn is a **participant**. Budgeted.
- A locked door is **scenery** — it has 1 hp and costs you a turn once.
- A camera that raises the alarm on its own turn is a **participant**.

Four categories, one currency:

| Category | Examples | Notes |
|---|---|---|
| **Hostiles** | scout 6, sentinel 11, hunter 15 | already priced, as spawner pool costs |
| **Production** | spawn zones, resource nodes | buys a *rate*, not a body — see §4 |
| **Security** | cameras, re-arming doors, lockdown | acts on the ship's turn; see §5 |
| **Relief** | caches, hackable turrets, shortcut hatches, security nodes | bought from the same pool — see §3 |

### Three shapes a price can take

Draw Steel is the only system found that prices environment seriously rather
than tokenistically, and it does so three different ways. All three are useful
to us, and the scale is worth keeping in mind: one first-level hero is worth 6
encounter value, so lava at 4 is two thirds of a party member.

| Shape | Draw Steel example | Ours would be |
|---|---|---|
| **Per area** | Lava, 4 per 10×10 patch; brambles, 1 | a vented or flooded run of compartments, priced by floor area |
| **Fixed** | Bear trap 2, arrow launcher 8, Throne of A'An 24 | one camera, one turret, one re-arming door |
| **Upgrade** | Angry Beehive 2, +1 concealed, +2 killer bees | a camera that also locks the door it watches |

The upgrade shape is the one we are least likely to think of and most likely to
want: it prices a *variation on a thing already placed*, which is how a budget
buys nastiness without buying clutter.

The existing hazard vocabulary in `dress.ts` — vented, fire, flooded, live
wiring, radiation — splits across the line rather than sitting on one side of
it. *Vented* and *flooded* are scenery as currently written. *Fire* and *live
wiring* want to be participants, and should cost.

### What stops a hazard being a damage tax

Being priced does not make a hazard worth buying. The tactics survey gives a
checklist, and the entries that matter most here:

1. **Telegraphed a turn ahead, on the tile.** Into the Breach announces
   environmental effects the turn before they fire on specific highlighted
   squares — which is precisely what lets you *shove an enemy onto one*. A
   hazard you can aim is a decision; a hazard you can only avoid is a tax.
2. **Pay in actions, not hit points.** XCOM's burning does 1–3 damage a turn,
   which is nothing — but it **blocks melee attacks and most abilities with a
   cooldown**. It is a soft panic wearing a damage-over-time costume.
3. **Differentiate on non-damage axes.** XCOM's three damage-over-time effects
   do *nearly identical damage* and differ entirely in what else they do: acid
   shreds up to 4 armour, poison gives −30 aim and −4 mobility with the widest
   radius, fire disables abilities. The damage being equal is the tell that
   damage was never the point.
4. **Persist and spread**, so the hazard has a future state to plan against.
   XCOM fire spreads to adjacent flammable tiles and burns longer there, which
   makes the map itself a timer on that region.
5. **Water removes burning.** One cheap interaction between two hazards is
   worth more than either alone, and it is what turns a hazard into part of the
   toolkit rather than part of the weather.

Point 2 is the one our roster is least prepared for: everything the drones face
is currently priced in hit points, and a hazard that costs a *turn* is a
different and better purchase at 12 hp.

---

## 3. Relief is bought from the same pool, and it is not a refund

**Decision: beneficial elements are purchased with RScore, at a positive price,
out of the same capacity.**

The obvious design is a negative cost — a boon that refunds budget so the
generator can afford more threat. Across the whole tabletop survey **no system
implements one.** Treasure is scaled to threat in several systems, but always
from a *parallel* pool, never netted against the encounter budget.

The nearest anything comes is PF2e's "Budgeting for Terrain," and it is
pointedly one-directional:

> If you include terrain that's tricky to navigate or takes extra work to deal
> with, consider whether it should count toward the encounter's XP budget.

Hostile terrain costs XP. Favourable terrain, NPC allies and party advantages
refund nothing and are not addressed at all. The one mainstream system that
reaches toward pricing environment in the threat currency still declines to
price the other side.

There is also an argument against the whole shape, and it is worth writing down
because it applies to any single pool. The Angry GM, asked to price a party
benefit in XP, refused on four grounds, of which the fourth generalises: *"any
sufficiently costly punishment is basically coercion."* **In a shared pool,
every price is also a punishment somewhere** — buying the player a cache
necessarily buys the ship one fewer hunter, and the more universal the currency,
the harder that lands. His counter-proposal is instructive: not a charge for
relief, but a *bonus for going without it*.

Two shipped patterns to imitate instead:

**Risk of Rain 2** runs one `SceneDirector` with **two purses** spent through
the same priced-card loop: interactables first, then monsters. They scale on
orthogonal axes — loot on party size, threat on elapsed difficulty — and the
only bridge between them is one explicit, player-operated valve (the Shrine of
the Mountain). It is the only surveyed game that built full pricing machinery
for beneficial content and then deliberately refused to let danger spend from
it.

**Slay the Spire** conserves strictly: room types become *integer counts*
(`round(total × weight)`), fill one array, get shuffled, and are dealt out. A
map has a predetermined number of shops and elites; the RNG decides only where
they land. Ascension buys 60% more elites **out of the monster remainder** —
same node count, reallocated.

*Leaning: one pool, allocated by proportion, spent as counts.* Take RoR2's
refusal to let the halves feed each other, but keep Slay the Spire's single
conserved array, because our capacity is fixed by the ship and cannot grow
during a mission. So:

```
capacity → split by mission-type proportions → integer counts per category
        → placed by the rules in §6 and §7
```

A mission type is then a set of proportions over one pool, which is exactly what
"Secure the ship" versus a future "Recover the cargo" should differ by.

### Let the player own one lever

Risk of Rain 2 keeps its two purses strictly separate and then provides exactly
one bridge: the Shrine of the Mountain, a beneficial interactable whose only
function is to multiply the boss budget in exchange for multiplied loot. **The
player owns that lever, and only that one.**

Invisible Inc. does something better still: any daemon spawned by the security
system has a flat **10% chance of being reversed into a beneficial "Algorithm"**
— and carrying the Brimstone program raises it to **20%**. The player's loadout
adjusts the generator's good-to-bad ratio directly. That is the most elegant
answer found to "who decides the ratio", and it costs one number.

*Leaning: one bridge, player-operated, and it should be a piece of equipment
rather than a menu setting.*

### Ship canned shapes, not just a total

PF2e's most usable feature is that it publishes named compositions at fixed
totals rather than leaving a GM to partition 120 XP themselves — *Boss and
Lackeys* (one PL+2 and four PL−4), *Mook Squad* (six PL−4), *Mated Pair*, *Troop*.
A budget with no shapes is a blank cheque, and a generator with no shapes
produces an average of everything.

**Decision: each mission type carries a small set of named shapes, and a roll
picks one.** A derelict that is *Infested* spends its production allowance on
many cheap nodes feeding one deep spawn zone; one that is *Garrisoned* buys few
nodes and a lot of security. Same capacity, recognisably different ships.

And a second trick from Draw Steel worth taking: **objectives shift a difficulty
band rather than costing budget.** If the thing that must be destroyed is worth
a third or less of the opposing side's value, the encounter is one category
easier; if it is hidden or held, one category harder. That is how a mission's
*shape* can matter without competing with its contents for the same pool.

---

## 4. Production is the dangerous purchase

Spawn zones and nodes are not objects, they are a **rate**. Income is
1/node/turn and a scout costs 6, so eight nodes is a scout every 0.75 turns and
three is one every two turns. That is the single most consequential number a
mission generates, and at present it is a by-product of how many rooms happened
to clear a size threshold.

**Decision: buy the production rate directly, and derive node placement from
it** — not the reverse. The budget names a rate the ship can sustain; nodes are
the physical expression of it, and the count follows.

This also makes the design's central claim testable, which the prototype balance
sweep already supported: at income ≥ 0.75/node, cutting nodes wins and rushing
spawners loses 16/16.

### The non-linearity we know about

A points pool spent on the cheapest unit buys more than its price implies.
Stănescu et al. fitted combat power on StarCraft battles at roughly `N^1.56`
against a budget's `N^1.0`, and name the additive model as the thing being
fixed: "the offensive score for a group of 10 marines is ten times the score for
1 marine… severely underestimates being able to focus fire." D&D 5e's 2014
encounter multiplier existed for this reason, and the 2024 revision's removal of
it reportedly reopened cheap many-low-CR builds.

D&D 5e's 2014 encounter multiplier existed exactly for this — its stated reason
is action economy, "the more monsters there are, the more attack rolls you're
making against the characters in a given round" — and the 2024 revision deleted
it. The consequence is measurable in the system's own units: **five dire wolves
against four fourth-level characters rated Deadly at 2,400 XP under the old
multiplier; ten of them rate only Hard at 2,000 XP under the new flat sum.**
Twice the bodies, priced lower.

**Decision: price a purchase superlinearly in the count of bodies it will
produce**, not linearly. The cheap fix in the literature is as blunt as
replacing HP with √HP in the evaluation; ours is a multiplier on the *n*th unit
of the same type. Untested, and the first thing to measure.

---

## 5. Two ledgers. The alarm does not spend RScore

**Decision: RScore is spent at generation and never again. The alarm is a
separate, in-mission ledger and the two do not exchange.** How that second
ledger works is [`alert-and-age.md`](alert-and-age.md).

**Cogmind has already shipped this decision, and states it flatly:** *"Alert
level does not increase the number of patrols or guards on the map in any
way."* Standing garrisons are paid for at **map generation**; alert is a second,
live budget that buys only assault squads, search patrols and a high-security
state. Two budgets, two purposes, no exchange — and, tellingly, the response
budget keys off *how* you played: if most of your alert came from non-combat
sources, you get **search patrols instead of assaults**, and dispatching one
*subtracts* 100 influence. Same meter, different threat, chosen by your own
conduct.

Three further sources point the same way:

- **Invisible Inc. decouples its two economies deliberately.** Breaking
  firewalls costs PWR, not alarm; the tracker is the time-and-noise currency and
  hacking is a separate one. The alarm also **saturates at level 6** and keeps
  ticking to no effect, and each camera can raise it at most once per turn.
- **Darkest Dungeon's torchlight is a parallel ledger**, not part of the curio
  tables. Darkness adds an upside channel and a downside channel *on top of*
  each curio's own fixed odds; it never alters them.
- **RimWorld is the counter-example**, and this design already rejected it in
  [`derelict-extraction.md` §6](derelict-extraction.md): wealth feeds raid
  points, players respond by refusing to accumulate wealth, and the wiki has an
  entire page teaching them to burn corpses and let weapons deteriorate.

**But this is a decision with a known cost, and it should be made with eyes
open.** The tabletop survey names it as the gap nobody closes: Daggerheart ships
a **Fear** pool (cap 12, +1d4 per short rest, +1d4 + party size per long rest)
and Draw Steel ships **Malice** ("Heroes + Rounds" accruing per round), and both
make an identical stat block substantially more dangerous while appearing
*nowhere* in the encounter budget. The survey's own advice is to decide about
that early rather than bolt it on.

Our alarm is exactly that resource. So: RScore is deliberately blind to the
alarm, which means a mission generated at a given capacity is *not* equally
dangerous at alarm band 1 and band 5. That is the price of two ledgers, and it
is the right price — but it means the alarm's bands must be balanced against
what the ship holds, not against an abstract difficulty.

Worth noting *why* RimWorld does it, because we lose that too: wealth-scaling
exists to **rubber-band** — "Storytellers now focus on wealth and let you
recover from serious damage" — and Tynan's own opt-out tooltip admits a fixed
curve "may be nearly impossible to recover from serious losses." An RScore
fixed by the ship has no rubber band. Whether it needs one is an open question
(§11).

---

## 6. Spend it during placement, not after

**Decision: the budget is spent by construction. Never roll a manifest and then
check whether it fits.**

This is the hardest-edged finding in the PCG literature and it is empirical.
Karth & Smith re-implemented WaveFunctionCollapse as a constraint program: with
only local adjacency constraints it hit **zero conflicts** in every scenario.
Adding **one global counting constraint** — "every pattern must appear at least
once", structurally identical to "spend exactly this budget" — produced
**hundreds of conflicts**, and under WFC's restart-instead-of-backtrack policy
it **could not find a solution within a minute**. With real backtracking it
resolved quickly.

A budget is a global counting constraint, and our placer is local and greedy: it
refuses any hex whose loss would disconnect the walkable deck, and can return
null. We already have the failure in miniature.

So, in order: walk the rooms in a fixed order, and at each one decide what this
room can afford and what it may legally hold, paying as you go. If the budget
cannot be spent, it is **under**-spent and the mission is quieter — never
retried, never forced.

Two structural safeguards, both taken from shipped code:

- **An overflow sink.** Slay the Spire assigns a monster *off-budget* when no
  remaining token satisfies its adjacency rules. Without one, a constrained
  layout deadlocks.
- **A floor, and a way to fail loudly.** Risk of Rain 2's "don't spawn anything
  too cheap" rule once **deadlocked the game entirely** — infinite credits meant
  every monster was too cheap and nothing spawned at all.

---

## 7. Where things go is a separate decision from what they are

Buying a node and deciding which room it goes in are different problems, and the
second has published tools.

**Cogmind validates generated maps against metrics rather than trusting them** —
bounds on open space (15–30% for one cave type, 40–60% for another), minimum
room counts, minimum entrance-to-exit distance, and connectedness. The one worth
stealing outright is **seclusion**: a room's distance from the fastest route
between the entrance and the exit. It is the formal tool for deciding where
high-risk, high-reward content goes, and we have no equivalent. A node on the
boarding route is a different object from the same node four rooms off it.

Two placement rules from elsewhere, both cheap:

- **Never block the way past.** Darkest Dungeon's curios sit in corridors and
  rooms but never obstruct, *"thus it is possible to leave them be to minimize
  risk."* The opt-out is what makes engaging a decision. Our node placement
  already refuses chokepoints for a connectivity reason; this is the same rule
  for a design reason.
- **Exclusions, stated as pairs.** Duskers simply forbids some combinations:
  power inlets never spawn in a turret room, terminals never in a turret room,
  and there is **exactly one fuel access point per derelict, always.** Cheap to
  write, and it is what stops the generator putting everything that matters in
  one compartment.

## 8. Difficulty is a change to the shopping list, not a multiplier

**Decision: difficulty settings alter what the budget may buy, not what the
numbers are.**

Cogmind's difficulty modes are written as substitutions and decrements in the
generation budget: *"Each map containing Heavies converts 1 of them to a
Sentry"*, *"−1 to all patrol squad sizes"*, *"−1 to number of garrisons per
floor (cannot reduce to 0)"*, *"Cargo convoys have 1 less ARC escort."* No stat
multipliers anywhere.

That keeps every mission legible — a hunter is always a hunter — and it keeps
the anti-degeneracy floors visible in the same sentence as the reduction
(*"cannot reduce to 0"*).

Against a single scalar, there is also a measured argument. Tarkov gives each
map four independent dials — population cap, **spread** (max bots per zone),
replenishment rate, and duration. Interchange runs 30 bots at 2 per zone;
Lighthouse runs 29 at 8 per zone. **Near-identical headcount, completely
opposite texture, and one difficulty scalar could not have produced both.**

## 9. The anti-degeneracy list

**Decision: the budget arithmetic is wrapped in a list of narrow vetoes, and
that list is expected to grow.**

Two literatures converge here. Adam Smith, on the fact that maze difficulty
cannot be written as a formula: the remedy is "replacing a broad but
inexpressible concern with a collection of narrow, special cases" — prune the
solution that is too short, the one that never changes direction, the one where
a single cyclic pattern accounts for nearly all choices. And every mature
shipped budget has the same layer, usually written after a bug: Diablo II's
affix budget refuses to sell a third immunity; Spelunky refuses a dark level
after a sub-30-second clear; Invisible Inc caps each camera at one alarm point
per turn.

The list as it stands, every entry from a mission we have actually generated:

1. **Never zero spawn zones.** Four of sixteen. The mission is won on turn one.
2. **Never zero nodes** while spawn zones exist, and never zero of both.
3. **A floor on reachable floor area.** One hull shipped 17 sealed rooms.
4. **Never fewer than two drones.** One mission launched with one.
5. **No production in the boarding compartment** — already enforced.
6. **No placement on a chokepoint** — already enforced, and the reason the
   placer can fail.
7. **Cap the ratio of production to reachable rooms**, so income cannot outrun
   any possible route between the nodes.

Rules 1–4 are bugs today. They should be constraints tomorrow, not tuning.

---

## 10. The measurement bug this uncovered

`NODE_MIN_HEXES = 4` is the threshold for a room to be worth a node or a spawn
zone. It is measured in **hexes**, and counting hexes over-estimates small rooms
because a room touching a hex claims all of it. That bias scales with hex size:
at 35 ft a 2,000 sq ft room might touch 4 hexes and pass a 4-hex bar; at 20 ft
it covers about 6 of a required 12 and fails.

**So moving to 20 ft hexes silently tightened the bar and started producing
missions with nothing in them.** Every hull has 4–16 systems tiles — never zero
— so the rooms were always there; the threshold rejected them.

`Zone.areaSqFt` is already computed and parsed. Thresholding on it is exact at
any hex size. This is the third time a quantity stated in hexes has silently
changed meaning when the lattice changed, after movement and the backdrop blur.

**Decision: every rule the generator applies is stated in feet or square feet.
Hexes are a rendering of the deck, not a unit of design.**

---

## 11. Open questions

**A. Does RScore need a rubber band?** Fixed by the ship, it cannot respond to a
squad that has just lost a drone. RimWorld's adaptation is the only surveyed
system whose **recovery is 3× faster than its escalation** by design. Against
adding one: this is a per-mission game with a mission-choosing screen, so the
player already has a difficulty valve, and a reactive budget is a thing to be
read and gamed. *Leaning: no rubber band inside a mission; let mission choice be
the valve.*

**B. Where does the player-facing number live, if anywhere?** Showing RScore
makes it legible, and legible means gamed — Valve added `RelaxMaxFlowTravel`
purely because players learned to detect the Director's calm phase and sprint
through it. *Leaning: show a band and a hazard vocabulary, never the integer.*

**C. Does the same pool pay for the extraction leg?** Extraction is a declared
second objective and the trip back is where a budget most naturally buys
pressure. Untouched here — but there is a precedent that fits this game better
than anything else surveyed. **Original D&D awarded 1 XP per gold piece
recovered and 100 XP per hit die defeated**, so a 7 HD troll guarding 7,000 gp
paid 7,700 XP and *the monster was 9% of it*. One pool spanning threats and
rewards, placed across a whole dungeon level, with the **players** deciding how
much of it to claim and at what risk. That is an extraction loop with the
numbers already pointing the right way: the ship is worth more than the things
on it, and fighting is a means, not the point.

**F. Does the budget stay spent?** It only does if the ship changes while you
are elsewhere. A cleared compartment that stays cleared makes retreat free and
the budget silently refills — the mechanical root of the fifteen-minute
adventuring day. Our spawners already restock, which is the right instinct; what
is not yet decided is whether anything else does.

**D. What is a good mission, operationally?** The best answer found is Shyne &
Cooper's: a fight's quality is **how much the outcome changes when one party
member is removed** — sensitivity to composition peaks exactly at interesting
difficulty. With two or three drones that is directly computable, and it beats
"is it hard" as a target.

**E. How much does the generator have to spend on?** Only **191 of 1,789
classified tiles** can ever be placed — 10.7% — because `rim: "none"` removes
every 50×50 and 100×50 slot and the profile hull cuts nothing but 100×100 bays.
Entire kinds are unreachable: bridge 560/560, corner 302/302, edge 231/231.
Turning the rim on reaches 240. That caps how much variety any budget can buy,
and it is a hull-layout question rather than a budgeting one.

---

## 12. How this gets validated

**Not by measuring RScore.** Expressive-range analysis is explicit that
evaluation metrics must be chosen far from the generator's input parameters —
"if your generator accepts 'difficulty' as an input and has 'difficulty' as an
expressive range metric, this can only ever provide confirmatory results."

So: generate a few hundred missions, and plot **turns to victory**, **hostiles
killed**, **fraction of the ship visited**, and **drones lost** — as
distributions, not means. Summerville invokes Anscombe's Quartet for the reason:
four datasets with identical mean and variance and visibly different generating
distributions.

The pass condition is not a mean. It is that the degenerate tail is gone: no
mission won on turn one, none unwinnable, and the anti-degeneracy list in §9
never firing in a shipped build.

---

## Sources

Read properly, with numbers, in [`references/`](references/) where a file
exists. Cited inline above and not yet written up: Risk of Rain 2's two-purse
`SceneDirector`; Slay the Spire's `fillRoomArray` token array; RimWorld's
wealth → raid points pipeline and its opt-out tooltip; Left 4 Dead's pacing FSM
and `RelaxMaxFlowTravel`; Karth & Smith on WaveFunctionCollapse as constraint
solving; Adam Smith's *Mechanizing Exploratory Game Design* §10.2.3; Stănescu et
al. on Lanchester attrition in StarCraft; Shyne & Cooper, *No Player Left
Behind*; Pathfinder 2e hazard pricing and Draw Steel terrain pricing.
