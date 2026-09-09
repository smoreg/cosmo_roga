# G2 — Твист «дрон платит собой» (Rig)

Статус: сделано; `balance.test.ts` красный на `random.stuck < 0.5` (13/16) — контакта нет, а не летальности: единственная машина каталога `brute` с FOV 5 стоит на месте, пока не увидит дрона; чинится каталогом машин (G5) или тревогой (G6), бюджетом и прочностью не чинится · Зависит от: E1, E2, E3, G1 · Блокирует: G3, G4, G5, G8 · Оценка: 5–6 ч ·
Пакет: `games/fortnight2`

Это главная механика. Читать раздел GDD «Правило урона» и «Модули» до последней строки.

## Файлы

- `src/content/modules.ts` — таблица модулей (данные): `id, name, integrity, passive?, active?`.
  Ровно 8 из GDD. Тип `ModuleKind`.
- `src/twist/rig.ts` — сам твист `RIG: Twist` и чистые функции над `Rig`.
- `src/content/pack.ts` — `twist: RIG` передаётся в `new Game({ seed, content, twist: RIG })`
  из `ui/app.ts` **и** из тестов через общий `src/game.ts`: `export function newGame(seed)`.
  Все тесты и UI создают игру только через `newGame`, иначе реплеи разъедутся.

## Модель

```ts
interface Slot { kind: ModuleId; integrity: number }          // intact module
interface Rig { slots: Array<Slot | null>; exposed: number | null; burnedCount: number }
// stored as player.data.rig; 6 slots; exposed = slot index of the module at risk
```
Чистые функции (без `Game`, тестируются напрямую):
`makeStartingRig()`, `findSlot(rig, kind)`, `expose(rig, cmd)`, `routeDamage(rig, raw, source
tags) → { hits: Array<{slot, amount, burned}>, toCore }`, `derivedStats(rig) → { speed,
fovRadius, damage }`, `install(rig, kind, integrity) → slot | undefined`, `repair(...)`.

## Правила (точно по GDD)

- `expose` по последней **успешной** команде игрока: attack → cutter/laser; move → thrusters;
  wait → plating; use slot N → N; interact → plating. Если модуля для команды нет (сгорел) —
  `exposed = null` → цепочка начинается с plating.
- `routeDamage`: exposed → plating → core, с переливом. Тег источника `precise` — цель = целый
  модуль с наименьшей прочностью (при равенстве — меньший индекс). Тег `burst` — по 1 каждому
  целому модулю, без перелива, core не трогается.
- Сгорание: `integrity 0` → слот `null`, `burnedCount++`, `derivedStats` пересчитаны и записаны
  в `player.speed/fovRadius/damage`. Без `cutter`/`laser` → `damage [1,1,0]`; без thrusters →
  `speed 50`; без scanner → `fovRadius 3`.
- Таран (атака без резака) подставляет thrusters.

## Хуки твиста

- `onRunStart`: `player.data.rig = makeStartingRig()`, применить `derivedStats`.
- `afterPlayerTurn(game, cmd)`: `expose`.
- `onDamage(game, victim, amount, source)`: только для `victim.id === game.player.id`; вызвать
  `routeDamage`, залогировать по строке на модуль: `The <src> hits your CUTTER (2/4).`,
  `Your SCANNER burns out. The deck goes dark.` (текст сгорания — из `modules.ts`, у каждого
  модуля своя фраза), вернуть `toCore`.
- `panelLines`: 6 строк `N NAME ▮▮▮▯ ◀` + `CORE ●●○`; сгоревший — `N -- burned --` цветом
  `theme.burned`. (Рендер строк — G8; здесь только текст и цвет.)
- `performCommand`: пока `undefined` для всего (G3/G4 добавят).

## Тесты (`tests/rig.test.ts`) — все на ASCII-фикстурах и `newGame`

- Стартовый набор: 5 модулей + 1 пустой, статы игрока = derived.
- Атака → exposed = cutter; удар от монстра уменьшает cutter, core не тронут.
- Шаг → exposed = thrusters. Ждать → plating. Нелегальный шаг (в стену) **не** меняет exposed.
- Перелив: cutter 1, удар 3 → cutter сгорел, plating −2.
- Без plating и без exposed → core −N; core 0 → `game.status === "dead"`.
- Сгорание сканера → `player.fovRadius === 3` и `game.level.visible` реально сжалось.
- Сгорание thrusters → speed 50: за 2 хода монстра speed 100 игрок делает 1 (проверить через
  `schedule.time`).
- `precise` бьёт самый битый; `burst` по 1 всем, core 0 урона.
- `replay(seed, inputs, { content, twist: RIG })` из 200 случайных команд даёт тот же `rig`.
- Урон по монстрам через хук не проходит (их hp падает как раньше).

## Критерии приёмки

`npm test` зелёный; `balance.test.ts` может стать хуже по глубине — это ожидаемо, порогов не
трогать, если они не падают; если падают — записать в статусе, не править.
