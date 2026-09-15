import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { linesOf, reveal } from "../reveal.js";
import * as FX from "../../fx/derelict-fx.js";

/**
 * The board: one hexagon per compartment, one drone, and no action list.
 *
 * The state of a cell is how much the drone knows about it, and the amount of
 * information on the face *is* that encoding — backed up by colour and by the
 * band's pattern rather than carried by them:
 *
 *   undetected  nothing. a shape in the dark, no label, no contents
 *   detected    the name only, on a striped band — a label, not a look
 *   monitored   the name and everything in it, on a solid band
 *   current     the drone is inside. the same again, amber, drone on top
 *
 * Every object on the board is its own affordance: hover it for what it is and
 * what you could do to it, click it to do that. You cannot attack a crate, so a
 * crate never offers attack — which means the interface never has to enumerate
 * verbs nobody was going to use.
 *
 * The component knows no rules. Verbs arrive already decided on each thing, and
 * routes arrive from `route`, because whether a door can be walked through is
 * the engine's business and a second opinion here is a second implementation.
 */

export type Knows = "undetected" | "detected" | "monitored" | "current";

const STATE: Record<
  Knows,
  { line: string; fill: string; band: string | null; shows: boolean; strong?: boolean }
> = {
  undetected: { line: "var(--sv-rule)", fill: "var(--sv-knock)", band: null, shows: false },
  detected: {
    line: "var(--sv-bulkhead)",
    fill: "var(--sv-void)",
    band: "repeating-linear-gradient(90deg, var(--sv-soft) 0 5px, #7d8891 5px 10px)",
    shows: false,
  },
  monitored: { line: "var(--sv-zone)", fill: "var(--sv-deck)", band: "var(--sv-zone)", shows: true },
  current: {
    line: "var(--sv-amber)",
    fill: "color-mix(in oklab, var(--sv-amber) 16%, var(--sv-deck))",
    band: "var(--sv-amber)",
    shows: true,
    strong: true,
  },
};

/** A compartment property, on its own channel: a dashed ring whose *rhythm*
 *  says which, so the reading does not rest on colour alone. */
const PROP: Record<string, { c: string; dash: [number, number]; fill?: string }> = {
  hazard: { c: "var(--sv-bad)", dash: [6, 4], fill: "var(--sv-red-wash)" },
  vented: { c: "var(--sv-zone)", dash: [15, 7] },
  dark: { c: "var(--sv-soft)", dash: [3, 10] },
  alarmed: { c: "var(--sv-warn)", dash: [4, 3], fill: "var(--sv-amber-wash)" },
};

/**
 * What a thing is drawn as.
 *
 * Shapes, never letters — a letter has to be read and a shape is seen. The
 * engine speaks in glyphs, so this is the one place the two vocabularies meet,
 * and it falls back rather than failing: an unknown machine is still a machine
 * and an unknown object is still an object.
 */
function shapeOf(thing: BoardThing): string | undefined {
  if (thing.hostile === true) {
    if (thing.glyph === "c") return "polygon(50% 0,100% 100%,0 100%)";
    if (thing.glyph === "d") return "polygon(50% 0,100% 50%,50% 100%,0 50%)";
    return "polygon(50% 0,100% 35%,82% 100%,18% 100%,0 35%)";
  }
  if (thing.glyph === "X") return undefined; // a crate is a square
  if (thing.glyph === "+") return "polygon(0 0,100% 0,100% 72%,62% 72%,62% 100%,38% 100%,38% 72%,0 72%)";
  return "circle(50%)";
}

export interface BoardThing {
  /** Stable enough to key a row and to name in a command. */
  id: string;
  glyph: string;
  name: string;
  hostile?: true;
  /** What clicking it would spend, already decided by the engine. */
  verb?: string;
  /** What that costs, in the engine's own words: "8 cr", "2 turns", "loud". */
  note?: string;
  threat?: number;
}

export interface BoardRoom {
  id: number;
  label: string;
  name: string;
  knows: Knows;
  q: number;
  r: number;
  things: readonly BoardThing[];
  props: readonly string[];
}

export interface BoardDoor {
  id: number;
  label: string;
  a: number;
  b: number;
  state: string;
  /**
   * Every way through it, from the engine.
   *
   * `index` is how a click finds its command again: the view never holds a
   * `RoomCommand` it might edit, it holds the engine's place in its own list.
   */
  verbs: readonly { index: number; verb: string; note: string; enabled: boolean }[];
}

