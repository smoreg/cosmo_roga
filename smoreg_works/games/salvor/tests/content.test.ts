import { describe, it, expect } from "vitest";
import { Rng, RoomGame } from "@jamrog/engine";
import { seedRange, shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { ZONE_KINDS } from "../src/content/zones.js";
import {
  DERELICTS,
  FATHERS_TUG,
  MILITARY,
  RELIC_DEPTH,
  STARTER_HULLS,
  buildDerelict,
  derelictShip,
  derelictSpec,
} from "../src/content/derelicts.js";
import { TUTORIAL_SPEC } from "../src/content/tutorial.js";
import {
  BLOOM_KIND,
  CRAWLER,
  ENFORCER,
  JAMMER,
  MONSTERS,
  SENTRY_TURRET,
  machineAboard,
} from "../src/content/monsters.js";
import { MODULES, RELICS, isRelic, moduleKind, type ModuleId } from "../src/content/modules.js";
import { SALVAGE_POOL } from "../src/content/cards.js";
import { HULLS } from "../src/content/hulls.js";
import { OBJECTIVES } from "../src/content/objectives.js";
import { DEFAULT_STRAIN, STRAINS, strainOf } from "../src/content/viruses.js";
import { POPULATE, placeRelic, roomList, type ShipSystem, type Wreck } from "../src/systems/populate.js";

/**
 * Content that cannot be reached is content that does not exist.
 *
 * Adding a machine, a compartment kind or a ship class is meant to be one row
 * in one table — that is what `zones.ts` → `cards.ts` → `derelicts.ts` is for,
 * and the direction of those imports is the whole design. What the design does
 * not give is a *warning*: a machine left out of every class, a module nothing
 * drops, a compartment kind no ship is built from all sit in their tables
 * looking finished, and the game simply never shows them.
 *
 * It happened. The welder bot was in the table with a weight, a depth band and
 * a drop, and no class listed it — so the WELDER, the one module that mends
 * another module in the field, could only arrive as an alert reinforcement on a
 * ship whose alarm you had already run to the top. Nothing was broken; the row
 * was just unreachable, and no test had an opinion about that.
 *
 * These are the opinions. Each one turns "I forgot the second table" from a
 * silent hole into a red line, which is the only thing that makes a content
 * table safe to add to.
 */

const bandMembers = new Set(DERELICTS.flatMap((spec) => spec.band));

/**
 * Every machine the game has, wherever its row lives. `MONSTERS` is the
 * population table; the five with `weight: 0` are exported one by one because
 * they are placed by name — an alarm's enforcer, a card's turret — and are
 * deliberately not in it.
 */
const ALL = [...MONSTERS, SENTRY_TURRET, JAMMER, CRAWLER, BLOOM_KIND, ENFORCER];
const kinds = new Set(ZONE_KINDS.map((k) => k.kind));

describe("every row of the content tables can be reached", () => {
  it("puts every machine with a weight aboard some class of ship", () => {
    // `weight: 0` means "never spawned by the population budget" — the enforcer
    // the alarm sends, the turret a card bolts down, the rival's own drone.
    // Those are placed by name and are meant to be off the ordinary tables.
    const spawnable = MONSTERS.filter((m) => m.weight > 0);
    expect(spawnable.length).toBeGreaterThan(4);
    for (const machine of spawnable) {
      expect(bandMembers.has(machine.id), `${machine.id} is in no ship's band`).toBe(true);
    }
  });

  it("names only machines that exist in every band", () => {
    for (const spec of DERELICTS) {
      for (const id of spec.band) {
        expect(machineAboard(id) !== undefined, `${spec.id}: no machine '${id}'`).toBe(true);
      }
    }
  });

  it("builds every class out of compartment kinds that have a name", () => {
    for (const spec of DERELICTS) {
      for (const kind of spec.kinds) {
        expect(kinds.has(kind), `${spec.id}: no compartment kind '${kind}'`).toBe(true);
      }
    }
  });

  it("gives every compartment kind at least one ship class to appear in", () => {
    const used = new Set(DERELICTS.flatMap((spec) => spec.kinds));
    for (const kind of ZONE_KINDS) {
      expect(used.has(kind.kind), `compartment kind '${kind.kind}' is in no class`).toBe(true);
    }
  });

  it("leaves a way to get hold of every module", () => {
    // Four routes, and a module needs one of them: it comes bolted to a hull
    // you can buy, it drops off a machine, it turns up as loose scrap, or a
    // class of ship hides it in a guarded crate (a relic, and only a relic).
    // A module on none of the four is a row in the catalogue and nothing else.
    const onHulls = new Set(HULLS.flatMap((h) => h.modules));
    const dropped = new Set(ALL.map((m) => m.salvage).filter((s): s is ModuleId => s !== undefined));
    const scrap = new Set(SALVAGE_POOL);
    const hidden = new Set(DERELICTS.flatMap((spec) => spec.relics ?? []));
    for (const id of Object.keys(MODULES) as ModuleId[]) {
      const where = [
        onHulls.has(id) ? "a hull" : undefined,
        dropped.has(id) ? "a machine" : undefined,
        scrap.has(id) ? "scrap" : undefined,
        hidden.has(id) ? "a relic crate" : undefined,
      ].filter((x) => x !== undefined);
      expect(where.length, `${id} cannot be got hold of at all`).toBeGreaterThan(0);
    }
  });

  it("gives every virus strain a hull that carries it", () => {
    // A strain no class lists is the same dead row as a machine in no band —
    // the table looks finished and the game never shows it.
    const carried = new Set(DERELICTS.flatMap((spec) => spec.strains ?? [DEFAULT_STRAIN]));
    for (const strain of STRAINS) {
      expect(carried.has(strain.id), `strain '${strain.id}' is on no hull`).toBe(true);
    }
  });

  it("names only strains that exist on every hull", () => {
    for (const spec of DERELICTS) {
      for (const id of spec.strains ?? []) {
        expect(strainOf(id).id, `${spec.id}: no strain '${id}'`).toBe(id);
      }
    }
  });

  it("gives every strain a clock it can actually beat on", () => {
    // A period of zero would fire every turn through `age % period`, which is a
    // division by zero dressed as a mechanic.
    for (const strain of STRAINS) {
      expect(strain.period, strain.id).toBeGreaterThan(0);
      expect(strain.spread, strain.id).toBeGreaterThanOrEqual(0);
    }
  });

  it("answers with a class for every hull a run can stand on, itinerary or not", () => {
    // The training hull is out of `DERELICTS` on purpose and still has to be
    // *known*: `systems/populate.ts` reads the class off the ship it is filling,
    // and a class it cannot find is a ship with no band and no budget — which is
    // how the tutorial came to be guarded by security units and haulers before
    // `derelictSpec` learned about it (`content/tutorial.ts`).
    expect(DERELICTS.map((d) => d.id)).not.toContain(TUTORIAL_SPEC.id);
    expect(derelictSpec(TUTORIAL_SPEC.id)).toBe(TUTORIAL_SPEC);
    for (const spec of DERELICTS) expect(derelictSpec(spec.id)).toBe(spec);
    expect(derelictSpec("no such hull")).toBeUndefined();
  });

  it("holds the training hull to the same table rules as the seven", () => {
    // Every check above, on the one class the sweeps skip because no voyage
    // draws it. A row nothing iterates is a row nothing protects.
    for (const kind of TUTORIAL_SPEC.kinds) {
      expect(kinds.has(kind), `tutorial: no compartment kind '${kind}'`).toBe(true);
    }
    for (const id of TUTORIAL_SPEC.band) {
      expect(machineAboard(id) !== undefined, `tutorial: no machine '${id}'`).toBe(true);
    }
    for (const id of TUTORIAL_SPEC.strains ?? []) {
      expect(strainOf(id).id, `tutorial: no strain '${id}'`).toBe(id);
    }
    for (const id of TUTORIAL_SPEC.relics ?? []) {
      expect(isRelic(id), `tutorial: ${id} is not a relic`).toBe(true);
    }
    const required = ZONE_KINDS.filter((k) => k.required === true).map((k) => k.kind);
    for (const kind of required) {
      expect(TUTORIAL_SPEC.kinds.includes(kind), `tutorial has no ${kind}`).toBe(true);
    }
  });

  it("keeps a compartment for all three systems in every class", () => {
    // A hull the drone cannot neutralise is a hull the run cannot get past, and
    // the three required kinds are how the generator guarantees one of each.
    const required = ZONE_KINDS.filter((k) => k.required === true).map((k) => k.kind);
    expect(required.length).toBe(OBJECTIVES.length);
    for (const spec of DERELICTS) {
      for (const kind of required) {
        expect(spec.kinds.includes(kind), `${spec.id} has no ${kind}`).toBe(true);
      }
    }
  });
});

// ------------------------------------------------------- the starting hulls

/**
 * The deck names four ship classes by a bare string, and this is what holds the
 * two ends of those strings together.
 *
 * `content/cards.ts` may not import `content/derelicts.ts` — the deck is what
 * the classes are built out of, and the loop is the one ADR 0003 exists to keep
 * open — so `security checkpoint`, `crew quarters` and the six set pieces all
 * carry their hull's id as a literal. A class renamed on one side of that and
 * not the other is a card that silently stops appearing, which is exactly the
 * failure this file was written for.
 */
describe("the deck knows the hulls a voyage opens on", () => {
  const NO_RUN = { flags: new Set<string>(), shipIndex: 0 };

  /** Card names placed on this class over a run of seeds, as a set. */
  function placed(id: string): Set<string> {
    const spec = derelictSpec(id)!;
    const names = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      for (const { card } of buildDerelict(spec, 0, new Rng(seed), NO_RUN).cards) names.add(card.name);
    }
    return names;
  }

  it("draws each class's own set piece and nobody else's", () => {
    const own: Record<string, string> = {
      barge: "stacked scrap",
      ferry: "boarding gate",
      probe: "instrument bay",
      tender: "welding bay",
    };
    for (const [id, card] of Object.entries(own)) {
      const here = placed(id);
      expect(here, `${id} never drew ${card}`).toContain(card);
      for (const [other, theirs] of Object.entries(own)) {
        if (other === id) continue;
        expect(here, `${id} drew ${theirs}`).not.toContain(theirs);
      }
    }
    expect(placed("ferry")).toContain("muster point");
    expect(placed("tender")).toContain("spares rack");
  });

  it("keeps the pinned bulkhead on the freighter and off the other four", () => {
    // The freighter's one locked door is a promise the card makes; the other
    // four state their doors themselves, and a lock drawn by weight on a hull
    // holding one or two machines is a third of its head count behind a door
    // nobody said would be there (`content/cards.ts`, `SECURITY_CHECKPOINT`).
    expect(placed("freighter")).toContain("security checkpoint");
    for (const id of ["barge", "ferry", "probe", "tender"]) {
      expect(placed(id), `${id} drew a security checkpoint`).not.toContain("security checkpoint");
    }
    // And the deck's other lock is off the ferry alone, whose two gates are its
    // whole door plan. The hulls with living quarters still draw it.
    expect(placed("ferry")).not.toContain("crew quarters");
  });

  it("pins a manifest aboard every hull a voyage opens on", () => {
    // Two crates in front of the locks on the first ship of a run, whatever
    // class it is: the onboarding's `SALVAGE 20 CR` charter is a job and not a
    // gamble only if the freight is there to be found.
    for (const spec of STARTER_HULLS) {
      const seen = placed(spec.id);
      expect(seen, `${spec.id} drew no cargo manifest`).toContain("cargo manifest");
      expect(seen, `${spec.id} drew no docking bay`).toContain("docking bay");
    }
  });
});

