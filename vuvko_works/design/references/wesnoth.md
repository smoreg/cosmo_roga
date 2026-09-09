# Battle for Wesnoth — tactical combat mechanics

Research dump, 2026-09-09. Sources: wiki.wesnoth.org, GitHub wesnoth/wesnoth
(`src/actions/attack.cpp`, `src/attack_prediction.cpp`), forums, devdocs.
Numbers are mainline 1.14–1.18 defaults; the exact constants are WML-configurable
per era/scenario. Each section closes with a note aimed at a 3-drone game whose
enemies come from spawners rather than a recruiting leader.

## 1. Hex grid: movement and terrain

**Movement points.** Each unit has an allowance (5–9 typical). Entering a hex
costs MP from *that unit type's* terrain table — cost is per-unit-type, not
universal: a Merman pays little for water and a lot for hills, a Dwarf the
reverse. A hex costing more than remaining MP can still usually be entered
(spending all of it) as long as the unit had at least 1 MP before moving. Cost 99
by convention means impassable for that type.

**Terrain defence is a property of the occupied hex, not the attacker's.**
"Defence" is the chance the unit standing there is *missed*: 60% defence on hills
means a 40% chance to hit it, no matter where the attacker stands. There is no
attacker's-high-ground bonus anywhere in the game. Typical values: castle and
village 60%, hills 60%, forest 50% (40% for large or cavalry units), mountains
60–70% and impassable to many, swamp and shallow water 20%, deep water 0% or
impassable, grassland 30–40%, caves varying by racial adaptation.

**Defence and resistance are different axes and they multiply.**

- *Defence* — a % chance to be missed. Depends on **terrain × unit type**, is
  rolled once per strike, and is identical against every damage type.
- *Resistance* — a %, possibly negative. Depends on **unit type × damage type**
  (blade / pierce / impact / fire / cold / arcane) and scales damage on a landed
  hit: `damage = base × (100 − resistance) / 100`. 20% resistance takes 80%
  damage; −20% takes 120%.

Hit chance is gated by terrain first (the RNG), then damage is scaled by
resistance. Neither substitutes for the other.

<https://wiki.wesnoth.org/NWP:_Terrain_Defence>

> **For us.** Terrain-as-armour through a single defence% per (unit, terrain)
> pair is compact and reads instantly on a hex map, and defender-only defence
> removes a whole category of mental overhead. At three drones a 3×N table is
> plenty. If a resistance matrix goes in at all, cap it at two or three damage
> types or it becomes a spreadsheet rather than a tactics game.

## 2. Combat resolution

**Round structure.** The attacker picks one weapon; the defender counters with a
weapon of the *same range class* or not at all. A weapon is a `damage × strikes`
pair (8×4). The exchange alternates — attacker strikes, defender strikes back if
it can, attacker again — until strike counts run out, someone dies, or berserk's
30-round cap. **A ranged attack against a melee-only defender takes no return
fire at all**, which is the single biggest tactical lever in the game.

**Hit resolution, from the engine.** One uniform draw per strike, compared
against a chance-to-hit derived from the *defender's* terrain defence
(floor/ceiling adjusted by marksman and magical):

```cpp
ran_num = randomness::generator->get_random(0, 99);
bool hits = (ran_num < attacker.cth_);
```

**Damage.** Base weapon damage scaled by a multiplier assembled from time of day
(±25% for lawful/chaotic by day/night; liminal −25% at both extremes, 0 at dawn
and dusk), leadership (+25% per adjacent leadership ally, additive, offence only),
then resistance:

```cpp
double base_damage = weapon->modified_damage();
int damage_multiplier = 100;
damage_multiplier += combat_modifier(...);      // time of day
damage_multiplier += leadership_bonus;
damage_multiplier *= resistance_modifier;
damage = round_damage(base_damage, damage_multiplier, 10000);
```

<https://github.com/wesnoth/wesnoth/blob/master/src/actions/attack.cpp>

**Weapon specials worth knowing:**

