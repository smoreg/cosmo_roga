import { RoomDistance, isAlive, lastKnownRoom, type Entity, type RoomGame } from "@jamrog/engine";
import { MAX_LEVEL, alertState } from "../systems/alert.js";
import { canSeeDrone } from "../systems/sight.js";
import { rivalState } from "../systems/rivalstate.js";
import { virusOf } from "../systems/virus.js";
import { carriedBy, rigOf, wrecksIn } from "../twist/rig.js";
import { passableForPlayer } from "./auto.js";

/**
 * The owner's debug overlay — "добавь в игру логов, чтобы самому разбирать и
 * искать проблемы, тип дебаг-режим" (8.09, docs/tasks/G68-debug-overlay.md).
 *
 * A pure read of the running game, nothing more: no line here ever reaches
 * `game.log`, spends a turn, or touches `game.rng`, so it cannot change a
 * replay and needs no seed of its own. Deliberately plain English rather than
 * `t()` — this is a diagnostic panel for the person running the build, not
 * game text a player reads, and the three-language table gains nothing by
 * carrying it (`tests/purity.test.ts` has a named exception for this file).
 *
 * Drawn under the log in both views by `ui/panel.ts` (`debugBlockLines`) and
 * `ui/web/panel-html.ts` (`debugHtml`); switched on by `` ` `` or `?debug=1`,
 * both decided in `ui/app.ts` — this file has no opinion on whether it is
 * shown, only on what it says once asked.
 */

/** Machines: everything alive that is not the drone. */
function machinesAboard(game: RoomGame): Entity[] {
  return game.entities.filter((e) => e.id !== game.player.id && e.faction !== game.player.faction && isAlive(e));
}

function roomLabelOf(game: RoomGame, room: number | undefined): string {
  if (room === undefined) return "?";
  return game.ship.rooms[room]?.label ?? String(room);
}

function machineLine(game: RoomGame, distances: RoomDistance, m: Entity): string {
  const remembered = lastKnownRoom(m);
  const dist = m.room === undefined ? "?" : String(distances.at(m.room));
  return (
    `MACHINE ${m.name} room=${roomLabelOf(game, m.room)} behaviour=${m.behaviour ?? "brute"} ` +
    `remembers=${remembered === undefined ? "-" : roomLabelOf(game, remembered)} dist=${dist} ` +
    `hp=${m.hp}/${m.hpMax} stunned=${m.stunned ?? 0} sees-drone=${canSeeDrone(game, m)}`
  );
}

function alertLine(game: RoomGame): string {
  const a = alertState(game);
  const boom = a.detonateAt >= 0 ? ` detonateAt=${a.detonateAt}` : "";
  const fuses = a.fuses.length === 0 ? "" : ` fuses=${a.fuses.map((f) => `${f.room}@${f.at}`).join(",")}`;
  return `ALERT level=${a.level}/${MAX_LEVEL} turnsAboard=${a.turnsAboard} quiet=${a.quietTurns}${boom}${fuses}${a.frozen ? " frozen" : ""}`;
}

function droneLine(game: RoomGame): string {
  const rig = rigOf(game.player);
  const exposed = rig?.exposed;
  const exposedKind = exposed === null || exposed === undefined ? "-" : (rig?.slots[exposed]?.kind ?? "-");
  const carried = carriedBy(game.player);
  const hold = carried.length === 0 ? "-" : carried.map((c) => `${c.kind}:${c.integrity}`).join(",");
  return `DRONE exposed=${exposedKind} carrying=${hold}`;
}

function rivalLine(game: RoomGame): string {
  const r = rivalState(game);
  if (!r.enabled) return "RIVAL disabled";
  return `RIVAL progress=${r.progress} alive=${r.alive ?? false} evac=${r.evac ?? "-"}`;
}

function virusLine(game: RoomGame): string {
  const v = virusOf(game.player);
  if (!v) return "VIRUS none";
  const curing = v.curing === undefined ? "-" : String(v.curing.left);
  return `VIRUS strain=${v.strain ?? "spasm"} slot=${v.slot} turns=${v.turns} curing=${curing}`;
}

function relicsLine(game: RoomGame): string {
  const found: string[] = [];
  for (const room of game.ship.rooms) {
    for (const wreck of wrecksIn(game, room.id)) {
      if (wreck.source === "crate") found.push(`${wreck.kind}@${room.label}`);
    }
  }
  return found.length === 0 ? "RELICS none" : `RELICS ${found.join(", ")}`;
}

/**
 * Everything the overlay says, one line each. Always the full read — a caller
 * that wants nothing shown passes an empty array of its own rather than
 * asking this function to decide (`debugBlock`, below).
 */
export function debugLines(game: RoomGame): string[] {
  const here = game.roomOf(game.player).id;
  const distances = RoomDistance.from(game.ship, [here], passableForPlayer);
  const machines = machinesAboard(game);
  return [
    alertLine(game),
    ...(machines.length === 0 ? ["MACHINES none"] : machines.map((m) => machineLine(game, distances, m))),
    droneLine(game),
    rivalLine(game),
    virusLine(game),
    relicsLine(game),
  ];
}

/** `debugLines(game)` when the flag is on, and nothing at all when it is not. */
export function debugBlock(game: RoomGame, enabled: boolean): string[] {
  return enabled ? debugLines(game) : [];
}
