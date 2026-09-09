# G11 — Robustness: fuzz, оверлей ошибки, реплеи

Статус: done · Зависит от: E7, G10 · Блокирует: G13 · Оценка: 2–3 ч · Пакет: `games/fortnight2`

Сделано на ветке `task/robustness`: три дефекта лога починены (`packages/engine/tests/log.test.ts`),
оверлей `SOMETHING BROKE` в `ui/app.ts` + `ui/render.ts`, `tests/fuzz.test.ts`,
`tests/replay.test.ts` с фикстурами в `tests/fixtures/`, `tests/purity.test.ts`.
Safari не проверен: `do JavaScript` из Apple Events выключен в настройках браузера.

## Что сделать

1. `tests/fuzz.test.ts`: `fuzz({ seeds: seedRange(900000, 200), steps: 500, game })` → `[]`;
   на падении печатать `describeFailure` для каждого. Таймаут 300 с.
2. `ui/app.ts`: `try/catch` вокруг `playerCommand` и `redraw`; на исключение — оверлей
   `SOMETHING BROKE` с `seed`, числом ходов и `URL с ?seed=` + строка «copy this URL and report
   it»; игра не продолжается (permadeath честнее, чем сломанное состояние), `shift+R` работает.
   `window.onerror` тоже туда.
3. `tests/replay.test.ts`: три записанных забега (`inputs` от `careful` на фиксированных сидах,
   сохранённых как JSON в `tests/fixtures/`) воспроизводятся в тот же `status/depth/turn/rig`.
   Это защита от случайной недетерминированности в любой поздней правке.
4. Проверка `grep -rn "Math.random\|Date.now" packages/engine/src/sim games/fortnight2/src/content
   games/fortnight2/src/twist games/fortnight2/src/systems` — пусто (тест на это:
   `tests/purity.test.ts` читает файлы через `fs` — только в тесте, не в sim).
5. Ручная проверка: Chrome, Firefox, Safari; 10 забегов, консоль без ошибок.

## Два дефекта лога из ручной прогонки G9 (день 3) — чинить здесь, в движке

1. `packages/engine/src/sim/actions.ts` (`doAttack`): строка `"<actor> hits <victim> for <res.damage>."`
   печатает урон **после** перехвата твистом — для игрока это почти всегда `the scout hits You for 0.`,
   и она дублирует строку рига `The scout hits your THRUSTERS (2/3).` Фикс: писать эту строку
   только при `res.damage > 0` **или** при `res.intercepted === 0` (монстры без твиста как раньше);
   факт удара по игроку с перехватом сообщает `onDamage`. Тест на фикстуре: после удара по дрону
   в логе нет `for 0`.
2. `actions.ts`: `"<label> dies."` при `label()` = `"You"` даёт `You dies.` и дублирует
   `deathLine` из `game.ts`. Фикс: для игрока строку не писать (её говорит `deathLine`), для
   монстров — как есть. Тест: при смерти игрока в логе ровно одна строка о смерти.
3. Там же: `"You hits the scout for 3."` — `label()` возвращает `You`, а глагол в 3-м лице. Фикс: `hits` → `hit` для игрока (одна ветка), тест на строку лога после бампа игрока.
