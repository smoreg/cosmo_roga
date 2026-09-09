# E18 — `RoomGame`: цикл хода на графе, команды, хранилище кораблей, реплей

Статус: done (3 сентября) · Зависит от: E17 · Блокирует: G35, G36, G37, E14 · Оценка: 6 ч · Пакет: `packages/engine`

Иначе, чем в задаче: `offerActions` отдаёт `CommandOf<G>`, а не `Command | RoomCommand` (иначе UI
пришлось бы сужать тип перед `playerCommand`); старые `runBot`/`runBatch`/`fuzz` остались как есть,
а `Playable` принимают новые `runBotOn`/`runBatchOn`/`fuzzOn`; `SAVE_VERSION = 3` требует поднять
`"version"` в трёх фикстурах `games/fortnight2/tests/fixtures/replay-*.json` — их не трогал.

## Зачем

Сеточный `Game` держит цикл хода, планировщик, лог, шум, хранилище уровней (E13), реплей — всё
это нужно графовой игре в том же виде, но над `Ship` вместо `Level`. Это порт, не переписывание:
`sim/game.ts` остаётся для `fortnight2` и `_template`, `rooms/game.ts` повторяет его структуру
метод в метод. Сигнатуры — `docs/engine-audit-v3.md`, §5.

## Что сделать

1. `sim/twist.ts`: `Twist<G extends TurnHost = Game>`; `TurnHost` — структурный тип из аудита
   (`systems`, `rng`, `log`, `schedule`, `player`, `entities`, `status`, `finish`, `inputs`,
   `flags`, `kills`). Новый хук
   ```ts
   /** What can be done right now, for a UI that lists actions by number. Advisory; refused offers cost no turn. */
   offerActions?(game: G): Array<{ label: string; cmd: Command | RoomCommand; enabled: boolean; why?: string }>;
   ```
   `dealDamage(host: { systems }, …)` в `sim/damage.ts` — тип. Ни один сеточный вызов не меняется.
2. `rooms/actions.ts`: `RoomCommand` (аудит §5) и `perform(game, actor, cmd)`:
   - `wait` → ход; `hide` → только если `roomOf(actor).cover`, ставит `actor.hidden = true`;
     любая другая успешная команда актёра снимает `hidden` (кроме `wait`);
   - `go {door}` → дверь принадлежит текущему отсеку и `passable(door, actor)`; `closed` →
     становится `open` (лог `The door d4 slides open.` если видно); актёр с `breacher` через
     `locked`/`sealed` — три хода подряд (`actor.data.breaching = { door, left }`), шум 9,
     после — `broken`; игрок через `airlock` — отказ («use `leave`»);
   - `attack {target}` → цель жива, чужая фракция, в том же отсеке; или `actor.range ≥ 1` и
     `canSee` через открытую дверь. Урон — `attack()` из `sim/combat.ts` через `dealDamage`, лог
     как в `sim/actions.ts` (`doAttack` копируется, включая правило про перехваченный удар);
   - `leave` → только игрок и только в отсеке с дверью `airlock`; вызывает `game.leave()` —
     аналог `descend()`: с `claimsOutcome` — только `beforeLevelLeave(game, reason "airlock")`;
     без — `finish("won")` (регресс для тестов движка без систем);
   - `act` → опрос `systems` через `performCommand`, как `doCustom` сейчас; никто не взял —
     `FAIL("Nothing to do.")`, ход не тратится.
3. `rooms/ai.ts`: `takeAiTurn(game, actor, cache)` → `RoomWorld` → `behaviourByName(actor.behaviour)` →
   `RoomIntent` → `RoomCommand`; `runNonPlayerTurns(game)` — копия сеточного с тем же guard.