| Special | Effect |
|---|---|
| First strike | If only one side has it, that side strikes first regardless of who attacked |
| Backstab | Doubles the attacker's damage when an ally holds the hex directly opposite the defender — **and doubles the damage the attacker takes on the counter** |
| Charge | Doubles damage dealt *and* received, both directions |
| Poison | 8 HP at the start of the victim's turn until cured; does not stack; cannot take a unit below 1 HP |
| Slow | Halves damage output and doubles movement cost, cleared after the slowed side's next turn ends |
| Drain | Attacker heals half the damage it deals, capped at max HP |
| Marksman | A *floor* of 60% to hit on offence, ignoring worse terrain; real defence still applies if already better |
| Magical | Exactly 70% to hit, both directions, ignoring terrain entirely |
| Berserk | Forces the exchange to run up to 30 alternating rounds |
| Swarm | Strike count scales down with current HP — wounded units hit fewer times |

Since 1.15 most specials can also be authored as unit-wide abilities rather than
per-weapon, collapsing the old split except for plague, heal_on_hit and swarm.

> **For us.** "Ranged prevents the counter" and "first strike reorders the
> exchange" are cheap, legible, and generate real decisions — bait with ranged,
> finish with melee. Take three to five specials, not the roster: first strike,
> one double-edged damage doubler, one status effect, one reliability floor.
> Backstab is the interesting one for a three-drone squad, because it is the only
> rule that makes the *third* drone's position matter while two are fighting.

## 3. Zone of control, skirmisher, vision

**ZOC.** Every unit of **level ≥ 1** projects control into its six neighbours. An
enemy entering any such hex must stop, even with MP remaining — unless it began
the move already adjacent to that same unit, or has skirmisher. Level-0 units
project none. Allied ZOC never blocks.

<https://wiki.wesnoth.org/NWP:_ZOC>

**Skirmisher** ignores enemy ZOC entirely, letting it slip a defensive line and
reach the backline. It is the designed counter to a wall of bodies.

**Three separate concealment systems:**

- **Fog of war** — dynamic. A hex is fogged whenever nothing of yours currently
  sees it; terrain stays visible, units do not. It re-fogs as you leave.
- **Shroud** — one-way and permanent. Solid black until any unit sees it, then
  revealed forever.
- **Hidden units** — *ambush* is invisible until an enemy ends its move adjacent
  (which fires an "Ambushed!" alert), and reveals itself permanently on attacking;
  *nightstalk* is the same but night-only and **stays hidden even after
  attacking**; *submerge* is the deep-water version.

> **For us.** ZOC is the highest-leverage rule in the game per line of code — one
> adjacency rule turns a hex grid from a kiting puzzle into a game about lines and
> flanks. Port it, probably without the level ≥ 1 exception. Skirmisher is a good
> single mobility identity for one drone. The ambush layer needs bigger maps and
> rosters than we have; but note that our fiction supplies its own version — a
> derelict already has fog for free, and `hexmap.html` already knows what a hex
> cannot see through.

## 4. Villages, income and upkeep

**Capture is free.** Any unit that *ends its move* on a village not held by an
enemy takes it — no combat, no verb, no animation. An enemy-held village is
converted the same way. Taking undefended economy is a matter of standing there.

**Income, per side, at the start of a turn** — defaults shown, all WML-configurable:

```
income  = base_income + village_gold × villages_owned − upkeep
upkeep  = max(0, total_unit_levels − villages_owned × village_support)
```

- `village_gold` — 2 gold per village per turn.
- `village_support` — 1: each village supports one unit *level* for free.
- `total_unit_levels` — a level-3 unit costs 3 upkeep slots, a level-1 costs 1.
- Net income has a floor (commonly 1/turn), so a side is never starved to zero.

<https://wiki.wesnoth.org/SideWML>

**Healing.** A unit that *starts* its turn on a friendly village heals 8 HP and is
cured of poison, unconditionally. Compare healers, who heal adjacent allies 4–8
per turn, and curers, who remove poison.

**Recruitment.** Your leader must stand on a **keep** within a contiguous
**castle**; you then buy units onto empty connected castle hexes, limited by hexes
and gold. **Recall** is the same gesture but pulls a veteran with its levels, XP
and traits off a persistent list at a flat cost — recalling beats recruiting once
you have a list, and that is the whole campaign snowball.

