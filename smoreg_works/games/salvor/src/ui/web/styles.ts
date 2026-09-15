import { THEME } from "../theme.js";
// The two faces the design system is set in, vendored rather than fetched: the
// build opens from a file:// URL inside an itch zip, where there is no network
// to ask (`assets/CREDITS.md`, both are OFL 1.1). Imported the way the sound
// effects are, so the bundler hashes and copies them and the URL it hands back
// is relative to the page — `vite.config.ts`, `base: "./"`.
import barlow600 from "../../../../../assets/fonts/barlow-condensed-600-latin.woff2?url";
import barlow700 from "../../../../../assets/fonts/barlow-condensed-700-latin.woff2?url";
import mono400 from "../../../../../assets/fonts/plex-mono-400-latin.woff2?url";
import mono400cyr from "../../../../../assets/fonts/plex-mono-400-cyrillic.woff2?url";
import mono600 from "../../../../../assets/fonts/plex-mono-600-latin.woff2?url";
import mono600cyr from "../../../../../assets/fonts/plex-mono-600-cyrillic.woff2?url";

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
 * G91 A adds the third: the partner's design system (`salvor-design-system`),
 * adopted as material rather than as markup. Three things come from it and
 * nothing else does — a **type scale** of five roles with a hard floor of 14px,
 * a **housing** for every block that used to be a rule between two rows, and a
 * **motion grid** on which nothing interpolates. The colours are untouched: his
 * ground, ink and amber are already `content/palette.ts`, which is why the only
 * tokens added below are geometry, type and time.
 *
 * No web fonts and no CDN. The build has to run from a file:// URL inside an
 * itch.io zip with no network at all, so the stack is the system's own and what
 * is carried over from his sheet is the scale, the weights and the tracking.
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

/**
 * The two faces, declared off the files the bundler copied beside the page.
 *
 * Barlow Condensed carries display and title, IBM Plex Mono everything that is
 * read in a column. Barlow has no Cyrillic — the subset does not exist — so a
 * Russian heading falls through to the mono behind it in the same stack, per
 * glyph, which is what a font stack is for and why nothing has to branch on the
 * language. Two subsets and no more: 72 KB for six files.
 */
const FACES = `
@font-face{font-family:"Barlow Condensed";font-style:normal;font-weight:600;font-display:swap;
  src:url(${barlow600}) format("woff2");
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2122,U+2212;}
@font-face{font-family:"Barlow Condensed";font-style:normal;font-weight:700;font-display:swap;
  src:url(${barlow700}) format("woff2");
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2122,U+2212;}
@font-face{font-family:"IBM Plex Mono";font-style:normal;font-weight:400;font-display:swap;
  src:url(${mono400}) format("woff2");
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2122,U+2212;}
@font-face{font-family:"IBM Plex Mono";font-style:normal;font-weight:400;font-display:swap;
  src:url(${mono400cyr}) format("woff2");
  unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116;}
@font-face{font-family:"IBM Plex Mono";font-style:normal;font-weight:600;font-display:swap;
  src:url(${mono600}) format("woff2");
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2122,U+2212;}
@font-face{font-family:"IBM Plex Mono";font-style:normal;font-weight:600;font-display:swap;
  src:url(${mono600cyr}) format("woff2");
  unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116;}
`;

