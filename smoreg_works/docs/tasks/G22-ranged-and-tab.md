# G22 — Автоисследование `o` и `Tab` / `Shift+Tab` по графу

Статус: done (4.09) — стоп «предметы в отсеке» считается по всем пяти корзинам `room.data`
(обломки, трупы, ящики, вещи, системы), а не только по обломкам; `engage` при известной, но
недостижимой машине говорит `No way through.` вместо шага. · Зависит от: G35, G37 ·
Блокирует: G38, G30 · Оценка: 3 ч · Пакет: `games/salvor/src/ui`

## Зачем

Две клавиши, без которых голосующий бросает игру на втором отсеке. Правило владельца для
`Tab` — дословно в GDD («`Tab` — сблизиться и ударить»); автоисследование — по отсекам, со
стоп-листом, где каждый стоп — момент, когда появилось решение.

## Что сделать

1. `ui/auto.ts` — `makeExplorer()` со `step(game): AutoResult`:
   - стоп до шага: видна машина (в отсеке или сквозь открытую дверь) → `You see the scrapper
     in HAB.`; в текущем отсеке есть предметы, которых не было при входе (снимок при первом
     шаге, как сейчас) → `Something here: a parts crate.`; урон (`durability` упал) → `Something
     is hitting you.`; тревога выросла → `Alert rising.`;
   - шаг: `exploreTarget(ship, room, passableForPlayer)` → `go`; `undefined` и `blockedBy` не
     пуст → `Everything left is behind d3 (locked).`; пуст → `Ship explored. The airlock is N
     doors back.` и один шаг к `a1` (как «шаг к люку» сейчас);
   - `passableForPlayer`: `open`/`closed`/`broken`; `locked`/`sealed` — нет (автоисследование
     не режет двери за игрока).
2. `engage(game, mode: "best" | "melee"): AutoResult`: по GDD — `best`: EMITTER цел и цель по
   `canSee` → `act shoot`; иначе машина в отсеке → `attack` по первой в списке отсека; иначе
   ближайшая известная машина (`room.data.snapshot` и видимые) → `go` через `nextDoor`; никого
   → `No target in sight.` без хода. `melee`: никогда не стреляет; без ближнего оружия — как
   `best`.
3. `app.ts`: эффекты `explore`/`fight` уже есть (G37); `Shift+Tab` — `preventDefault`.
4. `KEY_HELP`: строки `EXPLORE o` и `ENGAGE tab / shift+tab`.

## Файлы

`games/salvor/src/ui/auto.ts`, `src/ui/input.ts` (две строки справки), `tests/auto.test.ts`.

## Тесты (на `shipFromText`)

- Каждый стоп из списка — отдельный тест; шаг ведёт в ближайший неразведанный; запертая дверь —
  стоп с её подписью; всё разведано — шаг к `a1` и стоп.
- Детерминизм: команды, выданные исследованием, реплеятся бит-в-бит.
- `engage`: EMITTER + цель за открытой дверью → выстрел; без EMITTER → `go` к ней; в отсеке →
  `attack`; `melee` при возможном выстреле → сближение; GHOST → выстрел; никого → без хода.
- EXPOSED после `Tab`-выстрела — EMITTER, после `Shift+Tab` — CUTTER/THRUSTERS.

## Чего не делать

Курсор, цикл целей, автоповтор до смерти. Автоисследование не открывает запертое и не
прячется.
