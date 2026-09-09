import { describe, it, expect } from "vitest";
import { RoomGame, type RoomGameConfig } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import {
  TUG_GLYPH,
  type DoorState,
  type RoomState,
  type SchematicDoor,
  type SchematicInput,
  type SchematicRoom,
} from "../src/ui/schematic.js";
import { bannerLine, schematicInputOf } from "../src/ui/schematic-input.js";
import { svgOf } from "../src/ui/web/schematic-svg.js";

/**
 * The graphic half of the screen, tested the way the terminal half is: as the
 * text it produces. `svgOf` is a pure function of the same `SchematicInput` the
 * ASCII drawing takes, so every fixture here is hand-written and no generator
 * has to run first.
 *
 * What is checked is what a player would notice if it broke — a compartment
 * missing, a door with no label, the room they are standing in drawn like every
 * other one — plus the one failure a picture cannot survive: an unescaped glyph
 * taking the whole drawing down with it.
 */

const room = (
  id: number,
  name: string,
  col: number,
  row: number,
  state: RoomState,
  glyphs = "",
  hostiles?: number,
): SchematicRoom => {
  const out: SchematicRoom = { id, label: `r${id}`, name, col, row, state, glyphs };
  if (hostiles !== undefined) out.hostiles = hostiles;
  return out;
};

const door = (
  label: string,
  a: number,
  b: number,
  state: DoorState,
  portA: 0 | 1 = 0,
  portB: 0 | 1 = 0,
): SchematicDoor => ({ id: Number(label.replace(/\D/g, "")) || 0, label, a, b, state, portA, portB });

/** Four compartments, one of each interesting state, and a door of each state. */
const SHIP: SchematicInput = {
  rooms: [
    room(1, "DOCKING", 0, 1, "explored", "a1"),
    room(2, "CARGO", 1, 1, "current", "S x % †", 3),
    room(3, "CORRIDR", 1, 2, "visible"),
    room(4, "STORAGE", 2, 0, "unknown"),
    room(5, "HAB", 2, 2, "scanned", "†"),
  ],
  doors: [
    door("d1", 1, 2, "open"),
    door("d2", 2, 3, "closed"),
    door("d3", 2, 4, "locked", 1, 0),
    door("d4", 3, 5, "sealed"),
  ],
  tug: { at: 1, label: "a1" },
  shipLine: "KESTREL · freighter · 5 rooms · 3 seen",
};

function count(svg: string, needle: string): number {
  return svg.split(needle).length - 1;
}

