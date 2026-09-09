import { describe, expect, it } from "vitest";
import {
  Rng,
  RoomGame,
  validateShip,
  type CardContext,
  type Room,
  type RoomCommand,
  type Ship,
  type System,
} from "@jamrog/engine";
import { GAME_CONFIG, type SalvorGame } from "../src/game.js";
import { gatedOffers } from "../src/systems/tug.js";
import { VOYAGE, currentDerelict, voyageOf } from "../src/systems/voyage.js";
import { shipFromText } from "@jamrog/engine/testing";
import { ZONE_KINDS, ENTRY_KIND } from "../src/content/zones.js";
import {
  DERELICTS,
  FATHERS_TUG,
  FREIGHTER,
  LABORATORY,
  MILITARY,
  QUARANTINE,
  buildChartered,
  shipSpecOf,
  type DerelictSpec,
} from "../src/content/derelicts.js";
import {
  CHARTER_KINDS,
  MIN_CHARTER_DEPTH,
  UPLOAD_FLAG,
  retrieveFlag,
  seatCharterMarks,
  uploadFlag,
} from "../src/content/cards-derelicts.js";
import {
  charterFlags,
  charterKinds,
  doneBy,
  offerCharters,
  salvageTarget,
  type Charter,
  type CharterState,
} from "../src/content/charters.js";

/**
 * What a sortie is for (design-doc.md, "Чартеры").
 *
 * Two things are worth proving here and the rest is bookkeeping. One: the offer
 * is always readable — two or three jobs, `NEUTRALIZE` among them, and the
 * small ones never sending the drone to a compartment this hull does not have.
 * Two: a charter that has been taken is a charter that can be finished, which
 * means its mark is aboard the ship the generator then builds, exactly once,
 * and never within one door of the airlock.
 */

const SEEDS = 100;

const NO_RUN: CardContext = { flags: new Set<string>(), shipIndex: 0 };

const NOTHING: CharterState = { loot: 0, online: [] };

/** A ship with nothing on it but rooms: what `doneBy` sees before a sortie. */
function bareShip(): Ship {
  return shipFromText(`
    TUG -a1- r1
    r1 -d1- r2 -d2- r3
    r1: docking
    r2: lab
    r3: med
  `).ship;
}

/** The same ship, with one charter item left in it in whatever state. */
function shipWithItem(item: Record<string, unknown>): Ship {
  const ship = bareShip();
  ship.room("r3").data.items = [item];
  return ship;
}

function marksOf(ship: Ship): string[] {
  return ship.rooms.flatMap((r) => r.marks);
}

function roomsWith(ship: Ship, mark: string): Room[] {
  return ship.rooms.filter((r) => r.marks.includes(mark));
}

function charterOf(list: readonly Charter[], id: string): Charter | undefined {
  return list.find((c) => c.id === id);
}

// -------------------------------------------------------------------- the offer

