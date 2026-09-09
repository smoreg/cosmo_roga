# Derelict / starship generator sources

Reference material for the deck-plan generator (`shipyard.html`) and the
navigation-graph game map (`navmap.html`).

Compiled 2026-09-09. Licence terms change — **re-verify before you ship
anything commercial.** Every entry below records the date I checked it and
whether I read the licence text itself or only a summary.

## Files

| File | Contents |
|---|---|
| [geomorphs.html](geomorphs.html) | Deck-plan generator built from the RPG Mobius Geomorphs tiles |
| [open-licensed.md](open-licensed.md) | Sources you may reuse and modify, with conditions |
| [restricted.md](restricted.md) | Permission-required, non-commercial, or unclear |
| [design-notes-connectivity.md](design-notes-connectivity.md) | How other generators model rooms, links and narrative |
| [ATTRIBUTION.md](ATTRIBUTION.md) | Notices to paste if you use any of this |

## geomorphs.html

Three ways to build, all seeded, so a plan is a link.

### Ship — the Geomorph Shipyard recipe

[Geomorph Shipyard](https://gitlab.com/IvanSanchez/geomorph-shipyard) (GPL-3.0)
solves this problem properly, so I read how, rather than guessing. Two things
carry the design.

**Its part library is indexed by connection topology, not by folder.** Each
entry is `{url, mirrorUrl?, sizeX, sizeY, tons, uses:{category: dTons},
facilities, overlayUrl?}`, and the files are split by role: `SEF`/`SEA` short
ends fore and aft (a cap, one connection — from SE-320 up some are "wrappers"
with three), `HG`/`LG`/`QG`/`Sh` hull centres, `LC`/`SC`/`HC` cores (connections
fore and aft only), `LS`/`SS`/`AO` sides and add-ons (symmetrical, hence the
`mirrorUrl`), plus `M`/`TG`/`DV` misc, transition and dorsal, `As` asteroid and
`UG` unique hulls. The `uses` map is what lets it total real Traveller tonnage.

**Its generator (`src/lib/geomorphs/tinyRandomShip.js`) is five parts.** One fore
end, one hull centre, one aft end, and — on a coin flip — one pair of sides,
mirrored, placed **once and centred on the hull**, not repeated down it. Then it
rerolls, up to ten times, unless the ship came out with both bridge and
engineering space. That is the whole shape of a ship: a head, a body, a tail,
and wings that are shorter than the hull.

This page now builds the same way. It also reads the same files — see below.

### Ship — Mobius tiles

The same recipe where the Adventure Class parts are not installed: a `[100x100]`
End as the bow cap, cores for the hull, an End turned 180° for the stern, and one
mirrored **Port/Starboard** pair from the archive's own hull-side system (AF01–AF13
aerofins and wings, A103–A140 sides, Concorde and shuttle profiles up to 300 ft
gunnery decks), centred on the hull. Two lines ship their own bow and only their
own bow fits — AF13's `[100x100]` nose continues its flanks' diagonal exactly, and
the A1xx sides meet the pointed bow assembly (`[100x50]` transition, `[50x50]` tip,
`[25x50]` fuel cheeks) — so those get theirs and everything else uses the End cap.

### Deck

The rectangular slab: cores in the bays, edge strips down the flanks,
quarter-round corners, nose and tail caps, the occasional double-width
megamorph. For a deck of a big ship or a station, where there is no silhouette
to respect. Sections are filled by role in every mode — bridge and sensors
forward, engineering and fuel aft, quarters and cargo between, gunnery on the
flanks.

### Adventure Class parts — optional

Nothing here needs them. The page builds ships from the Mobius tiles alone;
Adventure Class is an extra set you can opt into from the **Tiles** list, and it
never takes over on its own.

The `SE-`, `HG-`, `LS-`, `Sh-` parts Shipyard names are **not** in the Mobius
repack; they are Pearce's Adventure Class ships, rendered by Eric B. Smith:

```
curl -O https://gurpsland.no-ip.org/zip/Geomorphs/AdventureClass.zip
unzip AdventureClass.zip -d geomorphs/AdventureClass
```

(mirror: `https://gurpsland.sytes.net/zip/Geomorphs/`.) Choose *Adventure Class*
in the Tiles list and ship mode uses the real fore/aft ends, hull centres and
mirrored sides, and reports each part's own dTons instead of estimating from
area. It is also what lets a ship saved from Geomorph Shipyard open here. Same
CC BY-NC 4.0 terms.

Note the two sets are drawn for different backgrounds — the Mobius tiles are
recoloured for screen, the Adventure Class ones are the original line art — so
the page keeps a plan to one set rather than mixing them.

### How the tiles were sorted out

The archive tells you what is in a tile and, for four folders, what it is for.
It does not tell you which sides are the ship's skin — and the filenames are not
even reliable about geometry: `E762 [50x50]` is really 65×50 because the nose
curve overhangs its box, and the `[100x50]` files under "Bridge, Rounded Nose"
are 50 wide by 100 long. 217 tiles disagree with their own names.