describe("the SVG schematic", () => {
  const svg = svgOf(SHIP, "DERELICT «KESTREL» · freighter · 5 rooms · quiet");

  it("is one well-formed element with a viewBox", () => {
    expect(svg.startsWith('<svg class="schematic" viewBox="0 0 ')).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(count(svg, "<svg")).toBe(1);
    expect(count(svg, "<g")).toBe(count(svg, "</g>"));
  });

  it("draws exactly one box per compartment", () => {
    expect(count(svg, '<rect class="room-box"')).toBe(SHIP.rooms.length);
    for (const r of SHIP.rooms) expect(svg, r.label).toContain(`>${r.label}</text>`);
  });

  it("names the compartments the drone knows and hides the one it does not", () => {
    for (const r of SHIP.rooms) {
      if (r.state === "unknown") expect(svg, r.name).not.toContain(`>${r.name}<`);
      else expect(svg, r.name).toContain(`>${r.name}</text>`);
    }
    expect(svg).toContain(">····</text>");
  });

  it("marks the compartment the drone is standing in, and only that one", () => {
    expect(count(svg, 'class="room is-current"')).toBe(1);
    expect(count(svg, 'class="room is-unknown"')).toBe(1);
    expect(count(svg, 'class="room is-visible"')).toBe(1);
    expect(count(svg, 'class="room is-scanned"')).toBe(1);
    expect(count(svg, 'class="room is-explored"')).toBe(1);
  });

  it("labels every door it draws, in the colour of its state", () => {
    for (const d of SHIP.doors) {
      expect(svg, d.label).toContain(`>${d.label}</text>`);
      expect(svg, d.label).toContain(`<g class="door is-${d.state}">`);
      expect(svg, d.label).toContain(`<path class="door-wire is-${d.state}"`);
    }
    expect(count(svg, '<rect class="door-tag"')).toBe(SHIP.doors.length);
  });

  it("paints the machines and nothing behind them", () => {
    // CARGO holds `S x % †` with two machines: three terminal columns, so the
    // first two glyphs are trouble and the scrap behind them is not.
    const cargo = svgOf({ rooms: [room(2, "CARGO", 0, 0, "current", "S x % †", 3)], doors: [], shipLine: "" });
    expect(count(cargo, 'class="glyph hostile"')).toBe(2);
    expect(count(cargo, 'class="glyph"')).toBe(2);
    // One box on the whole ship is holding machines, and it says so twice: in
    // the colour of its glyphs, and on the box itself.
    expect(count(svg, 'class="glyph hostile"')).toBe(2);
    expect(count(svg, '<rect class="threat-cap"')).toBe(1);
    // The cap carries the count, because a digit is true in three languages
    // and this drawing has no table to look a word up in.
    expect(svg).toContain('class="threat-count"');
  });

  it("shows nothing at all inside a compartment nobody has seen", () => {
    const dark = svgOf({ ...SHIP, rooms: [room(9, "SECRET", 0, 0, "unknown", "E %", 1)], doors: [] });
    expect(dark).not.toContain("class=\"glyph");
    expect(dark).not.toContain("alarm");
    expect(dark).toContain(">····</text>");
  });

  it("hangs the tug off the airlock, to the left of its compartment", () => {
    expect(svg).toContain('<g class="tug">');
    // A mark rather than a word, and the same one the terminal draws: three
    // columns there is no room for `буксир` (`ui/schematic.ts`, `drawTug`).
    expect(svg).toContain(`>${TUG_GLYPH}</text>`);
    expect(svg).toContain(">a1</text>");
    // Left of DOCKING, which is the leftmost column: the box needs the room.
    const x = Number(/<rect class="tug-box" x="(-?[\d.]+)"/.exec(svg)?.[1]);
    expect(x).toBeGreaterThanOrEqual(0);
  });

  it("leaves the tug out when there is no airlock to hang it on", () => {
    const noTug = svgOf({ rooms: SHIP.rooms, doors: SHIP.doors, shipLine: "" });
    expect(noTug).not.toContain('class="tug"');
    // A tug docked at a compartment that is not on the drawing is not drawn
    // either, and does not throw on the way to not being drawn.
    expect(svgOf({ ...SHIP, tug: { at: 99, label: "a1" } })).not.toContain('class="tug"');
  });

  it("writes the banner and the caption, and skips both when they are empty", () => {
    expect(svg).toContain('class="banner"');
    expect(svg).toContain(SHIP.shipLine);
    const bare = svgOf({ rooms: SHIP.rooms, doors: [], shipLine: "" });
    expect(bare).not.toContain('class="banner"');
    expect(bare).not.toContain('class="ship-line"');
  });

  it("draws the hull down the right edge", () => {
    expect(count(svg, '<path class="hull"')).toBe(1);
  });

  it("grows with the ship rather than cropping it", () => {
    const wide = svgOf({ ...SHIP, rooms: [...SHIP.rooms, room(6, "ENGINE", 7, 4, "explored")] });
    const box = (s: string): number[] => (/viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(s) ?? []).slice(1).map(Number);
    const [w, h] = box(svg);
    const [w2, h2] = box(wide);
    expect(w2!).toBeGreaterThan(w!);
    expect(h2!).toBeGreaterThan(h!);
    // Every compartment is drawn: unlike the terminal, this view has no window.
    expect(count(wide, '<rect class="room-box"')).toBe(6);
  });

  it("draws a door whose two rooms share a column, and skips one that leads nowhere", () => {
    // d4 joins CORRIDR and HAB, which are both in column 2 of the fixture.
    expect(svg).toContain('<g class="door is-sealed">');
    const dangling = svgOf({ ...SHIP, doors: [door("d9", 2, 404, "open"), door("d8", 3, 3, "open")] });
    expect(dangling).not.toContain(">d9</text>");
    expect(dangling).not.toContain(">d8</text>");
    expect(count(dangling, '<rect class="door-tag"')).toBe(0);
  });

  it("escapes everything that came out of a content card", () => {
    const nasty = svgOf(
      {
        rooms: [room(1, "A&B", 0, 0, "explored", '& " <')],
        doors: [door("<d1>", 1, 1, "open")],
        shipLine: 'HULL & "SON"',
      },
      "<banner> & co",
    );
    expect(nasty).toContain("A&amp;B");
    expect(nasty).toContain("&lt;banner&gt; &amp; co");
    expect(nasty).toContain("&quot;");
    // Nothing raw survives outside a tag: no bare `<` other than the markup's own.
    expect(nasty.replace(/<\/?[a-z][^>]*>/g, "")).not.toContain("<");
  });
});

/**
 * The same drawing over a real run rather than a fixture: proof that what
 * `schematicInputOf` hands the terminal is what this view can draw, with no
 * second adapter in between.
 */
describe("the SVG schematic over a real ship", () => {
  const SHIP_TEXT = `
    TUG -a1- r1
    r1 -d1- r2
    r1 -(d2)- r3
    r2 -[d3:k1]- r4
    r1: docking
    r2: cargo
    r3: corridor
    r4: storage
  `;

  function game(): RoomGame {
    const config: Omit<RoomGameConfig, "seed"> = {
      ...GAME_CONFIG,
      content: { ...SALVOR, monsterChance: () => 0 },
      firstShip: () => shipFromText(SHIP_TEXT).ship,
      firstShipId: "1",
    };
    const g = new RoomGame({ ...config, seed: 7 });
    g.player.room = g.ship.room("r2").id;
    g.refreshSight();
    return g;
  }

  it("draws every compartment and every door of the hull", () => {
    const g = game();
    const input = schematicInputOf(g);
    const svg = svgOf(input, bannerLine(g));
    expect(count(svg, '<rect class="room-box"')).toBe(g.ship.rooms.length);
    for (const d of g.ship.doors.filter((d) => d.a !== d.b && d.state !== "airlock")) {
      expect(svg, d.label).toContain(`>${d.label}</text>`);
    }
    expect(count(svg, 'class="room is-current"')).toBe(1);
    expect(svg).toContain(bannerLine(g));
  });
});
