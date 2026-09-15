import { describe, it, expect } from "vitest";
import { Rng, RoomGame, spawnMonsterIn, type Entity, type RoomGameConfig, type Twist } from "@jamrog/engine";
import { BOTS_ROOMS, seedRange, shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame } from "../src/game.js";
import { MONSTERS } from "../src/content/monsters.js";
import { DOORS } from "../src/systems/doors.js";
import { RELIC_MARK, RIG, addWreck, applyDerived, capOf, graft, install, rigOf, type Rig } from "../src/twist/rig.js";
import { MAX_ACTIONS, roomActions } from "../src/ui/actions.js";
import { RELICS } from "../src/content/modules.js";
import { codexFor } from "../src/content/codex.js";
import { initialState } from "../src/ui/appstate.js";
import { screenHtml } from "../src/ui/web/screen.js";
import {
  NO_FLASH,
  PANEL_HEIGHT,
  PANEL_WIDTH,
  DOOR_LINES,
  ROOM_LINES,
  contactTone,
  contactsBlock,
  flashSlots,
  missionBlock,
  panelBlocks,
  panelColour,
  rackIntegrity,
  slotNumberOf,
  trackFlash,
} from "../src/ui/panel.js";
import { shipState } from "../src/systems/shipstate.js";
import { schematicInputOf } from "../src/ui/schematic-input.js";
import { currentDerelict, derelictAboard, voyageOf } from "../src/systems/voyage.js";
import { isTug } from "../src/content/tug.js";
import { CALLSIGNS, flavourCallsign } from "../src/content/derelicts.js";
import { roomName } from "../src/content/zones.js";
import { DEFAULT_LANG, LANGS, setLang, t } from "../src/i18n.js";
import { OBJECTIVES, objectiveName } from "../src/content/objectives.js";

/** A callsign too long for the heading's column, so the class has to stand in. */
const LONG_CALLSIGN = CALLSIGNS.findIndex((c) => c.length > 12);
import { THEME } from "../src/ui/theme.js";

/**
 * The panel is twenty-eight columns wide and there is no scrollbar, so its one
 * hard invariant is arithmetic: every line fits. Everything else about it —
 * which blocks, in which order — is the mock-up in design-doc.md ("Экран").
 */

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

function config(extra: Twist<RoomGame>[] = []): Omit<RoomGameConfig, "seed"> {
  return {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    systems: [...(GAME_CONFIG.systems ?? []), ...extra],
    firstShip: () => shipFromText(CARGO).ship,
    firstShipId: "1",
  };
}

function gameIn(room = "r2", extra: Twist<RoomGame>[] = [], seed = 7): RoomGame {
  const game = new RoomGame({ ...config(extra), seed });
  game.player.room = game.ship.room(room).id;
  game.refreshSight();
  return game;
}

/**
 * The same run with `DOORS` taken out, so the bulkhead methods on the panel are
 * the ones the test names. What the real system offers depends on the rack the
 * drone is carrying, and that is G14's rule to test, not the panel's.
 */
function gameOffering(extra: Twist<RoomGame>[], room = "r2"): RoomGame {
  const systems = [...(GAME_CONFIG.systems ?? []).filter((s) => s !== DOORS), ...extra];
  const game = new RoomGame({ ...config(), systems, seed: 7 });
  game.player.room = game.ship.room(room).id;
  game.refreshSight();
  return game;
}

function put(game: RoomGame, room: string, id: string): Entity {
  const kind = MONSTERS.find((m) => m.id === id);
  if (!kind) throw new Error(`no machine '${id}'`);
  const e = spawnMonsterIn(kind, game.ship.room(room).id);
  game.schedule.admit(e);
  game.entities.push(e);
  game.refreshSight();
  return e;
}

const lines = (game: RoomGame): string[] => panelBlocks(game, roomActions(game)).map((l) => l.text);

/** A full rack, grafted and marked, which is the widest the module block gets. */
function loadRack(game: RoomGame): Rig {
  const rig = rigOf(game.player)!;
  install(rig, "emitter", 3);
  for (let i = 0; i < rig.slots.length; i++) {
    graft(rig, i);
    graft(rig, i);
    const slot = rig.slots[i];
    if (slot) slot.integrity = capOf(slot);
  }
  rig.exposed = 0;
  return rig;
}

describe("every line fits the panel", () => {
  it("holds with a full rack, four doors, three machines and a crowded floor", () => {
    const game = gameIn();
    loadRack(game);
    put(game, "r2", "security-unit");
    put(game, "r2", "scrapper");
    put(game, "r2", "hauler");
    for (let i = 0; i < 6; i++) addWreck(game, game.ship.room("r2").id, "thrusters", 2);

    for (const line of lines(game)) expect(line.length, line).toBeLessThanOrEqual(PANEL_WIDTH);
  });

  it("holds over two hundred sorties played off the list itself", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = new Rng(seed);
      const game = new RoomGame({ ...GAME_CONFIG, seed });
      for (let step = 0; step < seed % 17 && game.status === "playing"; step++) {
        const options = roomActions(game).filter((a) => a.enabled && a.cmd.kind !== "leave");
        game.playerCommand(options.length === 0 ? { kind: "wait" } : rng.pick(options).cmd);
      }
      for (const line of lines(game)) expect(line.length, `seed ${seed}: ${line}`).toBeLessThanOrEqual(PANEL_WIDTH);
    }
  });

  it("cuts a system's line down rather than letting it wrap off the panel", () => {
    const long = "CR 9999   KEYS 3   HOLD 3   RIVAL ▮▮▯   and more besides";
    const game = gameIn("r2", [{ name: "test-wide", panelLines: () => [{ text: long }] }]);
    // And it says that it cut: the `slice` used to be silent, so a row that had
    // lost its end looked like a row that had all of it (G85, 2).
    expect(lines(game)).toContain(`${long.slice(0, PANEL_WIDTH - 1)}…`);
  });
});

