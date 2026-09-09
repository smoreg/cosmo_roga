#!/usr/bin/env python3
"""Work out where each Mobius tile can sit, by reading the artwork.

The filenames say what is in a tile; the folders say what a few hundred of them
are for. Neither says which sides are the ship's skin — and the names are not
even reliable about geometry: E762 [50x50] is really 65x50 because the nose
curve overhangs its box, and the [100x50] files under "Bridge, Rounded Nose"
are 50 wide by 100 long.

The alpha channel does say. Tiles are line art on transparency, drawn on a 5 ft
grid at 60 px a square with a 2-square bleed. Divide a tile into squares, and a
square on the content boundary either carries ink — ship structure reaches the
edge, so a neighbour may abut — or is empty, meaning the hull has curved away
and there is nothing there to join. Four profiles of that, one per side, are
enough to know how a tile may be placed:

    closed   every boundary square has structure   → an interior join
    shaped   some empty                            → the skin; face it outward
    void     almost all empty                      → outside the ship entirely

Run after geomorph_manifest.py; writes tiles.taxonomy.json next to the page.
"""
import json, os, re, sys
from collections import Counter, defaultdict

try:
    from PIL import Image
    import numpy as np
except ImportError:
    sys.exit("needs Pillow and numpy: pip install pillow numpy")

CELL = 60           # px per 5 ft square
ALPHA = 40          # ink threshold
INK = 0.10          # square is structure above this fraction of inked pixels
FAINT = 0.01        # below this the square is empty
SETS = ("Geomorphs", "Custom-Tiles")

# What a tile is for, read off its label and folder. Order matters only for
# reporting; a tile can hold several roles.
ROLE_WORDS = {
    "drive":    ["engineering", "eng ", "drive", "thruster", "power plant", "reactor", "plasma conduit"],
    "fuel":     ["fuel", "intake", "scoop", "tank", "refinery"],
    "command":  ["bridge", "station", "avionics", "sensor", "control room", "cic",
                 "combat information", "flight control", "stellar cartography", "communication"],
    "weapon":   ["gunnery", "turret", "missile", "weapon", "laser", "barbette",
                 "spinal", "particle accelerator", "fire control"],
    "bay":      ["cargo", "hangar", "bay", "hold", "launch", "shuttle", "air-raft",
                 "fighter", "docking", "landing pad", "helipad", "escape pod",
                 "drop capsule", "boat", "runabout", "vehicle"],
    "quarters": ["stateroom", "barrack", "low berth", "passenger", "galley", "mess",
                 "lounge", "fresher", "gym", "medical", "surgery", "suite", "brig"],
    "service":  ["repair", "shop", "lab", "office", "briefing", "computer", "security",
                 "storage", "locker", "classroom", "retail", "utility", "laundry"],
    "green":    ["arboretum", "hydroponic", "agricultur", "animal", "biosphere", "pool"],
    "vertical": ["elevator", "stairs", "lift", "vertical core", "catwalk", "gangway", "tram"],
    "airlock":  ["airlock", "iris valve", "cargo door", "bay door"],
}
# Things that only make sense against open space.
NEEDS_SKIN = ("bay", "airlock")
NEEDS_SKIN_WORDS = ["launch", "hangar", "landing pad", "helipad", "escape pod", "airlock",
                    "intake", "scoop", "docking", "turret", "gunnery", "missile",
                    "cargo door", "bay door", "drop capsule"]


def roles_of(tile):
    hay = (tile["label"] + " " + tile["path"]).lower()
    out = [r for r, words in ROLE_WORDS.items() if any(w in hay for w in words)]
    return out, any(w in hay for w in NEEDS_SKIN_WORDS)


def cell_ink(path):
    im = Image.open(path)
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    a = np.asarray(im)[:, :, 3]
    h, w = a.shape
    gh, gw = h // CELL, w // CELL
    if gh < 3 or gw < 3:
        return None, (gw, gh)
    a = a[:gh * CELL, :gw * CELL]
    g = a.reshape(gh, CELL, gw, CELL).transpose(0, 2, 1, 3).reshape(gh, gw, -1)
    return (g > ALPHA).mean(axis=2), (gw, gh)


def side_profile(v):
    """A boundary line as a string: # structure, + faint, . empty."""
    return "".join("#" if x > INK else ("+" if x > FAINT else ".") for x in v)


# Where the art is silent — a straight hull wall drawn on the boundary looks
# exactly like an interior wall — the four canonical folders still declare it,
# and every tile in them is drawn to the same orientation: bow north.
FOLDER_SKIN = {"edge": "n", "corner": "nw", "end": "enw", "core": "", "megamorph": ""}
MIRROR_FLIP = {"n": "n", "s": "s", "w": "e", "e": "w"}


def shape_class(attach, filled):
    """What the tile is, from the sides that can take a neighbour."""
    a = set(attach)
    if len(a) == 4:
        return "core"
    if not a:
        return "loose" if filled < 0.35 else "island"
    if len(a) == 1:
        side = next(iter(a))
        return "side" if side in ("e", "w") else "cap"
    if len(a) == 3:
        return "edge"
    if a in ({"n", "s"}, {"e", "w"}):
        return "spine"
    return "corner"


