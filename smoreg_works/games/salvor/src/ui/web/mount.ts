import type { RoomGame } from "@jamrog/engine";
import type { AppState } from "../appstate.js";
import { NO_FLASH, rackIntegrity, trackFlash, type Flash } from "../panel.js";
import { NOTHING_LIT, type Lit } from "../pulse.js";
import { screenHtml, type MapKind } from "./screen.js";
import { WEB_CSS, WEB_ROOT_CLASS } from "./styles.js";

/**
 * The graphic view's only contact with the DOM: one element, one `innerHTML` a
 * frame, and one click listener.
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
  /** Which of the two drawings the map half shows. Set by `V`, nothing else. */
  private map: MapKind = "graph";
  /** The panel's memory between frames, so a module that just took a blow flashes. */
  private flash: Flash = NO_FLASH;

  constructor(mount: HTMLElement, pick: (index: number) => void, enter: (room: number) => void) {
    injectStyle(mount.ownerDocument);
    this.root = mount.ownerDocument.createElement("div");
    this.root.className = WEB_ROOT_CLASS;
    mount.appendChild(this.root);
    this.root.addEventListener("click", (e) => {
      const index = indexOf(e.target);
      if (index !== undefined) return pick(index);
      // A compartment on the schematic: the same thing its line of the move
      // list does. The list is checked first because a button never sits
      // inside a box, and a box must not swallow a click meant for a row.
      const room = attr(e.target, "data-room");
      if (room !== undefined) enter(room);
    });
  }

  /** The honeycomb or the graph. One renderer: the panel and the log are shared. */
  setMap(map: MapKind): void {
    this.map = map;
  }

  draw(game: RoomGame, state: AppState, lit: Lit = NOTHING_LIT): void {
    // The error screen is drawn without touching the game: whatever broke may
    // well be the ship or the rig, and this is the one frame that has to render.
    if (state.overlay !== "crash") {
      this.flash = trackFlash(this.flash, rackIntegrity(game.player), game.schedule.time);
    }
    this.root.innerHTML = screenHtml(game, state, this.flash.slots, lit, this.map);
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
 * Which line of the action list was clicked, if any. The number is on the
 * button, so a click on the label inside one still finds it.
 */
function indexOf(target: EventTarget | null): number | undefined {
  return attr(target, "data-pick");
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
