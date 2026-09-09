# Кулинарная книга: как собрать новую игру из кирпичей

Репозиторий — монорепо: движок в `packages/engine`, игры в `games/`. Новая игра создаётся
генератором:

```bash
npm run new-game -- mygame "My Game"
npm install                        # свяжет воркспейс
npm run dev -w games/mygame
```

Шаблон уже содержит `ContentPack`, бестиарий из двух монстров, smoke-тесты и настроенную
сборку под itch.io. Дальше — рецепты ниже.

Движок — не «эта игра», а набор деталей. Ниже — рецепты: что взять, чтобы получить
конкретную вещь, и чего при этом не делать. Каждый кирпич покрыт тестами, поэтому
рецепт можно применять, не читая его исходник.

---

## Два мира

Миров в движке два, и они не знают друг о друге. **Сеточный** (`packages/engine/src/sim/`) —
тайлы, симметричный FOV, Dijkstra-карты, четыре генератора подземелья; расстояние в клетках.
**Корабельный** (`packages/engine/src/rooms/`) — отсеки как узлы, двери как рёбра; актёр
стоит ровно в одном отсеке, расстояние — число дверей, «вижу» значит «дверь открыта».
Общего ровно два файла: планировщик `sim/schedule.ts` и точка расширения `sim/twist.ts` —
система, написанная под `TurnHost`, работает в обоих. `games/fortnight2` собрана на первом,
`games/salvor` — на втором.

Мир под новую игру выбирается по тому, что в ней измеряется: нужны клетки, дистанции и
линия взгляда — сеточный; нужны места и переходы между ними, где сама дверь есть решение
(открыть, прорезать, оставить за спиной) — корабельный. Смешивать нечего: у каждого своя
`Game`, свои команды, свои фикстуры и свои боты, и ниже они разведены по разделам.

---

## Карта кирпичей: сеточный мир (`sim/`)

| Кирпич | Файл | Что даёт | Тесты |
|---|---|---|---|
| RNG | `engine/sim/rng.ts` | детерминизм, сериализуемое состояние, дайсы, веса, независимые потоки | `rng.test.ts` |
| Сетка | `engine/sim/grid.ts` | `Grid<T>`, точки, направления, метрики | — |
| Уровень | `engine/sim/level.ts` | тайлы, видимость, память карты, комнаты | — |
| **FOV** | `engine/sim/shadowcast.ts` | **симметричный** shadowcasting, LoS | `shadowcast.test.ts` |
| **Dijkstra-карты** | `engine/sim/dijkstra.ts` | пути, карты безопасности, desire-AI, авто-исследование | `dijkstra.test.ts` |
| Генераторы | `engine/sim/mapgen/` | 4 генератора за одним интерфейсом + постобработка + валидатор | `mapgen*.test.ts` |
| Вольты | `engine/sim/mapgen/vaults.ts` | рукодельные комнаты из ASCII с метками | `vaults.test.ts` |
| Планировщик | `engine/sim/schedule.ts` | энергетические ходы, скорости, статусы | `schedule.test.ts` |
| Действия | `engine/sim/actions.ts` | Command → Outcome, бамп-атака, отказ без траты хода | `commands.test.ts` |
| Статусы | `engine/sim/status.ts` | 9 эффектов, противоположности, щиты, производные статы | `status.test.ts` |
| Эффекты | `engine/sim/effects.ts` | урон/лечение/статус/телепорт/толчок как **данные** | `effects-items.test.ts` |
| Предметы | `engine/sim/items.ts` | 3 слота, заряды, режимы прицеливания, дроп по глубине | `effects-items.test.ts` |
| Прицеливание | `engine/sim/targeting.ts` | курсор, Tab-циклы, валидация, предпросмотр области | `effects-items.test.ts` |
| Формы | `engine/sim/shapes.ts` | линия, диск, кольцо, конус, луч | `shapes.test.ts` |
| Распространение | `engine/sim/propagate.ts` | шум, запах, газ, свет | `shapes.test.ts` |
| Поведения | `engine/sim/ai/behaviors.ts` | 5 готовых ИИ на desire-картах + свои профили | `behaviors.test.ts` |
| Таблицы спавна | `engine/sim/spawn.ts` | веса, полосы глубины, кривая сложности | `spawn-save.test.ts` |
| Сохранение | `engine/sim/save.ts` | забег как (seed, команды), защищённый парсер | `spawn-save.test.ts` |
| Твист | `engine/sim/twist.ts` | точка расширения под главную механику | `twist-api.test.ts` |
| **Фикстуры** | `engine/testing/fixtures.ts` | уровень из ASCII — основа всех тестов | везде |
| **Боты** | `engine/testing/bots.ts` | random / greedy / careful — вместо плейтестеров | `balance.test.ts` |
| **Метрики** | `engine/testing/metrics.ts` | прогон N забегов, гистограммы, таблица баланса; общие на оба мира | `balance.test.ts` |

