# Аудит движка и игры под v3 (граф отсеков)

Дата: 3 сентября 2026, вечер. База: `main` `a3f4404` — в нём уже влиты E13 (`LevelStore`,
`travelTo`, `finish`, `claimsOutcome`, `AirlockOut`, `edgeTile`), E16 (`hunter` / `turret` /
`static`, `range`, `searchTurns`) и G21 (SPIKE / EMITTER / BAFFLE, `sight.ts`, `registerHackTarget`).
`npx vitest run`: **44 файла, 537 тестов, зелёные** (по `grep -c 'it('`: 266 в движке, 244 в игре,
остальное — параметризованные).

Вердикты: **оставить** — файл не меняется · **адаптировать** — меняется точечно, тесты не
двигаются · **написать заново** — новый файл рядом, старый остаётся для сеточной игры ·
**выбросить** — в v3 не участвует (не удаляется: `fortnight2` его использует).

---

## 1. Архитектурное решение

1. **Движок не переписывается — расширяется.** `packages/engine/src/sim/` (сетка) остаётся как
   есть со всеми 266 тестами; рядом появляется `packages/engine/src/rooms/` — та же дисциплина
   (без DOM, без `Math.random`, только `rng`), тот же `Twist`, тот же `Schedule`, `Rng`, `Entity`,
   `MessageLog`, `combat`, `damage`, `status`, `spawn`, `log`. Экспорт через тот же `index.ts`.
   Обе модели живут в одном пакете, потому что всё общее уже общее, а граф — это «второй `Level`»,
   а не второй движок.
2. **Игра v3 — новый пакет `games/salvor`** (генератором `npm run new-game -- salvor "SALVOR"`,
   затем перенос файлов из `fortnight2` по таблице ниже). `games/fortnight2` замораживается: это
   `submission-v1`, оно собирается на каждом коммите `main`, ни один агент v3 его не открывает.
   На гейте v3-core корневые скрипты `dev`/`build`/`zip` переключаются на `salvor`.
3. **Общие типы становятся generic по хозяину хода.** `Twist`, `dealDamage`, боты и метрики
   сейчас принимают `Game`. Они начинают принимать `TurnHost` — структурный интерфейс того, что им
   реально нужно (`systems`, `rng`, `log`, `schedule`, `player`, `entities`, `status`, `finish`,
   `inputs`). `Game` и `RoomGame` оба ему удовлетворяют; ни один существующий вызов не меняется.
4. **Движок остаётся без слов игры.** В `rooms/` нет «дереликта», «чартера», «буксира», «модуля»,
   «ключ-карты». Есть: отсек, дверь с состоянием и ключом-строкой, предмет-марка (строка),
   сущность с `room`, команды `go/attack/wait/hide/leave/act`, шум по графу, видимость по
   графу, поведения, генератор из спеки со строковыми типами. Что такое `E` или `†` — решает
   `games/salvor/src/systems/populate.ts`, как сейчас с марками вольтов.

---

## 2. Движок: `packages/engine/src/**`

