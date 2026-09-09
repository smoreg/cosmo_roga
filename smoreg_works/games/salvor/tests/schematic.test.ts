import { describe, it, expect } from "vitest";
import { Rng, portsOf, type RoomId, type Ship } from "@jamrog/engine";
import { DERELICTS, derelictShip } from "../src/content/derelicts.js";
import {
  schematic,
  schematicLines,
  type Schematic,
  type DoorState,
  type RoomState,
  type SchematicDoor,
  type SchematicInput,
  type SchematicRoom,
} from "../src/ui/schematic.js";
import { LAYOUT, THEME } from "../src/ui/theme.js";

/**
 * The schematic is the whole main screen, so it is tested as text: exactly what
 * a player would read off the terminal. The reference is the mock-up in
 * design-doc.md ("Экран") — reproduced here byte for byte, because the geometry
 * in that document is a specification and every later task reads it as one.
 *
 * The rest of the tests are the invariants the renderer may never break, and
 * they are the reason `schematicLines` is a pure function: 34 lines that always
 * fit, a current room that is always on screen, an edge that is either wired or
 * named as a reference at both its ends, and a picture that does not reshuffle
 * itself between two turns that discovered nothing (G49).
 */

const WIDTH = LAYOUT.mapWidth;
const HEIGHT = LAYOUT.mapHeight;

// --------------------------------------------------------------- the mock-up

const room = (
  id: number,
  name: string,
  col: number,
  row: number,
  state: RoomState,
  glyphs = "",
): SchematicRoom => ({ id, label: `r${id}`, name, col, row, state, glyphs });

const door = (
  label: string,
  a: number,
  b: number,
  state: DoorState,
  portA: 0 | 1 = 0,
  portB: 0 | 1 = 0,
): SchematicDoor => ({ id: Number(label.replace(/\D/g, "")) || 0, label, a, b, state, portA, portB });

/**
 * KESTREL as the design doc draws it: eight rooms in the window, two more
 * behind the breaks on the right, the tug docked at r1 and the drone standing
 * in the cargo bay.
 */
const KESTREL: SchematicInput = {
  rooms: [
    room(1, "DOCKING", 0, 2, "explored", "a1"),
    room(2, "CARGO", 1, 1, "current", "S x % †"),
    room(3, "CORRIDR", 1, 3, "explored"),
    room(4, "STORAGE", 2, 0, "explored", 'X "'),
    room(5, "HAB", 2, 2, "explored", "† †"),
    room(6, "", 2, 4, "unknown"),
    room(7, "ENGINE", 3, 1, "explored", "E m"),
    room(8, "", 3, 3, "unknown"),
    room(9, "", 4, 1, "unknown"),
    room(10, "", 4, 3, "unknown"),
  ],
  doors: [
    door("d1", 1, 2, "open", 0, 1),
    door("d2", 1, 3, "closed", 1, 0),
    door("d3", 2, 4, "locked", 0, 1),
    door("d4", 2, 5, "open", 1, 0),
    door("d5", 3, 6, "closed", 1, 0),
    door("d6", 2, 3, "sealed"),
    door("d7", 5, 7, "open", 0, 1),
    door("d8", 5, 8, "closed", 1, 0),
    door("d9", 4, 7, "broken", 1, 0),
    door("d10", 7, 9, "open", 0, 0),
    door("d11", 8, 10, "locked", 0, 0),
  ],
  tug: { at: 1, label: "a1" },
  shipLine: "KESTREL · freighter · 12 rooms · 5 seen · 2 scanned",
};

/**
 * design-doc.md, columns 0..64 of the mock-up. Two places differ from the
 * document: the right port of r8 is `├` here and `┤` there — that box has a
 * break leaving to the right, and every other box in the mock-up draws a right
 * port as `├`, so the document has a slip — and the tug is `⌂` rather than the
 * word `TUG`, which is deliberate (`ui/schematic.ts`, `drawTug`).
 */
