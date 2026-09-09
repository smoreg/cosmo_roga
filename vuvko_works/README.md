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

### Setting it up

No artwork is in this repository — it is CC BY-NC and its authors ask that it
not be repackaged. One command fetches it from their own hosting, unpacks it,
indexes it and reads the tile edges:

```
cd vuvko_works
python3 fetch_geomorphs.py              # ~116 MB from rpgmobius.com
python3 -m http.server                  # open localhost:8000/geomorphs.html
```

Add `--adventure` for Geomorph Shipyard's own ship parts (+54 MB, optional).
`--check` verifies the links without downloading, `--only Symbols` fetches a
single set, `--keep-zips` keeps the archives instead of deleting them after
unpacking. Needs Pillow and numpy for the edge reading: `pip install pillow numpy`.

It takes the *Screen* colouring, not *Print* — Print is black line art for white
paper, and these pages draw on a dark ground where it would be invisible. The
Mobius archives sit on Google Drive behind the virus-scan interstitial, so the
script resubmits the confirm form the way a browser does; if that ever breaks,
`--check` says so and the links are on <https://rpgmobius.com/geomorphs>.

By hand works too. Unpack the three *Screen* archives into

```
vuvko_works/geomorphs/{Geomorphs,Custom-Tiles,Symbols}/…
```

then run `python3 geomorph_manifest.py && python3 geomorph_taxonomy.py`. With no
server at all, open the page and press **Load tiles…**, picking the `geomorphs`
folder — that also makes PNG export work.

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

### Ship — by section profile

Ship mode is one bay wide: a 100 ft spine with optional wings. This one takes a
profile — `2-1-2` is two bays wide, then one, then two, a waisted hull; `1-2-3`
tapers; `2-3-3-2` has a belly. Anything the tiles can close is allowed.

Bays are 100 ft and sit on the 50 ft grid the geomorph system is cut to, so a
section whose width has the other parity is centred half a bay across from its
neighbours — and the corridors still meet, because the connecting stubs are at
the quarter points of every tile edge. Counting the doorway gaps along 189 core
tiles puts the peaks at 25 ft and 75 ft, and a 50 ft shift maps one onto the
other. That is what makes `2-1-2` a legal hull rather than one with its middle
third bricked up.

The rim is not laid out by hand. Every 50 ft cell touching the outline becomes a
slot, straight runs merge into the 100x50 edge tiles that exist for them, turns
stay 50x50 for the corner tiles, and the fit test rotates each to face its skin
outward. What a slot wants is read off how many sides face another tile: one is
a cap, two adjacent a corner, three an edge, four a core.

**What the archive will not do.** There is no interior module below 100 ft. At
50x50 it offers 437 pieces with one joinable side and 345 with two — caps and
corners, all hull — 4 with three, and none at all with four. So a hull that
steps leaves shoulder cells wanting three or four joinable sides at 50 ft, and
those tiles do not exist. Leaving the shoulder open instead costs a 50 ft recess
in the outline and lets the pieces either side be the corners they already are:
that took `1-2-3`, `1-3-1`, `2-2-2`, `1-1-2-2` and `2-3-3-2` to placing every
tile legally. A symmetric pinch still forces a few — `2-1-2` one tile, `3-1-3`
four — where the bands from two wide sections meet around a narrow one. Forced
placements are counted in the title block, so you can see which profiles the
tiles are happy with.

**Symmetric across the keel.** The fit test judges each slot alone, so the port
and starboard corners came out as two unrelated pieces — correct, and obviously
arbitrary. Now a choice made for one side is mirrored to the slot opposite: the
archive draws many tiles twice, once `[Mirror]`ed, and that is the true
reflection; failing that a rotation usually lands on the reflected shape anyway,
since turning a corner whose skin is north-and-west by 90° gives north-and-east
with the lettering still the right way round. Every rim pair matches — the ones
that do not are the interior bays, left varied on purpose. Across the keel only:
bow and stern are not interchangeable. Turning it off in **Options** gives the
old per-slot choice.

