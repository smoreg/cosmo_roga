import { describe, it, expect } from "vitest";
import { derelictName, flavourCallsign } from "../src/content/derelicts.js";
import { RoomGame, hexLayout, spawnMonsterIn, type RoomGameConfig } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame } from "../src/game.js";
import { TUG_CALLSIGNS, tugCallsign } from "../src/content/hints.js";
import { MONSTERS } from "../src/content/monsters.js";
import { currentDerelict, undock } from "../src/systems/voyage.js";
import { addWreck, applyDerived, findSlot, rigOf } from "../src/twist/rig.js";
import { schematic } from "../src/ui/schematic.js";
import { BANNER_WIDTH, bannerLine, schematicInputOf, thingsIn } from "../src/ui/schematic-input.js";
import { LAYOUT } from "../src/ui/theme.js";
import { hexSvgOf } from "../src/ui/web/hex-svg.js";
import { svgOf } from "../src/ui/web/schematic-svg.js";

/**
 * The one adapter between the engine's ship and the picture of it.
 *
 * What is tested here is not the drawing — `schematic.test.ts` owns that — but
 * the two things only this file decides: how much of a compartment the drone is
 * allowed to know, and which of a box's two ports each door leaves by. Both are
 * invisible until they are wrong, and then the schematic quietly lies.
 */

const SHIP = `
  TUG -a1- r1
  r1 -d1- r2
  r1 -(d2)- r3
  r2 -[d3:k1]- r4
  r1: docking
  r2: cargo
  r3: corridor
  r4: storage
`;

function config(): Omit<RoomGameConfig, "seed"> {
  return {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(SHIP).ship,
    firstShipId: "1",
  };
}

function gameIn(room = "r2", seed = 7): RoomGame {
  const game = new RoomGame({ ...config(), seed });
  game.player.room = game.ship.room(room).id;
  game.refreshSight();
  return game;
}

function put(game: RoomGame, room: string, id: string): void {
  const kind = MONSTERS.find((m) => m.id === id)!;
  const e = spawnMonsterIn(kind, game.ship.room(room).id);
  game.schedule.admit(e);
  game.entities.push(e);
  game.refreshSight();
}

const roomOf = (game: RoomGame, label: string) =>
  schematicInputOf(game).rooms.find((r) => r.label === label)!;

