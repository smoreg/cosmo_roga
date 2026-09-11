import { MIN_ROOM_SQFT, PX_FT } from "./types";
import type { InkMask, Regions } from "./types";

/**
 * Flood the empty space inward from the border: whatever it reaches is vacuum.
 * What it cannot reach is enclosed, and each enclosed component is a room — or
 * a suite of rooms whose doorways the artist drew open, which is the same
 * thing to a body walking around.
 *
 * Components smaller than a closet are noise in the line art: the inside of a
 * drawn locker, the cavity between two consoles. They are folded back into
 * structure rather than becoming compartments.
 */
export function findRegions(mask: InkMask): Regions {
  const { w, h, ink } = mask;
  const OUTSIDE = 1;
  const reg = new Int32Array(w * h).fill(-1);
  const stack: number[] = [];

  function pushOutside(index: number): void {
    if (ink[index] === 0 && reg[index] === -1) {
      reg[index] = OUTSIDE;
      stack.push(index);
    }
  }

  for (let x = 0; x < w; x++) {
    pushOutside(x);
    pushOutside((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    pushOutside(y * w);
    pushOutside(y * w + w - 1);
  }
  while (stack.length > 0) {
    const index = stack.pop();
    if (index === undefined) break;
    const x = index % w;
    const y = (index - x) / w;
    if (x > 0) pushOutside(index - 1);
    if (x < w - 1) pushOutside(index + 1);
    if (y > 0) pushOutside(index - w);
    if (y < h - 1) pushOutside(index + w);
  }

  const sizes: number[] = [0, 0];
  let next = 2;
  for (let start = 0; start < reg.length; start++) {
    if (ink[start] !== 0 || reg[start] !== -1) continue;
    const id = next++;
    let count = 0;
    const pending: number[] = [start];
    reg[start] = id;
    while (pending.length > 0) {
      const index = pending.pop();
      if (index === undefined) break;
      count++;
      const x = index % w;
      const y = (index - x) / w;
      if (x > 0 && ink[index - 1] === 0 && reg[index - 1] === -1) {
        reg[index - 1] = id;
        pending.push(index - 1);
      }
      if (x < w - 1 && ink[index + 1] === 0 && reg[index + 1] === -1) {
        reg[index + 1] = id;
        pending.push(index + 1);
      }
      if (y > 0 && ink[index - w] === 0 && reg[index - w] === -1) {
        reg[index - w] = id;
        pending.push(index - w);
      }
      if (y < h - 1 && ink[index + w] === 0 && reg[index + w] === -1) {
        reg[index + w] = id;
        pending.push(index + w);
      }
    }
    sizes[id] = count;
  }

  /* Where each room is, so a zone can be built from the flood rather than from
     whichever hexagon happened to win it. */
  const sumX = new Float64Array(next);
  const sumY = new Float64Array(next);
  for (let index = 0; index < reg.length; index++) {
    const region = reg[index] ?? -1;
    if (region > 1) {
      const x = index % w;
      sumX[region] = (sumX[region] ?? 0) + x;
      sumY[region] = (sumY[region] ?? 0) + (index - x) / w;
    }
  }

  const minimum = Math.round(MIN_ROOM_SQFT * PX_FT * PX_FT);
  for (let index = 0; index < reg.length; index++) {
    const region = reg[index] ?? -1;
    if (region > 1 && (sizes[region] ?? 0) < minimum) reg[index] = -1;
  }
  for (let region = 2; region < next; region++) {
    if ((sizes[region] ?? 0) < minimum) sizes[region] = 0;
  }

  return { reg, sizes, sumX, sumY };
}