| Файл | Строк | Вердикт | Что именно |
|---|---|---|---|
| `index.ts` | 45 | адаптировать | `export * from "./rooms/index.js"` — одна строка |
| `content/kinds.ts` | 80 | адаптировать | `MonsterKind` получает `sight?: 0 \| 1` (видит в соседний отсек), `keen?: boolean` (видит спрятанного), `breacher?: boolean` (режет запертые/заваренные двери); `range` уже есть (E16). Новый `RoomContentPack { name; makePlayer(): Entity; monstersForDepth(depth); monsterBudget(depth, rng); openingLine?; winLine?; deathLine? }` — без `vaults`, без `pos` |
| `sim/grid.ts` | 87 | оставить | сетка; `rooms/` не импортирует |
| `sim/rng.ts` | 98 | оставить | используется как есть (`fork` — на корабль и на попытку генерации) |
| `sim/level.ts` | 130 | оставить | сеточный `Level`, `Tile`, `Zone`; в v3 не используется |
| `sim/entity.ts` | 75 | адаптировать | `room?: number` (отсек, для графовых игр; `pos` не читается) и `hidden?: boolean`. Две строки |
| `sim/shadowcast.ts`, `sim/fov.ts` | 170 | оставить | сеточная видимость; `rooms/sight.ts` пишется отдельно (это BFS по открытым дверям, не shadowcast) |
| `sim/dijkstra.ts` | 316 | оставить | сеточные карты; `rooms/paths.ts` — та же идея на списке смежности, 1/4 объёма |
| `sim/shapes.ts` | 115 | выбросить | конусы и лучи на сетке; в v3 не нужны |
| `sim/propagate.ts` | 95 | оставить | сеточный шум; `rooms/noise.ts` — та же очередь «громкое первым» по рёбрам с потерей на двери |
| `sim/mapgen.ts`, `sim/mapgen/*` (bsp, caves, rooms, walk, deck, postprocess, regions, storylets, types, validate, vaults) | ≈2300 | оставить | всё сеточное; `DeckBuilder` (897 строк) остаётся для `_template`/`fortnight2`. Из него в `rooms/gen/` переезжают **идеи**: BSP → дерево по глубине, `placeVaultsInZones` → карточки по отсекам (`vaultEligible`/`vaultWeight` копируются как `cardEligible`/`cardWeight` — это 20 строк), `validate` → `validateShip`, `buildLevel` с 14 попытками и `rng.fork(attempt)` → `generateShip` |
| `sim/schedule.ts` | 45 | оставить | используется `RoomGame` без изменений |
| `sim/actions.ts` | 164 | оставить | сеточные команды; `rooms/actions.ts` пишется заново (`RoomCommand`) |
| `sim/combat.ts` | 39 | оставить | `attack(attacker, defender, rng, sink)` не знает координат — используется как есть |
| `sim/damage.ts` | 49 | адаптировать | `dealDamage(game: Game, …)` → `dealDamage(host: { systems: readonly Twist[] }, …)`; тип, не логика |
| `sim/ai.ts` | 70 | оставить | сеточный мост; `rooms/ai.ts` — тот же мост для графа (30 строк) |
| `sim/ai/behaviors.ts` | 280 | оставить | сеточные профили (в т.ч. E16); `rooms/behaviours.ts` — порт тех же профилей на `RoomDistance`: `desireDriven` те же четыре числа, `hunter` та же машина состояний, `turret` то же правило «range + видно», `static` то же |
| `sim/status.ts` | 235 | оставить | статусы без координат — как есть (EMP-стан, `effectiveSpeed`) |
| `sim/effects.ts`, `sim/items.ts`, `sim/targeting.ts` | 500 | выбросить | предметы/прицеливание на сетке; `candidates()` из `targeting.ts` (G21 EMITTER) заменяется `rooms/sight.ts` |
| `sim/spawn.ts` | 105 | оставить | `SpawnTable`, `band`, `curve` — «глубина» становится `depth` отсека, ничего менять |
| `sim/log.ts` | 30 | оставить | — |
| `sim/twist.ts` | 120 | адаптировать | `Twist<G extends TurnHost = Game>`; новый хук `offerActions?(game): ActionOffer[]` (`{ label; cmd; enabled; why? }`) — то, из чего UI строит нумерованный список; `beforeLevelLeave(game, depth, reason)` и `claimsOutcome` — как есть (E13) |
| `sim/save.ts` | 125 | адаптировать | `isCommand` принимает `RoomCommand` (`go` с `door: int`, `attack` с `target: int`, `hide`, `leave`, `act` с `verb: string`, `target?/slot?: int`); `SAVE_VERSION` → 3; `RunRecord` без изменений |
| `sim/game.ts` | 380 | оставить | сеточный `Game`; `rooms/game.ts` — порт цикла хода: `playerCommand` (тот же порядок: статусы → perform → inputs.push → шум → `afterPlayerTurn` → машины → смерть), `travelTo`/`finish`/`claimsOutcome`/`stash`/`generateInto` (E13) переписываются один в один на `Ship` |
| `sim/levelstore.ts` | 84 | адаптировать | `LevelStore<T = StoredLevel>` — класс становится generic по типу записи; `levelSeed` как есть. `rooms/game.ts` кладёт в него `StoredShip { ship; entities; scheduleSeed; data; visits }` |
| `testing/fixtures.ts` | 125 | оставить | `fromAscii` для сетки; `testing/roomfixtures.ts` — новый DSL (ниже) |
| `testing/dummycontent.ts` | 33 | оставить | + новый `testing/dummyship.ts`: `TEST_ROOM_CONTENT`, `TEST_SHIP_SPEC` (три типа отсеков, два монстра) — чтобы тесты `rooms/` не зависели от `games/` |
| `testing/bots.ts` | 167 | оставить | сеточные боты; `testing/roombots.ts` — `random`/`greedy`/`careful` на графе (E14) |
| `testing/metrics.ts`, `testing/fuzz.ts` | 172 | адаптировать | `runBot`/`runBatch`/`fuzz` принимают `Playable` (`{ playerCommand; isOver(); status; inputs; progress(): number }`) и фабрику игры вместо `GameConfig`; `RunResult.depth` читается из `progress()`. Сеточные вызовы остаются валидными через обёртку |
| `testing/index.ts` | 9 | адаптировать | экспорт новых файлов |

