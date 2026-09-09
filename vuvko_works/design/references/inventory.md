# Small inventories in squad tactics

Research dump, 2026-09-09. How other games handle a hard-capped, one-item-per-slot
inventory, dual-purpose tools, and the loot-versus-carry decision.

## The survey

**XCOM 1/2.** Base soldiers get exactly **one** utility slot — a second only from
specific armour or faction abilities — and cannot equip two items of the same
category. Charges are small legible integers: single-use grenades, two or three
charge medkits. The slot is chosen blind, before the mission, before knowing enemy
composition. That is the whole precommitment device.
<https://xcom.fandom.com/wiki/Utility_Items_(XCOM_2)>

**Into the Breach.** Exactly **two weapon slots per mech**, a hard invariant, and
equipment competes for the *same* two slots as weapons. **No ammo at all** —
weapons are unlimited-use but slot-limited, which sidesteps spreadsheet fatigue
entirely; the only resource layer is permanent cores spent on a weapon already in a
slot. The GDC 2019 postmortem is explicit that mechanics were cut to keep a small
number of high-impact choices legible.
<https://www.gdcvault.com/play/1025772/-Into-the-Breach-Design>

**Darkest Dungeon.** A small shared party inventory where pre-mission provisions —
food, torches, shovels, curatives — and mid-mission loot compete for the *same*
slots. **The torch is the standout dual-purpose item**: light level affects combat
accuracy and crit *and* ambush frequency, one item with two simultaneous effects.
Tension stays coarse and legible ("did I bring enough food", a binary bad outcome)
rather than fine numeric optimisation. Two permanent trinket slots per hero, no
duplicates, sit alongside the consumables — a **two-tier split of permanent
loadout plus mission consumables**.

**Escape from Tarkov — the cautionary extreme.** A full Tetris grid nested in
containers, widely criticised as "not a shooter but an excel spreadsheet"; looting
opens a real-time, screen-blocking sub-interface that can get you killed while you
tidy up.
<https://reexile.wordpress.com/2021/04/06/why-is-escape-from-tarkov-not-a-shooter-but-an-excel-spreadsheet/>

**Invisible, Inc.** Agents start with 3 slots, +1 per Strength point, capping
around 7–8 with the eighth costing 1 AP — plus 2 (later 4) *permanent* augment
slots, the same two-tier structure as Darkest Dungeon. With only 4 shared
team-storage slots, "too much loot, not enough hands" is a documented complaint;
players drop-then-trade to work around the cap.

**Battle Brothers — the best dual-purpose precedent.** The pickaxe and pitchfork
are agricultural and mining tools reused as weapons, and the **billhook** is
literally "an agricultural tool adapted for battle", working as both a pull-in hook
and a blade. Durability degrades and is repaired through a slow, coarse background
"Tools and Supplies" resource rather than per-turn bookkeeping; ammo auto-refills
from a global stockpile after combat, so **only in-combat ammo is a live decision**.
That pattern — coarse background decay, legible in-combat counts — is the cleanest
answer to "tense turn to turn, no spreadsheet between missions".
<https://battlebrothers.fandom.com/wiki/Tools_and_Supplies>

**Mordheim.** Gold-for-gear forces "more warriors versus better gear". Critically,
**a warrior's equipment is lost forever if the warrior dies** — not merely "out of
action" — so putting good gear on a risky character is an actual gamble. Serious
injuries can permanently disqualify a character from equipment categories, tying
injury directly into loadout eligibility.

**Dungeons of Dredmor — negative precedent.** A nominally small grid fills fast
with near-identical stackable junk ("different kinds of cheese"); reviewers call
the limited inventory tedium rather than challenge. **A small slot count does not
help if the item catalogue behind it is large and undifferentiated.**

**Caves of Qud.** A continuous weight budget (15 × Strength) rather than discrete
slots, but the transferable logic is that mutation and equipment are two different
currencies solving the same problem, which pushes players to lean into one axis.

## The named failure modes

**Hoarding** is an analysed anti-pattern: loss aversion makes players bank
consumables until they are never used, which **punishes the cautious player
specifically** — experts spend items freely and are not punished for it. Known
fixes: decay or expiry so holding has an opportunity cost; diminishing returns on
stacking identical effects (City of Heroes' "Great Diversification", Diablo II's
per-point falloff) to kill dominant builds; and structural forced consumption —
Darkest Dungeon's torches and food burn down whether you like it or not.
<https://game-wisdom.com/critical/hoarding-bad-game-design>

## Lessons

- **Two tiers of slot**: one or two permanent build slots per drone, rarely
  changed, plus one or two mission slots chosen before launch.
- **Dual-purpose tools are the best anti-bloat lever, and must be mechanically
  obvious rather than flavour.** A cutter that opens hatches and fights passably is
  the billhook pattern — and it should be **strictly worse in a fight than a
  dedicated weapon**, so carrying it is a real trade rather than a free win.
- **Keep consumables coarse and integer, auto-replenished between missions.** The
  live decision is this mission, not the bookkeeping between them.
- **Make loot and equipped tools compete for the identical slot type.** That is the
  concrete mechanism that produces a real "too much loot, not enough hands" moment
  mid-mission, instead of a capacity number.
- **Loss on destruction, not just on failure.** Mordheim's rule is what makes a
  loadout choice weigh anything.
- **Prevent one dominant loadout by hard type-exclusion** (XCOM 2's no-duplicate
  rule) or diminishing returns, not by soft nudges — and use it to force role
  differentiation across the three drones.
- **Watch the Dredmor trap.** Keep the distinct item roster small. One item per
  slot only produces decisions if every item is meaningfully different; five grades
  of medkit smuggle the spreadsheet back in through catalogue depth.
- **Precommit blind to specifics, not blind to genre.** Show mission metadata —
  "hull breach likely", "hostile presence unknown" — so the loadout is a bet rather
  than a guess.
