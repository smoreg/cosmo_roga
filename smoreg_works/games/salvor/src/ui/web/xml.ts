/**
 * One escape, for every string either SVG drawing puts on the screen.
 *
 * It lived in `schematic-svg.ts` and still leaves by that door, because half
 * the view imports it from there. It moved because `tiles.ts` needs it too and
 * `schematic-svg.ts` needs `tiles.ts`: a cycle under ESM is not a style
 * complaint but a module that comes up half-built (ADR 0003).
 */

/**
 * Every string on either drawing is content: room names come from a card, and
 * glyphs include `&`, `"` and `<` by design (design-doc.md, "Экран"). One
 * unescaped ampersand takes the whole picture down.
 */
export function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
