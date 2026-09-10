/**
 * Build the look-at-it page: ten hulls, the twenty masks, and the numbers.
 *
 *     node experiments/hullforms/build-report.mjs ~/reports/salvor-hullforms.html
 */

import { writeFileSync } from "node:fs";
import { SILHOUETTES } from "./silhouettes.mjs";
import { deckFromCells, generateDeck, LOOP_SHARE, MAX_DOORS } from "./generate.mjs";
import { renderDeck, PALETTE } from "./render.mjs";
import { renderHullArt } from "./hullart.mjs";
import { CLASSES, SIZES, cellsInside, fitScale, renderShip, shipForm } from "./shipform.mjs";

/**
 * The ships at the top of the page: every class, two seeds each.
 *
 * This is the drawing the owner asked for — «просто хексы внутри формы
 * корабля» — and it is the only one that starts from a hull rather than from a
 * honeycomb. Two seeds per class because the question a reader has is whether
 * one seed was luck.
 */
// Pinned to the three the owner looked at and approved, not to `CLASSES`: the
// table grew to twenty afterwards, and reading it here silently turned this
// section into a second copy of the gallery below.
const FLEET = ["tug", "tanker", "cruiser"].flatMap((kind) => [
  [kind, 7],
  [kind, 12],
]);

/** Hexagon radius for the ship drawings, in px. */
const SHIP_R = 15;

/** Hexagon radius in the twenty-ship gallery: two to a row, so a little smaller. */
const GALLERY_R = 14;

/** Both seeds every ship in the gallery is drawn on. */
const GALLERY_SEEDS = [7, 12];

const SIZE_LABEL = { small: "малый", medium: "средний", large: "большой" };

/** The three drawn the old way, kept at the bottom as a draft. */
const HEROES = [
  ["tug-hammer", 12, "Буксир: тяжёлая голова с двигателями, тонкая буксирная штанга вперёд, рубка и шлюз на её конце."],
  ["tanker-cigar", 7, "Танкер: гондолы по бортам кормы, коридор по килю насквозь, рубка в носовом обтекателе."],
  ["cruiser-arrow", 3, "Крейсер: масса в корме, узкий нос, гондолы разнесены по краям разлёта."],
];

/** The ten on the page, each with a seed of its own. */
const SHOWN = [
  ["tanker-cigar", 7],
  ["tug-hammer", 12],
  ["cruiser-arrow", 3],
  ["ring-station", 21],
  ["comb-pylons", 5],
  ["catamaran", 9],
  ["hospital-cross", 14],
  ["spoked-wheel", 2],
  ["barge-train", 18],
  ["hex-fort", 6],
];

/** My reading of each form, once drawn. Judgement, not data — hence not in the mask file. */
const VERDICT = {
  "tanker-cigar": ["ship", "Узнаётся мгновенно: длина, симметрия, киль насквозь."],
  boxcar: ["ship", "Коробка и есть коробка — скучно, но читается."],
  "tug-hammer": ["ship", "Рукоять и голова; силуэт из двух масс — самый чистый в наборе."],
  "cruiser-arrow": ["ship", "Нос и отогнутые крылья держатся даже при 16 отсеках."],
  "ring-station": ["ship", "Кольцо ни с чем не спутать, но это станция, а не корабль."],
  "comb-pylons": ["ship", "Хребет с восемью зубцами; форма держится, топология вырождается."],
  catamaran: ["ship", "Два корпуса и перемычка — читается за секунду."],
  "miner-scoop": ["weak", "Ковш распадается на скобу и палку; без подписи не прочитывается."],
  "scout-needle": ["ship", "Игла с утолщением; но это цепочка, а не карта."],
  "hospital-cross": ["ship", "Крест держится идеально, даже при мелких отсеках."],
  trident: ["ship", "Три зубца видно, хотя они и тонкие."],
  "wedge-lander": ["ship", "Клин, сужающийся к носу — самая «корабельная» из компактных."],
  "spoked-wheel": ["ship", "Обод, ступица, спицы; лучший силуэт по топологии."],
  "barge-train": ["ship", "Три секции на сцепках — состав, а не корабль, и это видно."],
  "crab-dredger": ["weak", "Клешни читаются как две антенны; ближе к птице, чем к крабу."],
  "relay-dish": ["weak", "Тарелка выродилась в скобу: дуга из двух клеток слишком тонкая."],
  "y-hauler": ["ship", "Вилка чистая, но отсеков мало — почти схема, не палуба."],
  "hex-fort": ["blob", "Клякса. Правильный шестиугольник — это просто пятно сот."],
  "whale-factory": ["ship", "Брюхо и гребень; на грани — при мелких отсеках уходит в пятно."],
  "drydock-ladder": ["ship", "Решётка с пустотами; узнаётся, но как ферма, а не как корпус."],
};

