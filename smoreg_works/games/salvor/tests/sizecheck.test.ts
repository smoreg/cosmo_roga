import { describe, it } from "vitest";
import { Rng } from "@jamrog/engine";
import { DERELICTS, buildDerelict } from "../src/content/derelicts.js";
describe("d", () => { it("sizes", () => {
  for (const spec of DERELICTS) {
    let rooms = 0, doors = 0, n = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const built = buildDerelict(spec, 1, new Rng(seed), { flags: new Set(), shipIndex: 1 });
      rooms += built.ship.rooms.length;
      doors += built.ship.doors.filter((d) => d.a !== d.b).length;
      n++;
    }
    console.log(`${spec.id.padEnd(12)} target ${spec.rooms[0]}-${spec.rooms[1]}  rooms ${(rooms/n).toFixed(1)}  doors ${(doors/n).toFixed(1)}`);
  }
}); });
