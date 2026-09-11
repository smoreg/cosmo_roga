/**
 * Turning events into words.
 *
 * The core says what happened; this says how to read it. Keeping the wording
 * out of the rules is what lets the same event drive a log line, an animation
 * and a test assertion without any of them agreeing on prose.
 */

import type { GameEvent } from "../core/events";
import { ROSTER } from "../core/roster";
import type { DeckMap } from "../core/types";

export type LogTone = "plain" | "quiet" | "loud" | "good" | "bad";

export interface LogLine {
  readonly tone: LogTone;
  readonly channel: string;
  readonly text: string;
}

function zoneName(deck: DeckMap, zoneId: number | null): string {
  if (zoneId === null) return "";
  return deck.zones.get(zoneId)?.name ?? "somewhere";
}

function nameOfUnit(unitId: number, names: ReadonlyMap<number, string>): string {
  return names.get(unitId) ?? `unit ${unitId}`;
}

function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function describeEvent(
  event: GameEvent,
  deck: DeckMap,
  names: ReadonlyMap<number, string>,
): LogLine | null {
  switch (event.kind) {
    case "unitMoved":
      if (event.enteredZone === null) return null;
      return {
        tone: "plain",
        channel: "move",
        text: `${nameOfUnit(event.unitId, names)} crosses into ${zoneName(deck, event.enteredZone)}.`,
      };
    case "movementHalted":
      return {
        tone: "loud",
        channel: "zoc",
        text: `${nameOfUnit(event.unitId, names)} is halted by ${nameOfUnit(event.by, names)}'s zone of control.`,
      };
    case "doorForced":
      return {
        tone: "loud",
        channel: "door",
        text: `${nameOfUnit(event.unitId, names)} forces door d${event.doorId} open into ${zoneName(deck, event.intoZone)} — that is the whole move.`,
      };
    case "doorCut":
      return {
        tone: "loud",
        channel: "door",
        text: `${nameOfUnit(event.unitId, names)} cuts door d${String(event.doorId)} open.`,
      };
    case "attackDeclared": {
      const attacker = nameOfUnit(event.attackerId, names);
      const target = nameOfUnit(event.targetId, names);
      const weapon = `${event.weapon.name} (${event.weapon.damage}-${event.weapon.strikes}, ${event.weapon.weaponClass})`;
      const answer =
        event.answeringWeapon === null
          ? event.targetIsObject
            ? "It cannot answer."
            : `${target} has no ${event.weapon.weaponClass} weapon and cannot answer.`
          : `${target} answers with ${event.answeringWeapon.name}.`;
      return {
        tone: "bad",
        channel: "fight",
        text: `${attacker} attacks ${target} with ${weapon}. ${answer}`,
      };
    }
    case "strikeLanded":
      return {
        tone: "quiet",
        channel: "strike",
        text: `  ${nameOfUnit(event.sourceId, names)} hits for ${event.damage} (${event.remaining} left)`,
      };
    case "strikeMissed":
      return {
        tone: "quiet",
        channel: "strike",
        text: `  ${nameOfUnit(event.sourceId, names)} misses`,
      };
    case "unitDestroyed":
      return {
        tone: "bad",
        channel: "kill",
        text: `${nameOfUnit(event.unitId, names)} destroyed.`,
      };
    case "objectDestroyed":
      return {
        tone: event.objectKind === "spawner" ? "good" : "good",
        channel: "kill",
        text:
          event.objectKind === "spawner"
            ? `${event.name} destroyed. ${event.spawnersLeft} spawn zone(s) left.`
            : `${event.name} cut. ${event.nodesLeft} node(s) still paying.`,
      };
    case "incomePaid":
      return {
        tone: "plain",
        channel: "econ",
        text: `Nodes pay ${round(event.amount)}. Pool ${round(event.pool)}.`,
      };
    case "hostileBuilt":
      return {
        tone: "loud",
        channel: "spawn",
        text: `A ${ROSTER[event.unitType].label} is built for ${event.cost}. Pool ${round(event.pool)}.`,
      };
    case "buildBlocked":
      if (event.reason === "cannotAfford") return null;
      return {
        tone: "quiet",
        channel: "econ",
        text:
          event.reason === "noRoom"
            ? `No room beside a spawn zone; the ship holds ${round(event.pool)}.`
            : "Nothing left to build with.",
      };
    case "turnBegan":
      return {
        tone: "plain",
        channel: "turn",
        text:
          event.side === "drone"
            ? `Turn ${event.turn} — drones.`
            : `Turn ${event.turn} — the ship.`,
      };
    case "missionEnded":
      return {
        tone: event.outcome === "win" ? "good" : "bad",
        channel: "over",
        text:
          event.outcome === "win"
            ? "Every spawn zone is destroyed. The ship has nothing left to build with."
            : "Both drones are gone. Nothing is coming back to the tug.",
      };
    case "commandRefused":
      return { tone: "quiet", channel: "refused", text: event.reason };
  }
}

export function describeAll(
  events: readonly GameEvent[],
  deck: DeckMap,
  names: ReadonlyMap<number, string>,
): LogLine[] {
  const lines: LogLine[] = [];
  for (const event of events) {
    const line = describeEvent(event, deck, names);
    if (line !== null) lines.push(line);
  }
  return lines;
}