> **For us.** The elegance is that a village is simultaneously income *and*
> upkeep relief *and* a hospital *and* 60% cover, and it is claimed by walking.
> Four roles on one tile is why the map is always worth fighting over.
> **Invert the polarity**: our nodes feed the *enemy's* spawn budget, so standing
> on one is not enrichment but denial — the same tempo tension (chase the kill or
> take the node) with the sign flipped. The leader-on-keep choke point is out of
> scope, but the upkeep curve is worth keeping in spirit as a soft cap against
> stalling. And note the healing rule: whatever repairs a drone should be a
> *place*, claimed and held, not an item — that is what makes territory matter.

## 5. Experience, levelling, AMLA

XP accrues from damage dealt, with a large lump for a kill roughly proportional to
the victim's max HP and small amounts for landed hits on higher-level foes.
Crossing the type's `experience` threshold advances the unit to a new type from
`advances_to=`: new stats, new attacks, often new abilities, a full heal, and **a
higher level** — which is the same number that gates ZOC and drives upkeep.

**AMLA** (After-Max-Level Advancement) catches units at their top type that keep
earning XP: instead of a new type, a small player-chosen bonus (commonly +3 max HP
and a full heal, sometimes +1 damage), then XP resets to zero against a raised
threshold. A diminishing-returns prestige loop.

<https://wiki.wesnoth.org/Unittypewml>

> **For us.** The coupling worth stealing is that level raises both power and
> running cost, so growth has an ongoing price rather than a one-time one. At
> three fixed drones, grow numerically in place rather than swapping types, and
> keep an AMLA-shaped trickle so late-run XP still means something after the
> ceiling.

## 6. Scenario and campaign structure

**Objectives** are declared per scenario — kill all enemy leaders by default, or
survive N turns, reach a hex, protect a unit. **Turn limits** end the scenario,
usually as a loss. **Early-finish bonus**: finishing before the limit pays unused
turns × a gold rate — literally refunding the income you would have earned by
turtling, explicitly to punish grinding. **Carryover**: a configurable fraction of
remaining gold (commonly 40%, sometimes 100% on hard, sometimes capped) moves to
the next scenario along with the full recall list — and late in a campaign the
recall list, not the gold, is the dominant asset.

<https://wiki.wesnoth.org/BuildingScenariosBalancing>

The stock AI recruits against the player's visible damage profile and treats
village-grabbing as a first-class objective on par with fighting, detouring idle
units to take unguarded ones — which is exactly why leader-rush strategies are
also a race against the AI's economy.

> **For us.** The early-finish bonus is a cheap anti-camping lever and it is
> thematically free: the reason to leave a derelict early is the reason to leave
> any derelict early. Carryover is how three fixed drones come to feel like they
> are building something across a run. And "the AI detours to take villages"
> becomes "hostiles detour to retake nodes" — which is what stops node-denial
> from being a one-way ratchet.

## 7. Randomness and the swinginess debate

Every strike is an independent Bernoulli trial: `roll = uniform(0,99); hit = roll <
cth`. No pity timer, no pseudo-random distribution, no guarantees. A 70%×4 attack
whiffs entirely 0.8% of the time, and both sides roll independently, so a heavily
favoured attacker can lose an exchange outright. Multiplayer syncs the seed across
clients — fairness by determinism-once-seeded, not by reduced variance
(`synced_rng` for MP, `rng_deterministic` for replays and tests).

<https://devdocs.wesnoth.org/random_8cpp_source.html>

`attack_prediction.cpp` exists because players and the AI want the real outcome
*distribution*, not an expected value: it builds a sparse matrix of
P(attacker HP = i, defender HP = j, slowed) and convolves each strike's hit/miss
branches, drain and swarm's HP-dependent strike count until the exchange resolves.
That is what powers the pre-attack damage chart.

<https://github.com/wesnoth/wesnoth/blob/master/src/attack_prediction.cpp>

**The debate.** One of the most litigated choices in the community — "my 70%
missed four times while their 30% countered three" recurs perennially, and both
sides run identical code; it is variance at small sample size. The community's own
read on the intended mitigation is that **splitting damage into 2–5 strikes is
itself the variance reduction**: one 70%-for-28 attack is far swingier than four
70%-for-7 strikes at identical expectation. The main community alternative is the
**"no randomness" add-on**, which makes every attack land for expected-value
damage — a 10-damage attack into 60% defence always hits for 4.