def classify(profile):
    n = len(profile)
    solid = sum(1 for c in profile if c == "#")
    empty = sum(1 for c in profile if c == ".")
    if empty >= n * 0.9:
        return "void"
    if solid >= n * 0.9 or empty <= max(1, n * 0.08):
        return "closed"
    return "shaped"


def analyse(root, tiles):
    out, skipped = {}, Counter()
    for t in tiles:
        full = os.path.join(root, t["path"])
        try:
            ink, (gw, gh) = cell_ink(full)
        except Exception as exc:
            skipped[type(exc).__name__] += 1
            continue
        if ink is None:
            skipped["tiny"] += 1
            continue
        # Trust the 2-square bleed over the filename: it is the one thing that
        # holds across the whole archive, and several names are transposed.
        cw, ch = gw - 4, gh - 4
        if cw < 1 or ch < 1:
            skipped["no-content"] += 1
            continue
        c = ink[2:2 + ch, 2:2 + cw]
        prof = {"n": side_profile(c[0]), "s": side_profile(c[-1]),
                "w": side_profile(c[:, 0]), "e": side_profile(c[:, -1])}
        sides = {k: classify(v) for k, v in prof.items()}
        # Anything drawn out in the bleed sticks past the tile's own box —
        # turrets, scoops, a nose curve — which only happens on the outside.
        out_ink = {
            "n": float(ink[1, 2:2 + cw].max()), "s": float(ink[gh - 2, 2:2 + cw].max()),
            "w": float(ink[2:2 + ch, 1].max()),  "e": float(ink[2:2 + ch, gw - 2].max()),
        }
        # Every tile bleeds a little — corridor stubs are drawn into the margin
        # at about 0.09. Only well past that is something really sticking out.
        proud = {k: v > 0.13 for k, v in out_ink.items()}
        roles, needs_skin = roles_of(t)
        filled = float((c > INK).mean())
        skin = {k for k, v in sides.items() if v != "closed"}
        source = "art" if skin else "none"
        if not skin and t["kind"] in FOLDER_SKIN:
            declared = FOLDER_SKIN[t["kind"]]
            if t["mirror"]:
                declared = "".join(MIRROR_FLIP[c] for c in declared)
            skin = set(declared)
            source = "folder" if skin else "art"
        attach = [k for k in "nswe" if k not in skin]
        klass = shape_class(attach, filled)
        if klass in ("loose", "island"):
            source = "loose"
        out[t["path"]] = {
            "cells": [cw, ch],
            "ft": [cw * 5, ch * 5],
            "named": [t["w"], t["h"]],
            "renamed": [cw * 5, ch * 5] != [t["w"], t["h"]],
            "sides": sides,
            "edge": prof,
            "proud": [k for k, v in proud.items() if v],
            "skin": sorted(skin),
            "attach": attach,
            "class": klass,
            "source": source,
            "filled": round(filled, 3),
            "roles": roles,
            "needsSkin": needs_skin,
            "kind": t["kind"],
            "set": t["set"],
            "code": t["code"],
            "label": t["label"],
        }
    return out, skipped


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "geomorphs")
    man = json.load(open(os.path.join(root, "geomorphs.manifest.json"), encoding="utf-8"))
    # Small craft and finished ships are pictures of vehicles, not tiles you lay
    # next to each other, and they carry no bleed. Files sitting loose at the top
    # of a set are reference sheets, not tiles either.
    tiles = [t for t in man["tiles"]
             if t["set"] in SETS and not t["overlay"]
             and t["kind"] not in ("symbol", "baseplate", "craft", "ship")
             and t["path"].count("/") >= 2]
    print(f"reading {len(tiles)} tiles…")
    tax, skipped = analyse(root, tiles)
    out = os.path.join(here, "tiles.taxonomy.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"cell": CELL, "feetPerCell": 5, "tiles": tax}, fh, separators=(",", ":"))
    print(f"{len(tax)} analysed -> {out}")
    if skipped:
        print("  skipped:", dict(skipped))

    # A report worth reading: does the shape agree with the folder it came from?
    by_kind = defaultdict(Counter)
    for v in tax.values():
        by_kind[v["kind"]][v["class"]] += 1
    print("\nshape, by the folder the tile came from")
    for kind in sorted(by_kind):
        row = by_kind[kind]
        print(f"  {kind:11} " + "  ".join(f"{k}:{n}" for k, n in row.most_common()))
    print("\nwhere the shape came from:", dict(Counter(v["source"] for v in tax.values())))
    print("skin sides, most common:",
          Counter("+".join(v["skin"]) or "none" for v in tax.values()).most_common(8))
    print("renamed (filename geometry disagrees with the artwork):",
          sum(1 for v in tax.values() if v["renamed"]))


if __name__ == "__main__":
    main()
