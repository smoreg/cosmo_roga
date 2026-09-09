# G1 — Снести фэнтези-контент, поставить дрон, палитру, имя

Статус: done, 2026-09-03 · monsterBudget(1) = 0, не 2 — CORE 3 против даже одной машины даёт видимый % смертей автопилота на 30 сидах, а `winnable.test.ts` требует нуля; из-за этого же `balance.test.ts` красный (random.stuck = 100 % — без монстров боту не от чего умереть и не по чему угадать лестницу). · Зависит от: — · Блокирует: G2, G6 · Оценка: 1–2 ч · Пакет: `games/fortnight2`

## Что сделать

1. `src/content/pack.ts`: `name: "SALVOR"`, `maxDepth: 6`,
   `openingLine: "Docking clamps release. The station is dark. You are the only thing still running."`
2. `src/content/player.ts`: `name: "drone"`, `ch: "@"`, `hp: 3, hpMax: 3` (это CORE),
   `damage: [1, 1, 0]` (таран; резак выставит своё в G2), `defense: 0`, `speed: 100`,
   `fovRadius: 8`, `tags: []`. Экспорт констант `CORE_HP = 3`.
3. `src/content/monsters.ts`: удалить бестиарий целиком, оставить **одну** временную машину
   `m maintenance bot` из таблицы GDD (hp 4, 1d2, speed 80, fov 5, brute, 1–6, weight 10) —
   G5 заменит таблицу. `monsterBudget = 4 + Math.floor(depth * 1.5)`.
4. `src/content/vaults.ts`: удалить `SHRINE`/`CACHE`; оставить пустой `VAULTS: readonly Vault[] = []`
   и `vaultsPerLevel: 0` в паке (storylets придут в G7 через DeckBuilder).
5. `src/ui/theme.ts`: палитра из GDD (раздел «Интерфейс»): `bg #0a0d10`, `fg #b9c4cc`,
   `accent #e0a458`, `burned #4a3a3a`, `zone #6f8a9a`, good/bad/warn оставить в холодных тонах.
   `LAYOUT.sidebarWidth: 26`.
6. `index.html`: `<title>SALVOR</title>`, фон = `theme.bg`. `src/ui/render.ts`: строка заголовка
   панели — `SALVOR`; тексты смерти/победы из GDD («CORE BREACH» / «STATION SILENCED»).
7. `Game.descend()` в движке пишет «You break through the last floor…» — это движок; сделать
   `ContentPack.winLine?: string` и `ContentPack.deathLine?: string` (движок, две строки в
   `kinds.ts` и `game.ts`) и задать их в паке. Это единственное касание `packages/` в задаче.
8. `README.md` игры (создать `games/fortnight2/README.md`): питч из GDD, управление, `?seed=`.

## Тесты

- Обновить `tests/game.test.ts`/`systems.test.ts`, если они ссылались на старых монстров.
- `npm test` зелёный: `balance.test.ts` и `winnable.test.ts` должны проходить с одной машиной
  и CORE 3 — если `winnable` падает по «autopilot died on depth 1 on every seed», ослабить
  бюджет палубы 1 до 2 машин (`monsterBudget(1) = 2`), а не порог теста.

## Чего не делать

Не добавлять модули, тревогу, зоны — только вычистить и переименовать.