const KESTREL_LINES = [
  "                                                                ┃",
  "                                   ┌───────┐                    ┃",
  "                                   │STORAGE│                    ┃",
  "                                ┌──┤X \"  r4├·d9·                ┃",
  "                                │  └───────┘ │                  ┃",
  "                                │            │                  ┃",
  "                      ╔═══════╗ │            │  ┌───────┐       ┃",
  "                      ║CARGO  ╠[d3]          └──┤ENGINE ├─d10─» ┃",
  "                   ┌──╣S x % †╠─d4─          ┌──┤E m  r7│       ┃",
  "                   │  ╚═══╦═══╝ │            │  └───────┘       ┃",
  "                   │      │     │            │                  ┃",
  "╭───╮    ┌───────┐ │      │     │  ┌───────┐ │                  ┃",
  "│ ⌂ ├(a1)┤DOCKING├─d1─  #d6#    └──┤HAB    ├─d7─                ┃",
  "╰───╯    │a1   r1├(d2)    │        │† †  r5├(d8)                ┃",
  "         └───────┘ │      │        └───────┘ │                  ┃",
  "                   │      │                  │                  ┃",
  "                   │  ┌───┴───┐              │  ┌╌╌╌╌╌╌╌┐       ┃",
  "                   └──┤CORRIDR│              └──┤ ····  ├[d11]» ┃",
  "                      │     r3├(d5)             ┆     r8┆       ┃",
  "                      └───────┘ │               └╌╌╌╌╌╌╌┘       ┃",
  "                                │                               ┃",
  "                                │  ┌╌╌╌╌╌╌╌┐                    ┃",
  "                                └──┤ ····  ┆                    ┃",
  "                                   ┆     r6┆                    ┃",
  "                                   └╌╌╌╌╌╌╌┘                    ┃",
  "                                                                ┃",
  "                                                                ┃",
  "                                                                ┃",
  "                                                                ┃",
  "                                                                ┃",
  "                                                                ┃",
  "                                                       » 2 rooms┃",
  "                                                                ┃",
  " KESTREL · freighter · 12 rooms · 5 seen · 2 scanned            ┃",
];

const text = (input: SchematicInput, viewport?: Parameters<typeof schematicLines>[1]): string[] =>
  schematicLines(input, viewport).map((l) => l.text);

describe("the design doc's ship", () => {
  it("is reproduced line for line", () => {
    expect(text(KESTREL)).toEqual(KESTREL_LINES);
  });

  it("draws every door of the ship", () => {
    expect(schematic(KESTREL).omitted).toEqual([]);
    const whole = text(KESTREL).join("\n");
    for (const d of KESTREL.doors) expect(whole).toContain(d.label);
  });

  it("puts a door's own label on the schematic, brackets aside", () => {
    const lines = text(KESTREL);
    expect(lines[7]).toContain("[d3]");
    expect(lines[8]).toContain("─d4─");
    expect(lines[12]).toContain("#d6#");
    expect(lines[13]).toContain("(d8)");
    expect(lines[3]).toContain("·d9·");
    expect(lines[12]).toContain("(a1)");
  });
});

// ------------------------------------------------------------------ the frame

describe("the frame", () => {
  it("is always 34 lines that fit the map width", () => {
    for (const lines of [text(KESTREL), text({ rooms: [], doors: [], shipLine: "" })]) {
      expect(lines).toHaveLength(HEIGHT);
      for (const line of lines) expect([...line].length).toBeLessThanOrEqual(WIDTH);
    }
  });

  it("draws the hull down the right edge of every line", () => {
    for (const line of text(KESTREL)) expect([...line][64]).toBe("┃");
  });

  it("puts the ship line last and the off-screen count above it", () => {
    const lines = text(KESTREL);
    expect(lines[33]).toContain(KESTREL.shipLine);
    expect(lines[31]).toContain("» 2 rooms");
  });

  it("counts a single hidden room in the singular", () => {
    const rooms = [room(1, "HERE", 0, 0, "current"), room(2, "FAR", 5, 0, "unknown")];
    expect(text({ rooms, doors: [], shipLine: "" })[31]).toContain("» 1 room");
  });
});

// ---------------------------------------------------------------- the window

