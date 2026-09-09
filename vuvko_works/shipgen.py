#!/usr/bin/env python3
"""
shipgen.py -- a clean-room reimplementation of the architecture used by
rolegenerator.com's spaceship module, derived by black-box sampling of its
public endpoint (192 samples).

The architecture, not the content: all tables below are my own placeholder
data. The real generator's deck plans are (c) Pearce Design Studio, LLC and
its prose tables are the site's own work. Swap in your own assets.

Core insight: the IMAGE IS THE ANCHOR. You pick a class, pick a pre-drawn
plan from that class's folder, and every other field is rolled from tables
gated by what that plan already commits to.
"""

import random
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# 1. ASSET CLASSES.  In the original these are literally directories on disk;
#    the folder path *is* the schema.  Each class hard-binds: a size label, a
#    tonnage range, an armed flag, and which prose tables are legal.
# ---------------------------------------------------------------------------

@dataclass
class ShipClass:
    bucket: str              # top-level dropdown group
    folder: str              # asset directory
    type_name: str           # displayed "tipo"
    size_label: str          # NOT computed from tonnage -- bound to the class
    ton_min: int
    ton_max: int
    armed: bool              # from the arma/sinarma folder split
    ftl_chance: float        # P(has a superluminal drive)
    autonomy_min: int = 3
    autonomy_max: int = 5
    autonomy_unit: str = "weeks"
    crew: str = "1 Pilot."
    name_style: str = "code"  # "code" | "proper"
    notes: list = field(default_factory=list)


CLASSES = [
    # --- starfighters: sub-100t, rarely FTL, always armed -------------------
    ShipClass("fighters", "fighters/light",       "Light fighter",    "Small",   8,  12, True, 0.20, crew="1 Pilot."),
    ShipClass("fighters", "fighters/interceptor", "Interceptor",      "Small",   9,  14, True, 0.20, crew="1 Pilot."),
    ShipClass("fighters", "fighters/heavy",       "Heavy fighter",    "Small",  44,  52, True, 0.25, crew="1 Pilot and 1 Gunner."),
    ShipClass("fighters", "fighters/bomber",      "Fighter-bomber",   "Small",  48,  60, True, 0.25, crew="1 Pilot and 1 Gunner."),
    # --- small craft: shuttles and launches, almost never FTL ---------------
    ShipClass("smallcraft", "smallcraft/shuttle",       "Shuttle",       "Small", 18,  21, False, 0.05, crew="1 Pilot."),
    ShipClass("smallcraft", "smallcraft/launch_armed",  "Armed launch",  "Small", 19,  22, True,  0.05, crew="1 Pilot."),
    ShipClass("smallcraft", "smallcraft/lander",        "Orbital lander","Small", 94,  99, False, 0.05, crew="2 Pilots."),
    # --- system ships: 100t+, logistics, no jump drives ---------------------
    ShipClass("system", "system/defense",   "Planetary defense ship", "Midsize", 505, 590, True,  0.35, 4, 8,  crew="12 crew, 4 gunners."),
    ShipClass("system", "system/gunboat",   "Patrol gunboat",         "Midsize", 195, 260, True,  0.30, 4, 8,  crew="9 crew, 3 gunners."),
    ShipClass("system", "system/cryo",      "Cryogenic colony ship",  "Large ship", 1050, 1200, False, 0.00,
              1000, 1300, "years", crew="6 crew awake, 4,000 sleepers.",
              notes=["Cryogenic bays", "Hydroponics", "Seed vault"]),
    ShipClass("system", "system/refinery",  "Orbital fuel station",   "Midsize", 900, 995, False, 0.00, 8, 14, crew="30 crew."),
    # --- spacecraft: the FTL-capable civilian workhorses --------------------
    ShipClass("starship", "starship/freighter_armed",  "Independent freighter", "Midsize", 560, 600, True,  0.85, 3, 6,  crew="4 crew, 1 gunner."),
    ShipClass("starship", "starship/freighter_unarmed","Bulk freighter",        "Midsize", 555, 595, False, 0.85, 3, 6,  crew="4 crew."),
    ShipClass("starship", "starship/yacht",            "Aristocratic yacht",    "Midsize", 570, 600, False, 0.90, 3, 6,  crew="3 crew, 8 passengers."),
    ShipClass("starship", "starship/merchant",         "Interstellar freighter","Large ship", 1800, 1900, False, 0.95, 12, 18, crew="14 crew."),
    ShipClass("starship", "starship/tug",              "Heavy tug",             "Large ship", 3400, 3500, False, 0.95, 10, 16, crew="11 crew."),
    # --- military ----------------------------------------------------------
    ShipClass("military", "military/corvette",  "Patrol corvette",  "Midsize",    350,  400, True, 0.90, 3, 5,  crew="22 crew, 6 gunners."),
    ShipClass("military", "military/destroyer", "Destroyer",        "Large ship", 1200, 1300, True, 0.98, 3, 6,  crew="90 crew, 20 gunners."),
    ShipClass("military", "military/battleship","Armored cruiser",  "Large ship", 4700, 4950, True, 1.00, 12, 18, crew="410 crew, 80 gunners."),
    ShipClass("military", "military/carrier",   "Fleet carrier",    "Very large", 8000, 9900, True, 1.00, 8, 12,
              crew="1,200 crew, 140 gunners, 90 pilots.",
              notes=["Armory", "Fuel processor", "3 hangars (ships up to 800 ton)", "Workshops"]),
    # --- community: proper names, thruster rating always 1 ------------------
    ShipClass("community", "community/medium_armed",   "Community ship", "Midsize", 200, 350, True,  0.95, 3, 4, name_style="proper", crew="18 crew, 4 gunners."),
    ShipClass("community", "community/medium_unarmed", "Community ship", "Midsize", 240, 330, False, 0.95, 3, 4, name_style="proper", crew="18 crew."),
    ShipClass("community", "community/large_armed",    "Community ship", "Midsize", 330, 500, True,  0.95, 3, 4, name_style="proper", crew="26 crew, 7 gunners."),
    ShipClass("community", "community/large_unarmed",  "Community ship", "Midsize", 370, 500, False, 0.95, 3, 4, name_style="proper", crew="26 crew."),
]

