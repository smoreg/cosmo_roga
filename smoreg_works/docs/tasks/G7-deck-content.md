# G7 — Каталог зон, 10 storylets, подключение `DeckBuilder`

Статус: done · Зависит от: E5, E6, G3 · Блокирует: G8, G9 · Оценка: 4 ч · Пакет: `games/fortnight2`

## Что сделать

1. `src/content/zones.ts`: `ZoneKindSpec[]` по палубам из GDD (таблица «Палубы»), стиль
   интерьера: DOCKING BAY/CARGO/HYDROPONICS — `open`; HAB/MED/LAB/CONTROL — `rooms`;
   STORAGE/MAINTENANCE/WORKSHOP/ENGINEERING — `cluttered`; REACTOR — `open`, `size 1.5`.
   `deckPlan(depth, rng): DeckPlan` — 2–3 зоны из каталога палубы + одна из соседних, `count
   [4,6]`, `entryIn` = первая зона палубы, `stairsIn` последняя (палуба 6: `REACTOR`).
2. `src/content/storylets.ts`: 10 карточек по GDD (обязательные: docking bay, spare parts crate,
   sensor closet, charging alcove, security checkpoint, quarantine ward, reactor antechamber +
   3 своих). Предусловия читают `ctx.player?.data?.rig` через хелперы `burned(ctx, kind)`,
   `emptySlots(ctx)`. Метки: `m`/`M` машина полосы, `X` ящик запчастей (модуль полной
   прочности, kind из имени карточки или случайный), `%` обломки 1–2.
3. `src/content/pack.ts`: `mapgen: { ...DEFAULT_MAPGEN, builder: new DeckBuilder(deckPlan),
   vaultCount: 0, connect: false }` — через `GameConfig.mapgen` в `newGame`.
4. `RIG.onLevelEnter` (или отдельная система `POPULATE` в `src/systems/populate.ts`) читает
   `gen.vaults[].marks` — но `Game` их не хранит! Добавить в движок `Game.lastGen: GeneratedLevel`
   (одно поле, `game.ts`) — единственное касание `packages/`. По меткам: `m` → машина полосы,
   `M` → самая тяжёлая доступная, `X`/`%` → `addWreck`.
5. Палуба 1: `docking bay` всегда (`when: ctx.depth === 1`, weight 1000, `zones: ["docking"]`);
   бюджет машин палубы 1 — 2 плюс те, что в карточке.

## Тесты (`tests/deck-content.test.ts`)

- `newGame(seed)` для 100 сидов × 6 палуб (через `descend` с телепортом игрока на люк —
  хелпер `warpToStairs(game)`) строится без `problems`.
- Палуба 1 всегда содержит зону `docking` и обломки в ≤ 4 клетках от входа.
- Палуба 6 всегда содержит `reactor antechamber` и люк в зоне `reactor`.
- `sensor closet` встречается чаще при сгоревшем сканере (200 сидов, ≥ ×2).
- Каждая метка `m/M/X/%` превратилась в сущность или обломки; ничего не стоит в стене.
- Изоляция зон держится с реальными storylets (200 сидов × 6).