describe("what the HELM offers", () => {
  it("lists two or three jobs, always with NEUTRALIZE first", () => {
    for (const spec of DERELICTS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const offer = offerCharters(spec, new Rng(seed));
        const where = `${spec.id} seed ${seed}`;
        expect(offer.length, where).toBeGreaterThanOrEqual(2);
        expect(offer.length, where).toBeLessThanOrEqual(3);
        expect(offer[0]!.id, where).toBe("neutralize");
        expect(new Set(offer.map((c) => c.id)).size, where).toBe(offer.length);
      }
    }
  });

  it("sends the small jobs only into compartments this hull has", () => {
    const required = new Set(ZONE_KINDS.filter((z) => z.required).map((z) => z.kind));
    for (const spec of DERELICTS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const offer = offerCharters(spec, new Rng(seed));
        const kinds = offer.filter((c) => c.target).map((c) => c.target!.kind);
        for (const kind of kinds) {
          const where = `${spec.id} seed ${seed} ${kind}`;
          expect(spec.kinds, where).toContain(kind);
          expect(CHARTER_KINDS, where).toContain(kind);
          expect(kind, where).not.toBe(ENTRY_KIND);
          expect(required.has(kind), where).toBe(false);
        }
        // Two errands in one room would be one walk paid for twice.
        expect(new Set(kinds).size, `${spec.id} seed ${seed}`).toBe(kinds.length);
      }
    }
  });

  it("marks a crate for RETRIEVE and a console for UPLOAD", () => {
    let retrieves = 0;
    let uploads = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const charter of offerCharters(LABORATORY, new Rng(seed))) {
        if (charter.id === "retrieve") {
          expect(charter.target!.mark).toBe("*");
          retrieves++;
        }
        if (charter.id === "upload") {
          expect(charter.target!.mark).toBe("&");
          uploads++;
        }
        if (charter.id === "salvage" || charter.id === "neutralize") {
          expect(charter.target).toBeUndefined();
        }
      }
    }
    expect(retrieves).toBeGreaterThan(0);
    expect(uploads).toBeGreaterThan(0);
  });

  it("pays the rates of the economy table, and the hull's price for neutralising it", () => {
    for (const spec of DERELICTS) {
      const rates: Record<string, number> = {
        salvage: 20, retrieve: 25, upload: 30, neutralize: spec.salePrice,
      };
      for (let seed = 1; seed <= 40; seed++) {
        for (const charter of offerCharters(spec, new Rng(seed))) {
          expect(charter.payout, `${spec.id} ${charter.id}`).toBe(rates[charter.id]);
        }
      }
    }
  });

  it("asks for more salvage the bigger the hull is", () => {
    expect(salvageTarget(FREIGHTER)).toBe(20);
    expect(salvageTarget(LABORATORY)).toBe(35);
    expect(salvageTarget(MILITARY)).toBe(35);
    expect(salvageTarget(FATHERS_TUG)).toBe(50);
    for (const spec of DERELICTS) {
      const charter = charterOf(offerCharters(spec, new Rng(3)), "salvage");
      if (charter) expect(charter.text, spec.id).toContain(`${salvageTarget(spec)} CR`);
    }
  });

  it("offers every kind of job over a run of seeds", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const charter of offerCharters(QUARANTINE, new Rng(seed))) seen.add(charter.id);
    }
    expect([...seen].sort()).toEqual(["neutralize", "retrieve", "salvage", "upload"]);
  });

  it("offers the same jobs from the same seed", () => {
    const a = offerCharters(MILITARY, new Rng(12));
    const b = offerCharters(MILITARY, new Rng(12));
    expect(a.map((c) => [c.id, c.text, c.payout, c.target])).toEqual(
      b.map((c) => [c.id, c.text, c.payout, c.target]),
    );
  });

  it("names only compartments a charter card can fill", () => {
    for (const spec of DERELICTS) {
      const kinds = charterKinds(spec);
      expect(kinds.length, spec.id).toBeGreaterThanOrEqual(2);
      for (const kind of kinds) expect(CHARTER_KINDS, `${spec.id} ${kind}`).toContain(kind);
    }
  });
});

// ------------------------------------------------------------------ finishing

