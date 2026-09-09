# E3 — Расширение API Twist: панель, флаги забега, `Entity.data`, remembered-глифы

Статус: done (2026-09-03) · Зависит от: — · Блокирует: G2, G3, E6 · Оценка: 1–2 ч · Пакет: `packages/engine`

Иначе, чем в задаче: агрегатора `panelLines` на `Game` нет — UI уже собирает хуки через `game.systems.flatMap`, как в `render.ts`; плюс сюда же уехали `winLine`/`deathLine` из G1.

## Зачем

Твисту нужно: рисовать несколько строк в панели (сейчас `statusLine` — одна), хранить
собственное состояние на сущности (модули дрона), помечать обломки так, чтобы они рисовались
и на запомненных клетках, и оставлять флаги забега для storylets.

## Что сделать

1. `sim/entity.ts`: поле
   ```ts
   /** Free-form bag for a twist's own per-entity state. Plain data only. */
   data?: Record<string, unknown>;
   ```
   `makeEntity` не обязан его создавать.
2. `sim/twist.ts`:
   ```ts
   /** Several sidebar lines. Preferred over statusLine when the twist has real state. */
   panelLines?(game: Game): Array<{ text: string; fg?: string }>;
   ```
   `overlayGlyphs` возвращает `{ x, y, ch, fg, remembered?: boolean }` — с `remembered: true`
   рендер рисует глиф и на исследованной-но-невидимой клетке (тусклым). Это только тип: рендер
   в игре, задача G8.
3. `sim/game.ts`: `readonly flags = new Set<string>()` — флаги забега, переживают смену палубы.
   Пробросить в `generateLevel` через `MapgenOptions`/`BuildContext` — **это делает E6**, здесь
   только само поле и его сброс в конструкторе.
4. `Twist.onLevelEnter` уже есть; добавить `beforeLevelLeave?(game, depth)` — вызывается в
   `descend()` перед `enterDepth`. Нужен системе тревоги для сброса и твисту для очистки
   обломков палубы.
5. Экспорт типов из `index.ts`.

## Тесты

Дополнить `games/fortnight2/tests/systems.test.ts` — нет, это игра. Написать
`packages/engine/tests/twist-api.test.ts`:

- `panelLines` систем собираются в порядке `[twist, ...systems]`.
- `beforeLevelLeave` вызывается ровно один раз на спуск, до `onLevelEnter` новой глубины.
- `game.flags` пуст на старте и сохраняется после `descend()`.
- `entity.data` переживает `descend()` (игрок переносится тем же объектом).

## Критерии приёмки

`npm test`, `npm run typecheck` зелёные; `statusLine` продолжает работать.
