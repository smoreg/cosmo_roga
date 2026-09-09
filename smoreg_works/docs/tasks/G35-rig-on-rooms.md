# G35 — Твист на отсеках: рига, обломки, модули, `newGame` для `salvor`

Статус: done 2026-09-03 · Зависит от: E18, E19, G31 (пакет) · Блокирует: G36 (`newGame`), G37,
G14, G17, G22, G23, G28, G29 · Оценка: 6 ч · Пакет: `games/salvor`

Иначе, чем в задаче: обломки лежат в `room.data.wrecks` (счётчик id — `currentShip.data.nextId`),
а не в `currentShip.data.wrecks` — так они переживают вылазку вместе с кораблём и совпадают с
контрактом G36; `exposureFor(game, rig, cmd)` берёт игру, потому что инструмент для `act work`
знает только сама система (`HackTarget.expose`); `content/pack.ts` не заводился — пакет `SALVOR`
живёт в `src/game.ts`, чтобы не пересечься с G36; наращивание срабатывает и на повреждённом модуле
(потолок ниже `+2`), как в примере GDD «Десять ходов»; `fov`/`fovRadius` в риге стали `sight: 0|1`.

## Зачем

«Каждый удар ложится на то, чем ты только что пользовался» переезжает без потерь
(`docs/design-doc.md`, «Бой в отсеке», «Действия отсека»): правило урона, перелив, теги,
сгорание, производные статы — как есть; меняется только, **что именно** экспонирует каждая
команда и **где** лежат обломки. Это порт `twist/rig.ts` (870 строк, ≈ 55 % остаётся дословно —
`docs/engine-audit-v3.md`, §3).

## Что сделать

1. Скопировать в `games/salvor/src/`: `content/modules.ts` (как есть; в комментарии у EMITTER —
   `range: 6` читается как «соседний отсек»), `content/monsters.ts` (те же восемь записей +
   `sight`/`keen` по таблице GDD «Машины»; `salvage` как есть), `content/player.ts`
   (`makePlayer()` без `pos`), `twist/rig.ts`.
2. `twist/rig.ts` — переписать по таблице «Действия отсека»:
   - `exposureFor(rig, cmd: RoomCommand)`: `attack` → cutter/laser/thrusters; `go`, `act close`
     → thrusters; `wait`, `hide`, `act salvage/search/take/upload/key` → plating; `act use
     {slot}` → slot; `act weld/cut/spike/power {door}` → welder/cutter/spike/cell; `act work
     {system}` → инструмент (система отдаёт `expose` в `HackTarget`); `leave` → null;
   - обломки: `Wreck { room, kind, integrity, glyph, id }` в `game.currentShip.data.wrecks`
     (не в `player.data` — обломки принадлежат кораблю и переживают вылазку); `addWreck(game,
     room, …)`, `wrecksIn(game, room)`; `onDeath` кладёт обломки в отсек машины;
   - `salvage(game, target)` по `id` обломков из команды (не «первые по чтению»);
     наращивание — здесь же, по правилу GDD (это G28 в v2; в порте оно стоит одной ветвью, G28
     остаётся за потолком `+2` и панелью `+`);
   - `pulse` → `scanRooms(ship, room, 2)` помечает `scanned` и снимок содержимого в
     `room.data.snapshot`; `dischargeEmp` → машины в моём отсеке; `weld` → модуль (дверь — G14
     через `HackTarget`); `shoot` → ближайшая цель по `canSee` (свой отсек, потом соседний);
     `breach` → `hackTargetAt(game, target)` по `id` цели; `corrosive` — ветка в `routeDamage`
     (перенесена из G24);
   - `offerActions(game)`: атаки по каждой машине в отсеке (`enabled: true`), `salvage` по
     каждым обломкам (`enabled` = есть слот или возможно наращивание, `why` иначе), `shoot`,
     если есть EMITTER и цель; `hide`, если `cover` и никого в отсеке — **это единственный
     источник знаний ботов и UI о действиях риги**; `botHints` удаляется;
   - `panelLines` как есть; `muffle` как есть.
3. `systems/sight.ts` — `canSeeDrone(game, machine)` через `rooms/sight.canSee` с поправкой
   BAFFLE: при целом BAFFLE `sight` машины считается 0, а `keen` — false, если дрон спрятан.
4. `src/game.ts`: `GAME_CONFIG` на `RoomGame` с `firstShip` из `testing`-подобной временной
   спеки (`content/derelicts.ts` появится в G36 — до него `firstShip` строит корабль из
   `shipFromText` двенадцати отсеков прямо здесь); `newGame(seed)`. G36 заменит `firstShip`.
5. `tests/rig.test.ts` — 19 тестов чистых функций копируются, 13 переписываются на
   `shipFromText`; `tests/modules.test.ts` — 14 копируются, 17 заново; `tests/salvage.test.ts`,
   `tests/sight.test.ts` — заново.

## Файлы

`games/salvor/src/content/modules.ts`, `content/monsters.ts`, `content/player.ts`,
`src/twist/rig.ts`, `src/systems/sight.ts`, `src/game.ts`, `tests/rig.test.ts`,
`tests/modules.test.ts`, `tests/salvage.test.ts`, `tests/sight.test.ts`.

## Тесты

- Каждая строка таблицы «Действия отсека» → ровно тот EXPOSED; отказанная команда не двигает
  метку.
- `precise`/`burst`/`corrosive` — как в v2, плюс: `corrosive` при целом PLATING бьёт EXPOSED, при
  сгоревшем — сразу CORE.
- Обломки после убийства лежат в отсеке машины; `salvage` по `id`; без слота — отказ без хода;
  наращивание целого модуля — без слота, `+1`; обломки переживают `travelTo` туда-обратно.
- Импульс помечает отсеки в двух дверях `scanned` и не дальше; ЭМИ станит всех в отсеке и никого
  в соседнем; выстрел через открытую дверь — да, через закрытую — отказ без хода.
- `offerActions` на 500 случайных состояниях: каждое `enabled` предложение выполняется `ok`;
  каждое `!enabled` — отказ без хода.
- `replayRooms(seed, inputs)` из 300 случайных команд даёт ту же ригу.

## Чего не делать

Не трогать `fortnight2`. Не заводить в риге знания о дверях и системах корабля — только
`HackTarget` (уже есть). Не переносить `wreckWithinReach`: «рядом» больше не существует.
