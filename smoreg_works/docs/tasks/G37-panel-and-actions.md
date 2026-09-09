# G37 — Панель, список действий, клавиши, рендер и оболочка `salvor`

Статус: done 2026-09-04 · Зависит от: E18, G31, G35 · Блокирует: G22, G32, G38 · Оценка: 4 ч ·
Пакет: `games/salvor/src/ui`

Иначе, чем в задаче: заголовок панели — две строки (`SALVOR <тип> sortie n`, `turn N`), а
`ALERT`/`CR`/`KEYS`/`HOLD` приходят через `panelLines` систем, которые ими владеют (G23, G26), —
панель не заводит счётчиков, которых ещё нет; строка букв разбита на две (`. brace h hide <
leave` и `o explore Tab fight ? help`), иначе отсек с укрытием и шлюзом сразу не влезал в 28
колонок; `hide` не занимает цифру (он на `h`), а `<` показан цифрой как дверь-шлюз; буквы
модулей у двери работают через редьюсер (`DOOR_USE`), а не через `toIntent`; `render.ts` рисует
поклеточно, а не `%c{}` — глиф `%` (обломки) rot.js прочитал бы как формат.

## Зачем

Второй столп экрана v3 после схемы: нумерованный список действий («выбираем что делать
текстом»), панель с отсеком и стойкой, клавиши без `hjkl`. Всё — чистые функции над состоянием
игры, `render.ts` и `app.ts` — тонкие обёртки, как требует правило G20.

## Что сделать

1. `ui/actions.ts` — `roomActions(game): Action[]`, `Action { key: string; label: string; cmd:
   RoomCommand; enabled: boolean; why?: string }`. Порядок GDD: атаки (движок: по каждой машине в
   отсеке) → предметы (`offerActions` систем) → двери (`go` по каждой двери, а для запертой /
   заваренной — первое `enabled` предложение систем с `target === door.id`, остальные методы —
   буквами в той же строке) → системы/консоли (предложения). Ключи `1`–`9`, `0`; свыше десяти —
   `omitted`, панель пишет `… and N more (Tab / letters)`. `labelOf(door, ship)` даёт
   `go d4  HAB       open` / `key d3 STORAGE   locked` с колонками фиксированной ширины.
2. `ui/panel.ts` — из `fortnight2` как есть, плюс `panelBlocks(game, actions): PanelLine[]`:
   заголовок (`SALVOR  <type>  sortie n`, `turn · ALERT`, `CR · KEYS · HOLD`), `panelLines`
   систем, блок отсека (`<NAME>  r2   doors d1 d3 d4 d6`, ≤ 4 строки содержимого с HP машин),
   `ACTIONS` + строки действий + строка букв `. brace  h hide  o Tab ?`. Каждая строка ≤ 28.
3. `ui/input.ts`: `MOVES` удалить; цифры → `{ kind: "pick"; index }`; `Tab`/`Shift+Tab` →
   `fight` с `mode`; `o`, `.`/пробел, `h`, `s e w p K f c`, `<`, `?`, `Esc`, `R`. `KEY_HELP`,
   `RULE_HELP`, `TITLE_LINES` — новые тексты (титул: три строки питча v3 и строка клавиш).
4. `ui/appstate.ts`: копия + `pick` (в `command` с `actions[index].cmd`, отказ `!enabled` →
   `log why` без хода); оверлеи `lost` и `sold` — заготовки переходов (G26 наполнит).
5. `ui/render.ts`: остаются `box`, баннеры, краш, лог, титул, справка; `draw` = `schematicLines`
   (спаны → `%c{}`) + `panelBlocks` + лог. `ui/app.ts` — копия из `fortnight2` (эффекты те же).
   `src/main.ts` — копия.
6. `ui/schematic-input.ts` — если не сделан в G31, здесь.

## Файлы

`games/salvor/src/ui/actions.ts`, `ui/panel.ts`, `ui/input.ts`, `ui/appstate.ts`, `ui/render.ts`,
`ui/app.ts`, `src/main.ts`, `tests/actions.test.ts`, `tests/panel.test.ts`, `tests/input.test.ts`,
`tests/appstate.test.ts`, `tests/build.test.ts`.

## Тесты

- `roomActions` на фикстурах: порядок блоков; запертая дверь с ключом и SPIKE — одна строка с
  первым методом по цифре и вторым буквой; больше десяти — `omitted` не пуст и панель это
  говорит; каждое `enabled` действие выполняется `ok` (property, 300 состояний).
- Панель: каждая строка ≤ 28 при кредитах до 9999, шести модулях с `+`/`!`, четырёх дверях,
  трёх машинах (property).
- Клавиши: `1` → `pick 0`, `0` → `pick 9`, `h` → `hide`, `Tab`/`Shift+Tab` — оба режима,
  `ArrowUp` → `none`, `ctrl+r` → `none`; `K` → SPIKE, `k` → `none`.
- Редьюсер: `pick` на `!enabled` пишет `why` и не тратит ход; 23 старых теста переходов —
  как были.
- `build.test.ts`: `favicon.svg` и ссылка в `index.html`; `npm run build -w games/salvor`
  собирается (проверка вручную, не в тесте).

## Чего не делать

Курсор по списку, стрелки, мышь, прокрутка панели, второй экран. Не вызывать `playerCommand` из
`actions.ts`.