describe("when a charter is finished", () => {
  const spec = LABORATORY;

  /** `doneBy`, with the hull the charter was signed against filled in. */
  const filled = (charter: Charter, state: CharterState, ship: Ship, on: DerelictSpec = spec): boolean =>
    doneBy(charter.id, state, ship, on);

  it("counts SALVAGE by what the drone brought home", () => {
    const charter = salvageCharter(spec);
    const ship = bareShip();
    expect(filled(charter, { ...NOTHING, loot: salvageTarget(spec) - 1 }, ship)).toBe(false);
    expect(filled(charter, { ...NOTHING, loot: salvageTarget(spec) }, ship)).toBe(true);
    expect(filled(charter, { ...NOTHING, loot: 900 }, ship)).toBe(true);
  });

  it("counts NEUTRALIZE only when all three systems are up", () => {
    const charter = offerCharters(spec, new Rng(1))[0]!;
    expect(charter.id).toBe("neutralize");
    expect(filled(charter, NOTHING, bareShip())).toBe(false);
    expect(filled(charter, { ...NOTHING, online: ["engine", "core"] }, bareShip())).toBe(false);
    expect(filled(charter, { ...NOTHING, online: ["core", "terminal", "engine"] }, bareShip())).toBe(true);
  });

  it("counts RETRIEVE when the crate has been picked up, and not before", () => {
    const charter = firstWith(spec, "retrieve");
    expect(filled(charter, NOTHING, bareShip())).toBe(false);
    expect(filled(charter, NOTHING, shipWithItem({ kind: "charter-item" }))).toBe(false);
    expect(filled(charter, NOTHING, shipWithItem({ kind: "console", taken: true }))).toBe(false);
    expect(filled(charter, NOTHING, shipWithItem({ kind: "charter-item", taken: true }))).toBe(true);
  });

  it("counts UPLOAD when the console has finished, and not before", () => {
    const charter = firstWith(spec, "upload");
    expect(filled(charter, NOTHING, bareShip())).toBe(false);
    expect(filled(charter, NOTHING, shipWithItem({ kind: "console" }))).toBe(false);
    expect(filled(charter, NOTHING, shipWithItem({ kind: "charter-item", uploaded: true }))).toBe(false);
    expect(filled(charter, NOTHING, shipWithItem({ kind: "console", uploaded: true }))).toBe(true);
  });

  /**
   * The reason the four tests above are written against a lookup and not a method.
   *
   * A charter is signed at the HELM and then lives in `player.data.voyage` for
   * the rest of the voyage, and that record has to survive being written out as
   * JSON (`tests/fuzz.test.ts`, `tests/persistence.test.ts`). A charter that
   * carried its own predicate would come back from a save unable to answer
   * whether it was filled — silently, as a job that simply never pays.
   */
  it("answers the same about a charter that has been through JSON", () => {
    const everything: CharterState = { loot: 999, online: ["engine", "core", "terminal"] };
    const ship = shipWithItem({ kind: "charter-item", taken: true, uploaded: true });

    for (const hull of DERELICTS) {
      for (const charter of offerCharters(hull, new Rng(7))) {
        const restored = JSON.parse(JSON.stringify(charter)) as Charter;
        const where = `${hull.id} ${charter.id}`;
        // Nothing was lost on the way through: the record is the whole charter.
        expect(restored, where).toEqual(charter);
        expect(filled(restored, everything, ship, hull), `${where} filled`).toBe(
          filled(charter, everything, ship, hull),
        );
        expect(filled(restored, NOTHING, bareShip(), hull), `${where} empty`).toBe(
          filled(charter, NOTHING, bareShip(), hull),
        );
      }
    }
  });

  it("says a charter this build does not know is not filled, rather than throwing", () => {
    // A record out of a save written by another version. It must cost a payout
    // at worst; a throw here would land on the way out through the airlock.
    const alien = { id: "moor-the-hull", text: "?", payout: 10 } as unknown as Charter;
    expect(filled(alien, NOTHING, bareShip())).toBe(false);
  });
});

/** The first offer of this hull that carries the job asked for. */
function firstWith(spec: DerelictSpec, id: string): Charter {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const charter = charterOf(offerCharters(spec, new Rng(seed)), id);
    if (charter) return charter;
  }
  throw new Error(`no ${id} charter offered on ${spec.id}`);
}

function salvageCharter(spec: DerelictSpec): Charter {
  return firstWith(spec, "salvage");
}

// -------------------------------------------------------------- marks aboard

