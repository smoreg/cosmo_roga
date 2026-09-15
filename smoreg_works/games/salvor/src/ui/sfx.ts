import type { LogLine } from "@jamrog/engine";
import alertUrl from "../../../../assets/audio/sfx/alert.ogg?url";
import burnUrl from "../../../../assets/audio/sfx/burn.ogg?url";
import deadUrl from "../../../../assets/audio/sfx/dead.ogg?url";
import doorUrl from "../../../../assets/audio/sfx/door.ogg?url";
import emitterUrl from "../../../../assets/audio/sfx/emitter.ogg?url";
import empUrl from "../../../../assets/audio/sfx/emp.ogg?url";
import explodeUrl from "../../../../assets/audio/sfx/explode.ogg?url";
import fuseUrl from "../../../../assets/audio/sfx/fuse.ogg?url";
import purgeUrl from "../../../../assets/audio/sfx/purge.ogg?url";
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
  | "sold"
  | "explode"
  | "fuse"
  | "purge";

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
  explode: explodeUrl,
  fuse: fuseUrl,
  purge: purgeUrl,
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
  "log.virus.burned": "burn",
  "log.virus.rot.burned": "burn",
  "log.hit.module": "hit",
  "log.alert.blast.you": "explode",
  "log.hit.mine": "hit",
  "log.virus.core": "hit",

  // The run turning upward: a system raised, however it was raised, and the
  // ship standing down because of it.
  "log.system.online": "system",
  "log.system.all": "system",
  "log.alert.down": "system",
  "log.upload.done": "system",
  "log.rival.raises": "system",

  // Losing the drone, and losing the ship with it. The run's own last line is
  // written by the engine (`RoomGame.finish`) and carries no key, so what
  // sounds here is the sortie ending rather than the run.
  "log.drone.lost": "dead",
  "log.rival.jumped": "dead",

  // Money arriving: the hull under tow, and everything else the account is
  // paid through (`credit()` in systems/voyage.ts) — a hold carried home
  // through the airlock above all, which was the silent half of the loop.
  "log.hull.tow": "sold",
  "log.credit": "sold",
  "log.carry.home": "sold",
  "log.rival.deal.sold": "sold",

  // Everything that arrives to take the ship off you sounds the same way: the
  // ship waking something up, a rival docking, a ghost of a previous sortie
  // moving about, and the twenty-turn clock a lost claim starts. The gauge
  // climbing a rung is the same klaxon — it is the ship noticing you, and it
  // was the most frequent important line of a run that made no sound for it
  // (docs/tasks/G89-festival.md, D1).
  "log.alert.hunter": "alert",
  "log.alert.busy": "alert",
  "log.alert.up": "alert",
  "log.alert.wake": "alert",
  "log.alert.detonation": "alert",
  "log.bloom.hatch": "alert",
  "log.rival.aboard": "alert",
  "log.rival.lost": "alert",
  "log.ghost.sighted": "alert",

  // Pressure going somewhere it should not: the EMP's own thump and rush of
  // static, a compartment vented, a mine going off, a virus getting in, the
  // tug's burn for the next hull.
  "log.emp": "emp",
  "log.shock": "emp",
  // A charge set and a fuse ticking are one sound; a compartment going up
  // and the ship going up are the other (docs/tasks/G90-smoreg-wave.md, A5).
  "log.alert.charge": "fuse",
  "log.alert.fuse": "fuse",
  "log.alert.blast": "explode",
  "log.alert.boom": "explode",
  "log.hazard.mine.hit": "emp",
  "log.hazard.mine.machine": "emp",
  "log.virus.caught": "emp",
  "log.virus.rot": "emp",
  "log.jump": "emp",

  // Every way a part changes hands: off a wreck, out of a crate or a body, into
  // the hold, onto the rails, off the rack at the dock.
  "log.salvage.install": "salvage",
  "log.salvage.graft": "salvage",
  "log.salvage.mend": "salvage",
  "log.bloom.strip": "salvage",
  "log.crate.open": "salvage",
  "log.body.search": "salvage",
  "log.carry.take": "salvage",
  "log.cargo.take": "salvage",
  "log.relic.take": "salvage",
  "log.swap.carried": "salvage",
  "log.swap.dropped": "salvage",
  "log.hold.fit": "salvage",
  "log.hold.fitted": "salvage",
  "log.hold.stow": "salvage",
  "log.bench.graft": "salvage",
  "log.stock.buy": "salvage",
  "log.hull.bought": "salvage",

  // The sensor ping: the pulse itself, and a danger the drone's sensors have
  // just put a name to — the smoke, the ice and the mine a door away.
  "log.pulse": "pulse",
  "log.hazard.tell.smoke": "pulse",
  "log.hazard.tell.frost": "pulse",
  "log.hazard.tell.mine": "pulse",
  "log.upload.on": "pulse",

  "log.weld": "weld",
  "log.virus.purge.on": "purge",
  "log.virus.purge.done": "purge",
  "log.door.weld.on": "weld",
  "log.door.weld.done": "weld",
  "log.door.cut.on": "weld",
  "log.door.ram.on": "weld",
  "log.system.work": "weld",
  "log.spike.on": "weld",
  "log.bench.repair": "weld",
  "log.bench.clean": "weld",

  // A bulkhead moving, whoever moved it: the drone's hand, the ship shutting it
  // behind you, the airlock cycling, the tug's clamps letting go.
  "log.door.key": "door",
  "log.door.power": "door",
  "log.door.cut.done": "door",
  "log.door.ram.done": "door",
  "log.door.close": "door",
  "log.spike.done": "door",
  "log.alert.door": "door",
  "log.alert.lock": "door",
  "log.voyage.home": "door",
  "log.voyage.undock": "door",

  "log.emitter.hit": "emitter",

  // A machine coming apart, whoever wrote the line: `engine.dies` is the melee
  // kill the engine resolves and `log.machine.dies` the one the EMITTER does,
  // and they are the same event to the ear.
  "engine.dies": "machine",
  "log.machine.dies": "machine",
  "log.scrap.drop": "machine",
  "log.bloom.dies": "machine",
  "log.ghost.drop": "machine",

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
export const MAX_PER_TURN = 3;

