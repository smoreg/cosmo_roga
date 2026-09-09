# E7 — Fuzz-хелпер в `testing/`

Статус: done (2026-09-03) · `step` определён как `game.inputs.length` (число принятых команд), а не число попыток — отказанные команды в него не входят, так что `step === 10` и `inputs.length === 10` совпадают на искусственном сбое ровно так, как требует тест.

Зависит от: E2 · Блокирует: G11 · Оценка: 1 ч · Пакет: `packages/engine`

## Что сделать

`testing/fuzz.ts`:
```ts
export interface FuzzOptions { seeds: number[]; steps: number; game: Omit<GameConfig, "seed"> }
export interface FuzzFailure { seed: number; step: number; inputs: Command[]; error: string }
/** Random commands through the real turn cycle; collects (seed, inputs) of every crash. */
export function fuzz(opts: FuzzOptions): FuzzFailure[]
```
Использует `randomBot` (уже выдаёт `use`/`interact` после E2). На исключение — поймать,
записать `game.inputs` до падения и `String(error.stack ?? error)`, продолжить со следующим
сидом. Экспорт из `testing/index.ts`. Функция `describeFailure(f): string` — одна строка для
консоли с сидом и длиной ввода.

## Тесты

`tests/fuzz.test.ts`: на `dummycontent` 50 сидов × 300 шагов → `[]`. Искусственная система,
бросающая на 10-м `afterPlayerTurn`, → ровно по одному `FuzzFailure` на сид с `step === 10`
и `inputs.length === 10`.