describe("the window", () => {
  /** A room per column so the window has somewhere to scroll to. */
  const corridor = (current: number): SchematicInput => ({
    rooms: Array.from({ length: 7 }, (_, i) =>
      room(i + 1, `R${i + 1}`, i, 2, i === current ? "current" : "explored"),
    ),
    doors: Array.from({ length: 6 }, (_, i) => door(`d${i + 1}`, i + 1, i + 2, "open", 1, 1)),
    shipLine: "",
  });

  /** Whether a compartment has a box on the picture, rather than a mention. */
  const boxed = (lines: readonly string[], label: string): boolean =>
    lines.some((l) => new RegExp(`${label}[│║┆├┤╠╣]`).test(l));

  it("keeps the current room on screen whichever column it is in", () => {
    for (let col = 0; col < 7; col++) {
      expect(boxed(text(corridor(col)), `r${col + 1}`)).toBe(true);
    }
  });

  it("stays put while the drone is in the first columns", () => {
    expect(text(corridor(0))[12]).toContain("R1");
    expect(text(corridor(1))[12]).toContain("R1");
  });

  it("scrolls once the drone is deeper than the fourth column", () => {
    const lines = text(corridor(4));
    expect(boxed(lines, "r1")).toBe(false);
    expect(lines[31]).toContain("«");
  });

  it("marks a door to a room left of the window with «", () => {
    const lines = text(corridor(5));
    expect(lines.some((l) => l.includes("«"))).toBe(true);
  });

  /**
   * How much ship is behind the left edge, said in the same words as how much
   * is ahead of the right one. The picture used to count both into `» N rooms`,
   * so a window scrolled three columns deep claimed every compartment behind
   * the drone was somewhere off to the right.
   */
  /**
   * "не ясна карта, что за 2 отсека" — the owner, reading `» 2 rooms` and
   * getting no answer out of it. The counter names what is out there, nearest
   * first, and only falls back to a bare count when nothing out there has been
   * walked into and so has no name to give.
   */
  it("names the compartments behind the left edge, nearest first", () => {
    const line = text(corridor(5))[31]!;
    expect(line).toMatch(/^« R3 · R2 · R1/);
    expect(line).not.toContain("»");
  });

  it("falls back to a count when nothing out there has been walked into", () => {
    const rooms = [room(1, "HERE", 0, 0, "current"), room(2, "FAR", 5, 0, "unknown")];
    expect(text({ rooms, doors: [], shipLine: "" })[31]).toContain("» 1 room");
  });

  it("says ···· for the ones without a name and counts the overflow", () => {
    const rooms = [
      room(1, "HERE", 0, 0, "current"),
      room(2, "DEEP", 5, 0, "explored"),
      room(3, "", 5, 1, "unknown"),
    ];
    expect(text({ rooms, doors: [], shipLine: "" })[31]).toContain("» DEEP · ····");
  });

  it("names each side separately when the window has ship on both", () => {
    const wide: SchematicInput = {
      rooms: [
        room(1, "BACK", 0, 0, "explored"),
        room(2, "HERE", 4, 0, "current"),
        room(3, "AHEAD", 8, 0, "explored"),
      ],
      doors: [],
      shipLine: "",
    };
    const line = text(wide)[31]!;
    expect(line).toMatch(/^« BACK/);
    expect(line).toContain("» AHEAD");
  });

  /** Four columns at a time: the window is a block, not a follow-cam. */
  it("holds the window still until the drone leaves its block of columns", () => {
    for (const col of [0, 1, 2, 3]) expect(boxed(text(corridor(col)), "r1")).toBe(true);
    expect(boxed(text(corridor(4)), "r1")).toBe(false);
  });

  it("takes an explicit column, so a test can pin the window", () => {
    const lines = text(corridor(0), { col: 3 });
    expect(boxed(lines, "r4")).toBe(true);
    expect(boxed(lines, "r1")).toBe(false);
  });
});

// ----------------------------------------------------------------- the ports

describe("two doors between the same pair of columns", () => {
  const pair = (portA: 0 | 1, portB: 0 | 1): SchematicInput => ({
    rooms: [room(1, "LEFT", 0, 0, "current"), room(2, "RIGHT", 1, 0, "explored")],
    doors: [door("d1", 1, 2, "open", 0, 0), door("d2", 1, 2, "closed", portA, portB)],
    shipLine: "",
  });

  it("draws both when they use different ports", () => {
    const drawn = schematic(pair(1, 1));
    expect(drawn.omitted).toEqual([]);
    const whole = drawn.lines.map((l) => l.text).join("\n");
    expect(whole).toContain("─d1─");
    expect(whole).toContain("(d2)");
  });

  it("wires one and references the other when they want the same port", () => {
    const drawn = schematic(pair(0, 0));
    expect(drawn.omitted).toEqual([]);
    expect(drawn.referenced).toEqual(["d2"]);
    const whole = drawn.lines.map((l) => l.text).join("\n");
    expect(whole).toContain("─d1─");
    expect(whole).not.toContain("(d2)");
    // The second door has no wire, so it says where it goes instead. One
    // reference, not two: the two boxes are neighbours and share the gutter it
    // is written in, so it stands between them the way the wire would have.
    expect(whole).toContain("→r2");
  });
});

