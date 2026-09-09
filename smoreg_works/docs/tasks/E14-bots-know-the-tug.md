# E14 — Боты на графе: random / greedy / careful, метрики и fuzz рейса

Статус: done 3.09 — `Playable` получил необязательные `progress()`/`metrics()`, а сами числа
берутся из `PlayOptions` через адаптер `roomPlay` (у `RoomGame` своих счётчиков нет); имена ботов
в `testing/index.ts` выходят с алиасами `randomRoomBot`/`greedyRoomBot`/`makeCarefulRoomBot`,
иначе они молча затирают сеточные; `RunResult.depth` и `BatchSummary.medianDepth` оставлены как
имена сеточной игры рядом с `progress`/`medianProgress` (их читает `fortnight2`) ·
Зависит от: E18 · Блокирует: G17 (гейт), G30 · Оценка: 3 ч · Пакет: `packages/engine` (`testing/`)

## Зачем

Балансовые пороги и «проходимость» считаются ботами. Сеточные боты ходят по клеткам и ищут
лестницу; графовым нужен свой набор из тех же трёх ролей — и он же гоняет fuzz по `RoomCommand`.
Бот остаётся слабым игроком, не солвером: четыре правила про двери и три про буксир, не больше.

## Что сделать

1. `testing/roombots.ts`:
   - `randomBot`: `wait` / `hide` / случайный `go` по дверям своего отсека (включая
     непроходимые — движок обязан отказать без броска) / `attack` по случайной сущности в
     отсеке / `act` с случайным `verb` из `game.systems.flatMap(offerActions)` **и** с мусорным
     `verb: "zzz"` (1 из 12) / `leave`;
   - `greedyBot`: цель — самый глубокий неразведанный отсек (`RoomDistance` от отсеков с
     `!explored`, проходимость «как у игрока с резаком»); машина в отсеке → `attack`; дверь на
     пути `locked`/`sealed` → первое `enabled` предложение систем с `target === door.id`;
     иначе `go`;
   - `makeCarefulBot()`: сначала `enabled` предложения систем в порядке их списка (это
     `botHints` из сеточных ботов, только через `offerActions`); отступление в соседний отсек при
     `hp / hpMax < 0.4` и машинах в отсеке, не больше 8 подряд; `hide`, если в отсеке укрытие,
     никого нет и `alert`-система предложила `hide`; иначе `greedy`.
2. `Twist.offerActions` (E18) — единственный канал знаний бота об игре: бот не знает слов
   «ключ» или «купить корпус», он жмёт предложенное. Игровые системы (G14, G17, G19, G26)
   обязаны предлагать именно то, что стоит хода.
3. `testing/metrics.ts`: `RunResult` получает `progress` (из `Playable.progress()`) и
   `extra: Record<string, number>` (из `Playable.metrics?.()` — игра отдаст `credits`,
   `shipsSold`, `dronesLost`); `runBatch` печатает медиану `progress` вместо `medianDepth`.
4. `BOTS_ROOMS: Record<string, BotFactory<RoomGame>>`; экспорт из `testing/index.ts`.

## Файлы

`packages/engine/src/testing/roombots.ts`, `testing/metrics.ts`, `testing/index.ts`,
`packages/engine/tests/roombots.test.ts`.

## Тесты

- На `testShip` из `dummyship`: `greedy` за ≤ 60 ходов разведывает все отсеки, достижимые без
  ключа; с системой-заглушкой, предлагающей `act key` у запертой двери, — все.
- `random` за 500 ходов на 50 сидах не роняет игру и хотя бы раз получает отказ (проверка, что
  нелегальное действительно предлагается и отвергается без броска — `inputs` не растёт).
- `careful` не делает больше 8 отступлений подряд; при укрытии и предложении `hide` — прячется.
- Метрики детерминированы по сиду; `progress` растёт монотонно у `greedy` на корабле без машин.

## Чего не делать

Ни одного слова игры в `testing/`. Не учить бота маршрутам конкурента, вирусу, наращиванию.