---

## Карта кирпичей: мир отсеков (`rooms/`)

| Кирпич | Файл | Что даёт | Тесты |
|---|---|---|---|
| **Граф корабля** | `engine/rooms/graph.ts` | `Ship`: отсеки, двери, шесть состояний двери, проходимость под конкретного ходока, плоская форма для сейва | `room-graph.test.ts` |
| **Расстояния в дверях** | `engine/rooms/paths.ts` | `RoomDistance`: карты, `nextDoor`, `flee`, `combine`; авто-исследование `exploreTarget`, «всё за этой дверью» `blockedBy` | `room-paths.test.ts` |
| Команды | `engine/rooms/actions.ts` | шесть глаголов (`wait`/`hide`/`go`/`attack`/`leave`/`act`), прорезание двери, отказ без траты хода | `room-commands.test.ts` |
| Цикл хода | `engine/rooms/game.ts` | `RoomGame`: планировщик, склад корпусов, флаги рейса, `replayRooms` | `room-game.test.ts` |
| Поведения | `engine/rooms/behaviours.ts` | 8 профилей на желаниях плюс правило двери `follow` | `room-behaviours.test.ts` |
| Шум | `engine/rooms/noise.ts` | `propagateRooms`: затухание на каждой двери, `loudestRoom` | `room-noise.test.ts` |
| Видимость | `engine/rooms/sight.ts` | `visibleRooms` / `scanRooms` / `canSee` — свой отсек и сквозь дыру или открытую дверь | `room-sight.test.ts` |
| **Генератор корабля** | `engine/rooms/gen/shipgen.ts` | дерево отсеков, петли, двери по весам, замки по правилу Дорманса, карточки | `shipgen.test.ts` |
| Валидатор | `engine/rooms/gen/validate.ts` | инварианты корабля; `reachableWithKeys` — ключ никогда не за своей дверью | `shipgen.test.ts` |
| Раскладка | `engine/rooms/gen/layout.ts` | схема: колонка = глубина, порты и провода без пересечений; чистая функция от графа | `shipgen.test.ts` |
| Контракт контента | `engine/rooms/types.ts` | `ShipSpec`, `RoomKindSpec`, `RoomCard`, `CardContext` — данные игры для генератора | `shipgen.test.ts` |
| **Фикстуры-корабли** | `engine/testing/roomfixtures.ts` | `shipFromText` — корабль из пяти строк, `shipToText` — обратно | `roomfixtures.test.ts` |
| **Боты на графе** | `engine/testing/roombots.ts` | random / greedy / careful на корабле, `roomPlay`, `roomsExplored` | `roombots.test.ts` |
| Пустышка | `engine/testing/dummyship.ts` | `TEST_ROOM_CONTENT`, `TEST_SHIP_SPEC`, `testShip(rng)` — игра-минимум для тестов движка | `room-game.test.ts` |

⚠️ Сеточная половина заняла имена первой, поэтому из `@jamrog/engine` корабельная выходит
с приставкой: `roomDesireDriven`, `roomHunter`, `roomTurret`, `ROOM_BEHAVIOURS`,
`performRoom`, `takeRoomAiTurn`, а из `@jamrog/engine/testing` — `randomRoomBot`,
`greedyRoomBot`, `makeCarefulRoomBot`. Импортировали `desireDriven` — взяли сеточный.

---

## Рецепты: сеточный мир

### Добавить монстра