describe("how much of a compartment is drawn", () => {
  it("marks where the drone stands, what it sees, what it remembers", () => {
    const game = gameIn();
    game.ship.room("r3").explored = true;

    expect(roomOf(game, "r2").state).toBe("current");
    // r1 is where the sortie began and it is through an open door: in sight,
    // which outranks the memory of having stood in it.
    expect(roomOf(game, "r1").state).toBe("visible");
    expect(roomOf(game, "r3").state).toBe("explored");
    // Behind a locked bulkhead, and nothing has swept it.
    expect(roomOf(game, "r4").state).toBe("unknown");

    game.ship.room("r4").scanned = true;
    expect(roomOf(game, "r4").state).toBe("scanned");
  });

  it("goes dark one door out the moment the scanner burns", () => {
    const game = gameIn();
    expect(game.player.sight).toBe(1);
    expect(roomOf(game, "r1").state).toBe("visible");

    const rig = rigOf(game.player)!;
    rig.slots[findSlot(rig, "scanner")!] = null;
    applyDerived(game.player);
    console.log('sight', game.player.sight, 'visible', game.visible.size);
    game.refreshSight();
    expect(roomOf(game, "r1").state).toBe("explored");
  });

  it("says nothing at all about a compartment nobody has seen", () => {
    const game = gameIn();
    addWreck(game, game.ship.room("r4").id, "welder", 2);
    expect(roomOf(game, "r4").glyphs).toBe("");
  });

  it("shows machines only where the drone can see them", () => {
    const game = gameIn();
    put(game, "r2", "security-unit");
    put(game, "r3", "scout");
    game.ship.room("r3").explored = true;

    expect(roomOf(game, "r2").glyphs).toBe("S");
    // r3 is behind a closed door: remembered, and machines are not memories.
    expect(roomOf(game, "r3").glyphs).toBe("");
  });

  it("keeps drawing the compartments the drone walked through, smoke or no smoke", () => {
    // The owner, on a live run: «я сделал 2 шага между комнатами и они
    // исчезли» (docs/tasks/G83-anonymous-blows.md, 5). Walked compartments
    // are memory, and memory is not what a smoke-filled compartment blinds:
    // from inside the smoke the drone sees nothing but the smoke, and the
    // boxes it has stood in stay solid in every view all the same.
    const smoked = `
      TUG -a1- r1
      r1 -d1- r2 -d2- r3 -d3- r4
      r3 -d4- r5
      r1: docking
      r2: hold
      r3: hab hazard=smoke
      r4: reactor
      r5: cargo
    `;
    const game = new RoomGame({ ...config(), firstShip: () => shipFromText(smoked).ship, seed: 11 });
    const step = (door: string) =>
      expect(game.playerCommand({ kind: "go", door: game.ship.door(door).id }).ok).toBe(true);
    step("d1");
    step("d2");
    // In the smoke: the compartments behind are remembered, not seen.
    expect(game.visible).toEqual(new Set([game.ship.room("r3").id]));
    expect(roomOf(game, "r1").state).toBe("explored");
    expect(roomOf(game, "r2").state).toBe("explored");
    step("d3");
    step("d3");
    step("d2");
    expect(roomOf(game, "r2").state).toBe("current");
    expect(roomOf(game, "r3").state).toBe("explored");
    expect(roomOf(game, "r4").state).toBe("explored");
    expect(roomOf(game, "r5").state).toBe("unknown");

    // And every view draws what the adapter remembers: the label of each
    // walked compartment is on the terminal sheet, in the SVG and in the hexes.
    const input = schematicInputOf(game);
    const ascii = schematic(input).lines.map((l) => l.text).join("\n");
    const svg = svgOf(input);
    const hexes = hexSvgOf(input, hexLayout(game.ship));
    for (const label of ["r1", "r2", "r3", "r4"]) {
      expect(ascii, `${label} on the sheet`).toContain(label);
      expect(svg, `${label} in the SVG`).toContain(`>${label}<`);
      expect(hexes, `${label} in the hexes`).toContain(`>${label}<`);
    }
  });

  it("keeps wreckage on the schematic after the drone has walked away", () => {
    const game = gameIn();
    addWreck(game, game.ship.room("r3").id, "welder", 2);
    game.ship.room("r3").explored = true;
    expect(roomOf(game, "r3").glyphs).toBe("%");
  });

  it("draws a sensor pulse as the snapshot it was", () => {
    const game = gameIn();
    const r4 = game.ship.room("r4");
    r4.scanned = true;
    r4.data.snapshot = "m %";
    expect(roomOf(game, "r4").glyphs).toBe("m %");
  });

  it("puts the airlock in the compartment that has one", () => {
    const game = gameIn("r1");
    expect(roomOf(game, "r1").glyphs.startsWith("a1")).toBe(true);
    expect(schematicInputOf(game).tug).toEqual({ at: game.ship.entry, label: "a1" });
  });

  it("reads the catalogue's own content without trusting it", () => {
    const game = gameIn();
    const data = game.ship.roomAt(game.ship.room("r2").id).data;
    data.bodies = [{ glyph: "†", name: "crew body" }];
    // Whatever else a card left behind must not reach the screen as a crash.
    // A record that *is* an object is a thing in that compartment and wears its
    // bucket's mark even with nothing else to say — bodies and crates carry no
    // `glyph` of their own at all, and dropping them left the deck bare while
    // the action list offered `search the body` (the owner, 10.09). Only what
    // is not an object at all falls out.
    data.items = [null, 42, {}, { glyph: "" }, { glyph: "*", label: "the package" }];

    expect(thingsIn(game, game.ship.room("r2").id).map((t) => t.glyph)).toEqual([
      "†",
      "*",
      "*",
      "*",
    ]);
    expect(thingsIn(game, game.ship.room("r2").id)[3]!.name).toBe("the package");
    expect(roomOf(game, "r2").glyphs).toBe("† * * *");
  });

  it("marks a body and a crate the catalogue stored without a glyph", () => {
    // The bug the owner saw: `{id, searched}` and `{id, kind}` are what the
    // rules store, and neither carries a mark, so nothing was drawn.
    const game = gameIn();
    const data = game.ship.roomAt(game.ship.room("r2").id).data;
    data.bodies = [{ id: 1, searched: false }, { id: 2, searched: true }];
    data.crates = [{ id: 3, kind: "cargo" }, { id: 4, kind: "contraband" }];
    data.items = [{ id: 5, kind: "console" }];

    const things = thingsIn(game, game.ship.room("r2").id);
    expect(things.map((t) => t.glyph)).toEqual(["†", "†", "X", "X", "*"]);
    expect(things.every((t) => t.name.length > 0)).toBe(true);
    expect(things[1]!.name).not.toBe(things[0]!.name);
    expect(things[3]!.name).not.toBe(things[2]!.name);
  });
});

