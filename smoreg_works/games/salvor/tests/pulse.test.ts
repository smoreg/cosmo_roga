import { describe, it, expect } from "vitest";
import { RoomGame, spawnMonsterIn, type MonsterKind } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { MONSTERS } from "../src/content/monsters.js";
import { BEAT_MS } from "../src/ui/music.js";
import {
  NO_PULSE,
  PULSE_BEATS,
  litNow,
  machinesInSight,
  nextPulseFrame,
  trackPulse,
  type PulseClock,
  type Sighted,
} from "../src/ui/pulse.js";
import { panelBlocks, panelColour } from "../src/ui/panel.js";
import { schematicInputOf } from "../src/ui/schematic-input.js";
import { THEME } from "../src/ui/theme.js";

/**
 * The one visual effect in the game, as arithmetic.
 *
 * Two halves, and they are tested apart because they are separate: *when* a
 * machine counts as having appeared is a difference between two frames of the
 * game, and *when* the screen is red for it is a difference between two
 * instants of the track. Neither needs a browser, an ear or a clock — `now`
 * arrives as a number here exactly as it does in `app.ts`.
 */

/** `r2` is through an open door, `r3` is through a closed one. */
const SHIP = `
  TUG -a1- r1
  r1 -d1- r2
  r1 -(d2)- r3
  r1: docking
  r2: hold
  r3: hab
`;

function gameOn(): RoomGame {
  return new RoomGame({
    ...GAME_CONFIG,
    seed: 11,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(SHIP).ship,
    firstShipId: "1",
    systems: [],
  });
}

function machine(id: string): MonsterKind {
  const kind = MONSTERS.find((m) => m.id === id);
  if (!kind) throw new Error(`no machine '${id}' in the bestiary`);
  return kind;
}

const SCOUT = machine("scout");

function put(game: RoomGame, room: string): number {
  const spawned = spawnMonsterIn(SCOUT, game.ship.room(room).id);
  game.schedule.admit(spawned);
  game.entities.push(spawned);
  game.refreshSight();
  return spawned.id;
}

/** The music is playing and the next beat is `untilBeat` milliseconds off. */
const playing = (untilBeat: number): PulseClock => ({ beatMs: BEAT_MS, untilBeat, steady: false });

/** `?sound=off`, or a browser that refused to start: no clock to read. */
const silent: PulseClock = { beatMs: BEAT_MS, untilBeat: undefined, steady: false };

/** `prefers-reduced-motion: reduce`. */
const reduced: PulseClock = { beatMs: BEAT_MS, untilBeat: undefined, steady: true };

/** A frame with these machines in sight, starting from a seeded screen. */
function frames(seen: Sighted[][], now = 1000, clock: PulseClock = playing(0)) {
  let pulse = NO_PULSE;
  for (const machines of seen) pulse = trackPulse(pulse, machines, now, clock);
  return pulse;
}

const one: Sighted = { id: 7, room: 2 };
const two: Sighted = { id: 8, room: 3 };

describe("what counts as a machine appearing", () => {
  it("says nothing about the first frame it ever draws", () => {
    const pulse = trackPulse(NO_PULSE, [one], 1000, playing(0));
    expect(pulse.ids.size, "a run opening on a machine has not had one appear").toBe(0);
    expect(pulse.seen).toEqual(new Set([7]));
  });

  it("flashes a machine that was not in sight on the frame before", () => {
    const pulse = frames([[], [one]]);
    expect([...pulse.ids]).toEqual([7]);
    expect([...pulse.rooms]).toEqual([2]);
  });

  it("says nothing about a machine that has been standing there all along", () => {
    const pulse = frames([[one], [one], [one]], 1000);
    expect(pulse.ids.size).toBe(0);
  });

  it("says nothing when a machine goes out of sight", () => {
    const pulse = frames([[one, two], [one]]);
    expect(pulse.ids.size).toBe(0);
  });

  /**
   * A card opened and closed on the turn a machine walked in is still that one
   * turn's flash: the redraw it causes finds the same machines in sight, so
   * nothing restarts and the pulse runs out its two beats where it began.
   */
  it("does not restart on a redraw the game made for its own reasons", () => {
    const start = trackPulse(trackPulse(NO_PULSE, [], 1000, playing(0)), [one], 1000, playing(0));
    const redrawn = trackPulse(start, [one], 1200, playing(400));
    expect(redrawn.from).toBe(start.from);
    expect(redrawn.to).toBe(start.to);
  });

  /** Two machines through the same door on the same turn are one event. */
  it("takes a second machine into the flash already running", () => {
    const start = trackPulse(trackPulse(NO_PULSE, [], 1000, playing(0)), [one], 1000, playing(0));
    const both = trackPulse(start, [one, two], 1100, playing(300));
    expect([...both.ids].sort()).toEqual([7, 8]);
    expect([...both.rooms].sort()).toEqual([2, 3]);
    expect(both.to).toBe(start.to);
  });
});

