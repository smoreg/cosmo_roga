# E1 — Хук перехвата урона в Twist

Статус: done (2026-09-03) · Зависит от: — · Блокирует: G2 · Оценка: 2–3 ч · Пакет: `packages/engine`

Иначе, чем в задаче: прежний путь «щиты → hp» вынесен в `applyDamage(victim, raw)` в `damage.ts`, чтобы `attack` без sink не держал собственное `hp -=`.

## Зачем

Главная механика игры перехватывает урон до того, как он дойдёт до HP, и направляет его в
модули. Сейчас урон попадает в `hp` в двух местах напрямую: `sim/combat.ts` (`attack`) и
`sim/effects.ts` (`case "damage"`), и ни одно из них не видит `game.systems`. Нужен один
общий путь и один необязательный хук.

## Что сделать

1. В `sim/twist.ts` добавить в интерфейс `Twist`:
   ```ts
   /**
    * Intercept damage before it reaches hit points. Return how much still goes
    * to `victim.hp`. Runs for every system in order; each sees what the
    * previous one let through. Absent = everything goes through.
    */
   onDamage?(game: Game, victim: Entity, amount: number, source: Entity | undefined): number;
   ```
2. Новый модуль `sim/damage.ts` с одной функцией:
   ```ts
   export function dealDamage(game: Game, victim: Entity, raw: number, source?: Entity): DamageResult
   // DamageResult: { toHp: number; absorbed: number; intercepted: number; killed: boolean }
   ```
   Порядок: `onDamage` всех систем → `absorbDamage` (щиты статусов) → `hp`. `intercepted` =
   сколько забрали системы, `absorbed` = сколько забрали статусы. При `hp <= 0` — `alive=false`,
   `killed=true`. Смерть *не* логировать здесь: логируют вызывающие (как сейчас).
3. `combat.attack(attacker, victim, rng)` сейчас не знает `game`. Добавить перегрузку/параметр:
   `attack(attacker, victim, rng, sink?: (victim, raw) => DamageResult)`. Без `sink` — прежнее
   поведение (тесты `effects-items.test.ts`, `systems.test.ts` используют трёхаргументную форму).
   `actions.doAttack` передаёт `sink = (v, raw) => dealDamage(game, v, raw, actor)`.
   В `AttackResult` добавить поле `intercepted`.
4. `effects.ts`: в `EffectContext` добавить необязательное
   `damage?(target: Entity, raw: number, source?: Entity): DamageResult`. `case "damage"`
   использует его, если есть; иначе прежний путь через `absorbDamage`. Логировать `intercepted`
   отдельной строкой не нужно — это делает система в своём хуке.
5. Экспортировать `dealDamage` и `DamageResult` из `src/index.ts`.

## Файлы

`sim/twist.ts`, `sim/damage.ts` (новый), `sim/combat.ts`, `sim/actions.ts`, `sim/effects.ts`,
`src/index.ts`, `tests/damage.test.ts` (новый).

## Тесты (обязательно)

- Без систем `dealDamage` эквивалентен старому пути: щит поглощает, остаток в hp, `killed`.
- Система, возвращающая `0`, полностью защищает: hp не меняется, `intercepted === raw`.
- Две системы: вторая видит остаток от первой (`[5 → 3 → 1]`, hp −1).
- Бамп-атака игрока через `game.playerCommand({kind:"attack"})` проходит через хук
  (фикстура `fromAscii(["#####","#@m.#","#####"])`, монстр из `dummycontent`).
- Урон от `applyEffects` с `ctx.damage` — тоже через хук; без `ctx.damage` — как раньше.
- Все существующие тесты зелёные без правок.

## Критерии приёмки

`npm test`, `npm run typecheck` зелёные; `grep -rn "hp -=" packages/engine/src/sim` даёт только
`damage.ts` и `status.ts` (тик статусов остаётся как есть — он не «урон от атаки»).

## Чего не делать

Не менять формулу защиты, не трогать `status.ts`, не добавлять понятие «модуль» в движок.
