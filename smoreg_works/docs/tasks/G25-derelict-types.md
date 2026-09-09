# G25 — Семь типов дереликтов, чартеры, порядок рейса

Статус: done 4.09 — заготовка интегрирована. Каталог переехал в `content/derelicts.ts`
(`derelict-catalog.ts` удалён, `DERELICTS` — все семь, `MIDDLE_HULLS` — пятёрка середины),
`DERELICT_CARDS` влиты в `CARDS`, маршрут рейса рисуется `derelictsForVoyage` при создании состояния,
корабль генерируется `buildChartered` при `undock`. Иначе, чем в задаче: (1) `act take {item}` и
`act upload` живут в `systems/voyage.ts`, а не в `populate.ts` — у глагола `take` должен быть один
владелец, иначе ящик и чартерная вещь дерутся за одну команду; `populate.ts` отдал только поля
`taken`/`uploaded`/`turns` у `RoomItem`; (2) чартеры подписываются только пока корпус не открыт
(после первой вылазки строка гаснет с объяснением) — метку сажает генератор, и подписанный позже
чартер был бы невыполним; (3) `NEUTRALIZE` не платится отдельно: его оплата — продажа корпуса,
иначе он платил бы дважды; (4) `SALVAGE` считает лут, сданный с этого корпуса за все вылазки
(`DerelictState.banked`); (5) полоса машин получила пол веса 1 внутри полосы класса — иначе
карантин с `crawler`/`bloom` весом 0 населялся бы одними скрепперами; ENFORCER добавляется в
полосу через `machineAboard(id)`, а не через `machineByName`. · Зависит от: G36,
G26 · Блокирует: G30, G32, G18, G27 · Оценка: 4 ч · Пакет: `games/salvor`

## Зачем

«В разных кораблях разные палубы, нам нужно хоть какое-то разнообразие… парочку нелегальных» и
«разные контракты — каеф». Тип корабля — данные: каталог отсеков и веса, полоса машин, размер
графа, веса дверей, стартовая тревога, цена. Всё это — `DerelictSpec` → `ShipSpec` (G36 дал
грузовик; здесь остальные шесть) плюс чартеры.

## Что сделать

1. `content/derelicts.ts`: шесть записей по таблице GDD «Типы дереликтов» (`laboratory`,
   `military`, `smuggler`, `corsair`, `quarantine`, `fathers-tug`): `rooms`, `maxDepth`, `kinds`,
   `band`, `alertStart`, `doors` (веса из «Числа для первого баланса»), `salePrice`,
   `keyChance`, `virusBonus`, `flavour` (списки родовых слов: реактор, двигатель — строка на
   HELM). `derelictsForVoyage(rng)`: грузовик → два разных → буксир отца.
2. `content/charters.ts`:
   ```ts
   export type CharterId = "salvage" | "retrieve" | "upload" | "neutralize";
   export interface Charter { id; text; payout; target?: { kind: string; mark: "*" | "&" }; done(v: Voyage, ship: Ship): boolean }
   export function offerCharters(spec: DerelictSpec, rng: Rng): Charter[];   // 2–3, neutralize всегда
   ```
   `retrieve` → марка `*` в отсек названного типа с `depth ≥ 2` (через карточку `charter item`
   с `when` по взятому чартеру — марки ставятся при генерации, поэтому чартеры предлагаются
   **до** генерации корабля: `offerCharters` вызывается при `jump`, корабль генерируется при
   первом `undock`); `upload` → марка `&`, `act upload` 5 ходов подряд, шум 6; `salvage` → `loot
   ≥ N`. `act take {item}` для `*`.
3. `systems/voyage.ts`: `take charter` в HELM; проверка `done` при возврате; выплата.
4. Карточки `hidden hold` (smuggler, предусловие «CELL или ключ»), `spore bloom`, `turret
   nest`, `charter item`, `console` — в `content/cards.ts`.

## Файлы

`games/salvor/src/content/derelicts.ts`, `src/content/charters.ts`, `src/content/cards.ts`
(пять карточек), `src/systems/voyage.ts` (чартеры), `tests/derelicts.test.ts`,
`tests/charters.test.ts`.

## Тесты

- Каждый тип: размер, тревога, полоса — по таблице; ни одной машины вне полосы на 200 сидов;
  `validateShip` пуст для всех семи × 200 сидов; `required` достижимы (гарантия генератора —
  прямая проверка BFS с ключами на военном и карантине, где `sealed` ≥ 5 %).
- `offerCharters` даёт 2–3, среди них `neutralize`; `retrieve` ставит ровно одну `*` на
  `depth ≥ 2`; `upload` — ровно одну `&`.
- `derelictsForVoyage` не повторяет тип и всегда кончается буксиром отца.
- Чартер зачитывается только при `leave`; гибель с выполненным — не зачитывается.

## Чего не делать

Восьмой тип корабля. Сайд-миссии. Не трогать `systems/ship.ts`.
