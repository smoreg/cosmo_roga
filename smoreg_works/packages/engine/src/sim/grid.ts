export interface Point {
  x: number;
  y: number;
}

export const DIRS8: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

export const DIRS4: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export function key(x: number, y: number): number {
  // 16-bit packing; map dimensions stay far below 65535.
  return (y << 16) | (x & 0xffff);
}

export function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Dense typed grid. Flat array, row-major. */
export class Grid<T> {
  readonly width: number;
  readonly height: number;
  private cells: T[];

  constructor(width: number, height: number, fill: T) {
    this.width = width;
    this.height = height;
    this.cells = new Array<T>(width * height).fill(fill);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): T | undefined {
    if (!this.inBounds(x, y)) return undefined;
    return this.cells[y * this.width + x];
  }

  /** Unsafe getter for hot loops; caller guarantees bounds. */
  at(x: number, y: number): T {
    return this.cells[y * this.width + x]!;
  }

  set(x: number, y: number, v: T): void {
    if (!this.inBounds(x, y)) return;
    this.cells[y * this.width + x] = v;
  }

  fill(v: T): void {
    this.cells.fill(v);
  }

  forEach(fn: (x: number, y: number, v: T) => void): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) fn(x, y, this.cells[y * this.width + x]!);
    }
  }

  clone(): Grid<T> {
    const g = new Grid<T>(this.width, this.height, this.cells[0]!);
    g.cells = this.cells.slice();
    return g;
  }
}
