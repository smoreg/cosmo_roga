import { describe, it, expect } from "vitest";
import { RoomGame, Rng, hexLayout, spawnMonsterIn, type RoomGameConfig } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame } from "../src/game.js";
import { MONSTERS } from "../src/content/monsters.js";
import { DERELICTS, buildDerelict } from "../src/content/derelicts.js";
import { rigOf } from "../src/twist/rig.js";
import { hazardStore } from "../src/systems/hazardstate.js";
import { ACTION_KEYS, roomActions } from "../src/ui/actions.js";
import { isStop, makeTraveller } from "../src/ui/auto.js";
import {
  aimedAt,
  appReducer,
  hovered,
  initialState,
  listOf,
  mapAim,
  type AppState,
} from "../src/ui/appstate.js";
import { toIntent, type KeyLike } from "../src/ui/input.js";
import { schematicInputOf, thingsIn } from "../src/ui/schematic-input.js";
import { hexSvgOf } from "../src/ui/web/hex-svg.js";
import { WEB_CSS } from "../src/ui/web/styles.js";
import { setLang, t } from "../src/i18n.js";

/**
 * The owner's list for the map (G90 D): machines red, the drone easy to find,
 * every click answered, the way a walk will take drawn, and no greyed row
 * under the highlight. All of it pure functions of the run and the state.
 */

const SHIP = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -d2- r3
  r3 -d5- r7
  r2 -[d3:k1]- r4
  r2 -d4- r5
  r5 -d6- r6
  r1: docking explored
  r2: cargo explored
  r3: hab hazard=smoke
  r4: storage scanned
  r5: mess hazard=frost
  r6: lab
  r7: reactor scanned