<https://forums.wesnoth.org/viewtopic.php?t=5932> ·
<https://steamcommunity.com/app/599390/discussions/0/1698300679776073208/>

How others solve it: pseudo-random distribution with a hidden luck counter (XCOM);
deterministic damage scaling (Into the Breach); many small rolls instead of one
big one (dice pools — variance falls as 1/√n at equal expectation); or no change
at all plus a full-information prediction UI, which measurably reduces the
*feeling* of unfairness without touching the odds.

> **For us — the highest-value section.** At three drones a bad roll costs a third
> of the army, so a straight port is riskier than it is in Wesnoth. In order of
> how much randomness you want to keep:
>
> 1. Keep hit/miss but decompose damage into several small strikes. This alone
>    tames most of it.
> 2. Show the whole outcome distribution before committing. Cheap at this scale
>    and it fixes the perception problem directly.
> 3. Consider deterministic damage as the *default* rather than an add-on.
>    Terrain and resistance still matter — they scale expected damage — but a run
>    of bad luck can no longer delete a third of the squad.
> 4. Or a pity-adjusted roll, for the "it was due" feeling without full
>    determinism.
> 5. Whatever the maths, seed the RNG deterministically per turn. Undo, replay and
>    a shareable seed all depend on it, and this project already treats a seed as
>    the thing you send someone.

## Port / adapt / drop

| Mechanic | Verdict |
|---|---|
| Terrain defence, defender-only | **Port** — cheap, legible, high value |
| Damage-type resistance | **Adapt** — two or three types, or drop |
| Zone of control | **Port**, probably without the level ≥ 1 exception |
| Skirmisher as ZOC-ignore | **Port** as one drone's identity |
| Ranged avoids the counter; first strike | **Port** — cheap, high impact |
| Backstab / charge double-edged specials | **Adapt** — one or two |
| Poison / slow | **Adapt** — pick one status, not several |
| Ambush, fog, shroud | **Drop as written** — but the derelict supplies its own |
| Village income and upkeep | **Invert** — nodes feed enemy spawn budget |
| Leader, keep, recruit, recall | **Drop** — out of scope |
| XP and levelling coupled to upkeep | **Adapt** — numeric growth, soft cost |
| AMLA | **Port in spirit** |
| Early-finish bonus, carryover | **Port** — anti-stall and run progression |
| AI detours to take villages | **Port**, reframed onto nodes |
| Independent per-strike Bernoulli | **Reconsider** — see §7 |

## Links

[Terrain Defence](https://wiki.wesnoth.org/NWP:_Terrain_Defence) ·
[ZOC](https://wiki.wesnoth.org/NWP:_ZOC) ·
[Abilities](https://wiki.wesnoth.org/Abilities) ·
[Glossary](https://wiki.wesnoth.org/Glossary) ·
[SideWML](https://wiki.wesnoth.org/SideWML) ·
[UnitTypeWML](https://wiki.wesnoth.org/Unittypewml) ·
[BuildingScenariosBalancing](https://wiki.wesnoth.org/BuildingScenariosBalancing) ·
[attack.cpp](https://github.com/wesnoth/wesnoth/blob/master/src/actions/attack.cpp) ·
[attack_prediction.cpp](https://github.com/wesnoth/wesnoth/blob/master/src/attack_prediction.cpp) ·
[random.cpp](https://devdocs.wesnoth.org/random_8cpp_source.html) ·
[Backstab](https://wesnoth.fandom.com/wiki/Backstab) ·
[Slows](https://wesnoth.fandom.com/wiki/Slows) ·
[Magical](https://wesnoth.fandom.com/wiki/Magical) ·
[Advanced Tactics](https://wiki.wesnoth.org/Advancedtactics)

**Licence note.** Wesnoth is GPL-2.0 (code) with the wiki under its own terms.
Mechanics are not copyrightable; *text, unit stats as authored data, and art are*.
Reimplement, do not copy files.
