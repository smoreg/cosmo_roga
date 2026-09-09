import { describe, it, expect } from "vitest";
import { RoomGame, Rng, hexAdjacent, hexLayout, type RoomGameConfig } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { DERELICTS, buildDerelict } from "../src/content/derelicts.js";
import { schematicInputOf } from "../src/ui/schematic-input.js";
import { hexSvgOf } from "../src/ui/web/hex-svg.js";

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

  it("says a door it could not draw, at both of its ends", () => {
    const game = gameIn();
    const layout = hexLayout(game.ship);
    const svg = svgOfGame(game);
    for (const door of game.ship.doors) {
      if (door.a === door.b) continue;
      if (!layout.links.has(door.id)) continue;
      // Once per end, and each end names the compartment on the other side:
      // a door to somewhere with an id on the same screen, not a teleport.
      const a = game.ship.roomAt(door.a).label;
      const b = game.ship.roomAt(door.b).label;
      expect(count(svg, `>${door.label} → ${b}</text>`), door.label).toBe(1);
      expect(count(svg, `>${door.label} → ${a}</text>`), door.label).toBe(1);
    }
  });

  it("says every door exactly once as a corridor or twice as a link", () => {
    const game = gameIn();
    const layout = hexLayout(game.ship);
    const svg = svgOfGame(game);
    for (const door of game.ship.doors) {
      if (door.a === door.b) continue;
      const asCorridor = count(svg, `>${door.label}</text>`);
      const asLink = count(svg, `>${door.label} → `);
      const drawn = layout.corridors.has(door.id);
      expect(asCorridor, door.label).toBe(drawn ? 1 : 0);
      expect(asLink, door.label).toBe(drawn ? 0 : 2);
    }
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

  it("runs a duct under the deck for every door it could not draw", () => {
    const game = gameIn();
    const layout = hexLayout(game.ship);
    const svg = svgOfGame(game);
    // One line per link, and it comes before the hexagons in the document so
    // they cover it: a run you can follow, not a corridor and not a teleport.
    expect(count(svg, '<line class="duct')).toBe(layout.links.size);
    if (layout.links.size > 0) {
      expect(svg.indexOf('class="duct')).toBeLessThan(svg.indexOf('class="room-box'));
    }
  });

  it("does not print two chips of one compartment on top of each other", () => {
    const game = gameIn();
    const svg = svgOfGame(game);
    const at = [...svg.matchAll(/class="door-tag" x="([-\d.]+)" y="([-\d.]+)"/g)].map(
      (m) => `${m[1]},${m[2]}`,
    );
    expect(new Set(at).size).toBe(at.length);
  });

  it("closes every tag it opens", () => {
    const svg = svgOfGame(gameIn());
    expect(count(svg, "<svg")).toBe(1);
    expect(count(svg, "</svg>")).toBe(1);
    expect(count(svg, "<g ")).toBe(count(svg, "</g>"));
    expect(count(svg, "<text")).toBe(count(svg, "</text>"));
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