### Тесты движка (все 266 остаются зелёными без правок)

| Файл | Тестов | Переживает | Примечание |
|---|---|---|---|
| `behaviors.test.ts` | 25 | 25 | сетка не трогается; порт на граф получает свой `room-behaviours.test.ts` |
| `commands.test.ts` | 9 | 9 | `save.ts` расширяется, не меняется |
| `damage.test.ts` | 10 | 10 | `dealDamage` меняет только тип параметра |
| `deck.test.ts` | 10 | 10 | `DeckBuilder` не трогается |
| `dijkstra.test.ts` | 20 | 20 | — |
| `effects-items.test.ts` | 26 | 26 | файлы не удаляются |
| `fuzz.test.ts` | 2 | 2 | `fuzz` получает обёртку совместимости |
| `levelstore.test.ts` | 10 | 10 | generic-параметр по умолчанию = старый тип |
| `log.test.ts` | 8 | 8 | — |
| `mapgen-family.test.ts`, `mapgen.test.ts` | 21 | 21 | — |
| `readability.test.ts` | 4 | 4 | — |
| `rng.test.ts` | 7 | 7 | — |
| `schedule.test.ts` | 6 | 6 | — |
| `shadowcast.test.ts` | 9 | 9 | — |
| `shapes.test.ts` | 22 | 22 | — |
| `spawn-save.test.ts` | 16 | 16 | тест на версию сейва написан как `SAVE_VERSION - 1` — переживает bump до 3 |
| `status.test.ts` | 14 | 14 | — |
| `storylets.test.ts` | 14 | 14 | — |
| `twist-api.test.ts` | 8 | 8 | новый хук необязателен |
| `vaults.test.ts` | 9 | 9 | — |
| `zones.test.ts` | 16 | 16 | — |
| **новые** | ≈ 90 | — | `graph.test.ts`, `paths.test.ts`, `noise.test.ts`, `sight.test.ts`, `room-commands.test.ts`, `room-game.test.ts`, `room-behaviours.test.ts`, `shipgen.test.ts`, `roomfixtures.test.ts`, `roombots.test.ts` |

---

## 3. Игра: `games/fortnight2/src/**` → `games/salvor/src/**`

`fortnight2` не редактируется. Колонка «в `salvor`» — что делает агент: копирует файл как есть,
копирует и правит, пишет заново, или файла нет.

