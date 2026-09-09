# G31 — Схема корабля: `schematicLines` и пакет `games/salvor`

Статус: done (3.09) · Зависит от: — (E20 даёт настоящую раскладку, но схема рисует по
`col`/`row` и не зависит от того, кто их посчитал) · Блокирует: G37 · Оценка: 4 ч ·
Пакет: `games/salvor` (новый)

Иначе, чем в задаче: `schematic-input.ts` не написан (E17 не был в `main` — остаётся за G37);
эталон макета собран из 10 отсеков, не 12 (счётчик GDD говорит «» 2 rooms», 8 нарисованных + 2
за обрывами), и один символ макета исправлен — правый порт r8 `┤` → `├`; список `omitted`
отдаёт `schematic()`, `schematicLines()` осталась с подписью из задачи.

## Зачем

Главный экран v3 — схема корабля по образцу Duskers (`docs/design-doc.md`, «Экран»,
`docs/feedback/2026-09-03-duskers-schematic.png`). Это чистая функция «данные → 34 строки по 66
символов», как `deckMapLines` сейчас, и её можно написать и покрыть до того, как существует
`RoomGame`: вход — собственный маленький тип, не движковый. Заодно эта задача создаёт пакет
`games/salvor`, в который всё остальное v3 будет добавлять файлы.

## Что сделать

1. `npm run new-game -- salvor "SALVOR"`, `npm install`. Из шаблона остаются `package.json`,
   `index.html` (`<title>SALVOR</title>`), `vite.config.ts`, `tsconfig.json`; `src/content/*`,
   `src/ui/app.ts`, `src/main.ts`, `tests/smoke.test.ts` шаблона — **удалить**: их напишут G35,
   G36, G37. Корневые `dev`/`build`/`zip` **не** переключать (это G38).
2. `games/salvor/src/ui/theme.ts`: копия из `fortnight2` с `LAYOUT { mapWidth: 66, mapHeight:
   34, sidebarWidth: 29, logHeight: 7, fontSize: 18 }`, плюс `hull: "#8a3a3a"`, `door: {...}`
   по состояниям.
3. `games/salvor/src/ui/schematic.ts` — `schematicLines(input: SchematicInput, viewport?):
   SchematicLine[]` где
   ```ts
   interface SchematicInput {
     rooms: Array<{ id: number; label: string; name: string; col: number; row: number;
                    state: "unknown" | "scanned" | "explored" | "visible" | "current"; glyphs: string }>;
     doors: Array<{ label: string; a: number; b: number; state: DoorState; portA: 0 | 1; portB: 0 | 1 }>;
     tug?: { at: number };                 // room the tug is docked to
     shipLine: string;                     // "KESTREL · freighter · 12 rooms · 5 seen"
   }
   type SchematicLine = { text: string; spans?: Array<{ from: number; to: number; fg: string }> };
   ```
   Геометрия — раздел «Экран» GDD, буквально: коробка 9×4, `x = 9 + 13·col`, `y = 1 + 5·row`,
   метка двери 4 символа у левого отсека, провод `│` + `└──`/`┌──`, петли вертикально с меткой
   посередине, окно 4 колонки × 6 строк с прокруткой к текущей колонке, обрывы `─d10─»`, счётчик
   `» N rooms`, линия корпуса в колонке 64, `shipLine` в строке 33. Двойная рамка у `current`,
   пунктир у `unknown`. Цвет — через `spans`, не через `%c{}` внутри текста, чтобы тесты
   сравнивали чистый текст.
4. `games/salvor/src/ui/schematic-input.ts` — `schematicInputOf(game: RoomGame): SchematicInput`
   — единственное место, где схема встречается с движком; **пишется здесь как подпись и один
   тест на `shipFromText`**, если E17 уже смержен к моменту работы, иначе остаётся в G37.
5. Тесты копируют макет из GDD как ожидаемую строку (`tests/schematic.test.ts` держит эталон в
   виде массива строк).

## Файлы

`games/salvor/package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`,
`games/salvor/src/ui/theme.ts`, `src/ui/schematic.ts`, `src/ui/schematic-input.ts`,
`games/salvor/tests/schematic.test.ts`, корневой `package.json` (только `workspaces`, если
`new-game` его не добавил сам).

## Тесты

- Макет GDD воспроизводится побайтно из соответствующего `SchematicInput` (12 отсеков, 11
  дверей, буксир, два обрыва).
- Всегда ровно 34 строки, каждая ≤ 66 символов (property на случайных входах: 1–25 отсеков,
  `col` 0–6, `row` 0–5, любые состояния).
- Текущий отсек всегда в окне; при `col ≥ 4` окно сдвинуто, левые колонки заменены `«`.
- Двери с двумя портами на одну сторону в разные стороны рисуются обе; две в одну сторону —
  рисуется одна, вторая возвращается в `omitted: string[]` (для строки в панели).
- Подпись двери на схеме — та же строка, что `door.label`.
- Нет ни одного обращения к DOM/`rot-js` (тест `purity` в G33; здесь — `grep` в критериях).

## Чего не делать

Не рисовать карту отсека внутри коробки. Не заводить второй экран «большая карта». Не тянуть
`RoomGame` в `schematic.ts` — только в `schematic-input.ts`.
