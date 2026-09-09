# E2 — Команды `use` / `interact` через Twist

Статус: done (2026-09-03) · Зависит от: — · Блокирует: G2, G3, G4 · Оценка: 2 ч · Пакет: `packages/engine`

Иначе, чем в задаче: `tests/spawn-save.test.ts` править не пришлось — он нигде не зашивает версию 1, а `SAVE_VERSION - 1` под версией 2 проверяет ровно то же самое.

## Зачем

У игрока появляются действия, которых движок не знает: разобрать обломки, импульс сканера,
сварка. Движок должен уметь принять чужую команду, отдать её твисту и правильно взять за неё
ход — или **не взять**, если она нелегальна (инвариант «нелегальный ход не тратит ход»).

## Что сделать

1. `sim/actions.ts`: расширить `Command`:
   ```ts
   | { kind: "use"; slot: number; target?: Point }   // slot: 0-based
   | { kind: "interact" }                              // act on own tile / adjacent thing
   ```
2. `sim/twist.ts`: хук
   ```ts
   /**
    * Handle a command the engine does not know (`use`, `interact`). Return
    * undefined to say "not mine"; the next system is asked. If nobody claims
    * it, the command is refused and the turn is not spent.
    */
   performCommand?(game: Game, actor: Entity, cmd: Command): Outcome | undefined;
   ```
3. `perform()` для `use`/`interact`: опросить `game.systems` по порядку, вернуть первый
   не-`undefined` `Outcome`; иначе `FAIL("Nothing to do.")`.
4. `Game.playerCommand`: шум для новых команд — 0 по умолчанию (система сама вызовет
   `game.makeNoise`, если действие громкое). Проверить, что `inputs.push(cmd)` и `replay`
   работают с новыми `kind`.
5. `sim/save.ts`: `isCommand` должен принимать новые команды (`slot` — целое ≥ 0, `target` —
   точка или отсутствует). Поднять `SAVE_VERSION` до 2.
6. `testing/bots.ts`: `randomBot` иногда (1 из 12) выдаёт `{kind:"interact"}` и
   `{kind:"use", slot: rng.int(0,5)}` — чтобы fuzz покрывал новые пути.

## Файлы

`sim/actions.ts`, `sim/twist.ts`, `sim/game.ts`, `sim/save.ts`, `testing/bots.ts`,
`tests/commands.test.ts` (новый), правка `tests/spawn-save.test.ts` под версию 2.

## Тесты

- `use` без системы-владельца → `ok:false`, `schedule.time` не изменился, `inputs` пуст.
- Система, вернувшая `{ok:true,cost:100}` → ход потрачен, `inputs` содержит команду.
- Две системы: первая вернула `undefined`, вторая взяла — вызвана именно она.
- `replay(seed, [use, interact, move...])` даёт тот же `schedule.time` и позицию, что живая игра.
- `decodeRun` принимает `use`/`interact`, отвергает `use` с `slot: -1` и `slot: "a"`.

## Критерии приёмки

`npm test`, `npm run typecheck` зелёные. Существующие команды не изменили поведения.

## Чего не делать

Не добавлять в движок предметы на полу и подбор — это делает игра поверх `interact`.
