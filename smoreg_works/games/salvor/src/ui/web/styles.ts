import { THEME } from "../theme.js";

/**
 * The whole look of the graphic view, in one string.
 *
 * Every colour on it is a token out of `theme.ts` turned into a CSS variable, so
 * the two views cannot drift apart: changing the game's palette stays the
 * one-file diff `theme.ts` promises, and this file only decides weights, sizes
 * and what a state looks like.
 *
 * The shape is the owner's artboards (`docs/tasks/G61-web-design.md`): a strip
 * naming the ship, the schematic under it, the panel down the right, the log
 * along the bottom. Two rules from the artboards' own token sheet are load
 * bearing rather than decorative, and everything below obeys them —
 *
 *   1. amber means one thing only: *here a decision is required*. The exposed
 *      slot, the cursor, the compartment the drone stands in, a locked door.
 *      Nothing else on the screen may use it, or it stops being a signal.
 *   2. the exposed slot is the only element allowed three signals at once —
 *      colour, edge weight and halo. Nothing else takes more than one, which is
 *      what makes the eye find it first.
 *
 * No web fonts and no CDN. The build has to run from a file:// URL inside an
 * itch.io zip with no network at all, so the stack is the system's own.
 */

/** Every colour the palette has, flattened to the name its CSS variable takes. */
export const TOKENS: Record<string, string> = {
  bg: THEME.bg,
  "panel-bg": THEME.panelBg,
  "fg-dim": THEME.fgDim,
  fg: THEME.fg,
  bright: THEME.bright,
  accent: THEME.accent,
  burned: THEME.burned,
  line: THEME.line,
  soft: THEME.soft,
  zone: THEME.zone,
  hull: THEME.hull,
  airlock: THEME.airlock,
  bulkhead: THEME.bulkhead,
  good: THEME.good,
  bad: THEME.bad,
  warn: THEME.warn,
};

/** Which variable holds a colour the panel asked for, or the colour itself. */
export function varOf(colour: string): string {
  const name = Object.keys(TOKENS).find((key) => TOKENS[key] === colour);
  return name === undefined ? colour : `var(--${name})`;
}

const ROOT = Object.entries(TOKENS)
  .map(([name, value]) => `--${name}:${value};`)
  .join("");

/** The class the shell puts on the page while the graphic view is up. */
export const WEB_ROOT_CLASS = "salvor-web";

