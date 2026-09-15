import { THEME } from "../theme.js";

/**
 * The whole look of the graphic view, in one string.
 *
 * Every colour on it is a token out of `theme.ts` turned into a CSS variable, so
 * the two views cannot drift apart: changing the game's palette stays the
 * one-file diff `theme.ts` promises, and this file only decides weights, sizes
 * and what a state looks like.
 *
 * The shape is the owner's artboards (`docs/tasks/G61-web-design.md`, and 3a of
 * G89): a strip naming the ship, the schematic under it with the log beneath,
 * and the panel down the whole right-hand side. Two rules from the artboards' own token sheet are load
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
  // The drawn hull under the honeycomb (hullart.ts): its three steps of tone
  // and the two marks on it, out of the same palette as everything else.
  "hull-body": THEME.hullArt.body,
  "hull-plate": THEME.hullArt.plate,
  "hull-plate-lit": THEME.hullArt.plateLit,
  "hull-deep": THEME.hullArt.deep,
  "hull-rim": THEME.hullArt.rim,
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
  /* Artboard 3a: the strip, the map over the log on the left, and the panel
     down the whole right-hand side. Around 400 wide for the panel (396 on a
     1366 laptop), and three bands that land inside the itch viewport's 764
     without a scrollbar (docs/itch-page.md). The map takes what is left. */
  grid-template-columns:1fr clamp(360px, 29vw, 440px);
  grid-template-rows:38px 1fr 132px;
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
/* The hull's class and the sortie, small beside the name; the turn and the
   seed pushed to the right edge, in capitals as the artboard sets them. */
.web-head .cls{color:var(--soft); font-size:11px; letter-spacing:.1em;
  overflow:hidden; text-overflow:ellipsis;}
.web-head .turn{margin-left:auto; flex-shrink:0; color:var(--soft); font-size:11px;
  letter-spacing:.1em; text-transform:uppercase; font-variant-numeric:tabular-nums;}

