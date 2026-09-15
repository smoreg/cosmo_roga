import { TURN_COST, type ActionOffer, type Outcome, type RoomCommand, type RoomGame, type System } from "@jamrog/engine";
import { moduleBurnLine } from "../content/modules.js";
import { OBJECTIVE_COUNT, needsLine, objectiveName, objectiveOnlineLine, objectiveSpec, toolExposes, toolName, type ObjectiveJob, type ObjectiveSpec } from "../content/objectives.js";
import { applyDerived, findSlot, registerHackTarget, rigOf, routeDamage, type HackTarget } from "../twist/rig.js";
import { hint, turnRoom } from "../content/hints.js";
import { jobNow, registerJob, sayBrokenOff } from "./jobs.js";
import { t } from "../i18n.js";
import { raiseAlert, standDown } from "./alert.js";
import { keysHeld } from "./doors.js";
import { roomList, type ShipSystem } from "./populate.js";
import { shipState, type ShipState, type ShipWork } from "./shipstate.js";
import { credit, derelictAboard } from "./voyage.js";

/**
 * Neutralising a derelict: three systems, the tools that raise them, and the
 * turns they take (design-doc.md, "Обезвредить корабль").
 *
 * What a neutralised hull is *worth* is not here: the account, the sale and
 * where the airlock leads belong to `systems/voyage.ts`, which claims the
 * outcome (G26). This file answers one question — how much of this ship answers
 * to the drone — and everything the drone does aboard is still the same bargain
 * the doors are: a tool, some turns standing still, and a noise the ship hears.
 * Every number of it is `content/objectives.ts`.
 *
 * Two verbs, one job. `work` is the tool — a CUTTER into the engine, a CELL
 * into the reactor, a SPIKE or a card into the terminal. `force` is the same
 * job with nothing in the rack: the twin of the bulkhead the chassis rams open
 * (`systems/doors.ts`, `ram`, G90 B), and there for the same reason — a drone
 * is never stuck in front of the one thing that finishes the hull, it is only
 * made to pay for it, in turns and in a ship that hears every one of them
 * (G94). The list offers it only where the tool is missing; the command takes
 * it whenever it is given, because a reactor raised by hand keeps the CELL's
 * point, and that is a choice a player may make on purpose.
 */

// --------------------------------------------------------------- the numbers

/**
 * Steps of alert a system costs when it comes up: design-doc.md's `+2` on a
 * five-rung ladder, which is four on the ten-rung one (G90 A).
 *
 * Steps and not points: each one of them is a rung of the ship's ladder
 * (`systems/alert.ts`), so a loud hull meets the hunter on its second system.
 * The third is the exception — it is the switch that turns the ladder off
 * (`standDown`), and it costs nothing: "обезвреживание вырубает этот процесс".
 */
const ALERT_PER_SYSTEM = 4;

/** Integrity the reactor takes out of the CELL that brought it up. */
const CELL_COST = 1;

/** The one line this file writes on its own account: a splice let go of. */

const FAIL = (reason: string): Outcome => ({ ok: false, cost: 0, reason });
const DONE = (): Outcome => ({ ok: true, cost: TURN_COST });

/** Every system aboard the ship the drone is on, raised or not. */
export function systemsAboard(game: RoomGame): ShipSystem[] {
  return game.ship.rooms.flatMap((room) => [...roomList<ShipSystem>(room, "systems")]);
}

/** The system standing in this compartment under that id, if any. */
function systemHere(game: RoomGame, target: number | undefined): ShipSystem | undefined {
  const here = roomList<ShipSystem>(game.roomOf(game.player), "systems");
  return target === undefined ? here[0] : here.find((s) => s.id === target);
}

/**
 * The keycard the terminal eats. The keyring belongs to `systems/doors.ts`;
 * this is the one other thing that spends a card, and it spends it the same
 * way — one number, never below zero.
 */
function spendKey(game: RoomGame): void {
  const data = (game.player.data ??= {});
  data.keys = Math.max(0, keysHeld(game.player) - 1);
}

/**
 * The charge the reactor costs, taken out of the CELL that carried it.
 *
 * Routed through the rig's own damage path, exactly as a powered bulkhead is
 * (`systems/doors.ts`): what happens when a module runs out has one
 * implementation, and `corrosive` is what keeps the PLATING out of the chain —
 * a module spending itself is not a blow the armour can take.
 */