describe("a taken charter's mark aboard the ship", () => {
  it("raises the flag the deck reads, and the bare one for everything else", () => {
    const charters = offerCharters(LABORATORY, new Rng(1));
    const flags = charterFlags(charters);
    for (const charter of charters) {
      if (!charter.target) continue;
      const kind = charter.target.kind;
      if (charter.id === "retrieve") expect(flags).toContain(retrieveFlag(kind));
      if (charter.id === "upload") expect(flags).toEqual(expect.arrayContaining([uploadFlag(kind), UPLOAD_FLAG]));
    }
    expect(charterFlags([])).toEqual([]);
    // A charter with no target puts nothing aboard.
    expect(charterFlags(charters.filter((c) => !c.target))).toEqual([]);
  });

  it("puts nothing aboard when no charter was taken", () => {
    for (const spec of DERELICTS) {
      for (let seed = 1; seed <= 20; seed++) {
        const marks = marksOf(buildChartered(spec, 1, new Rng(seed), NO_RUN).ship);
        expect(marks, `${spec.id} seed ${seed}`).not.toContain("*");
        expect(marks, `${spec.id} seed ${seed}`).not.toContain("&");
      }
    }
  });

  it("puts exactly one crate and one console aboard, both out of the shallows", () => {
    for (const spec of DERELICTS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const kinds = charterKinds(spec);
        const item = kinds[seed % kinds.length]!;
        const terminal = kinds[(seed + 1) % kinds.length]!;
        const flags = new Set([retrieveFlag(item), uploadFlag(terminal), UPLOAD_FLAG]);
        const built = buildChartered(spec, 1, new Rng(seed), { flags, shipIndex: 1 });
        const where = `${spec.id} seed ${seed} ${item}/${terminal}`;

        expect(built.problems, where).toEqual([]);
        expect(validateShip(built.ship, shipSpecOf(spec)), where).toEqual([]);

        const crate = roomsWith(built.ship, "*");
        const console = roomsWith(built.ship, "&");
        expect(crate.length, where).toBe(1);
        expect(console.length, where).toBe(1);
        expect(crate[0]!.marks.filter((m) => m === "*").length, where).toBe(1);
        expect(console[0]!.marks.filter((m) => m === "&").length, where).toBe(1);
        expect(crate[0]!.depth, where).toBeGreaterThanOrEqual(MIN_CHARTER_DEPTH);
        expect(console[0]!.depth, where).toBeGreaterThanOrEqual(MIN_CHARTER_DEPTH);
        expect(crate[0]!.kind, where).toBe(item);
        expect(console[0]!.kind, where).toBe(terminal);
      }
    }
  });

  it("builds the same chartered hull twice from the same seed", () => {
    const flags = new Set([retrieveFlag("lab")]);
    const ctx: CardContext = { flags, shipIndex: 1 };
    const a = buildChartered(LABORATORY, 1, new Rng(5), ctx).ship;
    const b = buildChartered(LABORATORY, 1, new Rng(5), ctx).ship;
    expect(JSON.stringify(a.toJSON())).toBe(JSON.stringify(b.toJSON()));
  });
});

describe("seating a mark the deck left in the shallows", () => {
  const shallow = `
    TUG -a1- r1
    r1 -d1- r2 -d2- r3 -d3- r4
    r1: docking
    r2: lab *
    r3: med
    r4: lab
  `;

  it("moves it to the deepest compartment of the same kind", () => {
    const ship = shipFromText(shallow).ship;
    expect(seatCharterMarks(ship)).toEqual([]);
    expect(ship.room("r2").marks).not.toContain("*");
    expect(ship.room("r4").marks).toContain("*");
    expect(ship.room("r4").depth).toBeGreaterThanOrEqual(MIN_CHARTER_DEPTH);
  });

  it("leaves a mark that is already deep enough where it is", () => {
    const ship = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2 -d2- r3
      r1: docking
      r2: lab
      r3: lab * &
    `).ship;
    expect(seatCharterMarks(ship)).toEqual([]);
    expect(ship.room("r3").marks.filter((m) => m === "*")).toHaveLength(1);
    expect(ship.room("r3").marks).toContain("&");
  });

  it("reports a mark it could not seat rather than moving it out of its kind", () => {
    const ship = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2
      r2 -d2- r3
      r1: docking
      r2: lab *
      r3: med
    `).ship;
    expect(seatCharterMarks(ship)).toEqual(["*"]);
    expect(ship.room("r2").marks).toContain("*");
    expect(ship.room("r3").marks).not.toContain("*");
  });
});

// ------------------------------------------------------------ the whole loop

/**
 * A charter as the run actually meets it: signed at the HELM, put aboard by the
 * generator, filled with a verb, paid at the airlock.
 *
 * The game is the shipped one — `newGame`, every system, the real generator —
 * because everything above holds the pieces still and the thing that can break
 * between them is the order: sign before the hull exists, fill it aboard, get
 * out alive, get paid once.
 */
