import { RoomGame, type RoomContentPack, type RoomGameConfig } from "@jamrog/engine";
import { t } from "./i18n.js";
import { MAX_MACHINES, kindsForDepth, monsterChance } from "./content/monsters.js";
import { startTraining } from "./content/hints.js";
import { makePlayer } from "./content/player.js";
import { markTraining } from "./content/tutorial.js";
import { TUG_ID, tugShip } from "./content/tug.js";
import { ALERT } from "./systems/alert.js";
import { BLOOM } from "./systems/bloom.js";
import { CODEX_SYSTEM } from "./systems/codex.js";
import { CONTACTS } from "./systems/contacts.js";
import { DOORS } from "./systems/doors.js";
import { GHOST } from "./systems/ghost.js";
import { HAZARD } from "./systems/hazards.js";
import { JAM } from "./systems/jam.js";
import { POPULATE } from "./systems/populate.js";
import { RIVAL } from "./systems/rival.js";
import { SHIP } from "./systems/ship.js";
import { TUG } from "./systems/tug.js";
import { TUTORIAL } from "./systems/tutorial.js";
import { VIRUS } from "./systems/virus.js";
import { VOYAGE, voyageMetrics, voyageProgress } from "./systems/voyage.js";
import { RIG } from "./twist/rig.js";

/**
 * What a SALVOR run is made of, in one place.
 *
 * The UI and every test build games through here: a run created without the
 * twist is a different game, and two of those in one repo means replays and
 * balance numbers that quietly disagree.
 */
export const SALVOR: RoomContentPack = {
  name: "SALVOR",
  maxMonsters: MAX_MACHINES,
  makePlayer,
  monstersForDepth: kindsForDepth,
  monsterChance,
  // Read by the engine the moment a run is built and the moment it ends, so
  // they are looked up then rather than at import time: a language chosen from
  // the URL is already set by the time the first of them is asked for.
  get openingLine(): string {
    return t("log.opening");
  },
  get winLine(): string {
    return t("log.win");
  },
  get deathLine(): string {
    return t("log.death");
  },
};

/**
 * The same game, with the drone marked as a training run's before anything can
 * ask (`content/tutorial.ts`).
 *
 * The flag has to be on the player entity by the time `VOYAGE.onRunStart`
 * draws the itinerary, and that happens inside the `RoomGame` constructor —
 * earlier than any line `newGame` could write after it. `makePlayer` is the one
 * hook the content pack gives that runs early enough, so training is a content
 * pack and not an argument.
 *
 * Built on `SALVOR` as a prototype rather than spread from it, and that is not
 * style: three of its fields are getters that look up the current language when
 * they are asked, and a spread would call all three here — freezing the win and
 * death lines to whatever language was on the moment a run was created, which
 * is a bug `L` would find on the first press.
 */
const TRAINING: RoomContentPack = Object.assign(Object.create(SALVOR) as RoomContentPack, {
  makePlayer: () => markTraining(makePlayer()),
});

