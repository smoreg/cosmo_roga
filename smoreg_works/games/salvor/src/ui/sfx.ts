import type { LogLine } from "@jamrog/engine";
import alertUrl from "../../../../assets/audio/sfx/alert.ogg?url";
import burnUrl from "../../../../assets/audio/sfx/burn.ogg?url";
import deadUrl from "../../../../assets/audio/sfx/dead.ogg?url";
import doorUrl from "../../../../assets/audio/sfx/door.ogg?url";
import emitterUrl from "../../../../assets/audio/sfx/emitter.ogg?url";
import empUrl from "../../../../assets/audio/sfx/emp.ogg?url";
import hitUrl from "../../../../assets/audio/sfx/hit.ogg?url";
import machineUrl from "../../../../assets/audio/sfx/machine.ogg?url";
import pulseUrl from "../../../../assets/audio/sfx/pulse.ogg?url";
import salvageUrl from "../../../../assets/audio/sfx/salvage.ogg?url";
import soldUrl from "../../../../assets/audio/sfx/sold.ogg?url";
import systemUrl from "../../../../assets/audio/sfx/system.ogg?url";
import weldUrl from "../../../../assets/audio/sfx/weld.ogg?url";

/**
 * Sound effects, triggered by reading the log.
 *
 * The log is already the one place that lists everything a turn did, in the
 * words the player is reading anyway — so the alternative, an event bus the sim
 * publishes to, would be a second copy of that list which could drift from the
 * first. It would also mean touching `sim/` and `systems/` to add a sound,
 * which is exactly the coupling the twist and the systems were built to avoid.
 * What it costs is that the table below is tied to wording: a rewritten line is
 * a silent effect, so every entry in it is a test in tests/sfx.test.ts.
 */

export type SfxId =
  | "burn"
  | "hit"
  | "salvage"
  | "pulse"
  | "emp"
  | "weld"
  | "alert"
  | "door"
  | "emitter"
  | "machine"
  | "system"
  | "dead"
  | "sold";

const URLS: Record<SfxId, string> = {
  burn: burnUrl,
  hit: hitUrl,
  salvage: salvageUrl,
  pulse: pulseUrl,
  emp: empUrl,
  weld: weldUrl,
  alert: alertUrl,
  door: doorUrl,
  emitter: emitterUrl,
  machine: machineUrl,
  system: systemUrl,
  dead: deadUrl,
  sold: soldUrl,
};

/**
 * A line's sound, by the event it reports rather than by the words it reports
 * it in.
 *
 * This used to be a table of English substrings walked in a load-bearing order:
 * `burns out` had to be tried before `goes dark`, `hits your` had to keep its
 * case so a blow on the core did not read as a blow on a module. Every one of
 * those rules was a rule about wording, so rewording a line silenced an effect
 * — and translating the game would have silenced all of them at once.
 *
 * `LogLine.key` is what a line *is* (`packages/engine/src/sim/log.ts`), so the
 * table is a lookup now: one key, one sound, no order and no ambiguity. Lines
 * with no key make no sound, and most lines have none — which is the point: a
 * sound on every line is a sound on no line.
 */
