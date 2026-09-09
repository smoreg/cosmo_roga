# G36 — Содержимое корабля: каталог отсеков, карточки, марки → предметы, первый грузовик

Статус: done 2026-09-03 · Зависит от: E17 (типы), E18, E20 · Блокирует: G37, G25, G14, G17 ·
Оценка: 4 ч · Пакет: `games/salvor`

Иначе, чем в задаче: карточек 19, а не 16 — «engine room / core room / bridge» это три карточки, и
добавлена «picked clean» (пустая, `cardsPerRoom: 2`), без которой каждая подходящая карточка ложится
на каждый корабль и `weightWhen` ничего не решает; единственная запертая дверь грузовика приходит
карточкой `security checkpoint` (веса дверей `locked: 0`, `broken: 0`), а не броском 10 % / 5 %;
`src/game.ts` не тронут (его пишет G35).

## Зачем

Генератор отдаёт отсеки со строковыми типами и марками; кто-то должен сказать, что `docking` —
это DOCKING BAY, а `%:welder` — обломки со сваркой. Это перенос `zones.ts` + `storylets.ts` +
`populate.ts` на карточки (`docs/design-doc.md`, «Как storylets стали карточками отсеков»), плюс
спека первого корабля забега, чтобы игра в `salvor` запускалась и проходилась до появления G25.

## Что сделать

1. `content/zones.ts`: 22 `RoomKindSpec` (17 из v2 + LIFE SUPPORT, CRYO, SENSOR BAY, BRIG,
   ESCAPE PODS); `cover: true` у STORAGE, MAINTENANCE, CARGO, HYDROPONICS, WORKSHOP, ARMORY;
   `required` у ENGINEERING, REACTOR, CONTROL; `deep` у REACTOR, CONTROL. `ZONE_KINDS`,
   `zoneKind(kind)`.
2. `content/cards.ts`: 16 карточек по таблице GDD как `RoomCard` с марками; хелперы `burned`,
   `emptySlots`, `burnedCount` — из `storylets.ts` дословно (читают `ctx.player.data.rig`);
   `CARD_MODULE` как есть; `wreck of your drone` — `when: ctx => deaths.some(d => …)` читает
   `game.flags`-подобную запись через `ctx` (G18 положит её; до G18 карточка недостижима и это
   нормально).
3. `content/derelicts.ts` — **только грузовик** и функция:
   ```ts
   export interface DerelictSpec { id; name; rooms: [number, number]; maxDepth; kinds: readonly string[];
     band: readonly string[]; alertStart; salePrice; doors: Record<…, number>; keyChance; virusBonus; flavour: string[] }
   export const FREIGHTER: DerelictSpec;
   export function shipSpecOf(d: DerelictSpec): ShipSpec;                 // kinds → RoomKindSpec из каталога, cards → CARDS
   export function derelictShip(d: DerelictSpec, index: number, rng: Rng, ctx: CardContext): Ship;
   ```
   Остальные шесть типов, чартеры и порядок рейса — G25 в этот же файл позже.
4. `systems/populate.ts`: `onLevelEnter` при `visits === 1` читает `room.marks` каждого отсека:
   `m` → машина полосы `depth` (`monstersForDepth`), `M` → самая тяжёлая, `m:<id>` → та самая,
   `X[:<module>]` → ящик, `%[:<module>:<int>]` → обломки, `†[:key]` → труп (`room.data.bodies`),
   `key:<id>` → в ближайший труп или новый труп, `*` → вещь чартера, `&` → консоль, `E`/`O`/`T`
   → системы (`room.data.systems`), `cover`/`fire`/`vented` → поля отсека, `contraband` → ящик
   контрабанды. Онбординг: в стартовом отсеке первого корабля всегда обломки (аналог
   `ensureOnboardingScrap`). Предметы — плоские записи в `room.data` с `id`, чтобы команды
   `act` адресовали их числом.
5. `src/game.ts`: `firstShip` → `derelictShip(FREIGHTER, 0, …)` (заменить заглушку G35).

## Файлы

`games/salvor/src/content/zones.ts`, `content/cards.ts`, `content/derelicts.ts`,
`src/systems/populate.ts`, `src/game.ts` (одна строка), `tests/ship-content.test.ts`.

## Тесты

- Каждая карточка ссылается только на существующие типы отсеков и модули; `kinds` грузовика —
  подмножество каталога; `required` присутствуют в спеке.
- `derelictShip(FREIGHTER)` на 200 сидов: 12–14 отсеков, `validateShip` пуст, ровно одна
  запертая дверь и ключ до неё, DOCKING BAY на `depth 0`, обломки в стартовом отсеке.
- Марки становятся предметами: после `onLevelEnter` число машин/обломков/трупов/систем
  совпадает с марками; `E`/`O`/`T` по одному на корабль.
- Повторный `travelTo` не удваивает предметы (`visits > 1` → ничего).
- Карточка `sensor closet` выпадает чаще при сгоревшем сканере (300 сидов, ≥ 60 %).

## Чего не делать

Не описывать чартеры, экономику, остальные типы кораблей (G25, G26). Не читать марки нигде,
кроме `populate.ts`.
