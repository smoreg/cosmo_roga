#!/usr/bin/env python3
"""Fetch and unpack the geomorph tiles the pages need.

The artwork is CC BY-NC and its authors ask that it not be repackaged, so none
of it lives in this repository. This gets it from the authors' own hosting:

  RPG Mobius geomorphs        rpgmobius.com  (Google Drive)   ~116 MB
  Adventure Class ship parts  gurpsland.no-ip.org             ~54 MB, optional

Then it builds the index and reads the tile edges, so a clean checkout goes from
nothing to a working generator in one command:

    python3 fetch_geomorphs.py                 # the Mobius tiles
    python3 fetch_geomorphs.py --adventure     # and Geomorph Shipyard's parts
    python3 fetch_geomorphs.py --check         # just verify the links still work

Only the *Screen* colouring of the Mobius set is fetched. The Print colouring is
black line art for white paper, and the pages draw on a dark ground, where it
would be invisible.
"""
import argparse, io, os, re, shutil, subprocess, sys, urllib.parse, urllib.request, zipfile
from http.cookiejar import CookieJar

UA = "Mozilla/5.0 (compatible; cosmo_roga geomorph fetcher)"
DRIVE = "https://drive.usercontent.google.com/download"

# Google Drive ids, read off rpgmobius.com/geomorphs. Verify with --check.
MOBIUS = [
    ("Geomorphs",    "18L3MktKLEfcH2qNi1iHl3SaMYlhtKqd1", "RPG-Mobius-Geomorphs-Geomorphs-Screen.zip"),
    ("Custom-Tiles", "1R8aaWorbUzq2LZTGIk5qrVQNiF7SIktg", "RPG-Mobius-Geomorphs-Custom-Tiles-Screen.zip"),
    ("Symbols",      "1_xHqyRxa6X9wx7Gsdb5d3x9ajygEW8ie", "RPG-Mobius-Geomorphs-Symbols-Screen.zip"),
]
ADVENTURE = ("AdventureClass", [
    "https://gurpsland.no-ip.org/zip/Geomorphs/AdventureClass.zip",
    "https://gurpsland.sytes.net/zip/Geomorphs/AdventureClass.zip",
], "AdventureClass.zip")


def opener():
    return urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(CookieJar()))


def drive_url(op, file_id):
    """Drive serves big files behind a virus-scan interstitial: a form to
    resubmit with a confirm token. Small ones come straight down."""
    url = DRIVE + "?" + urllib.parse.urlencode({"id": file_id, "export": "download"})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    resp = op.open(req, timeout=60)
    if "text/html" not in resp.headers.get("Content-Type", ""):
        return url, resp
    page = resp.read(65536).decode("utf-8", "replace")
    fields = dict(re.findall(r'<input type="hidden" name="([^"]+)" value="([^"]*)"', page))
    if not fields:
        raise RuntimeError("Drive returned a page with no download form; open "
                           "https://rpgmobius.com/geomorphs in a browser and check the link")
    confirmed = DRIVE + "?" + urllib.parse.urlencode(fields)
    return confirmed, op.open(urllib.request.Request(confirmed, headers={"User-Agent": UA}), timeout=60)


def http_url(op, urls):
    last = None
    for url in urls:
        try:
            return url, op.open(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60)
        except Exception as exc:
            last = exc
            print(f"    {url} failed ({exc}); trying the mirror")
    raise last


def download(resp, path, label):
    total = int(resp.headers.get("Content-Length") or 0)
    tty = sys.stdout.isatty()
    done = mark = 0
    tmp = path + ".part"
    with open(tmp, "wb") as fh:
        while True:
            chunk = resp.read(1 << 16)
            if not chunk:
                break
            fh.write(chunk)
            done += len(chunk)
            # Redrawing a line is for a terminal; in a log, a note every 10 MB.
            if tty:
                bar = f"{done * 100 // total:3d}%  {done>>20} of {total>>20} MB" if total else f"{done>>20} MB"
                print(f"\r  {label}: {bar}", end="", flush=True)
            elif done - mark >= 10 << 20:
                mark = done
                print(f"  {label}: {done>>20} MB", flush=True)
    if tty:
        print()
    os.replace(tmp, path)
    return done


def unpack(zip_path, dest):
    """The Mobius archives were built on Windows and use backslashes as path
    separators, which zipfile keeps as ordinary characters in the name. Split
    them ourselves or everything lands in one flat directory."""
    with zipfile.ZipFile(zip_path) as z:
        bad = z.testzip()
        if bad:
            raise RuntimeError(f"{zip_path} is corrupt at {bad}")
        members = z.namelist()
        for name in members:
            clean = name.replace("\\", "/")
            if clean.endswith("/") or clean.startswith("/") or ".." in clean.split("/"):
                continue
            target = os.path.join(dest, *clean.split("/"))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with z.open(name) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out)
    return len(members)


def count_png(path):
    return sum(1 for _, _, files in os.walk(path) for f in files if f.lower().endswith(".png"))


def fetch(op, folder, source, filename, here, args):
    dest = os.path.join(here, "geomorphs", folder)
    have = count_png(dest) if os.path.isdir(dest) else 0
    if have and not args.force and not args.check:
        print(f"{folder}: {have} tiles already unpacked — skipping (--force to redo)")
        return
    zip_path = os.path.join(here, filename)
    if os.path.exists(zip_path) and not args.force and not args.check:
        print(f"{folder}: using {filename} already on disk")
    else:
        print(f"{folder}: fetching {filename}")
        url, resp = (drive_url(op, source) if isinstance(source, str)
                     else http_url(op, source))
        if args.check:
            head = resp.read(4)
            print(f"  {'ok' if head[:2] == b'PK' else 'NOT A ZIP'} — {url[:96]}")
            return
        download(resp, zip_path, folder)
    if args.check:
        return
    print(f"  unpacking into geomorphs/{folder}/")
    n = unpack(zip_path, dest)
    print(f"  {n} entries, {count_png(dest)} tiles")
    if not args.keep_zips:
        os.remove(zip_path)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--adventure", action="store_true",
                    help="also fetch the Adventure Class ship parts (optional, ~54 MB)")
    ap.add_argument("--force", action="store_true", help="re-download and re-unpack")
    ap.add_argument("--check", action="store_true",
                    help="verify each link serves a zip, download nothing")
    ap.add_argument("--keep-zips", action="store_true", help="keep the archives after unpacking")
    ap.add_argument("--no-index", action="store_true", help="skip the manifest and taxonomy step")
    ap.add_argument("--only", metavar="SET",
                    help="fetch one set only: Geomorphs, Custom-Tiles, Symbols, AdventureClass")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    op = opener()
    jobs = [(f, i, n) for f, i, n in MOBIUS]
    if args.adventure or (args.only or "").lower() == "adventureclass":
        jobs.append(ADVENTURE)
    if args.only:
        jobs = [j for j in jobs if j[0].lower() == args.only.lower()]
        if not jobs:
            print(f"no set called {args.only!r}")
            return 2

    for folder, source, filename in jobs:
        try:
            fetch(op, folder, source, filename, here, args)
        except Exception as exc:
            print(f"{folder}: FAILED — {exc}")
            if not args.check:
                return 1

    if args.check or args.no_index:
        return 0
    for script in ("geomorph_manifest.py", "geomorph_taxonomy.py"):
        print(f"\n$ {script}")
        r = subprocess.run([sys.executable, os.path.join(here, script)])
        if r.returncode:
            print(f"{script} failed")
            return r.returncode
    print("\nReady. Serve this folder (python3 -m http.server) and open geomorphs.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
