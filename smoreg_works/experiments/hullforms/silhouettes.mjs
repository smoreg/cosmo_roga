/**
 * Twenty hull silhouettes, as data.
 *
 * One character per hexagon:
 *
 *   `#`  hull — a cell compartments may be laid on
 *   `*`  keel — hull, and part of the axial spine the generator grows along
 *   `@`  airlock — hull, and where the salvor comes aboard (one per hull)
 *   `.`  vacuum — outside the plating
 *
 * Cells are separated by spaces and **odd rows are indented by one space**,
 * because that is what the lattice does: on a pointy-top hex grid every odd row
 * sits half a cell east of the one above it (odd-r offset, see
 * `hexgrid.mjs#offsetToAxial`). So the mask in this file is the deck plan, at
 * one character per compartment cell — what is typed is what is drawn.
 *
 * Rules of thumb for editing one by hand:
 *
 *  - cells that touch up, down, left or right in the text always touch on the
 *    lattice; diagonals in the text depend on row parity, so do not rely on
 *    them to keep a hull in one piece;
 *  - a hull must be connected, or the generator will report a broken form;
 *  - `*` is a hint, not a wall: it biases the spine, it does not carve one.
 */

/** @typedef {{ id: string, name: string, note: string, mask: string }} Silhouette */

/** @type {Silhouette[]} */
export const SILHOUETTES = [
  {
    id: "tanker-cigar",
    name: "Танкер-сигара",
    note: "Длинный ровный корпус, сплошной киль от шлюза до носа.",
    mask: `
. . # # # # # # # # . .
 . # # # # # # # # # .
@ * * * * * * * * * * #
 . # # # # # # # # # .
. . # # # # # # # # . .
`,
  },
  {
    id: "boxcar",
    name: "Грузовик-коробка",
    note: "Прямоугольный трюмовик без обводов: одна большая коробка.",
    mask: `
# # # # # # # # #
 # # # # # # # # #
@ * * * * * * * # #
 # # # # # # # # #
# # # # # # # # #
`,
  },
  {
    id: "tug-hammer",
    name: "Буксир-молоток",
    note: "Тонкая рукоять-киль и тяжёлая голова с двигателями.",
    mask: `
. . . . . . . # # #
 . . . . . . # # # #
@ * * * * * * # # # #
 . . . . . . # # # #
. . . . . . . # # #
`,
  },
  {
    id: "cruiser-arrow",
    name: "Крейсер-стрела",
    note: "Острый нос, отогнутые назад крылья, киль по оси.",
    mask: `
. . . . . . . . . # .
 . . . . . . . # # #
. . # # # # # # # # .
 @ * * * * * * * # #
. . # # # # # # # # .
 . . . . . . . # # #
. . . . . . . . . # .
`,
  },
  {
    id: "ring-station",
    name: "Кольцевая станция",
    note: "Замкнутый обод с пустотой внутри: ходишь только по кругу.",
    mask: `
. . # # # # . .
 . # # . . # # .
# # . . . . # #
 @ . . . . . # .
# # . . . . # #
 . # # . . # # .
. . # # # # . .
`,
  },
  {
    id: "comb-pylons",
    name: "Гребёнка с пилонами",
    note: "Хребет и восемь одинаковых пилонов-тупиков под ним.",
    mask: `
@ * * * * * * * * *
 # # # # # # # # #
# . # . # . # . # .
 # . # . # . # . #
# . # . # . # . # .
`,
  },
  {
    id: "catamaran",
    name: "Катамаран",
    note: "Два раздельных корпуса и трёхклеточная перемычка между ними.",
    mask: `
@ # # # # # # #
 # # # # # # # #
. . . # * # . . .
 # # # # # # # #
# # # # # # # #
`,
  },
  {
    id: "miner-scoop",
    name: "Шахтёр с ковшом",
    note: "Раскрытый ковш на длинной штанге, машинный блок в корме.",
    mask: `
. . # # # # . . . .
 . # # # . . . . .
# # # . . . . # # #
 # * * * * * # # # @
# # # . . . . # # #
 . # # # . . . . .
. . # # # # . . . .
`,
  },
  {
    id: "scout-needle",
    name: "Разведчик-игла",
    note: "Одна нитка отсеков и плотный носовой блок на конце.",
    mask: `
. . . . . . . . . . # .
 . . . . . . . . . # # .
@ # * * * * * * * * # #
 . . . . . . . . . # # .
. . . . . . . . . . # .
`,
  },
  {
    id: "hospital-cross",
    name: "Госпиталь-крест",
    note: "Крест: длинная палуба и высокая надстройка поперёк неё.",
    mask: `
. . . # # . . .
 . . . # # . .
. . . # # . . .
 # # # # # # #
@ * * * * * * #
 # # # # # # #
. . . # # . . .
 . . . # # . .
. . . # # . . .
`,
  },
  {
    id: "trident",
    name: "Трезубец",
    note: "Древко-киль, поперечина и три одинаковых зубца вперёд.",
    mask: `
. . . . . . # # # #
 . . . . . . # . .
. . . . . . # . . .
 @ * * * * * # # # #
. . . . . . # . . .
 . . . . . . # . .
. . . . . . # # # #
`,
  },
  {
    id: "wedge-lander",
    name: "Клин-десантник",
    note: "Треугольный клин, широкая корма, узкий таранный нос.",
    mask: `
# # . . . . . . .
 # # # # . . . .
# # # # # # . . .
 @ * * * * * * # .
# # # # # # . . .
 # # # # . . . .
# # . . . . . . .
`,
  },
  {
    id: "spoked-wheel",
    name: "Колесо со спицами",
    note: "Обод, ступица и четыре спицы: два кольца плюс перекрёсток.",
    mask: `
. . # # # # . .
 . # # # . # # .
# # . # . . # #
 @ # # # # # # .
# # . # . . # #
 . # # # . # # .
. . # # # # . .
`,
  },
  {
    id: "barge-train",
    name: "Баржа-состав",
    note: "Три отдельные секции, сцепленные узкими перемычками киля.",
    mask: `
# # # . # # # . # # #
 # # # . # # # . # # #
@ * * * * * * * * * #
 # # # . # # # . # # #
# # # . # # # . # # #
`,
  },
  {
    id: "crab-dredger",
    name: "Краб-драга",
    note: "Приземистый корпус и две клешни, разведённые вперёд.",
    mask: `
. . . . . # # # .
 . . . . # # . .
# # # # # # . . .
 @ * * * # . . .
# # # # # # . . .
 . . . . # # . .
. . . . . # # # .
`,
  },
  {
    id: "relay-dish",
    name: "Ретранслятор-тарелка",
    note: "Дуга антенны, мачта-киль и маленький жилой блок в корме.",
    mask: `
# . . . . . . . .
 # # . . . . . .
# # . . . . # # .
 # # # * * # # @ .
# # . . . . # # .
 # # . . . . . .
# . . . . . . . .
`,
  },
  {
    id: "y-hauler",
    name: "Игрек-развозчик",
    note: "Две вилки в носу сходятся в один хребет к корме.",
    mask: `
# # # . . . . . .
 # # # . . . . .
. . # # . . . . .
 . . # * * * * @
. . # # . . . . .
 # # # . . . . .
# # # . . . . . .
`,
  },
  {
    id: "hex-fort",
    name: "Шестигранный форт",
    note: "Правильный шестиугольник: сплошная масса без выступов.",
    mask: `
. . # # # # . .
 . # # # # # .
. # # # # # # .
 @ # # * * # # #
. # # # # # # .
 . # # # # # .
. . # # # # . .
`,
  },
  {
    id: "whale-factory",
    name: "Китобой-плавбаза",
    note: "Раздутое брюхо, острые оконечности и спинной гребень.",
    mask: `
. . . . # # . . . .
 . . . # # # . . .
. . # # # # # # . .
 . # # # # # # # .
@ * * * * * * * * #
 . # # # # # # # .
. . # # # # # # . .
`,
  },
  {
    id: "drydock-ladder",
    name: "Стапель-лестница",
    note: "Три палубы-рейки и редкие поперечины между ними.",
    mask: `
# # # # # # # # #
 # . . # . . # . #
@ # # # # # # # #
 # . . # . . # . #
# # # # # # # # #
`,
  },
];

/** Parse a mask into `{ q, r, ch, row, col }` cells, in reading order. */
export function parseMask(mask) {
  const out = [];
  const lines = mask.split("\n").filter((line) => line.trim().length > 0);
  lines.forEach((line, row) => {
    line
      .trim()
      .split(/\s+/)
      .forEach((ch, col) => {
        if (ch === ".") return;
        out.push({ row, col, ch });
      });
  });
  return out;
}