`;

function run(seed = 101): RoomGame {
  const config: Omit<RoomGameConfig, "seed"> = {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(SHIP).ship,
    firstShipId: "1",
  };
  const game = new RoomGame({ ...config, seed });
  game.player.room = game.ship.room("r2").id;
  game.refreshSight();
  for (const rec of hazardStore(game)) rec.known = true;
  return game;
}

function put(game: RoomGame, room: string, id = "scout"): void {
  const kind = MONSTERS.find((m) => m.id === id)!;
  const e = spawnMonsterIn(kind, game.ship.room(room).id);
  game.schedule.admit(e);
  game.entities.push(e);
  game.refreshSight();
}

const press = (key: string, code?: string): KeyLike => ({ key, code });

function key(state: AppState, e: KeyLike, game: RoomGame): AppState {
  return appReducer(state, toIntent(e, rigOf(game.player)), game);
}

function playing(game: RoomGame): AppState {
  return key(initialState(), press("1", "Digit1"), game);
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("machines on the honeycomb", () => {
  it("are red in the compartment underfoot, counted in a skull, with a red ring round the cell", () => {
    const game = run();
    put(game, "r2");
    const svg = hexSvgOf(schematicInputOf(game), hexLayout(game.ship));
    const here = svg.slice(svg.indexOf('<g class="room is-current"'));
    const cell = here.slice(0, here.indexOf("</g></g>") + 8);
    expect(cell).toContain('<tspan class="glyph hostile">');
    expect(cell).toContain('<polygon class="threat-skull"');
    expect(cell).toContain('class="threat-count" x="0" y="3" text-anchor="middle">1</text>');
    expect(cell).toContain('<polygon class="room-ring"');
    expect(svg).not.toContain("threat-cap");
    // The state's bright ink cannot outrank the red any more.
    expect(WEB_CSS).toContain(".schematic .room .glyph.hostile{fill:var(--bad);");
    expect(WEB_CSS).toContain(".schematic .room .tile.hostile{color:var(--bad);}");
    expect(WEB_CSS).toMatch(/\.hexmap \.room-ring\{[^}]*stroke:var\(--bad\)/);
  });
});

/**
 * The partner's board puts a compartment's properties on a channel of their own
 * (G91 B): a dashed ring inside the outline whose rhythm says which. The alarm
 * is one of them, and it is the one that moves — on the kit's own budget, which
 * is discrete frames of 225ms and nothing in between.
 */
describe("a compartment with a machine just in sight", () => {
  it("rings on the fast beat, over any hazard, and stands still for less motion", () => {
    const game = run();
    const smoke = game.ship.room("r3").id;
    const svg = hexSvgOf(schematicInputOf(game, new Set([smoke])), hexLayout(game.ship));
    const cell = svg.slice(svg.indexOf(`data-room="${smoke}"`));
    expect(cell.slice(0, cell.indexOf("</g>"))).toContain('<polygon class="prop-ring"');
    // The ring is the compartment's, not its state's: r3 is still a shape in
    // the dark — no plate, no name — and it still says the two things about
    // itself the drone does know.
    expect(svg).toContain('<g class="room is-unknown is-alarmed hz-smoke"');
    expect(cell.slice(0, cell.indexOf("</g>"))).not.toContain("room-band");

    // The alarm's rule is last, so a cell that is both smoke-filled and watched
    // rings red for the machine rather than grey for the weather — which is the
    // map's standing rule that red belongs to the machines.
    const alarmed = WEB_CSS.indexOf(".hexmap .room.is-alarmed .prop-ring{");
    expect(alarmed).toBeGreaterThan(WEB_CSS.indexOf(".hexmap .hz-smoke .prop-ring{"));
    expect(WEB_CSS.slice(alarmed)).toMatch(/^\.hexmap \.room\.is-alarmed \.prop-ring\{stroke:var\(--bad\)/);

    // Discrete frames on the 225ms grid, never an interpolation, and nothing at
    // all for a reader who asked their system for less of it.
    const beats = [...WEB_CSS.matchAll(/\.hexmap [^{}]*\{[^}]*animation:(salvor-\w+ [^;]+);/g)].map((m) => m[1]!);
    expect(beats.length).toBeGreaterThanOrEqual(2);
    for (const spec of beats) {
      expect(spec, spec).toMatch(/^salvor-\w+ var\(--sv-frame(-\d)?\) steps\(\d,end\) (1 both|infinite)$/);
    }
    expect(WEB_CSS).toContain(".hexmap .room.is-alarmed .prop-ring{animation:none;");
  });
});

describe("where the drone is", () => {
  it("is an amber mark on the cell underfoot, drawn after everything else on the deck", () => {
    const game = run();
    const svg = hexSvgOf(schematicInputOf(game), hexLayout(game.ship));
    expect(count(svg, '<g class="drone-mark"')).toBe(1);
    const mark = svg.indexOf('<g class="drone-mark"');
    expect(mark).toBeGreaterThan(svg.lastIndexOf('class="room-box"'));
    expect(mark).toBeGreaterThan(svg.lastIndexOf('class="door'));
    expect(mark).toBeGreaterThan(svg.lastIndexOf('class="hz-rim"'));
    expect(WEB_CSS).toMatch(/\.hexmap \.drone-disc\{fill:var\(--accent\)/);
    expect(WEB_CSS).toContain(".hexmap .drone-mark{pointer-events:none;}");
  });
});

describe("a click on the map", () => {
  it("on the compartment underfoot opens its own list at the top", () => {
    const game = run();
    const map = key(playing(game), press("m", "KeyM"), game);
    const moved = key(map, press("ArrowDown", "ArrowDown"), game);
    expect(moved.moves).toBe(true);
    const clicked = appReducer(moved, { kind: "room", id: game.ship.room("r2").id }, game);
    expect(clicked.effect).toEqual({ kind: "idle" });
    expect(clicked.moves).toBe(false);
    expect(clicked.menu).toBeUndefined();
    expect(clicked.cursor).toBe(0);
  });

  it("on a door's corridor or tag goes to that door's row, and spends nothing", () => {
    const game = run();
    const d3 = game.ship.door("d3");
    const svg = hexSvgOf(schematicInputOf(game), hexLayout(game.ship));
    expect(svg).toContain(`data-door="${d3.id}"`);
    const clicked = appReducer(playing(game), { kind: "door", id: d3.id }, game);
    const row = listOf(game, clicked)[clicked.cursor]!;
    expect(row.step === d3.id || (row.cmd.kind === "act" && row.cmd.target === d3.id)).toBe(true);
    expect(game.inputs).toEqual([]);
    // A door somewhere else is the nearer of its two compartments, clicked:
    // here the frost next door, which asks before it steps in.
    const far = appReducer(playing(game), { kind: "door", id: game.ship.door("d6").id }, game);
    expect(far.warned).toEqual({ ask: `travel:${game.ship.room("r5").id}`, door: game.ship.door("d4").id });
  });

  it("on a compartment nobody has named walks towards it, and with no way at all says so", () => {
    const game = run();
    game.ship.door("d5").state = "sealed";
    const reactor = game.ship.room("r7").id;
    game.ship.room("r7").scanned = false;
    game.refreshSight();
    const clicked = appReducer(playing(game), { kind: "room", id: reactor }, game);
    expect(clicked.effect.kind).not.toBe("pass");

    const cut = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2
      r1: docking explored
      r2: cargo explored
      r3: lab
    `).ship;
    const game2 = new RoomGame({ ...GAME_CONFIG, content: { ...SALVOR, monsterChance: () => 0 }, firstShip: () => cut, firstShipId: "1", seed: 3 });
    game2.player.room = game2.ship.room("r2").id;
    game2.refreshSight();
    const none = appReducer(playing(game2), { kind: "room", id: game2.ship.room("r3").id }, game2);
    expect(none.effect).toEqual({ kind: "log", text: "No route to r3." });
  });
});