// ------------------------------------------------------------- the references

/**
 * The whole of G49: an edge no wire could carry is still on the picture, at
 * both of its ends, naming the compartment on the other side.
 *
 * The owner's fourth playtest read a hull as two unconnected halves — "твой
 * граф не связан" — because the one door joining them was in `omitted` and
 * nowhere else. A drawing that leaves a walk the drone has already made off the
 * paper is worse than a crowded one.
 */
describe("a door the layout cannot wire", () => {
  it("is referenced at both ends when its rooms are two columns apart", () => {
    const far: SchematicInput = {
      rooms: [room(1, "A", 0, 0, "current"), room(2, "B", 2, 0, "explored")],
      doors: [door("d1", 1, 2, "open")],
      shipLine: "",
    };
    const drawn = schematic(far);
    expect(drawn.omitted).toEqual([]);
    expect(drawn.referenced).toEqual(["d1"]);
    const whole = drawn.lines.map((l) => l.text).join("\n");
    expect(whole).toContain("→r2");
    expect(whole).toContain("r1←");
  });

  it("is referenced above and below for a same-column door with a room between", () => {
    const stacked: SchematicInput = {
      rooms: [
        room(1, "TOP", 0, 0, "current"),
        room(2, "MID", 0, 1, "explored"),
        room(3, "LOW", 0, 2, "explored"),
      ],
      doors: [door("d1", 1, 3, "open")],
      shipLine: "",
    };
    const drawn = schematic(stacked);
    expect(drawn.omitted).toEqual([]);
    expect(drawn.referenced).toEqual(["d1"]);
    const whole = drawn.lines.map((l) => l.text).join("\n");
    expect(whole).toContain("↓r3");
    expect(whole).toContain("↑r1");
  });

  it("takes the colour of the door's own state", () => {
    const far: SchematicInput = {
      rooms: [room(1, "A", 0, 0, "current"), room(2, "B", 2, 0, "explored")],
      doors: [door("d1", 1, 2, "locked")],
      shipLine: "",
    };
    const lines = schematic(far).lines;
    const row = lines.find((l) => l.text.includes("→r2"))!;
    const at = row.text.indexOf("→");
    expect(row.spans?.some((s) => s.from <= at && s.to > at && s.fg === THEME.door.locked)).toBe(true);
  });
});

// -------------------------------------------------------------- any input at all

