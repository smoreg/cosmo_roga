# Design — inspirations, references, and ideas

Where game-design work for `vuvko_works` lives. The generators next door make
ships and maps; this folder asks what game is played on them.

The rule for `references/`: **each file is one source read properly**, with
numbers where numbers exist, links to where they came from, and — set off as
quoted notes — what is worth stealing and what should change. No secondhand
summaries of things nobody opened, and no design decisions smuggled in as facts.

## Files

| File | Contents |
|---|---|
| [substrate.md](substrate.md) | What `geomorphs.html` and `hexmap.html` already commit a tactical layer to |
| [derelict-extraction.md](derelict-extraction.md) | First idea: turn-based hex extraction with three drones |
| [rscore.md](rscore.md) | The budget that decides what a generated derelict is carrying |
| [alert-and-age.md](alert-and-age.md) | The two clocks: the ship noticing you, and the ship dying |
| [../prototype/](../prototype/) | The playable prototype of the tactical floor, on a real exported deck |
| [references/wesnoth.md](references/wesnoth.md) | Battle for Wesnoth — terrain, ZOC, the village economy, the RNG debate |
| [references/invisible-inc.md](references/invisible-inc.md) | Invisible, Inc. — the alarm and the two economies braided through it |
| [references/extraction-loop.md](references/extraction-loop.md) | The extraction loop as a genre, and what breaks when the humans are removed |
| [references/spawner-economies.md](references/spawner-economies.md) | Enemies produced by map objects — CoH cut-offs, gore nests, the L4D Director, ITB emergence |
| [references/inventory.md](references/inventory.md) | Hard-capped inventories, dual-purpose tools, and the named failure modes |
| [references/derelict-fiction.md](references/derelict-fiction.md) | Duskers, Mothership, Alien: Isolation — operating a machine you cannot see through |

## Ideas

**Derelict extraction** — turn-based hexagonal tactics in a generated derelict.
Up to three operating drones, an inventory of one-item slots, hostiles produced by
spawner zones fed by resource nodes you can cut. Wesnoth for the fight, Invisible
Inc. for the clock, Duskers for the fact that you are not there.

## Licence discipline

`open-licensed.md` and `restricted.md` in the parent folder set the standard for
this repository and it applies here too. Mechanics are not copyrightable; the text
that describes them, the numbers as authored data, and the art are. Everything in
`references/` is a reading, not a reproduction — reimplement, never copy files.