export const WEB_CSS = `
.${WEB_ROOT_CLASS}{${ROOT}
  --mono: ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace;
  --amber-wash:#1a140a;
  --red-wash:#1c1113;
  position:fixed; inset:0; display:grid;
  grid-template-columns:1fr clamp(340px, 31vw, 460px);
  /* Three fixed-ish bands so the whole screen lands inside a 1366x768 laptop
     without a scrollbar — the artboards were drawn 1240 tall, and the itch
     viewport is 764 (docs/itch-page.md). The schematic takes what is left. */
  grid-template-rows:38px 1fr auto;
  background:var(--bg); color:var(--fg);
  font-family:var(--mono); font-size:13px; line-height:1.45; overflow:hidden;
}
.${WEB_ROOT_CLASS} *{box-sizing:border-box;}

/* --------------------------------------------------------------- the strip */
/* Which ship this is and what turn it is: the two lines the panel used to open
   with, moved out of it so the panel can start on the thing that matters. */
.web-head{grid-column:1 / -1; grid-row:1; display:flex; align-items:center; gap:16px;
  padding:0 14px; background:var(--panel-bg); border-bottom:1px solid var(--line);
  white-space:nowrap; overflow:hidden;}
.web-head .ship{color:var(--bright); font-weight:600; letter-spacing:.1em;
  overflow:hidden; text-overflow:ellipsis;}
.web-head .turn{margin-left:auto; color:var(--soft); font-size:11px; letter-spacing:.1em;
  font-variant-numeric:tabular-nums;}

/* ------------------------------------------------------------- the schematic */
.web-map{grid-column:1; grid-row:2; min-width:0; min-height:0; padding:10px 4px 4px 12px;
  background:radial-gradient(120% 90% at 30% 20%, #0f1519 0%, var(--bg) 70%);}
.schematic{width:100%; height:100%; display:block;}

/* The tug's board stands where the schematic does while the drone is home: no
   boxes, no doors, nothing to walk (docs/tasks/G54-two-ships-confusion.md). */
.web-board{margin:0; font-family:var(--mono); font-size:15px; line-height:1.5;
  color:var(--fg); white-space:pre; overflow:auto;}
.web-board::first-line{color:var(--accent);}
.schematic text{font-family:var(--mono); fill:var(--fg);}

.room-box{fill:#0d1216; fill-opacity:.85; stroke:var(--bulkhead); stroke-width:1;}
.room-name{font-size:14px; letter-spacing:.06em; fill:var(--fg); font-weight:600;}
.room-id{font-size:11px; fill:var(--fg-dim);}
.glyph{font-size:14px; fill:var(--soft); letter-spacing:.16em;}
.glyph.hostile{fill:var(--bad); font-weight:700;}

/* The four states of a compartment, in the order a run meets them. Each takes
   one signal and no more: a dash, a hue, a hue, and then the amber frame. */
.room.is-unknown .room-box{stroke-dasharray:4 4; stroke:var(--fg-dim); fill-opacity:.25;}
.room.is-unknown .room-name{fill:var(--fg-dim); letter-spacing:.28em;}
.room.is-scanned .room-box{stroke:#2a3238; fill:#0c1115;}
.room.is-scanned .room-name{fill:var(--fg-dim); font-weight:400;}
.room.is-scanned .room-id,.room.is-scanned .glyph{fill:var(--fg-dim);}
.room.is-explored .room-box{stroke:var(--bulkhead);}
.room.is-visible .room-box{stroke:var(--zone);}
.room.is-visible .room-name{fill:var(--bright);}
.room.is-current .room-box{stroke:var(--accent); stroke-width:2; fill:#151a1f; fill-opacity:.95;}
.room.is-current .room-halo{fill:none; stroke:var(--accent); stroke-width:5; opacity:.10;}
.room.is-current .room-name{fill:var(--bright);}
.room.is-current .room-id{fill:var(--airlock);}
.room.is-current .glyph{fill:var(--bright);}

/* Machines in there, said on the box rather than only in one small glyph: a red
   cap over the top edge with the count on it. An addition to the compartment's
   state, never a replacement for it — the artboards' rule, and the answer to
   "меня бьют, я не понимаю откуда" (docs/tasks/G55-playtest-findings.md). */
.threat-cap{fill:var(--bad); opacity:.9;}
.threat-count{font-size:11px; font-weight:700; fill:var(--bg);}

/* A machine has just come into sight in there. Last in the block so it beats
   every state above it, and colour only: the stroke width and the halo are left
   where the state put them, so a box cannot resize or move while it flashes.
   The blinking itself is not a CSS animation — the frame is redrawn on the beat
   by ui/pulse.ts, which is also how the terminal view does it and how
   prefers-reduced-motion is honoured without a second rule here. */
/* Where the highlighted line of the move list would take the drone. Amber,
   like everything the screen is asking a decision about, but without the halo
   the compartment underfoot carries — the two must not be confusable. */
.room.is-goal .room-box{stroke:var(--accent); stroke-dasharray:6 3;}
.room.is-goal .room-name{fill:var(--accent);}

.room.is-alarmed .room-box{stroke:var(--bad); fill:var(--red-wash);}
.room.is-alarmed .room-name,.room.is-alarmed .room-id{fill:var(--bad);}

/* Five door states and the airlock. Two rules, and the first one beats the
   artboards' table:

   1. A door you can walk through is the BRIGHTEST line on the map, not the
      faintest. The artboards drew an open door as a hairline in the dim ink and every
      other state louder, which is backwards for the thing the whole picture is
      for — where can I go. Drawn that way the walkable graph disappeared into
      the background and what was left read as loose labels: "карта всё ещё
      говно, коридор на глаз не видно".
   2. What stops you is a line with a GAP in it, and the worse the obstacle the
      wider the gap. Weight says how hard, dash says how shut. */
.door-wire{fill:none; stroke:var(--soft); stroke-width:2; stroke-linecap:round;
  stroke-linejoin:round;}
.door-wire.is-closed{stroke:var(--zone); stroke-dasharray:9 5;}
.door-wire.is-locked{stroke:var(--accent); stroke-width:2.5; stroke-dasharray:3 4;}
.door-wire.is-sealed{stroke:var(--bulkhead); stroke-width:3.5; stroke-dasharray:3 5;}
.door-wire.is-broken{stroke:var(--fg-dim); stroke-width:1.5; stroke-dasharray:1 5;}
.door-wire.is-airlock{stroke:var(--airlock); stroke-width:3.5;}

/* The label is a mark on a wire, not a node on the graph. It had a filled box
   and a border, so on a busy hull the eye counted twenty more boxes than there
   are compartments. Only the two states worth stopping for keep a frame. */
.door-tag{fill:var(--bg); stroke:none;}
.door-label{font-size:10px; fill:var(--soft);}
.door.is-closed .door-label{fill:var(--zone);}
.door.is-locked .door-tag{fill:var(--accent);}
.door.is-locked .door-label{fill:var(--bg); font-weight:700;}
.door.is-sealed .door-tag{fill:var(--bulkhead); fill-opacity:.5;}
.door.is-sealed .door-label{fill:var(--fg);}
.door.is-broken .door-label{fill:var(--fg-dim);}
.door.is-airlock .door-label{fill:var(--airlock); font-weight:700;}

/* ------------------------------------------------------------- the honeycomb */
/* The third view: hexagons and straight corridors (ui/web/hex-svg.ts). It
   borrows the room and door state classes wholesale — a compartment is the same
   compartment in all three drawings — and adds only what a hexagon has that a
   box does not.

   The corridor is drawn twice: a wide bulkhead-brown stroke for the walls, and
   the door's own state stroke on top of it. That is why a closed door reads as
   a corridor with a shut door in it rather than as a dashed line in space. */
.hexmap .room-box{fill:#0c1116; fill-opacity:.9; stroke-width:1.5;}
.hexmap .room-name{font-size:13px; letter-spacing:.04em;}
.hexmap .room-id{font-size:10px;}
.hexmap .glyph{font-size:12px; letter-spacing:.22em;}
.hexmap .room.is-current .room-halo{fill:none; stroke:var(--accent); stroke-width:7; opacity:.12;}
.hexmap .hall-wall{stroke:var(--bulkhead); stroke-width:11; stroke-linecap:butt;}
.hexmap .hall-wall.is-airlock{stroke:var(--airlock);}
.hexmap .door-wire{stroke-width:3;}
.hexmap .door-wire.is-open{stroke:#0c1116;}
.hexmap .door-tag{fill:var(--bg); fill-opacity:.92;}
.hexmap .door.link .door-tag{fill:var(--panel-bg); stroke:var(--zone); stroke-width:1;}
.hexmap .door.link .door-label{fill:var(--zone);}

/* The run a long door makes under the deck. Drawn before everything, so the
   compartments and corridors it passes behind cover it: what is left is a line
   you can follow from one chip to the other, which is what tells a walk the
   long way round from a teleport. */
.hexmap .duct{stroke:var(--zone); stroke-width:1; stroke-dasharray:2 6; opacity:.4;}
.hexmap .duct.is-sealed{stroke:var(--bulkhead);}
.hexmap .duct.is-locked{stroke:var(--accent); opacity:.3;}

/* An unexplored hexagon is a shape and an id, and nothing else worth reading —
   most of a hull is unexplored, and at full weight the dashes were the loudest
   thing on the screen. */
.hexmap .room.is-unknown .room-box{stroke:#232b31; stroke-dasharray:3 5;}
.hexmap .room.is-unknown .room-id{fill:#38424a;}
.hexmap .room.is-unknown .room-name{fill:#2b343a;}

.tug-box{fill:#0d1216; stroke:var(--fg); stroke-width:1.5;}
.tug-name{font-size:18px; fill:var(--fg);}
.hull{stroke:var(--hull); stroke-width:2.5; opacity:.8;}
.banner{font-size:14px; fill:var(--accent); letter-spacing:.05em;}
.ship-line{font-size:11px; fill:var(--soft);}

/* ------------------------------------------------------------------ the panel */
.web-panel{grid-column:2; grid-row:2; min-height:0; overflow-y:auto; padding:10px 12px 16px;
  background:var(--panel-bg); border-left:1px solid var(--line);
  display:flex; flex-direction:column; gap:9px;}

/* One block of the panel. panelBlocks already parts them with blank rows and
   this is that parting drawn: a rule between blocks instead of an empty row,
   which buys back the height the artboards spent on air. */
.pb{display:flex; flex-direction:column; gap:1px;}
.pb + .pb{border-top:1px solid var(--line); padding-top:8px;}
.pl{white-space:pre; min-height:1.45em;}
.pl.h{letter-spacing:.2em; font-size:10px; color:var(--soft);}
.pl.hit{color:var(--bad); animation:salvor-hit .45s steps(2,end) 2;}
@keyframes salvor-hit{0%,100%{opacity:1;} 50%{opacity:.25;}}
.bar{letter-spacing:.5px;}
.bar .off{color:var(--line);}

/* The rack. A slot is a row with a bar in it, and it gets the row treatment: a
   cold ground, a quiet left edge, and nothing loud — so that the one slot which
   is loud has the whole panel to itself. */
.pl.slot{padding:3px 7px; background:#0c1115; border:1px solid var(--line);
  border-left:2px solid var(--line);}
.pl.slot.is-exposed{background:var(--amber-wash); border-color:var(--accent);
  border-left-width:4px; box-shadow:0 0 0 3px rgba(224,164,88,.10); font-weight:600;}
.pl.slot.hit{border-color:var(--bad); border-left-color:var(--bad);}

/* The exposed slot said twice: once as its own row in the rack, once as a small
   mark in the bottom-left corner of the map, which is where the owner asked for
   it — "следующий удар мелким значком снизу слева". It sits in the map cell of
   the grid rather than over it, so it can never cover a compartment box. */
.web-expose{grid-column:1; grid-row:2; align-self:end; justify-self:start;
  margin:0 0 8px 12px; z-index:2; pointer-events:none;}
.expose{border:1px solid var(--accent); background:var(--amber-wash); border-radius:2px;
  padding:3px 8px; display:flex; align-items:baseline; gap:8px;}
.expose .lbl{font-size:9px; letter-spacing:.16em; color:var(--airlock);}
.expose .row{font-size:12px; font-weight:600; letter-spacing:.04em; color:var(--accent);
  line-height:1.2; white-space:pre;}

.acts{display:flex; flex-direction:column; gap:1px;}
/* position:relative because the cursor mark is absolute inside it. Without it
   the mark hangs off the root element instead of its own row, and lands in the
   log at the foot of the screen — which is exactly where the owner found it. */
.act{position:relative; display:grid; grid-template-columns:18px 1fr; gap:7px; align-items:baseline;
  width:100%; text-align:left; padding:3px 6px; border:1px solid transparent; border-radius:2px;
  background:none; color:var(--fg); font:inherit; cursor:pointer;}
.act:hover{background:#18222a; border-color:#26333c;}
.act .key{color:var(--soft); text-align:right; font-variant-numeric:tabular-nums;}
.act .label{white-space:pre-wrap;}
.act .extra{grid-column:2; color:var(--soft); font-size:11px;}
.act.is-off{color:var(--fg-dim);} .act.is-off .key{color:var(--fg-dim);}
.act.is-off .extra{color:var(--fg-dim);}
.act.is-cursor{background:var(--amber-wash); border-color:var(--accent); color:var(--accent);}
.act.is-cursor .key{color:var(--accent);}
.act.is-cursor .label{font-weight:700;}
.act .cursor{position:absolute; margin-left:-13px; color:var(--accent);}

/* The keys, pinned to the bottom right corner of the panel in every state —
   "подсказки по хоткеям всегда снизу справа" (docs/tasks/G48-travel-to-a-room.md).
   panelBlocks already puts them on its last rows; margin-top:auto is what
   keeps them at the corner when the panel is taller than its content. */
.pb.foot{margin-top:auto; border-top:1px solid var(--line); padding-top:7px;
  color:var(--soft); font-size:11px;}

/* -------------------------------------------------------------------- the log */
/* Seven lines and the newest of them at the bottom, which is what the terminal
   shows too (LAYOUT.logHeight). The rest of the tail stays scrollable above:
   mount.ts pins the box to its own bottom after every frame, because innerHTML
   reopens it at the top otherwise — and the top of a log is the part already
   read. */
.web-log{grid-column:1 / -1; grid-row:3; height:124px; overflow-y:auto;
  padding:6px 14px; border-top:1px solid var(--line); background:#0c1013; font-size:12px;
  line-height:1.4;}
.web-log div{white-space:pre-wrap;}
.web-log .plain{color:var(--fg);} .web-log .good{color:var(--good);}
.web-log .bad{color:var(--bad);} .web-log .warn{color:var(--warn);}
.web-log .faded{color:var(--fg-dim);}

/* ---------------------------------------------------------------- the overlays */
.web-over{position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  background:rgba(6,9,11,.9); padding:24px; z-index:5;}
.card{max-width:min(700px,92vw); max-height:88vh; overflow-y:auto; padding:20px 26px;
  border:1px solid var(--line); border-top:2px solid var(--accent); border-radius:3px;
  background:var(--panel-bg);}
.card div{white-space:pre-wrap;}
.card .h{color:var(--accent); font-size:19px; letter-spacing:.1em; margin-bottom:10px;}
.card .head{color:var(--soft); font-size:10px; letter-spacing:.2em; margin-top:14px;}
.card .keys{color:var(--fg);} .card .prose{color:var(--soft);}
.card .sub{color:var(--fg); margin:10px 0;}
.card .hint{color:var(--fg-dim); margin-top:14px;}
.card.good{border-top-color:var(--good);} .card.good .h{color:var(--good);}
.card.bad{border-top-color:var(--bad);} .card.bad .h{color:var(--bad);}
`;