| Файл | Строк | В `salvor` | Что именно |
|---|---|---|---|
| `content/modules.ts` | 194 | **оставить** (копия) | все 11 модулей и числа как есть; `range: 6` у EMITTER читается как «соседний отсек» — комментарий в одну строку; `HINTS` — пятая подсказка про ключ |
| `content/monsters.ts` | 76 | адаптировать | те же 8 записей + `sight`/`keen`/`breacher` по таблице GDD; `minDepth`/`maxDepth` — уже глубина отсека 0..6; `monsterBudget` уходит в генератор (вероятность на отсек) |
| `content/player.ts` | 25 | адаптировать | `makePlayer()` без `pos`; `room` ставит `RoomGame` |
| `content/pack.ts` | 21 | написать заново | `RoomContentPack`; `firstShip` — из `derelicts.ts` |
| `content/zones.ts` | 119 | адаптировать | 17 `ZoneKindSpec` → 22 `RoomKindSpec { kind, name, weight, cover, required?, deep? }`; `interior`/`density`/`size` исчезают (`cover` — их наследник); `DECKS`/`deckPlan` исчезают — план корабля даёт `derelicts.ts` |
| `content/storylets.ts` | 267 | написать заново как `content/cards.ts` | те же 10 карточек + 6 из v2, ASCII-строки → списки марок; хелперы `burned`/`emptySlots`/`burnedCount` копируются дословно; `CARD_MODULE` копируется |
| `content/vaults.ts` | 14 | выбросить | — |
| `game.ts` | 34 | написать заново | `GAME_CONFIG` на `RoomGame`; `newGame(seed)` — тот же контракт для тестов и UI |
| `main.ts` | 22 | **оставить** | подгон шрифта и `?seed=` не зависят от модели |
| `systems/alert.ts` | 178 | адаптировать | `spawnSpots(level, pos, 10)` → отсеки на расстоянии ≥ 2 дверей; `deckIsLoud` — по `game.noise` (Map по отсекам); состояние — в дереликте, не в `player.data` (G23); всё остальное — как есть |
| `systems/populate.ts` | 132 | написать заново | марки карточек → содержимое отсеков и машины; `ensureOnboardingScrap` → «обломки в стартовом отсеке первого корабля» |
| `systems/sight.ts` | 39 | написать заново | `canSeeDrone(game, machine)`: тот же отсек (если не спрятан или `keen`), соседний сквозь открытую дверь при `sight === 1` и без BAFFLE |
| `twist/rig.ts` | 870 | адаптировать (≈ 55 % остаётся) | **как есть:** `Rig`/`Slot`, `makeStartingRig`, `findSlot`, `install`, `repair`, `routeDamage` и цепочки, `derivedStats`/`applyDerived`, `onDamage`, `panelLines`, `hint`/`hintsOf`, `HackTarget`/`registerHackTarget`, `muffle`. **Переписать:** `exposureFor` под `RoomCommand` (таблица GDD «Действия отсека»); обломки — не `x,y` на палубе, а предметы отсека (`Wreck { room, kind, integrity, glyph }`, хранятся в `StoredShip.data`, не в `player.data.deck`); `wreckWithinReach` → «обломки в моём отсеке»; `salvage` → по `target` из команды, не «первые по чтению»; `pulse` → отсеки в двух дверях; `dischargeEmp` → машины в моём отсеке; `shoot` → цель по `rooms/sight`; `breach` → цель по двери/предмету из команды; `botHints` → `offerActions` |
| `ui/app.ts` | 190 | **оставить** (копия) | эффекты `command/explore/fight/newRun` те же; `explorer.step` — новый `auto.ts` |
| `ui/appstate.ts` | 183 | адаптировать | редьюсер как есть; `UiIntent` получает `{ kind: "pick"; index }` для цифр; оверлеи `lost`/`sold` — задача G31 |
| `ui/auto.ts` | 257 | написать заново | `makeExplorer` на `exploreTarget(ship)`, стоп-лист по GDD; `fightStep` → `engage(mode)` по правилу `Tab` |
| `ui/deckmap.ts` | 305 | написать заново как `ui/schematic.ts` | из старого берутся маска направлений и таблица `GLYPH` (60 строк); раскладка теперь приходит из генератора (`col`, `row`), рисуются коробки 9×4, порты, метки дверей, окно 66×34 с прокруткой |
| `ui/input.ts` | 186 | адаптировать | `MOVES` удаляется; цифры → `pick`; `MODULE_KEYS` + `h`, `f`, `c`, `<`; `KEY_HELP`/`RULE_HELP`/`TITLE_LINES` — новые тексты |
| `ui/panel.ts` | 86 | **оставить** (копия) | вспышка строки при ударе — та же арифметика |
| `ui/render.ts` | 328 | адаптировать (≈ 45 % остаётся) | остаются `box`, `drawBanner`, `drawCrash`, `drawLog`, `drawTitle`, `drawHelp`, `clamp`, `runSummary`; уходят `drawMap`, `drawZoneLabels`, `drawEntities`, `drawTwistOverlay`; `drawSidebar` — заголовок + `panelLines` + отсек + действия; вместо карты — `schematicLines()` |
| `ui/theme.ts` | 38 | адаптировать | `LAYOUT { mapWidth: 66, sidebarWidth: 29, logHeight: 7 }`; цвета те же плюс `hull` |

### Тесты игры

`fortnight2/tests` (244) продолжают гоняться как есть. Для `salvor` — сколько из каждого файла
переезжает **копией или с косметикой** (числа, имена), а сколько пишется заново:

