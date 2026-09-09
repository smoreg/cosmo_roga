# E17 — Граф отсеков: `Ship`, пути, шум, видимость, фикстура-DSL

Статус: done (3 сентября) · Зависит от: — · Блокирует: E18, E19, E20, G31 · Оценка: 5 ч · Пакет: `packages/engine`

Иначе, чем в задаче: шлюз — петля (`door.a === door.b`), узла «снаружи» нет; на выходе из пакета
четыре имени переименованы, потому что их занял сеточный движок (`Behaviour` → `RoomBehaviour`,
`behaviourByName` → `roomBehaviourByName`, `BEHAVIOURS` → `ROOM_BEHAVIOURS`, `Problem` →
`ShipProblem`; внутри `packages/engine` имена из аудита); `layoutShip` до E20 живёт в
`testing/roomfixtures.ts`; `RoomIntent.go` несёт `DoorId`, а не `Door`; `spawnMonster` не тронут —
новые поля копирует только `spawnMonsterIn`.

## Зачем

v3 (`docs/design-doc.md`, «Модель мира») ставит дрона в отсек, а не в клетку. Движку нужен второй
«Level»: граф отсеков и дверей с состояниями, расстояния по нему, шум по нему, видимость по нему —
и текстовая фикстура, чтобы каждый тест v3 рисовался строкой, как сейчас `fromAscii`. Всё это —
generic: движок не знает, что такое дереликт, ключ-карта или модуль. Сигнатуры — в
`docs/engine-audit-v3.md`, §5; здесь они обязательны, не примерны.

## Что сделать

1. `packages/engine/src/rooms/graph.ts`: типы `RoomId`, `DoorId`, `DoorState`, `Room`, `Door` и
   класс `Ship` ровно по аудиту: `rooms`, `doors`, `entry`, `doorsOf`, `neighbours`, `other`,
   `passable(door, who)`, `seeThrough(door)`, `door(label)`, `room(label)`. Правила `passable`:
   `open`/`closed`/`broken` — все; `locked`/`sealed` — только `who.breacher`; `airlock` — только
   `who.isPlayer`. `Ship` — плоские данные плюс методы; ни одного `Map` с функциями внутри, чтобы
   сериализовалось `JSON.stringify`.
2. `rooms/types.ts`: `RoomKindSpec`, `RoomCard`, `CardContext`, `ShipSpec`, `Problem` — **только
   типы** (реализация генератора — E20; G36 пишет данные против этих типов раньше E20).
3. `rooms/paths.ts`: `RoomDistance.from(ship, goals, passable)`, `at`, `nextDoor(from, passable)`
   (шаг вниз по градиенту: сосед с наименьшим значением, при равенстве — меньший `door.id`),
   `flee(passable)` (умножить на −1.2, пересканировать — как `fleeMap` в `sim/dijkstra.ts`),
   `static combine(parts)`; `exploreTarget(ship, from, passable)` — дверь в сторону ближайшего
   `!explored` отсека; `blockedBy(ship, from)` — двери, которые единственные отделяют `from` от
   неразведанного (для стопа автоисследования `Everything left is behind d3`).
4. `rooms/noise.ts`: `propagateRooms(ship, sources, loss)` — та же очередь «громкое первым», что
   в `sim/propagate.ts`; потери по умолчанию: open/broken 1, closed 3, locked/sealed 4, airlock
   ∞; отсек с `hazard === "vented"` принимает, но не передаёт дальше.
5. `rooms/sight.ts`: `visibleRooms(ship, from, depth)` (через `seeThrough`), `scanRooms(ship,
   from, depth)` (через любые двери), `canSee(ship, viewer, target)`: тот же отсек — да, если
   `!target.hidden || viewer.keen`; соседний сквозь открытую дверь — если `viewer.sight === 1`.
   Поля `sight`, `keen`, `breacher`, `range` на `Entity` — добавить в `sim/entity.ts` вместе с
   `room?: number` и `hidden?: boolean`; в `content/kinds.ts` — `sight?`, `keen?`, `breacher?` на
   `MonsterKind`, и `spawnMonster` копирует их (без `pos`-версии: `spawnMonsterIn(kind, room)`).
