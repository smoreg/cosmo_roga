import { hexAt, hexCentre, hexGeometry, hexKey } from "../hex";
import type { Axial } from "../hex";
import type { RawDeckExport } from "../deck";
import { createRng } from "../rng";
import type { RngState } from "../rng";
import { findContacts } from "./contacts";
import { pickDoors } from "./doors";
import { dressUp, zoneKind } from "./dress";
import { findRegions } from "./regions";
import { findStubs } from "./stubs";
import { MIN_OPEN, PX_FT, isFloorCell } from "./types";
import type { HullPlan, InkMask, MapCell, MapWall, MapZone, PlanTile } from "./types";

const NEIGHBOURS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: 1 },
  { q: 0, r: -1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
];

/** Which tile is under a point, in feet. Overlays are vehicles, not rooms. */
function tileAt(plan: HullPlan, x: number, y: number): PlanTile | null {
  for (let i = plan.put.length - 1; i >= 0; i--) {
    const placement = plan.put[i];
    if (placement === undefined || placement.tile.overlay === true) continue;
    if (x >= placement.x && x < placement.x + placement.w) {
      if (y >= placement.y && y < placement.y + placement.h) return placement.tile;
    }
  }
  return null;
}

export interface BuiltDeck {
  readonly deck: RawDeckExport;
  readonly zones: readonly MapZone[];
  readonly rng: RngState;
}

/**
 * A hull plan and its ink, turned into the same export `hexmap.html` writes.
 *
 * Producing that shape rather than a new one means `parseDeck` consumes a
 * generated deck and a hand-exported one through exactly the same path, and
 * every test written against the exports still means something.
 */
export function buildDeck(plan: HullPlan, mask: InkMask, hexFeet: number, seed: string): BuiltDeck {
  const regions = findRegions(mask);
  /* Column 0 on the keel, not on the corner of the picture. */
  const geometry = hexGeometry(hexFeet, mask.w / PX_FT / 2, 0);

  /* The rooms are the map. Every enclosed piece of floor is a zone whatever
     its size — a lattice laid over the ship afterwards must not decide which
     of its compartments exist. */
  const zones: MapZone[] = [];
  const zoneOf = new Map<number, number>();
  for (let region = 2; region < regions.sizes.length; region++) {
    const count = regions.sizes[region] ?? 0;
    if (count === 0) continue;
    const cx = (regions.sumX[region] ?? 0) / count / PX_FT;
    const cy = (regions.sumY[region] ?? 0) / count / PX_FT;
    const tile = tileAt(plan, cx, cy);
    const roles = tile?.tax?.roles ?? [];
    zoneOf.set(region, zones.length);
    zones.push({
      id: zones.length,
      region,
      cx,
      cy,
      roles,
      cells: [],
      area: Math.round(count / (PX_FT * PX_FT)),
      source: tile?.label ?? "",
      kind: zoneKind(roles),
      name: "",
      marks: [],
      hazard: "",
      sealed: false,
      entry: false,
    });
  }

  /* The hexagons are guidance laid on top: a coarse grid saying roughly where
     something is and how far there is to walk, not a floor plan. */
  const cells = new Map<string, MapCell>();
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      const region = regions.reg[y * mask.w + x] ?? -1;
      const at = hexAt(geometry, { x: x / PX_FT, y: y / PX_FT });
      const key = hexKey(at);
      let cell = cells.get(key);
      if (cell === undefined) {
        cell = {
          q: at.q,
          r: at.r,
          votes: new Map(),
          floor: 0,
          wall: 0,
          kind: "void",
          zone: -1,
          zones: [],
          reachable: false,
        };
        cells.set(key, cell);
      }
      if (region > 1) {
        cell.floor++;
        const zone = zoneOf.get(region);
        if (zone !== undefined) cell.votes.set(zone, (cell.votes.get(zone) ?? 0) + 1);
      } else if (region === -1) {
        cell.wall++;
      }
    }
  }

  for (const cell of cells.values()) {
    const covered = cell.floor + cell.wall;
    if (cell.floor === 0 || cell.floor < covered * MIN_OPEN) {
      cell.kind = covered > 0 ? "solid" : "void";
      continue;
    }
    let best = -1;
    let bestVotes = 0;
    for (const [zone, votes] of cell.votes) {
      if (votes > bestVotes) {
        best = zone;
        bestVotes = votes;
      }
    }
    if (best < 0) {
      cell.kind = "solid";
      continue;
    }
    cell.kind = "floor";
    cell.zone = best;
    cell.zones = [...cell.votes.keys()].sort(function mostFloorFirst(a, b) {
      return (cell.votes.get(b) ?? 0) - (cell.votes.get(a) ?? 0);
    });
    zones[best]?.cells.push(cell);
  }

  const cellList = [...cells.values()];
  const byKey = new Map<string, MapCell>();
  for (const cell of cellList) byKey.set(hexKey(cell), cell);

  /* From here the lattice is the structure. A wall is the edge between two
     hexagons in different rooms; the hull is the edge between a hexagon and
     the vacuum; a door is a wall with a way through. */
  const walls: MapWall[] = [];
  for (const cell of cellList) {
    if (cell.kind !== "floor") continue;
    for (const step of NEIGHBOURS) {
      const at = { q: cell.q + step.q, r: cell.r + step.r };
      const neighbour = byKey.get(hexKey(at));
      const outside = neighbour === undefined ? true : !isFloorCell(neighbour);
      if (!outside && neighbour !== undefined) {
        if (neighbour.zone === cell.zone) continue;
        if (at.q < cell.q || (at.q === cell.q && at.r < cell.r)) continue;
      }
      const here = hexCentre(geometry, cell);
      const there = hexCentre(geometry, at);
      walls.push({
        a: cell,
        b: outside || neighbour === undefined ? null : neighbour,
        hull: outside,
        mx: (here.x + there.x) / 2,
        my: (here.y + there.y) / 2,
        door: null,
      });
    }
  }

  const contacts = findContacts(mask, regions);
  const stubs = findStubs(plan, mask, regions, zoneOf);
  const [doors, afterDoors] = pickDoors(contacts, zoneOf, zones, walls, stubs, createRng(seed));
  const rng = dressUp(zones, cellList, byKey, walls, afterDoors);

  return { deck: serialise(plan, zones, cellList, doors, hexFeet, seed), zones, rng };
}