```ts
// games/<id>/src/content/monsters.ts
{ id: "ghoul", name: "ghoul", ch: "G", fg: "#9a9", hp: 18,
  damage: [1, 8, 0], defense: 1, speed: 110, fovRadius: 8,
  behaviour: "pack", minDepth: 4, maxDepth: 9, weight: 5 }
```

Всё. Спавн, ИИ, планировщик и HUD подхватят его сами. Интересность монстра — это
`behaviour` + `speed` + `damage`, а не новый код.

### Добавить поведение ИИ

Не пишите конечный автомат. Опишите желания:

```ts
// packages/engine/src/sim/ai/behaviors.ts
ambusher: desireDriven({ player: 1, allies: -0.6, fleeBelow: 0.2 }),
```

`player` — тяга к игроку, `allies` — к своим (отрицательное = рассредоточиться),
`noise` — к звуку, `fleeBelow` — порог бегства. Четыре числа дают личность.

⚠️ Держите `|отталкивание| < |притяжение|`, иначе актёр попадает в локальный минимум
и встаёт. Для настоящего бегства есть `fleeMap()` — у неё таких ям нет.

### Добавить предмет

```ts
// games/<id>/src/content/items.ts (создать)
{ id: "scroll_blink", name: "scroll of blinking", ch: "?", fg: "#ac8",
  targeting: { kind: "self" },
  effects: [{ kind: "teleport", range: 8 }],
  charges: 1, minDepth: 2, maxDepth: 9, weight: 6 }
```

Прицеливание, заряды, расход и сообщения — уже есть.

### Добавить способность с площадью поражения

```ts
targeting: { kind: "area", range: 6, radius: 2 },
effects: [
  { kind: "damage", dice: [2, 6, 0] },
  { kind: "status", status: "burn", turns: 4, magnitude: 2 },
],
```

`targeting.ts` сам покажет предпросмотр диска и не даст выстрелить сквозь стену.

### Сделать рукодельную комнату

```ts
export const CRYPT: Vault = {
  name: "crypt",
  minDepth: 3,
  rows: [
    "#########",
    "#M.....M#",
    "#.#####.#",
    "#.#X..#.#",   // X — метка сокровища
    "#.#####.#",
    "#...+...#",   // + — дверь
    "#########",
  ],
};
```

Передайте её в `generateLevel(depth, rng, { vaults: [CRYPT] })`. Метки вернутся в
`gen.vaults[].marks` — расставьте по ним монстров и добычу. `?` в шаблоне означает
«оставить как есть» и позволяет вписывать вольт в пещеру рваным краем.

### Сменить характер подземелья по глубине

```ts
// packages/engine/src/sim/mapgen/index.ts
export function builderForDepth(depth: number): MapBuilder {
  if (depth <= 3) return new RoomsBuilder();
  if (depth <= 6) return new CavesBuilder({ fillProbability: 0.48, generations: 5 });
  return new BspBuilder({ minLeaf: 9 });
}
```

Инварианты (связность, границы, достижимость лестницы) проверяются для любого
генератора автоматически — сломать карту сменой генератора нельзя.

### Сделать механику «монстры слышат»

Шум уже считается каждый ход: `game.noiseField`. Дайте монстру `behaviour: "stalker"`,
и он пойдёт на звук. Свой источник шума — `game.makeNoise(pos, strength)`.

### Сделать твист

`engine/sim/twist.ts` — реализуйте интерфейс и передайте в `new Game({ seed, twist })`.
Хуки: старт забега, вход на уровень, после хода игрока, после хода любого актёра,
смерть, оверлей на карте, строка в HUD. Вся механика — в одном файле.

Пример скелета для идеи «Echo» из `ideas.md`:

```ts
export const echoTwist: Twist = {
  name: "echo",
  afterPlayerTurn(game, cmd) {
    trail.push(cmd);
    if (trail.length > DELAY) replayOneCommandAsGhost(game, trail.shift()!);
  },
  overlayGlyphs: (game) => ghosts.map((g) => ({ ...g.pos, ch: "@", fg: "#556" })),
  statusLine: () => `echo in ${DELAY - trail.length}`,
};
```

### Добавить музыку

