#!/usr/bin/env python3
"""Index an unpacked RPG Mobius Geomorphs download for geomorphs.html.

The archives ship no manifest and a browser cannot list a directory, so this
walks the unpacked tree and writes geomorphs.manifest.json next to it. The page
also accepts the same folder through a file picker, so the manifest is only
needed when you serve the folder over http.

Scale, from Eric Smith's readme: 60 px per 5-foot square. A tile named
[100x100] is 100 feet square = 20 squares, drawn at 1440 px with a 2-square
transparent bleed on every side. Sizes here are kept in feet, with the bleed
recorded separately so the page can align tiles by their true edges.
"""
import json, os, re, struct, sys

PX_PER_SQUARE = 60
FEET_PER_SQUARE = 5

SIZE_RE = re.compile(r"\[(\d+)\s*[xX]\s*(\d+)\]")
CODE_RE = re.compile(r"^((?:[A-Za-z]{1,3}-?\d{2,4}|\d{3,4})(?:,(?:[A-Za-z]{1,3}-?\d{2,4}|\d{3,4}))*)\b")
VARIANT_RE = re.compile(r"\((\d+)\)")

KINDS = [
    ("100x100 Core", "core"), ("100x50 Edge", "edge"), ("50x50 Corner", "corner"),
    ("100x100 End", "end"), ("200x100 Megamorph", "megamorph"),
    ("50x50 Build It", "build"), ("Small Craft", "craft"), ("Starships", "ship"),
    ("Baseplates", "baseplate"), ("Bridge", "bridge"), ("Engineering", "engineering"),
    ("Misc", "misc"),
]

# The Adventure Class download sorts parts by their connection topology, and
# the two-letter code in each folder name is the part's role. Geomorph Shipyard
# builds ships out of exactly these: a fore end, a hull centre, an aft end, and
# a mirrored pair of sides.
AC_ROLES = {
    "HG": "hg",   # half geomorph  — hull centre, drawn lengthwise
    "LG": "lg",   # long geomorph  — hull centre, drawn upright
    "QG": "qg",   # quarter        — short hull centre, lengthwise
    "Sh": "sh",   # short          — short hull centre, upright
    "SE": None,   # small end, fore or aft: decided by the [Fore]/[Aft] tag
    "LC": "lc", "SC": "sc", "HC": "hc",     # cores: connections fore and aft only
    "LS": "ls", "SS": "ss", "AO": "ao",     # sides and add-ons: mirrored pairs
    "M": "acmisc", "TG": "transition", "DV": "dorsal",
    "As": "asteroid", "UG": "unique",
}
AC_FOLDER_RE = re.compile(r"^\d+(?:\.\d+)?\s+([A-Za-z]{1,2})\s")
TAG_RE = re.compile(r"\[(Fore|Aft|Port|Starboard)\]")
TONS_RE = re.compile(r"\[([\d+]+)-dTons\]")


def png_size(path):
    with open(path, "rb") as fh:
        head = fh.read(33)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", head[16:24])


def kind_of(rel, top, stem):
    if top == "Symbols":
        return "symbol"
    parts = rel.split(os.sep)
    if top == "AdventureClass":
        for part in parts:
            m = AC_FOLDER_RE.match(part)
            if not m:
                continue
            role = AC_ROLES.get(m.group(1))
            if role:
                return role
            tag = TAG_RE.search(stem)          # SE folders split fore from aft
            return "aft" if tag and tag.group(1) == "Aft" else "fore"
        return "misc"
    for part in parts:
        for folder, kind in KINDS:
            if part == folder:
                return kind
    return "misc"


def label_of(stem):
    """Strip the code, the size and the bracket tags; keep the human part."""
    s = CODE_RE.sub("", stem, count=1)
    s = SIZE_RE.sub("", s, count=1)
    s = re.sub(r"\[(Mirror|Overlay|Fore|Aft|Port|Starboard)\]", "", s)
    s = TONS_RE.sub("", s)
    s = re.sub(r"^\s*\(\d+\)\s*", "", s.strip())
    return re.sub(r"\s{2,}", " ", s).strip(" -,") or stem


def tags_of(label):
    inner = re.findall(r"\(([^)]*)\)", label)
    head = re.sub(r"\([^)]*\)", "", label)
    out = []
    for chunk in [head] + inner:
        for t in re.split(r"[,&]", chunk):
            t = re.sub(r"^\s*\d+x\s*", "", t).strip(" -.")
            if 2 < len(t) < 40:
                out.append(t)
    seen, uniq = set(), []
    for t in out:
        k = t.lower()
        if k not in seen:
            seen.add(k)
            uniq.append(t)
    return uniq[:8]


def index(root):
    tiles = []
    for dirpath, _dirs, files in os.walk(root):
        for fn in sorted(files):
            if not fn.lower().endswith(".png"):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root)
            top = rel.split(os.sep)[0]
            size = png_size(full)
            if not size:
                continue
            pxw, pxh = size
            stem = fn[:-4]
            m = SIZE_RE.search(stem)
            code = CODE_RE.match(stem)
            kind = kind_of(rel, top, stem)
            sqw, sqh = round(pxw / PX_PER_SQUARE), round(pxh / PX_PER_SQUARE)
            if m and kind != "symbol":
                wft, hft = int(m.group(1)), int(m.group(2))
                bleed_x = (sqw - wft / FEET_PER_SQUARE) / 2
                bleed_y = (sqh - hft / FEET_PER_SQUARE) / 2
            else:
                wft, hft = sqw * FEET_PER_SQUARE, sqh * FEET_PER_SQUARE
                bleed_x = bleed_y = 0
            variant = VARIANT_RE.search(stem)
            tag = TAG_RE.search(stem)
            tons = TONS_RE.search(stem)
            label = label_of(stem)
            tiles.append({
                "path": rel.replace(os.sep, "/"),
                "set": top,
                "kind": kind,
                "code": code.group(1) if code else "",
                "w": wft, "h": hft,
                "px": [pxw, pxh],
                "bleed": [bleed_x, bleed_y],
                "mirror": "[Mirror]" in stem,
                "overlay": "[Overlay]" in stem,
                "variant": int(variant.group(1)) if variant else 0,
                "tag": tag.group(1) if tag else "",
                "tons": sum(int(n) for n in tons.group(1).split("+")) if tons else 0,
                "label": label,
                "tags": tags_of(label),
            })
    return tiles


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "geomorphs")
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, "geomorphs.manifest.json")
    tiles = index(root)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"pxPerSquare": PX_PER_SQUARE, "feetPerSquare": FEET_PER_SQUARE, "tiles": tiles}, fh, separators=(",", ":"))
    counts = {}
    for t in tiles:
        counts[t["kind"]] = counts.get(t["kind"], 0) + 1
    print(f"{len(tiles)} tiles -> {out}")
    for k in sorted(counts, key=lambda k: -counts[k]):
        print(f"  {k:10} {counts[k]}")


if __name__ == "__main__":
    main()