# ---------------------------------------------------------------------------
# 2. PROSE TABLES
# ---------------------------------------------------------------------------

REACTORS = [
    ("Fission reactor",     22, "Induced fission powers the ship, but leaves hazardous waste."),
    ("Fusion reactor",      22, "Fusion yields large output without most fission risks."),
    ("Cold fusion reactor", 22, "Fusion sustained at low temperature; a cleaner generation."),
    ("Antimatter reactor",  14, "Matter/antimatter annihilation, orders of magnitude past fusion."),
    ("Zero point reactor",   9, "Draws energy from vacuum. Nothing generates power more efficiently."),
    ("Solar reactor",        5, "Sails capture external thrust; no engine or fuel to carry."),
    ("Dark matter reactor",  4, "Somehow extracts energy directly from dark matter."),
]

FTL_DRIVES = [
    ("Jump Drive",      "Opens a portal into hyperspace, where spacetime runs differently."),
    ("Warp Drive",      "Distorts the space around the hull to exceed lightspeed."),
    ("Fold Drive",      "Folds space for instantaneous transit. Huge draw, long recharge."),
    ("Hyperdrive",      "Runs the interstellar hyperplanes between system edges."),
    ("Curvature Drive", "Accesses a hostile adjacent dimension and reappears on new coordinates."),
    ("Light Drive",     "Converts hull and crew to waves, reassembling at the destination."),
    ("Bridge Drive",    "Holds a transit corridor open; the route can be altered mid-flight."),
]

SUBLIGHT = [
    ("Impulse thrusters",   "High-burn thrusters, very fast but strictly sublight."),
    ("Ion thrusters",       "Electric drives using ion beams, no propellant needed."),
    ("Plasma thrusters",    "Ionization-induced plasma jets; strong sublight agility."),
    ("Combustion thrusters","Simple chemical thrusters burning stored propellant."),
]

# HARD COUPLINGS observed in the live data (dark matter was 7/7).
COUPLED = {
    "Dark matter reactor": ("Dark matter drive",
                            "Fusion-fed dark matter thrusters, unmatched sublight agility."),
    "Solar reactor":       ("Photon Sail",
                            "Reflective sheets riding the light pressure of stellar radiation."),
}

