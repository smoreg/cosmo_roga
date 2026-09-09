# E4 — Зоны уровня и новые тайлы

Статус: done (2026-09-03) · Зависит от: — · Блокирует: E5 · Оценка: 2 ч · Пакет: `packages/engine`

Иначе, чем в плане: `vaults.fits()` теперь считает «хочет ли клетка пол» по `TILES[...].walkable`,
а не по `ch !== "#"` — иначе вольт с `|` заваривал существующий пол.

## Зачем

Палуба состоит из зон, соединённых шлюзами. Движку нужно понятие зоны (прямоугольный сектор
с именем и типом — типы задаёт игра строками) и два тайла: шлюз и переборка.

## Что сделать

1. `sim/level.ts`:
   ```ts
   export const enum Tile { Wall, Floor, StairsDown, Door, Rubble, Airlock, Bulkhead }
   // Airlock:  ch "=", walkable: true,  transparent: false, name "airlock"
   // Bulkhead: ch "|", walkable: false, transparent: false, name "sealed bulkhead"
   ```
   Цвета — в духе существующих; игра всё равно перекрашивает через свой `theme`.
   ```ts
   export interface Zone {
     id: number;
     /** Content-defined kind, e.g. "cargo". The engine never interprets it. */
     kind: string;
     name: string;
     rect: RoomRect;            // inclusive, including the zone's own wall ring
     airlocks: Point[];
   }
   class Level { readonly zones: Zone[] = []; zoneAt(p: Point): Zone | undefined }
   ```
   `zoneAt` — по `rect`. Зоны не пересекаются (инвариант E5).
2. `sim/mapgen/types.ts`: `BuildResult.zones?: Zone[]`; `mapgen/index.ts` копирует их в
   `level.zones`.
3. `testing/fixtures.ts`: `fromAscii` понимает `=` (Airlock) и `|` (Bulkhead); `toAscii`
   рисует их обратно. Внимание: `|` не должен конфликтовать с маркерами — маркеры буквы.
4. `sim/mapgen/vaults.ts` `TILE_CHARS`: добавить `=` и `|` — вольт может содержать шлюз
   и переборку.
5. `sim/fov.ts`/shadowcast: ничего не менять — `transparent:false` уже даёт нужное.
6. `sim/mapgen/postprocess.ts` `placeDoors`: не ставить `Door` на клетку, соседнюю со шлюзом
   (два прохода подряд читаются как баг), и никогда не заменять `Airlock`/`Bulkhead`.

## Файлы

`sim/level.ts`, `sim/mapgen/types.ts`, `sim/mapgen/index.ts`, `sim/mapgen/vaults.ts`,
`sim/mapgen/postprocess.ts`, `testing/fixtures.ts`, `tests/zones.test.ts` (новый),
дополнить `tests/shadowcast.test.ts` одним случаем.

## Тесты

- `fromAscii` → `toAscii` round-trip с `=` и `|`.
- Шлюз проходим, не прозрачен; переборка непроходима. FOV: сквозь `=` не видно, стоя на `=`
  видно обе стороны (симметрия сохранена — прогнать существующий symmetry-тест на карте со шлюзом).
- `zoneAt` возвращает зону по точке внутри и `undefined` снаружи.
- `placeDoors` никогда не ставит дверь рядом со шлюзом (карта с шлюзом, 50 сидов).
- Вольт со шлюзом внутри стампуется корректно.

## Критерии приёмки

`npm test` зелёный, включая все 200×8 property-тестов mapgen (новые тайлы не должны их задеть:
`TILES[...]` покрывает все значения enum — проверить `validate.ts` и `toAscii`).