describe("any input at all", () => {
  const STATES: RoomState[] = ["unknown", "scanned", "explored", "visible", "current"];
  const DOORS: DoorState[] = ["open", "closed", "locked", "sealed", "broken", "airlock"];

  /** A ship of random shape: overlapping cells, absurd doors, empty names. */
  function noise(rng: Rng): SchematicInput {
    const count = rng.int(1, 25);
    const rooms = Array.from({ length: count }, (_, i) =>
      room(
        i + 1,
        ["", "CORE", "ENGINEERING", "HAB", "A"][rng.int(0, 4)]!,
        rng.int(0, 6),
        rng.int(0, 5),
        STATES[rng.int(0, STATES.length - 1)]!,
        ["", "S x % †", "†", "E m O T", "%%%%%%%%%%"][rng.int(0, 4)]!,
      ),
    );
    const doors = Array.from({ length: rng.int(0, 30) }, (_, i) =>
      door(
        `d${i + 1}`,
        rng.int(1, count),
        rng.int(1, count),
        DOORS[rng.int(0, DOORS.length - 1)]!,
        rng.int(0, 1) as 0 | 1,
        rng.int(0, 1) as 0 | 1,
      ),
    );
    return { rooms, doors, tug: { at: rng.int(1, count) }, shipLine: "X".repeat(rng.int(0, 90)) };
  }

  it("still draws 34 lines of at most 66 columns", () => {
    for (let seed = 0; seed < 400; seed++) {
      const input = noise(new Rng(seed));
      const lines = schematicLines(input);
      expect(lines).toHaveLength(HEIGHT);
      for (const line of lines) {
        expect([...line.text].length).toBeLessThanOrEqual(WIDTH);
        expect([...line.text][64]).toBe("┃");
      }
    }
  });

  it("keeps the current room on screen even when another wants its cell", () => {
    for (let seed = 0; seed < 400; seed++) {
      const input = noise(new Rng(seed));
      if (!input.rooms.some((r) => r.state === "current")) continue;
      const whole = schematicLines(input)
        .map((l) => l.text)
        .join("\n");
      expect(whole).toContain("╔");
    }
  });

  it("never colours a span outside its own line", () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const line of schematicLines(noise(new Rng(seed)))) {
        for (const span of line.spans ?? []) {
          expect(span.from).toBeGreaterThanOrEqual(0);
          expect(span.to).toBeLessThanOrEqual([...line.text].length);
          expect(span.from).toBeLessThan(span.to);
        }
      }
    }
  });

  /**
   * The panel's contract: the current room is always drawn, so every door out
   * of it is wired, referenced, or in `omitted`. Nothing the player can act on
   * this turn is allowed to fall between the three.
   */
  it("wires, references or names in omitted every door of the current room", () => {
    for (let seed = 0; seed < 400; seed++) {
      const input = noise(new Rng(seed));
      const here = input.rooms.find((r) => r.state === "current");
      if (!here) continue;
      const drawn = schematic(input);
      const whole = drawn.lines.map((l) => l.text).join("\n");
      for (const d of input.doors) {
        if (d.a !== here.id && d.b !== here.id) continue;
        if (d.a === d.b) continue;
        if (drawn.omitted.includes(d.label)) continue;
        if (drawn.referenced.includes(d.label)) continue;
        expect(whole).toMatch(new RegExp(`${d.label}(?![0-9])`));
      }
    }
  });

  it("never names one door in both lists", () => {
    for (let seed = 0; seed < 400; seed++) {
      const drawn = schematic(noise(new Rng(seed)));
      for (const label of drawn.referenced) expect(drawn.omitted).not.toContain(label);
    }
  });
});

// -------------------------------------------------------- ships off the line

/**
 * The same three promises against the ships the game actually generates, which
 * is where the defect was found: hand-written fixtures are sparse and a
 * generated hull is not.
 *
 * Before G49 this ran at four silent edges a frame, and in ninety-six per cent
 * of frames one of them was the only thing joining two halves of the drawing —
 * which is exactly what the owner saw and called a map that is not connected.
 */
describe("a generated hull", () => {
  const SEEDS = 30;

  const inputOf = (ship: Ship, here: RoomId): SchematicInput => {
    const ports = new Map<string, 0 | 1>();
    for (const r of ship.rooms) {
      for (const [, uses] of portsOf(ship, r.id)) {
        [...uses]
          .sort((a, b) => a.dy - b.dy || a.door.id - b.door.id)
          .forEach((use, i) => ports.set(`${r.id}:${use.door.id}`, i === 0 ? 0 : 1));
      }
    }
    return {
      rooms: ship.rooms.map((r) => ({
        id: r.id,
        label: r.label,
        name: r.name,
        col: r.col,
        row: r.row,
        state: r.id === here ? "current" : "explored",
        glyphs: "",
      })),
      doors: ship.doors
        .filter((d) => d.a !== d.b)
        .map((d) => ({
          id: d.id,
          label: d.label,
          a: d.a,
          b: d.b,
          state: d.state,
          portA: ports.get(`${d.a}:${d.id}`) ?? 0,
          portB: ports.get(`${d.b}:${d.id}`) ?? 0,
        })),
      shipLine: "",
    };
  };

  /** Every frame of every hull: the drone standing in each compartment in turn. */
  const frames = (each: (drawn: Schematic, input: SchematicInput, where: string) => void): void => {
    for (const spec of DERELICTS) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const ship = derelictShip(spec, DERELICTS.indexOf(spec), new Rng(seed), {
          flags: new Set<string>(),
          shipIndex: 0,
        });
        for (const room of ship.rooms) {
          const input = inputOf(ship, room.id);
          each(schematic(input), input, `${spec.id} seed ${seed} in ${room.label}`);
        }
      }
    }
  };

  it("never leaves a door off the picture altogether", () => {
    frames((drawn, _input, where) => {
      expect(drawn.omitted, where).toEqual([]);
    });
  });

  /**
   * No islands: a door the layout could not wire leaves an arrow against each
   * of its boxes, so the two halves of a hull are never left with nothing at
   * all between them. Counting the arrows is enough — `omitted` being empty is
   * the other half of the same promise, and the two together mean every edge of
   * the ship is on the drawing.
   */
  /**
   * The drawing and its two counters add up to the hull, so a player counting
   * boxes and reading `» 2 rooms` gets the number the caption gives. The owner
   * counted twelve boxes under a caption saying thirteen compartments and could
   * not tell whether the schematic or the caption was wrong; neither was, and
   * the counters are the arithmetic that says so.
   */
  it("adds up: the boxes drawn plus what is off each edge is the whole ship", () => {
    frames((drawn, input, where) => {
      // Counted by the top-left corners, at the twenty-four cells the geometry
      // ever puts one: a reference written up against a box (`→r11│`) carries a
      // room label too and must not be mistaken for a box of its own.
      let boxes = 0;
      for (const y of [1, 6, 11, 16, 21, 26]) {
        for (const x of [9, 22, 35, 48]) {
          const ch = [...(drawn.lines[y]?.text ?? "")][x];
          if (ch === "┌" || ch === "╔") boxes++;
        }
      }
      expect(boxes + drawn.behind + drawn.ahead, where).toBe(input.rooms.length);
    });
  });

  it("puts a reference on the picture for every door it could not wire", () => {
    frames((drawn, _input, where) => {
      const arrows = drawn.lines.reduce(
        (n, l) => n + [...l.text].filter((c) => "←→↑↓".includes(c)).length,
        0,
      );
      expect(arrows, where).toBeGreaterThanOrEqual(drawn.referenced.length);
    });
  });
});