describe("the blocks, in the doc's own order", () => {
  it("heads with the hull's callsign, the sortie and the turn", () => {
    // The callsign and not the class: a voyage is four hulls and three of them
    // can be freighters, so `SALVOR  freighter  sortie 2` names none of them
    // (docs/tasks/G55-playtest-findings.md).
    const game = gameIn();
    const out = lines(game);
    expect(out[0]).toBe(`SALVOR  ${flavourCallsign(derelictAboard(game)!.flavour)}  sortie 1`);
    expect(out[1]).toBe("turn 0");
  });

  it("falls back to the class where a callsign will not fit the column", () => {
    // A clipped callsign is a hull nobody has heard of, so the long ones give
    // way to the word the catalogue uses instead.
    const game = gameIn();
    game.currentShip.data.type = "freighter";
    derelictAboard(game)!.flavour = { ...derelictAboard(game)!.flavour, callsign: LONG_CALLSIGN };
    expect(lines(game)[0]).toBe("SALVOR  freighter  sortie 1");
  });

  it("puts the rack above the compartment and the compartment above the list", () => {
    const game = gameIn();
    const out = lines(game);
    const core = out.findIndex((l) => l.startsWith("CORE"));
    const room = out.findIndex((l) => l.startsWith("CARGO BAY r2"));
    const actions = out.indexOf("ACTIONS");
    expect(core).toBeGreaterThan(1);
    expect(room).toBeGreaterThan(core);
    expect(actions).toBeGreaterThan(room);
  });

  /**
   * `doors d1 d3 d4` was the whole of this block until G49, and it could not
   * answer the question the owner's fourth playtest asked out loud — is there a
   * way straight through from here to the hold? A label is an index into a
   * picture; the compartment behind the door is the decision.
   */
  it("says where each of the compartment's doors goes, and what stands in the way", () => {
    const game = gameIn();
    const out = lines(game);
    const at = out.findIndex((l) => l.startsWith("CARGO BAY r2"));
    expect(out[at]).toBe("CARGO BAY r2");
    expect(out.slice(at + 1, at + 5)).toEqual([
      " d1 → DOCKING           open",
      " d3 → STORAGE         locked",
      " d4 → HAB BLOCK         open",
      " d6 → CORRIDOR RING   sealed",
    ]);
  });

  it("says ···· for a compartment nobody has been in or scanned", () => {
    const game = gameIn();
    // r4 is behind a locked bulkhead: the drone cannot see into it, and the
    // panel may not know something the schematic is not drawing.
    game.ship.room("r4").scanned = false;
    game.ship.room("r4").explored = false;
    game.refreshSight();
    expect(lines(game).some((l) => l.startsWith(" d3 → ····"))).toBe(true);
  });

  it("shows salvage with its integrity and leaves the machines to CONTACTS", () => {
    // Two blocks and no overlap: a machine listed in both spent a row of a
    // twenty-eight column panel saying less the second time than the first.
    const game = gameIn();
    addWreck(game, game.ship.room("r2").id, "thrusters", 2);
    expect(lines(game)).toContain(" % scrap THRUSTERS 2/12");

    put(game, "r2", "security-unit");
    const out = lines(game);
    expect(out.some((l) => l.startsWith(" S security unit"))).toBe(false);
    expect(out).toContain("S security unit 8/8 melee");
  });

  it("counts what it cannot fit rather than growing the block", () => {
    const game = gameIn();
    for (let i = 0; i < 7; i++) addWreck(game, game.ship.room("r2").id, "welder", 2);
    const out = lines(game);
    const room = out.findIndex((l) => l.startsWith("CARGO BAY r2"));
    const end = out.indexOf("", room);
    expect(out[end - 1]).toMatch(/^ … \d+ more here$/);
    expect(end - room).toBeLessThanOrEqual(1 + DOOR_LINES + ROOM_LINES);
  });

  it("counts the doors it cannot fit rather than dropping one silently", () => {
    // A panel this crowded has given up the contents already; the doors are
    // next, and the last row of them says how many are not shown.
    //
    // It takes a room full of machines to get there. One was enough until the
    // mission block arrived and the action list learned to ask for only the
    // rows it needs (G56): the panel found the space again, and four doors fit
    // in four lines. What this test is about is the row that counts what does
    // not fit, so the fixture squeezes until something does not — two machines
    // since the doors came back onto the action list and it asks for four rows
    // more than it did (G87); a third squeezes past this rung to the bare
    // labels of the test below.
    const game = gameIn();
    put(game, "r2", "security-unit");
    put(game, "r2", "scout");
    const out = lines(game);
    const room = out.findIndex((l) => l.startsWith("CARGO BAY r2"));
    const end = out.indexOf("", room);
    expect(out[end - 1]).toMatch(/^ … \d+ more doors?$/);
    expect(end - room).toBeLessThan(1 + DOOR_LINES);
  });

  it("falls back to the bare labels when it is down to one row", () => {
    // One row that names every door beats one row that names none and counts
    // them: this is the line the panel carried before G49, kept as the floor.
    const tall = { name: "test-tall", panelLines: () => Array.from({ length: 6 }, () => ({ text: "x" })) };
    const game = gameIn("r2", [tall]);
    put(game, "r2", "security-unit");
    const out = lines(game);
    const room = out.findIndex((l) => l.startsWith("CARGO BAY r2"));
    // Three labels and a count of the fourth, never four labels with the last
    // one cut in half: `d6` clipped to `d` — or worse, to another ship's real
    // label — is the defect the bots swept up (G55, 5).
    expect(out[room]).toBe("CARGO BAY r2  doors d1 d3 +2");
    expect(out[room]!.length).toBeLessThanOrEqual(PANEL_WIDTH);
    // The blank row under it is the air, and on a panel this crowded the air
    // has already gone to the list (G85, 0).
    expect(out[room + 1]).toBe("ACTIONS");
  });

  it("never cuts a door label in half, whatever the compartment is called", () => {
    // The property behind the row above, over every compartment of two hundred
    // hulls in all three languages: the row prints whole labels of *this*
    // compartment and a `+N`, never half of one. Half a label reads as a door,
    // and on 6.6 % of the screens the bots swept it was another real door of
    // the same ship (docs/tasks/G55-playtest-findings.md, 5).
    let rows = 0;
    let counted = 0;
    for (const lang of LANGS) {
      setLang(lang);
      for (let seed = 1; seed <= 200; seed++) {
        const game = newGame(seed);
        // Aboard the derelict, which is where the compartments have four doors
        // and the names run long: the tug's own four rooms never overflow the
        // row, so measuring them would be a green test about nothing.
        expect(game.playerCommand({ kind: "act", verb: "undock" }).ok, `seed ${seed}`).toBe(true);
        for (const room of game.ship.rooms) {
          game.player.room = room.id;
          game.refreshSight();
          // The row's own prefix, rendered through the same sentence, so what
          // follows it is exactly the labels — in any language.
          const head = t("panel.roomDoors", {
            room: roomName(room),
            label: room.label,
            doors: "\u0000",
          }).split("\u0000")[0]!;
          const row = lines(game).find((l) => l.startsWith(head));
          if (row === undefined) continue;
          rows++;
          const here = new Set(game.ship.doorsOf(room.id).map((d) => d.label));
          for (const word of row.slice(head.length).split(" ").filter((w) => w.length > 0)) {
            if (/^\+\d+$/.test(word)) continue;
            counted++;
            expect(here.has(word), `${lang} seed ${seed}: ${row}`).toBe(true);
          }
        }
      }
    }
    setLang("en");
    // A property nobody reached is a green test about nothing.
    expect(rows).toBeGreaterThan(0);
    expect(counted).toBeGreaterThan(0);
  });
});

describe("the action list on the panel", () => {
  it("numbers the lines, and draws a bulkhead's own ways in the same rows", () => {
    const game = gameOffering([
      {
        name: "test-doors",
        offerActions: (g) => {
          const door = g.ship.door("d3").id;
          return [
            { label: "unlock", cmd: { kind: "act", verb: "key", target: door }, enabled: true },
            { label: "spike", cmd: { kind: "act", verb: "spike", target: door }, enabled: true },
          ];
        },
      },
    ]);
    const map = roomActions(game, undefined, true);
    const out = panelBlocks(game, map).map((l) => l.text);
    expect(out).toContain(" 1 DOCKING   r1  1 door");
    // A lock with two answers is the choice between them; the answers are the
    // list one level down, in this same block and never over it
    // (docs/tasks/G46-nested-actions.md).
    expect(out).toContain(" 2 STORAGE   r4  d3 locked");
    expect(out.some((l) => l.startsWith("   K spike"))).toBe(false);

    const door = map.find((a) => a.step !== undefined)!.step!;
    const ways = panelBlocks(game, roomActions(game, door, true)).map((l) => l.text);
    expect(ways).toContain(" 1 key     1 turn, silent");
    expect(ways).toContain(" 2 spike   2 turns, noise 4");
    expect(ways).toContain(" 0 back (d3)");
  });

  /**
   * The map drawn in the same block, with the same numbers and the same rows of
   * letters under it (docs/tasks/G48-travel-to-a-room.md). No window, no
   * dimming, no second screen — design-doc.md, "Явно НЕ входит в игру" rules
   * modality out by name, and the panel is what proves it here.
   */
  it("draws the map of the ship in the same rows when the list is on that level", () => {
    const game = gameIn();
    addWreck(game, game.ship.room("r2").id, "thrusters", 2);
    const out = panelBlocks(game, roomActions(game, undefined, true)).map((l) => l.text);

    expect(out).toContain(" 1 DOCKING   r1  1 door");
    expect(out).toContain(" 2 STORAGE   r4  d3 locked");
    expect(out).toContain(" 0 back");
    // Nothing of the compartment is numbered beside them, and the panel still
    // ends on the rows a lost player reads.
    expect(out.some((l) => l.includes("salvage"))).toBe(false);
    expect(out[out.length - 1]).toBe("o explore  Tab fight  ? help");
    expect(out[out.length - 2]).toBe("h hide  < leave");
  });

  it("counts what the ten keys could not reach and what the panel had no room for", () => {
    // Sixteen things to do in one compartment: six of them never get a key
    // (`ui/actions.ts`), and on a panel this crowded three more of the numbered
    // ones have nowhere to be drawn. The count is both, so the number in the
    // line is the number of things not on the screen.
    const game = gameIn();
    for (let i = 0; i < 12; i++) addWreck(game, game.ship.room("r2").id, "welder", 2);
    const out = lines(game);

    const all = roomActions(game).length;
    expect(all).toBeGreaterThan(MAX_ACTIONS);
    const numbered = out.filter((l) => /^ \d /.test(l)).length;
    expect(numbered).toBeGreaterThan(0);
    // And the count names the way to them: the arrows move the ten digits over
    // the list rather than the eleventh line being unreachable, which is what
    // it was until G55 (`ui/actions.ts`, `windowStart`).
    expect(out).toContain(`… ${all - numbered} more (↑↓)`);
  });

  it("keeps brace, hide, the way out and the meta keys off the numbers", () => {
    const cargo = lines(gameIn());
    // `m` leads the row: walking is the commonest thing there is, and its
    // number was a different number every turn (G48).
    expect(cargo).toContain("m move  d doors  . brace");
    expect(cargo).toContain("h hide  < leave");
    expect(cargo).toContain("o explore  Tab fight  ? help");

    // The airlock compartment of the fixture has no cover, and the way home is
    // the line a lost player looks for.
    expect(lines(gameIn("r1"))).toContain("< leave");
  });
});