/* ------------------------------------------------------------- the schematic */
.web-map{grid-column:1; grid-row:2; min-width:0; min-height:0; padding:10px 4px 4px 12px;
  background:radial-gradient(120% 90% at 30% 20%, #0f1519 0%, var(--bg) 70%);}
.schematic{width:100%; height:100%; display:block;}
/* The frame the drone took a blow on (screen.ts, flash): the map's edge goes
   red, and the map shakes once. The edge is a colour and stays for anyone; the
   shake is motion and does not. */
.web-map.is-hit{box-shadow:inset 0 0 0 2px var(--bad); animation:salvor-shake .28s linear 1;}
@keyframes salvor-shake{0%,100%{transform:none;} 25%{transform:translateX(-3px);}
  50%{transform:translateX(3px);} 75%{transform:translateX(-2px);}}
@media (prefers-reduced-motion: reduce){.web-map.is-hit{animation:none;}}
/* A compartment is pressable — a click does what its line of the move list
   does (mount.ts) — so it looks it: the pointer, and the outline lit under it.
   Not on the one underfoot, whose amber frame is the thing it must keep. */
.schematic .room{cursor:pointer;}
.schematic .room:not(.is-current):hover .room-box{stroke:var(--bright); stroke-width:2.5;}

.schematic text{font-family:var(--mono); fill:var(--fg);}

.room-box{fill:#0d1216; fill-opacity:.85; stroke:var(--bulkhead); stroke-width:1;}
.room-name{font-size:14px; letter-spacing:.06em; fill:var(--fg); font-weight:600;}
.room-id{font-size:11px; fill:var(--fg-dim);}
.glyph{font-size:14px; fill:var(--soft); letter-spacing:.16em;}
.glyph.hostile{fill:var(--bad); font-weight:700;}

/* Tiles (?tiles=1). A tile is a symbol of unit rects painted currentColor
   (src/tiles/sprites.ts), so what fill is to a glyph, color is to a tile — and
   the pair of rules below is the pair above, said in the other property. That
   is the whole of the colour policy: whatever painted the letter paints the
   picture, the one red on machines included (G40), and the compartment's state
   still wins over it further down the block, exactly as it does for text. No
   colour is named here that is not already named for glyphs. */
.tile{color:var(--soft);}
.tile.hostile{color:var(--bad);}
/* The pictogram is the compartment's own, and quieter than its name: a label
   for the box, never one of the things standing in it. */
.zone-tile{color:var(--fg-dim);}
/* The seventh thing and everything after it, counted rather than drawn. */
.tile-more{fill:var(--fg-dim);}
/* With the flag on, every letter left in the row is centred in the cell a tile
   would have taken — and tracking is added after the last glyph as well as
   between them, so a tracked string set from its middle sits half a letter-space
   left of where it belongs. A pixel at this size, and it comes straight out of
   the gap the row is measured on. Off in tile mode, unchanged everywhere else. */
.has-tiles .glyph{letter-spacing:0;}

/* The four states of a compartment, in the order a run meets them. Each takes
   one signal and no more: a dash, a hue, a hue, and then the amber frame. */
.room.is-unknown .room-box{stroke-dasharray:4 4; stroke:var(--fg-dim); fill-opacity:.25;}
.room.is-unknown .room-name{fill:var(--fg-dim); letter-spacing:.28em;}
.room.is-scanned .room-box{stroke:#2a3238; fill:#0c1115;}
.room.is-scanned .room-name{fill:var(--fg-dim); font-weight:400;}
.room.is-scanned .room-id,.room.is-scanned .glyph{fill:var(--fg-dim);}
.room.is-scanned .tile,.room.is-scanned .zone-tile{color:var(--fg-dim);}
.room.is-explored .room-box{stroke:var(--bulkhead);}
.room.is-visible .room-box{stroke:var(--zone);}
.room.is-visible .room-name{fill:var(--bright);}
.room.is-current .room-box{stroke:var(--accent); stroke-width:2; fill:#151a1f; fill-opacity:.95;}
.room.is-current .room-halo{fill:none; stroke:var(--accent); stroke-width:5; opacity:.10;}
.room.is-current .room-name{fill:var(--bright);}
.room.is-current .room-id{fill:var(--airlock);}
.room.is-current .glyph{fill:var(--bright);}
.room.is-current .tile{color:var(--bright);}
.room.is-current .zone-tile{color:var(--airlock);}
/* A machine is red in every state of the compartment it stands in — the one
   underfoot included, whose bright ink used to paint it white exactly where it
   mattered most (G90 D1). Four classes deep, so no state rule above outranks it. */
.schematic .room .glyph.hostile{fill:var(--bad); font-weight:700;}
.schematic .room .tile.hostile{color:var(--bad);}

/* Machines in there, said on the box rather than only in one small glyph: a red
   cap over the top edge with the count on it. An addition to the compartment's
   state, never a replacement for it — the artboards' rule, and the answer to
   "меня бьют, я не понимаю откуда" (docs/tasks/G55-playtest-findings.md). */
.threat-cap{fill:var(--bad); opacity:.9;}
.threat-count{font-size:11px; font-weight:700; fill:var(--bg);}
/* On the honeycomb the cap is a skull (hex-svg.ts, threat) and the compartment
   gets a red ring outside its outline: the count, and where it is, at a glance. */
.threat-skull{fill:var(--bad); stroke:var(--bg); stroke-width:1.2;}
.threat-teeth{fill:none; stroke:var(--bg); stroke-width:1.2;}
.hexmap .room-ring{fill:none; stroke:var(--bad); stroke-width:2.5; opacity:.9;}

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
/* The door a red hazard line has just named (SchematicDoor.target): the
   same amber dashes a lock wears, on whatever state the door is in. */
.door-wire.is-goal{stroke:var(--accent); stroke-width:2.5; stroke-dasharray:3 4;}
.door.is-goal .door-label{fill:var(--accent);}

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
/* The compartment's pictogram sits over the drawn hull here, where the dim ink
   the box view gives it would sink into the plating. The compartment hue is
   what the honeycomb already paints an outline with, so it costs no new signal. */
.hexmap .zone-tile{color:var(--zone);}
.hexmap .room.is-current .room-halo{fill:none; stroke:var(--accent); stroke-width:11; opacity:.3;}
/* The drone's own mark on the cell underfoot, drawn after everything else on
   the deck. It takes no clicks: the compartment under it is still pressable. */
.hexmap .drone-mark{pointer-events:none;}
.hexmap .drone-disc{fill:var(--accent); stroke:var(--bg); stroke-width:2;}
.hexmap .drone-core{fill:var(--bg);}
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
/* The way to where the drone is aiming — the highlighted line, or the box under
   the pointer (appstate.ts, mapAim): its doors in solid amber, the destination
   in the dashes it already wears (G90 D4). And a door is pressable (mount.ts). */
.hexmap .door-wire.is-route{stroke:var(--accent); stroke-width:4; stroke-dasharray:none; opacity:1;}
.hexmap .duct.is-route{stroke:var(--accent); stroke-width:2; opacity:.85;}
.hexmap [data-door]{cursor:pointer;}

/* An unexplored hexagon is a shape and an id, and nothing else worth reading —
   most of a hull is unexplored, and at full weight the dashes were the loudest
   thing on the screen. */
.hexmap .room.is-unknown .room-box{stroke:#232b31; stroke-dasharray:3 5;}
.hexmap .room.is-unknown .room-id{fill:#38424a;}
.hexmap .room.is-unknown .room-name{fill:#2b343a;}

/* The drawn hull under the honeycomb (ui/web/hullart.ts, G81). Three steps of
   tone and no fewer — the page under the ship, the hull's mass, the plate on
   that mass — because a hull a shade off the background read as an outline
   over nothing. Nothing in this block is amber: amber is the doors' and the
   airlock's, and a hull that spent it on portholes lost the doors among them.
   Every mark is steel or darker, and the skin line is the one thing brighter. */
.hexmap .hull-art{stroke:none; opacity:1;}
.hexmap .hull-skin{fill:var(--hull-body);}
/* A hole cut out of the hull — the hub of a ring station: the page shows through. */
.hexmap .hull-hole{fill:var(--bg);}
.hexmap .hull-rim{fill:none; stroke:var(--hull-rim); stroke-width:3; stroke-linejoin:miter;
  stroke-miterlimit:6;}
.hexmap .hull-rim-in{fill:none; stroke:var(--bg); stroke-width:1; stroke-linejoin:miter;
  stroke-miterlimit:6;}
.hexmap .hull-wash{fill:var(--bg); opacity:.1;}
.hexmap .hull-plate{fill:var(--hull-plate);}
.hexmap .hull-plate-lit{fill:var(--hull-plate-lit); stroke:var(--zone); stroke-width:1.3;}
.hexmap .hull-plate-rimmed{stroke:var(--hull-rim); stroke-width:1.8;}
.hexmap .hull-pod .hull-plate{stroke:var(--hull-rim); stroke-width:2;}
.hexmap .hull-deep{fill:var(--hull-deep);}
.hexmap .hull-deep-rimmed{stroke:var(--zone); stroke-width:1.3;}
.hexmap .hull-bell{fill:var(--hull-deep); stroke:var(--hull-rim); stroke-width:1.6;}
.hexmap .hull-flame{fill:var(--zone); opacity:.22;}
.hexmap .hull-light{fill:#ffffff; opacity:.045;}
.hexmap .hull-line{stroke:var(--zone); stroke-width:1; fill:none;}
.hexmap .hull-glass{fill:var(--zone); opacity:.9;}
.hexmap .hull-steel{fill:var(--zone);}
/* Over a hull, an unexplored hexagon lets a little of the plating through:
   most of a hull is unexplored, and a page of near-black cells over a drawn
   ship read as holes punched in it. The sibling combinator keeps this to the
   frames that have a hull at all, so ?hull=0 looks exactly as it did. */
.hexmap .hull-art ~ .room.is-unknown .room-box{fill-opacity:.55;}

/* A hazard the drone knows of (artboard 3b). The outline is spoken for by the
   state and red by the machines, so a hazard takes the floor — the one channel
   no state uses — and a rim along the two upper edges. A box with a machine
   flashing in it keeps its red wash over any floor. Frost is the cold steel,
   smoke the grey ink; the word over the name is the codex card's. */
.hexmap .room.hz-frost:not(.is-alarmed) .room-box{fill:#101c22; fill-opacity:.95;}
.hexmap .room.hz-smoke:not(.is-alarmed) .room-box{fill:#1a1a18; fill-opacity:.95;}
.hexmap .hz-rim{fill:none; stroke-width:3; stroke-linejoin:round;}
.hexmap .hz-word{font-size:10px; font-weight:700; letter-spacing:.1em;}
.hexmap .hz-frost .hz-rim{stroke:var(--zone);} .hexmap .hz-frost .hz-word{fill:var(--zone);}
.hexmap .hz-smoke .hz-rim{stroke:var(--soft);} .hexmap .hz-smoke .hz-word{fill:var(--soft);}
/* A trapped door: a chevron over its label and the label on the warning colour.
   Not amber, which a locked door already wears. */
.hexmap .trap-mark{fill:none; stroke:var(--warn); stroke-width:2.4; stroke-linejoin:round;}
.hexmap .door.has-trap .door-tag{fill:var(--warn); fill-opacity:1;}
.hexmap .door.has-trap .door-label{fill:var(--bg); font-weight:700;}

.tug-box{fill:#0d1216; stroke:var(--fg); stroke-width:1.5;}
.tug-name{font-size:18px; fill:var(--fg);}
.hull{stroke:var(--hull); stroke-width:2.5; opacity:.8;}
.banner{font-size:14px; fill:var(--accent); letter-spacing:.05em;}
.ship-line{font-size:11px; fill:var(--soft);}

/* ------------------------------------------------------------------ the panel */
/* Full height on the right, strip to foot (3a): the log is the map's, not the
   panel's. No bottom padding, because the key row is stuck to that edge — and
   a scroll padding of its height, so the cursor row mount.ts scrolls into view
   stops above the key row instead of under it. */
.web-panel{grid-column:2; grid-row:2 / span 2; min-height:0; overflow-y:auto; padding:10px 12px 0;
  scroll-padding-bottom:56px;
  background:var(--panel-bg); border-left:1px solid var(--line);
  display:flex; flex-direction:column; gap:9px;}

/* One block of the panel. panelBlocks already parts them with blank rows and
   this is that parting drawn: a rule between blocks instead of an empty row,
   which buys back the height the artboards spent on air. */
.pb{display:flex; flex-direction:column; gap:1px;}
.pb + .pb{border-top:1px solid var(--line); padding-top:8px;}
.pl{white-space:pre; min-height:1.45em;}
.pl.is-press{cursor:pointer; text-decoration:underline dotted; text-underline-offset:3px;}
.pl.h{letter-spacing:.2em; font-size:10px; color:var(--soft);}
.pl.hit{color:var(--bad); animation:salvor-hit .45s steps(2,end) 2;}
@keyframes salvor-hit{0%,100%{opacity:1;} 50%{opacity:.25;}}
@media (prefers-reduced-motion: reduce){.pl.hit{animation:none;}}
.bar{letter-spacing:.5px;}
.bar .off{color:var(--line);}

/* The rack. A slot is a row with a bar in it, and it gets the row treatment: a
   cold ground, a quiet left edge, and nothing loud — so that the one slot which
   is loud has the whole panel to itself. */
.pl.slot{padding:3px 7px; background:#0c1115; border:1px solid var(--line);
  border-left:2px solid var(--line);}
/* Wear, by share (panel-html.ts, slotTone): whole or nearly is the row's own
   light ink, under three quarters the warning colour, the last point or quarter
   red with a red left edge. A burned slot is hatched (1h): nothing there to bar. */
.pl.slot.is-worn .bar .on{color:var(--warn);}
.pl.slot.is-low .bar .on{color:var(--bad);}
.pl.slot.is-low{border-left-color:var(--bad);}
.pl.slot.is-burned{border-color:var(--burned);
  background:repeating-linear-gradient(135deg, var(--red-wash) 0 6px, #0c1115 6px 12px);}
.pl.slot.is-exposed{background:var(--amber-wash); border-color:var(--accent);
  border-left-width:4px; box-shadow:0 0 0 3px rgba(224,164,88,.10); font-weight:600;}
.pl.slot.hit{border-color:var(--bad); border-left-color:var(--bad);}

/* The top-left corner of the map (panel-html.ts, cornerHtml): the codex chip,
   then the alert as a ladder of five rungs and the hazards the drone knows are
   aboard. In the map's own grid cell, so it can never
   cover the panel, and it takes no clicks — a compartment under it is still
   pressable. Three and four take the gauge's warning colour, five the red and a
   blink on the head row, because that row is the one deadline on the screen;
   the blink is off for anyone who asked their system for less motion. */
.web-corner{grid-column:1; grid-row:2; align-self:start; justify-self:start; z-index:2;
  margin:10px 0 0 12px; pointer-events:none;
  display:flex; flex-direction:column; align-items:flex-start; gap:6px;}
/* At home there is no alert and nothing aboard, and the dock's own head is
   where the corner would sit: the codex stays one key away on i. */
.web-map:has(.dock) ~ .web-corner{display:none;}
.web-codex{border:1px solid var(--accent); background:var(--amber-wash); border-radius:2px;
  padding:2px 8px; color:var(--accent); font-size:12px; font-weight:600; letter-spacing:.06em;}
.web-ladder{display:flex; flex-direction:column; gap:1px; min-width:176px; padding:5px 8px;
  border:1px solid var(--line); border-radius:2px; background:rgba(10,13,16,.88);
  font-size:10px; line-height:1.35;}
.web-ladder.is-l5,.web-ladder.is-l6,.web-ladder.is-l7,.web-ladder.is-l8{border-color:var(--warn);}
.web-ladder.is-l9,.web-ladder.is-l10{border-color:var(--bad); background:var(--red-wash);}
.rung-head{font-size:12px; font-weight:600; letter-spacing:.04em; color:var(--soft);
  white-space:pre; margin-bottom:2px;}
.web-ladder.is-l5 .rung-head,.web-ladder.is-l6 .rung-head,.web-ladder.is-l7 .rung-head,
.web-ladder.is-l8 .rung-head{color:var(--warn);}
.web-ladder.is-l9 .rung-head,
.web-ladder.is-l10 .rung-head{color:var(--bad); animation:salvor-alert .9s steps(2,end) infinite;}
@keyframes salvor-alert{0%,100%{opacity:1;} 50%{opacity:.35;}}
@media (prefers-reduced-motion: reduce){.web-ladder.is-l9 .rung-head,.web-ladder.is-l10 .rung-head{animation:none;}}
.rung,.hz{display:grid; grid-template-columns:12px 76px auto; gap:6px; align-items:baseline;
  white-space:nowrap;}
.rung i,.hz i{font-style:normal; font-size:11px;}
.rung .do,.hz .do{font-size:9px;}
.rung.is-past{color:var(--fg-dim);}
.rung.is-next{color:var(--soft);}
.rung.is-now{color:var(--bright); font-weight:600;}
.web-ladder.is-l5 .rung.is-now,.web-ladder.is-l6 .rung.is-now,.web-ladder.is-l7 .rung.is-now,
.web-ladder.is-l8 .rung.is-now{color:var(--warn);}
.web-ladder.is-l9 .rung.is-now,.web-ladder.is-l10 .rung.is-now{color:var(--bad);}
.hz-list{display:flex; flex-direction:column; gap:1px; margin-top:3px; padding-top:4px;
  border-top:1px solid var(--line);}
.hz{color:var(--soft);}
.hz.hz-frost i{color:var(--zone);} .hz.hz-mine i{color:var(--warn);}

.acts{display:flex; flex-direction:column; gap:1px;}
.acts .pl.h{margin-top:4px;}
/* Three columns on one line (3a): the key with the cursor mark in front of it,
   the label, and the price or the ways through at the right. The label may
   wrap; the other two never do. */
.act{display:grid; grid-template-columns:26px minmax(0,1fr) auto; gap:8px; align-items:baseline;
  width:100%; text-align:left; padding:3px 6px; border:1px solid transparent; border-radius:2px;
  background:none; color:var(--fg); font:inherit; cursor:pointer;}
.act:hover{background:#18222a; border-color:#26333c;}
.act:active{background:#1f2a33; transform:translateY(1px);}
.act:focus-visible{outline:2px solid var(--accent); outline-offset:1px;}
.act .key{color:var(--soft); text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums;}
.act .label{white-space:pre-wrap;}
.act .extra{grid-column:3; color:var(--soft); font-size:11px; white-space:nowrap; text-align:right;}
/* A line that cannot be pressed says why in its own words, so the words stay
   readable — the soft ink, over 3:1 on the panel — and only the key goes dark. */
.act.is-off{color:var(--soft);} .act.is-off .key{color:var(--fg-dim);}
.act.is-off .extra{color:var(--soft);}
.act.is-cursor{background:var(--amber-wash); border-color:var(--accent); color:var(--accent);}
.act.is-cursor .key{color:var(--accent);}
.act.is-cursor .label{font-weight:700;}
.act .cursor{color:var(--accent);}
/* A greyed row does not answer the pointer as if it would press (G90 D5), and a
   cursor with nothing pressable to rest on is dim rather than amber: amber says
   a decision is waiting, and on a list of refusals none is. */
.act.is-off:hover,.act.is-off:active{background:none; border-color:transparent; transform:none;}
.act.is-cursor.is-off{background:none; border-color:var(--line); color:var(--soft);}
.act.is-cursor.is-off .key,.act.is-cursor.is-off .cursor{color:var(--fg-dim);}
.act.is-cursor.is-off .label{font-weight:400;}

/* The keys, pinned to the bottom right corner of the panel in every state —
   "подсказки по хоткеям всегда снизу справа" (docs/tasks/G48-travel-to-a-room.md).
   panelBlocks already puts them on its last rows; margin-top:auto is what
   keeps them at the corner when the panel is taller than its content. */
.pb.foot{margin-top:auto; position:sticky; bottom:0; background:var(--panel-bg);
  border-top:1px solid var(--line); padding:7px 0 8px; color:var(--soft); font-size:11px;
  text-align:right;}

/* -------------------------------------------------------------------- the log */
/* Seven lines and the newest of them at the bottom, which is what the terminal
   shows too (LAYOUT.logHeight). The rest of the tail stays scrollable above:
   mount.ts pins the box to its own bottom after every frame, because innerHTML
   reopens it at the top otherwise — and the top of a log is the part already
   read. */
.web-log{grid-column:1; grid-row:3; min-height:0; overflow-y:auto;
  display:flex; flex-direction:column;
  padding:5px 14px; border-top:1px solid var(--line); background:#0c1013; font-size:12px;
  line-height:1.4;}
.web-log div{white-space:pre-wrap;}
/* Under the map only, and a short tail sits on the floor of the box, next to
   the map, rather than hanging from its ceiling: the newest line is always the
   bottom one. An auto margin rather than justify-content, which would put the
   overflow out of reach of the scrollbar. */
.web-log > div:first-child{margin-top:auto;}
.web-log .plain{color:var(--fg);} .web-log .good{color:var(--good);}
.web-log .bad{color:var(--bad);} .web-log .warn{color:var(--warn);}
/* Age, in three steps and by turn rather than by line count: this turn keeps
   its tone, the turn before it goes soft, everything older goes dim
   (ui/logline.ts, logFades). The gap is the same statement without colour —
   four pixels where one turn ends and the next begins. */
.web-log .recent{color:var(--soft);} .web-log .old{color:var(--fg-dim);}
.web-log .turn-gap{margin-top:4px;}

/* The alarm tone: a hazard the drone has been told about (systems/hazards.ts).
   Red ink that never fades, and the newest one on a red ground across the
   whole row — the same two rules the terminal draws it by, so a player who
   reads only the bottom of the screen cannot miss it in either view. */
.web-log .alarm{color:var(--bad); font-weight:600;}
.web-log .alarm.live{background:var(--bad); color:var(--bright); margin-left:-14px; margin-right:-14px;
  padding:1px 14px;}

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
/* The help card's key column (artboard 1g): the key a row is about, in the
   colour of a key to press, so the card reads down its keys. */
.card .keys .press{color:var(--accent);}

/* A run that is over, or a hull or a drone that is (artboard 1f): the word
   large, the reason under it, the run's numbers in a row between two rules,
   each one big under a small caption, and what to press last. */
.card .end .h{font-size:34px; font-weight:600; letter-spacing:.06em; line-height:1.1;
  margin-bottom:14px;}
.card .end .sub{font-size:14px; margin:0 0 14px;}
.end-figures{display:flex; flex-wrap:wrap; gap:12px 24px; padding:12px 0;
  border-top:1px solid var(--line); border-bottom:1px solid var(--line);}
.end-figure{display:flex; flex-direction:column; gap:3px;}
.end-caption{font-size:10px; letter-spacing:.14em; color:var(--fg-dim);}
.end-value{font-size:18px; color:var(--bright); font-variant-numeric:tabular-nums;}

/* ------------------------------------------------------------ the start screen
   G84, redrawn to artboard 1a in G89: not a card over the board but the whole
   screen, over a sky with ships in it. The name large on the left, the line
   saying what the game is, the menu as framed rows with the key in a chip, the
   build bottom left and the controls bottom right. Amber is what rule 1 above
   says it is — the row the arrows are on, the one Enter does — so a row under
   the mouse only lifts its ground, and the rings mark what they are on in bright. */
.web-over.is-title{background:none; padding:0; align-items:stretch; justify-content:stretch;}
.card.title{max-width:none; max-height:none; width:100%; height:100%; display:flex;
  flex-direction:column; gap:20px; padding:32px clamp(24px, 9vw, 120px); border:0; border-radius:0;
  background:none; text-align:left;}
.card.title .hint{margin-top:0; font-size:12px;}
.title-main{margin:auto 0; display:flex; flex-direction:column; gap:10px; max-width:640px;}
.title-name{color:var(--bright); font-size:clamp(44px, 6vw, 76px); font-weight:600;
  letter-spacing:.22em; line-height:1;}
.title-tag{color:var(--soft); font-size:15px; line-height:1.55; max-width:480px; margin:4px 0 20px;}
.title-menu{display:flex; flex-direction:column; gap:2px; width:min(600px, 100%); margin-bottom:10px;}
.title-row{display:grid; grid-template-columns:auto auto minmax(0,1fr); align-items:center; gap:12px;
  padding:8px 12px; background:var(--panel-bg); border:1px solid var(--line); border-radius:2px;
  cursor:pointer;}
.title-row:hover{background:#151a1f;}
.title-row:hover .title-label{color:var(--bright);}
.title-row.is-cursor{background:#151a1f; border-color:var(--accent);}
.title-row.is-cursor .title-label{color:var(--bright); font-weight:700;}
.title-key{min-width:2.2em; text-align:center; font-size:12px; color:var(--fg); padding:1px 6px;
  border:1px solid var(--fg-dim); border-radius:2px;}
.title-row.is-cursor .title-key{color:var(--bg); background:var(--accent); border-color:var(--accent);}
.title-label{color:var(--fg); font-size:14px; letter-spacing:.1em;}
.title-value{justify-self:end; text-align:right; color:var(--fg-dim); font-size:11px;}
.title-on{color:var(--bright); font-weight:600;}
.title-off{color:var(--fg-dim);}
.title-bottom{display:flex; justify-content:space-between; align-items:flex-end; gap:12px 32px;
  flex-wrap:wrap; font-size:11px; letter-spacing:.08em; color:var(--fg-dim);}
.title-keys{text-align:right;}
.card.title .title-keys .head{margin-top:0;}
.card.title .title-keys .keys{color:var(--soft); white-space:pre;}

/* The sky behind it (ui/web/sky.ts): a layer mount.ts builds once and only
   shows or hides, so the drift runs on through every frame of the menu. Stars
   and hulls in the hull drawing's own tokens; a far ship is dimmer. The drift
   is along each ship's own keel, and off for anyone who asked for less motion. */
.web-sky{position:absolute; inset:0; overflow:hidden; pointer-events:none;}
.web-sky .sky{width:100%; height:100%; display:block;}
.web-frame{display:contents;}
.sky-star{fill:var(--zone);}
.sky-skin{fill:var(--panel-bg); stroke:var(--hull-rim); stroke-width:2.2; stroke-linejoin:miter;}
.sky-cells{fill:none; stroke:var(--zone); stroke-width:1; opacity:.28;}
.sky-pod{fill:var(--hull-plate); stroke:var(--zone); stroke-width:1.4;}
.sky-bell{fill:var(--hull-deep); stroke:var(--zone); stroke-width:1.1;}
.sky-ship.is-far{opacity:.55;}
.sky-ship.is-far .sky-skin{stroke:var(--fg-dim); stroke-width:1.4;}
.sky-ship.is-far .sky-cells{opacity:.16;}
.sky-drift{animation:salvor-drift 40s ease-in-out infinite alternate;}
@keyframes salvor-drift{from{transform:translate(-22px,0);} to{transform:translate(22px,0);}}
@media (prefers-reduced-motion: reduce){.sky-drift{animation:none;}}

/* ----------------------------------------------------------------- the dock
   The tug's board where the schematic goes (ui/web/dock-html.ts, artboard 3c):
   the strip naming the tug and what it is tied to, over a bulkhead-brown rule
   with the mode line to its right; the hull on the tether in a frame, its edge
   taking the alert's colour from three up; the rack as rows with an edge of
   their own, the drone's in amber, because the hull on the rails is the one
   the list's buy lines are measured against; and the credits at the foot. */
.dock{height:100%; overflow-y:auto; padding:4px 12px 8px 2px; display:flex; flex-direction:column;
  gap:16px;}
.dock-head{display:flex; align-items:baseline; flex-wrap:wrap; gap:4px 16px; padding-bottom:10px;
  border-bottom:3px solid var(--bulkhead);}
.dock-tug{color:var(--bright); font-weight:600; letter-spacing:.1em;}
.dock-mode{margin-left:auto; color:var(--soft); font-size:11px; letter-spacing:.06em;}
.dock-hull{display:flex; flex-direction:column; gap:4px; padding:12px 16px; background:var(--panel-bg);
  border:1px solid var(--line); border-left:3px solid var(--line);}
.dock-hull.is-l5,.dock-hull.is-l6,.dock-hull.is-l7,.dock-hull.is-l8{border-left-color:var(--warn);}
.dock-hull.is-l9,.dock-hull.is-l10{border-left-color:var(--bad);}
.dock-name{color:var(--bright); font-weight:600; letter-spacing:.06em;}
.dock-worth{color:var(--fg);} .dock-worth.is-sold{color:var(--good);}
.dock-line{color:var(--soft); font-size:12px;}
.dock-rack{display:flex; flex-direction:column; gap:4px;}
.dock-rack-head{font-size:10px; letter-spacing:.22em; color:var(--soft); margin-bottom:2px;}
.dock-row{display:grid; grid-template-columns:12ch 9ch minmax(0,1fr); gap:12px; align-items:baseline;
  padding:7px 10px; background:#0c1115; border:1px solid var(--line); border-left:3px solid var(--bulkhead);
  border-radius:2px;}
.dock-row > span:first-child{color:var(--fg); font-weight:600;}
.dock-row > span{color:var(--soft);}
.dock-row.is-yours{background:var(--amber-wash); border-color:var(--accent);}
.dock-row.is-yours > span:first-child{color:var(--bright);}
.dock-row.is-yours > span:last-child{grid-column:2 / -1; color:var(--accent);}
.dock-cash{margin-top:auto; padding-top:10px; border-top:1px solid var(--line); color:var(--bright);
  font-size:15px; letter-spacing:.06em;}

/* The charges and the detonation (docs/tasks/G90-smoreg-wave.md, A). A fuse
   is a red number on the hexagon's lower point and the cell blinks with it; a
   blown compartment keeps a dark red floor and a dashed outline; the frame a
   compartment or the whole ship goes up on flashes white and shakes the map.
   All of it stands still for anyone who asked their system for less motion. */
.hexmap .fuse-cap{fill:var(--bad); opacity:.95;}
.hexmap .fuse-count{fill:#fff; font-size:11px; font-weight:700;}
.hexmap .room.is-fused .room-box{animation:salvor-fuse .8s steps(2,end) infinite;}
@keyframes salvor-fuse{0%,100%{stroke:var(--bad);} 50%{fill:var(--red-wash);}}
.hexmap .room.hz-blown .room-box{fill:#1c0e0c; fill-opacity:.95; stroke:var(--bad); stroke-dasharray:3 3;}
.hexmap .hz-blown .hz-rim{stroke:var(--bad);} .hexmap .hz-blown .hz-word{fill:var(--bad);}
.web-map.is-boom{animation:salvor-boom 1s ease-out 1;}
@keyframes salvor-boom{
  0%{box-shadow:inset 0 0 0 999px #fff; transform:none;}
  12%{box-shadow:inset 0 0 0 999px #f0a860; transform:translate(-7px,4px);}
  30%{box-shadow:inset 0 0 0 999px rgba(217,106,106,.6); transform:translate(6px,-5px);}
  55%{box-shadow:inset 0 0 0 999px rgba(217,106,106,.25); transform:translate(-3px,2px);}
  100%{box-shadow:none; transform:none;}}
@media (prefers-reduced-motion: reduce){
  .hexmap .room.is-fused .room-box{animation:none; stroke:var(--bad);}
  .web-map.is-boom{animation:none; box-shadow:inset 0 0 0 3px var(--bad);}}

/* ------------------------------------------------------------- the lesson
   G90 E: the training run's window, over the map's bottom-left corner — the
   top-left is the alert's (.web-corner). In the map's own grid cell, like the
   corner, so it can never cover the panel or the log, and it takes no clicks.
   The head row is the step, the key in the accent and the fold hint dim; the
   instruction reads in the ordinary ink under it. A step just closed puts a
   green tick in front of the head for one turn; folded (Esc) it is the head
   alone; over, the closing line takes the good colour's edge. */
.web-lesson{grid-column:1; grid-row:2; align-self:end; justify-self:start; z-index:2;
  margin:0 0 10px 12px; pointer-events:none; max-width:min(560px, calc(100% - 24px));
  padding:7px 10px 8px; border:1px solid var(--accent); border-left-width:3px; border-radius:2px;
  background:rgba(10,13,16,.92); font-size:12px; line-height:1.4;}
.web-lesson .lh{display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 10px;
  font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--soft);}
.web-lesson .lh .n{color:var(--accent); font-weight:600;}
.web-lesson .lh .k{color:var(--bright); text-transform:none; letter-spacing:.02em;}
.web-lesson .lh .f{margin-left:auto; color:var(--fg-dim); text-transform:none; letter-spacing:0;}
.web-lesson .lh .ok{color:var(--good); font-weight:600;}
.web-lesson .li{margin-top:4px; color:var(--fg); white-space:pre-wrap;}
.web-lesson.is-done{border-color:var(--good);}
.web-lesson.is-over{border-color:var(--good);} .web-lesson.is-over .lh .n{color:var(--good);}
.web-lesson.is-folded{padding-bottom:6px;}
`;
