# jamrog — движок для traditional roguelike и игры на нём

Монорепо: переиспользуемый движок в `packages/engine`, игры в `games/`, общие ассеты
в `assets/`. Всё на TypeScript, играется в браузере.

Джем — [roguetemple's Fortnight 2](https://itch.io/jam/roguetemples-fortnight-2)
(1–15 сентября 2026), и игр в репозитории **две**:

- **`games/salvor`** — то, что сдаётся. Дрон-мусорщик на графе отсеков: корабль-дереликт
  генерируется отсеками и дверями, урон приходит в модули рига, а не в игрока, цель корабля —
  запустить три системы, уйти через шлюз и продать корпус. Рейс — три точки: на первых двух
  выбор корпуса вместе с контрактом, последняя — буксир отца.
  Два вью на одну игру: ASCII-терминал и графический (клавиша `V`, `?view=web`) — оба рисуют
  одни и те же чистые функции. Три языка, EN · ES · RU (`L`, `?lang=`). Дизайн —
  [`docs/design-doc.md`](docs/design-doc.md). Все корневые команды (`dev`, `build`, `preview`,
  `zip`) ведут сюда.
- **`games/fortnight2`** — страховка. Законченная тайловая игра, замороженная тегом
  `submission-v1`: если `salvor` не соберётся к сроку, сдаётся она. Её никто не редактирует;
  запускается только явно, через `-w games/fortnight2`.

Движок в `packages/engine` обслуживает обе: сеточный мир (`sim/`) и мир отсеков (`rooms/`)
делят один цикл хода и ничего больше, и ни один из них не знает слов ни одной игры.

## Быстрый старт

```bash
npm install                          # свяжет воркспейсы

npm run dev                          # SALVOR на http://localhost:5173
npm test                             # 2182 теста: движок, аудио, salvor (fortnight2 заморожена, свой прогон)
npm run typecheck                    # типы по всему монорепо
npm run build                        # сборка SALVOR
npm run zip                          # dist + games/salvor/salvor-web.zip для itch.io

npm run dev -w games/fortnight2      # запасная игра, submission-v1
npm run new-game -- <id> "Название"  # новая игра из шаблона
npm run zip -w games/<id>            # dist + zip любой игры
```

`?seed=12345` воспроизводит забег ход в ход; `?lang=es`, `?view=web` и `?sound=off` фиксируют
язык, экран и тишину — тем же способом, для багрепорта и для скриншота.

## Структура

```
jamrog/
├─ packages/
│  ├─ engine/              @jamrog/engine — переиспользуемое ядро, ничего не знает
│  │  ├─ src/              об играх; импортируется как TS-исходники, без сборки
│  │  └─ tests/            инварианты и свойства движка
│  └─ audio/               @jamrog/audio — адаптивная музыка: состояния, кроссфейд
│                          с сохранением мощности, переходы по границе такта
├─ games/
│  ├─ _template/           скелет новой игры (в воркспейс не входит)
│  ├─ salvor/              заявка на джем
│  │  ├─ src/content/      отсеки, карточки, модули, машины — вся балансировка,
│  │  │                    плюс i18n/: три таблицы строк, EN · ES · RU
│  │  ├─ src/systems/      двери, тревога, системы корабля, рейс, заселение
│  │  ├─ src/twist/        риг: урон приходит в модули
│  │  ├─ src/ui/           схема, панель, ввод; ui/web/ — второе вью на SVG и HTML
│  │  ├─ music/            исходники петель и стингеров (Strudel) + правила состояний
│  │  └─ tests/            тесты этой игры + смок ботами (tests/smoke.test.ts)
│  └─ fortnight2/          запасная игра, заморожена тегом submission-v1
│     ├─ src/content/      бестиарий, игрок, вольты, ContentPack — вся балансировка
│     ├─ src/ui/           рендер и ввод
│     ├─ music/            исходники треков (Strudel) + правила состояний
│     ├─ assets/           ассеты только этой игры
│     └─ tests/            тесты этой игры: баланс, проходимость, системы
├─ assets/                 общие ассеты: audio (5 петель + 13 эффектов) + CREDITS.md
├─ docs/                   разведка джема, планы, разборы, рецепты
└─ scripts/new-game.mjs    генератор новой игры из шаблона
```

Границы жёсткие и в этом весь смысл:

- **движок не знает про игры.** Он получает `ContentPack` — бестиарий, игрока, вольты,
  глубину — и работает с любым. Ни одного импорта из `games/` в `packages/`.
- **игра не лезет внутрь движка.** Только `@jamrog/engine` и `@jamrog/engine/testing`;
  внутренние файлы можно переставлять, не задевая игры.
- **контент не знает про интерфейс.** `src/content/` не импортирует `src/ui/`.

## Что уже в движке

| Кирпич | Что даёт |
|---|---|
| `sim/shadowcast.ts` | **симметричный** FOV на целочисленной арифметике (у rot.js 9–11 % асимметричных пар) |
| `sim/dijkstra.ts` | Dijkstra-карты на бинарной куче: пути, карты безопасности, desire-AI |
| `sim/mapgen/` | четыре генератора (комнаты / BSP / пещеры / пьяный землекоп) за одним интерфейсом, постобработка, prefab-вольты, валидатор с ретраями |
| `sim/schedule.ts` | энергетические ходы, скорость с учётом статусов |
| `sim/status.ts` | 9 статусов, противоположности, щиты, модификаторы любых статов |
| `sim/effects.ts` | урон / лечение / статус / телепорт / толчок как **данные** |
| `sim/items.ts` + `targeting.ts` | 3 слота, заряды, прицеливание с предпросмотром и валидацией |
| `sim/ai/behaviors.ts` | 5 поведений на desire-картах; своё — профиль из четырёх чисел |
| `sim/propagate.ts` | шум / запах / газ с затуханием |
| `sim/spawn.ts` | весовые таблицы, полосы глубины, кривая сложности |
| `sim/twist.ts` | список систем, подключаемых к циклу хода |
| `sim/save.ts` | забег как `(seed, команды)`, защищённый парсер |
| `rooms/graph.ts` + `paths.ts` | мир как граф отсеков и дверей: расстояния в дверях, бегство, маршруты по проходимости конкретного ходока |
| `rooms/gen/shipgen.ts` | генератор корабля: дерево отсеков, петли, двери, замки, раскладка на схему |
| `rooms/behaviours.ts` + `noise.ts` + `sight.ts` | поведения, шум и видимость на графе |
| `@jamrog/audio` | адаптивная музыка по состояниям, равномощный кроссфейд, стингеры |
| `testing/fixtures.ts` · `roomfixtures.ts` | уровень из ASCII и корабль из текста — основа всех тестов |
| `testing/bots.ts` · `roombots.ts` + `metrics.ts` | три бота вместо плейтестеров, в обоих мирах, таблица баланса |

Подробности и рецепты — [`docs/cookbook.md`](docs/cookbook.md).

Музыка пишется кодом: жанр, тема и переходы — скилл `composing-music` (подключён в
`.claude/skills/`), правила проекта и состояния трека —
[`games/salvor/music/README.md`](games/salvor/music/README.md).

## Документы

| Файл | Что внутри |
|---|---|
| [`docs/design-doc.md`](docs/design-doc.md) | дизайн SALVOR: цикл, риг, корабль, тревога, победа |
| [`docs/tasks/README.md`](docs/tasks/README.md) | порядок работ, волны, гейты, протокол агента |
| [`docs/jam-brief.md`](docs/jam-brief.md) | правила, даты, критерии джема |
| [`docs/prior-entries.md`](docs/prior-entries.md) | разбор всех 32 работ прошлого Fortnight |
| [`docs/engine-study.md`](docs/engine-study.md) | разбор исходников prism и libtcod |
| [`docs/ideas.md`](docs/ideas.md) | 12 идей твиста, шорт-лист из 3 |
| [`docs/plan-14-days.md`](docs/plan-14-days.md) | план по дням с гейтами |
| [`docs/scope-rules.md`](docs/scope-rules.md) | что резать первым, чего не делать |
| [`docs/traditional-checklist.md`](docs/traditional-checklist.md) | соответствие жанру |
| [`docs/cookbook.md`](docs/cookbook.md) | как собрать новую игру из кирпичей |
| [`docs/itch-page.md`](docs/itch-page.md) · [`docs/itch-page-template.md`](docs/itch-page-template.md) | страница itch: готовый текст и шаблон |
| [`docs/submission-checklist.md`](docs/submission-checklist.md) | чеклист сдачи: строка = тест или «владелец» |
| [`docs/adr/`](docs/adr/) | почему TypeScript + rot.js; почему свой FOV |

## Где сейчас

Точка входа для новой сессии — [`.claude-progress.md`](.claude-progress.md) в корне: что сделано,
что в полёте, что осталось владельцу. Порядок работ и статусы задач —
[`docs/tasks/README.md`](docs/tasks/README.md).

Открытое на день 6: баланс рейса — [`docs/tasks/G30-balance-v2.md`](docs/tasks/G30-balance-v2.md)
(числа и метрики держат `games/salvor/tests/balance.test.ts` и `winnable.test.ts`, здесь их
намеренно нет); наращивание модулей — [`docs/tasks/G28-grafting.md`](docs/tasks/G28-grafting.md);
сдача — [`docs/tasks/G13-release.md`](docs/tasks/G13-release.md), где перечислено и то, что может
сделать только владелец: скриншоты, гифка, обложка, загрузка.

Дефект первого грузовика, который стоял здесь раньше, закрыт задачами G38 и G30.
