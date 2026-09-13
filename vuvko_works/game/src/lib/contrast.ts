/**
 * Contrast ratios, so a palette change is checkable rather than arguable.
 *
 * The ground went from near-black to navy with the kit, which moved every
 * foreground colour's contrast at once, and nothing measured the result. WCAG's
 * arithmetic is short enough to carry here rather than take a dependency for.
 *
 * <https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio>
 */

/** `#rgb` or `#rrggbb` to its three channels, 0–255. */
export function channels(hex: string): [number, number, number] {
  const raw = hex.replace("#", "").trim();
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map(function double(part) {
            return part + part;
          })
          .join("")
      : raw;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/** Relative luminance, with the sRGB transfer curve undone first. */
export function luminance(hex: string): number {
  const linear = channels(hex).map(function straighten(value) {
    const unit = value / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

/** How far apart two colours are, 1 (identical) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const one = luminance(a);
  const two = luminance(b);
  const light = Math.max(one, two);
  const dark = Math.min(one, two);
  return (light + 0.05) / (dark + 0.05);
}