HULLS = [
    "Standard hull: enters atmosphere, but clumsily and unwillingly.",
    "Atmospheric hull: designed to fly inside a gravity well.",
    "Dispersed structure hull: not aerodynamic. Atmospheric entry is dangerous.",
    "Reinforced hull: stronger construction technique, no shortcuts.",
    "Double hull: a second cylinder improves protection and durability.",
    "Ultra-dense hull: dense shielding against tachyon and quantum weapons.",
    "Planetoid hull: a hollowed asteroid wrapped around the ship.",
    "Crystal coating: ultra-hard alloy laminate improving hull integrity.",
]

SHIELDS = [
    "Light energy shields: modest deflection at modest power cost.",
    "Deflector: stops limited incoming fire before overloading. Power-hungry.",
    "Two-layer shield: trades peak strength for wider coverage.",
    "Thermal shield: protects against extreme heat, including stellar close passes.",
    "Psionic barrier: raised from pure psychic energy by an exotic crew.",
]

TURRETS = [
    ("Laser turret",      "Focused coherent light, the workhorse mount of every navy."),
    ("Plasma launcher",   "Lobs contained plasma that splashes on impact."),
    ("Rail gun",          "Magnetically accelerated slug; no propellant, enormous kinetic load."),
    ("Heavy ion cannon",  "Ionized particles that disrupt or disable electronics."),
    ("Missile rack",      "Guided ordnance, effective past visual range."),
]

BAYS = [
    ("Blaster cannon bay", "Massed cannon under unified fire control."),
    ("Torpedo bay",        "Heavy shipkillers with deep magazines."),
    ("Meson cannon bay",   "Particles that decay inside the target hull, past the armor."),
]

SPINAL = [
    ("Tachyon lance",           "A spinal weapon running the length of the keel."),
    ("Solar pulse projector",   "Discharges a captured stellar pulse in one direction only."),
]

DEFENSES = [
    ("Sand caster",         "Throws a cloud of sand to scatter laser fire and jam sensors."),
    ("Flak battery",        "Fragmentation rounds detonated close in to shred strike craft."),
    ("Point defense turret","Fast-tracking mounts dedicated to missiles and fighters."),
    ("Jammer suite",        "Electronic warfare against locks and guidance."),
]

COMPUTERS = ["Trigger control", "Evasion", "Library", "Assisted maneuver",
             "Jump plotting", "Electronic warfare suite"]
SENSORS = [
    ("LIDAR", "Ranges objects from a laser emitter; standard for traffic and docking."),
    ("Radar", "Planetary technology adapted to deep space for detection and tracking."),
    ("Densitometer", "Reads mass distribution through a hull."),
]

# Name grammar. The live site used <TypeName> <L.NNN ROMAN> or <TypeName> <LL-NNN>.
ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X",
         "XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX"]
PROPER_PREFIX = ["", "", "The ", "CS ", "HMS ", "LWSS ", "SC "]
PROPER_ADJ = ["", "", "Glorious ", "Vainglorious ", "Lone ", "Stolen ", "Saucy ", "Reeking "]
PROPER_NOUN = ["Erebus", "Mayflower", "Medusa", "Nirvana", "Fafnir", "Ulysses", "Fortune",
               "Beagle", "Agamemnon", "Potemkin", "Sea Ghost", "Moon Whisperer",
               "Shooting Star", "Colossal Yeti", "Angryshark"]


def _weighted(table):
    names = [t[0] for t in table]
    weights = [t[1] for t in table]
    pick = random.choices(names, weights=weights)[0]
    return next(t for t in table if t[0] == pick)


def _roll_name(sc):
    if sc.name_style == "proper":
        return (random.choice(PROPER_PREFIX) + random.choice(PROPER_ADJ)
                + random.choice(PROPER_NOUN))
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    if random.random() < 0.5:
        code = f"{random.choice(letters)}.{random.randint(10,499)} {random.choice(ROMAN)}"
    else:
        code = f"{''.join(random.choices(letters, k=random.choice([1,1,3])))}-{random.randint(10,999)}"
    return f"{sc.type_name} {code}"


