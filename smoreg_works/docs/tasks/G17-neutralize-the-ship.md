# G17 — Обезвредить корабль: три системы, работа, эвакуация, победа по системам или по шлюзу

Статус: done 4.09 · Зависит от: G14, G36 · Блокирует: G25, G26, G38 · Оценка: 3 ч · Пакет:
`games/salvor`. Иначе, чем в задаче: `turns`/`noise` лежат в строке `ObjectiveJob`, а не полями
`ObjectiveSpec` (у терминала таких строк две — SPIKE и ключ-карта); прогон `careful`-бота на
32 сидах оставлен E14, здесь вместо него сквозной тест на сгенерированном грузовике, 8 сидов.

## Зачем

Новое условие победы и ответ на «в чём его итоговая суть?»: запустить двигатель, ядро, терминал.
В v3 система — предмет в отсеке, работа — действие из списка. Задача также держит **fallback
гейта**: пока нет рейса (G26), `leave` через `a1` с тремя поднятыми системами — победа, а без
описанных систем — победа по `leave` вообще (аналог «люка последней палубы»).

## Что сделать

1. `content/objectives.ts` — три системы данными по таблице GDD «Обезвредить корабль»:
   ```ts
   export type ObjectiveId = "engine" | "core" | "terminal";
   export interface ObjectiveSpec { id; glyph: "E" | "O" | "T"; kind: string; needs(rig, keys): { tool: ModuleId | "key" } | undefined;
     turns: number; noise: number; onlineLine: string; advance: number }
   ```
2. `systems/ship.ts` — система `SHIP` с `claimsOutcome: true`:
   - состояние в `currentShip.data.ship: { online: ObjectiveId[]; work?: { id; left; tool } }`;
   - `performCommand` для `act work {system}`: система в отсеке дрона, не поднята, `needs` даёт
     инструмент — иначе отказ без хода; работа `turns` ходов подряд, каждый ход шум и `expose`
     инструмента (ключ — PLATING, ключ тратится на первом ходу); другая команда сбрасывает
     (`You break off the splice.`); готово → `online.push`, `raiseAlert` дважды, аванс 15 CR
     (`credit` из G26; до него — `player.data.loot`), строка из спеки;
   - `offerActions`: `work <SYSTEM> (<tool>, N turns)` с `enabled`/`why`;
   - `beforeLevelLeave(game, _, "airlock")`: если `online.length === 3` → `finish("won",
     "…")`; иначе, если систем на корабле нет вовсе (`objectives: []` в спеке) → `finish("won")`
     (fallback v1); иначе → `game.travelTo("tug", …)` — до G19 «буксир» — корабль из одного
     отсека без действий, с одной дверью `a1` обратно (заглушка здесь же, G19 заменит);
   - гибель дрона: `finish("dead", deathLine)` — до G26.
   - `panelLines`: `SHIP  engine ✓ core · term ·`.
3. Марки `E`/`O`/`T` из `populate` (G36) → предметы `room.data.systems`; здесь только чтение.

## Файлы

`games/salvor/src/content/objectives.ts`, `src/systems/ship.ts`, `src/game.ts` (`SHIP` в
`systems`), `tests/ship.test.ts`.

## Тесты

- Работа требует инструмента: без CELL ядро отказывает и ход не тратится; с ключом терминал —
  1 ход, ключ −1; со SPIKE — 2 хода.
- Ровно `turns` ходов подряд; прерывание сбрасывает; каждый ход EXPOSED — инструмент.
- Каждая система: +2 тревоги, аванс, строка — один раз; повторный `work` — отказ.
- Три системы + `leave` → `won`; три системы + гибель → `dead`, `online` сохранён в дереликте
  (`travelTo` обратно показывает `✓`).
- Спека без систем: `leave` → `won` (регресс гейта).
- `careful`-бот (E14) на 32 сидах первого грузовика: побеждает ≥ 1 раз — это **проверка гейта
  v3-core**; печатать таблицу `runBatch` в статус.

## Чего не делать

Экран «контракт выполнен», кат-сцена продажи. Ни одной строки про деньги, кроме вызова
`credit`.
