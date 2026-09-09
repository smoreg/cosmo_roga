# G6 — Тревога палубы и подкрепления

Статус: done (кроме `balance.test.ts` — порог `stuck === 0` ужесточается в G10) · Зависит от: G1, E3 · Блокирует: G8, G10 · Оценка: 2–3 ч · Пакет: `games/fortnight2`

## Что сделать

`src/systems/alert.ts` — `ALERT: Twist` (система, не твист), подключается в `newGame` через
`systems: [ALERT]`. Состояние — в `player.data.alert = { level, turnsOnDeck, lastNoiseBump }`.

- `onLevelEnter`: `level = 0`, счётчики в 0. Период: `depth === 1 ? 80 : 40`.
- `afterPlayerTurn`: `turnsOnDeck++`; если `turnsOnDeck % period === 0` → `raise()`.
  Если в `game.noiseField` есть клетка ≥ 8 и с прошлого шумового повышения прошло ≥ 10 ходов →
  `raise()`.
- `raise()`: `level = min(5, level+1)`; спавн одной машины из `content.monstersForDepth(depth)`
  взвешенно, в точке из `spawnSpots(level, player.pos, 10)` (`rng.pick`), `schedule.admit`,
  `entities.push`; лог `Something wakes up in <ZONE NAME>` (зона через `level.zoneAt`; если зон
  нет — `somewhere on the deck`). На уровне 5 — дополнительно каждые 10 ходов.
- `panelLines`: `ALERT ▮▮▯▯▯` (цвет warn при ≥ 3, bad при 5).

## Тесты (`tests/alert.test.ts`)

- 40 ожиданий на палубе 2 → уровень 1 и ровно +1 сущность; палуба 1 — 80.
- Импульс сканера (или `game.makeNoise(…, 9)` через фикстурный `use`) поднимает уровень; второй
  шум через 3 хода — нет.
- Спавн никогда ближе 10 клеток (Чебышёв) и всегда на проходимой свободной клетке (500 повышений
  на случайных сидах).
- Спуск сбрасывает уровень.
- Уровень не превышает 5; на 5 — спавн каждые 10 ходов.
- `careful`-бот на 16 сидах: `stuck === 0` (`balance.test.ts` — ужесточить порог в этой задаче).
