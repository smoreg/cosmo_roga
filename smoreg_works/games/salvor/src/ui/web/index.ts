/**
 * The graphic view, as one door.
 *
 * `app.ts` needs the renderer; the tests need the two pure functions under it.
 * Nothing else in the game imports anything from this directory — a second view
 * is a second way to draw the same data, never a second set of rules.
 */
export { WebRenderer } from "./mount.js";
export { screenHtml } from "./screen.js";
export { svgOf } from "./schematic-svg.js";
export { htmlOf } from "./panel-html.js";
export { WEB_CSS, WEB_ROOT_CLASS } from "./styles.js";
