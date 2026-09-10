import { afterEach, describe, expect, it } from "vitest";
import { RoomGame, type RoomGameConfig } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { moduleKind, moduleName, type ModuleId } from "../src/content/modules.js";
import { DEFAULT_LANG, LANGS, setLang, t } from "../src/i18n.js";
import { applyDerived, findSlot, rigOf } from "../src/twist/rig.js";
import { ACTION_WIDTH, BACK_KEY, doorStands, roomActions, type Action } from "../src/ui/actions.js";
import {
  doorBehind,
  doorLevel,
  doorWays,
  doorWaysStand,
  doorsStand,
  sealBehind,
  soleWay,
} from "../src/ui/doorlist.js";

/**
 * The bulkheads of a compartment as a list of their own: the level `d` opens
 * (docs/tasks/G64-door-hotkeys.md).
 *
 * Everything here is a pure function of a hand-drawn ship, so nothing depends
 * on a seed and every state a door has is written out rather than waited for.
 * What is asserted is the promise the whole list makes: a row marked `enabled`
 * is one `playerCommand` accepts, a row that cannot be pressed says why in the
 * rules' own words, and the number a door wears does not move when the door
 * beside it changes.
 */

/** Four doors off one compartment: open, locked, open, sealed. */
const CARGO = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -[d3:k1]- r4
  r2 -d4- r5
  r2 -#d6#- r6
  r1: docking explored
  r2: cargo cover explored
  r4: storage scanned
  r5: hab explored
  r6: corridor explored
`;

/** A ring: two ways round to the airlock, so welding one of them is legal. */
const LOOP = `
  TUG -a1- r1
  r1 -d1- r2
  r1 -d2- r3
  r2 -d3- r3
  r1: docking explored
  r2: cargo explored
  r3: corridor explored
`;

/** A corridor the drone can weld itself into: the airlock is two doors back. */
const DEAD_END = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -d2- r3
  r1: docking explored
  r2: cargo explored
  r3: corridor explored
`;

function config(text: string): Omit<RoomGameConfig, "seed"> {
  return {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    systems: GAME_CONFIG.systems ?? [],
    firstShip: () => shipFromText(text).ship,
    firstShipId: "1",
  };
}

function gameIn(room = "r2", text = CARGO, seed = 7): RoomGame {
  const game = new RoomGame({ ...config(text), seed });
  game.player.room = game.ship.room(room).id;
  game.refreshSight();
  return game;
}

/** Put a module in the rack: the empty slot if there is one, else the last. */
function give(game: RoomGame, kind: ModuleId): void {
  const rig = rigOf(game.player)!;
  const empty = rig.slots.findIndex((s) => s === null);
  const slot = empty >= 0 ? empty : rig.slots.length - 1;
  rig.slots[slot] = { kind, integrity: moduleKind(kind).integrity };
  applyDerived(game.player);
}

/** Take a module out of the rack, the way a burn-out would. */
function drop(game: RoomGame, kind: ModuleId): void {
  const rig = rigOf(game.player)!;
  const slot = findSlot(rig, kind);
  if (slot !== null) rig.slots[slot] = null;
  applyDerived(game.player);
}

const rows = (game: RoomGame): Action[] => doorLevel(game).filter((a) => a.step !== null);
const labels = (game: RoomGame): string[] => doorLevel(game).map((a) => a.label);
const rowFor = (game: RoomGame, label: string): Action | undefined =>
  doorLevel(game).find((a) => a.label.includes(label));

afterEach(() => setLang(DEFAULT_LANG));