interface DoorInk {
  c: string;
  bars: number;
  lock?: true;
}
const SHUT: DoorInk = { c: "var(--sv-bulkhead)", bars: 1 };
const DOOR_INK: Record<string, DoorInk | undefined> = {
  open: { c: "var(--sv-zone)", bars: 0 },
  closed: { c: "var(--sv-bulkhead)", bars: 1 },
  locked: { c: "var(--sv-amber)", bars: 2 },
  sealed: { c: "var(--sv-burned)", bars: 3 },
  broken: { c: "var(--sv-burned)", bars: 0 },
  airlock: { c: "var(--sv-airlock)", bars: 0, lock: true },
};

const RATIO = 1.1547; // pointy-top: point-to-point height over flat-to-flat width
const HEX = "var(--sv-hex)";
const PTS = "50,1.5 98.5,29.7 98.5,85.8 50,113.9 1.5,85.8 1.5,29.7";

function HexRing({
  stroke,
  width = 2.6,
  dash,
}: {
  stroke: string;
  width?: number;
  dash?: string;
}): ReactElement {
  return (
    <svg
      viewBox="0 0 100 115.47"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      <polygon
        points={PTS}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeDasharray={dash}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * A cell can hold nine machines and still be 118px wide, so chips are grouped
 * by what they are and counted rather than drawn one per body. Nine scouts is
 * one triangle reading 9, which is also the more useful sentence.
 */
interface Chip {
  kind: string;
  n: number;
  thing: BoardThing;
}
function group(things: readonly BoardThing[]): Chip[] {
  const out: Chip[] = [];
  const by = new Map<string, Chip>();
  for (const thing of things) {
    const kind = `${thing.glyph}${thing.hostile === true ? "!" : ""}`;
    const seen = by.get(kind);
    if (seen !== undefined) {
      seen.n += 1;
      /* A chip standing for several bodies cannot borrow one body's name —
         "scout 1 ×3" names a thing that does not exist. */
      seen.thing = { ...seen.thing, name: plural(seen.thing.name) };
      continue;
    }
    const chip: Chip = { kind, n: 1, thing };
    by.set(kind, chip);
    out.push(chip);
  }
  return out;
}
function plural(name: string): string {
  return name.endsWith("s") ? name : `${name}s`;
}

/** Everything that exists only while something is hovered: it draws its own
 *  border out from the middle of each edge and resolves its text, both on
 *  mount, so appearing is the animation and there is no state to keep. */
export function Popover({
  tone = "var(--sv-amber)",
  children,
  style,
}: {
  tone?: string;
  children?: React.ReactNode;
  style?: CSSProperties;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(function resolve() {
    if (ref.current === null) return;
    return reveal(linesOf(ref.current), FX.PRESETS.hover);
  }, []);
  const line = (o: CSSProperties, axis: "x" | "y"): CSSProperties => ({
    position: "absolute",
    background: tone,
    zIndex: 3,
    pointerEvents: "none",
    transformOrigin: "center",
    animation: `sv-draw-${axis} var(--sv-frame) var(--sv-step) 1 both`,
    ...o,
  });
  return (
    <div ref={ref} style={{ position: "relative", background: "var(--sv-knock)", ...style }}>
      <div style={line({ left: 0, right: 0, top: 0, height: 2 }, "x")} />
      <div style={line({ left: 0, right: 0, bottom: 0, height: 2 }, "x")} />
      <div style={line({ top: 0, bottom: 0, left: 0, width: 2 }, "y")} />
      <div style={line({ top: 0, bottom: 0, right: 0, width: 2 }, "y")} />
      {children}
    </div>
  );
}

const STENCIL: CSSProperties = {
  font: "var(--sv-stencil)",
  fontSize: 14,
  letterSpacing: ".14em",
  textTransform: "uppercase",
};

/** What a hover is allowed to say: what it is, how many, how bad, and the one
 *  verb a click would spend. */
function Readout({ chip }: { chip: Chip }): ReactElement {
  const t = chip.thing;
  const tone = t.hostile === true ? "var(--sv-bad)" : "var(--sv-amber)";
  return (
    <Popover
      tone={tone}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 10px",
        whiteSpace: "nowrap",
      }}
    >
      <span
        data-sc
        style={{
          ...STENCIL,
          letterSpacing: ".12em",
          color:
            t.hostile === true
              ? "color-mix(in oklab, var(--sv-bad) 26%, var(--sv-ink))"
              : "var(--sv-ink)",
        }}
      >
        {chip.n > 1 ? `${t.name} ×${chip.n}` : t.name}
      </span>
      {t.hostile === true ? (
        <span style={{ display: "flex", gap: 3 }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: 7,
                height: 12,
                background: i < (t.threat ?? 1) ? "var(--sv-bad)" : "var(--sv-plate-lit)",
              }}
            />
          ))}
        </span>
      ) : t.note === undefined ? null : (
        <span data-sc style={{ font: "var(--sv-body)", color: "var(--sv-soft)" }}>
          {t.note}
        </span>
      )}
      {t.verb === undefined ? (
        <span data-sc style={{ ...STENCIL, color: "var(--sv-soft)" }}>
          go there first
        </span>
      ) : (
        <span data-sc style={{ ...STENCIL, background: tone, color: "var(--sv-knock)", padding: "2px 6px" }}>
          {t.verb}
        </span>
      )}
    </Popover>
  );
}

