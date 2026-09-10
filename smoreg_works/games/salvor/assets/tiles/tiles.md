# Тайлы SALVOR — каталог

Сгенерировано `npm run tiles -w games/salvor`. Править нечего: формы лежат в
`games/salvor/tools/tiles/sprites.mjs`, всё остальное в этой папке — их рендер.
Маски текстом, по которым тайл можно перерисовать руками, — в **`tiles.txt`**.

**Тайлов: 73**, на сетке 12×12. Из них **22** нарисованы заново на 16×16.

## Правила, которые держат набор

1. **Цвета в арте нет.** Маска — это `#` и `.`, без полутона. Символы в
   `src/tiles/sprites.ts` — единичные `<rect>` с `fill="currentColor"`, поэтому
   тайл красит тот, кто его ставит, и дробный масштаб ничего не стоит.
2. **Янтарь `#e0a458` в арте запрещён полностью.** Он значит «здесь требуется
   решение» и принадлежит рамке, которую рисует вид, а не картинке внутри неё.
3. **Нет тайла — рисуется буква.** Словарь марок открыт снизу (`content/cards.ts`
   кладёт в `marks` что угодно), и плейсхолдера в наборе нет намеренно: один серый
   квадрат на трёх разных вещах хуже трёх букв.
4. **Класс раньше вида.** Сначала читается «машина / предмет / система / опасность»,
   и только потом «именно каратель»: имя всё равно стоит словом в панели.
5. **Толстый контур, сплошная фигура.** Тайлы стоят в ряд и обязаны оставаться
   раздельными; штрих в один пиксель на этих размерах сливается.

Колонка `цвет` — только для справочных PNG, и приходит из таблиц игры
(`content/monsters.ts`, `content/palette.ts`). На экран в `salvor` эти цвета не
попадают: машина приходит виду одним `--bad`. Подробности и почему так —
`README.md` в этой же папке.

## Каталог

