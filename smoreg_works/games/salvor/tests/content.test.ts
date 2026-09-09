import { describe, it, expect } from "vitest";
import { ZONE_KINDS } from "../src/content/zones.js";
import { DERELICTS } from "../src/content/derelicts.js";
import {
  BLOOM_KIND,
  CRAWLER,
  ENFORCER,
  JAMMER,
  MONSTERS,
  SENTRY_TURRET,
  machineAboard,
} from "../src/content/monsters.js";
import { MODULES, type ModuleId } from "../src/content/modules.js";
import { SALVAGE_POOL } from "../src/content/cards.js";
import { HULLS } from "../src/content/hulls.js";
import { OBJECTIVES } from "../src/content/objectives.js";
import { DEFAULT_STRAIN, STRAINS, strainOf } from "../src/content/viruses.js";

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
    // Three routes, and a module needs one of them: it comes bolted to a hull
    // you can buy, it drops off a machine, or it turns up as loose scrap. A
    // module on none of the three is a row in the catalogue and nothing else.
    const onHulls = new Set(HULLS.flatMap((h) => h.modules));
    const dropped = new Set(ALL.map((m) => m.salvage).filter((s): s is ModuleId => s !== undefined));
    const scrap = new Set(SALVAGE_POOL);
    for (const id of Object.keys(MODULES) as ModuleId[]) {
      const where = [
        onHulls.has(id) ? "a hull" : undefined,
        dropped.has(id) ? "a machine" : undefined,
        scrap.has(id) ? "scrap" : undefined,
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