Состояния, темп и экспорт — `games/<id>/music/README.md`; жанр, тема и переходы — скилл
`composing-music`. Подключение:

```ts
import { AdaptiveMusic } from "@jamrog/audio";
const music = new AdaptiveMusic({ grid: { bpm: 96, beatsPerBar: 4, barsPerPhrase: 4 }, layers });
void music.to(inCombat ? "combat" : "explore", inCombat ? "bar" : "phrase");
```

Первый вызов — только из пользовательского жеста, иначе браузер молча блокирует автоплей.

Второй способ, которым игра сейчас и пользуется: **один слой, а состояние ведёт громкость**.
`setVolume(v, seconds)` доводит уровень плавно, а не ступенькой, — на границе хода ступенька
слышится как дефект файла.

```ts
music.setVolume(MASTER * volumeFor(state), 1.6);   // разгон за две доли
```

И `music.position` — playhead играющей петли в секундах, `undefined`, если играть нечего. С
`secondsToNextBeat(grid, position)` это часы, по которым можно планировать что-то на экране **в
такт** музыке (в SALVOR так сделана вспышка на появление машины, `src/ui/pulse.ts`). Часы должны
быть у аудио: `Date.now()` в фазу не попадает.

### Проверить баланс

```bash
npx vitest run tests/balance.test.ts --reporter=verbose
```

Печатает таблицу: три бота, процент побед, медианная глубина, гистограмма смертей.
Меняете число в `content/` — прогоняете снова. Это и есть балансировка.

### Воспроизвести баг игрока

Игрок присылает `?seed=1234567`. Вы:

```ts
const game = replay(1234567, inputsFromTheirSave, { content: FORTNIGHT2 });
```

Забег воспроизводится бит-в-бит. Тест — это `expect(game.player.hp).toBe(...)`.

### Написать тест на что угодно

```ts
const f = fromAscii([
  "########",
  "#@..m..#",   // @ игрок, m метка монстра
  "########",
]);
```

Никаких сидов, никакого поиска нужной ситуации. Рисуете ситуацию — тестируете её.

---

## Рецепты: мир отсеков

### Пройти и догнать по дверям

```ts
const walk = (d: Door) => ship.passable(d, walkerOf(self));
const toPlayer = RoomDistance.from(ship, [player.room!], walk);
const door = toPlayer.nextDoor(self.room!, walk);   // undefined — уже пришли
```

Тот же примитив, что `sim/dijkstra.ts`, только рёбра — двери, а `passable` спрашивает про
конкретного ходока (резак открывает запертое и заваренное, шлюз — только игроку). Ничьи
разрешаются меньшим id двери, поэтому реплей не зависит от порядка генерации.
Авто-исследование — `exploreTarget(ship, from, walk)`; «остальное за d3» — `blockedBy(ship, from)`.

### Заставить убегать

`toPlayer.flee(walk)` — знак меняется, множитель 1.2 (Brogue), карта пересчитывается: катясь
вниз по ней, машина уходит вокруг корабля, а не в тупик. Суммой желаний
(`RoomDistance.combine`) бегства не получить — там локальные ямы, ровно как на сетке.

### Добавить корабль

Не новый генератор — `ShipSpec` и колода карточек:

```ts
const HULK: ShipSpec = {
  rooms: [10, 14], maxDepth: 4,
  kinds: [{ kind: "docking", name: "DOCKING", required: true },
          { kind: "cargo", name: "CARGO", weight: 3, cover: true },
          { kind: "reactor", name: "REACTOR", deep: true }],
  entryKind: "docking",
  doors: { open: 6, closed: 3, locked: 1, sealed: 1, broken: 1 },
  cards: [{ name: "spare parts", kinds: ["cargo"], weight: 3, maxPerShip: 3, marks: ["X"] }],
  cardsPerRoom: 2,
};
const ship = generateShip(HULK, rng);
```

Попытки и отбраковку по `validateShip` генератор берёт на себя; `buildShip` вернёт то же
плюс ключи, флаги и куда легла каждая карточка. `marks` движок не читает, кроме одной:
`LOCK_ENTRY` просит запереть дверь в этот отсек и положить ключ (`key:k1`) там, куда дрон
уже дошёл. Правило Дорманса проверяется обратно по готовому кораблю — `reachableWithKeys`.

