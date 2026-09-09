import type { Entity, RoomGame, System } from "@jamrog/engine";
import { JAMMER, machineName } from "../content/monsters.js";
import { t } from "../i18n.js";
import { hostilesIn } from "../twist/rig.js";

/**
 * What is standing in this compartment, said once, on the turn the drone walks
 * in on it.
 *
 * The panel says the same thing on every frame, which is exactly why it cannot
 * be the whole answer: a block that looks on the turn you arrive the way it
 * looked the turn before is a block a player reads once and then stops seeing.
 * The owner's third playtest is the proof — "меня бьют, я игнорю"
 * (docs/tasks/G47-contacts.md). So the loud version of the block is a rule about
 * a moment: one line that exists on the turn the compartment changed and would
 * not have been written had the compartment been empty.
 *
 * A system rather than a helper in the panel, because the moment is the turn
 * cycle's and not the renderer's — `src/ui` is redrawn whenever a card opens or
 * a language changes, and a line written from there would be said twice or not
 * at all. This is also where the one word for what a machine does to a rack
 * lives: the panel imports it, rather than the rules importing the panel
 * (`tests/purity.test.ts`, "the rules never import the renderer").
 */

/** The compartment the line was last said for. Per ship, so ids never collide. */
interface ContactState {
  at: number;
}

/** No compartment yet: the first turn aboard anything counts as walking in. */
const NOWHERE = -1;

function contactState(game: RoomGame): ContactState {
  const data = game.currentShip.data;
  const raw = data.contacts;
  // The pocket round-trips through a save file, so nothing in it is trusted.
  if (typeof raw === "object" && raw !== null && typeof (raw as ContactState).at === "number") {
    return raw as ContactState;
  }
  const fresh: ContactState = { at: NOWHERE };
  data.contacts = fresh;
  return fresh;
}

export const CONTACTS: System<RoomGame> = {
  name: "contacts",

  /**
   * Boarding is walking in. A derelict the drone has been aboard before keeps
   * its own record of everything else, and the compartment it was standing in
   * when it cycled out is usually the one it comes back to — without this, the
   * second sortie into a hull with something waiting at the airlock would be
   * the one sortie that says nothing.
   */
  onLevelEnter(game) {
    contactState(game).at = NOWHERE;
  },

  /**
   * Only on a change of compartment, and only when something living is in the
   * new one. Standing still says nothing however long the drone stands there:
   * the machine is on the panel for exactly as long as it is in the room, and a
   * line repeated every turn is a line that stops being read — which is the
   * defect this was written for, not a fix for it.
   */
  afterPlayerTurn(game) {
    if (game.status !== "playing") return;
    const state = contactState(game);
    const room = game.roomOf(game.player).id;
    if (room === state.at) return;
    state.at = room;

    const line = contactsWarning(game);
    if (line !== undefined) game.log.add(line, game.schedule.time, "warn", "log.contacts.here");
  },
};

/**
 * `In here: security unit 8/8, melee` — every machine in the drone's own
 * compartment, with the number the fight turns on and the word for why.
 *
 * A pure function of the game and nothing else, so the panel's tests and this
 * system's can ask it the same question.
 */
export function contactsWarning(game: RoomGame): string | undefined {
  const machines = hostilesIn(game, game.roomOf(game.player).id);
  if (machines.length === 0) return undefined;
  const list = machines
    .map((m) =>
      t("log.contacts.one", {
        machine: machineName(m.name),
        hp: `${m.hp}/${m.hpMax}`,
        danger: dangerWord(m),
      }),
    )
    .join("; ");
  return t("log.contacts.here", { list });
}

/**
 * One word for what this machine does to a rack, read off the entity rather
 * than the catalogue.
 *
 * Off the entity because the catalogue is not the whole bestiary: a ghost
 * carries the dead drone's own numbers and the rival's drone is spawned by its
 * own system, and both stand in compartments and hit people. `Entity` carries
 * everything the answer needs — `behaviour`, `range`, `tags`, the damage dice —
 * so the rival gets its word for free and `content/monsters.ts` stays a table
 * nobody has to annotate.
 *
 * The order is the order of surprise. A hunter is the one thing aboard that
 * comes looking and cuts through what the drone welded shut, so it is worth
 * saying before anything else about it; the jammer's field is worth saying
 * before its swing, because while it stands there the rack does nothing; a
 * corrosive machine is the one fight that pays nothing at all, which is the
 * whole argument for walking away from it; and a machine with reach is a fight
 * that starts before the drone chooses to have one. Everything left over swings
 * in the compartment, which is what `melee` means and what most of the table is.
 */
export function dangerWord(machine: Entity, throughDoor = false): string {
  // Behind a bulkhead the order changes, and only there. In the compartment the
  // question is what this thing does to a rack; a door away it is whether it can
  // reach the drone from where it stands, and nothing else on the screen answers
  // that. The ENFORCER is both — a hunter with a reach of one — and `hunter`
  // won, so the owner traded shots with one through an open door and read its
  // staying put as the machine being broken: «он не подходит»
  // (docs/owner-queue.md, 1). It shoots, and now the line says so until it is
  // in the room, where the hunter's own word is the one that matters again.
  if (throughDoor && (machine.range ?? 0) >= 1) return t("danger.door");
  if (machine.behaviour === "hunter") return t("danger.hunter");
  if (machine.name === JAMMER.name) return t("danger.jam");
  if (machine.tags?.includes("corrosive") === true) return t("danger.noScrap");
  if ((machine.range ?? 0) >= 1) return t("danger.door");
  const [count, sides, flat] = machine.damage;
  if (count * sides + flat <= 0) return t("danger.still");
  return t("danger.melee");
}
