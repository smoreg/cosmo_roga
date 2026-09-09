# Attribution notices

## Current status of the generators in this project

`shipyard.html` and `navmap.html` contain **no third-party content**. Deck plans
are drawn procedurally; all room names, descriptions, items and hazards are
original text.

`geomorphs.html` *draws* third-party artwork but does not carry any: it reads a
copy of the RPG Mobius Geomorphs that you download and unpack yourself, and the
archives and the unpacked folder are gitignored. The notice it needs is below
and is already printed under the plan in the page itself. **CC BY-NC — anything
built with those tiles has to stay non-commercial.**

Keep this file updated as you pull material in.

---

## If you use Starforged oracles (CC BY 4.0)

Required by the licence — attribution, with a link, and an indication of whether
you changed anything:

```
This work is based on Ironsworn: Starforged, created by Shawn Tomkin, and
licensed for our use under the Creative Commons Attribution 4.0 International
license. https://creativecommons.org/licenses/by/4.0/
```

Add "Modified from the original." if you edited entries — you almost certainly
will, and the licence requires you to say so.

**If you use the CC BY-NC-SA rulebook text instead**, the notice changes and your
project must be non-commercial *and* ShareAlike-licensed. Don't mix the two up;
check which document each table came from.

---

## If you use Datasworn JSON

Content and code carry different licences, so cite both:

```
Game content from Datasworn (https://github.com/rsek/datasworn), which provides
Ironsworn and Ironsworn: Starforged data in JSON. Textual and image content is
CC BY 4.0 or CC BY-NC 4.0; schema, typings and tooling are MIT.
```

Filter on the `source` property embedded in the JSON objects to keep NC-licensed
entries out of a commercial build.

---

## If you use Cepheus Engine / Traveller SRD material (OGL 1.0a)

The OGL requires you to reproduce **the full text of the licence** in your
product and to update Section 15 with the copyright notice of everything you
copied from. A one-line credit is not sufficient. Include:

```
This Product is derived from the Traveller System Reference Document and other
Open Gaming Content made available by the Open Gaming License, and does not
contain closed content from products published by either Mongoose Publishing or
Far Future Enterprises. This Product is not affiliated with either Mongoose
Publishing or Far Future Enterprises.
```

If you additionally claim Cepheus compatibility under the CSL, then on the first
page where you mention it:

```
Cepheus Engine and Samardan Press are the trademarks of Jason "Flynn" Kemp, and
we are not affiliated with Jason "Flynn" Kemp or Samardan Press™.
```

---

## If you use Geomorph Shipyard code (GPL-3.0)

Copyleft. Distributing a derivative means releasing your source under GPL-3.0,
including the full licence text and a statement of changes. If your project must
stay closed, reimplement from the documented behaviour instead of copying code —
algorithms aren't copyrightable, source is.

---

## If you use Starship Geomorphs artwork

No standard notice exists, because no formal licence exists. Credit both the
artist and the converter:

```
Deck plan tiles from Starship Geomorphs by Robert Pearce
(travellerrpgblog.blogspot.com). Image conversion by Eric B. Smith.
```

**Get written permission before any commercial use**, and do not redistribute
the image files — link users to Pearce's blog to download them.

---

## If you use the RPG Mobius Geomorphs (CC BY-NC 4.0) — required by `geomorphs.html`

The Mobius repack ships an explicit licence, which the loose Starship Geomorphs
downloads did not. Checked 2026-09-09 in `license.txt` and `readme.txt` inside
all three archives:

```
Deck plan tiles: RPG Mobius Geomorphs by RPG Mobius (rpgmobius.com), a
recolouring of the PNG rendition by Eric B. Smith (gurpsland.no-ip.org/geomorphs)
of the Starship Geomorphs by Robert Pearce (travellerrpgblog.blogspot.com).
Licensed CC BY-NC 4.0 — https://creativecommons.org/licenses/by-nc/4.0/
Tiles arranged by this generator; the artwork itself is unmodified.
```

If you also unpack Eric B. Smith's **Adventure Class** geomorphs
(`gurpsland.no-ip.org/zip/Geomorphs/AdventureClass.zip`) — the SE/HG/LS/Sh ship
parts — the same CC BY-NC 4.0 terms apply, minus the Mobius recolouring:

```
Ship parts: Adventure Class Geomorphs by Robert Pearce, PNG rendition by
Eric B. Smith (gurpsland.no-ip.org/geomorphs). CC BY-NC 4.0.
```

Three conditions come with it:

- **Non-commercial only.** Not "free to download" — the licence forbids use
  primarily aimed at commercial advantage. A paid or ad-funded game is out.
- **Say you changed it.** Arranging tiles into a plan makes Adapted Material;
  the line above does that.
- **Do not repackage the PNGs** into anything you distribute. Point people at
  rpgmobius.com and have them download it, which is what the page does.

---

## If you take design from Geomorph Shipyard (GPL-3.0)

<https://gitlab.com/IvanSanchez/geomorph-shipyard> · Iván Sánchez Ortega

`geomorphs.html` reads no code from it. What it takes is *how the problem is
solved* — that a ship is one fore end, one hull centre, one aft end and one
mirrored pair of sides placed centred on the hull, and that its saved-file
format is worth speaking. Ideas and file formats are not the licensed thing;
its source is, and none of it is copied here. If you ever paste code across,
the whole page becomes GPL-3.0 and has to ship its source.

No notice is required for reading it. Credit it anyway — the page does.

---

## If you use Mothership / Dead Planet tables

Do not paste a notice and hope. Sign the agreement and get the manuscript
approved first — see [restricted.md](restricted.md). The required copyright and
compatibility statements, and the correct compatibility logo, come with the
licence packet.

---

## If you use Derelict Ship Generator output

Its author granted use of the generated map images for your projects. Credit as
a courtesy:

```
Derelict maps generated with Derelict Ship Generator by Alammo
(delacannon.itch.io/derelict-ship-generator).
```

This covers the images only, not the Mothership table text they were built from.