function spendCell(game: RoomGame): void {
  const rig = rigOf(game.player);
  const slot = rig ? findSlot(rig, "cell") : null;
  if (!rig || slot === null) return;

  rig.exposed = slot;
  for (const hit of routeDamage(rig, CELL_COST, ["corrosive"]).hits) {
    if (hit.burned) game.log.add(moduleBurnLine(hit.kind), game.schedule.time, "bad", "log.module.burn");
  }
  applyDerived(game.player);
}

/**
 * The splice, as the shared job the rest of the game draws (`systems/jobs.ts`).
 *
 * The record keeps what is *left*, because that is what the bots read to know
 * a turn moved the job at all; the template wants what is *done*, because that
 * is the half a player is watching. The turn is here, once, rather than in
 * every screen that has to show a count.
 */
registerJob((game) => {
  const work = shipState(game).work;
  if (work === undefined) return undefined;
  const system = systemsAboard(game).find((s) => s.id === work.id);
  const spec = system === undefined ? undefined : objectiveSpec(system.kind);
  if (spec === undefined) return undefined;
  const job = work.tool === "hands" ? spec.hands : spec.jobs.find((j) => j.tool === work.tool);
  if (job === undefined) return undefined;
  return { target: work.id, what: "splice", done: job.turns - work.left, of: job.turns };
});

// ------------------------------------------------------------------- the work

/**
 * A system, as something a tool is worked into for several turns.
 *
 * The same contract a locked bulkhead answers (`twist/rig.ts`, `HackTarget`):
 * the rig owns "work exposes what you work with" and knows no word for a
 * reactor, so the target is the half that says which module that is and what
 * happens when the job runs out. `turnsLeft` is an accessor pair over the
 * ship's own record, so a splice survives being interrupted and saved.
 */
function systemHack(
  game: RoomGame,
  system: ShipSystem,
  spec: ObjectiveSpec,
  job: ObjectiveJob,
): HackTarget {
  const state = shipState(game);
  const started = (): ShipWork | undefined =>
    state.work?.id === system.id && state.work.tool === job.tool ? state.work : undefined;

  return {
    name: objectiveName(spec).toLowerCase(),
    expose: toolExposes(job.tool),
    get turnsLeft(): number {
      return started()?.left ?? job.turns;
    },
    set turnsLeft(left: number) {
      state.work = { id: system.id, left, tool: job.tool };
    },
    breach(g: RoomGame): void {
      raise(g, system, spec, job.tool);
    },
  };
}

/**
 * A system comes up: the ship notices, the charter pays on account, and the
 * derelict is one third less of a derelict for the rest of the run.
 *
 * **On account**, which is the word design-doc.md uses ("Экономика рейса":
 * `аванс за каждую поднятую систему`) and which G41 made true: the 15 CR go
 * straight into the voyage's credits and not into the pocket the drone is
 * carrying. The difference is the whole point of an advance — a drone that
 * brings the reactor up and is then taken apart by what the noise brought has
 * still been paid for the reactor. Measured before the change: the ship you
 * died bringing online paid nothing at all.
 */
function raise(game: RoomGame, system: ShipSystem, spec: ObjectiveSpec, tool: ObjectiveJob["tool"]): void {
  const state = shipState(game);
  if (state.online.includes(spec.id)) return;

  system.online = true;
  state.online.push(spec.id);
  if (tool === "cell") spendCell(game);
  // The cause before its consequences: the system is up, and *then* the ship
  // stands down or climbs the gauge. It used to read the other way round —
  // "the ship stands down" a line above the system that made it
  // (docs/tasks/G88-polish-by-map.md, A4).
  game.log.add(objectiveOnlineLine(spec), game.schedule.time, "good", "log.system.online");
  // Neutralised: the ship stops answering, and the last system is not the
  // loud one — the gauge is off before the +2 would have climbed it.
  if (state.online.length >= OBJECTIVE_COUNT) standDown(game);
  raiseAlert(game, ALERT_PER_SYSTEM);
  // Through the voyage's own till, which is what says the line and keeps the
  // running total in it. The import is the one that goes the other way as well
  // — `systems/voyage.ts` reads `shipState` from here — and it is a call at
  // run time in both directions, never a value read while the modules load.
  credit(game, spec.advance, t("log.system.advance"), "log.system.advance");
  // Last of the three lines, because it is the conclusion of them: this system
  // is up, here is the advance for it, and now the whole hull is worth taking.
  sayNeutralised(game, state);
}