/**
 * The row that says `? help` is the one a lost player is looking for, and on
 * the owner's first playtest it was line thirty-six of a panel thirty-four rows
 * tall — so the renderer never drew it (docs/tasks/G40-tug-clarity.md, 5).
 *
 * The fix is an order of precedence rather than a shorter block anywhere: the
 * keys and the map of the tug are laid out first, and the numbered list is
 * given whatever is left over.
 */
describe("the row of letters is always the last row of the panel", () => {
  const KEYS = "o explore  Tab fight  ? help";
  const TUG_KEYS = "0 back  ? help";
  // At the top of the tug's list `0` is the tenth row, cast off, and the foot
  // may not name a second thing for it (docs/tasks/G88-polish-by-map.md, B6).
  const TUG_TOP = "? help";

  it("holds on a compartment with more in it than the panel can hold", () => {
    const game = gameIn();
    loadRack(game);
    put(game, "r2", "security-unit");
    put(game, "r2", "scrapper");
    for (let i = 0; i < 20; i++) addWreck(game, game.ship.room("r2").id, "thrusters", 2);

    const out = lines(game);
    expect(out).toHaveLength(PANEL_HEIGHT);
    expect(out[out.length - 1]).toBe(KEYS);
  });

  it("stands in the same corner whatever is above it, empty rows and all", () => {
    // The owner: "подсказки по хоткеям всегда снизу справа". Before G48 the
    // keys simply followed the list, so a quiet compartment put them halfway up
    // the sidebar and every salvaged wreck moved them again.
    const quiet = lines(gameIn("r1"));
    const crowded = gameIn();
    put(crowded, "r2", "security-unit");
    for (let i = 0; i < 6; i++) addWreck(crowded, crowded.ship.room("r2").id, "thrusters", 2);
    const busy = lines(crowded);
    for (const out of [quiet, busy]) {
      expect(out).toHaveLength(PANEL_HEIGHT);
      expect(out[out.length - 1]).toBe(KEYS);
    }
    // The quiet compartment gets there on blank rows rather than on content.
    expect(quiet.filter((l) => l === "").length).toBeGreaterThan(busy.filter((l) => l === "").length);
  });

  it("holds over two hundred sorties and two hundred visits to the tug", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = new Rng(seed);
      const game = newGame(seed);
      for (let step = 0; step < seed % 17 && game.status === "playing"; step++) {
        const options = roomActions(game).filter((a) => a.enabled);
        game.playerCommand(options.length === 0 ? { kind: "wait" } : rng.pick(options).cmd);
      }
      const out = lines(game);
      expect(out.length, `seed ${seed}`).toBe(PANEL_HEIGHT);
      // At home the row names the two keys that do something there and no
      // others: `o`, `Tab`, `m`, `.` and `<` all belong to the half of the game
      // played aboard a hull (docs/tasks/G53-tug-is-a-menu.md, 2).
      expect(out[out.length - 1], `seed ${seed}`).toBe(isTug(game) ? TUG_TOP : KEYS);
    }
  });

  it("stays the last row with a sub-list open and a list of ten", () => {
    // The other half of the owner's «подсказки по хоткеям всегда снизу справа»:
    // the row used to be the tail of the action list, so a list long enough to
    // push it off the panel took it with it (docs/tasks/G54-two-ships-confusion.md,
    // 7). One level down counts as well — a bulkhead's ways through it, or a
    // tug verb's modules — because that is where the list is longest.
    const game = newGame(4);
    let nested = 0;
    for (const level of [undefined, "sell", "buy", "graft"] as const) {
      const list = roomActions(game, level);
      const down = list.some((a) => a.step === null);
      if (down) nested++;
      const drawn = panelBlocks(game, list).map((l) => l.text);
      expect(drawn.length, String(level)).toBe(PANEL_HEIGHT);
      expect(drawn[drawn.length - 1], String(level)).toBe(down ? TUG_KEYS : TUG_TOP);
    }
    expect(nested).toBeGreaterThan(0);

    const hull = gameIn("r2");
    for (let i = 0; i < 12; i++) addWreck(hull, hull.ship.room("r2").id, "welder", 2);
    const long = panelBlocks(hull, roomActions(hull)).map((l) => l.text);
    expect(long[long.length - 1]).toBe(KEYS);
  });

  it("gives the compartment's contents up before it gives up a numbered line", () => {
    // Every content row of the room block is an action list line said
    // differently, so on a crowded panel it is the block that pays. The list is
    // what a player acts through, and the doors are at the bottom of it.
    const tall = { name: "test-tall", panelLines: () => Array.from({ length: 4 }, () => ({ text: "x" })) };
    const game = gameIn("r2", [tall]);
    put(game, "r2", "security-unit");
    for (let i = 0; i < 3; i++) addWreck(game, game.ship.room("r2").id, "thrusters", 2);
    const out = lines(game);

    // The compartment keeps its name and its doors and gives up the rest.
    const room = out.findIndex((l) => l.startsWith("CARGO BAY r2"));
    expect(out[room]).toContain("doors d1");
    expect(out.some((l) => l.startsWith(" % scrap"))).toBe(false);
    // And the blank row that used to sit between the block and the list has
    // gone the same way: the air is the last thing the panel gives, and it
    // gives it rather than draw a list with nothing on it (G85, 0).
    expect(out[room + 1]).toBe("ACTIONS");
    // And with the air paid over to it the list now draws every line it has,
    // so there is nothing left to count: the block above gave its contents and
    // the layout gave its blank rows, in that order (G85, 0).
    const numbered = out.filter((l) => /^[ ▸]\d /.test(l));
    expect(numbered.length).toBe(roomActions(game).filter((a) => a.key !== "").length);
    expect(out.some((l) => l.startsWith("… "))).toBe(false);
    // Where the doors went: they are rows of the map now, one `m` away, and
    // the compartment's own list is only what happens in this compartment.
    expect(roomActions(game, undefined, true).map((a) => a.label)).toContain("DOCKING   r1  1 door");
    expect(out.slice(-3)).toEqual(["m move  d doors  . brace", "h hide  < leave", KEYS]);
  });

  it("shortens the list rather than the keys, and says how much it shortened it", () => {
    const game = gameIn();
    for (let i = 0; i < 12; i++) addWreck(game, game.ship.room("r2").id, "welder", 2);
    const out = lines(game);

    const more = out.findIndex((l) => l.startsWith("… "));
    expect(more).toBeGreaterThan(0);
    // The count, then the letters, and nothing after them.
    expect(out.slice(more + 1)).toEqual(["m move  d doors  . brace", "h hide  < leave", KEYS]);
  });
});

