# Derelicts, remote drones and salvage: tone references

Research dump, 2026-09-09. Games, tabletop and film for the "you are not there,
you are operating a machine" problem.

## Duskers — the central precedent

Up to four drones piloted by typed commands (`Nav 1 R2`) or point-and-click.
Tim Keenan of Misfits Attic deliberately rejected a slick drag-select interface:

> *"I was just missing an opportunity to convey [isolation]."*

The command line forces the player to speak in the drone's language, which
mechanically enacts the distance between operator and machine.
<https://www.gamedeveloper.com/design/road-to-the-igf-misfits-attic-s-i-duskers-i->

**Sensors give a filtered view only.** Motion sensors register "something is out
there", never what. Cameras are low-resolution and narrow. "Knowledge is the most
important resource of all."

**Drone loss is resource loss, not character death.** Drones are destroyed by
radiation, vented into space, or torn apart by something you never see. The run
ends only when *all* drones are broken.

No soundtrack, by design. Cited influences: *Alien*, *Moon*, *The Road*.

**What critics said worked**: RPS called it "a better Alien game than any official
Alien game", praising the way careful plans collapse into chaos.

**What did not**: visually samey procedural ships with illogical layouts; a slow,
unrewarding early game where a bad opening roll can define a whole session; and
command-line opacity where "a single typo could have devastating consequences" read
as aggravation rather than tension.
<https://indiegamereviewer.com/review-duskers/>

## Tabletop

**Mothership.** Stress and Panic — roll under current Stress to trigger a
Condition. Its stated philosophy is the opposite of hiding things:

> *"Giving information to players is crucial for informed and thus interesting
> decisions."*

The Warden describes threats and consequences *before* commitment. Dread comes
from full understanding with no good option, not hidden maths. Combat percentages
are deliberately low, around 26–45: **if you are fighting, you are losing.**
<https://forestoath.bearblog.dev/how-violence-actually-works-in-mothership/>

**Alien RPG — Stress Dice.** Every roll adds d6s equal to current Stress. They
count toward success — stress sharpens you — but rolling a 1 forces a Panic Roll
and blocks further pushing. A one-directional ratchet of escalating commitment.
<https://app.demiplane.com/nexus/alienrpg/rules/stress>

**Death in Space.** Void Points are a failure currency spendable for re-rolls, at
the risk of Void Corruption. The core threat is scarcity plus an ambient
technology-corrupting static, and gear and ship decay make **maintenance itself a
survival pressure**.

## Sensors that lie

**Alien: Isolation's motion tracker** is the reference implementation. It tracks in
3D but displays only 2D — diegetically explained as built for search and rescue,
not combat. It will not register a stationary target. It has a hard range limit.
And **it emits audible noise the Alien can hear**: using your sensor betrays you.
The AI Director always knows both positions and nudges the Alien toward your
general area without ever revealing exact position, tracking a menace gauge over
time. The framing: *scarier when you do not have enough information than when you
have none.*
<https://www.gamedeveloper.com/design/revisiting-the-ai-of-alien-isolation>

**Objects in Space** splits critical data across instrument screens requiring
active scanning rather than a unified HUD, and makes sound the primary detection
medium — praised for "the tense atmosphere of submarine movies".

**Signalis** does most of its atmospheric work with ambient hums, static and a
mistuned radio that mostly returns noise, so a real signal feels earned. Its
**ambient audio state signals detection status directly** — calm hum shifting to
discordant mechanical noise when spotted. Cheap and always on.

## Ships as antagonists and as workplaces

**Dead Space** uses environmental wall-writing as lore and tutorial at once, and an
"intensity director" that adjusts necromorph spawns *and* light, smoke and sound to
modulate pacing.

**Event Horizon** — the monster is the ship. Evil acts through human intermediaries
in familiar voices rather than as a creature, in disorienting gothic-cathedral
geometry deliberately built to feel opaque and secretive rather than ergonomic, and
is left unexplained.

**Hardspace: Shipbreaker** — salvage as indentured labour. Every shift's pay is
docked for equipment rental, making the economic squeeze a moment-to-moment
mechanic. Tools are mundane industrial equipment and the danger is physics, not
monsters.

**Sunless Sea / Skies** — scarcity as a literal risk clock. Failbetter's own
postmortem is the useful part: early Skies playtests felt **empty** because void
space is naturally boring rather than dreadful unless actively populated. A direct
caution about long empty corridors.
<https://www.failbettergames.com/news/shaping-the-universe-quintessence>

**Heat Signature** — permadeath loses all current gear and money, which the
developers call essential to the risk/reward tension; ship floors and rooms are
invisible until hacked or scouted, so information is revealed progressively across
an otherwise fully visible map.

## The deck-plan tradition

Traveller's deck plans (1977) and Star Wars co-founded the convention of a
grid-scaled ship plan as a tactical map — roughly one square to a metre, rooms
organised by function. Worth noting because it puts **"the rooms are the map, the
hexagons are guidance"** in a decades-old legible lineage rather than making it a
novel risk.
<https://wiki.travellerrpg.com/Deck_Plan>

## Lessons

- **The interface should perform the distance.** Commanding a drone should not feel
  as fluid and omniscient as commanding a soldier. But note the Duskers critique:
  put the friction in the drone's *senses and behaviour*, never in raw UI
  legibility, or it reads as aggravation.
- **Drone loss is resource loss.** This lets danger escalate far past what a
  character-death game tolerates. Each drone is a sunk cost — upgrades, carried
  loot, map position — whose destruction is a real setback that does not end the
  run.
- **Sensors need a diegetic flaw.** Blips by direction and radius rather than exact
  hex; no reading on something that has stopped moving; and an active scan that is
  itself detectable.
- **Informed dread, not withheld numbers.** Be transparent about rules and stats
  once something is spotted. Hide position and composition, not mechanics.
- **Escalating commitment is portable.** Stress Dice and Void Points map cleanly
  onto a drone overclock: push sensors, weapon or speed for a turn against an
  accumulating detectability or malfunction meter.
- **The ship should read as a threat**, through environmental storytelling and a
  spawn system that behaves like an immune response — not as a level container. And
  heed Failbetter: an empty derelict is boring, not dreadful.
- **Audio state should track alert state.** Cheapest tension signal available.
- **Duskers' pitfalls are avoidable by design, not luck**: indistinguishable
  procedural rooms, a slow opening where one bad roll defines the session, and
  friction misplaced into the interface.
