import { Faction, makeEntity, type Entity } from "../sim/entity.js";
import type { Rng } from "../sim/rng.js";
import type { MonsterKind, RoomContentPack } from "../content/kinds.js";
import type { Ship } from "../rooms/graph.js";
import type { ShipSpec } from "../rooms/types.js";
import { shipFromText } from "./roomfixtures.js";

/**
 * A content pack for the graph engine's own tests — the twin of
 * `dummycontent.ts`, and dull for the same reason: two machines with round
 * numbers, so a failing test points at the engine and not at whichever game
 * happened to be imported.
 *
 * Games must never ship this. It exists so `packages/engine` has no dependency
 * on anything in `games/`.
 */
export const TEST_ROOM_MONSTERS: MonsterKind[] = [
  { id: "grunt",  name: "grunt",  ch: "g", fg: "#888", hp: 6, damage: [1, 4, 0], defense: 0, speed: 100, fovRadius: 6, behaviour: "brute", sight: 0, minDepth: 1, maxDepth: 99, weight: 10 },
  { id: "runner", name: "runner", ch: "r", fg: "#8a8", hp: 4, damage: [1, 3, 0], defense: 0, speed: 150, fovRadius: 8, behaviour: "brute", sight: 1, keen: true, minDepth: 2, maxDepth: 99, weight: 5 },
];

/** A drone with a working sensor: it sees the next room through an open door. */
export function makeTestDrone(): Entity {
  return makeEntity({
    name: "drone", ch: "@", fg: "#fff", pos: { x: 0, y: 0 }, faction: Faction.Player,
    hp: 20, hpMax: 20, damage: [1, 6, 1], defense: 1, speed: 100, fovRadius: 8, sight: 1, tags: [],
  });
}

export const TEST_ROOM_CONTENT: RoomContentPack = {
  name: "engine test derelict",
  maxMonsters: 4,
  makePlayer: makeTestDrone,
  monstersForDepth: (depth) => TEST_ROOM_MONSTERS.filter((m) => depth >= m.minDepth && depth <= m.maxDepth),
  monsterChance: (depth) => 0.2 + 0.1 * depth,
  openingLine: "Test sortie begins.",
};

/** Three kinds of compartment and every door state: enough to generate against. */
export const TEST_SHIP_SPEC: ShipSpec = {
  rooms: [8, 12],
  maxDepth: 4,
  entryKind: "docking",
  kinds: [
    { kind: "docking", name: "DOCKING BAY", required: true },
    { kind: "cargo", name: "CARGO BAY", weight: 3, cover: true },
    { kind: "engine", name: "ENGINE ROOM", weight: 2, deep: true },
  ],
  doors: { open: 6, closed: 3, locked: 1, sealed: 1, broken: 1 },
  cardsPerRoom: 1,
};

/**
 * Six compartments, one locked door with its key on the near side, one loop —
 * the smallest ship that still poses every question the turn cycle asks.
 *
 *   r1 —d1— r2 —d2— r3        r1 is the docking bay, off the airlock a1
 *   r2 (d3) r4 —d5— r6        d3 starts closed, d4 is locked by k1
 *   r3 [d4:k1] r5 —d6— r6     d6 closes the loop
 */
export const TEST_SHIP_TEXT = `
  TUG -a1- r1
  r1 -d1- r2 -d2- r3
  r2 -(d3)- r4
  r3 -[d4:k1]- r5
  r4 -d5- r6
  r5 -d6- r6
  r1: docking
  r2: cargo †:k1
  r3: corridor
  r4: storage
  r5: engine
  r6: reactor
`;

/**
 * The ship engine tests are played on until E20 lands a generator. Built from
 * the fixture text, then shaken by the rng: which room offers cover and which
 * door starts shut differ per seed, which is enough for a property test to be
 * about two hundred ships rather than one.
 */
export function testShip(rng: Rng): Ship {
  const { ship } = shipFromText(TEST_SHIP_TEXT);

  ship.roomAt(rng.int(1, ship.size - 1)).cover = true;
  const open = ship.doors.filter((d) => d.state === "open");
  if (open.length > 0) rng.pick(open).state = "closed";
  return ship;
}
