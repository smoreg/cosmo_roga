import { describe, it, expect } from "vitest";

import { initialState, type AppEffect, type AppState } from "../src/ui/appstate.js";

import { SFX_VOLUME } from "../src/ui/sfx.js";
import { BLIPS, REPEAT_GAP_MS, UI_MAX_GAIN, UiSound, blipFor, type BlipContext, type BlipId, type Press } from "../src/ui/uisound.js";

/**
 * The interface's blips (docs/tasks/G89-festival.md, D2): the table of what each
 * one is, the rule of which press earns which, and a player that stays silent
 * whenever it should — sound off, no WebAudio, before the first press.
 */

const IDS = Object.keys(BLIPS) as BlipId[];

describe("the table of blips", () => {
  it("is short, soft and under every effect", () => {
    expect(UI_MAX_GAIN).toBeLessThan(SFX_VOLUME);
    for (const id of IDS) {
      const b = BLIPS[id];
      expect(b.ms, id).toBeGreaterThan(0);
      expect(b.ms, id).toBeLessThanOrEqual(150);
      expect(b.attackMs, id).toBeGreaterThan(0);
      expect(b.attackMs, id).toBeLessThan(b.ms / 2);
      expect(b.gain, id).toBeGreaterThan(0);
      expect(b.gain, id).toBeLessThanOrEqual(UI_MAX_GAIN);
      for (const hz of [b.from, b.to]) {
        expect(hz, id).toBeGreaterThanOrEqual(100);
        expect(hz, id).toBeLessThanOrEqual(4000);
      }
    }
  });

  it("says yes going up, back going down, and no low", () => {
    expect(BLIPS.accept.to).toBeGreaterThan(BLIPS.accept.from);
    expect(BLIPS.open.to).toBeGreaterThan(BLIPS.open.from);
    expect(BLIPS.back.to).toBeLessThan(BLIPS.back.from);
    expect(BLIPS.close.to).toBeLessThan(BLIPS.close.from);
    expect(BLIPS.refuse.to).toBeLessThanOrEqual(BLIPS.refuse.from);
    for (const id of IDS.filter((i) => i !== "refuse")) {
      expect(BLIPS.refuse.from, id).toBeLessThan(Math.min(BLIPS[id].from, BLIPS[id].to));
    }
  });

  it("makes the highlight moving the quietest and shortest thing there is", () => {
    for (const id of IDS.filter((i) => i !== "tick")) {
      expect(BLIPS.tick.gain, id).toBeLessThanOrEqual(BLIPS[id].gain);
      expect(BLIPS.tick.ms, id).toBeLessThan(BLIPS[id].ms);
    }
  });
});

// ---------------------------------------------------------------- the rule

const IDLE: AppEffect = { kind: "idle" };
const RUN: AppState = { ...initialState(), overlay: "none" };

function press(before: AppState, after: Partial<AppState>, extra: Partial<Press> = {}): BlipId | undefined {
  const next = { ...before, ...after };
  return blipFor({ before, after: next, effect: next.effect ?? IDLE, turn: "none", sounded: false, ...extra });
}

describe("which press earns which blip", () => {
  it("ticks when the highlight moves, and nothing when nothing changed", () => {
    expect(press(RUN, { cursor: 1 })).toBe("tick");
    expect(press(RUN, {})).toBeUndefined();
  });

  it("buzzes on a refusal, whatever else the press did", () => {
    expect(press(RUN, { effect: { kind: "log", text: "…" } })).toBe("refuse");
    expect(press(RUN, { cursor: 2, effect: { kind: "log", text: "…" } })).toBe("refuse");
    expect(press(RUN, { effect: { kind: "command", cmd: { kind: "wait" } } }, { turn: "refused" })).toBe("refuse");
  });

  it("adds nothing to a turn the game already answered, and steps a turn it did not", () => {
    const cmd: AppEffect = { kind: "command", cmd: { kind: "wait" } };
    expect(press(RUN, { effect: cmd }, { turn: "spent", sounded: true })).toBeUndefined();
    expect(press(RUN, { effect: cmd }, { turn: "spent", sounded: false })).toBe("step");
    // A walk's first step is a turn like any other.
    expect(press(RUN, { effect: { kind: "explore" }, exploring: true }, { turn: "spent", sounded: true })).toBeUndefined();
  });

  it("leaves an ending to its stinger", () => {
    const cmd: AppEffect = { kind: "command", cmd: { kind: "wait" } };
    expect(press(RUN, { effect: cmd, overlay: "dead" }, { turn: "spent", sounded: true })).toBeUndefined();
    expect(press(RUN, { overlay: "sold" })).toBeUndefined();
    // Putting the card away is the interface's.
    expect(press({ ...RUN, overlay: "lost" }, { overlay: "none" })).toBe("close");
  });

  it("opens and closes the cards, and ticks their pages", () => {
    expect(press(RUN, { overlay: "help" })).toBe("open");
    expect(press({ ...RUN, overlay: "help" }, { overlay: "none" })).toBe("close");
    expect(press({ ...RUN, overlay: "help" }, { helpPage: 1 })).toBe("tick");
    expect(press(RUN, { overlay: "history" })).toBe("open");
    expect(press({ ...RUN, overlay: "codex" }, { codexAt: 1 })).toBe("tick");
    // `PageUp` over the help card puts the log in front of it: another card opening.
    expect(press({ ...RUN, overlay: "help" }, { overlay: "history" })).toBe("open");
  });

  it("accepts a level of the list opening and backs out of one closing", () => {
    expect(press(RUN, { moves: true })).toBe("accept");
    expect(press({ ...RUN, moves: true }, { menu: 3 })).toBe("accept");
    expect(press({ ...RUN, moves: true, menu: 3 }, { menu: undefined })).toBe("back");
    expect(press({ ...RUN, doors: true }, { doors: false })).toBe("back");
    expect(press({ ...RUN, doors: true }, { doors: false, moves: true })).toBe("accept");
  });

  it("backs out of a walk that a key stopped", () => {
    expect(press({ ...RUN, exploring: true }, { exploring: false, effect: { kind: "stopAuto" } })).toBe("back");
  });

});