4. `rooms/game.ts`: `RoomGame` по аудиту. `playerCommand` — тот же порядок шагов, что в
   `sim/game.ts` (статусы → `perform` → `inputs.push` → шум → `afterPlayerTurn` → `reapDead` →
   `refreshSight` → машины → смерть). Шум: `commandNoise` — `attack` 9, `go` 3, остальное 0
   (системы шумят сами), `settleNoise` через `propagateRooms`. `refreshSight`: `visible =
   visibleRooms(ship, player.room, player.sight ?? 0)`; посещённый отсек → `explored`. `travelTo`
   / `stash` / `generateInto` / `finish` / `currentShip` — порт E13 на `LevelStore<StoredShip>`
   (`sim/levelstore.ts` делается generic с дефолтом `StoredLevel`). `populate(ship)`: для
   каждого отсека с `depth ≥ 1` — `rng.chance(content.monsterChance(depth))` → одна машина
   `content.monstersForDepth(depth)` взвешенно, `spawnMonsterIn`; не больше `content.maxMonsters`.
   `RoomContentPack` — в `content/kinds.ts` (аудит §2).
5. `sim/save.ts`: `isCommand` принимает `RoomCommand`; `SAVE_VERSION = 3`. `rooms/game.ts`
   экспортирует `replayRooms`.
6. `testing/dummyship.ts`: `TEST_ROOM_CONTENT` (два монстра: `grunt` sight 0, `runner` sight 1
   keen) и `TEST_SHIP_SPEC`; пока нет E20 — `testShip(rng)` строит корабль из текста фикстуры
   (шесть отсеков, одна запертая дверь с ключом). `testing/metrics.ts`, `testing/fuzz.ts`:
   принимают `Playable` и фабрику `(seed) => Playable`; старые сигнатуры с `GameConfig` остаются
   как обёртки.

## Файлы

`packages/engine/src/rooms/actions.ts`, `rooms/ai.ts`, `rooms/game.ts`, `rooms/index.ts`,
`sim/twist.ts`, `sim/damage.ts`, `sim/levelstore.ts`, `sim/save.ts`, `content/kinds.ts`
(`RoomContentPack`), `testing/dummyship.ts`, `testing/metrics.ts`, `testing/fuzz.ts`,
`packages/engine/tests/room-commands.test.ts`, `tests/room-game.test.ts`.

## Тесты

- Нелегальные команды не тратят ход и не пишутся в `inputs`: `go` через запертую дверь, `go`
  через чужую дверь, `attack` в соседний отсек без `range`, `hide` без укрытия, `leave` не у
  шлюза, `act` без владельца.
- `go` через закрытую дверь открывает её; `breacher` режет запертую за три хода и шумит 9;
  обычная машина не может.
- `attack` с `range 1` сквозь открытую дверь проходит, сквозь закрытую — отказ.
- `hide` снимается любым действием, кроме `wait`.
- Шум: после `attack` в соседнем отсеке через открытую дверь 8, через закрытую 6.
- `travelTo` дважды в тот же id — тот же `Ship` (тот же объект), `explored` сохранён, машины
  на местах с той же энергией, добавленное в `data` на месте (property, 200 сидов на
  `testShip`).
- `leave` без `claimsOutcome` — `won`; с системой `claimsOutcome` — только `beforeLevelLeave`.
- `replayRooms(seed, inputs)` после 300 случайных команд — тот же `status`, `inputs.length`,
  `schedule.time`, отсек игрока.
- Сейв: `decodeRun` принимает все виды `RoomCommand`, отвергает `go` с `door: "x"`; версия 3.
- fuzz на `TEST_ROOM_CONTENT`: 50 сидов × 300 шагов → `[]`.
- Все существующие 266 тестов зелёные без правок по смыслу (`spawn-save` — версия).

## Критерии

`npm test`, `npm run typecheck`; `grep -rn "Math.random\|Date.now\|document\|window" packages/engine/src/rooms` пусто.

## Чего не делать

Не добавлять в `RoomCommand` ничего про модули, ключи, системы корабля — это `act`. Не хранить
корабли в модульной переменной. Не делать `RoomGame` наследником `Game`: у них разный `Level`, а
общее — `TurnHost`.