/** The drone crowns its hex, so it never competes with the cell's own contents
 *  for the middle. `data-fx-face` is the child a move scrambles. */
export function DroneMark({
  size = 40,
  style,
  innerRef,
}: {
  size?: number;
  style?: CSSProperties;
  innerRef?: React.Ref<HTMLDivElement>;
}): ReactElement {
  return (
    <div
      ref={innerRef}
      style={{ position: "relative", width: size, height: Math.round(size * RATIO), ...style }}
    >
      <div style={{ position: "absolute", inset: 0, clipPath: HEX, background: "var(--sv-amber)" }} />
      <div
        data-fx-face
        style={{
          position: "absolute",
          inset: 3,
          clipPath: HEX,
          background: "var(--sv-knock)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          font: "var(--sv-stencil)",
          fontSize: 14,
          letterSpacing: 0,
          color: "var(--sv-amber)",
        }}
      >
        ◆
      </div>
    </div>
  );
}

function HexTile({
  room,
  size,
  hot,
  step,
  onClick,
  onEnter,
  onLeave,
  onAct,
  style,
}: {
  room: BoardRoom;
  size: number;
  hot: boolean;
  step: { n: number; last: boolean } | null;
  onClick: () => void;
  onEnter: () => void;
  onLeave: () => void;
  onAct?: (thing: BoardThing) => void;
  style?: CSSProperties;
}): ReactElement {
  const s = STATE[room.knows];
  const [tip, setTip] = useState<Chip | null>(null);

  /* A hovered thing that dies unmounts its own chip, so no pointer ever leaves
     it and the readout stands there naming something that is not on the ship
     any more. The board re-reads the game every turn; this drops the readout on
     the same frame the thing it was about goes. */
  useEffect(
    function forget() {
      if (tip === null) return;
      const still = room.things.some((t) => t.id === tip.thing.id);
      if (!still) setTip(null);
    },
    [room.things, tip],
  );
  const [seq, setSeq] = useState(0);
  const h = Math.round(size * RATIO);
  const ring = s.shows ? room.props.map((p) => PROP[p]).filter((p) => p !== undefined)[0] : undefined;
  const fill = ring?.fill ?? s.fill;
  const loot = s.shows ? group(room.things.filter((t) => t.hostile !== true)) : [];
  const foes = s.shows ? group(room.things.filter((t) => t.hostile === true)) : [];
  const base = s.strong === true || hot ? 2.5 : 1.5;
  /* The band is the hex's full inset width, so the budget is the assembled
     line against the band rather than each word against a guess. */
  const chars = Math.floor((size - 8) / 8.4);
  const named = room.knows !== "undetected" ? room.name : "";
  const fit = named.length > chars ? named.slice(0, chars) : named;

  const chip = (c: Chip, px: number): ReactElement => (
    <div
      key={c.kind}
      onMouseEnter={() => {
        setTip(c);
        setSeq((n) => n + 1);
      }}
      onMouseLeave={() => setTip(null)}
      onClick={
        c.thing.verb === undefined || onAct === undefined
          ? undefined
          : (e) => {
              e.stopPropagation();
              onAct(c.thing);
            }
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        cursor: c.thing.verb === undefined ? "help" : "pointer",
      }}
    >
      <div
        style={{
          width: px,
          height: px,
          flex: "none",
          background: c.thing.hostile === true ? "var(--sv-bad)" : "var(--sv-amber)",
          clipPath: shapeOf(c.thing),
        }}
      />
      {c.n > 1 ? (
        <div
          style={{
            font: "var(--sv-stencil)",
            fontSize: 14,
            letterSpacing: 0,
            lineHeight: 1,
            color:
              c.thing.hostile === true
                ? "color-mix(in oklab, var(--sv-bad) 26%, var(--sv-ink))"
                : "var(--sv-amber-hi)",
          }}
        >
          {c.n}
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        position: "relative",
        width: size,
        height: h,
        pointerEvents: "none",
        ...style,
        zIndex: tip === null ? style?.zIndex : 40,
      }}
    >
      {/* The shaped hit area. Everything visible is painted by siblings; this
          exists only so the hexagon — not its bounding box — takes the pointer. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: HEX,
          pointerEvents: "auto",
          cursor: "pointer",
          zIndex: 5,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: HEX,
          background: s.line,
          opacity: room.knows === "undetected" ? 0.55 : 1,
        }}
      />
      {hot ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            animation: "sv-hex-grow var(--sv-frame) var(--sv-step) 1 both",
            pointerEvents: "none",
            zIndex: 3,
          }}
        >
          {/* Amber means exactly one thing on this board — the drone is here —
              so a hover highlights in the rim colour instead. */}
          <HexRing stroke="var(--sv-rim)" width={3} />
        </div>
      ) : null}
      {step === null ? null : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            animation: `sv-step-in var(--sv-frame) var(--sv-step) ${(step.n - 1) * 112}ms 1 both`,
            pointerEvents: "none",
            zIndex: 3,
          }}
        >
          <HexRing
            stroke="var(--sv-amber)"
            width={step.last ? 3.4 : 2.6}
            dash={step.last ? undefined : "7 6"}
          />
        </div>
      )}
      <div style={{ position: "absolute", inset: base, clipPath: HEX, background: fill }} />
      <div style={{ position: "absolute", inset: base, clipPath: HEX, background: "var(--sv-scan)" }} />
      {ring === undefined ? null : (
        <>
          <div
            style={{
              position: "absolute",
              inset: base + 6,
              clipPath: HEX,
              background: `repeating-linear-gradient(90deg, ${ring.c} 0 ${ring.dash[0]}px, transparent ${ring.dash[0]}px ${ring.dash[0] + ring.dash[1]}px)`,
            }}
          />
          <div style={{ position: "absolute", inset: base + 9, clipPath: HEX, background: fill }} />
          <div
            style={{ position: "absolute", inset: base + 9, clipPath: HEX, background: "var(--sv-scan)" }}
          />
        </>
      )}

      <div
        style={{
          position: "absolute",
          inset: base,
          clipPath: HEX,
          pointerEvents: "auto",
          zIndex: 6,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Slots never move: loot above the band, the name in it, machines
            below it, the drone crowning the hex. */}
        <div style={{ height: 20, display: "flex", alignItems: "center", gap: 5 }}>
          {loot.map((c) => chip(c, 15))}
        </div>
        {s.band === null ? (
          <div style={{ height: 20 }} />
        ) : (
          <div style={{ alignSelf: "stretch", background: s.band, padding: "3px 0", textAlign: "center" }}>
            <span
              style={{
                font: "var(--sv-stencil)",
                fontSize: 14,
                letterSpacing: 0,
                textTransform: "uppercase",
                color: "var(--sv-knock)",
                whiteSpace: "nowrap",
              }}
            >
              {fit}
            </span>
          </div>
        )}
        <div style={{ height: 22, display: "flex", alignItems: "center", gap: 5 }}>
          {foes.map((c) => chip(c, 17))}
        </div>
      </div>

      {tip === null ? null : (
        <div
          key={seq}
          style={{
            position: "absolute",
            left: size + 10,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 60,
            pointerEvents: "none",
          }}
        >
          <Readout chip={tip} />
        </div>
      )}
    </div>
  );
}