/**
 * The line between the third system and the money.
 *
 * Raising the last one is the biggest thing that happens in a sortie and until
 * now it said exactly what raising the first one said — `TERMINAL ONLINE` —
 * while the hull's whole price was credited later, silently, at the airlock.
 * The owner flew two derelicts and never worked out that the two were connected
 * (docs/owner-queue.md, 4): between the act and the payment there was not one
 * line of the log. So the ship says it outright, with the sum and with what is
 * left to do for it, and it says it on the turn the third system comes up.
 *
 * The price is the hull's own (`content/derelicts.ts`, `salePrice`), read off
 * the voyage. A run with no voyage record — a hand-built fixture, a test ship —
 * still gets the sentence, without the number it cannot know.
 */
function sayNeutralised(game: RoomGame, state: ShipState): void {
  if (state.online.length < OBJECTIVE_COUNT) return;
  const price = derelictAboard(game)?.spec.salePrice ?? 0;
  const line =
    price > 0 ? t("log.system.all.paid", { cr: price }) : t("log.system.all");
  game.log.add(line, game.schedule.time, "good", "log.system.all");
}

/**
 * `act work {system}`: one turn of bringing a system up with the tool it takes.
 * `act force {system}`: one turn of the same with bare hands.
 *
 * Refusals come before anything is spent — no system here, this one is already
 * up, nothing in the rack that would do the job — because a turn spent finding
 * out is a turn the ship gets for free (design-doc.md, "Ход и действия"). The
 * third refusal is `work`'s alone: by hand there is nothing to be missing.
 */
function work(game: RoomGame, target: number | undefined, byHand: boolean): Outcome {
  const system = systemHere(game, target);
  const spec = system ? objectiveSpec(system.kind) : undefined;
  if (!system || !spec) return FAIL(t("why.system.none"));

  const state = shipState(game);
  if (state.online.includes(spec.id)) return FAIL(t("why.system.up", { system: objectiveName(spec) }));

  const job = byHand ? spec.hands : spec.needs(rigOf(game.player), keysHeld(game.player));
  if (!job) return FAIL(needsLine(spec));

  // A job resumes only from a turn of the same job on the same system: the
  // record is dropped by `afterPlayerTurn` the moment anything else happens.
  const resumed = state.work?.id === system.id && state.work.tool === job.tool;
  if (!resumed && job.tool === "key") spendKey(game);

  const hack = systemHack(game, system, spec, job);
  const left = (resumed ? state.work!.left : job.turns) - 1;
  hack.turnsLeft = left;

  const room = game.roomOf(game.player);
  game.makeNoise(room.id, job.noise);
  if (left > 0) {
    // The bare-handed line says its price every turn, because the price is
    // the whole of the difference: the tool's line is plain, this one is not.
    const system = objectiveName(spec);
    game.log.add(
      byHand
        ? t("log.system.work.hands", { system, left })
        : t("log.system.work", { tool: toolName(job.tool), system, left }),
      game.schedule.time,
      byHand ? "warn" : "plain",
      "log.system.work",
    );
    return DONE();
  }

  hack.breach(game);
  return DONE();
}

// The rig asks every source about a target id; ours answers for a system in the
// compartment the drone is standing in, and for nothing else.
registerHackTarget((game, target) => {
  const system = systemHere(game, target);
  const spec = system ? objectiveSpec(system.kind) : undefined;
  if (!system || !spec) return undefined;

  const state = shipState(game);
  const tool = state.work?.id === system.id ? state.work.tool : undefined;
  const job = jobWith(spec, tool) ?? spec.needs(rigOf(game.player), keysHeld(game.player));
  return job ? systemHack(game, system, spec, job) : undefined;
});

/** The row of the table this tool belongs to; the hands are the row under it. */
function jobWith(spec: ObjectiveSpec, tool: ObjectiveJob["tool"] | undefined): ObjectiveJob | undefined {
  if (tool === undefined) return undefined;
  return tool === "hands" ? spec.hands : spec.jobs.find((j) => j.tool === tool);
}

