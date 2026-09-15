import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RoomGame, Rng, hexAdjacent, hexLayout, type RoomGameConfig } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { DERELICTS, buildDerelict } from "../src/content/derelicts.js";
import { schematicInputOf } from "../src/ui/schematic-input.js";
import { HEX_R, hexCentre, hexSvgOf } from "../src/ui/web/hex-svg.js";
import { TOKENS, WEB_CSS } from "../src/ui/web/styles.js";
import { setLang, t } from "../src/i18n.js";

/**
 * The honeycomb drawing. What the layout guarantees is tested in the engine
 * (`packages/engine/tests/hexlayout.test.ts`); this is about the picture: that
 * every compartment is on it, that every corridor is a straight line between
 * two hexagons, and that a door the lattice could not draw is still named.
 */

const SHIP = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -[d2:k1]- r3
  r2 -d3- r4
  r3 -#d4#- r5
  r1: docking explored
  r2: cargo cover explored
  r3: storage scanned
  r4: hab explored
  r5: reactor
`;

function gameIn(room = "r2", seed = 7): RoomGame {
  const config: Omit<RoomGameConfig, "seed"> = {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(SHIP).ship,
    firstShipId: "1",
  };
  const game = new RoomGame({ ...config, seed });
  game.player.room = game.ship.room(room).id;
  game.refreshSight();
  return game;
}

/**
 * The fixture with a loop in it (`GOLDEN_SHIP`, below): a ship whose honeycomb
 * has a door the lattice cannot lay between two hexagons that touch, which is
 * the only way to test what the drawing does about one.
 */
function loopGame(seed = 7): RoomGame {
  const config: Omit<RoomGameConfig, "seed"> = {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(GOLDEN_SHIP).ship,
    firstShipId: "1",
  };
  const game = new RoomGame({ ...config, seed });
  game.player.room = game.ship.room("r2").id;
  game.refreshSight();
  return game;
}

function svgOfGame(game: RoomGame): string {
  return hexSvgOf(schematicInputOf(game), hexLayout(game.ship));
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("the honeycomb drawing", () => {
  it("draws one hexagon per compartment, each carrying its own id", () => {
    const game = gameIn();
    const svg = svgOfGame(game);
    expect(count(svg, "<polygon class=\"room-box\"")).toBe(game.ship.rooms.length);
    for (const room of game.ship.rooms) {
      expect(svg, room.label).toContain(`data-room="${room.id}"`);
      expect(svg, room.label).toContain(`>${room.label}</text>`);
    }
  });

  it("gives every hexagon six corners and no more", () => {
    const svg = svgOfGame(gameIn());
    for (const [, points] of svg.matchAll(/class="room-box" points="([^"]+)"/g)) {
      expect(points!.split(" ")).toHaveLength(6);
    }
  });

  it("draws a corridor as one straight segment, wall and door together", () => {
    const game = gameIn();
    const layout = hexLayout(game.ship);
    const svg = svgOfGame(game);
    // Two lines per corridor: the bulkhead walls, and the door's own state on
    // top of them. Nothing curves and nothing bends — a corridor joins two
    // hexagons that touch, so there is nothing to bend around.
    expect(count(svg, '<line class="hall-wall')).toBe(layout.corridors.size);
    expect(count(svg, '<line class="door-wire')).toBe(layout.corridors.size);
    expect(svg).not.toContain("<path");
  });

  it("draws a door it could not make a corridor of, instead of naming it twice", () => {
    const game = loopGame();
    const layout = hexLayout(game.ship);
    const svg = svgOfGame(game);
    expect(layout.links.size, "the fixture's loop is the door that cannot be drawn straight")
      .toBeGreaterThan(0);
    for (const id of layout.links) {
      expect(count(svg, `<g class="link" data-door="${id}">`), String(id)).toBe(1);
    }
    // Three strokes each, as a corridor has: a rail down both sides and the
    // door's own state down the middle.
    expect(count(svg, '<polyline class="link-run')).toBe(layout.links.size * 3);
    // And not one chip. `d6 → r7` at each end, with nothing drawn between them,
    // is what the owner read as the thing this game does not have.
    expect(svg).not.toContain(" → ");
  });

  it("says every door exactly once, whether it is a corridor or a long run", () => {
    const game = loopGame();
    const layout = hexLayout(game.ship);
    const svg = svgOfGame(game);
    for (const door of game.ship.doors) {
      if (door.a === door.b) continue;
      expect(count(svg, `>${door.label}</text>`), door.label).toBe(1);
    }
    expect(layout.corridors.size + layout.links.size).toBe(
      game.ship.doors.filter((d) => d.a !== d.b).length,
    );
  });

  it("keeps a long run out of every compartment it goes past", () => {
    const game = loopGame();
    const layout = hexLayout(game.ship);
    const svg = svgOfGame(game);
    const centres = [...layout.cells.values()].map(hexCentre);
    const runs = [...svg.matchAll(/<polyline class="link-run hall-wall[^>]*points="([^"]+)"/g)];
    expect(runs.length).toBe(layout.links.size);
    for (const [, points] of runs) {
      const bends = points!.split(" ").map((pair) => {
        const [x, y] = pair.split(",").map(Number);
        return { x: x!, y: y! };
      });
      // An outline, at least one gap, an outline: a run always bends.
      expect(bends.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < bends.length; i++) {
        for (let step = 0; step <= 20; step++) {
          const at = step / 20;
          const x = bends[i - 1]!.x + (bends[i]!.x - bends[i - 1]!.x) * at;
          const y = bends[i - 1]!.y + (bends[i]!.y - bends[i - 1]!.y) * at;
          for (const c of centres) {
            // A hexagon reaches `HEX_R` from its centre at its six points and
            // less everywhere else, so a walk that stays that far out of every
            // centre has crossed no compartment at all — which is the whole of
            // what makes it a walk rather than a jump.
            expect(Math.hypot(x - c.x, y - c.y)).toBeGreaterThanOrEqual(HEX_R - 0.2);
          }
        }
      }
    }
  });

  it("gives the hull's own job a colour of its own, raised or not", () => {
    const game = gameIn();
    // r4 has been walked through, so what was left lying in it is drawn.
    game.ship.room("r4").data.systems = [{ id: "core" }];
    const input = schematicInputOf(game);
    const thing = input.rooms
      .find((r) => r.label === "r4")!
      .things!.find((t) => t.goal !== undefined);
    expect(thing?.goal, "a system carries the fact that it is one").toBe("down");
    // The letter and the picture both, because the owner plays with the
    // pictures on: «выделяй значки с целями отдельным цветом, например зелёным».
    expect(svgOfGame(game)).toContain('<tspan class="glyph goal is-down">+</tspan>');
    expect(hexSvgOf(input, hexLayout(game.ship), "", undefined, true))
      .toContain('<use class="tile goal is-down"');
    // And a system already raised reads differently from one still down.
    game.ship.room("r4").data.systems = [{ id: "core", online: true }];
    const up = hexSvgOf(schematicInputOf(game), hexLayout(game.ship), "", undefined, true);
    expect(up).toContain('<use class="tile goal is-up"');
    expect(WEB_CSS).toContain(".schematic .room .tile.goal{color:var(--good);}");
    expect(WEB_CSS).toContain(".schematic .room .tile.goal.is-up{opacity:.65;}");
    // Green and not amber: amber says a decision is required here, and a
    // compartment with a system in it is a place rather than a prompt.
    expect(TOKENS.good).not.toBe(TOKENS.accent);
    expect(contrast(TOKENS.good!, TOKENS.bg!)).toBeGreaterThanOrEqual(4.5);
  });

  it("marks the compartment the drone is in, and only that one", () => {
    const svg = svgOfGame(gameIn("r4"));
    expect(count(svg, 'class="room is-current"')).toBe(1);
    expect(count(svg, '<polygon class="room-halo"')).toBe(1);
  });

  it("shows nothing inside a compartment nobody has seen", () => {
    const svg = svgOfGame(gameIn());
    // r5 is behind a welded bulkhead and unexplored: a dashed hexagon with its
    // id and the mark that stands for a name nobody knows.
    expect(svg).toContain('class="room is-unknown"');
    expect(svg).toContain(">····</text>");
    expect(svg).not.toContain(">REACTOR</text>");
  });

  it("lays the long run with the corridors, under the hexagons and over the hull", () => {
    const game = loopGame();
    const svg = svgOfGame(game);
    // It never passes over a cell, so being under them costs it nothing — and
    // its label is drawn after them, with every other door label.
    expect(svg.indexOf('class="link-run')).toBeLessThan(svg.indexOf('class="room-box'));
    expect(svg.indexOf('class="room-box')).toBeLessThan(svg.lastIndexOf('class="door-tag"'));
  });

  it("does not print two door labels on top of each other", () => {
    const game = loopGame();
    const svg = svgOfGame(game);
    const at = [...svg.matchAll(/class="door-tag" x="([-\d.]+)" y="([-\d.]+)"/g)].map(
      (m) => `${m[1]},${m[2]}`,
    );
    expect(new Set(at).size).toBe(at.length);
  });

  it("hands a hover to nobody else: not one `<title>` on the whole board", () => {
    // A `<title>` is the browser's own tooltip — its box, its type, its delay —
    // drawn over the readout that is already answering the same question in our
    // letters: "подсказка браузера тут точно не нужна, нужна нашего интерфейса"
    // (the owner). So no cell carries one, and neither does a tile inside one.
    const game = gameIn();
    const input = schematicInputOf(game);
    expect(hexSvgOf(input, hexLayout(game.ship))).not.toContain("<title>");
    expect(hexSvgOf(input, hexLayout(game.ship), "", undefined, true)).not.toContain("<title>");
  });

  it("closes every tag it opens", () => {
    const svg = svgOfGame(gameIn());
    expect(count(svg, "<svg")).toBe(1);
    expect(count(svg, "</svg>")).toBe(1);
    expect(count(svg, "<g ")).toBe(count(svg, "</g>"));
    expect(count(svg, "<text")).toBe(count(svg, "</text>"));
  });
});

// --------------------------------------------------------- and the cell's face

/** WCAG relative luminance of a `#rrggbb`, and the ratio between two of them. */
function luminance(hex: string): number {
  const parts = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = parts.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi! + 0.05) / (lo! + 0.05);
}