const SOUNDS: Readonly<Record<string, SfxId>> = {
  "log.module.burn": "burn",
  "log.hit.module": "hit",
  "log.hit.vent": "hit",
  "log.hit.mine": "hit",
  "log.system.online": "system",

  // Losing the drone, and losing the ship with it. The run's own last line is
  // written by the engine (`RoomGame.finish`) and carries no key, so what
  // sounds here is the sortie ending rather than the run.
  "log.drone.lost": "dead",
  "log.rival.jumped": "dead",
  "log.hull.tow": "sold",

  // Everything that arrives to take the ship off you sounds the same way: the
  // ship waking something up, a rival docking, a ghost of a previous sortie
  // moving about, and the twenty-turn clock a lost claim starts.
  "log.alert.hunter": "alert",
  "log.alert.busy": "alert",
  "log.rival.aboard": "alert",
  "log.rival.lost": "alert",
  "log.ghost.sighted": "alert",

  "log.emp": "emp",
  "log.shock": "emp",

  "log.salvage.install": "salvage",
  "log.salvage.graft": "salvage",
  "log.salvage.mend": "salvage",
  "log.bloom.strip": "salvage",

  "log.pulse": "pulse",

  "log.weld": "weld",
  "log.virus.purge.on": "weld",
  "log.door.weld.on": "weld",
  "log.door.weld.done": "weld",
  "log.door.cut.on": "weld",

  "log.door.key": "door",
  "log.door.power": "door",
  "log.door.cut.done": "door",
  "log.spike.done": "door",

  "log.emitter.hit": "emitter",

  // A machine coming apart, whoever wrote the line: `engine.dies` is the melee
  // kill the engine resolves and `log.machine.dies` the one the EMITTER does,
  // and they are the same event to the ear.
  "engine.dies": "machine",
  "log.machine.dies": "machine",
  "log.scrap.drop": "machine",
  "log.bloom.dies": "machine",

  // The engine's own half of a fight and of a bulkhead. It used to write these
  // unkeyed, so a blow that missed every module and a door opening under the
  // drone's hand were the two silent events in the game.
  "engine.hit.you": "hit",
  "engine.hit.taken": "hit",
  "engine.hit.other": "hit",
  "engine.door.open": "door",
  "engine.door.breached": "door",
  "engine.door.cut.you": "weld",
  "engine.door.cut.other": "weld",
};

/** Never more than this in one turn: past three it is noise, not information. */
const MAX_PER_TURN = 3;

/**
 * What a turn's worth of new log lines should sound like.
 *
 * Each id appears at most once however many lines earned it — two modules
 * burning in one blow is one crack, not two on top of each other — and the
 * order is the order the lines came in, so the loudest thing is usually first.
 */
export function sfxFor(lines: readonly LogLine[]): SfxId[] {
  const played: SfxId[] = [];
  for (const line of lines) {
    const id = sfxForKey(line.key);
    if (id === undefined || played.includes(id)) continue;
    played.push(id);
    if (played.length === MAX_PER_TURN) break;
  }
  return played;
}

/** The sound one event makes, or nothing at all. Exported for the sfx test. */
export function sfxForKey(key: string | undefined): SfxId | undefined {
  return key === undefined ? undefined : SOUNDS[key];
}

/**
 * The lines added since `heard` of them had been counted.
 *
 * `MessageLog` drops its oldest line once it is full and folds a line repeated
 * within one turn into a counter, so the count can go down as well as up and
 * "everything after index N" is not always N new lines. Clamping is the whole
 * function: a caller that falls behind gets the tail rather than an exception,
 * and a caller that gets ahead gets nothing rather than a replay.
 */
export function linesSince(lines: readonly LogLine[], heard: number): readonly LogLine[] {
  return lines.slice(Math.min(Math.max(heard, 0), lines.length));
}

/**
 * One-shots, over whatever the music is doing.
 *
 * Each effect gets one `Audio` element, reused: a new one per press would leak
 * an element per turn, and a game whose player presses a key a second for an
 * hour would end the run with three thousand of them. Reuse means a sound
 * retriggers rather than layering with itself, which is also what a turn-based
 * game wants — one crack per turn, not a chord of them.
 */
export class SalvorSfx {
  private readonly voices = new Map<SfxId, HTMLAudioElement>();
  private readonly enabled: boolean;

  constructor(enabled: boolean, volume = 0.7) {
    this.enabled = enabled && typeof Audio !== "undefined";
    if (!this.enabled) return;
    for (const [id, url] of Object.entries(URLS) as Array<[SfxId, string]>) {
      try {
        const el = new Audio(url);
        el.preload = "auto";
        el.volume = volume;
        this.voices.set(id, el);
      } catch {
        // An effect that cannot be constructed is simply silent.
      }
    }
  }

  play(ids: readonly SfxId[]): void {
    if (!this.enabled) return;
    for (const id of ids) {
      const el = this.voices.get(id);
      if (!el) continue;
      try {
        el.currentTime = 0;
        void el.play().catch(() => undefined);
      } catch {
        // Autoplay refused, or the file never loaded. The turn still happened.
      }
    }
  }
}
