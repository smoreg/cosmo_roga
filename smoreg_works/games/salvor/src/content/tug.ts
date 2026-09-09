import { Ship, layoutShip, type Door, type LevelId, type Room, type RoomGame } from "@jamrog/engine";
import { tId } from "../i18n.js";

/**
 * The tug: four compartments, and every decision between sorties is one of them
 * (design-doc.md, "Буксир").
 *
 * Not a screen and not a menu. The tug is a `Ship` like any derelict, drawn by
 * the same schematic and walked with the same `go`, so buying a hull is a place
 * the drone stands rather than a mode the game enters. What each compartment
 * offers is `systems/tug.ts`; this file is only the graph.
 *
 *   DOCK -t1- HOLD -t2- BENCH -t3- HELM
 *    │
 *   (a1) the airlock, to whichever derelict the tug is tied to
 *
 * Built by hand rather than by the generator, and with the constructor rather
 * than `shipFromText`: the tug is fixed content, and `@jamrog/engine/testing`
 * must never reach a bundle.
 */

/** The store id of the tug. One per run: every sortie comes back to it. */
export const TUG_ID: LevelId = "tug";

/**
 * The compartments, shallowest first — which is also the order they sit in on
 * the schematic. DOCK carries the airlock; HELM is three doors in.
 */
export const TUG_ROOMS = ["DOCK", "HOLD", "BENCH", "HELM"] as const;

/** What `Room.kind` carries aboard the tug: the compartment's name, lowercased. */
export type TugRoomKind = Lowercase<(typeof TUG_ROOMS)[number]>;

export const TUG_KINDS: readonly TugRoomKind[] = TUG_ROOMS.map(
  (name) => name.toLowerCase() as TugRoomKind,
);

/** The kind of a tug compartment, or nothing when the string is a derelict's. */
export function tugRoomKind(kind: string): TugRoomKind | undefined {
  return (TUG_KINDS as readonly string[]).includes(kind) ? (kind as TugRoomKind) : undefined;
}

/**
 * What the panel and every refusal call a station.
 *
 * The same row a tug compartment is drawn from, so `[BENCH]` on the panel and
 * `Do that at the BENCH.` in a refusal can never come out as two words for one
 * place.
 */
export function stationName(kind: TugRoomKind): string {
  return tId("room", kind, kind.toUpperCase());
}

/**
 * The tug as a graph: a line of four rooms, all doors open, the airlock on the
 * DOCK.
 *
 * The airlock is a self-edge on the entry — `Ship` spells "off the ship" that
 * way, and it is what puts the tug box on the left of the schematic. Rooms are
 * labelled `r1`…`r4` and the bulkheads between them `t1`…`t3`, so a door label
 * on the tug can never be read as a compartment's.
 *
 * Deterministic and rng-free: the tug is the same four rooms in every run, and
 * `layoutShip` is a pure function of the graph, so the drawing survives a save.
 */
export function tugShip(): Ship {
  const rooms: Room[] = TUG_ROOMS.map((name, i) => ({
    id: i,
    label: `r${i + 1}`,
    kind: name.toLowerCase(),
    name,
    depth: i,
    col: i,
    row: 0,
    cover: false,
    hazard: "none",
    // Your own ship: nothing aboard it was ever unknown.
    explored: true,
    scanned: true,
    marks: [],
    data: {},
  }));

  const doors: Door[] = [{ id: 0, label: "a1", a: 0, b: 0, state: "airlock" }];
  for (let i = 1; i < rooms.length; i++) {
    doors.push({ id: doors.length, label: `t${i}`, a: i - 1, b: i, state: "open" });
  }

  const ship = new Ship(rooms, doors, 0);
  layoutShip(ship);
  return ship;
}

/** Is the drone home on the tug rather than inside a derelict? */
export function isTug(game: RoomGame): boolean {
  return game.shipId === TUG_ID;
}