describe("the line under the schematic", () => {
  /**
   * Standing in the DOCK of their own tug, the owner's first playtest read
   * `DERELICT · 4 rooms · 4 seen` and asked where the tug was. The picture was
   * right; the caption named somebody else's ship
   * (docs/tasks/G40-tug-clarity.md, 1).
   */
  it("says whose ship this is when the ship is the tug", () => {
    const game = newGame(4);
    expect(schematicInputOf(game).shipLine).toBe(
      `${tugCallsign(4)} · your tug · docked to ${derelictName(currentDerelict(game).spec)}`,
    );
    expect(TUG_CALLSIGNS).toContain(tugCallsign(4));

    // Aboard a hull the caption is the hull's, and says nothing about a tug.
    expect(undock(game).ok).toBe(true);
    const line = schematicInputOf(game).shipLine;
    expect(line).not.toContain("your tug");
    expect(line).toContain(derelictName(currentDerelict(game).spec));
    expect(line).toContain(`${game.ship.rooms.length} rooms`);
  });

  it("names the ship, its size and how much of it is known", () => {
    const game = gameIn();
    game.ship.room("r3").explored = true;
    game.ship.room("r4").scanned = true;
    expect(schematicInputOf(game).shipLine).toBe("DERELICT · 4 rooms · 3 seen · 1 scanned");

    game.currentShip.data.name = "KESTREL";
    game.currentShip.data.type = "freighter";
    expect(schematicInputOf(game).shipLine).toBe("KESTREL · freighter · 4 rooms · 3 seen · 1 scanned");
  });

  /**
   * The caption used to count `room.explored` while the picture also fills in
   * every compartment in sight through an open door, so a player looking at
   * two named boxes was told `1 seen` — 21 599 screens of a 98 447-screen
   * sweep (docs/tasks/G55-playtest-findings.md, 10). Both numbers are read off
   * the boxes now, so the caption cannot disagree with the drawing it sits
   * under.
   */
  it("counts what the picture draws, not what the drone has stood in", () => {
    // In the entry compartment, one open door away from a room never entered.
    const game = gameIn("r1");

    const input = schematicInputOf(game);
    const drawn = input.rooms.filter((r) => r.state !== "unknown" && r.state !== "scanned");
    expect(drawn.length, "sight through the open door was not drawn").toBeGreaterThan(1);
    expect(input.shipLine).toContain(`${drawn.length} seen`);
    expect(game.ship.rooms.filter((r) => r.explored).length).toBeLessThan(drawn.length);
  });
});

/**
 * The banner across the top of the schematic (docs/tasks/G40-tug-clarity.md, 9).
 *
 * "буксир и данж путаются, давай хоть там текстом" — the owner, after two
 * playtests in which the only thing telling home from a dead freighter apart
 * was the shape of four boxes.
 */
describe("the banner over the schematic", () => {
  it("names the tug at home and the hull aboard, and says which is which", () => {
    const game = newGame(4);
    const callsign = flavourCallsign(currentDerelict(game).flavour);
    const hull = derelictName(currentDerelict(game).spec);
    expect(bannerLine(game)).toBe(`YOUR TUG «${tugCallsign(4)}» · docked to ${callsign} (${hull})`);

    expect(undock(game).ok).toBe(true);
    const aboard = bannerLine(game);
    expect(aboard.startsWith(`DERELICT «${callsign}»`)).toBe(true);
    expect(aboard).toContain(hull);
    expect(aboard).toContain(`${game.ship.rooms.length} rooms`);
    // The gauge, in the word the tug's own panel already uses for it.
    expect(aboard.endsWith("quiet")).toBe(true);
  });

  it("says what the window is showing when the DOCK is showing the derelict", () => {
    const game = newGame(4);
    expect(undock(game).ok).toBe(true);
    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);

    expect(schematicInputOf(game).rooms).toHaveLength(game.ships.get("1")!.ship.rooms.length);
    expect(bannerLine(game).startsWith("DERELICT ahead: ")).toBe(true);
  });

  it("fits its row, and that row is one the schematic never draws in", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const game = newGame(seed);
      expect(bannerLine(game).length, `tug seed ${seed}`).toBeLessThanOrEqual(BANNER_WIDTH);
      // Boxes start on row one (design-doc.md, "Экран": `y = 1 + 5·row`), so
      // row zero is free for the banner up to the hull line down the edge.
      const home = schematic(schematicInputOf(game)).lines[0]!.text;
      expect(home.slice(0, BANNER_WIDTH).trim(), `tug seed ${seed}`).toBe("");

      expect(undock(game).ok).toBe(true);
      expect(bannerLine(game).length, `hull seed ${seed}`).toBeLessThanOrEqual(BANNER_WIDTH);
      const hull = schematic(schematicInputOf(game)).lines[0]!.text;
      expect(hull.slice(0, BANNER_WIDTH).trim(), `hull seed ${seed}`).toBe("");
    }
  });
});

