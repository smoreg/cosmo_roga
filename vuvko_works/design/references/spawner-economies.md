# Spawners fed by resource nodes

Research dump, 2026-09-09. Precedents for enemies produced by map objects rather
than placed by hand, and what each does about the "fight the source or the
symptoms" question.

## The survey

**Wesnoth villages.** 2 gold a turn, plus free upkeep for one unit level. Income
tap and maintenance cap in one tile. **No destructible source** — only
recapturable — so there is possession pressure but no attack-the-source tension.
Known meta failure: cheap level-0 units let a faction rush-grab villages without
denting its own upkeep, which snowballs.
<https://wiki.wesnoth.org/BuildingScenariosBalancing>

**Warcraft III gold mines.** A rising "gold tax" cuts the percentage actually
collected as army and food grow — a soft cap that only more mine control offsets.
Contested mines are creep-guarded, so seizing a source carries upfront combat risk
before any economic payoff.
<https://warcraft.wiki.gg/wiki/Gold_Mine_(Warcraft_III)>

**Dawn of War strategic points.** Auto-generate requisition and power, boostable
with a listening post — and **income decays over time toward a floor of roughly a
third**. An explicit anti-turtle device: one capture never scales forever, so the
reward is continuous aggressive expansion rather than possession.
<https://dow.fandom.com/wiki/Strategic_Point>

**Company of Heroes territory chains.** Territories must form an unbroken chain
back to HQ. Taking one link **instantly and completely cuts off everything beyond
it** — no gradual drain, a same-tick boolean, flagged by blinking sectors on the
minimap. Severing supply is a decisive mid-fight strike. The direct opposite of
Dawn of War's gradualism, and the two are worth reading as a deliberate fork.
<https://companyofheroes.fandom.com/wiki/Resources>

**Doom Eternal gore nests — the closest structural precedent.** A nest is the
"umbilical cord to Hell" gating an area's demon presence. **Attacking it raises an
alarm that siphons in more demons before it dies**; destroying it fully and
permanently stops the stream. Front-loaded risk, back-loaded total reward. Note
that Doom 2016 has no destructible spawners — this mechanic is Eternal's.
<https://doomwiki.org/wiki/Gore_nest>

**Nex Machina.** Splines, portals and area spawners mixing time-based and
kill-triggered events. Housemarque deliberately **avoided many independent
long-timer spawners** because simultaneous uncoordinated timers become illegible.
No destructible sources — pure symptom-fighting.
<https://www.gamedeveloper.com/design/game-design-deep-dive-maintaining-tension-in-i-nex-machina-i->

**RimWorld raid points.** A piecewise-linear function of colony wealth —
negligible under 14k, about 1 point per 160.83 wealth up to 400k / 2400 points,
diminishing beyond, hard cap 10k points at 1M — times a difficulty multiplier.

The documented degenerate response is the important part: players **actively avoid
accumulating wealth**, exporting by caravan, disassembling valuables, or modding
wealth out entirely, because "a well-run stockpile becomes a war crime against
yourself." There is a mod called HideYourWealth.
<https://rimworldwiki.com/wiki/Raid_points> ·
<https://github.com/Void-n-Null/HideYourWealth>

> **The single loudest warning in this document for a looting game: never let
> carrying loot be the thing that raises spawn pressure.** You will get players who
> optimise toward looting nothing.

Dwarf Fortress corroborates from a different angle: wealth and population gate
*eligibility* for sieges, but proximity of hostile civilisations matters as much,
and player-initiated raids provoke retaliation.

**Left 4 Dead's AI Director.** Michael Booth's GDC 2009 talk calls it "Structured
Unpredictability": simple, independently playtestable population functions layered
together rather than one opaque system, driven by a per-survivor *emotional
intensity* estimate that rises with danger and decays after. Hordes spawn at
randomised 90–180 s intervals, off-screen, behind the party. The Director
deliberately **backs off after a hard fight** to let stress relax before ramping
again — peaks and valleys, not monotonic escalation.
<https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf>

**Tower defence.** Structurally separates source from symptom and conventionally
makes the portal **untouchable**; multiple portals carry independent wave budgets.
No documented "camp the spawn" failure mode exists in the genre — *precisely
because* the genre never exposes an attackable source. A load-bearing negative
precedent: making nodes attackable reintroduces a risk that tower defence designs
away entirely.

**Into the Breach emergence tiles — the best turn-based telegraphing model.** A
spawn tile is marked a full turn before the Vek appears, showing location and,
through icons, the intended target. Standing on the tile deals 1 damage and
**delays rather than reliably prevents** emergence, and costs a full unit-turn on
an immobilised blocker — so spawn-blocking never scales into a strategy, because
more tiles keep appearing. The design intent, per analysis: *"not asking you to
dominate the turn — asking you to survive it cleanly enough that the next turn
stays solvable."*
<https://intothebreach.fandom.com/wiki/Spawn_Tile>

## Lessons

- **Telegraph location and consequence one full turn ahead**, and make blocking
  cost something real so it never fully solves an encounter.
- **Budget ranking.** Node-output-based spawn budget (each live node adds an
  increment to its zone, Dawn-of-War-style decaying toward a floor) fits the
  premise naturally. Layer one global heat meter over it, L4D-style, so overall
  pacing can rise *and fall* — otherwise you get Nex Machina's illegible pile of
  uncoordinated timers.
- **Instant or gradual cutoff is a real fork; pick deliberately.** CoH's same-tick
  cutoff makes severing supply a turn-defining strike, which suits a heist pace.
  DoW's decay makes holding territory a longer investment.
- **The recommended combination**: instant full stop on node destruction, plus
  Doom Eternal's alarm spike while you are killing it. The turn or two spent
  destroying a node should visibly raise local pressure first, so attacking the
  source is a genuine gamble rather than a strictly dominant move.
- **Guard against rushing every node on turn one** — the lesson tower defence
  avoids by never offering the option. Choices: gate node vulnerability behind a
  condition, defend nodes with something that punishes a rush, or rubber-band the
  remaining nodes upward when one dies (the reverse of DoW decay).
- **Design the three-way choice explicitly**: fight the source (permanent, high
  risk, alarm spike), fight the symptoms (safer per turn, stops nothing), or leave
  the zone (and lose whatever loot it gated). Doom Eternal is the cleanest model of
  all three being live at once.