// -------------------------------------------------------------- the player

interface Played {
  wave: string;
  from: number;
  peak: number;
  started: number;
  stopped: number;
}

function fakeContext(clock: { now: number }, state: AudioContextState = "running") {
  const played: Played[] = [];
  let resumed = 0;
  const ctx = {
    get currentTime() {
      return clock.now;
    },
    destination: {} as AudioNode,
    state,
    resume: () => {
      resumed++;
      return Promise.resolve();
    },
    createOscillator: () => {
      const rec: Played = { wave: "", from: 0, peak: 0, started: -1, stopped: -1 };
      played.push(rec);
      return {
        set type(w: string) {
          rec.wave = w;
        },
        frequency: {
          setValueAtTime: (v: number) => void (rec.from = v),
          exponentialRampToValueAtTime: () => undefined,
        },
        connect: () => undefined,
        start: (at: number) => void (rec.started = at),
        stop: (at: number) => void (rec.stopped = at),
      } as unknown as OscillatorNode;
    },
    createGain: () =>
      ({
        gain: {
          setValueAtTime: () => undefined,
          linearRampToValueAtTime: (v: number) => {
            const rec = played[played.length - 1];
            if (rec) rec.peak = v;
          },
          exponentialRampToValueAtTime: () => undefined,
        },
        connect: () => undefined,
      }) as unknown as GainNode,
  } satisfies BlipContext;
  return { ctx, played, resumed: () => resumed };
}

describe("the player", () => {
  it("builds no context and plays nothing with the sound off", () => {
    let made = 0;
    const ui = new UiSound(false, () => {
      made++;
      return undefined;
    });
    ui.play("accept");
    expect(made).toBe(0);
  });

  it("plays the table's row, once, only when asked — the context is made on the first blip", () => {
    const clock = { now: 1 };
    const fake = fakeContext(clock);
    let made = 0;
    const ui = new UiSound(true, () => {
      made++;
      return fake.ctx;
    });
    expect(made).toBe(0);
    ui.play(undefined);
    expect(made).toBe(0);
    ui.play("refuse");
    expect(made).toBe(1);
    expect(fake.played).toHaveLength(1);
    const [blip] = fake.played;
    expect(blip).toMatchObject({ wave: "square", from: BLIPS.refuse.from, peak: BLIPS.refuse.gain, started: 1 });
    expect(blip!.stopped).toBeCloseTo(1 + BLIPS.refuse.ms / 1000);
  });

  it("goes quiet with `S` and speaks again when it comes back", () => {
    const clock = { now: 0 };
    const fake = fakeContext(clock);
    const ui = new UiSound(true, () => fake.ctx);
    ui.setEnabled(false);
    ui.play("tick");
    expect(fake.played).toHaveLength(0);
    ui.setEnabled(true);
    ui.play("toggle");
    expect(fake.played).toHaveLength(1);
  });

  it("does not stutter under a held key", () => {
    const clock = { now: 5 };
    const fake = fakeContext(clock);
    const ui = new UiSound(true, () => fake.ctx);
    ui.play("tick");
    clock.now += (REPEAT_GAP_MS / 2) / 1000;
    ui.play("tick");
    ui.play("back");
    expect(fake.played.map((p) => p.from)).toEqual([BLIPS.tick.from, BLIPS.back.from]);
    clock.now += REPEAT_GAP_MS / 1000;
    ui.play("tick");
    expect(fake.played).toHaveLength(3);
  });

  it("wakes a context the browser left suspended", () => {
    const fake = fakeContext({ now: 0 }, "suspended");
    new UiSound(true, () => fake.ctx).play("open");
    expect(fake.resumed()).toBe(1);
  });

  it("is silence, never an exception, without WebAudio — and asks only once", () => {
    let asked = 0;
    const none = new UiSound(true, () => {
      asked++;
      return undefined;
    });
    none.play("accept");
    none.play("refuse");
    expect(asked).toBe(1);

    const refused = new UiSound(true, () => {
      throw new Error("blocked");
    });
    expect(() => refused.play("accept")).not.toThrow();

    const broken = new UiSound(true, () => ({ ...fakeContext({ now: 0 }).ctx, createOscillator: () => { throw new Error("no"); } }));
    expect(() => broken.play("accept")).not.toThrow();

    // The default, in this suite's node environment, where there is no AudioContext.
    expect(() => new UiSound(true).play("tick")).not.toThrow();
  });
});
