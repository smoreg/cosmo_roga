import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { linesOf, reveal } from "../reveal.js";
import { DroneIcon, ThingIcon } from "./Icon.js";
import * as FX from "../../fx/derelict-fx.js";
import { tileUrl } from "../deckindex.js";

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

export type Knows = "undetected" | "detected" | "monitored" | "current" | "wrecked";

/**
 * How much bigger the file is than the deck in it: ten feet of bleed on every
 * side of a hundred-foot section. Drawing the whole file leaves a tenth of the
 * hexagon empty all the way round.
 */
const DECK_SCALE = 1.2;

/**
 * How plainly a compartment's floor is drawn, by how much is known about it.
 *
 * The hull is there whether or not the drone has been down it, and a ship
 * whose unvisited half is blank reads as a ship half-built. So every
 * compartment wears its deck, and only the light on it changes.
 *
 * **Nothing here is blurred, and that is deliberate.** A tile is chosen from
 * the compartment's kind, so a player who comes to know the catalogue can read
 * an unscanned room off its floor — a reactor deck looks like machinery from
 * across the hull. That was very nearly hidden behind a haze on the grounds
 * that the board must not out-know the game, and it is the wrong rule for this
 * case: the board is not telling anyone anything, it is drawing the ship
 * accurately, and what a careful player makes of an accurate drawing is theirs.
 * A game that hides what is genuinely there to be noticed teaches nobody to
 * look. Deliberate: `tests/react-screens.test.tsx` fails if a deck is blurred.
 *
 * What the light still says is how much has been *established*: the floor the
 * drone is standing on is the one it has actually seen.
 *
 * No filter here any more. The tiles are baked as light ink on transparent —
 * grey, inverted, sized for this board — because the source art is dark ink
 * drawn for paper, and dark ink over a near-black deck is nothing at all.
 * Doing it once at bake time costs nothing per frame and makes the asset
 * honest about the interface it is for (`tools/deck/bake.mjs`).
 */
/*
 * How much of the plating each state shows.
 *
 * These were a third to a half, and a third was nothing: the art is thin light
 * line work on transparent, and most of a tile is transparent — so a third of
 * a fifth is about six per cent of a pale line over `--sv-knock`, the darkest
 * colour in the palette. Every number here was measured against a composite of
 * the real baked tiles rather than guessed, and the floor of a compartment
 * nobody has been in still has to be visible as a floor.
 *
 * The order is still the whole point: what the drone is standing on is the
 * only floor it has actually seen, and a compartment that is only a rumour is
 * drawn as a rumour.
 */
export const DECK_INK: Record<Knows, number> = {
  current: 0.78,
  monitored: 0.62,
  detected: 0.5,
  undetected: 0.38,
  wrecked: 0,
};

const STATE: Record<
  Knows,
  { line: string; fill: string; band: string | null; shows: boolean; strong?: boolean }
