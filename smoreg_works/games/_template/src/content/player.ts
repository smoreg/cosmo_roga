import { Faction, makeEntity, type Entity, type Point } from "@jamrog/engine";

export function makePlayer(pos: Point): Entity {
  return makeEntity({
    name: "you", ch: "@", fg: "#f0e6d2", pos: { ...pos }, faction: Faction.Player,
    hp: 20, hpMax: 20, damage: [1, 6, 1], defense: 1, speed: 100, fovRadius: 8, tags: [],
  });
}