**Smoothing a change of beam.** A step in a hull is a right angle, and a right
angle is what nearly every tile draws. `geomorph_taxonomy.py` now measures how
diagonally each hull line crosses its piece — `slope` is the share of rows where
the cut gets shorter, so a true 45° chamfer scores 1.0, and `cut` is how much of
the tile it removes. Across the whole archive only **23 tiles, 13 codes**, cut
their corner at all:

```
AF12  50x50   45% cut, slope 1.00   9876543210   a clean 45°, port and starboard
501   50x50   28% cut, slope 0.67   7643221000   a curve, fuel intake scoop
609   50x50   19% cut, slope 0.56   7432111000   a shallow cut
A103  50x100  46% cut, slope 0.47   99887766554433221100   a 100 ft taper over 50
AF13  50x100  45% cut, slope 0.47   99887766554433221100   the same, aerofin family
also 452, A122, A123, A130, E118-E121
```

They are almost all from the wing and aerofin families, which is consistent —
those are the pieces drawn as tapering flanks. Corners part-way down the hull,
where the beam changes, now prefer them; the bow and stern corners are left to
whatever suits, since there the right angle *is* the shape of the ship.

**A nose and drives.** Rimming the whole outline the same way gave a ship walled
in at both ends: an edge tile facing forward is a wall with a room behind it,
never a nose, and the drives never appeared because nothing asked for a piece
that is only a stern. The first and last sections are now capped with the same
`[100x100]` ends ship mode uses — which is where the archive keeps its bridges
and its engine rooms — and no rim is laid alongside them, since a cap already
carries hull on three sides and a strip beside it would make the slot read as a
corner. Toggle in **Options**.

Expect corner turrets. A convex corner takes a corner tile, and the archive's
corner tiles are mostly fuel scoops and gun positions drawn as triangles, so a
hull that steps twice grows four of them.

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
python3 fetch_geomorphs.py --adventure
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
python3 fetch_geomorphs.py       # downloads, unpacks, then runs both of these
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

## hexmap.html — the boarding map

`geomorphs.html` builds a ship. This asks the drawing where a player could
stand.

**The rooms are the map; the hexagons are guidance.** The tiles are line art on
transparency: walls and furniture are ink, floor is nothing at all. So the plan
rasterises into a mask at 12 px to a 5 ft square, and flooding the space inward
from the border separates vacuum from what it cannot reach. Each enclosed piece
is a zone — somewhere a body moves around without opening anything. Rooms whose
doorways the artist drew open come out as one zone, which is the honest answer:
if you can walk it, it is one space.

A hex grid then goes over the top, at a size you choose, default 50 ft, and from
there the lattice is the structure: hexagons are where you stand, and the walls
and doors between them are its edges. What the lattice does not decide is what
the ship contains — set it to 10 ft or 80 ft and the same 68 rooms are there
with the same names and contents; what changes is how finely they are divided
into places to stand, and therefore how many walls there are to draw. That
separation was worth getting right: when the zones were built from whichever
rooms happened to win a hexagon, a galley too narrow for one vanished and took
its doors with it, stranding the compartments beyond.

**Not every enclosed space is a room.** The flood finds the inside of a drawn
locker, the cavity between two consoles, the gap behind a bunk: on one deck 936
of 1052 came out under 50 square feet. The cutoff is 80 — about nine feet
square, smaller than a stateroom, bigger than a wardrobe — which leaves 68 rooms
holding 84% of the floor.

**Walls and doors are lattice edges, and only lattice edges.** A wall is the
edge between two hexagons in different rooms; the hull is the edge between a
hexagon and the vacuum; a door is a wall with a way through. An edge inside a
compartment is not a wall and stays the faint line of the hexagon itself. So the
map has one geometry rather than two, and the drawing is the same object the
movement rules read — the arrangement in `experiments/hullforms`.