> = {
  /**
   * Hull, and nowhere.
   *
   * Not a thing the drone does not know about — a thing there is nothing to
   * know about. A compartment the ship no longer has, drawn so the hull comes
   * out symmetric about its keel without the graph being touched (`hull.ts`).
   *
   * It has to be *seen* and it has to be unmistakably shut. Drawn with no
   * outline it read as empty space, which is the one thing it is not: the
   * point of drawing it at all is that the ship is bigger than the part of it
   * you can walk. So it wears the plating hatch — structure, not vacuum —
   * inside a broken rim, and a scar across it. It still takes no pointer,
   * offers no verb and holds nothing.
   */
  wrecked: { line: "var(--sv-rule)", fill: "var(--sv-hatch)", band: null, shows: false },
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
  /**
   * A job already begun on this thing: turns spent out of turns it takes.
   *
   * The engine keeps what is *left* — it is what the bots read to know a job
   * moved at all — and this is the same number turned round, because a player
   * wants to know how far in they are. Without it, stepping away for a turn
   * and coming back shows a line reading exactly as it did before they
   * started, and they start again.
   */
  work?: { done: number; of: number };
  /**
   * The chance this piece of salvage is carrying the virus, 0..1.
   *
   * The odds are a property of the part's *history* — a sealed crate is zero,
   * a machine's scrap a tenth, your own ghost's rack a quarter — and the board
   * could not say so: a pile of scrap and a dead drone's rack were the same
   * chip on the same hexagon, and the difference between them is nothing
   * against one in four. A die roll should be readable before it is rolled.
   */
  risk?: number;
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
  /**
   * The compartment a signed contract points at.
   *
   * Drawn before it is known and named as little as the drone knows: a job
   * that says "the med bay" and a board that will not say which hexagon that
   * is leaves a player walking the ship reading labels. What the ring does
   * *not* do is tell them what is in it — the cell keeps whatever knowledge
   * state it had, so marking the goal is not scanning it.
   */
  goal?: true;
  /**
   * The deck this compartment wears, where the build has art for it.
   *
   * `flipped` is the far side of the keel: the same section, seen from the
   * other side of the ship. A hull whose two halves wear different decks looks
   * assembled; one whose halves mirror looks drawn.
   */
  deck?: { id?: string; flipped: boolean };
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
  verbs: readonly {
    index: number;
    verb: string;
    note: string;
    enabled: boolean;
    /** True where spending it walks the drone through rather than works on it. */
    moves?: true;
  }[];
}

/**
 * Knowledge as a number, so "did this cell just learn something" is a
 * comparison rather than a table of pairs.
 *
 * Monitored and current are the same rung on purpose: both show what is in
 * the compartment, and the drone walking into a room it was already watching
 * has not revealed it — it was never hidden.
 */
const RANK: Record<Knows, number> = {
  /* Wreckage is not a rung of the ladder: there is nothing to learn about it,
     so it can never be revealed and never triggers the reveal. */
  wrecked: -1,
  undetected: 0,
  detected: 1,
  monitored: 2,
  current: 2,
};

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
      {/* The odds of what is in it, where the decision is made. A number rather
          than a word because the decision is a comparison — this pile against
          that one — and nobody compares "risky" to "riskier". */}
      {t.risk === undefined ? null : (
        <span
          data-sc
          style={{
            ...STENCIL,
            letterSpacing: ".12em",
            background: t.risk >= 0.25 ? "var(--sv-bad)" : "var(--sv-warn)",
            color: "var(--sv-knock)",
            padding: "1px 6px",
          }}
        >
          {`virus ${String(Math.round(t.risk * 100))}%`}
        </span>
      )}
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
      {t.work === undefined ? null : (
        /* A job begun, counted the way a player counts it: turns spent out of
           turns it takes. Beside the verb, because it is the same decision —
           press again and this number goes up by one. */
        <span style={{ display: "flex", gap: 2 }}>
          {Array.from({ length: t.work.of }, (_, i) => (
            <span
              key={i}
              style={{
                width: 6,
                height: 12,
                background: i < t.work!.done ? "var(--sv-good)" : "var(--sv-plate-lit)",
              }}
            />
          ))}
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
  who,
  style,
  innerRef,
}: {
  size?: number;
  /** Which drone this is, so it is drawn as the machine it was built as. */
  who?: string;
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
        {/* The lozenge is what a move scrambles to and back from, so it is
            still what `data-fx-face` holds when there is no drone to name. */}
        {who === undefined ? "◆" : <DroneIcon who={who} size={Math.round(size * 0.52)} />}
      </div>
    </div>
  );
}