const LABEL = { ship: "читается", weak: "спорно", blob: "клякса" };

const SEEDS = 30;

const target = process.argv[2] ?? `${process.env.HOME}/reports/salvor-hullforms.html`;
writeFileSync(target, page());
console.log(target);

function page() {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="html-report" content="group Личное; tags salvor, генератор, корпуса">
<meta name="description" content="Двадцать силуэтов корпусов SALVOR и генератор, который раскладывает отсеки по контуру.">
<title>SALVOR · формы корпусов</title>
<style>
:root {
  --bg: ${PALETTE.bg};
  --panel: ${PALETTE.panel};
  --text: ${PALETTE.text};
  --dim: ${PALETTE.dim};
  --accent: ${PALETTE.accent};
  --steel: ${PALETTE.steel};
  --bulkhead: ${PALETTE.bulkhead};
  color-scheme: dark;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2.2rem 1.2rem 5rem;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
main { max-width: 1180px; margin: 0 auto; }
h1 { font-size: 1.7rem; margin: 0 0 .4rem; letter-spacing: .01em; }
h2 { font-size: 1.15rem; margin: 3rem 0 1rem; padding-bottom: .5rem; border-bottom: 1px solid #1b2228; }
h3 { font-size: 1rem; margin: 0 0 .2rem; }
p { margin: 0 0 .9rem; max-width: 74ch; }
.lede { color: var(--steel); }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
code { color: var(--accent); font-size: .92em; }
.warn {
  border-left: 3px solid var(--accent);
  background: var(--panel);
  padding: .8rem 1rem;
  margin: 1.4rem 0;
  border-radius: 0 4px 4px 0;
}
.decks { display: grid; gap: 1.1rem; grid-template-columns: 1fr; }
/* Two ships of a class side by side: the pair is the point, one seed proves nothing. */
@media (min-width: 900px) { .fleet, .gallery { grid-template-columns: 1fr 1fr; } }
.tag.small { color: #8fbf9a; border: 1px solid #2f4a37; }
.tag.medium { color: var(--steel); border: 1px solid #2c3d47; }
.tag.large { color: #c9a3d8; border: 1px solid #43305a; }
.meta b.over { color: var(--accent); }
.pair { display: grid; gap: .8rem; grid-template-columns: 1fr; }
.hero { display: grid; gap: 1rem; grid-template-columns: 1fr; margin-bottom: .8rem; align-items: center; }
@media (min-width: 900px) { .hero { grid-template-columns: 2fr 1fr; } }
@media (min-width: 700px) { .pair { grid-template-columns: 1fr 1fr; } }
figure { margin: 0; }
figcaption { color: var(--dim); font-size: .78rem; letter-spacing: .03em; margin-top: .25rem; }
.deck {
  background: var(--panel);
  border: 1px solid #1b2228;
  border-radius: 6px;
  padding: 1rem 1rem 1.1rem;
}
.deck svg { width: 100%; height: auto; display: block; }
.pair { margin-bottom: .8rem; }
.meta { color: var(--dim); font-size: .85rem; font-family: ui-monospace, Menlo, monospace; }
.meta b { color: var(--steel); font-weight: 600; }
.note { color: var(--steel); font-size: .9rem; margin: .35rem 0 0; }
.tag {
  display: inline-block; font-size: .72rem; letter-spacing: .04em; text-transform: uppercase;
  padding: .1rem .45rem; border-radius: 3px; vertical-align: .12em; margin-left: .4rem;
}
.tag.ship { color: #8fbf9a; border: 1px solid #2f4a37; }
.tag.weak { color: var(--accent); border: 1px solid #4a3a22; }
.tag.blob { color: #c07a6a; border: 1px solid #4a2c26; }
.masks { display: grid; gap: 1rem; grid-template-columns: 1fr; }
@media (min-width: 760px) { .masks { grid-template-columns: 1fr 1fr; } }
.mask { background: var(--panel); border: 1px solid #1b2228; border-radius: 6px; padding: .8rem .9rem; }
.mask pre {
  margin: .5rem 0 0; color: var(--steel); font-size: .78rem; line-height: 1.25;
  overflow-x: auto; white-space: pre;
}
.scroll { overflow-x: auto; }
table { border-collapse: collapse; font-size: .86rem; min-width: 640px; }
th, td { padding: .35rem .7rem; text-align: right; border-bottom: 1px solid #1b2228; }
th:first-child, td:first-child { text-align: left; font-family: ui-monospace, Menlo, monospace; }
th { color: var(--dim); font-weight: 600; }
td.hot { color: var(--accent); }
ul { max-width: 74ch; padding-left: 1.2rem; }
li { margin-bottom: .4rem; }
.legend { display: flex; flex-wrap: wrap; gap: 1.2rem; color: var(--dim); font-size: .85rem; margin: .8rem 0 1.6rem; }
.legend span { display: flex; align-items: center; gap: .4rem; }
.swatch { width: 22px; height: 3px; border-radius: 2px; display: inline-block; }
</style>
</head>
<body>
<main>
<h1>SALVOR · формы корпуса</h1>
<p class="lede">Наверху — <b>соты внутри формы корабля</b>: корпус нарисован сам по себе,
профилем прямых секций, а соты вброшены внутрь. Ниже — эталон читаемости, обычная карта на
решётке. В самом низу — черновик, где корпус, наоборот, обтекал соты.</p>
<p>Генератор чистый во всех трёх случаях: одна и та же пара (корпус, seed) даёт одну и ту же
палубу. Планировка и оформление детерминированы от одного сида, но разными потоками, поэтому
выбор люка никогда не двигает отсек.</p>

<div class="warn">
Это песочница <code>experiments/hullforms/</code>. В игру ничего не встроено и не импортируется:
ни <code>packages/engine</code>, ни <code>games/</code> не тронуты. Геометрия шестиугольников
скопирована из <code>packages/engine/src/rooms/gen/hexlayout.ts</code>, а не подключена.
</div>

<div class="legend">
  <span><i class="swatch" style="background:${PALETTE.steel}"></i> обшивка — внешний контур</span>
  <span><i class="swatch" style="background:${PALETTE.bulkhead}"></i> переборка между отсеками</span>
  <span><i class="swatch" style="background:${PALETTE.accent}"></i> дверь — разрыв в переборке</span>
  <span><i class="swatch" style="background:${PALETTE.dim}"></i> шов между сотами одного отсека</span>
  <span><i class="swatch" style="background:${PALETTE.accent};height:9px;width:9px;border-radius:50%"></i> шлюз</span>
</div>

<div class="warn">
<b>Янтарь теперь только у дверей и шлюза.</b> Раньше тем же цветом были люки, иллюминаторы,
окна рубки и факел двигателя — десяток мелких оранжевых пятен на корпус, среди которых двери
терялись. Всё, что не проход, переведено в сталь. Правило то же, по которому живёт игра:
янтарь значит «здесь требуется решение».
</div>

<h2>Последняя итерация: соты внутри формы корпуса</h2>
<p>Корпус здесь — <b>самостоятельная форма</b>, а не обвод вокруг сот: профиль прямых секций
вдоль оси, отражённый относительно киля. Поэтому у него есть прямой борт и настоящий нос —
того и другого обвод по решётке дать не может, у него все грани под 30° и 60°.</p>
<p>Соты вбрасываются внутрь готовой формы, и остаются те, у которых <b>внутри все шесть
углов</b>. Где сота не влезла — в сужении носа, по углам кормы — остаётся пустое место, и это
разрешено намеренно. Каждый класс показан на двух сидах: секции берут по десятой доле в обе
стороны, поэтому два сида одного класса — два корабля этого класса, а не два разных корабля.</p>
${fleet()}

<p class="note"><b>Что видно по этим шести.</b> Форма корабля решена: прямой борт, настоящий
нос и корма есть, два сида одного класса — два корабля этого класса, а не два разных.
Двери и шлюз читаются с первого взгляда, потому что янтарь больше ни на что не потрачен.
Не решены две вещи, и обе видно тут же. Первая — <b>отсеки</b>: где кончается один и
начинается соседний, глаз разбирает с трудом, разница между переборкой и швом внутри отсека
слишком мала; на эталоне ниже, где переборка отличается цветом, а не толщиной, это читается
сразу. Вторая — <b>пустой поясок</b> в соту по всему периметру: плата за правило «соту берём,
только если внутри все шесть углов». В сужении носа он выглядит замыслом, вдоль прямого борта
— промахом. Тональная лестница (фон → корпус → деталь) и все толщины пока стоят на рабочих
значениях, подобранных по картинке, а не назначенных дизайном.</p>

<h2>Двадцать кораблей-профилей</h2>
<p>Двадцать форм в трёх размерах: <b>малый</b> 6–8 отсеков, <b>средний</b> 10–14,
<b>большой</b> 16–24. Каждый на двух сидах. Форма и размер разведены: профиль говорит, какой
это корабль, размер — сколько его; тот же список секций, нарисованный крупнее, это тот же
корабль с бо́льшим числом комнат. Масштаб под нужную полосу подбирается делением отрезка, а не
руками, — поэтому двадцать форм и три размера это двадцать чисел и три, а не шестьдесят.</p>
<p>Первая версия этого набора состояла из одного тела на корабль, и получились двадцать
сарделек с двигателями. Рядом с картами на решётке ниже это видно сразу: интересны там
катамаран, колесо, крест, гребёнка, кольцо и состав, то есть ровно те корпуса, у которых
<b>несколько тел или дырка</b>. Одна лента прямых секций такого не умеет — она всегда одна
выпуклая масса, — поэтому корпус теперь собирается из <b>нескольких тел</b>, каждое со своим
профилем и смещением, плюс <b>дырки</b>, которые из него вырезаются. Соты укладываются в
объединение тел, обводка идёт по границе этого объединения. Из двадцати классов семь
многотельные или с дыркой.</p>
<p>У секции при этом три числа — длина, полувысота сверху и снизу: асимметрия даёт брюхо
китобоя, ковш рудокопа, вырез стапеля. Одно тело плюс асимметрия — это форма; несколько тел —
это силуэт.</p>
${gallery()}
<p class="note"><b>Читаются с первого взгляда 17 из 20.</b> Силуэт держат все семь
многотельных (катамаран, кольцевая станция, крест, трезубец, состав, вилка, балансир) и
десять однотельных с уступом, асимметрией или резким сужением: игла, катер-молот,
буксир-молот, крейсер-стрела, корвет-гарпун, китобой, стапель, дредноут-клин, ковш,
челнок-клин. Остаются тремя сардельками танкер, веретено и зонд-капля — и это нормально:
сигара обязана быть сигарой. Правило, которое сандбокс подтверждает третий раз подряд:
<b>силуэт держится на двух-трёх массах разного размера</b>, а не на интересной границе. Всё,
что раньше не читалось, не читалось по одной причине — было одной массой.</p>
<p class="note"><b>Что придётся поменять в игре.</b> Числа сняты с этих сорока прогонов и
после перехода на многотельные корпуса не испортились: <b>отсеков на одной глубине максимум
6</b> — ровно потолок <code>MAX_COLUMN</code> в колоночной схеме, ни разу не выше (маски
давали до 8), — и <b>дверей у отсека максимум 4</b> при одном исключении на сорок прогонов
(балкер-состав, seed 7, пятая дверь: генератор открывает её, только чтобы не оставить отсек
недостижимым, и показывает это, а не прячет). То есть топология профильных корпусов в движок
влезает как есть; упирается всё в геометрию.
<b>Путь (а)</b> — отсек это 1–3 соты, профиль на класс корабля: <code>HEX_KEY</code> из одной
пары <code>q,r</code> становится списком сот, а он ходит через JSON сейва и защищён
инвариантом «испорченный сейв не роняет игру»; <code>hexLayout</code> перестаёт быть обходом
в ширину с одной сотой на комнату и становится укладкой полимино внутрь контура; оба рендера
(<code>ui/web/hex-svg.ts</code> и колоночная <code>ui/schematic.ts</code>) переписываются на
«грань между множествами сот»; текстовые фикстуры <code>shipFromText</code> перестают
выражать палубу. Это <b>16–24 часа</b>, и риск не в объёме, а в фикстурах: на них стоят
тесты. <b>Путь (б)</b> — одна сота на отсек, профиль просто обводит уже разложенную решётку:
<code>HEX_KEY</code>, сейвы, фикстуры и <code>hexLayout</code> не трогаются вообще, добавляется
чистая функция «соты → контур» и слой рисунка поверх — это перенос <code>shapes.mjs</code> и
<code>hullart.mjs</code> в TS, <b>6–8 часов</b>. Цена (б) известна и показана внизу этой
страницы: обвод, сшитый из граней сот, прямого борта не имеет — то есть корабли будут
выглядеть как черновик, а не как галерея выше.</p>

<h2>Эталон читаемости: карта на решётке</h2>
<p>Здесь нет никакой картинки корабля — только карта, и по ней видно, до чего должны дотянуть
рисунки выше. Работают четыре уровня: обшивка сталью, переборка между отсеками, шов между
сотами одного отсека вдвое тоньше и бледнее, дверь — разрыв в переборке. Из всех трёх
рисунков в песочнице отсеки читаются пока только на этом.</p>
${cards()}

<h2>Двадцать масок и метрики</h2>
<p>Двадцать масок, из которых всё это растёт, и числа по 30 сидов на форму.</p>

<h2>Как устроен генератор</h2>
<p>Четыре шага, все детерминированные от <code>mulberry32(seed)</code>:</p>
<ul>
<li><b>Разметка.</b> Каждая клетка маски получает класс: борт (касается пустоты), киль
(<code>*</code>), шлюз (<code>@</code>) или нутро.</li>
<li><b>Отсеки.</b> Растут из зёрен по одной–три соты. Первым садится шлюз, затем борт — чтобы
обшивку успели разрезать на мелкие отсеки прежде, чем внутренний отсек дотянется наружу и
съест кусок обвода. Бортовой отсек растёт <i>вдоль</i> борта, килевой — вдоль киля.
Одиночные соты, застрявшие между тремя отсеками, вливаются в самого мелкого соседа.</li>
<li><b>Стыки.</b> Любая пара отсеков, у которых есть общая грань сот, становится кандидатом
в дверь. Только грань — никаких дверей «через отсек».</li>
<li><b>Двери.</b> Обход в ширину от шлюза даёт дерево (не Прим по весам: Прим — это алгоритм
лабиринта, он давал глубину 11 у корпуса в 20 отсеков и ни одной петли). Дальше ${Math.round(LOOP_SHARE * 100)} %
оставшихся стыков открываются петлями, пока у отсека меньше ${MAX_DOORS} дверей. Остальные общие
грани остаются стенами — иначе на палубе из двадцати отсеков было бы полсотни дверей и план
не сказал бы ничего.</li>
</ul>

<h2>Двадцать силуэтов</h2>
<p>Один символ — одна сота: <code>#</code> корпус, <code>*</code> киль, <code>@</code> шлюз,
<code>.</code> пустота. Нечётные строки сдвинуты на пробел, потому что так устроена решётка:
на шестиугольной сетке нечётный ряд стоит на полсоты правее. Что нарисовано в файле, то и
получится на палубе. Соседи по вертикали и горизонтали в тексте всегда касаются на решётке;
диагонали зависят от чётности строки — на них не опираться.</p>
<div class="masks">
${SILHOUETTES.map(maskCard).join("\n")}
</div>

<h2>Что говорят числа</h2>
<p>По ${SEEDS} сидов на форму. «Ширина» — сколько отсеков лежит на одной глубине от шлюза;
это то место, где формы упираются в потолки движка.</p>
<div class="scroll">
<table>
<thead><tr><th>силуэт</th><th>сот</th><th>отсеков</th><th>дверей</th><th>петель</th><th>глубина</th><th>ширина</th><th>&gt;${MAX_DOORS} дверей</th></tr></thead>
<tbody>
${SILHOUETTES.map(statRow).join("\n")}
</tbody>
</table>
</div>

<h2>Черновик: корпус обтекает соты</h2>
<p>Подход, с которого начинали, — оставлен внизу для сравнения. Соты кладутся первыми, обвод
сшивается из их граничных граней, спрямляется и обрастает деталями. Ограничение видно на
любом корпусе: обвод собран из граней решётки, поэтому прямого борта у него нет в принципе.
Спрямление, достаточное чтобы схлопнуть лесенку сот, приходится покупать сдвигом обшивки
наружу — иначе прямая, проведённая по ступенькам, срезает углы у самих сот.</p>
<p>Справа тот же seed без картинки, чтобы было видно, что именно добавляет фон.</p>
${HEROES.map(hero).join("\n")}

<h2>Из чего собран фон черновика</h2>
<ul>
<li><b>Корма — тяжёлый конец, не тот, где шлюз.</b> Сначала было по шлюзу, и буксир получил
двигатели на кончике буксирной штанги. Шлюз теперь разрешает только ничью — её даёт
симметричный корпус вроде танкера.</li>
<li><b>Обшивка</b> — контур маски, сдвинутый наружу на 0,3 соты и спрямлённый Дугласом-Пекером
с допуском 0,46 соты. Скругления нет: оно давало оплывшие кляксы. Двойная линия — толстый
штрих, поверх которого идёт тонкий цветом фона.</li>
<li><b>Шпангоуты и панели</b> — линии поперёк через каждые 1,15 соты плюс два продольных шва;
часть панелей поймала другой свет. Всё обрезано по обшивке, поэтому форма корпуса сама решает,
что куда влезет.</li>
<li><b>Гондолы</b> — на самой широкой колонне у кормы, корнем внутрь корпуса (их рисуют до
обшивки, перекрытие и делает их приросшими), сопло за срезом кормы, факел клином. Узкая корма
получает одну гондолу по оси вместо двух внахлёст.</li>
<li><b>Рубка</b> — блок с тремя окнами у носа; <b>люки</b> — на бортовых сотах;
<b>иллюминаторы</b> — два ряда вдоль киля; <b>антенны и тарелка</b> — только на сотах, у
которых сосед отсутствует сверху или снизу: мачта из носа читается как пробоина.</li>
<li><b>Рамка картинки</b> считается по фактическим границам нарисованного, а не по сотам.
Пока она считалась по сотам с запасом в полторы соты, соплами и факелом жертвовали все
корабли с двигателями: гондола уходит примерно на три соты за корму.</li>
<li><b>Сетка сверху не изменилась</b> от того, что под ней что-то нарисовано.</li>
</ul>

<h2>Честный вывод</h2>
${conclusion()}
</main>
</body>
</html>
`;
}

function hero([id, seed, note]) {
  const sil = SILHOUETTES.find((s) => s.id === id);
  const deck = generateDeck(sil, seed);
  const m = deck.metrics;
  return `<div class="deck">
<div class="hero">
<figure>${renderHullArt(deck, { uid: `art-${id}-${seed}` })}<figcaption>корабль, поверх него хексы</figcaption></figure>
<figure>${renderDeck(deck, { title: sil.name })}<figcaption>тот же seed без корабля</figcaption></figure>
</div>
<h3>${sil.name}</h3>
<p class="meta">seed <b>${seed}</b> · отсеков <b>${m.rooms}</b> · дверей <b>${m.doorCount}</b> · петель <b>${m.loops}</b> · глубина <b>${m.maxDepth}</b></p>
<p class="note">${note}</p>
</div>`;
}

function card([id, seed]) {
  const sil = SILHOUETTES.find((s) => s.id === id);
  const deck = generateDeck(sil, seed);
  const m = deck.metrics;
  const [kind, why] = VERDICT[id];
  return `<div class="deck">
${renderDeck(deck, { title: sil.name })}
<h3>${sil.name}<span class="tag ${kind}">${LABEL[kind]}</span></h3>
<p class="meta">seed <b>${seed}</b> · отсеков <b>${m.rooms}</b> · дверей <b>${m.doorCount}</b> · петель <b>${m.loops}</b> · глубина <b>${m.maxDepth}</b> · ширина <b>${m.widestDepth}</b></p>
<p class="note">${why}</p>
</div>`;
}

/** The ten cards go into one grid; wrap them once. */
function cards() {
  return `<div class="decks">${SHOWN.map(card).join("")}</div>`;
}

/** One ship: a hull drawn first, the hexagons that fitted inside it after. */
function shipCard([kind, seed]) {
  const form = shipForm(kind, seed, SHIP_R);
  const deck = deckFromCells(cellsInside(form), seed);
  const m = deck.metrics;
  return `<div class="deck">
${renderShip(form, deck, { uid: `ship-${kind}-${seed}` })}
<h3>${form.name}</h3>
<p class="meta">seed <b>${seed}</b> · сот <b>${m.cells}</b> · отсеков <b>${m.rooms}</b> · дверей <b>${m.doorCount}</b> · петель <b>${m.loops}</b> · глубина <b>${m.maxDepth}</b></p>
</div>`;
}

function fleet() {
  return `<div class="decks fleet">${FLEET.map(shipCard).join("")}</div>`;
}

/**
 * One ship of the twenty, at the scale its size band asks for.
 *
 * The two extra numbers are the ones that decide whether this can go into the
 * game at all: how many compartments sit at the same distance from the airlock
 * (against `MAX_COLUMN = 6` in the engine's column schematic) and the most
 * doors on any one compartment (against `MAX_DEGREE = 4`).
 */
function galleryCard(kind, seed) {
  const spec = CLASSES[kind];
  const scale = fitScale(kind, seed, GALLERY_R);
  const form = shipForm(kind, seed, GALLERY_R, scale);
  const deck = deckFromCells(cellsInside(form), seed);
  const m = deck.metrics;
  const [lo, hi] = SIZES[spec.size];
  return `<div class="deck">
${renderShip(form, deck, { uid: `g-${kind}-${seed}` })}
<h3>${spec.name}<span class="tag ${spec.size}">${SIZE_LABEL[spec.size]} · ${lo}–${hi}</span></h3>
<p class="meta">seed <b>${seed}</b> · сот <b>${m.cells}</b> · отсеков <b>${m.rooms}</b> · дверей <b>${m.doorCount}</b> · петель <b>${m.loops}</b> · глубина <b>${m.maxDepth}</b></p>
<p class="meta">на одной глубине <b class="${m.widestDepth > 6 ? "over" : ""}">${m.widestDepth}</b> из 6 · дверей у отсека <b class="${m.maxDoors > MAX_DOORS ? "over" : ""}">${m.maxDoors}</b> из ${MAX_DOORS}</p>
</div>`;
}

function gallery() {
  const cards = Object.keys(CLASSES).flatMap((kind) => GALLERY_SEEDS.map((seed) => galleryCard(kind, seed)));
  return `<div class="decks gallery">${cards.join("")}</div>`;
}

function maskCard(sil) {
  const [kind] = VERDICT[sil.id];
  return `<div class="mask">
<h3>${sil.name}<span class="tag ${kind}">${LABEL[kind]}</span></h3>
<p class="note">${sil.note}</p>
<pre>${esc(sil.mask.replace(/^\n/, "").replace(/\n$/, ""))}</pre>
</div>`;
}

function statRow(sil) {
  const runs = [];
  for (let seed = 1; seed <= SEEDS; seed++) runs.push(generateDeck(sil, seed).metrics);
  const span = (key) => `${Math.min(...runs.map((r) => r[key]))}–${Math.max(...runs.map((r) => r[key]))}`;
  const widest = Math.max(...runs.map((r) => r.widestDepth));
  const over = runs.filter((r) => r.overDoorCap > 0).length;
  return `<tr><td>${sil.name}</td><td>${runs[0].cells}</td><td>${span("rooms")}</td><td>${span("doorCount")}</td>` +
    `<td>${span("loops")}</td><td>${span("maxDepth")}</td>` +
    `<td class="${widest > 6 ? "hot" : ""}">${span("widestDepth")}</td>` +
    `<td class="${over > 0 ? "hot" : ""}">${over}/${SEEDS}</td></tr>`;
}

function conclusion() {
  const wide = SILHOUETTES.filter((sil) => {
    let max = 0;
    for (let seed = 1; seed <= SEEDS; seed++) max = Math.max(max, generateDeck(sil, seed).metrics.widestDepth);
    return max > 6;
  });
  return `<ul>
<li><b>Читаются как корабль</b> — те, у которых силуэт держится на двух-трёх массах разного
размера: сигара, молоток, стрела, катамаран, клин, крест, колесо, состав. Здесь форму видно
раньше, чем считаешь отсеки.</li>
<li><b>Спорные</b> — ковш, клешни, тарелка. Тонкие выступы в одну–две соты после нарезки на
отсеки распадаются на цепочку мелких комнат, и глаз читает их как антенны, а не как
конструкцию.</li>
<li><b>Клякса</b> — шестигранный форт. Компактная выпуклая масса без выступов не даёт силуэта
вообще: это просто пятно сот. Такой корпус узнаётся только по подписи.</li>
<li><b>Потолок «шесть отсеков на глубину» ломают ${wide.length} формы из 20</b>
(${wide.map((s) => s.name).join(", ")}). Причина не в генераторе: широкий корпус физически
даёт больше отсеков на одном удалении от шлюза, чем терминальная схема умеет показать
столбцом.</li>
<li><b>Потолок «четыре двери на отсек» держится</b> почти везде — в редких случаях одна дверь
ставится пятой, чтобы не оставить отсек недостижимым; это считается и показано в таблице.</li>
</ul>`;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