| имя | знак | группа | слово | роль | символ | 12×12 в атласе | 16×16 в атласе | цвет |
|---|---|---|---|---|---|---|---|---|
| `machine.maintenance-bot` | `m` | машина | maintenance bot | brute | `tile-machine-maintenance-bot` | 0,0 12×12 | — | #9aa5b1 |
| `machine.feral-drone` | `d` | машина | feral drone | pack | `tile-machine-feral-drone` | 12,0 12×12 | — | #4fd0c0 |
| `machine.scout` | `c` | машина | scout | stalker | `tile-machine-scout` | 24,0 12×12 | — | #7fb2ff |
| `machine.security-unit` | `S` | машина | security unit | brute | `tile-machine-security-unit` | 36,0 12×12 | — | #3f6fbf |
| `machine.welder-bot` | `w` | машина | welder bot | coward | `tile-machine-welder-bot` | 48,0 12×12 | — | #6fbf5f |
| `machine.hauler` | `H` | машина | hauler | brute | `tile-machine-hauler` | 60,0 12×12 | — | #46587e |
| `machine.scrapper` | `x` | машина | scrapper | pack | `tile-machine-scrapper` | 72,0 12×12 | — | #a98fe0 |
| `machine.arc-sentinel` | `A` | машина | arc sentinel | brute | `tile-machine-arc-sentinel` | 84,0 12×12 | — | #d7ecff |
| `machine.sentry-turret` | `t` | машина | sentry turret | turret | `tile-machine-sentry-turret` | 0,12 12×12 | — | #2f97b8 |
| `machine.jammer` | `j` | машина | jammer | coward | `tile-machine-jammer` | 12,12 12×12 | — | #c46fbf |
| `machine.crawler` | `z` | машина | crawler | pack | `tile-machine-crawler` | 24,12 12×12 | — | #8fae4f |
| `machine.bloom` | `Y` | машина | bloom | static | `tile-machine-bloom` | 36,12 12×12 | — | #c3d96f |
| `machine.enforcer` | `E` | машина | enforcer | hunter | `tile-machine-enforcer` | 48,12 12×12 | — | #d9705a |
| `actor.drone` | `@` | существо | drone | — | `tile-actor-drone` | 60,12 12×12 | — | #f0e6d2 |
| `actor.ghost` | `G` | существо | ghost | — | `tile-actor-ghost` | 72,12 12×12 | — | #b7ab97 |
| `actor.rival-drone` | `r` | существо | rival drone | — | `tile-actor-rival-drone` | 84,12 12×12 | — | #d9a441 |
| `module.cutter` | — | модуль | CUTTER | — | `tile-module-cutter` | 0,24 12×12 | — | #b9c4cc |
| `module.thrusters` | — | модуль | THRUSTERS | — | `tile-module-thrusters` | 12,24 12×12 | — | #b9c4cc |
| `module.scanner` | — | модуль | SCANNER | — | `tile-module-scanner` | 24,24 12×12 | — | #b9c4cc |
| `module.plating` | — | модуль | PLATING | — | `tile-module-plating` | 36,24 12×12 | — | #b9c4cc |
| `module.cell` | — | модуль | CELL | — | `tile-module-cell` | 48,24 12×12 | — | #b9c4cc |
| `module.emp` | — | модуль | EMP | — | `tile-module-emp` | 60,24 12×12 | — | #b9c4cc |
| `module.welder` | — | модуль | WELDER | — | `tile-module-welder` | 72,24 12×12 | — | #b9c4cc |
| `module.laser` | — | модуль | LASER | — | `tile-module-laser` | 84,24 12×12 | — | #b9c4cc |
| `module.spike` | — | модуль | SPIKE | — | `tile-module-spike` | 0,36 12×12 | — | #b9c4cc |
| `module.emitter` | — | модуль | EMITTER | — | `tile-module-emitter` | 12,36 12×12 | — | #b9c4cc |
| `module.baffle` | — | модуль | BAFFLE | — | `tile-module-baffle` | 24,36 12×12 | — | #b9c4cc |
| `module.blade` | — | реликвия | Q-BLADE | — | `tile-module-blade` | 36,36 12×12 | — | #dfe9f0 |
| `module.shocker` | — | реликвия | SHOCKER | — | `tile-module-shocker` | 48,36 12×12 | — | #dfe9f0 |
| `module.lattice` | — | реликвия | LATTICE | — | `tile-module-lattice` | 60,36 12×12 | — | #dfe9f0 |
| `thing.crate` | `X` | предмет | ящик | — | `tile-thing-crate` | 72,36 12×12 | — | #b9c4cc |
| `thing.scrap` | `%` | предмет | лом | — | `tile-thing-scrap` | 84,36 12×12 | — | #8f9aa2 |
| `thing.body` | `†` | предмет | тело | — | `tile-thing-body` | 0,48 12×12 | — | #8f9aa2 |
| `thing.parcel` | `*` | предмет | предмет поручения | — | `tile-thing-parcel` | 12,48 12×12 | — | #b9c4cc |
| `thing.keycard` | — | предмет | ключ-карта | — | `tile-thing-keycard` | 24,48 12×12 | — | #b9c4cc |
| `thing.vented` | `~` | предмет | вентилированный отсек | — | `tile-thing-vented` | 36,48 12×12 | — | #d96a6a |
| `thing.system` | `+` | предмет | система корабля | — | `tile-thing-system` | 48,48 12×12 | — | #d9b56a |
| `thing.system-online` | `✓` | предмет | система поднята | — | `tile-thing-system-online` | 60,48 12×12 | — | #7fc97f |
| `thing.cover` | — | предмет | укрытие | — | `tile-thing-cover` | 72,48 12×12 | — | #6f8a9a |
| `door.open` | — | дверь | open | — | `tile-door-open` | 84,48 12×12 | — | #3f4a52 |
| `door.closed` | — | дверь | closed | — | `tile-door-closed` | 0,60 12×12 | — | #6f8a9a |
| `door.locked` | — | дверь | locked | — | `tile-door-locked` | 12,60 12×12 | — | #e0a458 |
| `door.sealed` | — | дверь | sealed | — | `tile-door-sealed` | 24,60 12×12 | — | #5a4e42 |
| `door.broken` | — | дверь | broken | — | `tile-door-broken` | 36,60 12×12 | — | #3f4a52 |
| `door.airlock` | — | дверь | airlock | — | `tile-door-airlock` | 48,60 12×12 | — | #a07a44 |
| `zone.docking` | — | отсек | DOCKING BAY | — | `tile-zone-docking` | 60,60 12×12 | 0,0 16×16 | #6f8a9a |
| `zone.cargo` | — | отсек | CARGO BAY | — | `tile-zone-cargo` | 72,60 12×12 | 16,0 16×16 | #6f8a9a |
| `zone.corridor` | — | отсек | CORRIDOR RING | — | `tile-zone-corridor` | 84,60 12×12 | 32,0 16×16 | #6f8a9a |
| `zone.storage` | — | отсек | STORAGE | — | `tile-zone-storage` | 0,72 12×12 | 48,0 16×16 | #6f8a9a |
| `zone.maintenance` | — | отсек | MAINTENANCE | — | `tile-zone-maintenance` | 12,72 12×12 | 64,0 16×16 | #6f8a9a |
| `zone.hab` | — | отсек | HAB BLOCK | — | `tile-zone-hab` | 24,72 12×12 | 80,0 16×16 | #6f8a9a |
| `zone.mess` | — | отсек | MESS | — | `tile-zone-mess` | 36,72 12×12 | 96,0 16×16 | #6f8a9a |
| `zone.hydroponics` | — | отсек | HYDROPONICS | — | `tile-zone-hydroponics` | 48,72 12×12 | 112,0 16×16 | #6f8a9a |
| `zone.med` | — | отсек | MED BAY | — | `tile-zone-med` | 60,72 12×12 | 0,16 16×16 | #6f8a9a |
| `zone.lab` | — | отсек | LAB | — | `tile-zone-lab` | 72,72 12×12 | 16,16 16×16 | #6f8a9a |
| `zone.quarantine` | — | отсек | QUARANTINE | — | `tile-zone-quarantine` | 84,72 12×12 | 32,16 16×16 | #6f8a9a |
| `zone.engineering` | — | отсек | ENGINEERING | — | `tile-zone-engineering` | 0,84 12×12 | 48,16 16×16 | #6f8a9a |
| `zone.workshop` | — | отсек | WORKSHOP | — | `tile-zone-workshop` | 12,84 12×12 | 64,16 16×16 | #6f8a9a |
| `zone.armory` | — | отсек | ARMORY | — | `tile-zone-armory` | 24,84 12×12 | 80,16 16×16 | #6f8a9a |
| `zone.reactor` | — | отсек | REACTOR | — | `tile-zone-reactor` | 36,84 12×12 | 96,16 16×16 | #6f8a9a |
| `zone.control` | — | отсек | CONTROL | — | `tile-zone-control` | 48,84 12×12 | 112,16 16×16 | #6f8a9a |
| `zone.coreaccess` | — | отсек | CORE ACCESS | — | `tile-zone-coreaccess` | 60,84 12×12 | 0,32 16×16 | #6f8a9a |
| `zone.lifesupport` | — | отсек | LIFE SUPPORT | — | `tile-zone-lifesupport` | 72,84 12×12 | 16,32 16×16 | #6f8a9a |
| `zone.cryo` | — | отсек | CRYO | — | `tile-zone-cryo` | 84,84 12×12 | 32,32 16×16 | #6f8a9a |
| `zone.sensors` | — | отсек | SENSOR BAY | — | `tile-zone-sensors` | 0,96 12×12 | 48,32 16×16 | #6f8a9a |
| `zone.brig` | — | отсек | BRIG | — | `tile-zone-brig` | 12,96 12×12 | 64,32 16×16 | #6f8a9a |
| `zone.escapepods` | — | отсек | ESCAPE PODS | — | `tile-zone-escapepods` | 24,96 12×12 | 80,32 16×16 | #6f8a9a |
| `hazard.frost` | `❄` | опасность | мороз | — | `tile-hazard-frost` | 36,96 12×12 | — | #d96a6a |
| `hazard.smoke` | `≈` | опасность | дым | — | `tile-hazard-smoke` | 48,96 12×12 | — | #d96a6a |
| `hazard.mine` | `^` | опасность | мина на двери | — | `tile-hazard-mine` | 60,96 12×12 | — | #d96a6a |
| `overlay.damaged` | — | оверлей | повреждён | — | `ov-damaged` | 72,96 12×12 | — | #d9b56a |
| `overlay.infected` | `!` | оверлей | заражён | — | `ov-infected` | 84,96 12×12 | — | #d96a6a |
| `overlay.exposed` | `◀` | оверлей | открытый слот | — | `ov-exposed` | 0,108 12×12 | — | #e0a458 |