describe("the list of bulkheads", () => {
  it("gives every door of the compartment a row, in door order, and a way back", () => {
    const game = gameIn();
    // A door the drone can walk through is always a choice — through it, or
    // shut it — so its row carries no verb; the welded seam has one answer.
    expect(rows(game).map((a) => a.label.trim().split(/\s+/)[0])).toEqual(["d1", "d3", "d4", "cut"]);
    expect(rows(game).map((a) => a.key)).toEqual(["1", "2", "3", "4"]);
    // The order is the doors', not the offers': welding `d1` shut must not send
    // `d3` up the list and hand the number `d1` was wearing to a lock.
    expect(rows(game).map((a) => (a.cmd.kind === "act" ? a.cmd.target : a.cmd.kind === "go" ? a.cmd.door : undefined))).toEqual([
      game.ship.door("d1").id,
      game.ship.door("d3").id,
      game.ship.door("d4").id,
      game.ship.door("d6").id,
    ]);
    const back = doorLevel(game).at(-1)!;
    expect(back.step).toBeNull();
    expect(back.key).toBe(BACK_KEY);
    expect(back.label).toBe(t("action.backRoom"));
  });

  it("leaves the airlock out: it is a way out of the ship, not a door of the room", () => {
    // `<` is its key and `leave a1 TUG out` is its line on the compartment's
    // own list. Nothing can be done *to* it, so a row for it would be a row
    // that only ever refuses.
    const game = gameIn("r1");
    expect(labels(game).some((l) => l.includes("a1"))).toBe(false);
    expect(rows(game)).toHaveLength(1);
  });

  it("puts the verb on a row that spends one, and no verb on a row that asks", () => {
    const game = gameIn();
    // One way through it: pressing the row is that way, so the row says which.
    const seam = rowFor(game, "d6")!;
    expect(seam.enabled).toBe(true);
    expect(seam.cmd).toEqual({ kind: "act", verb: "cut", target: game.ship.door("d6").id });
    expect(seam.step).toBeUndefined();

    // Two ways — through it, or shut it — so the row is a choice, and the
    // first thing it offers is the step through (G83, 6).
    const open = rowFor(game, "d1")!;
    expect(open.step).toBe(game.ship.door("d1").id);
    expect(open.ways?.map((w) => w.verb)).toEqual(["go", "close"]);
    expect(open.cmd).toEqual({ kind: "go", door: game.ship.door("d1").id });

    // Four ways: the row is a choice and the verbs are one level down, priced.
    const locked = rowFor(game, "d3")!;
    expect(locked.step).toBe(game.ship.door("d3").id);
    expect(locked.label).not.toContain("open");
    expect(locked.ways?.map((w) => w.verb)).toEqual(["power", "spike", "cut", "key"]);
  });

  it("says of a welded door what the drone could do about it, and what it could not", () => {
    const game = gameIn();
    const withTorch = rowFor(game, "d6")!;
    expect(withTorch.enabled).toBe(true);
    expect(withTorch.cmd).toEqual({ kind: "act", verb: "cut", target: game.ship.door("d6").id });
    expect(withTorch.ways).toHaveLength(1);

    drop(game, "cutter");
    const without = rowFor(game, "d6")!;
    expect(without.enabled).toBe(false);
    expect(without.ways).toBeUndefined();
    // The compartment's own list refuses a bulkhead nothing can be done about
    // in exactly these words, and there is one of them.
    expect(without.why).toBe(t("why.door.state", { door: "d6", state: t("state.sealed") }));
    // And the row is still there: a door the drone cannot open is information.
    expect(rows(game)).toHaveLength(4);
  });

  it("stands while any door has an answer, and falls away when none has", () => {
    const game = gameIn();
    expect(doorsStand(game)).toBe(true);

    // A corridor behind a welded seam, with nothing to cut it: four rows become
    // no question at all, and the level goes back to the compartment.
    const shut = gameIn("r6");
    drop(shut, "cutter");
    expect(doorsStand(shut)).toBe(false);
    // With the torch it is a question again.
    give(shut, "cutter");
    expect(doorsStand(shut)).toBe(true);
  });

  it("has nothing to show on the tug, where the list is the whole ship", () => {
    const home = new RoomGame({ ...GAME_CONFIG, seed: 4 });
    home.refreshSight();
    expect(doorsStand(home)).toBe(false);
    expect(soleWay(home)).toBeUndefined();
  });
});