/**
 * The two rules of a sortie nothing on the screen was saying, each said once,
 * on the turn it starts costing something (design-doc.md, "Обучение
 * конструкцией").
 *
 * `objective` goes on the turn the drone first stands in a compartment with one
 * of the three systems in it: that is the first moment the run's own goal is
 * within arm's reach, and the owner walked two hulls' worth of those
 * compartments without learning what they were for (docs/owner-queue.md, 4).
 *
 * `payout` goes on the turn the drone is first carrying credits it can lose.
 * "Nothing is paid until the drone is out through the airlock" is the rule the
 * whole tactical game turns on — it is what makes a full hold a reason to go
 * home — and it was written down nowhere but the help card
 * (docs/owner-queue.md, 5).
 */
function sayTheRules(game: RoomGame): void {
  // One line a turn, and only on a turn nothing else has claimed
  // (`content/hints.ts`, `turnRoom`). Neither of these two is the teaching —
  // they are a nudge beside it — and both questions are asked again every turn
  // the drone stands where they are true, so a turn given up costs the line
  // nothing. On a training run the chain says both of them in the compartment
  // they are about, so neither speaks here at all (`content/hints.ts`,
  // `CHAIN_SAYS`).
  if (turnRoom(game).taken) return;
  if (systemsAboard(game).length > 0 && objectiveHere(game) && hint(game, "objective")) return;
  // The pocket itself and not the voyage's copy of it: `voyageOf` refreshes
  // that copy on read and would write a whole voyage — itinerary, charters, a
  // draw off `game.rng` — on a hull that has none (`systems/voyage.ts`). A
  // question must never be the thing that starts a run.
  const carried = game.player.data?.loot;
  if (derelictAboard(game) && typeof carried === "number" && carried > 0) hint(game, "payout");
}

// ------------------------------------------------------------- what it reads

/**
 * Columns a numbered line may use. Copied from `ui/actions.ts` (`ACTION_WIDTH`)
 * for the reason `systems/jam.ts` copies a colour: a system may not import the
 * screen it is drawn on.
 */
const LIST_WIDTH = 25;

/**
 * `work ENGINE: CUTTER 3` — and `work TERMINAL (2)` where a language runs out
 * of room.
 *
 * Two things have to be on this line and one of them is not negotiable. The
 * turns left are: they are how the whole harness knows the job moved at all
 * (`packages/engine/src/testing/roombots.ts`, `learn` — a line that comes back
 * word for word after being pressed is a verb the careful bot writes off, and
 * writing off `work` is a bot that never neutralises anything). The tool is the
 * other, because which one a system takes is what the numbered list is teaching
 * (design-doc.md, "Обучение конструкцией") — so it is the tool that gives way,
 * and only in the language where the two together will not fit the column.
 *
 * The old line carried the word "turns" as well, and in Russian that made
 * twenty-nine columns of a twenty-five column list: the panel clipped it
 * mid-word and the one line that raises a ship read `поднять ТЕРМИНАЛ (ОТМЫЧК`.
 */
function workLabel(spec: ObjectiveSpec, tool: ObjectiveJob["tool"], left: number): string {
  const system = objectiveName(spec);
  const full = t("action.work", { system, tool: toolName(tool), left });
  return full.length <= LIST_WIDTH ? full : t("action.workBare", { system, left });
}

/**
 * The system standing where the drone is, with the job it would take — whether
 * or not the drone can pay for it. A bare-handed job already running is the
 * job, and it counts down here the way a tooled one does.
 *
 * What the panel's objective block draws (`ui/panel.ts`): a compartment with a
 * system in it says so on the panel even when nothing in the rack will raise
 * it, because the greyed line in the numbered list is the one that sorts last
 * and is counted away first (`ui/actions.ts`, `pressableFirst`) — which is how
 * a player can stand in a reactor and never learn there is anything to do in it
 * (docs/owner-queue.md, 4).
 */
export function objectiveHere(
  game: RoomGame,
): { spec: ObjectiveSpec; job: ObjectiveJob; doable: boolean; left: number } | undefined {
  const state = shipState(game);
  for (const system of roomList<ShipSystem>(game.roomOf(game.player), "systems")) {
    const spec = objectiveSpec(system.kind);
    if (!spec || state.online.includes(spec.id)) continue;
    const doable = spec.needs(rigOf(game.player), keysHeld(game.player));
    const forcing = state.work?.id === system.id && state.work.tool === "hands";
    const job = forcing ? spec.hands : (doable ?? spec.jobs[0]!);
    const started = state.work?.id === system.id && state.work.tool === job.tool;
    return {
      spec,
      job,
      doable: doable !== undefined || forcing,
      left: started ? state.work!.left : job.turns,
    };
  }
  return undefined;
}

