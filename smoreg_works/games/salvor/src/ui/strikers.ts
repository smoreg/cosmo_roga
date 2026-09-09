import type { Door, Entity, RoomGame, RoomId } from "@jamrog/engine";
import { MODULES, moduleName, type ModuleId } from "../content/modules.js";
import { machineName } from "../content/monsters.js";
import { t } from "../i18n.js";
import { hostilesIn } from "../twist/rig.js";

/**
 * Who is hitting the drone, when the drone cannot see them.
 *
 * A leaf: it reads the log and the ship and imports no other view. That is the
 * whole reason it exists as a file — the panel, the map and the `Tab` key all
 * need the same answer, and having them ask each other for it put three import
 * cycles into `src/ui` (`docs/adr/0003-decoupling.md`).
 */

/** Module names as the rack is printing them, longest first: CELL is inside nothing. */
function rackNames(): string[] {
  return (Object.keys(MODULES) as ModuleId[]).map(moduleName).sort((a, b) => b.length - a.length);
}

/**
 * Who hit the drone on the last turn the log has anything to say about.
 *
 * Read off the log rather than off the machines, because nothing on a machine
 * records it: the blow is `twist/rig.ts`'s to route and its only trace is the
 * line it writes. Matching on the subject of that sentence is loose on purpose
 * — a machine whose name changes still matches, and the worst a miss can do is
 * leave one row without its second line.
 */
export function blowsLastTurn(game: RoomGame): Array<{ subject: string; what: string }> {
  const lines = game.log.lines;
  const last = lines[lines.length - 1]?.turn;
  const names = rackNames();
  const out: Array<{ subject: string; what: string }> = [];
  for (let i = lines.length - 1; i >= 0 && lines[i]!.turn === last; i--) {
    const line = lines[i]!;
    if (line.key !== "log.hit.module") continue;
    const module = names.find((name) => line.text.includes(name));
    if (module === undefined) continue;
    out.push({ subject: line.text.toLowerCase(), what: t("panel.contact.hit", { module }) });
  }
  return out;
}

/**
 * Machines that hit the drone on the turn just gone from a compartment it
 * cannot see into.
 *
 * A machine sees one door out with `sight: 1`; the drone sees that far only
 * while a SCANNER is intact, and `BARE_CHASSIS.sight` is 0 (`twist/rig.ts`).
 * So a burned scanner is meant to cost vision — but it was also costing the
 * player the shot itself: the enforcer fired through a shut door every turn,
 * the log said `enforcer: hit, THRUSTERS (1/12)`, the panel listed no contact
 * and `Tab` answered `no targets in sight`. The owner's words, watching a fresh
 * GHOST come apart over two turns: "невидимый каратель?", "я не понимаю что
 * происходит".
 *
 * Being shot is itself information, and it is the only information handed back
 * here: the machine that fired, and the door it fired through. Everything else
 * in that compartment stays unseen — losing the scanner still costs what it is
 * supposed to cost.
 */
export function strikersNear(
  game: RoomGame,
  here: RoomId,
): Array<{ machine: Entity; room: RoomId; door: Door }> {
  const blows = blowsLastTurn(game);
  if (blows.length === 0) return [];
  const out: Array<{ machine: Entity; room: RoomId; door: Door }> = [];
  for (const door of game.ship.doorsOf(here)) {
    if (door.a === door.b) continue;
    const room = game.ship.other(door, here);
    if (game.visible.has(room)) continue;
    for (const machine of hostilesIn(game, room)) {
      const name = machineName(machine.name).toLowerCase();
      if (blows.some((b) => b.subject.includes(name))) out.push({ machine, room, door });
    }
  }
  return out;
}
