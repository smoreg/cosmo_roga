# G26 — Рейс: кредиты, три корпуса, покупка, ремонт, перелёт, гибель дрона

Статус: done 4.09 — рига SCRAPPER осталась `STARTING_MODULES` (SCANNER вместо WELDER из GDD:
набор из таблицы ломает 7 тестов в чужих файлах), трюм буксира работает, но наполнять его пока
некому (G25/G28), оверлей `lost` — три строки панели вместо одной: в 28 колонок не влезает ·
Зависит от: G38, G17 · Блокирует: G19, G18, G27, G25, G30 · Оценка: 4 ч · Пакет: `games/salvor`

## Зачем

Уточнение владельца дословно: «Никакой меты. Потерял дрона — купи нового. Нет денег? Всё,
конец». Деньги — единственная страховка забега и второе (и последнее) условие проигрыша. Здесь
живёт всё состояние рейса; буксир как место — G19, чтобы состояние тестировалось без него.
Числа — таблица GDD «Экономика рейса», не менялись.

## Что сделать

1. `systems/voyage.ts` — состояние и система `VOYAGE` (берёт на себя `claimsOutcome` и
   `beforeLevelLeave` у `SHIP` из G17: `SHIP` продолжает считать системы, `VOYAGE` решает, куда
   ведёт `leave` и когда забег окончен):
   ```ts
   export interface DerelictState { spec: DerelictSpec; shipId: string; alert: number; online: ObjectiveId[];
     deaths: Array<{ room: RoomId; rig: Rig }>; rivalProgress: number; sold: boolean }
   export interface Voyage { credits: number; hold: Array<{ kind: ModuleId; integrity: number }>; hull?: HullId; keys: number;
     loot: number; derelicts: DerelictSpec[]; current: number; state: DerelictState[]; charters: Charter[]; sortie: number }
   export function voyageOf(game): Voyage;                       // player.data.voyage — плоские данные
   export function credit(game, n, why): void;  export function spend(game, n): boolean;   // false = не хватило, ход не тратится
   export function buyHull(game, id): Outcome;  export function repair(game, slot): Outcome;  // 4 CR
   export function graft(game, slot): Outcome;  // 12 CR, потолок база + 2 (совместно с G28)
   export function clean(game, slot): Outcome;  // 4 CR, вирус (G29)
   export function sellSlot(game, slot): Outcome;  export function fitFromHold(game, i): Outcome;
   export function jump(game): Outcome;         // 30 CR, следующий дереликт
   export function undock(game): Outcome;       // travelTo(derelict.shipId, …), sortie++
   export function returnToTug(game, reason: "airlock" | "death"): void;
   ```
2. `content/hulls.ts` — три корпуса по таблице GDD с чертами (`platingBase 11`, `thrusterSpeed
   120`, `baffleBase 6`); `makePlayer` собирается из корпуса.
3. **Возврат через `a1`:** `loot` → кредиты (ящики 8, контрабанда 14, тела 3 — уже начислены в
   `loot`), модули остаются в риге (продаются в HOLD), чартеры проверяются (`done(voyage)`) и
   платят (G25; до него — только `NEUTRALIZE`), `alert` → `online.length`; три системы →
   `sold = true`, `+salePrice`, лог продажи; на буксире отца → `finish("won")`.
4. **Гибель дрона:** `hull = undefined`, рига/ключи/лут потеряны, запись в `deaths` (для G18),
   `alert` не падает; `travelTo("tug")`; оверлей `DRONE LOST · CREDITS n · CHEAPEST HULL 40`
   (переход редьюсера — G37 заготовил).
5. **Конец забега:** нет корпуса и `credits < 40` → `finish("dead", "The rack is empty and so is
   the account. Voyage over.")`.
6. `offerActions` — действия станций по отсеку буксира (G19 даёт отсеки; до G19 — все в одном
   отсеке-заглушке): `buy …` ×3 (только без корпуса), `repair weakest +1 (4 CR)`, `graft <M>
   +1 base (12 CR)` по модулю, `sell <M> (k CR)` по слоту, `fit <M>` по трюму, `undock`, `jump
   (30 CR)`; `enabled` по деньгам, `why` — `Not enough credits.`
7. `Playable.metrics()` для E14: `credits`, `shipsSold`, `dronesLost`, `sortie`.

## Файлы

`games/salvor/src/systems/voyage.ts`, `src/content/hulls.ts`, `src/content/player.ts`
(из корпуса), `src/systems/ship.ts` (снять `claimsOutcome`, оставить подсчёт), `src/game.ts`,
`tests/voyage.test.ts`.

## Тесты

- Кредиты: продажа модуля прочности 3 даёт 8; ящик 8; контрабанда 14; труп 3.
- `spend` при нехватке — false, счёт не меняется, ход не тратится; ни одна станция не тратит ход
  при отказе.
- Покупка каждого корпуса: та же рига и черта, ровно цена.
- `graft` не поднимает базу выше `+2` ни при какой последовательности.
- Гибель: рига, ключи, лут потеряны; `deaths` пополнился; тревога не упала; игрок на буксире.
- Нет корпуса и 39 CR → забег окончен своей строкой; 40 → нет.
- Три системы + `leave` на любом корабле → `sold`, `+salePrice`, `jump` доступен; на буксире
  отца → `won`.
- `replayRooms` рейса из 40 команд с покупкой, гибелью и перелётом — бит-в-бит.

## Чего не делать

Мета между забегами — ни в каком виде. Никаких процентов, скидок, репутации. Один счётчик.
