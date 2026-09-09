import { Faction, makeEntity, type Entity, type Point } from "@jamrog/engine";

export const PLAYER_FOV = 8;

/** CORE hit points. Never healed — three mistakes end the run (see design-doc.md). */
export const CORE_HP = 3;

export function makePlayer(pos: Point): Entity {
  return makeEntity({
    name: "drone",
    ch: "@",
    fg: "#f0e6d2",
    pos: { ...pos },
    faction: Faction.Player,
    hp: CORE_HP,
    hpMax: CORE_HP,
    // Bare chassis. The rig overwrites damage, speed and fovRadius from the
    // installed modules the moment a run starts (twist/rig.ts, derivedStats).
    damage: [1, 1, 0],
    defense: 0,
    speed: 100,
    fovRadius: PLAYER_FOV,
    tags: [],
  });
}
