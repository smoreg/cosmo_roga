/**
 * A mask, as an SVG `<symbol>` of unit rectangles.
 *
 * This is the form the game can actually use. Both graphic views are SVG with a
 * `viewBox`, and a hull of sixteen compartments lands on the itch viewport at
 * somewhere around 2.0–2.6× — never a whole multiple — so a raster sprite loses
 * its pixel grid there whatever `image-rendering` says. Pixel art is literally
 * rectangles, and rectangles survive any scale. The other half of it is colour:
 * a tile has to be repainted by what the view knows (remembered, in sight, a
 * machine standing in it), and a PNG cannot be repainted from CSS. A symbol
 * filled with `currentColor` can.
 *
 * Runs are merged along the row and then down the column, so a solid twelve by
 * twelve block is one rectangle rather than a hundred and forty-four.
 */

/**
 * Greedy rectangle cover of a mask: widest run in a row, then grown downwards
 * as far as the identical run continues.
 */
export function rectsOf(rows) {
  const size = rows.length;
  const taken = rows.map((row) => [...row].map((cell) => cell !== "#"));
  const out = [];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (taken[y][x]) continue;

      let w = 0;
      while (x + w < size && !taken[y][x + w]) w += 1;

      let h = 1;
      while (y + h < size) {
        let same = true;
        for (let i = 0; i < w && same; i += 1) same = !taken[y + h][x + i];
        // The run below has to be exactly this wide, or the rectangle would
        // swallow a pixel that belongs to the next run along.
        if (same && x + w < size && !taken[y + h][x + w]) same = false;
        if (!same) break;
        h += 1;
      }

      for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) taken[y + j][x + i] = true;
      out.push({ x, y, w, h });
      x += w - 1;
    }
  }
  return out;
}

/** `<symbol>` for one mask. No colour anywhere: the view brings it. */
export function symbolOf(id, rows) {
  const size = rows.length;
  const body = rectsOf(rows)
    .map(({ x, y, w, h }) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`)
    .join("");
  return `<symbol id="${id}" viewBox="0 0 ${size} ${size}" fill="currentColor">${body}</symbol>`;
}
