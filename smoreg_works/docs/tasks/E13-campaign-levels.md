# E13 — Кампания: сохранённые уровни, возврат в них, шлюз наружу

Статус: done, 2026-09-03 (влита веткой `task/campaign` с WIP-коммитом тестов; 10 тестов
`levelstore.test.ts` зелёные) · Иначе, чем в задаче: `descend()` с `claimsOutcome` только
объявляет уход — всю смену уровня и конец забега делает система из `beforeLevelLeave`;
`StoredLevel` получил `gen` и `visits`, `populate` идёт только при первом визите; `entry:
"stairs"` ставит игрока на люк при возврате наверх. **В v3 переезжает в `rooms/game.ts`** порт в
порт — см. `docs/engine-audit-v3.md`, §4 · Зависит от: — · Блокирует: E18 · Оценка: 6 ч ·
Пакет: `packages/engine`

## Зачем

Владелец: «один корабль один данж, просто прорываться сложнее». Сейчас `Game.enterDepth`
порождает уровень заново на каждый вход, поэтому вернуться в тот же дереликт нельзя физически.
Это единственное движковое изменение, без которого v2 не существует.

Формулируется generic: движок не знает слов «дереликт», «вылазка», «буксир». Он знает, что
уровни забега **адресуются идентификатором**, живут в хранилище и что игрок может вернуться в
уже сгенерированный.

## Что сделать

1. `sim/levelstore.ts` — новый файл:
   ```ts
   export type LevelId = string;                   // игра решает формат, движок — нет
   export interface StoredLevel { level: Level; entities: Entity[]; scheduleSeed: number; data: Record<string, unknown>; }
   export class LevelStore {
     get(id: LevelId): StoredLevel | undefined;
     put(id: LevelId, s: StoredLevel): void;
     has(id: LevelId): boolean;
   }
   ```
   `data` — карман для систем игры (что уже забрано, какие двери вскрыты); движок его не читает.
2. `Game`:
   - поле `levels: LevelStore`, поле `levelId: LevelId` (по умолчанию `String(depth)`);
   - `travelTo(id: LevelId, spec: { depth: number; builder?: MapBuilder; entry?: "stairs" | "entry" }): void` —
     если `levels.has(id)`, поднимает сохранённое (тайлы, `explored`, сущности, их расписание) и
     ставит игрока на точку входа; иначе генерирует, как сейчас, и кладёт в хранилище.
     Перед уходом — `beforeLevelLeave(game, depth, reason)`, после входа — `onLevelEnter`.
   - `descend()` остаётся, но становится тонкой обёрткой над `travelTo`, и **перестаёт сама
     объявлять победу**: если какая-нибудь система реализует `claimsOutcome`, победу объявляет
     она. Иначе поведение прежнее (`depth >= maxDepth → won`), чтобы 437 тестов не двинулись.
   - `finish(status: "won" | "dead", line: string): void` — единственный способ для игры закончить
     забег своей строкой.
3. **Причина ухода.** `Twist.beforeLevelLeave?(game, depth, reason: "stairs" | "airlock")`.
   Новый тайл `Tile.AirlockOut` (`<`, walkable, opaque) в `level.ts` `TILES`, в `fixtures`
   `TILE_CHARS` и в `vaults` — команда `descend`, стоя на нём, уходит с `reason: "airlock"`.
   `DeckBuilder` ставит `<` в зоне входа не дальше 3 клеток от точки появления игрока.
   Заодно — флаг `DeckPlan.edgeTile?: (isTreeEdge: boolean) => Tile` (дефолт: всегда
   `Tile.Airlock`), чтобы игра могла ставить на лишние рёбра запертую переборку. Одна строка в
   `deck.ts`, но она нужна G14 и логически принадлежит здесь: рёбра графа зон — дело билдера.
4. **Сериализация.** `save.ts` пишет и читает `LevelStore` целиком; испорченный сейв по-прежнему
   не роняет игру. `replay(seed, inputs)` обязан воспроизводить рейс с возвратами бит-в-бит.

## Файлы

`packages/engine/src/sim/levelstore.ts` (новый), `sim/game.ts`, `sim/level.ts`, `sim/actions.ts`,
`sim/twist.ts`, `sim/save.ts`, `sim/mapgen/deck.ts` (тайл `<`), `testing/fixtures.ts`,
`packages/engine/tests/levelstore.test.ts`, `tests/campaign.test.ts`.

## Тесты

- `travelTo` в новый id генерирует; во второй раз тот же id — **та же карта бит-в-бит**,
  `explored` сохранён, мёртвые не ожили, добавленное в `data` на месте (property, 200 сидов).
- Уход через `<` даёт `reason: "airlock"`, через `>` — `"stairs"`; ход тратится в обоих случаях.
- `<` есть в зоне входа, не дальше 3 клеток по проходимости; никогда не совпадает со шлюзом `=`.
- `finish` кончает забег своей строкой; `descend` на `maxDepth` без `claimsOutcome` побеждает
  по-прежнему (регресс существующих тестов).
- Сейв туда-обратно после трёх переходов и одного возврата; порча сейва не роняет игру.
- Реплей рейса с двумя возвратами — бит-в-бит.

## Критерии

`npm test` и `npm run typecheck` зелёные; ни один существующий тест не менялся по смыслу.

## Чего не делать

Никакой «карты кораблей», никакой экономики, ни одного слова из игры. Не хранить уровни в
модульной переменной — только в `Game`, иначе `new Game` унаследует чужой забег.