export const GAME_CONFIG: Omit<RoomGameConfig, "seed"> = {
  content: SALVOR,
  twist: RIG,
  // Independent mechanics add themselves here, in the order they must run.
  // TUG comes early because it answers first: a station verb pressed in the
  // wrong compartment has to be refused before the voyage charges for it.
  // ALERT runs after the twist so it hears the noise field the BAFFLE muffled,
  // and after POPULATE so between-sortie reinforcements see a populated ship.
  // JAM and BLOOM sit in the middle: neither reads the noise field or the
  // gauge, and both are read by what came before them — the rig asks JAM
  // whether a module answers at all. SHIP counts the systems the drone brought
  // up, and VOYAGE is last because it claims the outcome: what a departure is
  // worth depends on the count SHIP has just finished making, and on the alert
  // and the rack as everything before it left them.
  //
  // GHOST comes after both POPULATE and ALERT: a sortie's dead are answered on
  // a ship that has already been filled and already sent whatever the gauge
  // owed, so the ghost is counted among what is aboard rather than under it.
  //
  // VIRUS goes first of all of them, which means straight after the twist: a
  // twitch overrules what the command exposed, so the rig has to have marked
  // that already — and the alert has to hear the twitch on the turn it happens.
  //
  // RIVAL is after POPULATE, whose first entry is what puts the ship's systems
  // in their compartments — the competitor races for those — and before SHIP,
  // which counts what the drone raised of what is left.
  //
  // CONTACTS is last of all and reads no state but the drone's compartment: the
  // line it writes is "what is standing in here", and it has to be asked after
  // whatever the turn did to where "here" is — VOYAGE can move the drone to a
  // whole other hull from its own `afterPlayerTurn`.
  //
  // TUTORIAL is last of all, after CONTACTS, and only ever says anything in a
  // training run: its lines are about the turn as it finally stands, including
  // the crossing VOYAGE has just made and the hull it has just sold.
  //
  // HAZARD sits after POPULATE, which is what lays the hazards on a hull on
  // its first boarding, and after DOORS, whose welder lifts a mine; it is
  // before ALERT because a mine going off raises the gauge, and the gauge
  // should hear it on the turn it happens.
  //
  // CODEX_SYSTEM is after even that, and it is the one entry here whose order
  // cannot matter to anybody: it writes down what the run has shown the player
  // and changes nothing at all, so it wants the turn as everything else has
  // finally left it and nothing wants it (`systems/codex.ts`, G72).
  systems: [
    VIRUS, POPULATE, TUG, DOORS, HAZARD, ALERT, GHOST, JAM, BLOOM, RIVAL, SHIP, VOYAGE, CONTACTS, TUTORIAL,
    CODEX_SYSTEM,
  ],
  // A run starts at home, on the four compartments of the tug, with a drone on
  // the rails and 25 CR. The first derelict is generated the first time
  // something undocks into it (`systems/voyage.ts`), which is what lets the
  // hull be drawn against the flags and the rack the sortie actually carries.
  firstShip: tugShip,
  firstShipId: TUG_ID,
};

/** A run, and how the balance harness reads one (`Playable`, E14). */
export type SalvorGame = RoomGame & {
  progress(): number;
  metrics(): Record<string, number>;
};

/**
 * One run of SALVOR.
 *
 * The two harness answers are bolted on here rather than implemented by
 * `RoomGame`, and that is the boundary working as intended: the engine has no
 * idea what a credit, a hull or a derelict is, and `Playable.progress` and
 * `Playable.metrics` are optional exactly so a game can answer for itself.
 *
 * `progress` matters more than it looks. A voyage is played over several ships
 * and ends standing on the tug, so "compartments explored on the ship I am
 * currently aboard" — the harness's own default — scores every finished run at
 * the one room the drone was sold in. Every run the UI, the bots and the tests
 * play comes through this function, so nobody measures that by accident.
 */
export function newGame(seed: number, training = false): SalvorGame {
  const game = new RoomGame({ ...GAME_CONFIG, content: training ? TRAINING : SALVOR, seed });
  if (training) startTraining(game);
  return Object.assign(game, {
    progress: () => voyageProgress(game),
    metrics: () => voyageMetrics(game),
  });
}

/**
 * The hand-drawn freighter the game ran on before the generator did — twelve
 * compartments, one locked door with its key aboard, one sealed loop, and depth
 * enough for four bands of machines.
 *
 * No longer what a run starts on: `firstShip` builds a real freighter now. It
 * stays because a test about the rack or about a bulkhead wants a graph it can
 * read off the page rather than a lucky seed, and this is that graph.
 *
 *   r1 docking ── r2 cargo ── r5 hab ── r8 engineering ── r11 reactor
 *      └ r3 corridor ── r6 maintenance ── r9 lab ── r12 control
 */
export const KESTREL = `
  TUG -a1- r1
  r1 -d1- r2
  r1 -(d2)- r3
  r2 -[d3:k1]- r4
  r2 -d4- r5
  r3 -d5- r6
  r5 -(d6)- r7
  r5 -d7- r8
  r6 -#d8#- r9
  r7 -d9- r10
  r8 -(d10)- r11
  r9 -d11- r12
  r10 -d12- r11
  r1: docking
  r2: cargo cover
  r3: corridor
  r4: storage cover
  r5: hab
  r6: maintenance
  r7: mess cover
  r8: engineering
  r9: lab
  r10: workshop cover
  r11: reactor
  r12: control
`;
