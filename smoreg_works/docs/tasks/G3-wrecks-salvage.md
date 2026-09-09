# G3 — Обломки и разбор

Статус: done · Зависит от: G2, E3 · Блокирует: G5, G10 · Оценка: 2–3 ч · Пакет: `games/fortnight2`

## Что сделать

1. `MonsterKind` в игре получает поле через `tags`? Нет — расширить тип **в игре**:
   `src/content/monsters.ts` объявляет `interface Machine extends MonsterKind { salvage: ModuleId }`
   и хранит таблицу `MACHINES: Machine[]`; в пак отдаётся как `MonsterKind[]`. Твист находит
   `salvage` по `entity.name` → `MACHINES.find(...)`. (Движок о `salvage` не знает.)
2. `src/twist/rig.ts`: состояние палубы `wrecks: Map<string, { kind: ModuleId; integrity: number }>`
   ключ `"x,y"`; живёт в `player.data.wrecks`? Нет — обломки принадлежат палубе: хранить в
   модуле твиста как `WeakMap<Game, ...>`-подобное поле на `game`… у `Game` нет места. Решение:
   `game.flags` не подходит. Хранить в `player.data.deck = { wrecks: [...] }` и очищать в
   `beforeLevelLeave`. Простое и сериализуемое.
3. `onDeath(game, victim)`: если у машины есть `salvage` — обломки на `victim.pos` с
   `integrity: game.rng.int(1, 2)`; на одной клетке — не больше одних обломков (новые заменяют).
   Лог: `The security unit collapses into scrap.`
4. `performCommand` для `{kind:"interact"}`: обломки под игроком, иначе — единственные
   соседние (если соседних несколько — ближайшие по индексу чтения, без выбора). Нет обломков →
   `undefined`. Нет пустого слота → `{ok:false, reason:"No free slot. Something has to burn first."}`.
   Успех: `install`, обломки удалены, лог `You pull a SCANNER (2/2) from the wreck.`, `cost 100`,
   exposed = plating.
5. `overlayGlyphs`: `%` цветом модуля, `remembered: true`.
6. Метка `X` в вольтах (ящик запчастей) — тоже обломки, но `integrity` полная и глиф `X`;
   расставляет G7, здесь — функция `addWreck(game, pos, kind, integrity, glyph)`.

## Тесты (`tests/salvage.test.ts`)

- Убийство машины оставляет обломки с модулем из её `salvage` и прочностью 1–2.
- `interact` без обломков → ход не потрачен. С обломками и без пустого слота → ход не
  потрачен, причина в логе.
- С пустым слотом → слот занят, обломки исчезли, ход потрачен, exposed = plating.
- Обломки не переживают спуск.
- Реплей с разбором детерминирован.