def _roll_engine(sc, reactor):
    """Reactor can hard-bind the drive; otherwise roll, gated by class FTL chance."""
    if reactor in COUPLED:
        prim, desc = COUPLED[reactor]
        rating = random.choice(ROMAN)
        if random.random() < sc.ftl_chance:
            ftl, fdesc = random.choice(FTL_DRIVES)
            return (f"{prim} {rating} (Sublight) and {ftl} thruster "
                    f"{random.randint(1,9)} (Superluminal)", [desc, fdesc])
        return f"{prim} {rating} (Sublight)", [desc]

    thruster = 1 if sc.bucket == "community" else random.randint(1, 9)
    if random.random() < sc.ftl_chance:
        ftl, fdesc = random.choice(FTL_DRIVES)
        return (f"{ftl} {random.choice(ROMAN)} (Superluminal) and thrusters "
                f"{thruster} (Sublight)", [fdesc])
    sub, sdesc = random.choice(SUBLIGHT)
    return f"{sub} {random.choice(ROMAN)} (Sublight)", [sdesc]


def _roll_armament(sc, tons):
    """Gated by the artwork: unarmed plans never grow guns, and mount class
    scales with displacement because the plan has to have room for it."""
    out = [f"- {h}" for h in random.sample(HULLS, k=random.randint(1, 3))]
    out.append(f"- {random.choice(SHIELDS)}")
    if not sc.armed:
        out.append("- No offensive mounts fitted.")
        return out
    out.append("")
    n = 1 if tons < 100 else (2 if tons < 1000 else 3)
    for w, d in random.sample(TURRETS, k=min(n, len(TURRETS))):
        qty = random.randint(1, 2) if tons < 1000 else random.randint(2, 6)
        heavy = "Heavy deck turret" if tons >= 1000 else "Turret"
        out.append(f"x{qty} {heavy} ({w}): {d}")
    if tons >= 1000:
        w, d = random.choice(BAYS)
        out.append(f"Bay ({w}): {d}")
    if tons >= 4000:
        w, d = random.choice(SPINAL)
        out.append(f"Spinal mount ({w}): {d}")
    for w, d in random.sample(DEFENSES, k=1 if tons < 1000 else 2):
        out.append(f"Mechanical defenses ({w}): {d}")
    return out


def generate(bucket="random"):
    pool = CLASSES if bucket == "random" else [c for c in CLASSES if c.bucket == bucket]
    if not pool:
        raise ValueError(f"unknown bucket {bucket!r}")
    sc = random.choice(pool)

    tons = random.randint(sc.ton_min, sc.ton_max)
    reactor, _, rdesc = _weighted(REACTORS)
    engine, edescs = _roll_engine(sc, reactor)
    autonomy = f"{random.randint(sc.autonomy_min, sc.autonomy_max)} {sc.autonomy_unit}"

    comps = random.sample(COMPUTERS, k=random.randint(2, 4))
    sens = random.sample(SENSORS, k=random.randint(1, 2))

    desc = [f"{sc.type_name}", f"Crew: {sc.crew}", f"Reactor: {rdesc}"]
    desc += [f"Drive: {e}" for e in edescs]
    desc.append("Computer: " + ", ".join(comps))
    desc += [f"{n}: {d}" for n, d in sens]

    arm = _roll_armament(sc, tons)
    if sc.notes:
        arm.append("")
        arm.append("Notes: " + ", ".join(sc.notes))

    # The image is chosen FIRST in spirit -- here the class selection is the
    # choice, and the file is any plate filed under that class.
    return {
        "image": f"assets/{sc.folder}/{random.randint(1, 40)}.jpg",
        "name": _roll_name(sc),
        "type": sc.type_name,
        "weight": f"{tons} ({sc.size_label})",
        "reactor": reactor,
        "engine": engine,
        "autonomy": autonomy,
        "description": desc,
        "armament": arm,
    }


def render(s):
    w = 74
    out = [s["name"].center(w), "-" * w,
           f"{s['type']:<38}{s['weight']:>36}",
           f"{s['image']}", "",
           f"Reactor   : {s['reactor']}",
           f"Engine    : {s['engine']}",
           f"Autonomy  : {s['autonomy']}", "",
           "DESCRIPTION"]
    out += ["  " + l for l in s["description"]]
    out += ["", "ARMAMENT, HULL AND OTHERS"]
    out += ["  " + l for l in s["armament"]]
    return "\n".join(out)


if __name__ == "__main__":
    import sys
    bucket = sys.argv[1] if len(sys.argv) > 1 else "random"
    print(render(generate(bucket)))