The artwork does tell you. Tiles are line art on transparency at 60 px to a 5 ft
square with a 2-square bleed, so `geomorph_taxonomy.py` divides each tile into
squares and reads the boundary: a square on the edge either carries ink, meaning
structure reaches it and a neighbour may abut, or is empty, meaning the hull has
curved away and there is nothing to join. Four profiles, one per side:

```
Core 101   N ####################   all four sides join — an interior tile
Edge 301   N ######..+##+..######   voids where the hull curves off: skin north
Corner 503 N .....+####  W .....+####   skin on the top-left quarter
End 701    N ......+######+......   W/E void for 7 squares — a bow, joins aft
```

Where the art is silent — a straight hull wall drawn on the boundary looks
exactly like an interior wall — the four canonical folders fill in, flipped for
`[Mirror]` tiles. That is 1097 tiles read from the art, 408 from the folder, 221
free-standing objects, 63 defaulting to "joins anywhere".

The result agrees with the labels without being told them: every tile named
**Nose** comes out joining south, every **Port** joining east, every
**Starboard** joining west. And it sorts the folders that have no convention —
`Custom-Tiles/Bridge` resolves to 509 bows, `Custom-Tiles/Engineering` to 12
sterns, `Misc` to 48 wings, 43 corners, 20 bows and 62 interior tiles.

Each tile ends up with a shape — `core`, `cap`, `side`, `edge`, `corner`,
`spine`, `loose` — the sides that can take a neighbour, roles read from the
label (`drive`, `fuel`, `command`, `weapon`, `bay`, `quarters`, `service`,
`green`, `vertical`, `airlock`), and a `needsSkin` flag for the things that have
to open onto space: hangar mouths, airlocks, fuel scoops, turrets.

```
python3 geomorph_manifest.py     # index the PNGs
python3 geomorph_taxonomy.py     # read their edges -> tiles.taxonomy.json
```

`tiles.taxonomy.json` is committed — it is derived metadata, no artwork — so the
page has the rules even before you unpack anything.

`fetch` is blocked on `file://`, so tiles loaded through the folder picker come
without it. The page falls back to what the archive declares — the four
canonical folders' fixed orientation, Bridge for bows, Engineering for sterns —
and says which set of rules is in force in the tooltip on the tile count. Every
mode works either way; the art-read rules just choose better.

### Placement

With that loaded, placement is a fit test rather than a folder assumption. Each
slot knows which of its sides face other slots and which face open space. A tile
is legal in a slot if some rotation puts a joinable side against every neighbour;
among the legal rotations it prefers the one that also turns its skin outward,
and the slot says which shape it wants, so a wing stood on its end does not get
used as a bow. Nothing fits, and it relaxes the rule and counts the forcing in
the title block, so a thin pool shows up as "3 forced" rather than as a silent
mess.

This is what finds the mirrored corners the hard-coded rotations got wrong, and
what puts engineering sterns and nose-kit bows on a ship without a line of code
naming either folder.

### The atlas

[`geomorphs-atlas.html`](geomorphs-atlas.html) exists to be doubted: every tile
with its joinable sides in teal, its skin in red, the boundary profiles they were
read from, and filters for shape, folder, role, source and the two flags worth
checking — tiles whose names disagree with their art, and tiles that want open
space. Serve the folder and open it. If a classification is wrong you see it
there rather than three ships later.

### Saved ships

*Export JSON* and *Open JSON…* speak Shipyard's format:
`{name, parts:[{code, corner, rotation, mirror}]}`, corners in feet. Its ships
lie along X with the bow at −X on a Leaflet map, so its Y runs *up*; this page
runs the ship down the screen with Y down, and its rotation is counter-clockwise
where ours is clockwise. Both differences are reflections, so the conversion is a
plain transpose — `corner (x,y) ↔ (y,x)`, `rotation ours = (90 − theirs)` — with
no mirroring. Get that wrong and the plan still tiles perfectly; the ship just
comes out as its own mirror image, with the port wing on the starboard side.

With AdventureClass unpacked, a ship saved from Geomorph Shipyard opens here
part for part, tonnage included.

## The short version

**Safe to build on commercially, with attribution:**

- **Datasworn / Ironsworn: Starforged oracles** — CC BY 4.0 for the Reference
  Guide text, MIT for the schema and tooling. Machine-readable JSON. This is
  the single best drop-in source of derelict room-and-narrative tables.
- **Cepheus Engine SRD** — OGL 1.0a. Whole-cloth open sci-fi ruleset with ship
  design, descended from the Traveller SRD.
- **Geomorph Shipyard** — GPL-3.0 code (the *code*, not the artwork).

**Free to use but not to redistribute or resell:**

- Starship Geomorphs artwork, the Derelict Ship Generator's output.

**Needs a signed licence and manuscript approval:**

- Anything built on Mothership's tables, including *Dead Planet*.

All links checked 2026-09-09. Two return 403 to automated requests but load fine
in a browser: the Tuesday Knight Games help centre (Zendesk) and DriveThruRPG.

## Note on the difference that matters

Several of these draw a hard line between **"free to download"** and **"free to
reuse."** *Stars Without Number* has a free PDF; that is a price, not a licence.
Mothership's tables are widely used by fan tools; that is tolerance, not
permission. Where I could not confirm a licence grant, the entry says so
rather than guessing.
