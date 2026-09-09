# G19 — Буксир как корабль из четырёх отсеков: DOCK · HOLD · BENCH · HELM

Статус: done 4.09 — заготовка интегрирована. Забег начинается на буксире (`firstShip: tugShip`,
`firstShipId: TUG_ID`), `TUG` в `systems` после `POPULATE` и до `VOYAGE`; `alert.ts` и `populate.ts`
молчат на буксире, `ui/actions.ts` строит список через `gatedOffers`, `voyage.ts` выбросил
одноотсечную заглушку. Иначе, чем в задаче: (1) схему дереликта в DOCK берёт не `ships.get(
derelict.shipId)`, а `ships.get(currentShip.data.from)` — рейс пишет id пришвартованного корпуса
на карман буксира, и `ui/` остаётся без импорта `systems/voyage.ts`; окно рисуется «памятью»
(ни одного `current`-отсека, машины не показаны — их на складе нет); (2) конфиги тестов, которые
раскладывают `GAME_CONFIG` и подменяют `firstShip`, теперь обязаны сказать `firstShipId: "1"` —
иначе рукодельный корпус ложится под id буксира; (3) `openingLine` переписан: забег открывается
дома, а не «зажимы отпустили». · Зависит от: G26 ·
Блокирует: G32, G30 · Оценка: 3 ч · Пакет: `games/salvor`

## Зачем

Все решения между вылазками должны быть местом, а не меню. В v3 это дёшево: буксир — такой же
граф из четырёх отсеков на той же схеме, станция — список действий отсека. Ни одного нового
экрана, ни одного режима (`docs/design-doc.md`, «Буксир»).

## Что сделать

1. `content/tug.ts` — `tugShip(): Ship` из `shipFromText`-подобной константы (не из генератора):
   `DOCK -t1- HOLD -t2- BENCH -t3- HELM`, дверь `a1` типа `airlock` у DOCK; все двери `open`;
   `cover: false`, `depth` 0..3, раскладка в одну строку.
2. `systems/tug.ts` — система `TUG`: на `shipId === "tug"` — `ALERT`, `POPULATE` и рига
   молчат (проверка `shipId` внутри них — по одной строке); `offerActions` распределяет действия
   `VOYAGE` (G26) по отсекам: DOCK — покупка и `undock`; HOLD — `sell`/`fit`; BENCH — `repair`,
   `graft`, `clean`; HELM — `take charter …` и `jump`. Переход между отсеками — обычный `go`.
3. Забег начинается на буксире: `firstShip` = `tugShip()`, `shipId "tug"`, дрон в DOCK, 25 CR,
   `SALVAGE 20 CR` в HELM (чартеры — G25; до него HELM предлагает только `jump` и ничего не
   требует).
4. Панель на буксире (через `panelLines` `VOYAGE`): `DERELICT freighter · 12 rooms · alert 2 ·
   engine ✓ core · terminal ·`; схема показывает буксир, а по `Tab`… нет: **схема дереликта
   показывается в окне вместо буксира, когда дрон в DOCK** (`schematicInputOf` берёт
   `ships.get(derelict.shipId)`, если он есть) — так игрок планирует вылазку до входа.

## Файлы

`games/salvor/src/content/tug.ts`, `src/systems/tug.ts`, `src/systems/alert.ts` и
`src/systems/populate.ts` (по одной строке `if (game.shipId === "tug") return`), `src/game.ts`,
`src/ui/schematic-input.ts` (окно DOCK), `tests/tug.test.ts`.

## Тесты

- На буксире нет машин и тревога не растёт за 200 ходов.
- Каждая станция предлагает свои действия только в своём отсеке; действие из чужого отсека —
  отказ без хода.
- `undock` из DOCK → дрон в `entry` дереликта; `leave` из дереликта → дрон в DOCK; тот же
  `shipId`, тот же граф (совместно с E18).
- Реплей «купил → починил → перешёл в HELM → jump → undock» — бит-в-бит.
- В DOCK `schematicInputOf` отдаёт схему дереликта, в HOLD — буксира.

## Чего не делать

Ни одного экрана, списка с ценами вне `ACTIONS`, курсора. Буксир не летает по карте галактики.