| Файл | Тестов | Копия | Заново | Почему |
|---|---|---|---|---|
| `rig.test.ts` | 32 | 19 | 13 | чистые функции риги (route/derived/install/repair/precise/burst) — копия; всё, что через `fromAscii` и `move` — на `shipFromText` и `go` |
| `modules.test.ts` | 31 | 14 | 17 | таблица модулей и сгорание — копия; импульс/ЭМИ/выстрел/взлом — на отсеки |
| `sight.test.ts` | 8 | 0 | 8 | модель видимости другая |
| `salvage.test.ts` | 11 | 3 | 8 | обломки — предметы отсека |
| `alert.test.ts` | 13 | 6 | 7 | периоды и шум — копия; спавн-дистанции — отсеки |
| `machines.test.ts` | 10 | 7 | 3 | таблица, уникальность символов, теги — копия |
| `systems.test.ts` | 12 | 2 | 10 | всё на фикстурах |
| `game.test.ts` | 7 | 2 | 5 | — |
| `deck-content.test.ts` | 10 | 0 | 10 | → `ship-content.test.ts`: карточки по отсекам, стартовый отсек |
| `deckmap.test.ts` | 10 | 0 | 10 | → `schematic.test.ts` |
| `auto.test.ts` | 20 | 0 | 20 | стоп-лист тот же по смыслу, весь код новый |
| `input.test.ts` | 17 | 8 | 9 | модификаторы, `?`, `R`, `Esc` — копия; движение — удаляется, цифры — новое |
| `appstate.test.ts` | 25 | 23 | 2 | редьюсер не знает о модели |
| `panel.test.ts` | 11 | 11 | 0 | — |
| `onboarding.test.ts` | 11 | 2 | 9 | замеры на первом корабле |
| `balance.test.ts`, `winnable.test.ts` | 5 | 0 | 5 | новые метрики (E14, G30) |
| `replay.test.ts`, `fuzz.test.ts` | 5 | 2 | 3 | фикстуры реплеев перезаписываются |
| `purity.test.ts`, `build.test.ts` | 6 | 6 | 0 | пути меняются на `salvor` |
| **итого** | 244 | **105** | **139** | |

---

## 4. Что переносится из E13 и E16

**E13 (влит в `main` как WIP-ветка `task/campaign`, 10 тестов зелёные).** Переезжает целиком по
форме, копируется в `rooms/game.ts` по существу:

| Есть в `sim/` | В `rooms/` |
|---|---|
| `LevelStore` / `StoredLevel` / `levelSeed` | тот же класс, generic: `LevelStore<StoredShip>`; `scheduleSeed` — семя «что корабль делал без тебя» (двери, которые открыли машины) |
| `Game.travelTo(id, { depth, builder?, entry?, reason })` | `RoomGame.travelTo(id, { generate: (rng) => Ship; entry?: RoomId; reason })` — вместо `builder` функция генерации, вместо `depth` ничего (глубина — свойство отсека) |
| `Game.finish(status, line)` | как есть |
| `Twist.claimsOutcome`, `beforeLevelLeave(game, depth, reason)` | как есть; `reason: "airlock" \| "stairs"` → `"airlock" \| "custom"` (лестниц нет; `leave` даёт `"airlock"`) |
| `Tile.AirlockOut` `<` | `DoorState "airlock"` на двери `a1` |
| `DeckPlan.edgeTile(isTreeEdge)` | `ShipSpec.doors` + правило «`locked` только на дереве, `sealed` только на петлях» — та же мысль, обобщённая |
| `stash()` / `entities` в записи | как есть: покидая корабль, все не-игроки остаются в `StoredShip.entities` с их энергией |
| `visits === 1 → populate` | как есть |

Причина ухода (`reason`) в v3 нужна системе рейса ровно так же: `leave` через `a1` — продать
лут и зачесть чартеры; гибель — запись в `deaths`.

**E16 (влит, 11 тестов).** Профили переносятся один в один на `RoomDistance`:

| В `sim/ai/behaviors.ts` | В `rooms/behaviours.ts` |
|---|---|
| `desireDriven({ player, allies, noise, fleeBelow })` — суммы Dijkstra-карт | те же четыре числа над `RoomDistance.combine`; «шаг» = `go` через дверь с наименьшим значением; «бегство» = `flee()` |
| `hunter(memoryTurns)` — идёт на `target`, обшаривает `searchTurns`, деградирует в `brute` | тот же автомат; `target` — отсек (`Entity.target` остаётся `Point` в сетке, для графа используется `data.targetRoom`); «обшаривает» = ждёт `memoryTurns` в отсеке, если дрон спрятан |
| `turret` — `range` + `hasLos` | `range ≥ 1` + `canSee` (соседний отсек сквозь открытую дверь) |
| `static` | как есть |
| `Intent "shoot"` → `Command "attack"` | `Intent "shoot"` → `RoomCommand attack` с целью в соседнем отсеке; `perform` разрешает, если `attacker.range ≥ 1` и `canSee` |
| `MonsterKind.range`, `Entity.searchTurns` | как есть |