/**
 * The partner's board, adopted (G91 B). The rule it turns on is that **how much
 * is printed on a cell is how much the drone knows of it** — so the test is
 * about what each state does and does not put on the face, not about colours.
 *
 * Our five states against his four: `unknown` is his undetected (no plate at
 * all), `scanned` his detected (a striped plate — a label and not a look),
 * and `explored`, `visible`, `current` are three grades of his monitored, which
 * is first-hand knowledge on a solid plate.
 */
describe("the face of a compartment", () => {
  /** The markup of one hexagon's group, by its id. */
  function cellOf(svg: string, label: string): string {
    const head = svg.indexOf(`>${label}</text>`);
    const open = svg.lastIndexOf("<g class=\"room ", head);
    return svg.slice(open, svg.indexOf("</g>", head) + 4);
  }

  it("gives a plate to every state but the one nobody has found", () => {
    const svg = svgOfGame(gameIn());
    // r5 is behind a welded bulkhead: a shape in the dark, and the absence of
    // the plate is the whole of what it says.
    expect(cellOf(svg, "r5")).not.toContain("room-band");
    for (const label of ["r1", "r2", "r3", "r4"]) {
      expect(cellOf(svg, label), label).toContain('<rect class="room-band"');
    }
  });

  it("stripes the plate while the knowledge is second-hand, and only then", () => {
    const svg = svgOfGame(gameIn());
    // r3 was pinged and never entered; the rest were walked through or are in sight.
    expect(cellOf(svg, "r3")).toContain('<line class="band-hatch"');
    for (const label of ["r1", "r2", "r4"]) {
      expect(cellOf(svg, label), label).not.toContain("band-hatch");
    }
    expect(count(svg, "band-hatch")).toBe(1);
    expect(WEB_CSS).toContain(".hexmap .room.is-scanned .band-hatch{stroke:var(--fg);}");
    // And the ink is knocked out of the plate, in every state that has one.
    expect(WEB_CSS).toContain(".hexmap .room:not(.is-unknown) .room-name{fill:var(--bg);");
  });

  /**
   * The one thing the plate can get wrong, and the reason its ladder is hue and
   * pattern rather than brightness. Ink knocked out of the dim end of this
   * palette gives two to one: a plate the width of the compartment that the name
   * cannot be read off, which is a worse place for a name than the dark floor it
   * came from. Both tones of the stripe count — half a name is no name.
   */
  it("keeps every plate light enough to read the knocked-out name off", () => {
    const tones = [...WEB_CSS.matchAll(
      /\.hexmap \.room\.is-\w+ \.(?:room-band|band-hatch)\{(?:fill|stroke):var\(--([\w-]+)\)/g,
    )].map((m) => m[1]!);
    expect(tones.length).toBeGreaterThanOrEqual(5);
    for (const tone of tones) {
      const plate = TOKENS[tone];
      expect(plate, tone).toBeDefined();
      expect(contrast(plate!, TOKENS.bg!), `${tone} ${plate!} against the knocked-out ink`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it("puts the plate inside the outline, on the name's own line", () => {
    const svg = svgOfGame(gameIn());
    const plate = /<rect class="room-band" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="(\d+)"\/>/;
    const [, x, , w] = plate.exec(cellOf(svg, "r1"))!;
    // The hexagon of r1 is centred on 0 and its outline reaches ±39.8.
    expect(Number(x)).toBeGreaterThan(-39.8);
    expect(Number(x) + Number(w)).toBeLessThan(39.8);
  });

  it("squeezes a name too wide for its plate instead of letting it run out of one", () => {
    const svg = svgOfGame(gameIn());
    // CARGO BAY is nine characters; DOCKING is seven and is set at its own width.
    expect(cellOf(svg, "r2")).toContain('lengthAdjust="spacingAndGlyphs"');
    expect(cellOf(svg, "r1")).not.toContain("lengthAdjust");
    for (const [, fit] of svg.matchAll(/textLength="([\d.]+)"/g)) {
      expect(Number(fit)).toBeLessThan(73.7);
    }
  });

  it("crowns the drone's cell with a hexagon, drawn last on the deck", () => {
    const svg = svgOfGame(gameIn());
    const mark = svg.slice(svg.indexOf('<g class="drone-mark"'));
    expect(mark).toContain('<polygon class="drone-disc"');
    expect(mark).toContain('<polygon class="drone-pip"');
    for (const [, points] of mark.matchAll(/class="drone-(?:disc|core)" points="([^"]+)"/g)) {
      expect(points!.split(" ")).toHaveLength(6);
    }
  });

  it("hollows the corridor: two rails, the deck between them, the door down the middle", () => {
    const game = gameIn();
    const layout = hexLayout(game.ship);
    const svg = svgOfGame(game);
    expect(count(svg, '<line class="hall-floor')).toBe(layout.corridors.size);
    // The three strokes run along the same segment, widest first, and every one
    // of them answers a click on the corridor.
    const first = /<line class="hall-wall is-\w+" data-door="(\d+)"( x1="[-\d.]+" y1="[-\d.]+" x2="[-\d.]+" y2="[-\d.]+"\/>)/.exec(svg)!;
    expect(svg).toContain(`<line class="hall-floor is-open" data-door="${first[1]}"${first[2]}`);
    expect(WEB_CSS).toContain(".hexmap .hall-floor{stroke:var(--bg); stroke-width:7;");
  });
});

// ------------------------------------------------------------ and its hazards

/**
 * Artboard 3b: a known hazard takes the floor of its hexagon and a rim along
 * the two upper edges, with the codex's word for it over the name; a known trap
 * puts a chevron over its door's label. Nothing of it before the drone knows.
 */
describe("the honeycomb's hazards", () => {
  const HAZARDS_SHIP = `
    TUG -a1- r1
    r1 -d1- r2
    r2 -d2- r3
    r3 -d3- r4
    r1: docking explored
    r2: cargo
    r3: hab hazard=smoke
    r4: engineering hazard=frost
    d3: trap=mine
  `;

  function hazardGame(): RoomGame {
    const config: Omit<RoomGameConfig, "seed"> = {
      ...GAME_CONFIG,
      content: { ...SALVOR, monsterChance: () => 0 },
      firstShip: () => shipFromText(HAZARDS_SHIP).ship,
      firstShipId: "1",
    };
    return new RoomGame({ ...config, seed: 7 });
  }

  it("draws nothing of a hazard the drone has not been told about", () => {
    const game = hazardGame();
    const svg = svgOfGame(game);
    expect(svg).not.toContain("hz-");
    expect(svg).not.toContain("trap-mark");
  });

  it("tints the floor, rims the two upper edges and names it — and still shows what is inside", () => {
    const game = hazardGame();
    // A pulse is how a hazard gets known without a sign (`hazardKnown`).
    game.ship.room("r3").scanned = true;
    game.ship.room("r4").scanned = true;
    const input = schematicInputOf(game);
    expect(input.rooms.find((r) => r.label === "r3")!.hazard).toEqual({ id: "smoke", word: t("codex.smoke.title") });
    expect(input.rooms.find((r) => r.label === "r4")!.hazard).toEqual({ id: "frost", word: t("codex.frost.title") });
    expect(input.doors.find((d) => d.label === "d3")!.trap).toBe("mine");
    expect(input.doors.find((d) => d.label === "d2")!.trap).toBeUndefined();

    const svg = hexSvgOf(input, hexLayout(game.ship));
    expect(svg).toMatch(/<g class="room is-scanned hz-smoke" data-room="\d+">/);
    expect(svg).toMatch(/<g class="room is-scanned hz-frost" data-room="\d+">/);
    expect(count(svg, '<polyline class="hz-rim"')).toBe(2);
    for (const [, points] of svg.matchAll(/class="hz-rim" points="([^"]+)"/g)) {
      expect(points!.split(" ")).toHaveLength(3);
    }
    expect(svg).toContain(`>${t("codex.smoke.title")}</text>`);
    expect(svg).toContain(`>${t("codex.frost.title")}</text>`);
    // The smoke is not a blindfold on the map: the glyph row is still drawn.
    const smoke = input.rooms.find((r) => r.label === "r3")!;
    expect(smoke.glyphs).toContain("≈");
    expect(svg).toContain(`>${smoke.glyphs}</text>`);

    // The mine: a chevron over the label, and the plate on the warning colour.
    expect(count(svg, '<polyline class="trap-mark"')).toBe(1);
    expect(svg).toMatch(/<g class="door is-\w+ has-trap hz-mine" data-door="\d+">/);
  });

  it("still names the hazard with the tiles on, beside the compartment's own picture", () => {
    const game = hazardGame();
    game.ship.room("r3").scanned = true;
    game.ship.room("r4").scanned = true;
    const svg = hexSvgOf(schematicInputOf(game), hexLayout(game.ship), "", undefined, true);
    // The owner played `?tiles=1`, found a cell with a wavy mark on it and asked
    // what the mark was. A picture nobody can name has to be looked up, so the
    // word is drawn where the mark is — in every mode, not only where the mark
    // happens to be a letter.
    expect(svg).toContain(`>${t("codex.smoke.title")}</text>`);
    expect(svg).toContain(`>${t("codex.frost.title")}</text>`);
    // ENGINEERING is one of the six kinds that get a pictogram, so its cell has
    // two things to say on one line: they share it, left to right, and neither
    // silences the other.
    const head = svg.indexOf(`>${t("codex.frost.title")}</text>`);
    const cell = svg.slice(svg.lastIndexOf('<g class="room ', head), head);
    const tile = /<use class="zone-tile"[^>]*x="([-\d.]+)"/.exec(cell);
    const word = /<text class="hz-word" x="([-\d.]+)"/.exec(cell);
    expect(tile, "the pictogram is still drawn").not.toBeNull();
    expect(Number(word![1]!)).toBeGreaterThan(Number(tile![1]!) + 14);
  });

  it("keeps a hazard's word inside the cell in all three languages", () => {
    const game = hazardGame();
    game.ship.room("r3").scanned = true;
    game.ship.room("r4").scanned = true;
    for (const lang of ["en", "es", "ru"] as const) {
      setLang(lang);
      const svg = hexSvgOf(schematicInputOf(game), hexLayout(game.ship), "", undefined, true);
      const words = [...svg.matchAll(/<text class="hz-word"[^>]*>[^<]+<\/text>/g)];
      expect(words.length, lang).toBe(2);
      for (const [tag] of words) {
        // Either the word is short enough for the line it sits on, or it is
        // squeezed to it: the hexagon has closed in to fifty-two units by the
        // cap's line, and `COMPARTIMENTO REVENTADO` is twenty-three characters.
        const fit = /textLength="([\d.]+)"/.exec(tag!);
        if (fit) expect(Number(fit[1]!), lang).toBeLessThanOrEqual(52);
      }
    }
    setLang("en");
  });

  it("says which property on a rhythm and not only on a hue", () => {
    const game = hazardGame();
    game.ship.room("r3").scanned = true;
    game.ship.room("r4").scanned = true;
    const svg = hexSvgOf(schematicInputOf(game), hexLayout(game.ship), "");
    // One ring per compartment that has something to say about itself, and none
    // on the two that have not (G91 B, his PROP table). The rhythm is the
    // channel: two cells tinted the same dark still read apart, and it survives
    // a reader who does not separate the two blues.
    expect(count(svg, '<polygon class="prop-ring"')).toBe(2);
    expect(WEB_CSS).toContain(".hexmap .hz-frost .prop-ring{stroke:var(--zone); stroke-dasharray:15 7;}");
    expect(WEB_CSS).toContain(".hexmap .hz-smoke .prop-ring{stroke:var(--soft); stroke-dasharray:3 10;}");
    // Four rhythms and no two alike, or the channel says nothing.
    const beats = [...WEB_CSS.matchAll(/\.prop-ring\{[^}]*stroke-dasharray:([\d ]+);/g)].map((m) => m[1]);
    expect(beats).toHaveLength(4);
    expect(new Set(beats).size).toBe(4);
    // Inside the outline, which is the state's, and outside nothing.
    for (const [, points] of svg.matchAll(/class="prop-ring" points="([^"]+)"/g)) {
      expect(points!.split(" ")).toHaveLength(6);
    }
  });

  it("gives the tint the one floor no state uses, and leaves red to the machines", () => {
    expect(WEB_CSS).toContain(".hexmap .room.hz-frost:not(.is-alarmed) .room-box{fill:#101c22;");
    expect(WEB_CSS).toContain(".hexmap .room.hz-smoke:not(.is-alarmed) .room-box{fill:#1a1a18;");
    expect(WEB_CSS).toMatch(/\.hexmap \.trap-mark\{[^}]*stroke:var\(--warn\)/);
    expect(WEB_CSS).toMatch(/\.hexmap \.door\.has-trap \.door-tag\{fill:var\(--warn\)/);
  });
});

// ------------------------------------------------------- and without a hull

/**
 * The same fixture as `SHIP`, with a loop and two more compartments — what the
 * golden file below was drawn from, the day before there was a hull (G81).
 */
const GOLDEN_SHIP = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -[d2:k1]- r3
  r2 -d3- r4
  r3 -#d4#- r5
  r4 -d5- r6
  r6 -d6- r7
  r7 -d7- r2
  r1: docking explored
  r2: cargo cover explored
  r3: storage scanned
  r4: hab explored
  r5: reactor
  r6: mess explored
  r7: lab scanned
`;

describe("the honeycomb without a hull", () => {
  it("is byte for byte the drawing it was before there was a hull to switch off", () => {
    // `?hull=0` promises today's picture, and "today" is a file: the output of
    // this very call, written down before `hexSvgOf` learned its fourth
    // argument. If this fails, the bare honeycomb has changed — which may be
    // right, but has to be on purpose, and then the file is re-recorded.
    // Re-recorded on 14.09 (G89 A8) for one change only: a `<title>` as the
    // first child of every hexagon's group, the tooltip under a pointer.
    // And again on 14.09 (G90 D2, D3) for two: the drone's amber mark after
    // everything else on the deck, and `data-door` on every corridor and tag.
    // And again on 15.09 (G91 B) for the partner's board: the plate the name is
    // now printed on, the corridor's third stroke that hollows it out, and the
    // drone's mark as a hexagon rather than a disc.
    // And again on 15.09 (G92 A5) for one deletion: the `<title>` off every
    // hexagon — the browser's own tooltip, drawn over our readout. Nothing else
    // in the file moved, which is the whole of what re-recording it claims.
    // And again on 15.09 (G95 A) for `d6`, the fixture's loop: the duct and the
    // two chips naming each other are gone, and in their place is the walk the
    // door actually is — a corridor bent through the gutter around HAB BLOCK,
    // with the label once, halfway along it. Nothing else in the file moved.
    const config: Omit<RoomGameConfig, "seed"> = {
      ...GAME_CONFIG,
      content: { ...SALVOR, monsterChance: () => 0 },
      firstShip: () => shipFromText(GOLDEN_SHIP).ship,
      firstShipId: "1",
    };
    const game = new RoomGame({ ...config, seed: 7 });
    game.player.room = game.ship.room("r2").id;
    game.refreshSight();
    const svg = hexSvgOf(schematicInputOf(game), hexLayout(game.ship), "KESTREL · freighter");
    const here = dirname(fileURLToPath(import.meta.url));
    const golden = readFileSync(join(here, "fixtures", "hex-svg-before-hull.svg"), "utf8");
    expect(svg).toBe(golden);
    expect(svg).not.toContain("hull-");
  });
});

// ------------------------------------------------- and on the hulls we ship

describe("the honeycomb of a hull the game actually generates", () => {
  it("has no links at all: every door is a corridor on every class", () => {
    // The promise the lattice generator exists for, checked on the game's own
    // classes rather than on the engine's test spec: a hull grown on the
    // lattice leaves the picture nothing to explain, so nothing on it can read
    // as a teleport ("рандомных телепортов нет" — the owner's rule).
    for (const spec of DERELICTS) {
      for (let seed = 1; seed <= 40; seed++) {
        const built = buildDerelict(spec, 1, new Rng(seed), { flags: new Set(), shipIndex: 1 });
        const layout = hexLayout(built.ship);
        expect(layout.links.size, `${spec.id} seed ${seed}`).toBe(0);
        expect(layout.offLattice, `${spec.id} seed ${seed}`).toEqual([]);
        expect(layout.cells.size, `${spec.id} seed ${seed}`).toBe(built.ship.rooms.length);
      }
    }
  });

  it("leaves walls between neighbours, so the shape is worth reading", () => {
    // The other half of the rule: a door on every shared edge would be a slab.
    let edges = 0;
    let doors = 0;
    for (const spec of DERELICTS) {
      for (let seed = 1; seed <= 40; seed++) {
        const built = buildDerelict(spec, 1, new Rng(seed), { flags: new Set(), shipIndex: 1 });
        const cells = [...hexLayout(built.ship).cells];
        for (const [, a] of cells) {
          for (const [, b] of cells) {
            if (a === b) continue;
            if (hexAdjacent(a, b)) edges++;
          }
        }
        doors += built.ship.doors.filter((d) => d.a !== d.b).length;
      }
    }
    // `edges` counts each pair twice, which is what the halving is for.
    const share = doors / (edges / 2);
    expect(share, `doors on ${(share * 100).toFixed(1)}% of shared edges`).toBeLessThan(0.85);
    expect(share).toBeGreaterThan(0.4);
  });
});