/**
 * CONTACTS: what is alive, where it is, what it does to a rack, and what it did
 * to the drone last turn (docs/tasks/G40-tug-clarity.md, 7 · G47-contacts.md).
 *
 * The owner's second playtest stood in ENGINEERING while an ENFORCER hit them
 * turn after turn, and the panel said `doors d3 d6` and nothing else. G40 gave
 * that a block; the third playtest showed the block itself being missed — "меня
 * бьют, я игнорю" — so it moved to the top of the panel, under a rule the width
 * of the sidebar, and every line now says why the machine on it matters.
 */
describe("the contacts block", () => {
  const contacts = (game: RoomGame): string[] => contactsBlock(game).map((l) => l.text);

  it("is not there at all when there is nothing in sight", () => {
    // Two rows saying `no contacts` is two rows of the action list spent on
    // silence. The absence is the answer, and it is legible because the block's
    // presence is a red rule across the panel.
    const game = gameIn();
    expect(contacts(game)).toEqual([]);
    expect(lines(game).some((l) => l.startsWith("══"))).toBe(false);
  });

  it("rules a red bar across the panel the moment something is in the room", () => {
    const game = gameIn();
    put(game, "r2", "security-unit");
    put(game, "r2", "scrapper");
    const out = panelBlocks(game, roomActions(game));
    const bar = out.find((l) => l.text.startsWith("══"))!;

    expect(bar.text).toBe(`══ ENEMY IN HERE: 2 ${"═".repeat(PANEL_WIDTH - 20)}`);
    expect(bar.text).toHaveLength(PANEL_WIDTH);
    expect(bar.fg).toBe(THEME.bad);
  });

  it("rules an amber one when everything in sight is still behind a door", () => {
    const game = gameIn();
    put(game, "r5", "scout");
    const bar = panelBlocks(game, roomActions(game)).find((l) => l.text.startsWith("══"))!;

    expect(bar.text.startsWith("══ THROUGH THE DOOR: 1 ")).toBe(true);
    expect(bar.fg).toBe(THEME.warn);
  });

  it("gives each group its own rule, so each count is of the lines under it", () => {
    // One rule could not carry both numbers honestly: `ENEMY IN HERE: 2` over
    // three lines reads as a panel that cannot count, and one total over a
    // machine standing next to you throws the loud half of the message away.
    const game = gameIn();
    put(game, "r2", "security-unit");
    put(game, "r2", "crawler");
    put(game, "r5", "scout");

    expect(contacts(game)).toEqual([
      "══ ENEMY IN HERE: 2 ════════",
      "S security unit 8/8 melee",
      "z crawler 3/3 no scrap",
      "══ THROUGH THE DOOR: 1 ═════",
      "c scout 3/3 d4 melee",
    ]);
  });

  it("stands above the rack, where the eye lands before it reads anything", () => {
    const game = gameIn();
    put(game, "r2", "security-unit");
    const out = lines(game);

    expect(out.findIndex((l) => l.startsWith("══"))).toBe(3);
    expect(out.findIndex((l) => l.startsWith("CORE"))).toBeGreaterThan(4);
  });

  it("gives a machine in the compartment one red line and no room name", () => {
    const game = gameIn();
    put(game, "r2", "security-unit");
    const block = contactsBlock(game);

    // No `HERE`: the rule over the block already said it, and the five columns
    // it cost are the ones the danger word is written in.
    expect(block[1]!.text).toBe("S security unit 8/8 melee");
    // The rule above it is red, and so is the machine's own line (G90 D1): only
    // its hit points say how much of it is left, and this one is whole (G79).
    expect(block[0]!.fg).toBe(THEME.bad);
    expect(block[1]!.fg).toBe(THEME.bad);
    expect(block[1]!.tone).toEqual({ from: 16, to: 19, fg: THEME.hpFull });
    expect(block[1]!.text.slice(16, 19)).toBe("8/8");
    expect(block).toHaveLength(2);
  });

  it("gives one through an open door the door to shut on it, in amber", () => {
    const game = gameIn();
    put(game, "r5", "scout");
    const block = contactsBlock(game);

    expect(game.visible.has(game.ship.room("r5").id)).toBe(true);
    expect(block[1]!.text).toBe("c scout 3/3 d4 melee");
    // A door away is what the amber rule over the block says. The line says
    // what the fight would cost, and this scout is whole.
    expect(block[0]!.fg).toBe(THEME.warn);
    expect(block[1]!.fg).toBe(THEME.bad);
    expect(block[1]!.tone?.fg).toBe(THEME.hpFull);
  });

  /**
   * Kyzrati's green-to-red on remaining integrity, which is how he says "this
   * one you can finish" without making anybody read a number
   * (docs/gui-guides.md, "Что применить", D). Four bands and three thresholds:
   * whole, hurt, half gone, a quarter left.
   */
  it("colours a contact by how much of the machine is left", () => {
    const bands: Array<[number, number, string]> = [
      [10, 10, THEME.hpFull],
      [9, 10, THEME.fg],
      [6, 10, THEME.fg],
      [5, 10, THEME.warn],
      [3, 10, THEME.warn],
      [2, 10, THEME.hpLow],
      [0, 10, THEME.hpLow],
    ];
    for (const [hp, max, fg] of bands) {
      expect(contactTone(hp, max), `${hp}/${max}`).toBe(fg);
    }
    // A machine the content pack gave no hit points at all is not a red line.
    expect(contactTone(0, 0)).toBe(THEME.hpFull);
  });

  it("puts that colour on the line the panel draws, and leaves the rule alone", () => {
    const game = gameIn();
    const machine = put(game, "r2", "security-unit");
    const whole = contactsBlock(game);
    expect(whole[1]!.tone?.fg).toBe(THEME.hpFull);

    machine.hp = 2;
    const hurt = contactsBlock(game);
    expect(hurt[1]!.text).toBe("S security unit 2/8 melee");
    expect(hurt[1]!.tone?.fg).toBe(THEME.hpLow);
    expect(hurt[1]!.fg).toBe(THEME.bad);
    // The rule over the block still says which group it is: that is the half
    // the colour change did not take (G47).
    expect(hurt[0]!.fg).toBe(THEME.bad);
  });

  it("drops a whole word rather than half of one when a name will not fit", () => {
    // `sentry turre` reads as a typo and makes the panel look wrong; `sentry`
    // reads as a column that ran out, which is what happened.
    const game = gameIn();
    put(game, "r5", "sentry-turret");
    expect(contactsBlock(game)[1]!.text).toBe("t sentry 5/5 d4 shoots");
  });

  it("says nothing about a machine behind a shut bulkhead", () => {
    // The panel may not know what the schematic is not drawing: r4 is behind a
    // locked door, so whatever is in it is not a contact.
    const game = gameIn();
    put(game, "r4", "security-unit");
    expect(game.visible.has(game.ship.room("r4").id)).toBe(false);
    expect(contacts(game)).toEqual([]);
  });

  it("adds what it did to the drone on the turn just gone", () => {
    const game = gameIn();
    const machine = put(game, "r2", "security-unit");
    const rig = rigOf(game.player)!;
    rig.exposed = rig.slots.findIndex((s) => s?.kind === "plating");
    RIG.onDamage!(game, game.player, 1, machine);

    expect(contacts(game)[2]).toBe("   burns PLATING");
    // One turn on with nothing said, and the line is gone again.
    game.log.add("You wait.", game.schedule.time + 1, "plain");
    expect(contacts(game)).toHaveLength(2);
  });

  it("counts the machines it has no rows for rather than growing", () => {
    // The rule says how many are in the compartment, rows or no rows — the
    // number the schematic's badge shows — and the ones without a row are
    // counted again underneath, so the arithmetic still closes.
    const game = gameIn();
    for (let i = 0; i < 4; i++) put(game, "r2", "scout");
    const block = contactsBlock(game, 2);

    expect(block.map((l) => l.text)).toEqual([
      "══ ENEMY IN HERE: 4 ════════",
      "c scout 3/3 melee",
      "c scout 3/3 melee",
      "… 2 more in sight",
    ]);
    expect(block[3]!.fg).toBe(THEME.fgDim);
  });

  it("says the number the schematic's badge says, off the same list", () => {
    // The owner read `ВРАГ В ОТСЕКЕ: 6` on the panel and `7` on the map of the
    // same compartment (docs/tasks/G83-anonymous-blows.md, 4). One source now:
    // `hostilesIn`, for the rule and for the badge in every view.
    const game = gameIn();
    for (let i = 0; i < 7; i++) put(game, "r2", "scout");
    const box = schematicInputOf(game).rooms.find((r) => r.label === "r2")!;
    const badge = Math.ceil((box.hostiles ?? 0) / 2);
    expect(badge).toBe(7);
    expect(contactsBlock(game)[0]!.text).toContain("ENEMY IN HERE: 7");
    expect(contactsBlock(game).map((l) => l.text)).toContain("… 1 more in sight");
  });

  it("keeps one machine on the panel however short of rows it is", () => {
    const game = gameIn();
    for (let i = 0; i < 6; i++) put(game, "r2", "scout");
    loadRack(game);
    for (let i = 0; i < 20; i++) addWreck(game, game.ship.room("r2").id, "thrusters", 2);

    const out = lines(game);
    expect(out).toHaveLength(PANEL_HEIGHT);
    expect(out.some((l) => l.startsWith("c scout"))).toBe(true);
    expect(out[out.length - 1]).toBe("o explore  Tab fight  ? help");
  });

  it("fits the panel with three machines here and one more next door", () => {
    const game = gameIn();
    put(game, "r2", "security-unit");
    put(game, "r2", "arc-sentinel");
    put(game, "r2", "maintenance-bot");
    put(game, "r5", "security-unit");
    for (const line of lines(game)) expect(line.length, line).toBeLessThanOrEqual(PANEL_WIDTH);
    for (const line of contacts(game)) expect(line.length, line).toBeLessThanOrEqual(PANEL_WIDTH);
  });
});