export interface Route {
  /** Room ids from the drone's neighbour to the destination, in order. */
  path: readonly number[];
  /** The first door in the way, when the walk cannot be made as it stands. */
  blocked: BoardDoor | null;
}

export function HexBoard({
  rooms,
  doors,
  drone,
  route,
  size = 118,
  spread = 1.3,
  onWalk,
  onAct,
  onDoorAct,
  style,
}: {
  rooms: readonly BoardRoom[];
  doors: readonly BoardDoor[];
  drone: number | null;
  /** What walking to a room would take. The engine's answer, not the board's. */
  route: (to: number) => Route | null;
  size?: number;
  spread?: number;
  onWalk?: (to: number, path: readonly number[]) => void;
  onAct?: (room: BoardRoom, thing: BoardThing) => void;
  onDoorAct?: (door: BoardDoor, index: number) => void;
  style?: CSSProperties;
}): ReactElement {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<number | null>(null);
  const [door, setDoor] = useState<number | null>(null);
  /* A menu that only lives while the pointer is on it is a menu you race. A
     click pins it: nothing but another click or a choice takes it down, so the
     pointer can go the long way round and still arrive. */
  const [pinned, setPinned] = useState(false);
  const [barred, setBarred] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const droneRef = useRef<HTMLDivElement>(null);
  const fx = useRef<FX.Running | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(
    () => () => {
      fx.current?.cancel();
    },
    [],
  );

  /* A menu offset clear of its door leaves a gap the pointer has to cross, and
     leaving the door was closing the menu before the pointer got there. Two
     frames of grace: long enough to cross, short enough never to feel stuck. */
  const doorTimer = useRef<number | null>(null);
  const holdDoor = (): void => {
    if (doorTimer.current !== null) window.clearTimeout(doorTimer.current);
    doorTimer.current = null;
  };
  const dropDoor = (): void => {
    if (pinned) return;
    holdDoor();
    doorTimer.current = window.setTimeout(() => setDoor(null), 450);
  };
  const shutDoor = (): void => {
    holdDoor();
    setPinned(false);
    setDoor(null);
  };

  const W = size * spread;
  const H = size * RATIO * spread;
  const ROW = H * 0.75;
  const hexH = Math.round(size * RATIO);

  const byId = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  const centre = (r: BoardRoom): { x: number; y: number } => ({
    x: (r.q + r.r / 2) * W + W,
    y: r.r * ROW + H,
  });

  const box = useMemo(() => {
    const pts = rooms.map(centre);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      w: Math.max(...xs, 0) + W,
      h: Math.max(...ys, 0) + H,
      x0: Math.min(...xs, 0),
      y0: Math.min(...ys, 0),
    };
  }, [rooms, W, H]);

  const walk = hover === null || hover === drone ? null : route(hover);
  const path = walk?.path ?? null;
  const blocked = walk?.blocked ?? null;

  const stepOf = (id: number): number => (path === null ? -1 : path.indexOf(id));
  const onPath = (a: number, b: number): number => {
    if (path === null || drone === null) return -1;
    const full = [drone, ...path];
    for (let i = 0; i < full.length - 1; i++) {
      if ((full[i] === a && full[i + 1] === b) || (full[i] === b && full[i + 1] === a)) return i;
    }
    return -1;
  };

  /* One teleport per compartment: the drone dissolves out of each room and
     reassembles in the next, so a three-room walk reads as three hops. The pip
     is placed imperatively while it plays so React is not fighting it; the
     caller commits the new position when it lands. */
  const hop = (el: HTMLElement, ids: readonly number[], i: number, done: () => void): FX.Running => {
    const room = byId.get(ids[i] as number);
    if (room === undefined) {
      done();
      return { cancel: () => undefined };
    }
    const c = centre(room);
    return FX.teleport(
      el,
      { left: c.x - 20, top: c.y - hexH / 2 - 24 },
      {
        faceEl: el.querySelector("[data-fx-face]"),
        label: "◆",
        onDone: () => {
          if (i + 1 < ids.length) {
            fx.current = hop(el, ids, i + 1, done);
            return;
          }
          done();
        },
      },
    );
  };

  const go = (to: number): void => {
    const here = route(to);
    if (here === null || here.path.length === 0) return;
    if (here.blocked !== null) {
      setBarred(here.blocked.id);
      return;
    }
    setBarred(null);
    const el = droneRef.current;
    if (el === null) {
      onWalk?.(to, here.path);
      return;
    }
    fx.current?.cancel();
    setMoving(true);
    fx.current = hop(el, here.path, 0, () => {
      setMoving(false);
      onWalk?.(to, here.path);
    });
  };

  const at = (x: number, y: number): CSSProperties => ({
    left: `calc(50% + ${pan.x + x - box.w / 2}px)`,
    top: `calc(50% + ${pan.y + y - box.h / 2}px)`,
  });

  const here = drone === null ? undefined : byId.get(drone);

  return (
    <div
      onPointerDown={(e) => {
        if (e.button !== 2) return;
        drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d === null) return;
        setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onContextMenu={(e) => e.preventDefault()}
      onClick={shutDoor}
      onDoubleClick={() => setPan({ x: 0, y: 0 })}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        touchAction: "none",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: box.w,
          height: box.h,
          transform: `translate(-50%,-50%) translate(${pan.x}px,${pan.y}px)`,
        }}
      >
        {doors.map((d) => {
          const a = byId.get(d.a);
          const b = byId.get(d.b);
          if (a === undefined || b === undefined || d.a === d.b) return null;
          const p = centre(a);
          const q = centre(b);
          const len = Math.hypot(q.x - p.x, q.y - p.y);
          const ang = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
          const ink: DoorInk = DOOR_INK[d.state] ?? SHUT;
          const n = onPath(d.a, d.b);
          const shut = blocked?.id === d.id;
          return (
            <div key={d.id}>
              <div
                onMouseEnter={() => {
                  if (pinned) return;
                  holdDoor();
                  setDoor(d.id);
                }}
                onMouseLeave={dropDoor}
                onClick={(e) => {
                  e.stopPropagation();
                  holdDoor();
                  setDoor(d.id);
                  setPinned(true);
                }}
                style={{
                  position: "absolute",
                  left: p.x,
                  top: p.y - 9,
                  width: len,
                  height: 18,
                  transform: `rotate(${ang}deg)`,
                  transformOrigin: "0 50%",
                  zIndex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: "50%",
                    height: 11,
                    transform: "translateY(-50%)",
                    background: "var(--sv-deck)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: "50%",
                    height: 2,
                    transform: "translateY(-50%)",
                    background: ink.c,
                    opacity: ink.bars > 0 ? 0.7 : 0.9,
                  }}
                />
                {n < 0 ? null : (
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: "50%",
                      height: 12,
                      transform: "translateY(-50%)",
                      animation: `sv-step-in var(--sv-frame) var(--sv-step) ${n * 112}ms 1 both`,
                    }}
                  >
                    {[0, 1].map((k) => (
                      <div
                        key={k}
                        style={{
                          position: "absolute",
                          left: 0,
                          right: 0,
                          [k === 0 ? "top" : "bottom"]: 0,
                          height: 2,
                          background: shut ? "var(--sv-bad)" : "var(--sv-amber)",
                        }}
                      />
                    ))}
                  </div>
                )}
                {Array.from({ length: ink.bars }).map((_, k) => (
                  <div key={k} style={{ position: "relative", width: 3, height: 17, background: ink.c }} />
                ))}
                {ink.lock === true ? (
                  <div
                    style={{
                      position: "relative",
                      width: 11,
                      height: 11,
                      background: ink.c,
                      clipPath: "polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)",
                    }}
                  />
                ) : null}
              </div>
              {shut || barred === d.id ? (
                <div
                  style={{
                    position: "absolute",
                    left: (p.x + q.x) / 2,
                    top: (p.y + q.y) / 2,
                    transform: "translate(-50%,-50%) rotate(45deg)",
                    width: 25,
                    height: 25,
                    border: "2.5px solid var(--sv-bad)",
                    boxSizing: "border-box",
                    zIndex: 9,
                    pointerEvents: "none",
                    animation: "sv-flick var(--sv-frame-2) var(--sv-step) infinite",
                  }}
                />
              ) : null}
            </div>
          );
        })}

        {rooms.map((room) => {
          const c = centre(room);
          const n = stepOf(room.id);
          return (
            <HexTile
              key={room.id}
              room={room}
              size={size}
              hot={hover === room.id}
              step={n < 0 || path === null ? null : { n: n + 1, last: n === path.length - 1 }}
              onEnter={() => {
                if (!moving) setHover(room.id);
              }}
              onLeave={() => {
                if (!moving) {
                  setHover(null);
                  setBarred(null);
                }
              }}
              onAct={onAct === undefined ? undefined : (thing) => onAct(room, thing)}
              onClick={() => {
                if (room.id === drone) return;
                go(room.id);
              }}
              style={{
                position: "absolute",
                left: c.x - size / 2,
                top: c.y - hexH / 2,
                zIndex: room.knows === "current" ? 5 : 4,
              }}
            />
          );
        })}
      </div>

      {/* The drone lives outside the panned wrapper, positioned with left/top
          rather than a transform, so board pixels stay board pixels while a
          move plays. */}
      <div
        style={{
          position: "absolute",
          left: `calc(50% + ${pan.x - box.w / 2}px)`,
          top: `calc(50% + ${pan.y - box.h / 2}px)`,
          width: box.w,
          height: box.h,
          zIndex: 65,
          pointerEvents: "none",
        }}
      >
        {here === undefined ? null : (
          <DroneMark
            innerRef={droneRef}
            style={{
              position: "absolute",
              left: centre(here).x - 20,
              top: centre(here).y - hexH / 2 - 24,
            }}
          />
        )}
      </div>

      {door === null ? null : (
        (() => {
          const d = doors.find((x) => x.id === door);
          const a = d === undefined ? undefined : byId.get(d.a);
          const b = d === undefined ? undefined : byId.get(d.b);
          if (d === undefined || a === undefined || b === undefined) return null;
          const p = centre(a);
          const q = centre(b);
          const ink: DoorInk = DOOR_INK[d.state] ?? SHUT;
          const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
          const nx = -(q.y - p.y) / len;
          const ny = (q.x - p.x) / len;
          const sideways = Math.abs(nx) >= Math.abs(ny);
          const mx = (p.x + q.x) / 2 + (sideways ? (nx >= 0 ? 26 : -26) : 0);
          const my = (p.y + q.y) / 2 + (sideways ? 0 : ny >= 0 ? 26 : -26);
          const anchor = sideways
            ? nx >= 0
              ? "translate(0,-50%)"
              : "translate(-100%,-50%)"
            : ny >= 0
              ? "translate(-50%,0)"
              : "translate(-50%,-100%)";
          return (
            <Popover
              tone={ink.c}
              style={{ position: "absolute", ...at(mx, my), transform: anchor, zIndex: 70, minWidth: 200 }}
            >
              <div onMouseEnter={holdDoor} onMouseLeave={dropDoor} onClick={(e) => e.stopPropagation()}>
                <div
                  style={{ display: "flex", alignItems: "center", gap: 9, padding: "4px 9px", background: ink.c }}
                >
                  <span data-sc style={{ ...STENCIL, color: "var(--sv-knock)" }}>
                    {d.label}
                  </span>
                  <span data-sc style={{ ...STENCIL, marginLeft: "auto", color: "var(--sv-knock)", opacity: 0.8 }}>
                    {d.state}
                  </span>
                </div>
                <div style={{ background: "var(--sv-scan)" }}>
                  {d.verbs.length === 0 ? (
                    <div data-sc style={{ ...STENCIL, padding: "4px 9px", color: "var(--sv-soft)" }}>
                      not from here
                    </div>
                  ) : (
                    d.verbs.map((v) => (
                      <div
                        key={v.index}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!v.enabled) return;
                          shutDoor();
                          onDoorAct?.(d, v.index);
                        }}
                        onMouseEnter={(e) => {
                          if (!v.enabled) return;
                          e.currentTarget.style.background =
                            "color-mix(in oklab, var(--sv-amber) 16%, transparent)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "4px 9px",
                          cursor: v.enabled ? "pointer" : "not-allowed",
                          opacity: v.enabled ? 1 : 0.45,
                        }}
                      >
                        <span data-sc style={{ font: "var(--sv-body)", color: "var(--sv-ink)" }}>
                          {v.verb}
                        </span>
                        <span
                          data-sc
                          style={{
                            ...STENCIL,
                            marginLeft: "auto",
                            letterSpacing: ".1em",
                            color: v.enabled ? "var(--sv-soft)" : "var(--sv-bad)",
                          }}
                        >
                          {v.note}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </Popover>
          );
        })()
      )}

      <div
        style={{
          position: "absolute",
          right: 12,
          bottom: 10,
          ...STENCIL,
          color: "var(--sv-soft)",
          pointerEvents: "none",
        }}
      >
        right-drag to pan · hover a room for the route
      </div>
    </div>
  );
}