/**
 * Which sound survives a crowded turn, most important first.
 *
 * The cap used to keep the first three lines in log order, and a turn is
 * written in the order the systems ran rather than the order that matters: the
 * drone's death came after the blow, the burn and the machine that dealt it, so
 * the death stinger was the one dropped — 56 of 1 580 lost drones over 200 seeds
 * of bots. The stingers come first now (the run turning), then what happened to
 * the drone, then what the drone did.
 */
export const SFX_RANK: readonly SfxId[] = [
  "dead",
  "sold",
  "explode",
  "alert",
  "system",
  "burn",
  "hit",
  "emp",
  "machine",
  "emitter",
  "door",
  "weld",
  "salvage",
  "pulse",
  "fuse",
  "purge",
];

/**
 * What a turn's worth of new log lines should sound like.
 *
 * Each id appears at most once however many lines earned it — two modules
 * burning in one blow is one crack, not two on top of each other. Past the cap
 * the most important are kept (`SFX_RANK`), and those play in the order their
 * lines came in.
 */
export function sfxFor(lines: readonly LogLine[]): SfxId[] {
  const heard: SfxId[] = [];
  for (const line of lines) {
    const id = sfxForKey(line.key);
    if (id !== undefined && !heard.includes(id)) heard.push(id);
  }
  if (heard.length <= MAX_PER_TURN) return heard;
  const rank = (id: SfxId) => SFX_RANK.indexOf(id);
  const kept = new Set([...heard].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_PER_TURN));
  return heard.filter((id) => kept.has(id));
}

/** The sound one event makes, or nothing at all. Exported for the sfx test. */
export function sfxForKey(key: string | undefined): SfxId | undefined {
  return key === undefined ? undefined : SOUNDS[key];
}

/**
 * The lines added after `last`, the newest line already turned into sound.
 *
 * By the line itself and not by a count. `MessageLog` keeps 200 lines and drops
 * the oldest past that, so once a run had written 200 the count read 200 on
 * every turn and "everything after index 200" was nothing: the game went silent
 * for good partway into every voyage, and a new run started behind the old
 * run's count was silent until it caught up. A line stays the same object for
 * as long as the log holds it — a repeat folds into its counter rather than
 * replacing it — so finding it again is exact.
 *
 * A line the log no longer holds, or never held (another run's), gives nothing
 * rather than a replay of the whole log; the shell moves `last` on when it
 * swaps the run. Nothing heard yet means everything is new.
 */
export function linesAfter(lines: readonly LogLine[], last: LogLine | undefined): readonly LogLine[] {
  if (last === undefined) return lines;
  const at = lines.lastIndexOf(last);
  return at < 0 ? [] : lines.slice(at + 1);
}

/** How loud an effect plays, 0..1. The interface blips sit under it (`ui/uisound.ts`). */
export const SFX_VOLUME = 0.7;

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
  private readonly volume: number;
  private enabled: boolean;

  constructor(enabled: boolean, volume = SFX_VOLUME) {
    this.volume = volume;
    this.enabled = enabled && typeof Audio !== "undefined";
    if (this.enabled) this.load();
  }

  /**
   * Sound on or off, from the start screen's own row (`S`, G84).
   *
   * The voices are built on the first enable rather than in the constructor,
   * because a session that opened with `?sound=off` should not have fetched
   * thirteen files to keep them silent — and one that turns the sound on later
   * still has to get them.
   */
  setEnabled(on: boolean): void {
    this.enabled = on && typeof Audio !== "undefined";
    if (this.enabled && this.voices.size === 0) this.load();
  }

  private load(): void {
    for (const [id, url] of Object.entries(URLS) as Array<[SfxId, string]>) {
      try {
        const el = new Audio(url);
        el.preload = "auto";
        el.volume = this.volume;
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