describe("machines in a box", () => {
  it("draws them ahead of the scrap and says how many columns they take", () => {
    const game = gameIn();
    addWreck(game, game.ship.room("r2").id, "welder", 2);
    put(game, "r2", "security-unit");

    const box = roomOf(game, "r2");
    expect(box.glyphs.startsWith("S ")).toBe(true);
    expect(box.hostiles).toBe(1);
  });

  it("claims no columns in a compartment nobody is looking at", () => {
    // Wreckage stays where it fell and machines do not, so a remembered box
    // draws no machine — and must claim no columns of red for one either.
    const game = gameIn();
    put(game, "r4", "security-unit");
    game.ship.room("r4").explored = true;
    game.refreshSight();

    expect(game.visible.has(game.ship.room("r4").id)).toBe(false);
    expect(roomOf(game, "r4").hostiles).toBeUndefined();
  });
});

describe("which port a door leaves by", () => {
  it("gives two doors on one side different ports, so the wires cannot cross", () => {
    const game = gameIn("r1");
    const { doors } = schematicInputOf(game);
    const d1 = doors.find((d) => d.label === "d1")!;
    const d2 = doors.find((d) => d.label === "d2")!;
    expect(d1.a).toBe(game.ship.room("r1").id);
    expect(d1.portA).not.toBe(d2.portA);
  });

  it("leaves the airlock out of the edge list: the tug box carries it", () => {
    expect(schematicInputOf(gameIn()).doors.map((d) => d.label)).toEqual(["d1", "d2", "d3"]);
  });
});

describe("what comes out is what the schematic can draw", () => {
  it("fills the picture on the ship the game actually starts on", () => {
    const game = newGame(11);
    const { lines, omitted } = schematic(schematicInputOf(game));

    expect(lines).toHaveLength(LAYOUT.mapHeight);
    for (const line of lines) expect(line.text.length).toBeLessThanOrEqual(LAYOUT.mapWidth);

    // The compartment the drone is standing in is always on the picture.
    const here = game.roomOf(game.player).label;
    expect(lines.some((l) => l.text.includes(here))).toBe(true);
    // Every door the picture had to drop is still one the panel can list.
    const labels = game.ship.doors.map((d) => d.label);
    for (const label of omitted) expect(labels).toContain(label);
  });

  it("keeps drawing it over two hundred sorties", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const game = newGame(seed);
      const { lines } = schematic(schematicInputOf(game));
      expect(lines, `seed ${seed}`).toHaveLength(LAYOUT.mapHeight);
      for (const line of lines) expect(line.text.length, `seed ${seed}`).toBeLessThanOrEqual(LAYOUT.mapWidth);
    }
  });
});

describe("a system already up", () => {
  it("is ticked on the map instead of asking to be worked on", () => {
    // `+` means "there is work to do here". A hull whose three systems were all
    // online still drew three of them — the map telling a player to go and do
    // what they have already done. The owner, standing on a raised drive with
    // `ALL THREE ONLINE` on the panel: «почему тут +?».
    const game = newGame(4);
    undock(game);
    const room = game.ship.rooms.find((r) => Array.isArray(r.data.systems) && r.data.systems.length > 0);
    expect(room, "no hull has a system in it").toBeDefined();
    const systems = room!.data.systems as Array<{ online: boolean }>;

    game.player.room = room!.id;
    game.refreshSight();
    const glyphs = (): string =>
      schematicInputOf(game).rooms.find((r) => r.id === room!.id)!.glyphs;

    expect(glyphs(), "a system to raise is a plus").toContain("+");
    systems[0]!.online = true;
    expect(glyphs(), "a system already up is a tick").toContain("✓");
    expect(glyphs()).not.toContain("+");
  });
});