Which walls have doors comes from the artwork. A crossing of three feet or less
with a different room on each side is somewhere a door can be; the thickness
cutoff is what stops the hull, the fuel tanks and the space between two hulls
from becoming doorways. Each connection then lands on the wall nearest where the
artwork drew it.

A room too small to hold a hexagon is absorbed into one, and **its connections
are absorbed with it**: a corridor five feet wide still lets you through, so the
contact graph is walked through the absorbed rooms and two hexagon-holding rooms
count as joined if the artwork links them directly or through nothing but
absorbed space. Without that the rooms such a corridor served were sealed, and
how many depended on the hex size — 14 at 25 ft against 6 at 50 ft. With it the
figure barely moves: 5, 7 and 8 sealed at 50, 25 and 10 ft.

Not every wall becomes a door — a deck where they all did would say nothing
about where you can go — so it keeps a spanning tree, which makes the ship
walkable, plus 45% of the rest for loops. That share is `LOOP_SHARE` from
smoreg's `experiments/hullforms/generate.mjs`, and it is there for the same
reason.

**Sealed rooms are reported, not fabricated.** Reachability is a walk over the
hexagons themselves — freely across a compartment, between compartments only
where a wall has a door — and 86–90% of them come out reachable. What does not
is usually right: air-raft bays and weapon mounts between two hulls are entered
through their own hatches. One galley on the test deck is genuinely stranded,
because the tile draws it with its door shut. Widening the cutoff from 3 ft to
8 ft recovers exactly one room and risks doors through fuel tanks, so the cutoff
stays and those rooms are marked `sealed`, drawn with a dashed red edge, counted,
and kept out of the choice of boarding point.

**Rooms name themselves** from the tile beneath them — "Fighter Bay Crossroad",
"Construction Deck - Upper" — and take their trade from that tile's taxonomy
roles. The seeded content pass furnishes each by trade: consoles and nav plots
in `command`, reactor taps in `drive`, footlockers in `quarters`, a hazard on
about one room in seven. Things are in rooms, not in hexagons — a 50 ft hexagon
covers a whole suite, and putting the toolrack in one would invent a position
the artwork never gave.

The lattice — pointy-top, axial `q, r`, six directions, odd-r offset — is the
one in `smoreg_works/experiments/hullforms/hexgrid.mjs`, reimplemented rather
than imported: that folder is a sandbox, and the two halves of this repo do not
reach into each other. A map from here and a hull from there are on the same
grid.

**Moving around.** Wheel to zoom about the pointer, drag to pan, both pages.
A click still selects — the gesture only counts as a pan once the pointer has
moved a few pixels. Zoom goes from a whole 600 ft hull on screen down to reading
the lettering on a locker.

**The plan is drawn from the tiles**, not from the raster the rooms were read
off. That raster is a fifth of native resolution, which is all the room-finding
needs and turns to mush the moment you zoom in; the tiles laid out as images
cost no more and stay sharp at any magnification. **Plan**, **Hexes**,
**Walls**, **Doors**, **Nodes**, **Vehicles** and **Names** each toggle
separately, so the deck plan can be read on its own or the lattice without it.

**Click any hexagon** and the inspector says what is under it: its axial `q, r`,
the room that owns most of it and that room's trade and roles, how much of it is
open floor, which other rooms it also covers, what the content pass left there,
whether anything is sealed or hazardous, the tile the artwork drew underneath,
and the doors leading out of what it covers.

*Export JSON* writes rooms, hexes and doors — each door carrying where it is in
feet and the two hexes either side — plus the tile provenance of every room.

### Sharing the model

`geomorph-core.js` holds everything both pages need — tile parsing, the library,
the taxonomy, the fit test, the layouts — and touches no DOM. Each page reads
its own controls and hands them to `layout(opts)`; what comes back is geometry.
A classic script rather than a module, because both pages must work from
`file://`, where module loading and `fetch` are equally refused.

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