Дополнительно к E16 в графе нужно: `breacher` (E режет двери: `go` через `locked`/`sealed`
превращается в трёхходовую работу с шумом 9) и `coward` не идёт следом через дверь — оба правила
живут в `rooms/behaviours.ts`, не в игре.

---

## 5. Новые движковые примитивы (сигнатуры для задач E17–E20, E14)

```ts
// rooms/graph.ts
export type RoomId = number;
export type DoorId = number;
export type DoorState = "open" | "closed" | "locked" | "sealed" | "broken" | "airlock";
export interface Room {
  id: RoomId; label: string;            // "r3"
  kind: string; name: string;           // content-defined, never read here
  depth: number; col: number; row: number;
  cover: boolean; hazard: string;       // "none" | "fire" | "vented" — строки, движок знает только "vented" (шум)
  explored: boolean; scanned: boolean;
  marks: string[];                      // what the generator's cards left here; the game turns them into things
  data: Record<string, unknown>;        // the game's own per-room state
}
export interface Door {
  id: DoorId; label: string;            // "d4", "a1"
  a: RoomId; b: RoomId; state: DoorState;
  key?: string;                         // id of the key that opens a locked door
}
export class Ship {
  readonly rooms: Room[]; readonly doors: Door[];
  readonly entry: RoomId;               // the room with the airlock
  doorsOf(r: RoomId): Door[];
  neighbours(r: RoomId): Array<{ door: Door; room: Room }>;
  other(d: Door, r: RoomId): RoomId;
  /** May `who` walk through it? `breacher` passes locked/sealed by cutting (caller charges the turns). */
  passable(d: Door, who: { breacher?: boolean; isPlayer?: boolean }): boolean;
  seeThrough(d: Door): boolean;         // open | broken
  door(label: string): Door; room(label: string): Room;
}

// rooms/paths.ts — BFS / Dijkstra over rooms, the graph twin of sim/dijkstra.ts
export class RoomDistance {
  static from(ship: Ship, goals: RoomId[], passable: (d: Door) => boolean): RoomDistance;
  at(r: RoomId): number;                                   // Infinity = unreachable
  nextDoor(from: RoomId, passable: (d: Door) => boolean): Door | undefined;  // downhill step
  flee(passable: (d: Door) => boolean): RoomDistance;      // the classic "negate and rescan"
  static combine(parts: Array<{ map: RoomDistance; weight: number }>): RoomDistance;
}
export function exploreTarget(ship: Ship, from: RoomId, passable: (d: Door) => boolean): Door | undefined;
export function blockedBy(ship: Ship, from: RoomId): Door[]; // doors that alone stand between `from` and something unexplored

// rooms/noise.ts
export function propagateRooms(
  ship: Ship,
  sources: ReadonlyArray<{ room: RoomId; strength: number }>,
  loss: (d: Door) => number,            // default: open/broken 1 · closed 3 · locked/sealed 4 · airlock Infinity; a "vented" room emits nothing
): Map<RoomId, number>;

// rooms/sight.ts
export function visibleRooms(ship: Ship, from: RoomId, depth: number): Set<RoomId>;   // through open/broken doors only
export function canSee(ship: Ship, viewer: Entity, target: Entity): boolean;          // same room (unless target.hidden && !viewer keen) or depth-1 via open door when viewer.sight === 1
export function scanRooms(ship: Ship, from: RoomId, depth: number): Set<RoomId>;      // through any door — the sensor pulse

// rooms/actions.ts
export type RoomCommand =
  | { kind: "wait" }
  | { kind: "hide" }                                    // legal only in a room with cover; sets player.hidden
  | { kind: "go"; door: DoorId }                        // walks through; a closed door opens on the way
  | { kind: "attack"; target: EntityId }                // same room, or adjacent via an open door when attacker.range >= 1
  | { kind: "leave" }                                   // through the airlock; the game's claimsOutcome system decides where to
  | { kind: "act"; verb: string; target?: number; slot?: number };  // the game's own verbs, claimed via performCommand
export function perform(game: RoomGame, actor: Entity, cmd: RoomCommand): Outcome;   // same Outcome as sim/actions.ts

// rooms/game.ts
export interface RoomGameConfig { seed: number; content: RoomContentPack; twist?: Twist<RoomGame>; systems?: Twist<RoomGame>[]; firstShip: (rng: Rng) => Ship; }
export class RoomGame implements TurnHost {
  seed; rng; schedule; log; content; twist; systems; status; kills; inputs: RoomCommand[]; flags;
  ship: Ship; shipId: string; readonly ships: LevelStore<StoredShip>;
  player: Entity; entities: Entity[];
  noise: ReadonlyMap<RoomId, number>;
  playerCommand(cmd: RoomCommand): Outcome;
  travelTo(id: string, spec: { generate: (rng: Rng) => Ship; entry?: RoomId; reason: LeaveReason }): void;
  finish(status: "won" | "dead", line: string): void;
  makeNoise(room: RoomId, strength: number): void;
  roomOf(e: Entity): Room; entitiesIn(r: RoomId): Entity[];
  visible: ReadonlySet<RoomId>;         // recomputed after every player turn from player.sight
  refreshSight(): void;
}
export function replayRooms(seed: number, cmds: RoomCommand[], cfg: Omit<RoomGameConfig, "seed">): RoomGame;

// rooms/gen/shipgen.ts
export interface RoomKindSpec { kind: string; name: string; weight?: number; cover?: boolean; required?: boolean; deep?: boolean; }
export interface RoomCard { name: string; kinds?: readonly string[]; when?(ctx: CardContext): boolean; weight?: number; weightWhen?(ctx: CardContext): number; sets?: readonly string[]; maxPerShip?: number; marks: readonly string[]; }
export interface CardContext { flags: ReadonlySet<string>; player?: Entity; shipIndex: number; }
export interface ShipSpec { rooms: [number, number]; maxDepth: number; kinds: readonly RoomKindSpec[]; entryKind: string; doors: Record<Exclude<DoorState, "airlock">, number>; cards?: readonly RoomCard[]; cardsPerRoom?: number; }
export function generateShip(spec: ShipSpec, rng: Rng, ctx: CardContext): Ship;          // pure; ≤ 14 attempts over rng.fork(attempt)
export function validateShip(ship: Ship, spec: ShipSpec): Problem[];
export function layoutShip(ship: Ship): void;                                             // fills col/row; called by generateShip, exported for fixtures

// testing/roomfixtures.ts — the graph twin of fromAscii
export function shipFromText(text: string): { ship: Ship; player: RoomId | undefined; marks: Array<{ room: RoomId; token: string }>; };
/*
  TUG -a1- r1
  r1 -d1- r2 -(d2)- r3        ─d─ open · (d) closed · [d] locked · [d:k1] locked with key k1 · #d# sealed · ·d· broken · a1 airlock
  r2 -[d3:k1]- r4
  r1: docking @               id: kind [tokens…]; '@' is the player; any other token is a mark
  r2: cargo m:scout %thrusters:2 †:k1 cover
*/

// testing/roombots.ts (E14) — random / greedy / careful on RoomCommand; testing/metrics.ts and fuzz.ts take a Playable
```

Что движок **не** знает и не узнает: слова «дереликт», «чартер», «буксир», «модуль», «ключ-карта»
(ключ — строка `Door.key`, чем он представлен у игрока — дело игры), «система корабля», «призрак».
Марки карточек — строки; `hazard` — строка (движок читает только `"vented"` в шуме);
`kind`/`name` отсека — строки. `hide`/`hidden`/`keen`/`sight`/`breacher`/`range` — движковые,
потому что на них стоят видимость и проходимость, которые обязаны быть одинаковыми для игрока и
машин.

---

## 6. Сохранение и реплей

`RunRecord { version: 3, seed, inputs: RoomCommand[] }` — тот же формат «сид + команды».
`isCommand` расширяется на новые `kind`; старые сеточные команды остаются валидными (сеточная
игра тоже поднимает версию, регресс-тест `SAVE_VERSION - 1` держится). `replayRooms` — копия
`replay` с другой конфигурацией. Фикстуры реплеев в `salvor/tests/fixtures/` записываются заново
ботом `careful` (G33).