function HexTile({
  room,
  size,
  hot,
  step,
  fresh,
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
  /**
   * Set on the frame a compartment stops being a rumour, and bumped each time
   * it happens again, so remounting the layer replays the animation. Undefined
   * on every other cell and on every other frame.
   */
  fresh?: number;
  onClick: () => void;
  onEnter: () => void;
  onLeave: () => void;
  onAct?: (thing: BoardThing) => void;
  style?: CSSProperties;
}): ReactElement {
  const s = STATE[room.knows];
  const [tip, setTip] = useState<Chip | null>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  /* The name arrives the way a name arrives anywhere else in this game —
     scrambled, then resolved. It is the third of the three things a reveal
     does, and the only one that is text rather than geometry. */
  useEffect(
    function resolveName() {
      if (fresh === undefined || labelRef.current === null) return;
      return reveal([labelRef.current], FX.PRESETS.name);
    },
    [fresh],
  );

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
  /* Inside the innermost edge there is. A property ring repaints the middle of
     the cell to draw its own dashes, so a deck painted at `base` was covered by
     any compartment that had one — which was every compartment the drone could
     see in the screenshot that started this. */
  const deckInset = ring === undefined ? base : base + 9;
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
      <ThingIcon thing={c.thing} size={px} />
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
      /* Which compartment this is, for anything that has to find one without
         reading pixels: the screenshot tests, and the board's own sweep. */
      data-room={String(room.id)}
      data-knows={room.knows}
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
          exists only so the hexagon — not its bounding box — takes the pointer.
          Wreckage has none: it is hull, not anywhere, and a cell that lit under
          the pointer would be offering something it does not have. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: HEX,
          pointerEvents: room.knows === "wrecked" ? "none" : "auto",
          cursor: "pointer",
          zIndex: 5,
        }}
      />
      {/* Everything painted, wrapped so a reveal can open it out of its own
          waist. The wrapper is keyed on the reveal, because a CSS animation
          replays when the element is new and not when a property changes back
          to a value it already had. Nothing here takes the pointer that the
          layers inside it did not already take. */}
      <div
        key={fresh ?? "still"}
        style={{
          position: "absolute",
          inset: 0,
          animation:
            fresh === undefined
              ? undefined
              : "sv-hex-grow var(--sv-frame) var(--sv-step) 1 both",
        }}
      >
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: HEX,
          background: s.line,
          opacity: room.knows === "undetected" ? 0.55 : 1,
        }}
      />
      {/* The contract's own compartment, ringed before it is found. Its own
          colour, because amber is the drone and red is a threat and this is
          neither: it is the reason the drone is aboard. */}
      {room.goal === true ? (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 4 }}>
          <HexRing stroke="var(--sv-good)" width={3} dash="9 7" />
        </div>
      ) : null}
      {room.knows === "wrecked" ? (
        <>
          {/* A rim that is there and does not close: the hull line survives,
              the compartment does not. */}
          <HexRing stroke="var(--sv-bulkhead)" width={2} dash="13 9" />
          {/* And the break itself, across the cell at the angle the plating
              runs, so it reads as one more torn seam rather than as a mark
              somebody put on top of the drawing. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              clipPath: HEX,
              pointerEvents: "none",
              background:
                "linear-gradient(135deg, transparent 0 44%, var(--sv-knock) 44% 50%, transparent 50% 100%)",
              opacity: 0.85,
            }}
          />
        </>
      ) : null}
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

      {/* The deck itself, under everything the board says about it.

          Scaled past its own bleed — the file is a hundred and twenty feet of
          picture around a hundred feet of deck, and drawing the whole of it
          leaves a tenth of the hexagon empty all the way round, which is what
          made the first version of this look like coasters rather than a ship.
          `scaleX(-1)` on the far side of the keel, so the two halves mirror.
          Held well back in opacity: this is the floor, and a floor that
          competes with what is standing on it is a floor nobody reads past. */}
      {room.deck?.id !== undefined && room.knows !== "wrecked" ? (
        <div
          style={{
            position: "absolute",
            inset: deckInset,
            clipPath: HEX,
            overflow: "hidden",
            pointerEvents: "none",
          }}
        >
          <img
            src={tileUrl(room.deck.id)}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: `${String(DECK_SCALE * 100)}%`,
              height: `${String(DECK_SCALE * 100)}%`,
              transform: `translate(-50%,-50%)${room.deck.flipped ? " scaleX(-1)" : ""}`,
              opacity: DECK_INK[room.knows],
            }}
          />
        </div>
      ) : null}


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
          <div
            style={{
              alignSelf: "stretch",
              background: s.band,
              padding: "3px 0",
              textAlign: "center",
              /* Out from the middle, the way every other border in this system
                 is drawn — the housing's on hover, the popover's on arrival. A
                 band that wiped in from one end would be the only thing on the
                 screen with a reading direction. */
              transformOrigin: "center",
              animation:
                fresh === undefined
                  ? undefined
                  : "sv-draw-x var(--sv-frame) var(--sv-step) 1 both",
            }}
          >
            <span
              ref={labelRef}
              style={{
                display: "inline-block",
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

/**
 * Doors that changed state since the last frame, flickering once.
 *
 * This is the event the alert ladder produces most often — from HUNTING the
 * ship starts shutting bulkheads and from LOCKDOWN it locks them — and until
 * now a door simply *differed on the next frame*. A player watching the board
 * would never catch it.
 *
 * So a door that changes cuts out and comes back where it stands: it did not
 * travel, it changed. Several doors moving in the same watch are one event, so
 * one sequence drives all of them rather than one blink each.
 */
function useDoorChanges(doors: readonly BoardDoor[], byHull: boolean): {
  cutOut: ReadonlySet<number>;
  mark: ReadonlySet<number>;
} {
  const was = useRef<Map<number, string> | null>(null);
  const [moved, setMoved] = useState<ReadonlySet<number>>(NO_DOORS);
  const [marked, setMarked] = useState<ReadonlySet<number>>(NO_DOORS);
  const [dark, setDark] = useState(false);

  useEffect(
    function changed() {
      const now = new Map(doors.map((d) => [d.id, d.state]));
      const last = was.current;
      was.current = now;
      /* The first frame is not a change: every door is new on it. */
      if (last === null) return;
      const shifted = new Set<number>();
      for (const [id, state] of now) {
        const before = last.get(id);
        if (before !== undefined && before !== state) shifted.add(id);
      }
      if (shifted.size === 0) return;
      setMoved(shifted);
      /* Whose doing it was decides whether it is also summoned. Same mark a
         refusal uses, which is right: both mean *look here*, and a mark that
         clears itself says "this just moved" rather than "this is wrong". */
      setMarked(byHull ? shifted : NO_DOORS);
      const run = FX.frames(
        [
          () => setDark(true),
          () => setDark(false),
          () => setDark(true),
          () => setDark(false),
        ],
        {
          frame: FX.FRAME / 2,
          onDone: () => {
            setMoved(NO_DOORS);
            setMarked(NO_DOORS);
          },
        },
      );
      return () => {
        run.cancel();
        /* However it ends, the board ends showing the doors it has. */
        setDark(false);
        setMoved(NO_DOORS);
        setMarked(NO_DOORS);
      };
    },
    [doors],
  );

  return { cutOut: dark ? moved : NO_DOORS, mark: marked };
}

const NO_DOORS: ReadonlySet<number> = new Set<number>();

export function HexBoard({
  rooms,
  doors,
  hullMoved,
  drone,
  route,
  size = 118,
  spread = 1.3,
  onWalk,
  onAct,
  onDoorAct,
  who,
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
  /** Which drone is aboard, so the mark is drawn as the machine it is. */
  who?: string;
  /** True when the ship, not the drone, is what moved a bulkhead this turn. */
  hullMoved?: boolean;
  style?: CSSProperties;
}): ReactElement {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  /* Bulkheads that just moved, blinked out on alternate frames so the change
     is something the player sees happen rather than something that differs. */
  const { cutOut, mark } = useDoorChanges(doors, hullMoved === true);
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
  /**
   * Which compartments stopped being a rumour on this turn.
   *
   * Worked out in an effect rather than while rendering, because it is a
   * comparison with the last frame and a render that remembers things is a
   * render that lies the second time it runs — which is every time under
   * StrictMode. Running it twice on the same rooms finds nothing the second
   * time, which is the correct answer and the reason it is safe.
   *
   * The first sight of a ship reveals nothing: everything is new then, and a
   * hull that unfolds itself compartment by compartment on arrival is a title
   * sequence, not a scan. A ship swapped underneath — undocking into a hull —
   * is the same case, and is caught by the ids not matching.
   */
  const seen = useRef<Map<number, number> | null>(null);
  const [fresh, setFresh] = useState<{ ids: ReadonlySet<number>; n: number }>({
    ids: new Set<number>(),
    n: 0,
  });
  useEffect(
    function noticeReveals() {
      const now = new Map(rooms.map((r) => [r.id, RANK[r.knows]]));
      const was = seen.current;
      seen.current = now;
      if (was === null || was.size !== now.size) return;
      const ids = new Set<number>();
      for (const [id, rank] of now) {
        const before = was.get(id);
        if (before === undefined) return;
        if (rank > before) ids.add(id);
      }
      if (ids.size > 0) setFresh((f) => ({ ids, n: f.n + 1 }));
    },
    [rooms],
  );

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

  /**
   * The drone arriving, as a flicker rather than as a flight.
   *
   * There used to be a `teleport` per compartment here, played along the
   * *planned* route and handing the turn to the game only when it finished.
   * Two bugs fell out of that and the owner hit both in one screenshot. The
   * token walked the whole route while the drone walked as far as the rules
   * let it, so the mark ended up hovering over a compartment the drone was
   * never in — "the icon moved but the drone did not". And the animation
   * carried `label: "◆"`, which `teleport` writes back into the face when it
   * lands: the face is a drawing, `textContent` wipes the drawing, and the
   * drone became a diamond for the rest of the run.
   *
   * The position is React's now, always, so it cannot be stale — the mark is
   * wherever the game says the drone is, on the frame the game says it. What
   * is left is the arrival: two held frames of the face cutting out, which is
   * a step being seen rather than a thing being followed. The walk itself is
   * already one compartment a frame (`ui/react/Screen.tsx`).
   */
  useEffect(
    function arrived() {
      if (drone === null) return;
      const el = droneRef.current;
      if (el === null) return;
      fx.current?.cancel();
      setMoving(true);
      fx.current = FX.frames(
        [
          () => {
            el.style.opacity = "0";
          },
          () => {
            el.style.opacity = "1";
          },
          () => {
            el.style.opacity = "0";
          },
        ],
        {
          frame: FX.FRAME / 3,
          onDone: () => {
            /* However it ends — cancelled by the next step, unmounted, skipped
               for reduced motion — the drone is visible. A mark you cannot see
               is worse than one that did not animate. */
            el.style.opacity = "1";
            setMoving(false);
          },
        },
      );
      return () => {
        fx.current?.cancel();
        el.style.opacity = "1";
        setMoving(false);
      };
    },
    [drone],
  );

  const go = (to: number): void => {
    const here = route(to);
    if (here === null || here.path.length === 0) return;
    if (here.blocked !== null) {
      setBarred(here.blocked.id);
      return;
    }
    setBarred(null);
    /* Straight to the game. The board does not get to decide where the drone
       ends up — it draws where the drone is, a compartment at a time, as the
       walk spends the turns. */
    onWalk?.(to, here.path);
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
            <div key={d.id} style={cutOut.has(d.id) ? { visibility: "hidden" } : undefined}>
              {/* The hull's doing, summoned. A diamond on the bulkhead the
                  ship just moved, for as long as the cut-out runs and then
                  gone — the player did not ask for this one. */}
              {!mark.has(d.id) ? null : (
                <div
                  style={{
                    position: "absolute",
                    left: (p.x + q.x) / 2 - 5,
                    top: (p.y + q.y) / 2 - 5,
                    width: 10,
                    height: 10,
                    background: "var(--sv-bad)",
                    transform: "rotate(45deg)",
                    zIndex: 8,
                    pointerEvents: "none",
                  }}
                />
              )}
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
              fresh={fresh.ids.has(room.id) ? fresh.n : undefined}
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
            who={drone === null ? undefined : who}
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
                          /* Walking through a bulkhead is walking, and the
                             drone crosses the board for it — the same hop a
                             click on the far compartment plays. It used to
                             spend the turn where it stood and the drone
                             arrived without having gone. */
                          if (v.moves === true && drone !== null) {
                            go(d.a === drone ? d.b : d.a);
                            return;
                          }
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
    </div>
  );
}