describe("when the flash lands", () => {
  it("waits for the track's next beat rather than starting mid-beat", () => {
    const pulse = frames([[], [one]], 1000, playing(200));
    expect(pulse.from).toBe(1200);
    expect(pulse.to).toBe(1200 + PULSE_BEATS * BEAT_MS);
    expect(litNow(pulse, 1100).ids.size, "nothing before the beat").toBe(0);
    expect(litNow(pulse, 1200).ids.size).toBe(1);
  });

  it("blinks on the beat and off the off-beat", () => {
    const pulse = frames([[], [one]], 0, playing(0));
    expect(litNow(pulse, 0).ids.size, "on the downbeat").toBe(1);
    expect(litNow(pulse, BEAT_MS * 0.6).ids.size, "off the off-beat").toBe(0);
    expect(litNow(pulse, BEAT_MS * 1.1).ids.size, "on the second beat").toBe(1);
    expect(litNow(pulse, BEAT_MS * 1.6).ids.size).toBe(0);
  });

  it("is over after its two beats and never comes back on its own", () => {
    const pulse = frames([[], [one]], 0, playing(0));
    expect(litNow(pulse, PULSE_BEATS * BEAT_MS).ids.size).toBe(0);
    expect(litNow(pulse, PULSE_BEATS * BEAT_MS * 4).ids.size).toBe(0);
    expect(nextPulseFrame(pulse, PULSE_BEATS * BEAT_MS)).toBeUndefined();
  });

  it("asks for a redraw at every half-beat of the flash and none after it", () => {
    const pulse = frames([[], [one]], 0, playing(0));
    const half = BEAT_MS / 2;
    expect(nextPulseFrame(pulse, 0)).toBeCloseTo(half, 6);
    expect(nextPulseFrame(pulse, half * 1.5)).toBeCloseTo(half * 2, 6);
    expect(nextPulseFrame(pulse, half * 3.5)).toBeCloseTo(pulse.to, 6);
  });

  /**
   * `?sound=off` is a supported way to play the game, so the effect may not
   * depend on there being a track to read. With no clock the flash simply
   * starts now and runs the same two beats of the grid.
   */
  it("flashes for the same two beats with the sound switched off", () => {
    const pulse = frames([[], [one]], 5000, silent);
    expect(pulse.from).toBe(5000);
    expect(pulse.to).toBe(5000 + PULSE_BEATS * BEAT_MS);
    expect(litNow(pulse, 5000).ids.size).toBe(1);
  });
});

describe("a browser that has asked for less motion", () => {
  it("colours the compartment without blinking it", () => {
    const pulse = frames([[], [one]], 1000, reduced);
    expect(pulse.blink).toBe(false);
    expect(litNow(pulse, 1000).ids.size).toBe(1);
    expect(litNow(pulse, 1000 + BEAT_MS * 0.6).ids.size, "no off phase").toBe(1);
  });

  it("schedules no frame of its own, so nothing on the screen moves", () => {
    const pulse = frames([[], [one]], 1000, reduced);
    expect(nextPulseFrame(pulse, 1000)).toBeUndefined();
    expect(nextPulseFrame(pulse, 1400)).toBeUndefined();
  });

  it("starts at once rather than waiting for a beat it will not redraw on", () => {
    const pulse = frames([[], [one]], 1000, { ...reduced, untilBeat: 300 });
    expect(pulse.from).toBe(1000);
  });
});

describe("what the two views paint it with", () => {
  it("reads the machines in sight off the game the panel lists them from", () => {
    const game = gameOn();
    expect(machinesInSight(game)).toEqual([]);

    const id = put(game, "r2");
    expect(machinesInSight(game)).toEqual([{ id, room: game.ship.room("r2").id }]);
  });

  it("does not see a machine behind a closed bulkhead", () => {
    const game = gameOn();
    put(game, "r3");
    expect(machinesInSight(game)).toEqual([]);
  });

  it("marks the flashing compartment on the schematic input both views draw", () => {
    const game = gameOn();
    put(game, "r2");
    const hold = game.ship.room("r2").id;

    const quiet = schematicInputOf(game).rooms.find((r) => r.id === hold);
    expect(quiet?.alarm, "no flash between pulses").toBeUndefined();

    const flashing = schematicInputOf(game, new Set([hold])).rooms.find((r) => r.id === hold);
    expect(flashing?.alarm).toBe(true);
    // Colour and nothing else: the box may not move, resize or gain a mark.
    expect({ ...flashing, alarm: undefined }).toEqual({ ...quiet, alarm: undefined });
  });

  /**
   * A contact's own colour is how much of it is left (G79, `contactTone`), and
   * turning that line red is the whole of what the panel does for the pulse.
   * The flashing box on the schematic is what carries the signal for a machine
   * already standing in the drone's compartment.
   */
  it("turns the line of a machine a door away red while it flashes", () => {
    const game = gameOn();
    const id = put(game, "r2");
    const line = panelBlocks(game, []).find((l) => l.id === id);
    expect(line, "the machine has a line of its own to flash").toBeDefined();
    // Whole, so its own colour is the top of the integrity scale (G79,
    // `contactTone`); the pulse is what puts red on it.
    expect(panelColour(line!, new Set())).toBe(THEME.hpFull);
    expect(panelColour(line!, new Set(), new Set([id]))).toBe(THEME.bad);
  });

  it("leaves every other line of the panel alone", () => {
    const game = gameOn();
    const id = put(game, "r2");
    const lines = panelBlocks(game, []);
    for (const line of lines.filter((l) => l.id !== id)) {
      expect(panelColour(line, new Set(), new Set([id])), line.text).toBe(panelColour(line, new Set()));
    }
  });
});