### Дать машине характер

```ts
// packages/engine/src/rooms/behaviours.ts
scavenger: desireDriven({ player: 0.8, allies: 0.3, noise: 0.5, fleeBelow: 0.3, follow: "withAllies" }),
```

Те же четыре числа, что на сетке, плюс пятое поле, которого на сетке нет: `follow` — пойдёт
ли машина за дроном в дверь. Готовых восемь, в `ROOM_BEHAVIOURS`; поле `behaviour` монстра —
одна из этих строк.

### Сделать шум и видимость через двери

Шум считается каждый ход в `game.noise`: открытая дверь и дыра съедают 1, закрытая 3,
запертая и заваренная 4, шлюз не пропускает ничего. Свой источник — `game.makeNoise(room,
strength)`, «иди на звук» — `loudestRoom`. Видимость — два правила: свой отсек всегда,
соседний только сквозь дыру или открытую дверь и при `sight >= 1` (`game.visible`, `canSee`).
Импульс сенсора читает структуру сквозь любые двери — `scanRooms`.

### Написать тест на что угодно

```ts
const f = shipFromText(`
  TUG -a1- r1
  r1 -d1- r2 -(d2)- r3
  r2 -[d3:k1]- r4
  r1: docking @
  r2: cargo m:scout %thrusters:2 †:k1 cover
`);
```

`-d1-` открытая, `-(d2)-` закрытая, `-[d3:k1]-` запертая на ключ `k1`, `-#d4#-` заваренная,
`-·d5·-` дыра. `TUG` (или `OUT`) — не отсек, а внешний мир: `a1` становится шлюзом, `r1` —
входом. Дальше `f.ship.room("r2")`, `f.player`, `f.mark("†")`; обратно в текст —
`shipToText(ship)`.

### Прогнать ботов и померить баланс

```ts
const result = runBotOn(BOTS_ROOMS.careful!, seed, roomPlay({ maxSteps: 1500, make: newGame }));
```

`runBotOn` / `runBatchOn` / `formatSummary` — те же, что на сетке; `roomPlay` только
объясняет им корабль. Счёт по умолчанию — отсеки, где дрон стоял; своя единица (кредиты,
проданные корпуса) — `progress()` и `metrics()` на самой игре. Всё, что игра изобрела сверх
шести глаголов, боты видят только через `Twist.offerActions`: не объявили — не нажмут.

---

## Чего не делать

- **Не писать свой FOV.** Симметричный уже есть, и асимметрия — источник жалоб
  «монстр выстрелил из темноты». Замеры rot.js: 9–11% асимметричных пар.
- **Не писать свой A\*.** Dijkstra-карты покрывают преследование, бегство,
  сопровождение, авто-исследование и всё остальное одним примитивом — на сетке
  `sim/dijkstra.ts`, на графе `RoomDistance`. Второй поиск не нужен ни там, ни там.
- **Не писать конечные автоматы для ИИ.** Профиль желаний короче и не ломается.
- **Не вводить `Math.random()` и `Date.now()` в `sim/` и `rooms/`.** Это убивает
  воспроизводимость забегов, а вместе с ней — багрепорты и половину тестов.
- **Не писать свой генератор корабля.** Класс корпуса — это `ShipSpec` и карточки,
  то есть данные; попытки, отбраковка и инварианты (один шлюз, всё достижимо, ключ не
  за своей дверью, схема рисуется) уже в `shipgen.ts` и `validate.ts`.
- **Не заводить свой формат текстовых кораблей.** `shipFromText` читает двери, ключи,
  метки и игрока; свой парсер разъедется с `shipToText` и с фикстурами движка.
- **Не делать экран инвентаря.** Три слота и клавиши 1/2/3 достаточно.
- **Не проверять карту «на глаз».** Есть `validate()`, и он гоняется на 40 сидах
  для каждого генератора.
- **Не импортировать пути внутрь движка из игры.** Только `@jamrog/engine` —
  иначе перестановка файлов в движке ломает игры.
- **Не тащить контент в движок.** Если в `packages/` появился «кобольд» — граница
  нарушена, и вторая игра унаследует чужой бестиарий.