// -------------------------------------------------------------------- relics

describe("every relic can be found", () => {
  it("is named by at least one class of hull, and every class names only relics that exist", () => {
    const hidden = new Set(DERELICTS.flatMap((spec) => spec.relics ?? []));
    for (const id of RELICS) expect(hidden.has(id), `${id} is on no hull`).toBe(true);
    for (const spec of DERELICTS) {
      for (const id of spec.relics ?? []) expect(isRelic(id), `${spec.id}: ${id} is not a relic`).toBe(true);
    }
    // The last hull of the voyage hides nothing: it is the end, not a shop.
    expect(FATHERS_TUG.relics ?? []).toEqual([]);
  });

  it("turns up on at least ten of 200 draws, three doors in, off the systems, and guarded", () => {
    // Every hull of the classes naming a relic, populated the way a sortie
    // finds it. Two hundred draws a relic, spread over the classes that hide it.
    for (const relic of RELICS) {
      const classes = DERELICTS.filter((spec) => (spec.relics ?? []).includes(relic));
      const per = Math.ceil(200 / classes.length);
      let hits = 0;
      for (const spec of classes) {
        for (const seed of seedRange(1, per)) {
          const game = new RoomGame({
            ...GAME_CONFIG,
            seed,
            systems: [POPULATE],
            content: { ...SALVOR, monsterChance: () => 0 },
            firstShip: (rng) => derelictShip(spec, 1, rng, { flags: new Set(), shipIndex: 1 }),
            firstShipId: "1",
          });
          const crates = game.ship.rooms.filter((r) =>
            roomList<Wreck>(r, "wrecks").some((w) => w.kind === relic && w.glyph === "X"),
          );
          expect(crates.length, `${spec.id} seed ${seed}: two relic crates`).toBeLessThanOrEqual(1);
          if (crates.length === 0) continue;
          hits++;
          const room = crates[0]!;
          const where = `${spec.id} seed ${seed}: ${room.label}`;
          expect(room.depth, `${where} is only ${room.depth} doors in`).toBeGreaterThanOrEqual(RELIC_DEPTH);
          expect(roomList<ShipSystem>(room, "systems"), `${where} holds a system`).toHaveLength(0);
          // Guarded — unless the deck alone already filled the hull to its
          // class's ceiling, which is the one case the guard is skipped so the
          // head count stays the class's (`systems/populate.ts`, `placeRelic`).
          const aboard = game.entities.filter((e) => e.id !== game.player.id).length;
          const guards = game.entitiesIn(room.id).filter((e) => e.id !== game.player.id);
          if (aboard < spec.machines[1]) {
            expect(guards.length, `${where} is unguarded`).toBeGreaterThanOrEqual(1);
          }
          expect(aboard, `${where}: over the class's count`).toBeLessThanOrEqual(spec.machines[1]);
          const crate = roomList<Wreck>(room, "wrecks").find((w) => w.kind === relic)!;
          expect(crate.integrity).toBe(moduleKind(relic).integrity);
          expect(crate.source).toBe("crate");
        }
      }
      expect(hits, `${relic} came up on ${hits} of ${per * classes.length} hulls`).toBeGreaterThanOrEqual(10);
    }
  });

  it("puts exactly one machine more into the crate's compartment than the deck and the budget did", () => {
    // A hand-drawn hull with one compartment deep enough and not a system's:
    // whatever the class's kit would have stood there, the relic adds one.
    const DEEP = `
      TUG -a1- r1
      r1 -d1- r2 -d2- r3 -d3- r4
      r4 -d4- r5
      r1: docking
      r2: cargo
      r3: corridor
      r4: storage
      r5: engineering
    `;
    const spec = { ...MILITARY, relics: ["blade"] as const };
    let placed = 0;
    for (const seed of seedRange(1, 30)) {
      const game = new RoomGame({
        ...GAME_CONFIG,
        seed,
        systems: [],
        content: { ...SALVOR, monsterChance: () => 0 },
        firstShip: () => shipFromText(DEEP).ship,
        firstShipId: "1",
      });
      const r5 = game.ship.room("r5");
      (r5.data as { systems?: ShipSystem[] }).systems = [{ id: 1, kind: "engine", online: false }];
      const machines = () =>
        game.ship.rooms.map((r) => game.entitiesIn(r.id).filter((e) => e.id !== game.player.id).length);
      const before = machines();

      const room = placeRelic(game, spec);
      if (room === undefined) {
        expect(machines()).toEqual(before);
        continue;
      }
      placed++;
      expect(room.label).toBe("r4");
      const after = machines();
      for (let i = 0; i < after.length; i++) {
        expect(after[i], game.ship.rooms[i]!.label).toBe(before[i]! + (game.ship.rooms[i] === room ? 1 : 0));
      }
      expect(roomList<Wreck>(room, "wrecks").map((w) => w.kind)).toEqual(["blade"]);
    }
    // Six in ten, so thirty seeds place some and leave some.
    expect(placed).toBeGreaterThanOrEqual(5);
    expect(placed).toBeLessThanOrEqual(28);
  });
});
