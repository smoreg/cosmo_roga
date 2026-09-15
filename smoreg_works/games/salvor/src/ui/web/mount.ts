import type { LogLine, RoomGame } from "@jamrog/engine";
import type { AppState } from "../appstate.js";
import { NO_FLASH, rackIntegrity, trackFlash, type Flash } from "../panel.js";
import { NOTHING_LIT, type Lit } from "../pulse.js";
import { blastLineOf } from "../logline.js";
import { screenHtml, type MapKind } from "./screen.js";
import { skySvg } from "./sky.js";
import { WEB_CSS, WEB_ROOT_CLASS } from "./styles.js";

/**
 * The graphic view's only contact with the DOM: one element, one `innerHTML` a
 * frame, one click listener — and the start screen's sky, which is set once and
 * only shown or hidden after that.
 *
 * Everything above it is a pure function of the game — which is why this file is
 * the one part of the view no test covers, and why it is kept short enough to
 * read in full. It has no rules: a click is turned into the index of a line and
 * handed straight to the reducer, so the mouse reaches the game through exactly
 * the door a digit does.
 */

/** Injected once per document, whatever happens to the view after that. */
let styled = false;

export class WebRenderer {
  private readonly root: HTMLElement;
  /**
   * The start screen's space, built once and never rewritten: its drift is a
   * CSS animation, and an element `innerHTML` replaces starts it over — which
   * on a screen redrawn by every key press is a sky that jumps on every key.
   */
  private readonly sky: HTMLElement;
  /** What each frame rewrites. `display:contents`, so its children stay cells of the root's grid. */
  private readonly frame: HTMLElement;
  /** Which of the two drawings the map half shows. Set by `V`, nothing else. */
  private map: MapKind = "graph";
  /** Whether the honeycomb wears its hull (G81). `?hull=0` turns it off; nothing else does. */
  private hull = true;
  /** Whether a glyph on the schematic is drawn as a tile (G80). `?tiles=1` turns it on. */
  private tiles = false;
  /** The panel's memory between frames, so a module that just took a blow flashes. */
  private flash: Flash = NO_FLASH;
  /** The blow the map has already shaken for, so a cursor move on the same turn does not shake it again. */
  private shaken: ReadonlySet<number> = NO_FLASH.slots;
  /** The blast the map has already flashed for, for the same reason (`screen.ts`, `blastLineOf`). */
  private boomed: LogLine | undefined;
  /** The compartment the pointer was last reported over, so a redraw under a resting pointer asks nothing. */
  private hovered: number | undefined;

  constructor(
    mount: HTMLElement,
    line: (index: number) => void,
    enter: (room: number) => void,
    door: (id: number) => void = () => {},
    hover: (room: number | undefined) => void = () => {},
    press: (key: string) => void = () => {},
  ) {
    injectStyle(mount.ownerDocument);
    const doc = mount.ownerDocument;
    this.root = doc.createElement("div");
    this.root.className = WEB_ROOT_CLASS;
    this.sky = doc.createElement("div");
    this.sky.className = "web-sky";
    this.sky.hidden = true;
    this.sky.innerHTML = skySvg();
    this.frame = doc.createElement("div");
    this.frame.className = "web-frame";
    this.root.appendChild(this.sky);
    this.root.appendChild(this.frame);
    mount.appendChild(this.root);
    this.root.addEventListener("click", (e) => {
      const index = indexOf(e.target);
      if (index !== undefined) return line(index);
      // A door's corridor or tag on the honeycomb: that door's row (G90 D3).
      // Never inside a box, so the order against the box does not matter.
      const id = attr(e.target, "data-door");
      if (id !== undefined) return door(id);
      // A panel line that stands for a key — the virus line is `v` — is that
      // key pressed, so the click and the key are one rule (G90).
      const key = keyOf(e.target);
      if (key !== undefined) return press(key);
      // A compartment on the schematic: the same thing its line of the move
      // list does. The list is checked first because a button never sits
      // inside a box, and a box must not swallow a click meant for a row.
      const room = attr(e.target, "data-room");
      if (room !== undefined) enter(room);
    });
    // Where the pointer rests: the map draws the way there (G90 D4). Reported
    // only when it changes — every frame rebuilds the element under a resting
    // pointer, and the browser reports that as a new arrival.
    this.root.addEventListener("mouseover", (e) => {
      const room = attr(e.target, "data-room");
      if (room === this.hovered) return;
      this.hovered = room;
      hover(room);
    });
  }