// ---------------------------------------------------------------- the system

export const SHIP: System<RoomGame> = {
  name: "ship",

  performCommand(game, actor, cmd): Outcome | undefined {
    if (actor.id !== game.player.id || cmd.kind !== "act") return undefined;
    if (cmd.verb !== "work" && cmd.verb !== "force") return undefined;
    return work(game, cmd.target, cmd.verb === "force");
  },

  /**
   * A splice has to be consecutive: any other command drops it where it stands.
   * The finished job is dropped too, silently — it is kept until here so that
   * the rig, which runs first, still reads the tool it was worked with off the
   * record when it marks what the last turn exposed.
   */
  afterPlayerTurn(game, cmd) {
    sayTheRules(game);
    const state = shipState(game);
    const open = state.work;
    if (!open) return;
    if (open.left <= 0) {
      delete state.work;
      return;
    }
    if (cmd.kind === "act" && (cmd.verb === "work" || cmd.verb === "force") && cmd.target === open.id) return;
    const was = jobNow(game);
    delete state.work;
    if (was !== undefined) sayBrokenOff(game, was.what, was.done, was.of);
  },

  /**
   * A splice does not survive the airlock: a drone that cycles out and back in
   * starts the job again, whichever of the two things a departure turns out to
   * be. Where it leads is `systems/voyage.ts`'s call, made from this same hook
   * one system later.
   */
  beforeLevelLeave(game, _depth, reason) {
    if (reason !== "airlock" || game.status !== "playing") return;
    delete shipState(game).work;
  },

  offerActions(game) {
    const offers: Array<ActionOffer<RoomCommand>> = [];
    if (game.status !== "playing") return offers;

    const state = shipState(game);
    const rig = rigOf(game.player);
    const keys = keysHeld(game.player);

    for (const system of roomList<ShipSystem>(game.roomOf(game.player), "systems")) {
      const spec = objectiveSpec(system.kind);
      if (!spec || state.online.includes(spec.id)) continue;

      const doable = spec.needs(rig, keys);
      // Greyed out, the line still has to name a tool: which one a system takes
      // is what the list is teaching (design-doc.md, "Обучение конструкцией").
      const job = doable ?? spec.jobs[0]!;
      const running = (tool: ObjectiveJob["tool"], turns: number): number =>
        state.work?.id === system.id && state.work.tool === tool ? state.work.left : turns;
      const offer: ActionOffer<RoomCommand> = {
        label: workLabel(spec, job.tool, running(job.tool, job.turns)),
        cmd: { kind: "act", verb: "work", target: system.id },
        enabled: doable !== undefined,
      };
      if (!doable) offer.why = needsLine(spec);
      // The greyed row keeps teaching which tool — until the drone is doing
      // without one: a job by hand is a dozen turns in this compartment, and
      // a row that says "needs a CUTTER" under every one of them is a row of
      // the list's budget spent on a lesson already taken (`tests/panel.test.ts`,
      // the list fits on every turn of 200 voyages).
      const forcing = state.work?.id === system.id && state.work.tool === "hands";
      if (!forcing) offers.push(offer);
      // Under it, the slow way: what it costs to do without is the turns on
      // the row and the noise in the log, every turn of it.
      if (!doable) {
        offers.push({
          label: workLabel(spec, "hands", running("hands", spec.hands.turns)),
          cmd: { kind: "act", verb: "force", target: system.id },
          enabled: true,
        });
      }
    }
    return offers;
  },

  // No `panelLines`. What this system is worth saying on the panel is the run's
  // own goal, and where that goes — under the contacts rule, above the rack,
  // never in the tail of the counters — is a layout decision the panel makes
  // for itself (`ui/panel.ts`, `missionBlock`). It reads the two accessors
  // above instead. The line that used to be here, `SHIP  engine · core · term
  // ·`, was four abbreviations and a row of dots, and the owner read two whole
  // derelicts past it without ever finding out what it meant.
};