6. `rooms/behaviours.ts` — **каркас**: тип `RoomWorld { ship; entities; player; rng; noise;
   cache? }`, тип `RoomIntent`, `Behaviour`, один профиль `brute` (идёт по `RoomDistance` к
   отсеку игрока, бьёт в своём отсеке) и `behaviourByName` с фолбэком на `brute`. E19 добавит
   остальные; E18 строит мост на это.
7. `testing/roomfixtures.ts`: `shipFromText(text)` по грамматике из аудита §5. Строки-рёбра
   `A -door- B` (одна строка может содержать цепочку `r1 -d1- r2 -(d2)- r3`), строки-отсеки
   `id: kind tokens…`; `TUG -a1- r1` создаёт дверь `airlock`; неизвестные отсеки получают `kind
   "room"`; `depth` считается BFS от отсека со шлюзом; `layoutShip` — заглушка `col = depth,
   row = порядковый номер` (E20 заменит на настоящую, интерфейс тот же). Возвращает `{ ship,
   player, marks }` и `mark(token)` как у `fromAscii`. Плюс `shipToText(ship)` для вывода
   упавшего теста.
8. `rooms/index.ts` + одна строка в `src/index.ts`; `testing/index.ts` экспортирует фикстуру.

## Файлы

`packages/engine/src/rooms/graph.ts`, `rooms/types.ts`, `rooms/paths.ts`, `rooms/noise.ts`,
`rooms/sight.ts`, `rooms/behaviours.ts` (каркас), `rooms/index.ts`, `src/index.ts` (экспорт),
`sim/entity.ts` (пять необязательных полей), `content/kinds.ts` (три поля + `spawnMonsterIn`),
`testing/roomfixtures.ts`, `testing/index.ts`, `packages/engine/tests/room-graph.test.ts`,
`tests/room-paths.test.ts`, `tests/room-noise.test.ts`, `tests/room-sight.test.ts`,
`tests/roomfixtures.test.ts`.

## Тесты

- Фикстура: `shipFromText` → `shipToText` round-trip на всех шести состояниях дверей и с ключом;
  `depth` считается правильно на графе с петлёй; `mark("†")` находит отсек.
- `passable`: машина без `breacher` не проходит `locked`/`sealed`; `breacher` проходит; никто,
  кроме игрока, не проходит `airlock`.
- `RoomDistance`: на цепочке `r1 -d1- r2 -(d2)- r3` расстояния 0/1/2; `nextDoor` ведёт вниз;
  недостижимое — `Infinity`; `flee` уводит от цели; `combine` с весами даёт ожидаемый порядок;
  `exploreTarget` ведёт к ближайшему неразведанному, `undefined` когда всё разведано;
  `blockedBy` называет запертую дверь и только её.
- Шум: значение строго убывает с каждой дверью; закрытая гасит на 3, открытая на 1; за
  заваренной 4; за шлюзом 0; из `vented` не выходит ничего; два источника — максимум, не сумма.
- Видимость: `visibleRooms(depth 1)` не включает отсек за закрытой дверью; `scanRooms(depth 2)`
  включает и не включает третий; `canSee` — все шесть комбинаций `sight × hidden × keen`.
- Все существующие 266 тестов зелёные без правок; `npm run typecheck` чистый.

## Критерии

`npm test`, `npm run typecheck`. В `rooms/` — ни одного `Math.random`, `Date.now`, `document`,
`window`; `tests/purity.test.ts` игры расширится на `rooms/` в G33, здесь — `grep` в критериях.

## Чего не делать

Не писать генератор (E20), не писать цикл хода (E18), не трогать `sim/dijkstra.ts` и
`sim/propagate.ts`. Ни одного слова игры в `rooms/`: не «airlock to the tug», а `DoorState
"airlock"`; не «keycard», а `Door.key: string`.