describe("a charter, from the board to the account", () => {
  /** The bulkheads of the tug, by id: DOCK -1- HOLD -2- BENCH -3- HELM. */
  const TO_HELM = [1, 2, 3];

  /** A voyage of exactly one hull, so a test can say which one. */
  function only(spec: DerelictSpec): System<RoomGame> {
    return {
      name: "test-hull",
      onRunStart(game) {
        const voyage = voyageOf(game);
        voyage.derelicts = [spec];
        voyage.state[0]!.spec = spec;
      },
    };
  }

  /**
   * A run on one named hull. The hull system goes first, so the voyage already
   * knows which ship it is docked to by the time VOYAGE draws the board.
   */
  function runOn(spec: DerelictSpec, seed = 4): SalvorGame {
    const game = new RoomGame({
      ...GAME_CONFIG,
      seed,
      systems: [only(spec), ...(GAME_CONFIG.systems ?? [])],
    });
    return Object.assign(game, {
      progress: () => 0,
      metrics: () => ({}),
    }) as SalvorGame;
  }

  /**
   * The board as every hull but the first one draws it.
   *
   * The first hull of a voyage is deliberately one line — `SALVAGE 20 CR`, and
   * nothing else, because it is the first thing a player ever reads
   * (design-doc.md, "Обучение конструкцией", 1; `systems/voyage.ts`, `dock`).
   * Every test below is about a board with a choice on it, so they redraw one
   * the way the second hull would.
   */
  function fullBoard(game: SalvorGame, spec: DerelictSpec): void {
    voyageOf(game).offered = offerCharters(spec, game.rng);
  }

  function walkToHelm(game: RoomGame): void {
    for (const door of TO_HELM) expect(game.playerCommand({ kind: "go", door }).ok).toBe(true);
  }

  function walkToDock(game: RoomGame): void {
    for (const door of [...TO_HELM].reverse()) {
      expect(game.playerCommand({ kind: "go", door }).ok).toBe(true);
    }
  }

  function offersHere(game: RoomGame) {
    return gatedOffers(game);
  }

  function press(game: RoomGame, prefix: string) {
    const offer = offersHere(game).find((o) => o.label.startsWith(prefix));
    expect(offer, `no offer '${prefix}' in [${offersHere(game).map((o) => o.label).join(", ")}]`)
      .toBeDefined();
    return game.playerCommand(offer!.cmd as RoomCommand);
  }

  /** Sign every small charter on the board and walk back to the airlock. */
  function signAll(game: RoomGame): Charter[] {
    walkToHelm(game);
    const signed: Charter[] = [];
    for (const charter of [...voyageOf(game).offered]) {
      if (charter.id === "neutralize") continue;
      expect(press(game, `take ${charter.id.toUpperCase()}`).ok).toBe(true);
      signed.push(charter);
    }
    walkToDock(game);
    return signed;
  }

  /** Everything of one kind lying in a compartment, by the item list's own name. */
  function itemsOn(game: RoomGame, kind: string): Array<Record<string, unknown>> {
    return game.ship.rooms.flatMap(
      (r) => ((r.data.items as Array<Record<string, unknown>>) ?? []).filter((i) => i.kind === kind),
    );
  }

  function standWith(game: RoomGame, kind: string): Record<string, unknown> {
    const room = game.ship.rooms.find((r) =>
      ((r.data.items as Array<Record<string, unknown>>) ?? []).some((i) => i.kind === kind),
    );
    expect(room, `nothing of kind ${kind} aboard`).toBeDefined();
    game.player.room = room!.id;
    game.refreshSight();
    return itemsOn(game, kind)[0]!;
  }

  it("draws a board for the hull the tug is tied to, NEUTRALIZE always on it", () => {
    for (const spec of DERELICTS) {
      const game = runOn(spec);
      fullBoard(game, spec);
      const board = voyageOf(game).offered;

      expect(board.length, spec.id).toBeGreaterThanOrEqual(2);
      expect(board.length, spec.id).toBeLessThanOrEqual(3);
      expect(charterOf(board, "neutralize"), spec.id).toBeDefined();
      expect(voyageOf(game).charters, spec.id).toEqual([]);
    }
  });

  it("gives the first hull of a voyage two lines: the goal, then the salvage run", () => {
    // The onboarding rule, and the only board the game ever shortens: a player
    // who has never seen it reads two lines at the HELM and knows both what the
    // run is for and what one sortie has to pay for (design-doc.md, "Обучение
    // конструкцией", 1). `NEUTRALIZE` leads, because it used to be missing here
    // entirely — and a player who is never shown it flies two whole derelicts
    // without learning that hulls are what the game sells
    // (docs/review-2026-09-07.md, A1).
    for (const spec of DERELICTS) {
      const board = voyageOf(runOn(spec)).offered;
      expect(board.map((c) => c.id), spec.id).toEqual(["neutralize", "salvage"]);
    }
    const board = voyageOf(runOn(FREIGHTER)).offered;
    expect(board[0]!.payout).toBe(FREIGHTER.salePrice);
    expect(board[1]!.payout).toBe(20);
  });

  it("signs from the one list, wherever the drone is standing", () => {
    // It used to be the HELM's and nobody else's, three bulkheads from the
    // airlock — which is where the board went unread for two balance passes.
    // Since G53 the tug is one screen (docs/tasks/G53-tug-is-a-menu.md).
    const game = runOn(LABORATORY);
    const first = voyageOf(game).offered[0]!;

    expect(press(game, `take ${first.id.toUpperCase()}`).ok).toBe(true);
    expect(voyageOf(game).charters).toEqual([first]);
    expect(voyageOf(game).offered).not.toContain(first);
  });

  it("closes the board the moment the hull has been opened", () => {
    const game = runOn(LABORATORY);
    expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);

    walkToHelm(game);
    const offer = offersHere(game).find((o) => o.label.startsWith("take "))!;
    expect(offer.enabled).toBe(false);
    expect(offer.why).toContain("already open");

    const out = game.playerCommand(offer.cmd as RoomCommand);
    expect(out.ok).toBe(false);
    expect(out.cost).toBe(0);
    expect(voyageOf(game).charters).toEqual([]);
  });

  it("puts the marks of the charters signed, and only those, aboard the hull", () => {
    for (const spec of [LABORATORY, MILITARY, QUARANTINE, FATHERS_TUG]) {
      const game = runOn(spec);
      const signed = signAll(game);
      expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);

      for (const charter of signed) {
        const kind = charter.id === "retrieve" ? "charter-item" : "console";
        if (!charter.target) continue;
        expect(itemsOn(game, kind), `${spec.id} ${charter.id}`).toHaveLength(1);
        const room = game.ship.rooms.find((r) =>
          ((r.data.items as Array<Record<string, unknown>>) ?? []).some((i) => i.kind === kind),
        )!;
        expect(room.kind, `${spec.id} ${charter.id}`).toBe(charter.target.kind);
        expect(room.depth, `${spec.id} ${charter.id}`).toBeGreaterThanOrEqual(MIN_CHARTER_DEPTH);
      }
      if (!signed.some((c) => c.id === "retrieve")) expect(itemsOn(game, "charter-item")).toEqual([]);
      if (!signed.some((c) => c.id === "upload")) expect(itemsOn(game, "console")).toEqual([]);
    }
  });

  it("pays a RETRIEVE once, at the airlock, and never twice", () => {
    const game = withCharter("retrieve");
    const before = voyageOf(game).credits;

    standWith(game, "charter-item");
    expect(press(game, "take the marked crate").ok).toBe(true);
    expect(voyageOf(game).credits).toBe(before);

    home(game);
    expect(voyageOf(game).credits).toBe(before + 25);
    expect(voyageOf(game).paid).toEqual(["retrieve"]);

    // Out and back again: the errand is done, and done is not a wage.
    const after = voyageOf(game).credits;
    expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
    home(game);
    expect(voyageOf(game).credits).toBe(after);
  });

  it("gives an UPLOAD back to the ship when the drone steps away from it", () => {
    const game = withCharter("upload");
    const console = standWith(game, "console");

    expect(press(game, "upload (5 turns)").ok).toBe(true);
    expect(press(game, "upload (4 turns)").ok).toBe(true);
    expect(console.turns).toBe(2);

    expect(game.playerCommand({ kind: "wait" }).ok).toBe(true);
    expect(console.turns).toBeUndefined();
    expect(console.uploaded).toBeUndefined();
  });

  it("pays an UPLOAD for five turns in a row, and shouts every one of them", () => {
    const game = withCharter("upload");
    const console = standWith(game, "console");
    const before = voyageOf(game).credits;
    const room = game.roomOf(game.player).id;

    for (let turn = 0; turn < 5; turn++) {
      expect(game.playerCommand({ kind: "act", verb: "upload", target: console.id as number }).ok).toBe(true);
      expect(game.noise.get(room) ?? 0, `turn ${turn + 1}`).toBeGreaterThanOrEqual(6);
    }
    expect(console.uploaded).toBe(true);

    home(game);
    expect(voyageOf(game).credits).toBe(before + 30);
  });

  it("drops the marked crate where the drone died, and pays nobody for it", () => {
    const game = withCharter("retrieve");
    const crate = standWith(game, "charter-item");
    const grave = game.roomOf(game.player).id;
    expect(press(game, "take the marked crate").ok).toBe(true);
    expect(crate.taken).toBe(true);

    // Walk it one compartment on, then die there.
    const door = game.ship.doorsOf(grave).find((d) => game.ship.passable(d, { isPlayer: true }))!;
    expect(game.playerCommand({ kind: "go", door: door.id }).ok).toBe(true);
    const died = game.roomOf(game.player).id;
    const before = voyageOf(game).credits;
    game.player.hp = 0;
    VOYAGE.onDeath!(game, game.player);

    expect(voyageOf(game).credits).toBe(before);
    expect(voyageOf(game).paid).toEqual([]);
    // The crate is on the floor of the compartment the drone died in.
    const hull = game.ships.get("1")!.ship;
    const items = (hull.roomAt(died).data.items as Array<Record<string, unknown>>) ?? [];
    expect(items.map((i) => i.kind)).toContain("charter-item");
    expect(items.every((i) => i.taken === undefined)).toBe(true);
  });

  it("counts a SALVAGE charter over every sortie flown to the hull", () => {
    const game = withCharter("salvage");
    const need = salvageTarget(currentDerelict(game).spec);
    const before = voyageOf(game).credits;

    // Half the target home, then the other half: one sortie would not do it.
    (game.player.data ??= {}).loot = Math.floor(need / 2);
    home(game);
    expect(voyageOf(game).paid).toEqual([]);
    expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);

    (game.player.data ??= {}).loot = need;
    home(game);
    expect(voyageOf(game).paid).toEqual(["salvage"]);
    expect(voyageOf(game).credits).toBe(before + Math.floor(need / 2) + need + 20);
  });

  /**
   * A run aboard a hull that carries exactly this charter, already undocked.
   *
   * Seeds are walked until the laboratory's board offers the one asked for:
   * which small jobs a hull offers is a roll (`offerCharters`), and a test that
   * is about filling one should not also be a test about drawing it.
   */
  function withCharter(id: string): SalvorGame {
    for (let seed = 1; seed <= 60; seed++) {
      const game = runOn(LABORATORY, seed);
      fullBoard(game, LABORATORY);
      if (!voyageOf(game).offered.some((c) => c.id === id)) continue;
      walkToHelm(game);
      expect(press(game, `take ${id.toUpperCase()}`).ok).toBe(true);
      walkToDock(game);
      expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
      // The hull is emptied of machines: what is under test is the errand, and
      // a scrapper walking in halfway through an upload is a different test.
      game.entities = [game.player];
      return game;
    }
    throw new Error(`no laboratory seed offered a ${id} charter`);
  }

  /** Out through the airlock, from wherever the drone is standing. */
  function home(game: RoomGame): void {
    game.player.room = game.ship.entry;
    game.refreshSight();
    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    expect(game.shipId).toBe("tug");
  }
});
