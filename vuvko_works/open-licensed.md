# Open-licensed sources

Reusable and modifiable, subject to the conditions listed. Verification dates
are when I read the source; "read licence text" means I saw the actual terms,
"read publisher statement" means I saw the publisher describing them.

---

## Ironsworn: Starforged — oracle tables

<https://tomkinpress.com/pages/licensing> · Shawn Tomkin / Tomkin Press

**The most directly useful source on this list.** Starforged has derelict
oracles structured almost exactly the way you need: a derelict has a *type* and
*condition*, then breaks into **zones**, and each zone yields **areas** with
their own feature, peril and opportunity rolls. That is a room-graph with
narrative content attached, already designed and playtested.

Two licences, and the split matters:

| Content | Licence | Commercial use |
|---|---|---|
| Starforged Reference Guide — moves, rules summaries, **oracles** | CC BY 4.0 | Yes |
| Asset card text, game handouts | CC BY 4.0 | Yes |
| Complete text of the Starforged rulebook | CC BY-NC-SA 4.0 | No |
| Ironsworn SRD (ch. 1–3 + some oracles + sample NPC) | CC BY 4.0 | Yes |
| Ironsworn: Delve moves, oracles, theme/domain cards | CC BY 4.0 | Yes |
| Complete text of Ironsworn: Delve | CC BY-NC-SA 4.0 | No |
| Complete text of Sundered Isles | CC BY-NC-SA 4.0 | No |

The publisher's own summary: if you're sharing with the community at no cost
you're covered by CC BY-NC-SA; the CC BY licence covers specific elements for
use in commercial products.

**Practical reading:** the oracles are CC BY, so you can lift table entries into
a commercial generator with attribution. The surrounding rulebook prose is not.
Verified 2026-09-09, read publisher statement.

---

## Datasworn — the oracles as JSON

<https://github.com/rsek/datasworn> (current) ·
<https://github.com/rsek/dataforged> (legacy) · maintained by rsek, officially

Saves you the data entry. The predecessor repo covers 200+ oracle tables, 90
asset cards, 56 moves, 14 setting truth categories and 24 example encounters.

**Mixed licensing, and the repo is explicit about it:** the typings, JSON schema
and internal tooling are MIT; the textual and image content is CC BY 4.0 or
CC BY-NC 4.0. Crucially, **the JSON embeds licensing information in a `source`
property on objects throughout** — so you can filter programmatically for the
CC BY subset rather than guessing.

Typings available for C#, Go, Java, Python, Ruby and Rust via JSON TypeDef.

Note the current repo is a pre-release and warns of breaking changes on any
version bump until v1.0. Pin your version. Verified 2026-09-09, read repo README.

---

## Cepheus Engine SRD

<https://www.orffenspace.com/cepheus-srd/legal.html> ·
<https://cepheus-srd.opengamingnetwork.com/> · Jason "Flynn" Kemp / Samardan Press

An open 2d6 sci-fi ruleset — effectively open-source Traveller, with ship
design, world generation and a vehicle design system.

**Open Game License 1.0a.** All text is designated Open Gaming Content **except**
the trademarks "Cepheus Engine" and "Samardan Press", and the titles of Samardan
Press products, which are Product Identity.

Derived from the Traveller SRD and other OGL content; contains no closed content
from Mongoose Publishing or Far Future Enterprises, and is not affiliated with
either.

If you want to *claim compatibility*, that's a separate thing — the Cepheus
Engine Compatibility-Statement License (CSL) requires stating on the first page
where you mention it that Cepheus Engine and Samardan Press are trademarks of
Jason "Flynn" Kemp and that you are not affiliated with him or Samardan Press.

Modifiable DOCX and PDF on DriveThruRPG; HTML source on GitHub.
Verified 2026-09-09, read licence page.

---

## Geomorph Shipyard — code

<https://gitlab.com/IvanSanchez/geomorph-shipyard> · Iván Sánchez Ortega

**GPL-3.0.** SvelteKit + Leaflet, runs entirely client-side. Contains a
2,094-part manifest (`src/lib/geomorphs/*.json`) giving each geomorph its grid
size, displacement and functional breakdown, plus `tinyRandomShip.js`, an ~80-line
procedural assembler using rejection sampling for structural validity.

**The manifest is in the repo; the artwork is not.** One PNG ships with it. See
[restricted.md](restricted.md) for the geomorph images themselves.

GPL-3.0 is copyleft — if you distribute a derivative, you distribute your source
under GPL-3.0 too. Fine for an open tool, a problem for a closed commercial one.
Verified 2026-09-09, read LICENSE.txt in a clone.

---

## donjon

<https://donjon.bin.sh/scifi/> · <https://donjon.bin.sh/ogl.html>

Long-running generator collection: SciFi World Generator, Star System Generator,
Traveller System Generator, SWd6 System Generator, SciFi Name Generator, plus
Alien RPG and Blade Runner sections.

**"Some content used under the Open Game License"** — the OGL page is published
at the link above. This is a partial statement, not a blanket grant: some
generators carry third-party trademark notices instead (the SciFi Name Generator
notes Star Trek and Star Wars as registered trademarks of Paramount and
Lucasfilm respectively).

Separately, the **Code Library** at <https://donjon.bin.sh/code/> offers
generator source that is free to download and use, **though each carries its own
licence** — check per-file.

Treat output as usable, treat the tables as OGL-where-marked, and check any
specific generator before lifting its data wholesale.
Verified 2026-09-09, read site footers and OGL page.

---

## Traveller SRD

Referenced by Cepheus above. Made available under the OGL by Mongoose
Publishing. If you are working from Cepheus you already have the open subset and
generally don't need to touch this directly — Cepheus exists precisely because
Mongoose's current-edition community licence is awkward for third-party
publishers. Not independently verified this session.