/**
 * Why a click on a smoke- or frost-filled neighbour "worked badly": it was a
 * walk, and a walk's first question is a machine in sight. With one in view
 * the click stopped before the door naming no door, so the confirmation was
 * never remembered and every click asked the same thing again.
 */
describe("a click on a known hazard next door", () => {
  for (const [hazard, room, door] of [
    ["smoke", "r3", "d2"],
    ["frost", "r5", "d4"],
  ] as const) {
    it(`asks first and steps in second at ${hazard}, with a machine in sight or not`, () => {
      for (const watched of [false, true]) {
        const game = run();
        if (watched) put(game, "r1");
        const target = game.ship.room(room).id;
        const through = game.ship.door(door).id;

        if (watched) {
          // The old road: the walk stops on the machine and names no door.
          const walk = makeTraveller(target).step(game);
          expect(isStop(walk)).toBe(true);
          expect((walk as { door?: number }).door).toBeUndefined();
        }

        const first = appReducer(playing(game), { kind: "room", id: target }, game);
        expect(first.effect.kind, `${hazard} ${watched}`).toBe("log");
        expect((first.effect as { text: string }).text).toMatch(/Press again to go in\.$/);
        expect(first.warned).toEqual({ ask: `travel:${target}`, door: through });
        expect(first.menu).toBe(through);
        // Lit on the map, with the door on the way.
        expect(aimedAt(game, first)).toBe(target);
        expect([...mapAim(game, first).route]).toEqual([through]);

        const second = appReducer(first, { kind: "room", id: target }, game);
        expect(second.effect).toEqual({ kind: "command", cmd: { kind: "go", door: through } });
        expect(game.playerCommand({ kind: "go", door: through }).ok).toBe(true);
        expect(game.player.room).toBe(target);
      }
    });
  }
});