function serialise(
  plan: HullPlan,
  zones: readonly MapZone[],
  cells: readonly MapCell[],
  doors: readonly {
    id: number;
    a: number;
    b: number;
    tree: boolean;
    state: string;
    wall: MapWall;
  }[],
  hexFeet: number,
  seed: string,
): RawDeckExport {
  return {
    seed,
    ship: { name: plan.name, ft: [plan.W, plan.H] },
    hex: { feetAcross: hexFeet },
    zones: zones.map(function toZone(zone) {
      return {
        id: zone.id,
        name: zone.name,
        kind: zone.kind,
        roles: [...zone.roles],
        areaSqFt: zone.area,
        hazard: zone.hazard === "" ? null : zone.hazard,
        entry: zone.entry,
        sealed: zone.sealed,
        marks: [...zone.marks],
        from: zone.source,
      };
    }),
    hexes: cells.filter(isFloorCell).map(function toCell(cell) {
      return { q: cell.q, r: cell.r, zone: cell.zone, over: [...cell.zones] };
    }),
    doors: doors.map(function toDoor(door) {
      return {
        id: door.id,
        a: door.a,
        b: door.b,
        state: door.state,
        loop: !door.tree,
        at: [Math.round(door.wall.mx), Math.round(door.wall.my)] as [number, number],
        from: [door.wall.a.q, door.wall.a.r] as [number, number],
        to: door.wall.b === null ? null : ([door.wall.b.q, door.wall.b.r] as [number, number]),
      };
    }),
    /* Overlays ride along here, unlike everywhere else. The ink mask must not
       see them — a crate is not a bulkhead and would cut the room it sits in —
       but the blueprint under the lattice should draw them, because furniture
       is most of what makes a compartment look like somewhere. */
    plan: plan.put.map(function toPlacement(placement) {
      return { path: placement.tile.path, x: placement.x, y: placement.y, rot: placement.rot };
    }),
  };
}