// ----------------------------------------------------------- the still frame

/**
 * "твой граф не связан и меняется" — the second half of the owner's fourth
 * playtest. A map that lays itself out afresh every turn is not a map, so the
 * geometry is a function of the ship and nothing else: what the drone knows may
 * change what a box says, never where it is, and the window moves in blocks of
 * four columns rather than following the drone column by column.
 */
describe("the picture stands still", () => {
  /** Where each box sits: its label, which is drawn against the right border. */
  const boxesOf = (lines: string[]): Map<string, string> => {
    const out = new Map<string, string>();
    lines.forEach((text, y) => {
      for (const m of text.matchAll(/r\d+(?=[│║┆])/g)) out.set(m[0], `${y},${m.index}`);
    });
    return out;
  };

  /** A hull with a room in every cell of four columns: plenty to shuffle. */
  const hull = (here: number, known: number): SchematicInput => ({
    rooms: Array.from({ length: 12 }, (_, i) =>
      room(
        i + 1,
        `R${i + 1}`,
        i % 4,
        Math.floor(i / 4),
        i + 1 === here ? "current"
        : i < known ? "explored"
        : "unknown",
        i < known ? "% †" : "",
      ),
    ),
    doors: Array.from({ length: 8 }, (_, i) => door(`d${i + 1}`, i + 1, i + 5, "open", 0, 0)),
    shipLine: "",
  });

  it("does not move a box when the drone learns something", () => {
    const first = boxesOf(text(hull(1, 0)));
    for (let known = 1; known <= 12; known++) {
      expect(boxesOf(text(hull(1, known)))).toEqual(first);
    }
  });

  it("does not move a box while the drone walks inside the window", () => {
    const first = boxesOf(text(hull(1, 12)));
    for (let here = 2; here <= 12; here++) {
      expect(boxesOf(text(hull(here, 12)))).toEqual(first);
    }
  });
});

// ------------------------------------------------------------------- colours

describe("colour", () => {
  it("comes back as spans, never as markup in the text", () => {
    for (const line of schematicLines(KESTREL)) {
      expect(line.text).not.toContain("%c{");
      expect(line.text).not.toContain("%b{");
    }
  });

  it("marks the current room, the hull and the doors", () => {
    const lines = schematic(KESTREL).lines;
    const spans = lines.flatMap((l) => l.spans ?? []);
    expect(spans.some((s) => s.fg === "#e0a458")).toBe(true);
    expect(spans.every((s) => s.to > s.from)).toBe(true);
    for (const line of lines) expect((line.spans ?? []).some((s) => s.from === 64)).toBe(true);
  });
});