describe("the way a walk will take", () => {
  it("is drawn amber from the highlighted line, and from the box under the pointer", () => {
    const game = run();
    const lab = game.ship.room("r6").id;
    game.ship.room("r6").explored = true;
    game.refreshSight();
    const state = hovered(playing(game), lab);
    expect(aimedAt(game, state)).toBe(lab);
    const aim = mapAim(game, state);
    expect([...aim.route]).toEqual([game.ship.door("d4").id, game.ship.door("d6").id]);
    const svg = hexSvgOf(schematicInputOf(game, undefined, aim.room, aim.route), hexLayout(game.ship));
    expect(count(svg, "is-route")).toBeGreaterThanOrEqual(2);
    expect(WEB_CSS).toMatch(/\.hexmap \.door-wire\.is-route\{stroke:var\(--accent\)/);

    // And the whole corridor lights, not only the door in it: the rails carry
    // `is-route` too, which is his bracket down both edges of the run (G91 B).
    expect(count(svg, '<line class="hall-wall is-open is-route"')).toBeGreaterThanOrEqual(2);
    expect(WEB_CSS).toContain(".hexmap .hall-wall.is-route{stroke:var(--accent);}");

    // Nothing is spent by aiming, and the next key takes the aim back.
    expect(game.inputs).toEqual([]);
    expect(key(state, press("ArrowDown", "ArrowDown"), game).hover).toBeUndefined();
    // In front of a card there is no map to aim at.
    expect(hovered({ ...state, overlay: "help" }, lab).hover).toBeUndefined();
  });
});

/**
 * The partner's popover (G91 B, `renderHover` in his `04-hex`), on a board that
 * cannot have one: the readout is part of the same drawing as the rest of the
 * map, keyed on the compartment `schematicInputOf` was told to aim at. Which
 * means it answers the keyboard as well as the pointer — `m` down the travel
 * list narrates itself on the map — and that is the half of his idea we want,
 * since the numbered list stays.
 */
describe("the readout beside the compartment being aimed at", () => {
  function aimed(game: RoomGame, room: number): string {
    const state = hovered(playing(game), room);
    const aim = mapAim(game, state);
    return hexSvgOf(schematicInputOf(game, undefined, aim.room, aim.route), hexLayout(game.ship));
  }

  it("says what it is, what is in it, and what the walk costs — in the list's own words", () => {
    const game = run();
    game.ship.room("r6").explored = true;
    game.refreshSight();
    const svg = aimed(game, game.ship.room("r6").id);
    expect(count(svg, '<g class="room-readout">')).toBe(1);
    expect(svg).toContain(`>LAB r6</text>`);
    // Two doors away, said with the key the travel list already uses — so the
    // map and the numbered row are quoting one number, not two.
    expect(svg).toContain(`>${t("dist.doors", { n: 2 })}</text>`);
  });

  it("names the first shut door on the way rather than pricing a walk nobody can take", () => {
    const game = run();
    // The way to the lab runs d4 then d6. Weld the first of them: the number of
    // doors is no longer the useful sentence — which door, and what is wrong
    // with it, is (G91 B, his blocked branch).
    game.ship.door("d4").state = "sealed";
    game.refreshSight();
    const svg = aimed(game, game.ship.room("r6").id);
    expect(svg).toContain(`>${t("state.sealed")} · d4</text>`);
    expect(svg).not.toContain(`>${t("dist.doors", { n: 2 })}</text>`);
    // And the whole readout goes to the colour of trouble, not just the chip.
    expect(svg).toContain('<g class="room-readout is-shut">');
    expect(WEB_CSS).toContain(".hexmap .room-readout.is-shut .readout-chip{fill:var(--bad);}");
  });

  it("says no way when nothing reaches it, and drops only the cost on the cell underfoot", () => {
    const cut = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2
      r1: docking explored
      r2: cargo explored
      r3: lab
    `).ship;
    const game = new RoomGame({
      ...GAME_CONFIG,
      content: { ...SALVOR, monsterChance: () => 0 },
      firstShip: () => cut,
      firstShipId: "1",
      seed: 3,
    });
    game.player.room = game.ship.room("r2").id;
    game.refreshSight();
    expect(aimed(game, game.ship.room("r3").id)).toContain(`>${t("dist.none")}</text>`);
    // There is no walk to where you already are — but there is a compartment,
    // and what is in it is the same question as anywhere else on the board.
    // Hovering it used to answer nothing at all («при наведении на текущую
    // комнату ничего»); now it answers everything but the price.
    const here = aimed(game, game.ship.room("r2").id);
    expect(here).toContain('<g class="room-readout">');
    expect(here).toContain(">CARGO BAY r2</text>");
    expect(here).not.toContain("readout-chip");
  });

  it("never knows more than the cell it stands beside does", () => {
    const game = run();
    const svg = aimed(game, game.ship.room("r6").id);
    // r6 has never been found: the readout reads it the way its face does.
    expect(svg).toContain(">···· r6</text>");
    expect(svg).not.toContain(">LAB r6</text>");
  });

  it("stays inside the frame, whichever edge of the hull it is asked for", () => {
    const game = run();
    for (const label of ["r1", "r3", "r4", "r6", "r7"]) {
      const svg = aimed(game, game.ship.room(label).id);
      const [, bx, by, bw, bh] = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg)!.map(Number);
      const plate = /class="readout-plate" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="(\d+)"/.exec(svg);
      if (!plate) continue;
      const [, x, y, w, h] = plate.map(Number);
      expect(x!, label).toBeGreaterThanOrEqual(bx!);
      expect(y!, label).toBeGreaterThanOrEqual(by!);
      expect(x! + w!, label).toBeLessThanOrEqual(bx! + bw!);
      expect(y! + h!, label).toBeLessThanOrEqual(by! + bh!);
    }
  });

  it("takes no clicks, so the compartment under it is still the thing you press", () => {
    expect(WEB_CSS).toContain(".hexmap .room-readout{pointer-events:none;}");
    // And it is opaque: at .95 the name plate under it showed through as a
    // ghost, which is two rows of letters a twentieth apart («при наведении
    // текст наезжает»).
    expect(WEB_CSS).toContain(".hexmap .readout-plate{fill:var(--bg); stroke:var(--accent);");
    expect(WEB_CSS).not.toContain("readout-plate{fill:var(--bg); fill-opacity");
  });

  it("breaks its contents between things and counts what is left, never cutting a word", () => {
    const game = run();
    // Six things in one compartment: more than two rows of thirty characters
    // hold, so the last of them says how many went unsaid.
    const room = game.ship.room("r6");
    room.explored = true;
    room.data.bodies = [{ id: "b1" }, { id: "b2" }];
    room.data.crates = [{ id: "c1" }, { id: "c2" }, { id: "c3" }, { id: "c4" }];
    game.refreshSight();
    const svg = aimed(game, room.id);
    const rows = [...svg.matchAll(/class="readout-body"[^>]*>([^<]*)</g)].map((m) => m[1]!);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.length).toBeLessThanOrEqual(2);
    expect(svg).not.toContain("…");
    // Every row is whole words of the panel's own, and the tail is a count.
    const said = rows.join(" · ").split(" · ");
    const names = new Set(thingsIn(game, room.id).map((thing) => thing.name));
    for (const word of said) expect(names.has(word) || /^\+\d+$/.test(word), word).toBe(true);
    expect(said.at(-1)).toMatch(/^\+\d+$/);
  });

  it("stands clear of the cell it belongs to, and off the other compartments' names", () => {
    // Every compartment of every class, hovered in turn: the plate may never
    // cover the hexagon it is answering for, and on a lattice this tight it
    // keeps off the names of the rest by standing under their line, not on it.
    let covered = 0;
    let checked = 0;
    for (const spec of DERELICTS.slice(0, 4)) {
      for (const seed of [1, 2, 3]) {
        const ship = buildDerelict(spec, 3, new Rng(seed), { flags: new Set(), shipIndex: 2 }).ship;
        const game = new RoomGame({
          ...GAME_CONFIG,
          content: { ...SALVOR, monsterChance: () => 0 },
          firstShip: () => ship,
          firstShipId: "1",
          seed,
        });
        for (const r of game.ship.rooms) r.explored = true;
        game.player.room = game.ship.rooms[0]!.id;
        game.refreshSight();
        const layout = hexLayout(game.ship);
        for (const r of game.ship.rooms) {
          const state = hovered(playing(game), r.id);
          const aim = mapAim(game, state);
          const svg = hexSvgOf(schematicInputOf(game, undefined, aim.room, aim.route), layout, "", undefined, true);
          const plate = /class="readout-plate" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="(\d+)"/.exec(svg);
          expect(plate, `${spec.id} seed ${seed} ${r.label}`).not.toBeNull();
          const [x, y, w, h] = plate!.slice(1).map(Number) as [number, number, number, number];
          const cell = svg.slice(svg.indexOf(`data-room="${r.id}"`));
          const own = /class="room-box" points="([^"]+)"/.exec(cell.slice(0, cell.indexOf("</g>")))![1]!;
          const pts = own.split(" ").map((p) => p.split(",").map(Number) as [number, number]);
          const box = {
            x: Math.min(...pts.map((p) => p[0])),
            y: Math.min(...pts.map((p) => p[1])),
            w: Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])),
            h: Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])),
          };
          expect(
            over({ x, y, w, h }, box),
            `${spec.id} seed ${seed} ${r.label}: the readout is over its own cell`,
          ).toBe(false);
          for (const band of [...svg.matchAll(/class="room-band" x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="(\d+)"/g)]) {
            const [bx, by, bw, bh] = band.slice(1).map(Number) as [number, number, number, number];
            if (over({ x, y, w, h }, { x: bx, y: by, w: bw, h: bh })) covered++;
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    // One name in a hundred compartments, against every one of them before.
    expect(covered / checked).toBeLessThan(0.05);
  });
});

/** Do two rectangles share any ink at all. */
function over(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe("the highlight", () => {
  it("never rests on a greyed row while the list has a pressable one", () => {
    const moves = ["ArrowDown", "ArrowDown", "ArrowUp", "m", "ArrowDown", "d", "ArrowUp", "0", "Escape"];
    let checked = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const game = newGame(seed);
      let state = playing(game);
      for (let step = 0; step < 60; step++) {
        const k = moves[step % moves.length]!;
        state = key(state, press(k, k.length === 1 ? (/\d/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`) : k), game);
        // Now and then a row is pressed, so the tug's groups and the hulls' levels are visited too.
        if (step % 7 === 3) {
          const list = listOf(game, state);
          const at = list.findIndex((a) => a.step !== undefined && a.step !== null);
          if (at >= 0 && at < ACTION_KEYS.length) state = appReducer(state, { kind: "line", index: at }, game);
        }
        const list = listOf(game, state);
        if (list.some((a) => a.enabled)) {
          expect(list[state.cursor]?.enabled, `seed ${seed} step ${step} ${k}`).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("is dim, not amber, on a list with nothing to press, and a greyed row does not light under the pointer", () => {
    expect(WEB_CSS).toMatch(/\.act\.is-cursor\.is-off\{background:none;/);
    expect(WEB_CSS).toMatch(/\.act\.is-off:hover,\.act\.is-off:active\{background:none;/);
    const game = run();
    expect(roomActions(game).length).toBeGreaterThan(0);
  });
});

describe("the goal, in its own words", () => {
  const GOAL_KEYS = [
    "panel.goal",
    "panel.goal.bare",
    "panel.goal.done",
    "panel.goal.noTool",
    "panel.goal.towed",
    "board.worth",
    "charter.name.neutralize",
    "help.where.ship.1",
    "title.tagline",
  ] as const;

  it("says one verb for the goal in every place and never the old words, in three languages", () => {
    const verb = { en: /START/i, es: /ARRANC/i, ru: /ЗАПУ/i } as const;
    const old = /NEUTRALI|RAISE|ПОДЪЁМ|ПОДНЯТЬ|TAKEN|ВЗЯТ|TOMADO|EN LÍNEA|В СЕТИ|\bONLINE\b|is yours/i;
    for (const lang of ["en", "es", "ru"] as const) {
      setLang(lang);
      for (const k of GOAL_KEYS) expect(t(k, { cr: 120, up: 1, of: 3, price: 120 }), `${lang} ${k}`).not.toMatch(old);
      for (const k of ["panel.goal", "panel.goal.bare", "panel.goal.done", "board.worth", "charter.name.neutralize"] as const) {
        expect(t(k, { cr: 120, up: 1, of: 3, price: 120 }), `${lang} ${k}`).toMatch(verb[lang]);
      }
      // The price line and the rest fit the panel's 28 columns at the dearest hull.
      for (const k of ["panel.goal", "panel.goal.bare", "panel.goal.done", "panel.goal.out", "panel.goal.noTool", "panel.goal.towed"] as const) {
        expect(t(k, { cr: 9999 }).length, `${lang} ${k}`).toBeLessThanOrEqual(28);
      }
      // The run's summary says whether a hull was sold; the sale hint no longer
      // claims nobody sells modules while the dock has a shelf.
      expect(t("end.summary", { cr: 1, sold: 0, rooms: 2, turns: 3, kills: 4, burned: 5 })).toMatch(/0/);
      expect(t("hint.sell")).not.toMatch(/nobody sells|nadie revende|никто не продаёт/);
    }
    setLang("en");
  });
});