describe("a bulkhead with more than one answer", () => {
  it("steps into its own ways, priced, with the way back among them", () => {
    const game = gameIn();
    give(game, "welder");
    const open = rowFor(game, "d1")!;
    expect(open.step).toBe(game.ship.door("d1").id);

    const ways = doorWays(game, game.ship.door("d1").id)!;
    // The step through leads (G83, 6); then shutting it, because that is the
    // order the rules offer the rest in (`systems/doors.ts`, `doorOffers`),
    // and welding is the last thought.
    expect(ways.map((a) => a.key)).toEqual(["1", "2", "3", BACK_KEY]);
    expect(ways[0]!.cmd).toEqual({ kind: "go", door: game.ship.door("d1").id });
    expect(ways[0]!.label.startsWith(`${t("verb.go")} d1`)).toBe(true);
    expect(ways[1]!.cmd).toEqual({ kind: "act", verb: "close", target: game.ship.door("d1").id });
    expect(ways[2]!.cmd).toEqual({ kind: "act", verb: "weld", target: game.ship.door("d1").id });
    expect(ways.at(-1)!.step).toBeNull();
    expect(ways.at(-1)!.label).toBe(t("action.back", { door: "d1" }));
  });

  it("is the map's sublist for a lock, and a level the map has never had for an open door", () => {
    const game = gameIn();
    // A lock: the same four ways, in the same order, whichever list it was
    // reached from (`ui/actions.ts`, `doorMethods`).
    const lock = doorWays(game, game.ship.door("d3").id)!;
    expect(lock.map((a) => a.label)).toEqual(
      roomActions(game, game.ship.door("d3").id).map((a) => a.label),
    );
    // An open door has no sublist off the map at all — walking through it is
    // not a question — and off `d` it has answers: through it, shut it.
    expect(doorStands(game, game.ship.door("d1").id)).toBe(false);
    expect(doorWaysStand(game, game.ship.door("d1").id)).toBe(true);
  });

  it("falls away the moment the door stops having two of them", () => {
    const game = gameIn();
    expect(doorWaysStand(game, game.ship.door("d6").id)).toBe(false);
    // Welded, it is cutting and nothing else: one way, so no list — and with
    // no torch, no way at all.
    expect(doorWays(game, game.ship.door("d6").id)).toBeUndefined();
    drop(game, "cutter");
    expect(doorWays(game, game.ship.door("d6").id)).toBeUndefined();
    // And a door of another compartment is not this level's business at all.
    expect(doorWays(game, game.ship.door("a1").id)).toBeUndefined();
  });

  it("offers a closed door the step through first, and welding second — never welding alone", () => {
    // The owner, on a live run: «почему на d я не могу просто открыть дверь?»
    // — the closed door's only line was `weld` (docs/tasks/G83-anonymous-blows.md, 6).
    const game = gameIn();
    give(game, "welder");
    game.ship.door("d1").state = "closed";
    const ways = doorWays(game, game.ship.door("d1").id)!;
    expect(ways.filter((a) => a.step !== null).map((a) => a.cmd)).toEqual([
      { kind: "go", door: game.ship.door("d1").id },
      { kind: "act", verb: "weld", target: game.ship.door("d1").id },
    ]);
    // Pressing the step is one turn through the door, which opens on the way.
    const before = game.inputs.length;
    expect(game.playerCommand(ways[0]!.cmd).ok).toBe(true);
    expect(game.inputs).toHaveLength(before + 1);
    expect(game.roomOf(game.player).label).toBe("r1");
    expect(game.ship.door("d1").state).toBe("open");

    // Without a torch a closed door is still a step through — one way, so the
    // `d` row is that step itself, and says so.
    const bare = gameIn();
    bare.ship.door("d1").state = "closed";
    const row = rowFor(bare, "d1")!;
    expect(row.cmd).toEqual({ kind: "go", door: bare.ship.door("d1").id });
    expect(row.label.startsWith(`${t("verb.go")} d1`)).toBe(true);
    expect(row.step).toBeUndefined();
  });

  it("offers an open door through, shut, weld; a broken one only through; a seam only the torch", () => {
    const game = gameIn();
    give(game, "welder");
    const verbs = (label: string) => doorWays(game, game.ship.door(label).id)?.filter((a) => a.step !== null).map((a) => (a.cmd.kind === "go" ? "go" : a.cmd.kind === "act" ? a.cmd.verb : "?"));
    expect(verbs("d1")).toEqual(["go", "close", "weld"]);
    game.ship.door("d1").state = "broken";
    expect(verbs("d1")).toBeUndefined();
    expect(rowFor(game, "d1")!.cmd).toEqual({ kind: "go", door: game.ship.door("d1").id });
    expect(verbs("d6")).toBeUndefined();
    expect(rowFor(game, "d6")!.cmd).toEqual({ kind: "act", verb: "cut", target: game.ship.door("d6").id });
  });
});

describe("one bulkhead with one way through it", () => {
  it("is the move itself, not a list of one line", () => {
    // The corridor sits behind a single welded seam and the rack has a torch:
    // `cut` is the whole of what `d` could offer, so it is what `d` does.
    const game = gameIn("r6");
    const only = soleWay(game)!;
    expect(only.verb).toBe("cut");
    expect(only.cmd).toEqual({ kind: "act", verb: "cut", target: game.ship.door("d6").id });
  });

  it("is a list again as soon as there are two ways, or two doors", () => {
    // HAB BLOCK has a single door, but a door the drone can walk through is
    // two ways at least — through it, or shut it — so `d` is a list there.
    const two = gameIn("r5");
    expect(soleWay(two)).toBeUndefined();
    expect(doorLevel(two).filter((a) => a.step !== null)).toHaveLength(1);
    expect(doorWays(two, two.ship.door("d4").id)!.filter((a) => a.step !== null)).toHaveLength(2);

    expect(soleWay(gameIn())).toBeUndefined();
  });

  it("is nothing at all when the one door has no answer", () => {
    const game = gameIn("r6");
    drop(game, "cutter");
    expect(soleWay(game)).toBeUndefined();
  });
});