/**
 * The one word that says why this machine is the one to deal with. What the
 * word *is* belongs to `contacts.test.ts` — the rule lives in the system that
 * writes the log line. This is only that it reaches the line.
 */
describe("the danger word reaches the panel", () => {
  it("puts one on every contact, whichever machine it is", () => {
    const game = gameIn();
    put(game, "r2", "sentry-turret");
    put(game, "r2", "jammer");
    put(game, "r2", "bloom");

    expect(contactsBlock(game).slice(1).map((l) => l.text)).toEqual([
      "t sentry turret 5/5 shoots",
      "j jammer 5/5 jams",
      "Y bloom 8/8 sits",
    ]);
  });
});

/**
 * The mission block: what this sortie is for, in the two places the owner
 * looked for it and did not find it (docs/owner-queue.md, 4 and 5).
 *
 * The facts were all in the game already. What was missing was a place on the
 * screen that says the hull has a price, that three systems buy it, that this
 * compartment holds one of them, and what the charters signed for it still
 * want.
 */
describe("the mission block", () => {
  /** A freighter with its three systems, so the block has something to say. */
  const HULL = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -d2- r3
  r3 -d3- r4
  r1: docking explored
  r2: engineering E explored
  r3: reactor O explored
  r4: control T explored
`;

  const hullIn = (room: string, extra: Twist<RoomGame>[] = []): RoomGame => {
    const game = new RoomGame({
      ...GAME_CONFIG,
      seed: 7,
      content: { ...SALVOR, monsterChance: () => 0 },
      systems: [...(GAME_CONFIG.systems ?? []), ...extra],
      firstShip: () => shipFromText(HULL).ship,
      firstShipId: "1",
    });
    game.player.room = game.ship.room(room).id;
    game.refreshSight();
    return game;
  };

  it("stands above the rack and names the three systems in full", () => {
    const out = lines(hullIn("r1"));
    const goal = out.findIndex((l) => l.startsWith("GOAL: START 3 → SELL"));
    expect(goal).toBeGreaterThan(0);
    // Each un-raised system carries the compartment it stands in, once that
    // compartment has been seen: every system is drawn with the same `+` on the
    // schematic, so the id is the only thing that tells one from another.
    // Full words, over two rows when one will not hold them
    // (docs/tasks/G88-polish-by-map.md, B5).
    expect(out.slice(goal + 1, goal + 3)).toEqual(["·ENGINE r2 ·REACTOR r3", "·TERMINAL r4"]);
    // Above the rack, which is where the counters and the old `SHIP` line were.
    expect(goal).toBeLessThan(out.findIndex((l) => l.startsWith("CORE  ")));
  });

  it("ticks a system off as it comes up", () => {
    const game = hullIn("r1");
    shipState(game).online.push("engine", "terminal");
    // The four-letter forms are gone: a row that will not hold the words wraps.
    const out = lines(game);
    const at = out.indexOf("✓ENGINE ·REACTOR r3");
    expect(at).toBeGreaterThan(0);
    expect(out[at + 1]).toBe("✓TERMINAL");
  });

  it("asks about a system nobody has found rather than dotting it like the rest", () => {
    // `·CORE` was printed for a system that is up nowhere and for one the drone
    // has never been near alike, and three quarters of the systems still
    // standing are in compartments nobody has entered: the row read as "found,
    // and we are not telling you where" on 56.7 % of screens
    // (docs/tasks/G87-playability.md, 2).
    const game = hullIn("r1");
    for (const id of ["r3", "r4"]) {
      const room = game.ship.room(id);
      room.explored = false;
      room.scanned = false;
    }
    game.refreshSight();
    // In words, not a `?` a player has to be told the meaning of
    // (docs/tasks/G88-polish-by-map.md, B5).
    const unseen = lines(game);
    expect(unseen[unseen.indexOf("·ENGINE r2") + 1]).toBe("not found: REACTOR TERMINAL");
    expect(unseen.some((l) => /\?[A-Z]/.test(l))).toBe(false);

    // Sweeping one of them turns the question into an address.
    game.ship.room("r3").scanned = true;
    const swept = lines(game);
    expect(swept[swept.indexOf("·ENGINE r2 ·REACTOR r3") + 1]).toBe("not found: TERMINAL");
  });

  it("says the three systems in no more than two rows, in every language", () => {
    const game = hullIn("r1");
    for (const lang of LANGS) {
      setLang(lang);
      for (const seen of [true, false]) {
        for (const id of ["r2", "r3", "r4"]) {
          game.ship.room(id).explored = seen;
          game.ship.room(id).scanned = seen;
        }
        game.refreshSight();
        const rows = missionBlock(game).slice(1).map((l) => l.text);
        for (const row of rows) expect(row.length, `${lang} ${row}`).toBeLessThanOrEqual(PANEL_WIDTH);
        const names = OBJECTIVES.map(objectiveName);
        const wrap = rows.filter((row) => names.some((n) => row.includes(n)));
        expect(wrap.length, `${lang} ${seen}`).toBeLessThanOrEqual(2);
        for (const n of names) expect(wrap.join(" "), `${lang} ${n}`).toContain(n);
      }
    }
    setLang(DEFAULT_LANG);
  });

  it("says the goal is out of reach when nothing in the rack raises anything", () => {
    // A drone whose rack has nothing for any system still standing is in a
    // state it cannot get out of by walking, and the sweep found it there on
    // 24 % of turns aboard, in stretches of a median 25 turns and a worst of
    // 483, with no line of the screen saying so. The goal line is the one that
    // has to stop repeating a price (docs/tasks/G87-playability.md, 2).
    const game = hullIn("r1");
    rigOf(game.player)!.slots.fill(null);
    applyDerived(game.player);

    // Which system wants which tool, and the three marks still under it
    // (docs/tasks/G88-polish-by-map.md, B4): six rows, the block's whole budget.
    const block = missionBlock(game).map((l) => l.text);
    expect(block).toEqual([
      "NEED A TOOL: < HOME FOR IT",
      "ENGINE: CUTTER/WELDER",
      "REACTOR: CELL",
      "TERMINAL: SPIKE/keycard",
      "·ENGINE r2 ·REACTOR r3",
      "·TERMINAL r4",
    ]);
    expect(missionBlock(game)[0]!.fg).toBe(THEME.bad);
    // Short of rows it keeps the heading and the first system, never the price.
    expect(missionBlock(game, 2).map((l) => l.text)).toEqual(["NEED A TOOL: < HOME FOR IT", "ENGINE: CUTTER/WELDER"]);

    // One tool back and it is a goal again.
    install(rigOf(game.player)!, "cell", 8);
    applyDerived(game.player);
    expect(missionBlock(game)[0]!.text).toMatch(/^GOAL: START 3 → SELL/);
  });

  it("keeps calling it a goal while one system is still within reach", () => {
    // Two of the three beyond the rack is not the state above: the line may
    // only give up when every one of them is.
    const game = hullIn("r1");
    const rig = rigOf(game.player)!;
    rig.slots.fill(null);
    install(rig, "cell", 8);
    applyDerived(game.player);
    expect(missionBlock(game)[0]!.text).toMatch(/^GOAL: START 3 → SELL/);
  });

  it("says what is in this compartment even with nothing in the rack for it", () => {
    // The whole of docs/owner-queue.md, 4.2: the numbered line for a system the
    // drone cannot raise is greyed *and* sorts last, so on a busy panel it is
    // counted away and the compartment reads as empty. This line never is.
    const game = hullIn("r3");
    rigOf(game.player)!.slots.fill(null);
    applyDerived(game.player);

    const found = panelBlocks(game, roomActions(game)).find((l) => l.text.startsWith("+ REACTOR"));
    expect(found?.text).toBe("+ REACTOR CELL, 2 turns");
    expect(found?.fg).toBe(THEME.fgDim);
  });

  it("says the same line in full colour once the tool is aboard", () => {
    const game = hullIn("r2");
    const found = panelBlocks(game, roomActions(game)).find((l) => l.text.startsWith("+ ENGINE"));
    expect(found?.text).toBe("+ ENGINE CUTTER, 3 turns");
    expect(found?.fg).toBe(THEME.fg);
  });

  it("says nothing about a compartment whose system is already up", () => {
    const game = hullIn("r2");
    shipState(game).online.push("engine");
    expect(lines(game).some((l) => l.startsWith("+ "))).toBe(false);
  });

  it("keeps the goal and this compartment when the panel runs out of rows", () => {
    // Same squeeze as every other block on this panel: the charters and the
    // three marks give their rows back to the numbered list, the goal and the
    // thing that can be done right here never do.
    const tall = { name: "test-tall", panelLines: () => Array.from({ length: 8 }, () => ({ text: "x" })) };
    const game = hullIn("r2", [tall]);
    const out = lines(game);

    expect(out.some((l) => l.startsWith("GOAL: START 3 → SELL"))).toBe(true);
    expect(out).toContain("+ ENGINE CUTTER, 3 turns");
    expect(out).not.toContain("·ENGINE ·CORE ·TERMINAL");
  });

  it("is not drawn on a hull with no systems aboard", () => {
    expect(missionBlock(gameIn())).toEqual([]);
  });

  /**
   * The state the whole task was reopened for. The owner raised all three
   * systems, read `СИСТ. прив ✓ ядро ✓ терм ✓` and said he still had no idea
   * how to bring the ship in: a checklist that has filled up is not an
   * instruction, and by then an instruction is all that is left to give.
   */
  it("stops being a checklist the moment the third system is up", () => {
    const game = hullIn("r2");
    const price = derelictAboard(game)!.spec.salePrice;
    shipState(game).online.push("engine", "core");
    expect(lines(game).some((l) => l.startsWith("ALL THREE"))).toBe(false);

    shipState(game).online.push("terminal");
    const out = panelBlocks(game, roomActions(game));
    const done = out.findIndex((l) => l.text === `ALL 3 STARTED  +${price} CR`);
    expect(done).toBeGreaterThan(0);
    // And the key that leaves, on the row under it: `<` walks to the airlock
    // from anywhere aboard (G48), so the instruction is one keystroke long.
    expect(out[done + 1]!.text).toBe("< out the airlock to sell");
    expect(out[done]!.fg).toBe(THEME.good);
    expect(out[done + 1]!.fg).toBe(THEME.good);
    // The row of marks has served its purpose and gone.
    expect(out.some((l) => l.text.includes("✓ENGINE"))).toBe(false);
  });

  it("says the hull is taken once it is under tow", () => {
    const game = hullIn("r2");
    derelictAboard(game)!.sold = true;
    expect(lines(game)).toContain("HULL SOLD  under tow");
  });

  it("is one line on the tug: what the hull tied up outside is worth", () => {
    // The tug says the rest of it in its own words (`systems/voyage.ts`), and
    // the price is the one thing neither of them was saying.
    const game = newGame(4);
    const block = missionBlock(game);
    expect(block).toHaveLength(1);
    expect(block[0]!.text).toBe(`GOAL: START 3 → SELL ${currentDerelict(game).spec.salePrice} CR`);
  });

  /**
   * The charters, with the progress that was nowhere on the screen: a charter
   * said what it wanted once, in a log line, and the owner asked "не понял
   * контракты на 1ый корабль" (docs/owner-queue.md, 5).
   */
  it("prices the hull and counts the salvage a charter still wants", () => {
    const game = newGame(11);
    const voyage = voyageOf(game);
    // The salvage run, off the first stop's list: the first line of the hull
    // the voyage opened tied to (G90 F). The goal is not a line of it.
    const board = roomActions(game, "jump").filter((a) => a.cmd.kind === "act" && a.cmd.verb === "berth");
    expect(board[0]!.label, "the first line is the salvage run").toMatch(/^SALVAGE /);
    expect(game.playerCommand(board[0]!.cmd).ok).toBe(true);
    expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);

    // The block itself rather than the whole panel: the compartment behind the
    // airlock of this seed has a machine in it, and a panel carrying a contacts
    // block, a full rack and five actions is one the charters give their rows
    // back to. What is being tested here is what the block says.
    const block = missionBlock(game).map((l) => l.text);
    // The hull's own price, off the itinerary — the number the goal is for.
    expect(block[0]).toBe(`GOAL: START 3 → SELL ${voyage.derelicts[0]!.salePrice} CR`);
    expect(block).toContain("CHARTERS");
    expect(block).toContain("· SALVAGE 0/20 CR");

    // What the drone is carrying counts towards it: leaving now would bank it,
    // and that is the decision the line is read for.
    (game.player.data ??= {}).loot = 12;
    expect(missionBlock(game).map((l) => l.text)).toContain("· SALVAGE 12/20 CR");
  });

  it("never lists NEUTRALIZE among the errands", () => {
    // It is the goal line, not a fourth charter — half of why the owner read
    // the run's whole point as one more optional job.
    const game = newGame(11);
    const voyage = voyageOf(game);
    // The first hull of a voyage offers `SALVAGE` and nothing else
    // (`systems/voyage.ts`, `dock`), so the charter that is always on offer is
    // signed by hand here — the point is that the block never prints it.
    voyage.charters.push({ id: "neutralize", text: "raise all three", payout: 120 });
    game.player.room = game.ship.rooms.find((r) => r.kind === "dock")!.id;
    game.refreshSight();
    game.playerCommand({ kind: "act", verb: "undock" });

    const block = missionBlock(game).map((l) => l.text);
    expect(block.some((l) => l.startsWith("GOAL"))).toBe(true);
    expect(block.some((l) => l.includes("START 3") && !l.startsWith("GOAL"))).toBe(false);
  });
});

/**
 * The panel on the tug: which of the two ships you are standing on, and the map
 * of the other three compartments under the list (`docs/tasks/G40-tug-clarity.md`,
 * 1 and 2).
 */
describe("the panel at home", () => {
  it("heads with the tug and ends with the two keys that work there", () => {
    // The four-row map of the compartments used to sit above this row, saying
    // which of them sold and which mended. There are no compartments to map
    // since G53 — every verb is on the list — and the row of letters is down to
    // the keys that do something at home.
    const game = newGame(4);
    const out = panelBlocks(game, roomActions(game));
    const text = out.map((l) => l.text);

    expect(text[0]).toBe(`SALVOR  tug → ${flavourCallsign(currentDerelict(game).flavour)}`);
    expect(text[text.length - 1]).toBe("? help");
    for (const station of ["DOCK", "HOLD", "BENCH", "HELM"]) {
      expect(text.some((l) => l.includes(station)), station).toBe(false);
    }
    for (const line of text) expect(line.length, line).toBeLessThanOrEqual(PANEL_WIDTH);
  });

  it("draws every numbered row of the list at home, cast off and the jump included", () => {
    // Eight guaranteed rows hid the last two of the ten, the two that leave,
    // under `… 2 more` on 34 % of screens at home (docs/tasks/G88-polish-by-map.md, B7).
    let home = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const game = newGame(seed);
      const bot = BOTS_ROOMS.careful!();
      const rng = new Rng(seed ^ 0x5bf03635);
      for (let step = 0; step < 400 && !game.isOver(); step++) {
        if (isTug(game)) {
          home++;
          const list = roomActions(game);
          const drawn = panelBlocks(game, list).map((l) => l.text);
          for (const a of list.filter((row) => row.key !== "")) {
            expect(drawn.some((r) => r.includes(`${a.key} ${a.label}`)), `seed ${seed} step ${step}: ${a.label}`).toBe(true);
          }
        }
        const cmd = bot(game, rng);
        if (!game.playerCommand(cmd).ok) game.playerCommand({ kind: "wait" });
      }
    }
    expect(home).toBeGreaterThan(0);
  });

  it("prints the whole tug as three headed groups of nine numbered rows", () => {
    // The screen the owner asked for after two live runs: everything the tug
    // does at once, grouped by verb, one row per verb whatever it could be
    // aimed at, and a reason on every row that cannot be pressed
    // (docs/tasks/G53-tug-is-a-menu.md).
    const game = newGame(4);
    const out = lines(game);
    const first = out.indexOf("ACTIONS") + 1;
    expect(out.slice(first, first + 5)).toEqual([
      " 1 buy a hull ▸",
      "REPAIR",
      " 2 repair a module ▸",
      " 3 graft a module ▸ 12 CR",
      " 4 clean a module",
    ]);
    expect(out).toContain("RIG");
    // The charter group is gone: contracts are lines of the jump list (G90 F).
    expect(out).not.toContain("CHARTERS");
    expect(out).toContain("NEXT HULL");
    // Casting off is last, and the two headings that stood over a single row
    // each are gone (docs/tug-menu-audit.md, П7).
    expect(out).not.toContain("DRONE");
    expect(out).not.toContain("SELL");
    expect(out).toContain(" 9 cast off — board closes");
    expect(out.filter((l) => /^[▸ ]\d /.test(l))).toHaveLength(9);

    // No compartment block, no doors and no second way out: the tug is not a
    // place any more (docs/tasks/G54-two-ships-confusion.md).
    expect(out.some((l) => l.includes("leave") || l.includes("DOCK r1"))).toBe(false);
  });

  it("keeps the airlock's letter for a derelict, where it is the way home", () => {
    expect(lines(newGame(4))).not.toContain("< leave");
    expect(lines(gameIn("r1"))).toContain("< leave");
  });
});

/**
 * The highlight the arrows move (docs/tasks/G40-tug-clarity.md, 8). What the
 * cursor *is* belongs to `appstate.test.ts`; this is only how it is drawn.
 */
describe("the highlighted line", () => {
  it("marks the line the cursor is on and leaves the rest as they were", () => {
    const game = gameIn();
    addWreck(game, game.ship.room("r2").id, "thrusters", 2);
    const out = panelBlocks(game, roomActions(game), 1);
    const first = out.findIndex((l) => l.text.endsWith("salvage THRUSTERS 2/12"));

    expect(out[first]!.text.startsWith(" 1 ")).toBe(true);
    expect(out[first]!.fg).toBe(THEME.fg);
    expect(out[first + 1]!.text.startsWith("▸2 ")).toBe(true);
    expect(out[first + 1]!.fg).toBe(THEME.accent);
  });

  it("marks a line nobody can press, because Enter still has to answer for it", () => {
    const game = gameIn();
    // Nothing in the rack and no keycard: one level down into the fixture's
    // locked bulkhead, the module ways are the lines that cannot be pressed
    // (the chassis always can, G90 B).
    rigOf(game.player)!.slots.fill(null);
    applyDerived(game.player);
    game.refreshSight();
    const list = roomActions(game, game.ship.door("d3").id, true);
    const shut = list.findIndex((a) => !a.enabled);
    expect(shut).toBeGreaterThanOrEqual(0);

    const out = panelBlocks(game, list, shut).filter((l) => /^[▸ ]\d /.test(l.text));
    expect(out[shut]!.text.startsWith("▸")).toBe(true);
    // Dim rather than amber (G90 D5): the reducer only leaves it on a greyed
    // line when nothing on the list can be pressed, and then nothing waits.
    expect(out[shut]!.fg).toBe(THEME.soft);
  });

  it("marks nothing at all when nothing is pointing at the list", () => {
    const game = gameIn();
    for (const line of panelBlocks(game, roomActions(game))) {
      expect(line.text.startsWith("▸"), line.text).toBe(false);
    }
  });

  it("keeps every line inside the panel with the marker on it", () => {
    const game = gameIn();
    loadRack(game);
    for (let i = 0; i < 6; i++) addWreck(game, game.ship.room("r2").id, "thrusters", 2);
    for (let cursor = 0; cursor < MAX_ACTIONS; cursor++) {
      for (const line of panelBlocks(game, roomActions(game), cursor)) {
        expect(line.text.length, line.text).toBeLessThanOrEqual(PANEL_WIDTH);
      }
    }
  });
});

describe("the flash", () => {
  it("marks the slots that lost integrity between two frames", () => {
    expect([...flashSlots([3, 3], [3, 2])]).toEqual([1]);
    // A slot the panel has never seen is a rack being filled in, not a hit.
    expect([...flashSlots([], [3, 3])]).toEqual([]);
  });

  it("survives every redraw of its own turn and goes out with the clock", () => {
    const hit = trackFlash({ integrity: [3, 3], slots: new Set(), turn: 4 }, [3, 2], 5);
    expect([...hit.slots]).toEqual([1]);
    const redrawn = trackFlash(hit, [3, 2], 5);
    expect([...redrawn.slots]).toEqual([1]);
    expect([...trackFlash(redrawn, [3, 2], 6).slots]).toEqual([]);
  });

  it("reads the rack off the player and nothing else", () => {
    const game = gameIn();
    expect(rackIntegrity(game.player)).toHaveLength(6);
    expect(rackIntegrity({ ...game.player, data: {} } as Entity)).toEqual([]);
    expect(trackFlash(NO_FLASH, rackIntegrity(game.player), 0).slots.size).toBe(0);
  });

  it("colours a hurt module red over whatever the system asked for", () => {
    const line = { text: "2 THRUSTERS▮▮▮", fg: THEME.fg };
    expect(slotNumberOf(line.text)).toBe(1);
    expect(panelColour(line, new Set([1]))).toBe(THEME.bad);
    expect(panelColour(line, new Set())).toBe(THEME.fg);
    // An action line starts with a space, so it is never read as a slot.
    expect(slotNumberOf(" 2 go d1  DOCKING   open")).toBeUndefined();
  });
});

// ---------------------------------------------------------- the mark of a cut

/**
 * The sidebar's backstop, and why it is no longer silent (G85, 2).
 *
 * Lines of the numbered list are fitted before either view sees them
 * (`ui/actions.ts`, `fitLabel`), so what still reaches the panel's own `slice`
 * is a block: a compartment with a long name, a machine's row. A row cut
 * without a mark is a row that looks whole, and a player who cannot see that
 * something was dropped has no reason to look for it.
 */
describe("a sidebar row that did not fit says so", () => {
  it("ends in … and stays inside the panel's width", () => {
    const game = gameIn();
    const long = "x".repeat(PANEL_WIDTH + 8);
    const rows = panelBlocks(game, [{ key: "1", label: long, cmd: { kind: "wait" }, enabled: true }], 0);
    const cut = rows.map((l) => l.text).find((text) => text.includes("x"))!;
    expect(cut.length).toBe(PANEL_WIDTH);
    expect(cut.endsWith("…")).toBe(true);
  });
});

// ------------------------------------------------------------ the relic's mark

/**
 * A relic is marked in the rack, in every view (G85, 5).
 *
 * The rack drew `+` for a graft and `\u25c0` for the exposed slot and nothing at
 * all for a relic — so the bench refusing to mend or graft one
 * (`systems/voyage.ts`, `repair`) was the first the player heard that the
 * module was different from the five beside it. The mark is the tile set's own
 * two-by-two block, which is what tells a relic there too.
 */
describe("a relic in the rack is marked", () => {
  it("wears the mark beside its name in the ASCII panel, the page and the hexagons", () => {
    const game = gameIn();
    const rack = rigOf(game.player)!;
    install(rack, "blade", 14);
    applyDerived(game.player);

    const row = panelBlocks(game, []).map((l) => l.text).find((text) => text.includes("Q-BLADE"))!;
    expect(row).toContain(`Q-BLADE${RELIC_MARK}`);
    expect(row.length).toBeLessThanOrEqual(PANEL_WIDTH);

    const state = { ...initialState(), overlay: "none" as const };
    for (const map of ["graph", "hex"] as const) {
      const html = screenHtml(game, state, new Set(), undefined, map);
      expect(html, map).toContain(`Q-BLADE${RELIC_MARK}`);
    }
  });

  it("marks none of the five modules that are not relics", () => {
    const game = gameIn();
    const rows = panelBlocks(game, []).map((l) => l.text).filter((t) => slotNumberOf(t) !== undefined);
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(row, row).not.toContain(RELIC_MARK);
  });

  it("says what the mark means on the relic's own card, in all three languages", () => {
    for (const lang of LANGS) {
      setLang(lang);
      for (const id of RELICS) {
        expect(t(codexFor(id)!.what as never), `${lang} ${id}`).toContain(RELIC_MARK);
      }
    }
    setLang("en");
  });
});

// ------------------------------------------------------- the list is never gone

/**
 * The numbered list always has lines on it (G85, 0).
 *
 * `panelBlocks` lets every block above the list shorten itself in turn, and
 * when that was not enough it handed `fitList` a budget of one row — which
 * went to the count, so the panel printed `ACTIONS`, then `… 6 more`, and not
 * one line of the list. Measured over 200 careful voyages: 1 657 turns aboard
 * of 48 691, and 1 395 of those with a machine in the compartment. On seed 4
 * what it hid was `close d7` — the door the enforcer was shooting through.
 *
 * The rows now come out of the air between the blocks, nearest the list first:
 * a blank row belongs to the layout and a numbered line is the interface.
 */
describe("the numbered list always has lines on it", () => {
  /**
   * The turns the playability sweep named, shortest first. Seed 3's turn was
   * 119; on the ten-rung ladder (G90 A) that voyage is over by 116, so its
   * entry stands on the last busy compartment turn the same run still has.
   */
  const CAUGHT: Array<[number, number]> = [
    [4, 20],
    [5, 19],
    [44, 89],
    [2, 70],
    [3, 100],
    [1, 123],
  ];

  /** Rows of the panel that are lines of the numbered list. */
  function listed(rows: readonly { text: string }[]): string[] {
    return rows.map((l) => l.text).filter((text) => /^[ ▸][1234567890] /.test(text));
  }

  function playTo(seed: number, steps: number): RoomGame {
    const game = newGame(seed);
    const bot = BOTS_ROOMS.careful!();
    const rng = new Rng(seed ^ 0x5bf03635);
    for (let step = 0; step < steps; step++) {
      if (game.isOver()) break;
      if (!game.playerCommand(bot(game, rng)).ok) game.playerCommand({ kind: "wait" });
    }
    return game;
  }

  it("on every turn the sweep caught it empty, whatever the cursor is on", () => {
    for (const [seed, steps] of CAUGHT) {
      const game = playTo(seed, steps);
      // The pairs were caught on older hulls; a voyage that now ends sooner
      // has no list to draw, and nothing to catch.
      if (game.isOver()) continue;
      for (let cursor = 0; cursor < 5; cursor++) {
        const actions = roomActions(game, undefined, false, cursor);
        expect(actions.length, `seed ${seed} step ${steps}: nothing to do`).toBeGreaterThan(0);
        const rows = listed(panelBlocks(game, actions, cursor));
        expect(rows.length, `seed ${seed} step ${steps} cursor ${cursor}`).toBeGreaterThan(0);
      }
    }
  });

  it("names the door being shot through on the turn that hid it", () => {
    // Seed 4, ten careful steps in: a machine in sight through d2 and the
    // `close` row on the list for it (the pair moved with the larger starting
    // hulls and the crowd rules of G90 B; it was seed 4 at twenty steps and d7).
    const game = playTo(4, 10);
    const rows = listed(panelBlocks(game, roomActions(game), 0));
    expect(rows.some((r) => r.includes("close d2"))).toBe(true);
  });

  it("over 200 careful voyages, on every turn aboard", () => {
    let turns = 0;
    let cut = 0;
    for (const seed of seedRange(1, 200)) {
      const game = newGame(seed);
      const bot = BOTS_ROOMS.careful!();
      const rng = new Rng(seed ^ 0x5bf03635);
      for (let step = 0; step < 1500 && !game.isOver(); step++) {
        if (!isTug(game)) {
          const actions = roomActions(game);
          if (actions.length > 0) {
            turns++;
            const rows = listed(panelBlocks(game, actions, 0));
            expect(rows.length, `seed ${seed} step ${step}: the list drew nothing`).toBeGreaterThan(0);
            if (rows.length < actions.filter((a) => a.key !== "").length) cut++;
          }
        }
        if (!game.playerCommand(bot(game, rng)).ok) game.playerCommand({ kind: "wait" });
      }
    }
    expect(turns, "the control: the list was drawn at all").toBeGreaterThan(40_000);
    // And it is whole far more often than it was: 37.7 % of these turns used to
    // end in a count, against 9.6 % now.
    expect(cut / turns, "turns whose list did not fit").toBeLessThan(0.15);
  }, 600_000);

  it("does not offer the arrows for a list they cannot move", () => {
    // Every one of the 5 236 turns that still ends in a count has a digit on
    // every line, so `↑↓` moves the highlight and nothing else. The arrows are
    // named on the other kind of count — a list too long for ten keys, where
    // they slide the digits along it — and that one is proved on a compartment
    // with sixteen things to do in it, above.
    const game = playTo(4, 20);
    const actions = roomActions(game);
    expect(actions.filter((a) => a.key === "")).toHaveLength(0);
    const more = panelBlocks(game, actions, 0).map((l) => l.text).find((r) => r.startsWith("… "));
    if (more !== undefined) expect(more).not.toContain("↑");
    for (const lang of LANGS) {
      setLang(lang);
      expect(t("panel.more", { n: 3 })).not.toContain("↑");
      expect(t("panel.more.arrows", { n: 3 })).toContain("↑");
    }
    setLang("en");
  });
});