  /** The honeycomb or the graph. One renderer: the panel and the log are shared. */
  setMap(map: MapKind): void {
    this.map = map;
  }

  /** The drawn hull under the honeycomb, on or off. A URL setting, like the view. */
  setHull(on: boolean): void {
    this.hull = on;
  }

  /** Pictures where the glyphs go, on or off. A URL setting, like the hull. */
  setTiles(on: boolean): void {
    this.tiles = on;
  }

  draw(game: RoomGame, state: AppState, lit: Lit = NOTHING_LIT, debug = false): void {
    // The error screen is drawn without touching the game: whatever broke may
    // well be the ship or the rig, and this is the one frame that has to render.
    if (state.overlay !== "crash") {
      this.flash = trackFlash(this.flash, rackIntegrity(game.player), game.schedule.time);
    }
    this.sky.hidden = state.overlay !== "title";
    this.frame.innerHTML = screenHtml(
      game,
      state,
      this.flash.slots,
      lit,
      this.map,
      debug,
      this.hull,
      this.tiles,
    );
    // The frame is rebuilt on every key, and a rebuilt `.is-hit` restarts its
    // animation: the red edge may stay for the whole turn, the shake may not.
    // `trackFlash` hands back a new set only for a new blow.
    const hit = this.frame.querySelector<HTMLElement>(".web-map.is-hit");
    if (hit && this.shaken === this.flash.slots) hit.style.animation = "none";
    this.shaken = this.flash.slots;
    // The same for a compartment — or the ship — going up: the line is the
    // same object for as long as the log holds it, so a redraw on the turn of
    // the blast finds the one it already flashed for.
    const boom = this.frame.querySelector<HTMLElement>(".web-map.is-boom");
    const blast = state.overlay === "crash" ? undefined : blastLineOf(game);
    if (boom && blast !== undefined && this.boomed === blast) boom.style.animation = "none";
    this.boomed = blast;
    // The newest line, not the oldest. The whole screen is rebuilt every frame,
    // so the log's scroll starts at the top every time — and the top of a log
    // is the part a player has already read. The history stays scrollable above
    // it; what is pinned is where the box opens.
    const log = this.root.querySelector(".web-log");
    if (log) log.scrollTop = log.scrollHeight;
    // And the panel follows the cursor. The list is longer than the sidebar on
    // any busy compartment, and an arrow key that moves a highlight out of the
    // frame has taken the list away from the player.
    this.root.querySelector(".act.is-cursor")?.scrollIntoView({ block: "nearest" });
  }

  /** Off the screen and out of the way, without losing what it remembers. */
  show(visible: boolean): void {
    this.root.hidden = !visible;
  }
}

/**
 * Which line of the action list was clicked, if any: its position in the list
 * as drawn, not the digit it happens to be wearing. The number is on the
 * button, so a click on the label inside one still finds it.
 */
function indexOf(target: EventTarget | null): number | undefined {
  return attr(target, "data-line");
}

/** The key a clicked line stands for, if it stands for one. */
function keyOf(target: EventTarget | null): string | undefined {
  const el = target instanceof Element ? target.closest("[data-key]") : null;
  const key = el?.getAttribute("data-key");
  return key === null || key === undefined || key.length === 0 ? undefined : key;
}

/** The whole number carried by the nearest ancestor with that attribute. */
function attr(target: EventTarget | null, name: string): number | undefined {
  const el = target instanceof Element ? target.closest(`[${name}]`) : null;
  if (!el) return undefined;
  const value = Number(el.getAttribute(name));
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function injectStyle(doc: Document): void {
  if (styled) return;
  styled = true;
  const style = doc.createElement("style");
  style.textContent = WEB_CSS;
  doc.head.appendChild(style);
}
