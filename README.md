# cosmo_roga

Общая папка на двоих. Каждый складывает своё в свою половину и ничего не правит
в чужой — так две ветки работы видно рядом, и ни одна не перетирает другую.

| папка | что там | чьё |
|---|---|---|
| [`smoreg_works/`](smoreg_works/) | **SALVOR** — монорепо: движок, игра для джема, музыка, тесты | smoreg |
| [`vuvko_works/`](vuvko_works/) | генератор дек-планов, карта-граф и разбор источников с лицензиями | vuvko |

## smoreg_works

Рабочее монорепо целиком, как оно лежит в разработке.

- `packages/engine` — ядро: два мира (сетка и граф отсеков), генераторы, тестовые боты
- `packages/audio` — адаптивная музыка и звук
- `games/salvor` — заявка на джем: контент, интерфейс, три вида экрана (ASCII, веб, соты)
- `games/fortnight2` — заморожена, предыдущая заявка
- `experiments/hullforms` — песочница: двадцать силуэтов корпусов и генератор отсеков по контуру
- `docs/` — дизайн-документ, ADR, задачи, очередь замечаний владельца

Запуск: `npm install`, `npm run dev`. Проверка: `npm test` (1905 тестов), `npm run typecheck`.

Живая сборка: **https://smoreg.dev/salvor/** — `?view=web` графический вид, `?view=hex` соты,
`?seed=N` конкретный забег, `?training=1` обучение.

## vuvko_works

`shipyard.html` (генератор дек-планов), `navmap.html` (навигационный граф),
`shipgen.py`, и разбор источников — `open-licensed.md`, `restricted.md`,
`ATTRIBUTION.md`, `design-notes-connectivity.md`.

Добавлено: `geomorphs.html` — сборщик палубных планов и корпусов из тайлов
RPG Mobius Geomorphs (CC BY-NC 4.0). Рядом:

- `fetch_geomorphs.py` — качает архивы с rpgmobius.com и gurpsland.no-ip.org,
  распаковывает и сразу строит опись и таксономию;
- `geomorph_manifest.py` — опись PNG-файлов;
- `geomorph_taxonomy.py` — читает альфа-канал каждого тайла и определяет, какие
  его стороны обшивка, а какие стыкуются с соседом; результат в
  `tiles.taxonomy.json` (метаданные, графики там нет, поэтому файл в репозитории);
- `geomorphs-atlas.html` — атлас всех тайлов с разметкой сторон, чтобы
  классификацию можно было проверить глазами.

Сама графика не лежит в репозитории — она под CC BY-NC, и авторы просят её не
перепаковывать. Разворачивается одной командой:

```
cd vuvko_works && python3 fetch_geomorphs.py && python3 -m http.server
# дальше http://localhost:8000/geomorphs.html
```

Скрипт качает архивы с rpgmobius.com, распаковывает в `vuvko_works/geomorphs/`
(она в .gitignore), строит опись и таксономию. `--adventure` добавляет набор
корабельных деталей Adventure Class, `--check` только проверяет ссылки.