describe("welding the way back", () => {
  it("has nothing to seal until the drone has walked through something", () => {
    const game = gameIn("r2");
    expect(doorBehind(game)).toBeUndefined();
    expect(sealBehind(game)).toEqual({ ok: false, why: t("why.door.notBehind") });
  });

  it("names the door the drone came through, off the run's own record", () => {
    const game = gameIn("r1", LOOP);
    give(game, "welder");
    expect(game.playerCommand({ kind: "go", door: game.ship.door("d1").id }).ok).toBe(true);
    expect(doorBehind(game)?.label).toBe("d1");

    const sealing = sealBehind(game);
    expect(sealing).toEqual({ ok: true, cmd: { kind: "act", verb: "weld", target: game.ship.door("d1").id } });
  });

  it("forgets it the moment the drone walks on", () => {
    const game = gameIn("r1");
    game.playerCommand({ kind: "go", door: game.ship.door("d1").id });
    game.playerCommand({ kind: "act", verb: "power", target: game.ship.door("d3").id });
    expect(game.playerCommand({ kind: "go", door: game.ship.door("d3").id }).ok).toBe(true);
    // Two compartments on, `d1` is not a door of this room any more.
    expect(doorBehind(game)?.label).toBe("d3");
  });

  it("refuses without a torch in the rack, in the words the list would use", () => {
    const game = gameIn("r1");
    drop(game, "welder");
    game.playerCommand({ kind: "go", door: game.ship.door("d1").id });
    expect(sealBehind(game)).toEqual({
      ok: false,
      why: t("why.module.missing", { module: moduleName("welder") }),
    });
  });

  it("refuses to wall the drone in, and the refusal is the rules' own", () => {
    // The corridor is two doors from the airlock, so welding the way back
    // leaves no walk home at all (`systems/doors.ts`, `stillLeadsHome`).
    const game = gameIn("r1", DEAD_END);
    give(game, "welder");
    game.playerCommand({ kind: "go", door: game.ship.door("d1").id });
    game.playerCommand({ kind: "go", door: game.ship.door("d2").id });
    expect(doorBehind(game)?.label).toBe("d2");
    expect(sealBehind(game)).toEqual({ ok: false, why: t("why.door.wallsIn", { door: "d2" }) });
  });

  it("refuses a bulkhead the rules do not weld", () => {
    const game = gameIn("r1", DEAD_END);
    give(game, "welder");
    game.playerCommand({ kind: "go", door: game.ship.door("d1").id });
    game.ship.door("d1").state = "broken";
    expect(sealBehind(game)).toEqual({ ok: false, why: t("why.door.noWeld", { door: "d1" }) });
  });
});

describe("the list never lies", () => {
  it("offers nothing the sim will not take", () => {
    // The one promise every list in this game makes. Checked on the four door
    // states at once, with and without each tool that answers one.
    for (const kinds of [[], ["welder"], ["welder", "cutter"]] as ModuleId[][]) {
      for (const room of ["r1", "r2", "r5", "r6"]) {
        const game = gameIn(room);
        drop(game, "cutter");
        for (const kind of kinds) give(game, kind);
        for (const row of doorLevel(game)) {
          if (!row.enabled || row.step !== undefined) continue;
          const copy = gameIn(room);
          copy.player.data = { ...game.player.data };
          const rig = rigOf(copy.player)!;
          rig.slots = [...rigOf(game.player)!.slots];
          applyDerived(copy.player);
          expect(copy.playerCommand(row.cmd).ok, `${room} ${row.label}`).toBe(true);
        }
      }
    }
  });

  it("fits the panel in all three languages", () => {
    for (const lang of LANGS) {
      setLang(lang);
      for (const room of ["r1", "r2", "r5", "r6"]) {
        const game = gameIn(room);
        give(game, "welder");
        for (const row of doorLevel(game)) {
          expect(row.label.length, `${lang} ${room} «${row.label}»`).toBeLessThanOrEqual(ACTION_WIDTH);
        }
      }
    }
  });
});