export const WEB_CSS = `${FACES}
.${WEB_ROOT_CLASS}{${ROOT}
  /* Plex first, the system's own mono behind it — and behind that the generic,
     because a glyph the subsets do not carry (the bar, the rule, the arrow the
     door lines are drawn with) has to come from somewhere monospaced or the
     panel's columns stop lining up. */
  --mono: "IBM Plex Mono", ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace;
  /* Condensed, and only where nothing is set in a column. */
  --sv-font-display: "Barlow Condensed", var(--mono);
  --amber-wash:#1a140a;
  --red-wash:#1c1113;

  /* ------------------------------------------------ the kit's vocabulary (G91 A)
     The partner's design system, in our names. Every colour it asks for this
     palette already had — his ground, ink and amber *are* ours — so nothing
     below forks \`content/palette.ts\`. What is added is the three things his
     screens are made of and ours were not: a material, a type scale and a
     motion grid, under the names his own \`styles.css\` gives them.

     The plate steps are the drawn hull's three tones (\`PALETTE.hullArt\`): the
     housings are made of the same steel as the ship, which is why no new
     colour was needed to build them. */
  --sv-deep:var(--hull-deep);
  --sv-plate:var(--hull-body);
  --sv-plate-lit:var(--hull-plate);
  --sv-plate-hi:var(--hull-plate-lit);
  /* A rule you can see against the plate, where \`--line\` disappears into it. */
  --sv-rule:#2a3238;

  /* Geometry: a corner cut off a housing, machined hatching for a ground,
     scanlines for a printout, and the shadow a plate casts on the deck. */
  --sv-notch:14px;
  --sv-notch-sm:9px;
  --sv-cut-tr:polygon(0 0,calc(100% - var(--sv-notch)) 0,100% var(--sv-notch),100% 100%,0 100%);
  --sv-cut-bl:polygon(0 0,100% 0,100% 100%,var(--sv-notch-sm) 100%,0 calc(100% - var(--sv-notch-sm)));
  --sv-hatch:repeating-linear-gradient(135deg,#0d1216 0 6px,#111820 6px 12px);
  --sv-scan:repeating-linear-gradient(0deg,transparent 0 3px,rgba(223,233,240,.028) 3px 4px);
  --sv-cast:0 7px 10px rgba(0,0,0,.62);

  /* Type — five roles, and a hard floor of 14px under all of them.
     The panel ran at 13px with 10 and 11px labels doing eleven different jobs,
     which is how a game screen ends up reading as an admin panel: every row the
     same weight, and the small print small because there was nowhere else to
     put it. A role is set (\`font:var(--sv-body)\`), never a size — that is the
     whole discipline, and it is what keeps eleven jobs down to five.

     His two faces, vendored: the build runs from a file:// URL inside an itch
     zip with no network, so nothing is fetched — the files sit in \`assets/fonts\`
     and the bundler copies them beside the page. Display and title are condensed
     and set on a line of their own; everything read in a column stays mono. */
  --sv-display:700 clamp(30px,3.4vw,42px)/1.02 var(--sv-font-display);
  --sv-title:600 21px/1.15 var(--sv-font-display);
  --sv-value:600 17px/1.2 var(--mono);
  --sv-body:400 14px/1.5 var(--mono);
  --sv-stencil:600 14px/1.2 var(--mono);
  --sv-display-track:.16em;
  --sv-title-track:.08em;
  --sv-stencil-track:.18em;

  /* Motion — one frame, and every duration a multiple of it. Nothing
     interpolates: a state is a held frame, and \`--sv-step\` is what holds it.
     The budget is deliberately nearly spent already — this view rebuilds its
     whole frame from \`innerHTML\` on every key press, so an animation that is
     not guarded in \`mount.ts\` replays on every key, and only the four below
     are guarded or slow enough to survive it. */
  --sv-frame:225ms;
  --sv-frame-2:450ms;
  --sv-frame-3:675ms;
  --sv-frame-4:900ms;
  --sv-step:steps(1,end);

  position:fixed; inset:0; display:grid;
  /* The rework's grid: a key rail, the board, the panel — and the log across
     the whole foot rather than tucked under the map.
     The strip that used to take a band of its own at the top is gone: what it
     said is a housing floating over the board now (\`.web-head\`), which is where
     his screen puts it and which buys the board back the 38px it cost. Seven
     log lines at the 14px floor is 144, the same seven the terminal shows, and
     both fixed bands still land inside the itch viewport's 764
     (docs/itch-page.md). */
  grid-template-columns:46px 1fr clamp(340px, 31vw, 460px);
  grid-template-rows:minmax(0,1fr) 144px;
  background:var(--bg); color:var(--fg);
  font:var(--sv-body); overflow:hidden;
}
.${WEB_ROOT_CLASS} *{box-sizing:border-box;}

/* --------------------------------------------------------------- the strip */
/* Which ship this is and what turn it is: the two lines the panel used to open
   with, moved out of it so the panel can start on the thing that matters.

   Not a band across the top any more but a housing floating over the board —
   his clock, in our words: the hull's name, its class, and the turn the sortie
   is on. He mounts the name to the board's top-left and puts the clock in the
   middle; ours takes the far corner instead, because the top-left is already
   the alert's (\`.web-corner\`) and our alert is a ladder of ten rungs rather
   than a dial. It will not share a corner, and two housings overlapping is
   worse than either being where he drew it. Takes no clicks: the compartment
   under it is still pressable. */
.web-head{grid-column:2; grid-row:1; align-self:start; justify-self:end; z-index:3;
  margin:10px 12px 0 0; pointer-events:none; max-width:calc(100% - 24px);
  display:flex; align-items:baseline; gap:8px 16px; padding:6px 14px 7px;
  background:var(--sv-scan),rgba(10,13,16,.92); box-shadow:var(--sv-cast);
  border:1px solid var(--sv-rule); clip-path:var(--sv-cut-bl);
  white-space:nowrap; overflow:hidden;}
.web-head .ship{font:var(--sv-title); letter-spacing:var(--sv-title-track); color:var(--bright);
  text-transform:uppercase; overflow:hidden; text-overflow:ellipsis;}
/* The hull's class and the sortie, stencilled beside the name; the turn and the
   seed after them, in capitals as the artboard sets them. */
.web-head .cls{font:var(--sv-stencil); letter-spacing:.1em; color:var(--soft);
  text-transform:uppercase; overflow:hidden; text-overflow:ellipsis;}
.web-head .turn{flex-shrink:0; font:var(--sv-stencil); color:var(--soft);
  letter-spacing:.1em; text-transform:uppercase; font-variant-numeric:tabular-nums;
  padding-left:14px; border-left:1px solid var(--sv-rule);}

/* ------------------------------------------------------------------- the rail
   The mouse's way into the three windows a key opens. Every button is a key
   this game already has (\`data-key\`, pressed by \`mount.ts\` exactly as the
   keyboard presses it), so the rail adds no command and no rule — a player who
   never touches it plays the same game, and a player who never reads the help
   card can still find the help card. */
.web-rail{grid-column:1; grid-row:1; display:flex; flex-direction:column; gap:6px;
  padding:10px 0 0; align-items:center;
  background:linear-gradient(90deg,var(--sv-plate) 0%,var(--sv-deep) 100%);
  border-right:1px solid var(--sv-rule);}
.rail-key{width:32px; height:32px; display:flex; align-items:center; justify-content:center;
  font:var(--sv-value); color:var(--soft); background:var(--sv-plate-lit);
  border:1px solid var(--sv-rule); border-radius:0; cursor:pointer;
  clip-path:polygon(0 0,100% 0,100% 100%,6px 100%,0 calc(100% - 6px));}
.rail-key:hover{background:var(--sv-plate-hi); color:var(--bright);}
.rail-key:active{transform:translateY(1px);}
.rail-key:focus-visible{outline:2px solid var(--accent); outline-offset:-2px;}

/* ------------------------------------------------------------- the schematic */
/* The board sits on a lit ground, and the light is centred on the board rather
   than thrown in from a corner (G91 B, his 04-hex screen): an ellipse a little
   above and left of the middle, deck at its centre and the page's own black by
   three quarters out. The hull is drawn in the middle of this frame, so a wash
   that started bright at 30% 20% lit the empty top-left and left the ship in
   the dark half of its own room.

   The cell it sits in is the middle column of the reworked grid (G91 A): the
   rail is to its left and the log runs under the whole screen. */
.web-map{grid-column:2; grid-row:1; min-width:0; min-height:0; padding:10px 4px 4px 12px;
  background:radial-gradient(ellipse 66% 60% at 46% 48%, var(--panel-bg) 0%, var(--bg) 78%);}
.schematic{width:100%; height:100%; display:block;}
/* The frame the drone took a blow on (screen.ts, flash): the map's edge goes
   red, and the map shakes once. The edge is a colour and stays for anyone; the
   shake is motion and does not. */
.web-map.is-hit{box-shadow:inset 0 0 0 2px var(--bad); animation:salvor-shake var(--sv-frame-2) var(--sv-step) 1;}
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

/* ------------------------------------------------- the face of a compartment
   The partner's board, adopted (G91 B; his components/board/HexTile.jsx). One
   idea runs through all of it: **how much is printed on a cell IS how much the
   drone knows of it**, and colour only backs that up. A hexagon with no band has
   not been found. A striped band means a label without a look — pinged from
   outside and nothing more. A solid band means the drone has stood in there.

   The name is knocked out of the plate rather than written beside it, which is
   the printed language the readouts and the door tags are already in, and it
   takes the name off the dark floor where a long one used to run into the
   outline. Four classes deep, so the shared state block above cannot outrank it.

   Which is also why the four plates are all LIGHT, and the ladder between them
   is hue and pattern rather than brightness. Knocking near-black ink out of the
   dim end of our own palette gives two to one — a plate the width of the cell
   that the name then cannot be read off, which is a worse place to put a name
   than the dark floor it came from. Grey is the drone's memory, striped while
   that memory is second-hand; steel is a live look; amber is underfoot. */
.hexmap .room-band{fill:none;}
/* The stripe is one dashed line as wide as the band is tall (BAND_H in
   hex-svg.ts), so a two-tone plate costs one element and the rhythm is CSS's.
   Both of its tones take the knocked-out ink: a stripe you cannot read half the
   name off is a stripe that has eaten the thing it was decorating. */
.hexmap .band-hatch{stroke:none; stroke-width:16; stroke-dasharray:5 5;}
.hexmap .room.is-scanned .room-band{fill:var(--soft);}
.hexmap .room.is-scanned .band-hatch{stroke:var(--fg);}
.hexmap .room.is-explored .room-band{fill:var(--soft);}
.hexmap .room.is-visible .room-band{fill:var(--zone);}
.hexmap .room.is-current .room-band{fill:var(--accent);}
.hexmap .room:not(.is-unknown) .room-name{fill:var(--bg); font-weight:700; letter-spacing:.02em;}
/* The compartment the highlighted line points at keeps a second signal on the
   honeycomb, because the first one — the amber dashed outline — is a thin line
   on a busy hull: the same dash, struck round its plate. Not an amber fill,
   which is the one thing that means the drone is standing there. */
.hexmap .room.is-goal .room-band{stroke:var(--accent); stroke-width:1.5; stroke-dasharray:6 3;}

/* Properties on their own channel: a dashed ring inside the outline whose
   rhythm says which one. The floor and the two rimmed edges are the hazard's
   already, so a second wash would only be the same fact said twice — a rhythm
   is a channel neither the state nor the hazard is using, and it survives being
   printed, dimmed or read by someone who does not separate the two blues.

   Rhythms and washes are his PROP table; the colours are ours, because ours
   already obey the rule his does not have to: red belongs to the machines and
   amber to a decision. An alarmed cell is a machine, so its rule is last and a
   cell that is both alarmed and frozen rings for the machine. */
.hexmap .prop-ring{fill:none; stroke-width:2; stroke-linejoin:round; opacity:.85;}
.hexmap .hz-frost .prop-ring{stroke:var(--zone); stroke-dasharray:15 7;}
.hexmap .hz-smoke .prop-ring{stroke:var(--soft); stroke-dasharray:3 10;}
.hexmap .hz-blown .prop-ring{stroke:var(--bad); stroke-dasharray:6 4;}
.hexmap .room.is-alarmed .prop-ring{stroke:var(--bad); stroke-dasharray:4 3;
  animation:salvor-flick var(--sv-frame-2) steps(2,end) infinite;}
/* Two held frames of 225ms and nothing between them — the kit's whole motion
   budget, and the only kind of motion this screen can carry: the frame is
   rebuilt by innerHTML on every keypress, so a one-shot animation would restart
   on every keypress unless something outside remembers it has already played
   (ui/web/mount.ts, the hit shake). A state that is simply true while it is true
   can restart as often as it likes. */
@keyframes salvor-flick{0%{opacity:.85;} 50%{opacity:.28;}}

/* The corridor, hollow. Two bulkhead rails with the deck between them and the
   door's own line down the middle of that, instead of one solid brown bar: an
   open door becomes a gap you can see through, and a closed one's dashes are
   read against the dark rather than against the wall they are cut into. The six
   door states keep the dash rhythms the shared block gives them — weight for how
   hard, gap for how shut — which is the one thing on the map that must not move. */
.hexmap .hall-floor{stroke:var(--bg); stroke-width:7; stroke-linecap:butt;}
.hexmap .hall-floor.is-airlock{stroke:var(--amber-wash);}
/* And the way to where the drone is aiming lights the whole tube, rails and all
   — his bracket down both edges of the run, rather than one brighter line inside
   a corridor that stayed brown while the walk went through it. */
.hexmap .hall-wall.is-route{stroke:var(--accent);}

/* The drone crowning its cell: his hexagon at a smaller size, ink knocked out,
   the mark inside it. Still the last thing drawn on the deck (G90 D2). */
.hexmap .drone-pip{fill:var(--accent);}

/* The readout beside the compartment being aimed at (G91 B, his popover): what
   it is, what is unusual in it, and what walking there costs. A plate the same
   near-black the door tags use, ruled in the accent down its left edge so it
   reads as belonging to the amber decision rather than to the cell it covers,
   and the cost knocked out of a chip the way every other chip on this screen
   knocks its ink out. It takes no clicks: the compartment under it stays the
   thing you press. */
.hexmap .room-readout{pointer-events:none;}
.hexmap .readout-plate{fill:var(--bg); fill-opacity:.95; stroke:var(--accent); stroke-width:1;}
.hexmap .readout-head{font-size:12px; font-weight:700; letter-spacing:.06em; fill:var(--bright);}
.hexmap .readout-body{font-size:10px; fill:var(--soft);}
.hexmap .readout-chip{fill:var(--accent);}
.hexmap .readout-cost{font-size:10px; font-weight:700; letter-spacing:.06em; fill:var(--bg);}
/* A walk with a locked or a welded door in it, or no walk at all: the whole
   readout goes to the colour of trouble, so the chip can never read "go" while
   the plate around it says otherwise. */
.hexmap .room-readout.is-shut .readout-plate{stroke:var(--bad);}
.hexmap .room-readout.is-shut .readout-chip{fill:var(--bad);}

@media (prefers-reduced-motion: reduce){
  .hexmap .room.is-alarmed .prop-ring{animation:none; opacity:1;}}

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
.web-panel{grid-column:3; grid-row:1; min-height:0; overflow-y:auto; padding:10px 12px 0;
  scroll-padding-bottom:64px;
  /* The ground the housings stand on is the machine's own, scanlines and all,
     rather than a flat panel colour: it is what makes a plate on it read as a
     plate rather than as a box drawn on a page. */
  background:var(--sv-scan),var(--bg); border-left:1px solid var(--sv-rule);
  display:flex; flex-direction:column; gap:10px;}

/* One block of the panel, as a housing rather than as a rule between two rows.
   panelBlocks already parts the blocks with blank rows, and \`panel-html.ts\`
   says of each one what it is (\`data-pb\`) without reading a word of it; this is
   where that answer is spent. The default is the system's house style — the
   machine's own printout: a dark ground read through scanlines, one corner cut
   off the bottom left, and a shadow under it so it sits *on* the panel instead
   of being drawn on it.

   Four materials and no more: the printout is the default, the rack is a plate
   bolted to an edge, the contacts are a bracket, and the list has no housing at
   all. More than that on one screen and the housing stops saying anything,
   which is the tell the rework exists to remove. */
.pb{position:relative; display:flex; flex-direction:column; gap:2px;
  padding:9px 11px 10px; background:var(--sv-scan),var(--sv-deep);
  box-shadow:var(--sv-cast); clip-path:var(--sv-cut-bl);}

/* A block's own title: struck into the housing's head rather than set as one
   more row of the same size. Only a block's first row can be one (panel-html.ts,
   \`first\`), so this can take the width of the housing without catching a row. */
.pb > .pl.h{margin:-9px -11px 7px; padding:5px 11px 4px; overflow:hidden;
  font:var(--sv-stencil); letter-spacing:var(--sv-stencil-track); text-transform:uppercase;
  background:linear-gradient(180deg,var(--amber-wash) 0%,transparent 100%);
  border-bottom:1px solid var(--sv-rule);}

/* The rack: a plate bolted to the panel's edge. A cut corner, a hatched ground
   and a bolted left edge — the one block that is hardware rather than a report,
   and the one that has to read as the thing damage lands on. */
.pb[data-pb="rack"]{background:var(--sv-scan),var(--sv-hatch);
  clip-path:var(--sv-cut-tr); border-left:2px solid var(--bulkhead);}

/* What is in here with you: no housing at all, two corners implying the frame,
   in the colour the contacts rule is already shouting in. A block that is only
   ever drawn when something is wrong does not need a box as well. */
.pb[data-pb="contacts"]{background:none; box-shadow:none; clip-path:none; padding:10px 11px 11px;}
.pb[data-pb="contacts"]::before,.pb[data-pb="contacts"]::after{content:""; position:absolute;
  width:18px; height:18px; pointer-events:none;}
.pb[data-pb="contacts"]::before{left:0; top:0; border-top:2px solid var(--bad);
  border-left:2px solid var(--bad);}
.pb[data-pb="contacts"]::after{right:0; bottom:0; border-bottom:2px solid var(--bad);
  border-right:2px solid var(--bad);}

/* The list you press: no housing either, and its heading painted on the hull
   with a struck rule running off to the right. The rows are the housings here
   (\`.act\`), and a plate inside a plate is the tell coming back. */
.pb[data-pb="acts"]{background:none; box-shadow:none; clip-path:none; padding:2px 1px;}
.pb[data-pb="acts"] > .pl.h{display:flex; align-items:center; gap:10px;
  margin:0 0 7px; padding:0 0 5px; background:none; border-bottom:0;}
.pb[data-pb="acts"] > .pl.h::after{content:""; flex:1; height:3px;
  background:repeating-linear-gradient(90deg,var(--accent) 0 7px,transparent 7px 11px); opacity:.7;}

.pl{white-space:pre; min-height:1.5em;}
.pl.is-press{cursor:pointer; text-decoration:underline dotted; text-underline-offset:3px;}
.pl.h{font:var(--sv-stencil); letter-spacing:var(--sv-stencil-track); color:var(--soft);}
.pl.hit{color:var(--bad); animation:salvor-hit var(--sv-frame-2) steps(2,end) 2;}
@keyframes salvor-hit{0%,100%{opacity:1;} 50%{opacity:.25;}}
@media (prefers-reduced-motion: reduce){.pl.hit{animation:none;}}

/* Stability, cell by cell. \`▮▮▯\` is a bar in the terminal because a character
   cell is all it has; here each mark becomes a struck cell of its own — lit
   where the module holds it, dim where it has been lost — left aligned and
   never stretched, so two modules of different size are read against each
   other without a number restating the count. The glyph itself is the ink's
   carrier and nothing else, which is why it is set to no size at all. */
.bar{display:inline-flex; gap:2px; vertical-align:-2px;}
/* Seven pixels and two of gap — nine, a shade more than the 8.4 the glyph took.
   The widest module the panel can print is sixteen cells (PANEL_WIDTH less the
   shortest name), and sixteen of these still land inside the narrow end of the
   panel's clamp; tests/chrome.test.ts does that sum rather than trusting it. */
.bar i{display:block; width:7px; height:13px; font-size:0; background:currentColor;
  clip-path:polygon(16% 0,100% 0,84% 100%,0 100%);}
.bar .off{color:var(--line);}

/* The rack. A slot is a row with a bar in it, and it gets the row treatment: a
   cold ground, a quiet left edge, and nothing loud — so that the one slot which
   is loud has the whole panel to itself. */
.pl.slot{padding:3px 7px; background:var(--sv-plate); border:1px solid var(--line);
  border-left:2px solid var(--sv-rule);}
/* Wear, by share (panel-html.ts, slotTone): whole or nearly is the row's own
   light ink, under three quarters the warning colour, the last point or quarter
   red with a red left edge. */
.pl.slot.is-worn .bar .on{color:var(--warn);}
.pl.slot.is-low .bar .on{color:var(--bad);}
.pl.slot.is-low{border-left-color:var(--bad);}
/* Burned out: a dotted empty bay, which is what it is. It used to be a red
   hatched row naming what used to be in it — but what used to be in it is a
   fact for the log, not a permanent label on the rack, and a red row among
   red rows is one more thing to read on the turn there is least time to. */
.pl.slot.is-burned{border:1px dotted var(--burned); border-left:2px dotted var(--burned);
  background:repeating-linear-gradient(135deg,#0d1216 0 6px,#111820 6px 12px);}
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
.web-corner{grid-column:2; grid-row:1; align-self:start; justify-self:start; z-index:2;
  margin:10px 0 0 12px; pointer-events:none;
  display:flex; flex-direction:column; align-items:flex-start; gap:6px;}
/* At home there is no alert and nothing aboard, and the dock's own head is
   where the corner would sit: the codex stays one key away on i. */
.web-map:has(.dock) ~ .web-corner{display:none;}
.web-codex{background:var(--accent); color:var(--bg); padding:3px 9px;
  font:var(--sv-stencil); letter-spacing:var(--sv-stencil-track); text-transform:uppercase;
  clip-path:polygon(0 0,100% 0,100% 100%,6px 100%,0 calc(100% - 6px));}
/* The ladder is a printout: scanlined ground, a cut corner, and the ink at the
   floor like everything else. It had ten rows at 10px — the smallest type on
   the screen carrying the one deadline on it. */
.web-ladder{display:flex; flex-direction:column; gap:1px; padding:7px 10px 8px;
  border:1px solid var(--sv-rule); background:var(--sv-scan),rgba(10,13,16,.9);
  box-shadow:var(--sv-cast); clip-path:var(--sv-cut-bl);
  font:var(--sv-body); line-height:1.35;}
.web-ladder.is-l5,.web-ladder.is-l6,.web-ladder.is-l7,.web-ladder.is-l8{border-color:var(--warn);}
.web-ladder.is-l9,.web-ladder.is-l10{border-color:var(--bad); background:var(--red-wash);}
.rung-head{font:var(--sv-value); letter-spacing:.04em; color:var(--soft);
  white-space:pre; margin-bottom:4px;}
.web-ladder.is-l5 .rung-head,.web-ladder.is-l6 .rung-head,.web-ladder.is-l7 .rung-head,
.web-ladder.is-l8 .rung-head{color:var(--warn);}
.web-ladder.is-l9 .rung-head,
.web-ladder.is-l10 .rung-head{color:var(--bad); animation:salvor-alert var(--sv-frame-4) steps(2,end) infinite;}
@keyframes salvor-alert{0%,100%{opacity:1;} 50%{opacity:.35;}}
@media (prefers-reduced-motion: reduce){.web-ladder.is-l9 .rung-head,.web-ladder.is-l10 .rung-head{animation:none;}}
.rung,.hz{display:grid; grid-template-columns:14px 12ch auto; gap:8px; align-items:baseline;
  white-space:nowrap;}
.rung i,.hz i{font-style:normal;}
/* The word is the rung, what it does is the note beside it: one role apart,
   and the row's own state still colours both. */
.rung .w,.hz .w{font-weight:600;}
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

.acts{display:flex; flex-direction:column; gap:2px;}
/* The group a run of rows opens (\`action.head\`): a stencilled caption inside
   the list, never the block's own struck title. */
.acts .pl.h{margin:7px 0 2px; color:var(--soft);}
/* Three columns on one line (3a): the key with the cursor mark in front of it,
   the label, and the price or the ways through at the right. The label may
   wrap; the other two never do. Every row is a plate with a corner cut off it,
   so the list reads as a stack of keyed hardware rather than as a paragraph of
   verbs — which is what it was, and what the rework is answering. */
.act{display:grid; grid-template-columns:26px minmax(0,1fr) auto; gap:8px; align-items:baseline;
  width:100%; text-align:left; padding:4px 8px; border:1px solid var(--line); border-radius:0;
  background:var(--sv-plate); color:var(--fg); font:var(--sv-body); cursor:pointer;
  clip-path:var(--sv-cut-bl);}
.act:hover{background:var(--sv-plate-lit); border-color:var(--sv-rule);}
.act:active{background:var(--sv-plate-hi); transform:translateY(1px);}
/* The ring goes inside the row, not around it: a plate with a corner clipped
   off clips whatever is drawn outside its own box, and an outline at a positive
   offset is exactly that — the keyboard ring disappeared the moment the rows
   became plates. */
.act:focus-visible{outline:2px solid var(--accent); outline-offset:-2px;}
.act .key{display:flex; align-items:center; justify-content:flex-end; gap:2px;
  color:var(--soft); white-space:nowrap; font-variant-numeric:tabular-nums;}
/* The key itself as a stamped chip: notched like the housings, stencilled, and
   the one thing on the row that says what to press. */
.act .kc{display:inline-block; min-width:15px; padding:1px 3px; text-align:center;
  font:var(--sv-stencil); background:var(--sv-plate-hi); color:var(--bright);
  clip-path:polygon(0 0,100% 0,100% 100%,4px 100%,0 calc(100% - 4px));}
.act .label{white-space:pre-wrap;}
/* The price, or the other ways through: its own column at the right, and no
   tracking on it — the label beside it is what the row is, and on a panel at
   the narrow end of its clamp every pixel spent here is a pixel the label
   wraps for. */
.act .extra{grid-column:3; color:var(--soft); font:var(--sv-stencil); letter-spacing:0;
  white-space:nowrap; text-align:right;}
/* A line that cannot be pressed says why in its own words, so the words stay
   readable — the soft ink, over 3:1 on the panel — and only the key goes dark.
   It gives up the plate as well: a row with nothing under it is not hardware,
   and the pointer is told so before it arrives (G90 D5). */
.act.is-off{color:var(--soft); background:none; border-color:transparent;}
.act.is-off .key{color:var(--fg-dim);}
.act.is-off .kc{background:none; border:1px dotted var(--sv-rule); color:var(--fg-dim);
  clip-path:none;}
.act.is-off .extra{color:var(--soft);}
/* The cursor row is bracketed, not filled: a bar down each side in the one
   colour that means a decision is waiting. Filling it would spend amber on a
   whole row and leave the exposed slot nothing louder to be. */
.act.is-cursor{background:var(--amber-wash); border-color:var(--accent); color:var(--accent);
  box-shadow:inset 3px 0 0 var(--accent),inset -3px 0 0 var(--accent);}
.act.is-cursor .key{color:var(--accent);}
.act.is-cursor .kc{background:var(--accent); color:var(--bg);}
.act.is-cursor .label{font-weight:700;}
.act .cursor{color:var(--accent); width:9px; flex:none;}
/* A greyed row does not answer the pointer as if it would press (G90 D5), and a
   cursor with nothing pressable to rest on is dim rather than amber: amber says
   a decision is waiting, and on a list of refusals none is. */
.act.is-off:hover,.act.is-off:active{background:none; border-color:transparent; transform:none;}
.act.is-cursor.is-off{background:none; border-color:var(--line); color:var(--soft);
  box-shadow:inset 3px 0 0 var(--line),inset -3px 0 0 var(--line);}
.act.is-cursor.is-off .key,.act.is-cursor.is-off .cursor{color:var(--fg-dim);}
.act.is-cursor.is-off .kc{background:none; color:var(--fg-dim);}
.act.is-cursor.is-off .label{font-weight:400;}

/* The keys, pinned to the bottom right corner of the panel in every state —
   "подсказки по хоткеям всегда снизу справа" (docs/tasks/G48-travel-to-a-room.md).
   panelBlocks already puts them on its last rows; margin-top:auto is what
   keeps them at the corner when the panel is taller than its content. */
.pb.foot{margin-top:auto; position:sticky; bottom:0;
  background:linear-gradient(180deg,var(--sv-deep) 0%,var(--panel-bg) 100%);
  border-top:2px solid var(--sv-rule); padding:8px 2px 9px; color:var(--soft);
  font:var(--sv-body); text-align:right; box-shadow:none; clip-path:none;}

/* -------------------------------------------------------------------- the log */
/* A strip across the whole foot of the screen, not a box under the map: the
   rework's grid, and it buys every line about a third more room before it
   wraps. Seven lines and the newest of them at the bottom, which is what the
   terminal shows too (LAYOUT.logHeight). The rest of the tail stays scrollable
   above: mount.ts pins the box to its own bottom after every frame, because
   innerHTML reopens it at the top otherwise — and the top of a log is the part
   already read.

   The strip is also the way into the record: a click is \`PageUp\`
   (\`screen.ts\`, \`data-key\`), so the ticker expands into the whole log the way
   his does, through the window this game already has. */
.web-log{grid-column:1 / -1; grid-row:2; min-height:0; overflow-y:auto;
  display:flex; flex-direction:column; cursor:pointer;
  padding:5px 14px; border-top:2px solid var(--sv-rule); background:var(--sv-scan),#0c1013;
  font:var(--sv-body); line-height:1.35;}
.web-log div{white-space:pre-wrap;}
/* A short tail sits on the floor of the box rather than hanging from its
   ceiling: the newest line is always the bottom one. An auto margin rather than
   justify-content, which would put the overflow out of reach of the scrollbar. */
.web-log > div:first-child{margin-top:auto;}
/* And the newest line leads with an amber tab — the one thing on the strip that
   is news rather than record. Not on a live alarm, which already owns the whole
   row in red and must not be argued with. */
.web-log > div:last-child:not(.live){border-left:3px solid var(--accent);
  margin-left:-14px; padding-left:11px;}
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
/* A card is the same printout the panel's blocks are: a dark ground read
   through scanlines, one corner cut off, and — the house move — a title with
   the ink knocked out of a solid band of the card's own colour, so the card
   announces itself in one stroke instead of in a line of coloured text. */
.card{max-width:min(700px,92vw); max-height:88vh; overflow-y:auto; padding:0 26px 22px;
  border:1px solid var(--sv-rule); border-radius:0; box-shadow:var(--sv-cast);
  clip-path:var(--sv-cut-bl); background:var(--sv-scan),var(--sv-deep);}
.card div{white-space:pre-wrap;}
.card > .h{margin:0 -26px 14px; padding:6px 26px; background:var(--accent); color:var(--bg);
  font:var(--sv-title); letter-spacing:var(--sv-title-track); text-transform:uppercase;}
.card .head{color:var(--soft); font:var(--sv-stencil); letter-spacing:var(--sv-stencil-track);
  text-transform:uppercase; margin-top:16px;}
.card .keys{color:var(--fg); font:var(--sv-body); line-height:1.4;}
.card .prose{color:var(--soft); font:var(--sv-body); line-height:1.4;}
.card .sub{color:var(--fg); margin:10px 0;}
.card .hint{color:var(--fg-dim); margin-top:16px;}
.card.good > .h{background:var(--good);} .card.bad > .h{background:var(--bad);}
/* The help card's key column (artboard 1g): the key a row is about, in the
   colour of a key to press, so the card reads down its keys. */
.card .keys .press{color:var(--accent);}

/* A run that is over, or a hull or a drone that is (artboard 1f): the word
   large, the reason under it, the run's numbers in a row between two rules,
   each one big under a small caption, and what to press last. */
.card .end{padding-top:22px;}
/* The one place the display role is spent inside a card: the word a run ends
   on. No band behind it — a band is how a card names itself, and this is the
   card. */
.card .end .h{font:var(--sv-display); letter-spacing:var(--sv-display-track);
  background:none; color:var(--accent); margin:0 0 14px; padding:0; text-transform:none;}
.card.good .end .h{color:var(--good);} .card.bad .end .h{color:var(--bad);}
.card .end .sub{font:var(--sv-body); margin:0 0 14px;}
.end-figures{display:flex; flex-wrap:wrap; gap:12px 24px; padding:14px 0;
  border-top:1px solid var(--sv-rule); border-bottom:1px solid var(--sv-rule);}
.end-figure{display:flex; flex-direction:column; gap:3px;}
.end-caption{font:var(--sv-stencil); letter-spacing:var(--sv-stencil-track); color:var(--fg-dim);
  text-transform:uppercase;}
.end-value{font:var(--sv-value); color:var(--bright); font-variant-numeric:tabular-nums;}

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
  background:none; box-shadow:none; clip-path:none; text-align:left;}
.card.title .hint{margin-top:0; font:var(--sv-body); color:var(--fg-dim);}
.title-main{margin:auto 0; display:flex; flex-direction:column; gap:10px; max-width:640px;}
.title-name{color:var(--bright); font-size:clamp(44px, 6vw, 76px); font-weight:600;
  letter-spacing:.22em; line-height:1;}
.title-tag{color:var(--soft); font-size:16px; line-height:1.55; max-width:480px; margin:4px 0 20px;}
.title-menu{display:flex; flex-direction:column; gap:3px; width:min(600px, 100%); margin-bottom:10px;}
.title-row{display:grid; grid-template-columns:auto auto minmax(0,1fr); align-items:center; gap:12px;
  padding:8px 12px; background:var(--sv-plate); border:1px solid var(--line); border-radius:0;
  clip-path:var(--sv-cut-bl); cursor:pointer;}
.title-row:hover{background:var(--sv-plate-lit);}
.title-row:hover .title-label{color:var(--bright);}
.title-row.is-cursor{background:var(--amber-wash); border-color:var(--accent);
  box-shadow:inset 3px 0 0 var(--accent),inset -3px 0 0 var(--accent);}
.title-row.is-cursor .title-label{color:var(--bright); font-weight:700;}
.title-key{min-width:2.2em; text-align:center; font:var(--sv-stencil); color:var(--bright);
  padding:2px 6px; background:var(--sv-plate-hi);
  clip-path:polygon(0 0,100% 0,100% 100%,5px 100%,0 calc(100% - 5px));}
.title-row.is-cursor .title-key{color:var(--bg); background:var(--accent);}
.title-label{color:var(--fg); font:var(--sv-body); letter-spacing:.1em;}
.title-value{justify-self:end; text-align:right; color:var(--fg-dim); font:var(--sv-stencil);
  letter-spacing:.06em;}
.title-on{color:var(--bright); font-weight:600;}
.title-off{color:var(--fg-dim);}
.title-bottom{display:flex; justify-content:space-between; align-items:flex-end; gap:12px 32px;
  flex-wrap:wrap; font:var(--sv-stencil); letter-spacing:.08em; color:var(--fg-dim);}
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
.dock-tug{font:var(--sv-title); letter-spacing:var(--sv-title-track); color:var(--bright);}
.dock-mode{margin-left:auto; font:var(--sv-stencil); letter-spacing:var(--sv-stencil-track);
  text-transform:uppercase; color:var(--soft);}
/* The hull on the tether, in the same housing the panel's blocks wear. */
.dock-hull{display:flex; flex-direction:column; gap:4px; padding:12px 16px;
  background:var(--sv-scan),var(--sv-deep); box-shadow:var(--sv-cast); clip-path:var(--sv-cut-tr);
  border-left:3px solid var(--sv-rule);}
.dock-hull.is-l5,.dock-hull.is-l6,.dock-hull.is-l7,.dock-hull.is-l8{border-left-color:var(--warn);}
.dock-hull.is-l9,.dock-hull.is-l10{border-left-color:var(--bad);}
.dock-name{font:var(--sv-value); letter-spacing:.06em; color:var(--bright);}
.dock-worth{color:var(--fg);} .dock-worth.is-sold{color:var(--good);}
.dock-line{color:var(--soft); font:var(--sv-body);}
.dock-rack{display:flex; flex-direction:column; gap:4px;}
.dock-rack-head{font:var(--sv-stencil); letter-spacing:var(--sv-stencil-track);
  text-transform:uppercase; color:var(--soft); margin-bottom:2px;}
.dock-row{display:grid; grid-template-columns:12ch 9ch minmax(0,1fr); gap:12px; align-items:baseline;
  padding:7px 10px; background:var(--sv-plate); border:1px solid var(--line);
  border-left:3px solid var(--bulkhead); border-radius:0; clip-path:var(--sv-cut-bl);}
.dock-row > span:first-child{color:var(--fg); font-weight:600;}
.dock-row > span{color:var(--soft);}
.dock-row.is-yours{background:var(--amber-wash); border-color:var(--accent);
  box-shadow:inset 3px 0 0 var(--accent),inset -3px 0 0 var(--accent);}
.dock-row.is-yours > span:first-child{color:var(--bright);}
.dock-row.is-yours > span:last-child{grid-column:2 / -1; color:var(--accent);}
.dock-cash{margin-top:auto; padding-top:10px; border-top:1px solid var(--sv-rule);
  color:var(--bright); font:var(--sv-value); letter-spacing:.06em;}

/* The charges and the detonation (docs/tasks/G90-smoreg-wave.md, A). A fuse
   is a red number on the hexagon's lower point and the cell blinks with it; a
   blown compartment keeps a dark red floor and a dashed outline; the frame a
   compartment or the whole ship goes up on flashes white and shakes the map.
   All of it stands still for anyone who asked their system for less motion. */
.hexmap .fuse-cap{fill:var(--bad); opacity:.95;}
.hexmap .fuse-count{fill:#fff; font-size:11px; font-weight:700;}
/* Two held frames of 225ms, which is the kit's motion budget (G91) and what
   the fuse was already nearly doing. His stylesheet writes steps(1,end) over
   a two-stop keyframe, which holds the first frame for the whole duration and
   never reaches the second; two steps is what that meant, so that is what both
   blinks on this map use — through the token, so one budget governs both
   halves of the screen. */
.hexmap .room.is-fused .room-box{animation:salvor-fuse var(--sv-frame-2) steps(2,end) infinite;}
@keyframes salvor-fuse{0%,100%{stroke:var(--bad);} 50%{fill:var(--red-wash);}}
.hexmap .room.hz-blown .room-box{fill:#1c0e0c; fill-opacity:.95; stroke:var(--bad); stroke-dasharray:3 3;}
.hexmap .hz-blown .hz-rim{stroke:var(--bad);} .hexmap .hz-blown .hz-word{fill:var(--bad);}
.web-map.is-boom{animation:salvor-boom var(--sv-frame-4) var(--sv-step) 1;}
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
.web-lesson{grid-column:2; grid-row:1; align-self:end; justify-self:start; z-index:2;
  margin:0 0 10px 12px; pointer-events:none; max-width:min(600px, calc(100% - 24px));
  padding:8px 12px 9px; border:1px solid var(--accent); border-left-width:3px; border-radius:0;
  clip-path:var(--sv-cut-bl); box-shadow:var(--sv-cast);
  background:var(--sv-scan),rgba(10,13,16,.92); font:var(--sv-body); line-height:1.4;}
.web-lesson .lh{display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 10px;
  font:var(--sv-stencil); letter-spacing:.08em; text-transform:uppercase; color:var(--soft);}
.web-lesson .lh .n{color:var(--accent); font-weight:600;}
.web-lesson .lh .k{color:var(--bright); text-transform:none; letter-spacing:.02em;}
.web-lesson .lh .f{margin-left:auto; color:var(--fg-dim); text-transform:none; letter-spacing:0;}
.web-lesson .lh .ok{color:var(--good); font-weight:600;}
.web-lesson .li{margin-top:4px; color:var(--fg); white-space:pre-wrap;}
.web-lesson.is-done{border-color:var(--good);}
.web-lesson.is-over{border-color:var(--good);} .web-lesson.is-over .lh .n{color:var(--good);}
.web-lesson.is-folded{padding-bottom:6px;}

/* ------------------------------------------------------- the motion budget (G91 A)
   The floor under everything above, and the last word on it: a system asked
   for less motion gets none. Every animation on this screen is also stopped by
   a rule of its own next to where it is started — this is the sweep that
   catches the next one somebody adds without writing that rule.

   What moves at all is four things, and each is a state the player caused: the
   panel row a blow landed on, the map's shake under the same blow, the ship
   going up, and the alert's head row once the charges are armed. Each holds
   discrete frames on the \`--sv-frame\` grid; none of them interpolates. The one
   thing that does is the sky behind the start screen — it is the world drifting
   past, not a control answering a press, and forty seconds of it stepped at a
   quarter second would be a ship that stutters rather than sails. */
@media (prefers-reduced-motion: reduce){.${WEB_ROOT_CLASS} *{animation:none !important;}}
`;
