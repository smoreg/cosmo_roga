import type { Table } from "./keys.js";

/**
 * Русский, в том же порядке, что и `en.ts`.
 *
 * Регистр — судовой журнал: телеграфно, без канцелярита, `ПОДЛЕЖАЩЕЕ: событие,
 * подробность`. Это не стилистическая прихоть, а способ обойти падежи: имена
 * модулей, отсеков и машин приходят в строку из таблицы и склонять их нечем,
 * поэтому фразы построены так, чтобы подставленное слово всегда стояло в
 * именительном. По той же причине `label.other` — просто `{name}`, без артикля
 * и без предлога.
 *
 * Ширины: имя модуля укладывается в 10 колонок, имя отсека — в 7 (коробка на
 * схеме), строка панели — в 28, строка двери — в 25. Проверяет
 * `tests/i18n.test.ts`.
 */
export const RU: Table = {
  // ----------------------------------------------------------------- отсеки

  "room.docking": "ПРИЧАЛ",
  "room.cargo": "ГРУЗ",
  "room.corridor": "КОРИДОР",
  "room.storage": "СКЛАД",
  "room.maintenance": "РЕМОНТ",
  "room.hab": "КАЮТЫ",
  "room.mess": "КАМБУЗ",
  "room.hydroponics": "ТЕПЛИЦА",
  "room.med": "ЛАЗАРЕТ",
  "room.lab": "ЛАБ",
  "room.quarantine": "МЕДБОКС",
  "room.engineering": "МОТОРЫ",
  "room.workshop": "ЦЕХ",
  "room.armory": "АРСЕНАЛ",
  "room.reactor": "РЕАКТОР",
  "room.control": "МОСТИК",
  "room.coreaccess": "К ЯДРУ",
  "room.lifesupport": "ВОЗДУХ",
  "room.cryo": "КРИО",
  "room.sensors": "СЕНСОРЫ",
  "room.brig": "КАРЦЕР",
  "room.escapepods": "ШЛЮПКИ",

  "room.dock": "ДОК",
  "room.hold": "ТРЮМ",
  "room.bench": "СТЕНД",
  "room.helm": "РУБКА",

  // ------------------------------------------------------------------ стойка

  "module.cutter": "РЕЗАК",
  "module.thrusters": "ДВИГАТЕЛИ",
  "module.scanner": "СКАНЕР",
  "module.plating": "БРОНЯ",
  "module.cell": "БАТАРЕЯ",
  "module.emp": "ЭМИ",
  "module.welder": "СВАРКА",
  "module.laser": "ЛАЗЕР",
  "module.spike": "ОТМЫЧКА",
  "module.emitter": "ЭМИТТЕР",
  "module.baffle": "ГАСИТЕЛЬ",

  "noun.cutter": "резак",
  "noun.thrusters": "двигатели",
  "noun.scanner": "сканер",
  "noun.plating": "броня",
  "noun.cell": "батарея",
  "noun.emp": "ЭМИ",
  "noun.welder": "сварка",
  "noun.laser": "лазер",
  "noun.spike": "отмычка",
  "noun.emitter": "эмиттер",
  "noun.baffle": "гаситель",

  "burn.cutter": "РЕЗАК выгорел. Остался таран.",
  "burn.thrusters": "ДВИГАТЕЛИ выгорели. Дальше — ползком на манипуляторах.",
  "burn.scanner": "СКАНЕР выгорел. За этой дверью корабль гаснет.",
  "burn.plating": "БРОНЯ выгорела. Между следующим ударом и ядром больше ничего нет.",
  "burn.cell": "БАТАРЕЯ выгорела. Переборки придётся резать.",
  "burn.emp": "ЭМИ выгорел. Заряд умер в катушке.",
  "burn.welder": "СВАРКА выгорела. Починок в поле больше не будет.",
  "burn.laser": "ЛАЗЕР выгорел. Линза помутнела намертво.",
  "burn.spike": "ОТМЫЧКА выгорела. Что заперто, то заперто.",
  "burn.emitter": "ЭМИТТЕР выгорел. До всего снова придётся доходить самому.",
  "burn.baffle": "ГАСИТЕЛЬ выгорел. Корабль снова тебя слышит.",

  // ------------------------------------------------------------------ машины

  "machine.maintenance-bot": "ремонтный бот",
  "machine.feral-drone": "одичалый дрон",
  "machine.scout": "разведчик",
  "machine.security-unit": "охранник",
  "machine.welder-bot": "сварочный бот",
  "machine.hauler": "тягач",
  "machine.scrapper": "мусорщик",
  "machine.arc-sentinel": "дуговой страж",
  "machine.sentry-turret": "турель",
  "machine.jammer": "глушилка",
  "machine.crawler": "ползун",
  "machine.bloom": "кокон",
  "machine.enforcer": "каратель",
  "machine.ghost": "призрак",
  "machine.rival-drone": "чужой дрон",

  // ----------------------------------------------------------------- корпуса

  "hull.scrapper": "ТРУДЯГА",
  "hull.spark": "ИСКРА",
  "hull.ghost": "ТЕНЬ",

  "trait.scrapper": "6 слотов, ядро 3",
  "trait.spark": "7 слотов, ядро 4, ДВИГ 120",
  "trait.ghost": "8 слотов, ядро 5, ДВИГ 140",

  // --------------------------------------------------------------- дереликты

  "derelict.freighter": "грузовик",
  "derelict.laboratory": "лаборатория",
  "derelict.military": "военный",
  "derelict.smuggler": "контрабандист",
  "derelict.corsair": "корсар",
  "derelict.quarantine": "карантин",
  "derelict.fathers-tug": "буксир отца",

  "derelict.flavour": "{callsign} · {hull} · {first} · {second}",

  "flavour.freighter.0": "тяжёлый грузовик",
  "flavour.freighter.1": "реактор деления",
  "flavour.freighter.2": "ионный привод",
  "flavour.freighter.3": "рудный рейс",
  "flavour.freighter.4": "долгий перегон",
  "flavour.laboratory.0": "исследовательский корпус",
  "flavour.laboratory.1": "изотопный реактор",
  "flavour.laboratory.2": "привод для съёмки",
  "flavour.laboratory.3": "дальняя съёмка",
  "flavour.laboratory.4": "без манифеста",
  "flavour.military.0": "патрульный катер",
  "flavour.military.1": "экранированный реактор",
  "flavour.military.2": "военный привод",
  "flavour.military.3": "пограничный патруль",
  "flavour.military.4": "пропал со всем экипажем",
  "flavour.smuggler.0": "быстрый грузовик",
  "flavour.smuggler.1": "разобранный реактор",
  "flavour.smuggler.2": "контрабандный привод",
  "flavour.smuggler.3": "без регистрации",
  "flavour.smuggler.4": "три ложных трюма",
  "flavour.corsair.0": "рейдер",
  "flavour.corsair.1": "форсированный реактор",
  "flavour.corsair.2": "абордажный привод",
  "flavour.corsair.3": "взят на абордаж",
  "flavour.corsair.4": "призовая команда на борту",
  "flavour.quarantine.0": "медицинский транспорт",
  "flavour.quarantine.1": "экранированный реактор",
  "flavour.quarantine.2": "привод дальнего хода",
  "flavour.quarantine.3": "запечатан изнутри",
  "flavour.quarantine.4": "без сигнала бедствия",
  "flavour.fathers-tug.0": "спасательный буксир",
  "flavour.fathers-tug.1": "реактор деления",
  "flavour.fathers-tug.2": "ионный привод",
  "flavour.fathers-tug.3": "позывной твоего отца",
  "flavour.fathers-tug.4": "пропал одиннадцать лет назад",

  // ------------------------------------------------------- системы корабля

  "system.engine": "ПРИВОД",
  "system.core": "ЯДРО",
  "system.terminal": "ТЕРМИНАЛ",

  "system.short.engine": "прив",
  "system.short.core": "ядро",
  "system.short.terminal": "терм",

  "thing.system.engine": "привод",
  "thing.system.core": "ядро",
  "thing.system.terminal": "терминал",

  "log.system.online.engine": "ПРИВОД В СЕТИ. Корабль это заметил.",
  "log.system.online.core": "ЯДРО В СЕТИ. Корабль это заметил.",
  "log.system.online.terminal": "ТЕРМИНАЛ В СЕТИ. Корабль это заметил.",

  // ---------------------------------------------------------------- чартеры

  "charter.name.salvage": "УТИЛЬ",
  "charter.name.retrieve": "ДОСТАВКА",
  "charter.name.upload": "ПЕРЕДАЧА",
  "charter.name.neutralize": "ПОДЪЁМ",

  "charter.salvage": "УТИЛЬ · привезти домой {need} CR утиля",
  "charter.retrieve": "ДОСТАВКА · вынести меченый ящик, отсек {room}",
  "charter.upload": "ПЕРЕДАЧА · пять ходов у консоли, отсек {room}",
  "charter.neutralize": "ПОДЪЁМ · привод, ядро и терминал в сети, потом на выход",

  // ------------------------------------------------- глаголы и состояния дверей

  "verb.go": "идти",
  "verb.leave": "выйти",
  "verb.key": "карта",
  "verb.power": "заряд",
  "verb.spike": "вскрыть",
  "verb.cut": "резать",
  "verb.weld": "варить",
  "verb.close": "закрыть",
  "verb.open": "открыть",

  "cost.key": "1 ход, тихо",
  "cost.power": "1 ход, шум 6",
  "cost.spike": "2 хода, шум 4",
  "cost.cut": "3 хода, шум 9",

  "state.open": "открыта",
  "state.closed": "закрыта",
  "state.locked": "заперта",
  "state.sealed": "заварена",
  "state.broken": "сломана",
  "state.airlock": "шлюз",
  "state.out": "наружу",

  // ------------------------------------------------------------- мелкие слова

  "label.you": "Ты",
  "label.other": "{name}",
  "label.something": "Что-то",
  "word.a": "{name}",
  "word.or": "{first} или {last}",
  "word.bulkhead": "переборка {door}",
  "word.cr": "{n} CR",
  "word.crate": "ящик",
  "word.scrap": "лом",
  "word.derelict": "дереликт",
  "word.keycard": "ключ-карта",
  "word.module": "модуль",
  "word.system": "система",
  "word.theVoyage": "рейс",
  "word.tug": "БУКСИР",

  "thing.partsCrate": "ящик с деталями",
  "thing.scrap": "лом",
  "thing.body": "тело кого-то из экипажа",
  "thing.cargo": "грузовой ящик",
  "thing.contraband": "ящик с контрабандой",
  "thing.console": "консоль",
  "thing.package": "груз по чартеру",

  // ------------------------------------------------------------------ журнал

  "log.opening": "Буксир привязан к чему-то тёмному, и на стойке остался один дрон.",
  "log.win": "Шлюз закрывается за спиной. Буксир уходит с тем, что ты взял.",
  "log.death": "Пробой ядра. Дрон гаснет. Корабль оставляет себе то, что забрал.",

  "log.hit.module": "{source}: попадание, {module} ({left}/{max}).",
  "log.machine.dies": "{target} гибнет.",
  "log.scrap.drop": "{machine} рассыпается в лом: {module}.",

  "log.door.key": "Считыватель мигает зелёным. {door} открывается.",
  "log.door.power": "Разряд БАТАРЕИ: {door}. Замок отпускает.",
  "log.door.cut.on": "Рез идёт: {door}. Ещё {left, one: # ход, few: # хода, many: # ходов}.",
  "log.door.cut.done": "{door} поддаётся с визгом.",
  "log.door.weld.on": "Ведём сварку по шву: {door}.",
  "log.door.weld.done": "{door} заварена. Насовсем.",
  "log.door.close": "{door}: закрыта.",
  "log.spike.on": "{spike} в работе: {target}.",
  "log.spike.done": "{target}: путь открыт.",

  "log.body.plain": "Обыск тела: {cr} CR.",
  "log.body.key": "Обыск тела: {cr} CR и ключ-карта.",
  "log.crate.open": "Ящик вскрыт — {crate}: {cr} CR в трюм.",
  "log.cargo.take": "Меченый ящик снят со стеллажа.",
  "log.upload.on": "Консоль отдаёт медленно. Ещё {left, one: # ход, few: # хода, many: # ходов}.",
  "log.upload.done": "Передача закончена. Что бы это ни было, оно у буксира.",
  "log.console.away": "Ты отходишь от консоли. Всё сначала.",

  "log.work.break.cut": "Рез брошен.",
  "log.work.break.weld": "Сварка брошена.",
  "log.work.break.splice": "Сращивание брошено.",
  "log.work.break.purge": "Прожиг брошен.",

  "log.carry.take": "{module} {left}/{max} снят. Несёт {n} из {limit}.",
  "log.carry.home": "Донесено: {n}. В трюм.",
  "log.salvage.graft": "Наращивание: {module} ({left}/{max}). Лучше нового.",
  "log.salvage.mend": "Лом в дело: {module} ({left}/{max}).",
  "log.salvage.install": "Из обломков: {module} ({left}/{max}).",
  "log.weld": "Сварка: {module} до {left}/{max}.",
  "log.pulse": "Импульс сканера. Две двери корабля легли на схему.",
  "log.emp":
    "Разряд катушки: {n, one: # машина замерла, few: # машины замерли, many: # машин замерло}. " +
    "Заряд: {left}.",
  "log.emitter.hit": "{emitter}: попадание, {target}, урон {n} ({hp}/{max}).",

  "log.system.work": "{tool} → {system}. Ещё {left, one: # ход, few: # хода, many: # ходов}.",
  "log.system.advance": "Чартер платит аванс:",
  "log.system.all": "Все три в сети. Жми `<` — на выход через шлюз, и корпус твой.",
  "log.system.all.paid": "Все три в сети. Жми `<` — на выход через шлюз, и корпус твой: +{cr} CR.",

  "log.alert.hunter": "{hunter} просыпается: {room}.",
  "log.alert.busy":
    "Корабль не сидел без дела: ещё {n, one: # машина, few: # машины, many: # машин} на борту.",
  "log.alert.calm": "Корабль перестаёт тебя искать.",

  "log.bloom.hatch": "Кокон лопается. Оттуда что-то выбирается.",
  "log.bloom.strip": "Кокон вскрыт: {cr} CR биомассы, и ни одной детали.",
  "log.bloom.dies": "Кокон оседает. Биомасса, деталей нет.",

  "log.ghost.sighted": "Там движется что-то с твоим позывным.",
  "log.ghost.drop": "Призрак разваливается. Твоя старая стойка на полу.",

  "log.rival.aboard": "На борту чужой дрон. Он здесь не за утилем.",
  "log.rival.gone": "Чужой срывается и уходит к своему шлюзу.",
  "log.hull.taken": "«{hull}» уже на чужом тросе. Три системы подняты зря.",
  "log.rival.lost": "Корабль забрал другой буксир. У тебя двадцать ходов.",
  "log.rival.jumped": "Буксир чужого прыгает вместе с кораблём. Твой дрон уходит с ним.",
  "log.rival.system": "Чужой поднимает: {system}.",
  "log.rival.drops": "Чужой сбрасывает: {module}.",

  // Торг (G34). Все его строки живут здесь, рядом с остальной речью чужого.
  "action.rival.payoff": "откупиться ({price} CR)",
  "action.rival.aside": "отойти (+{price} CR)",
  "action.rival.split": "делить продажу",
  "why.rival.spent": "Ему больше нечего поднимать.",
  "why.rival.notHere": "Чужого нет в этом отсеке.",
  "why.rival.dealt": "Сделка по этому корпусу уже заключена.",
  "log.rival.deal.paid": "Чужой берёт кредиты и уходит. Добыча остаётся.",
  "log.rival.deal.sold": "Чужой платит за право прохода:",
  "log.rival.deal.split": "Ударили по рукам: половина корпуса. Он работает с тобой.",
  "log.rival.raises": "Чужой поднимает за тебя: {system}.",
  "panel.deal": "СДЕЛКА {deal}",
  "word.deal.paid": "откуп",
  "word.deal.sold": "отход",
  "word.deal.split": "пополам",

  "log.virus.caught": "В ломе что-то было. {virus} в {module}.",
  "log.virus.rot": "{virus} грызёт {module}: осталось {left}.",
  "log.virus.rot.burned": "{virus} догрыз {module}. Модуля больше нет.",
  "log.virus.skim": "{virus} снимает со счёта {amount} CR.",
  "log.virus.skim.empty": "{virus} шарит по счёту. Брать нечего.",
  "log.virus.core": "{virus} добирается до ядра. Осталось {left}.",
  "log.virus.twitch": "{module}: судорога. {virus} выбрал, куда придёт удар.",
  "log.virus.moves": "Вирус уходит: {from} → {to}.",
  "log.virus.purge.on": "Прожиг: {module}.",
  "log.virus.purge.done": "Чистка удалась. {module}: чисто.",
  "log.virus.burned": "Вирус ушёл вместе со сгоревшим модулем.",

  "log.helm.board": "Доска чартеров: {flavour}.",
  "log.charter.signed": "Подписано: {charter}.",
  "log.charter.filled": "Чартер {charter}:",
  "log.credit": "{why} +{amount} CR. Всего {total} CR.",
  "log.hull.bought": "{hull} сходит со стапеля: {trait}. Осталось {credits} CR.",
  "log.hull.tow": "{hull} уходит на буксире:",
  "log.hull.tow.split": "{hull} уходит на буксире, продажа пополам:",
  "log.hold.emptied": "Трюм разгружен:",
  "log.hold.sell": "Продано насовсем — {module}:",
  "log.hold.sell.sick": "Продано насовсем — {module} (заражение):",
  "log.hold.fit": "{module} ({integrity}) — в слот {slot}.",
  "log.bench.repair": "Стенд: {module} до {left}/{max}.",
  "log.bench.graft": "Стенд, наращивание: {module} {left}/{max}.",
  "log.bench.clean": "Стенд выжигает вирус: {module}.",
  "log.jump": "Буксир идёт дальше: {hull}. Осталось {credits} CR.",
  "log.jump.warn": "{hull}: {up} из {of} систем в сети. Прыжок бросает корпус.",
  "log.voyage.undock": "Захваты отпущены.",
  "log.voyage.home": "Шлюз отработал. Буксир ждёт, а дереликт всё ещё дышит.",
  "log.voyage.won": "Буксир отвечает на позывной твоего отца. Ты уводишь его домой. Победа.",
  "log.voyage.broke": "Стойка пуста, и счёт тоже. Рейс окончен.",
  "log.drone.lost": "Дрон перестал отвечать. Всё, что он нёс, осталось на дереликте.",

  // ---------------------------------------------------------------- подсказки

  "hint.exposure": "Удар приходится по тому, что ты только что использовал.",
  "hint.burned": "Сгоревший модуль не вернуть. Его слот теперь пуст.",
  "hint.scrap": "Лом. Разбери его на модуль или нарасти им тот, что уже стоит.",
  "hint.blind": "Без сканера виден только этот отсек. Найди сканер.",
  "hint.keycard": "Ключ-карта. Двери с меткой [ ] её читают.",
  "hint.death": "Твой дрон всё ещё там. Дружелюбным он не будет.",
  "hint.objective": "Одна из трёх систем корабля. Подними все три и уйди живым — буксир продаст корпус целиком.",
  "hint.payout": "Платят, только когда дрон вернулся через шлюз. Погиб здесь — трюм пропал вместе с ним.",
  "hint.sold": "Трюм продан за {credits} CR. Корпус стоит {hullPrice}.",
  "hint.shooting": "Стреляешь — подставляешь то, чем стреляешь: ответный выстрел придёт в ЭМИТТЕР, а он самый хрупкий в стойке.",
  "hint.sell": "Продано насовсем: модули никто не продаёт обратно. Чтобы сохранить — снимай в трюм.",
  "hint.training": "ОБУЧЕНИЕ. Пять вещей, которые игра скажет один раз. Вот они сразу:",
  "hint.virus": "С утилем можно занести корабельный вирус. У каждого корпуса свои. Сварка чистит любой.",
  "strain.spasm": "СУДОРОГА",
  "strain.rot": "ГНИЛЬ",
  "strain.leech": "ПИЯВКА",
  "strain.leash": "ПОВОДОК",

  // ------------------------------------------------------------------- отказы

  "why.credits": "Кредитов не хватает.",
  "why.line.none": "На этой строке ничего нет.",
  "why.notHere": "Отсюда нельзя.",
  "why.jammed": "Помехи. Ничего не отзывается.",

  "why.door.notHere": "В этом отсеке такой двери нет.",
  "why.door.notLocked": "{door} не заперта.",
  "why.door.noLock": "{door}: вскрывать нечего.",
  "why.door.noCut": "{door}: резать незачем.",
  "why.door.noWeld": "{door}: заварить нельзя.",
  "why.door.notOpen": "{door} не открыта.",
  "why.door.noKeycard": "Ключ-карты на дроне нет.",
  "why.door.noKeycardHere": "Здесь нет замка под карту.",
  "why.door.wallsIn": "{door}: сварка замурует дрона здесь.",
  "why.door.state": "{door}: {state}.",
  "why.room.noRoute": "{room}: пути нет.",

  "why.module.missing": "{module}: нет в стойке.",
  "why.module.notInstalled": "{module}: нет на дроне.",
  "why.module.passive": "У этого модуля нет активного применения.",
  "why.module.whole": "{module}: повреждений нет.",
  "why.module.grafted": "{module}: наращивать больше некуда.",
  "why.module.clean": "{module}: чисто.",
  "why.rig.emptySlot": "Слот пуст.",
  "why.slot.empty": "В этом слоте пусто.",
  "why.rack.full": "Свободного слота нет. Сначала продай что-нибудь.",
  "why.rack.burnFirst": "Свободного слота нет. Сначала что-то должно сгореть.",
  "why.graft.full": "Наращивать больше некуда.",
  "why.repair.none": "Чинить нечего.",
  "why.breach.nothing": "Вскрывать здесь нечего.",
  "why.shoot.none": "На линии огня пусто.",
  "why.emp.spent": "{emp}: заряды кончились.",
  "why.emp.none": "В радиусе никого.",
  "why.salvage.noRig": "Разбирать нечем.",
  "why.carry.full": "Дрон унесёт {n}, больше не удержит.",
  "why.salvage.none": "Разбирать здесь нечего.",
  "why.biomass.none": "Биомассы здесь нет.",

  "why.body.none": "Обыскивать здесь некого.",
  "why.body.searched": "Это тело уже обыскано.",
  "why.cargo.none": "Грузить здесь нечего.",
  "why.cargo.carrying": "Ты и так это несёшь.",
  "why.console.none": "Консоли здесь нет.",
  "why.console.done": "Эта консоль уже отдала всё, что было.",

  "why.system.none": "Поднимать здесь нечего.",
  "why.system.up": "{system}: уже в сети.",
  "why.system.needs": "Нужен инструмент: {tools}.",

  "why.virus.none": "В стойке нет заражённых модулей.",
  "why.virus.clean": "Этот модуль чист.",

  "why.tug.only": "Это делают на буксире, не здесь.",
  "why.hull.none": "Такого корпуса на стойке нет.",
  "why.hold.noDrone": "Ставить некуда: дрона нет.",
  "why.hold.none": "В трюме под этим номером ничего нет.",
  "why.charter.none": "На доске под этим номером ничего нет.",
  "why.charter.late": "{hull}: вход уже открыт. После этого никто не подписывает.",
  "why.undock.aboard": "Ты и так на борту.",
  "why.undock.noDrone": "На рельсах нет дрона.",
  "why.undock.sold": "{hull} уже на буксире. Прыгай к следующему корпусу.",
  "why.undock.tow": "{hull} уже на буксире.",
  "why.jump.aboard": "Прыгает буксир, а не дрон.",
  "why.jump.last": "Дальше ничего нет. Это последний корпус рейса.",
  "why.jump.first": "Сначала перелёт за {price} CR.",

  // ------------------------------------------------------- нумерованный список

  "action.attack": "атака: {target} {hp}/{max}",
  "action.shoot": "огонь: {target}",
  "action.carry": "унести {module} {left}/{max}",
  "action.salvage": "разбор: {module} {left}/{max}",
  "action.hide": "укрыться",
  "action.search": "обыскать тело",
  "action.strip": "снять биомассу ({cr} CR)",
  "action.purge": "прожиг: {module} (сварка)",
  "action.work": "подъём {system} {tool} {left}",
  "action.workBare": "подъём {system} ({left})",
  "action.take": "взять {crate} ({cr} CR)",
  "action.takeMarked": "взять меченый ящик",
  "action.upload": "передача ({left, one: # ход, few: # хода, many: # ходов})",
  "action.buy": "купить {hull} {price} CR",
  "action.undock": "вылет на {hull}",
  "action.repair": "{module} {price} CR",
  "action.clean": "чистка: {module} ({price} CR)",
  "action.graft": "{module} +1 базы  {price} CR",
  "action.order": "купить {module} {price} CR",
  "action.fit": "{module} {integrity}",
  "action.sell": "{module} {left}/{max}  {price} CR",
  "action.charter": "взять {charter} ({price})",
  "action.jump": "→ {hull}  {price} CR",
  "action.back": "назад ({door})",
  "action.backRoom": "назад",
  "dist.doors": "{n, one: # дверь, few: # двери, many: # дверей}",
  "dist.none": "нет пути",

  "crate.cargo": "груз",
  "crate.contraband": "левый груз",

  // ------------------------------------------------------------- что говорит `o`

  "stop.over": "Забег окончен.",
  "stop.machine": "Видно: {machine}, отсек {room}.",
  "stop.hit": "Тебя бьют.",
  "stop.alert": "Тревога растёт.",
  "stop.thing": "Здесь что-то есть: {thing}.",
  "stop.explored": "{hull} изучен. {back}",
  "stop.airlock.none": "Дороги обратно к шлюзу нет.",
  "stop.airlock.here": "Ты стоишь у шлюза.",
  "stop.airlock.away": "Шлюз: {n, one: # дверь, few: # двери, many: # дверей} назад.",
  "stop.noTarget": "Целей не видно.",
  "stop.noWay": "Прохода нет.",
  "stop.arrived": "Дошли: {room}.",
  "stop.shut": "Дальше закрыто: {door} ({state}).",

  // ------------------------------------------------------------------- панель

  "panel.turn": "ход {n}",
  "panel.sortie": "вылет {n}",
  "panel.actions": "ДЕЙСТВИЯ",
  "panel.more": "… ещё {n} (↑↓)",
  "panel.room": "{room} {label}",
  "panel.doorTo": "{door} → {room}",
  "panel.roomDoors": "{room} {label}  двери {doors}",
  "panel.doorMore": "… ещё {n, one: # дверь, few: # двери, many: # дверей}",
  "panel.roomMore": "… ещё {n} здесь",
  "panel.letter.move": "m идти",
  "panel.letter.brace": ". упор",
  "panel.letter.hide": "h укрыт",
  "panel.letter.leave": "< выход",
  "panel.letters.tug": "0 назад  ? помощь",
  "panel.letters": "o обзор  Tab бой  ? помощь",
  "panel.nextHit": "СЛЕДУЮЩИЙ УДАР В",
  "panel.core": "ЯДРО  {dots}",
  "panel.slot.empty": "-- пусто --",
  "panel.slot.burned": "-- сгорел --",
  "panel.keys": "КАРТЫ {n}",
  "panel.alert": "ТРЕВОГА {gauge}",
  "panel.hunter": "ОХОТНИК на борту",
  "panel.rival": "ЧУЖОЙ {gauge}",
  "panel.evac": "ЭВАК {n}",
  "panel.goal": "ЦЕЛЬ  ПОДНЯТЬ КОРПУС {cr} CR",
  "panel.goal.bare": "ЦЕЛЬ  ПОДНЯТЬ КОРПУС",
  "panel.goal.done": "ВСЕ ТРИ В СЕТИ  +{cr} CR",
  "panel.goal.out": "< на выход через шлюз",
  "panel.goal.towed": "КОРПУС ВЗЯТ  на буксире",
  "panel.goal.work": "{mark} {system} {tool}, {left, one: # ход, few: # хода, many: # ходов}",
  "panel.charters": "КОНТРАКТЫ",
  "panel.charter.plain": "{mark} {name}",
  "panel.charter.where": "{mark} {name} · {room}",
  "panel.charter.loot": "{mark} {name} {have}/{need} CR",
  "panel.virus": "{virus}: {module}",
  "panel.credits": "КРЕДИТЫ {n}",
  "panel.hold": "ТРЮМ  {n} CR",
  "panel.droneLost": "ДРОНА НА СТАПЕЛЕ НЕТ",
  "panel.cheapest": "ДЕШЁВЫЙ КОРПУС {n}",
  "panel.derelict": "ДЕРЕЛИКТ {hull}",
  "panel.tow": "на буксире",
  "panel.quiet": "тихо",
  "panel.alertAt": "тревога {n}",
  "panel.hullState": "{alert} · {up}/{of} в сети",

  "ship.rooms": "{n, one: # отсек, few: # отсека, many: # отсеков}",
  "ship.seen": "{n} видно",
  "ship.scanned": "{n} на скане",
  "schematic.hidden": "» {n, one: # отсек, few: # отсека, many: # отсеков}",
  "schematic.behind": "« {n, one: # отсек, few: # отсека, many: # отсеков}",

  // Added with the tug-clarity pass (G40).
  "why.rack.hullFull": "Стойка занята.",
  "action.hull.onRack": "{hull} — на стойке",
  "panel.contact.hit": "удар: {module}",

  // The contacts block, made unmissable (G47).
  "panel.contacts.here": "ВРАГ В ОТСЕКЕ: {n}",
  "panel.contacts.near": "ЗА ДВЕРЬЮ: {n}",
  "panel.contactsMore": "… ещё {n} в виду",
  "danger.melee": "в упор",
  "danger.door": "стреляет",
  "danger.jam": "глушит",
  "danger.noScrap": "без лома",
  "danger.hunter": "охотник",
  "danger.still": "не бьёт",
  "log.contacts.here": "В отсеке: {list}.",
  "log.contacts.one": "{machine} {hp}, {danger}",
  "panel.head.tug": "SALVOR  буксир",
  "panel.head.tugTo": "SALVOR  буксир → {hull}",
  "help.where.tug.head": "ГДЕ ТЫ — твой собственный буксир",
  "help.where.tug.1": "Один экран: купи дрона, почини, сними в трюм или продай",
  "help.where.tug.2": "лишнее, возьми чартер и вылетай. Ходить тут негде.",
  "help.where.ship.head": "ГДЕ ТЫ — внутри дереликта",
  "help.where.ship.1": "Бери то, что окупится, подними системы корабля и уходи",
  "help.where.ship.2": "через шлюз: трюм становится деньгами только дома.",
  "help.name.pick": "ВЫБОР",
  "help.key.pick": "вверх/вниз  enter делает отмеченную строку",
  "help.name.move": "ИДТИ",
  "ship.yourTug": "твой буксир",
  "ship.dockedTo": "пришвартован: {hull}",
  "banner.ahead": "ДЕРЕЛИКТ впереди: {hull} · {rooms}",
  "banner.tug": "ТВОЙ БУКСИР «{callsign}» · пришвартован: {hull}",
  "banner.derelict": "ДЕРЕЛИКТ {parts}",
  "word.unknownHull": "неизвестный корпус",
  "log.opening.tug": "Твой буксир. Всё, что он умеет, — в списке: дрон, ремонт, чартеры, вылет. ? — в любой момент.",
  "log.opening.voyage":
    "{callsign}. Впереди {hulls, one: # корпус, few: # корпуса, many: # корпусов}; " +
    "последний — буксир твоего отца.",

  // ------------------------------------------------------------ титул и справка

  "title.name": "SALVOR",
  "title.pitch.1": "Ты водишь буксир. В мёртвый корабль уходит дрон.",
  "title.pitch.2": "У него нет очков жизни — у него модули, и каждый удар",
  "title.pitch.3": "жжёт то, чем ты только что воспользовался. Купи следующий.",
  "title.keys": "1 НОВЫЙ РЕЙС   2 ОБУЧЕНИЕ   3 СПРАВКА",
  "title.start": "L язык · V вид · любая другая — в рейс",

  "help.page.more": "{n}/{of}   ? дальше   esc закрыть",
  "help.page.last": "{n}/{of}   ? закрыть   esc закрыть",
  "help.title": "УПРАВЛЕНИЕ",

  "help.name.act": "ДЕЙСТВИЕ",
  "help.name.brace": "УПОР",
  "help.name.hide": "УКРЫТЬСЯ",
  "help.name.explore": "ОБЗОР",
  "help.name.engage": "СБЛИЗИТЬСЯ",
  "help.name.keycard": "КАРТА",
  "help.name.help": "СПРАВКА",

  "help.key.act": "1-9 0  строка списка",
  "help.key.brace": ". или пробел   (под удар: БРОНЯ)",
  "help.key.hide": "h   там, где в отсеке есть укрытие",
  "help.key.move": "m   куда идти · <   к шлюзу и наружу",
  "help.key.explore": "o   идти дальше; стоп на всём новом",
  "help.key.engage": "tab / shift+tab  выстрел или только вплотную",
  "help.key.scanner": "s   импульс: две двери вглубь, громко",
  "help.key.emp": "e   оглушить отсек, 2 заряда",
  "help.key.welder": "w   починить самый слабый модуль",
  "help.key.cell": "p   запитать запертую дверь или консоль",
  "help.key.spike": "K   вскрыть замок, два хода, тихо",
  "help.key.emitter": "f   выстрел по линии огня",
  "help.key.cutter": "c   резать дверь, три хода, громко",
  "help.key.keycard": "a   ключ-карта на замок, тихо",
  "help.key.help": "?   ВИД V  ЯЗЫК L  ЗАНОВО shift+R  ЗАКРЫТЬ esc",

  "help.rule.head": "ОТКРЫТ — единственное правило",
  "help.rule.1": "Удар приходится по модулю, который ты только что",
  "help.rule.2": "использовал: по отмеченному ◀. Если открыто ничего",
  "help.rule.3": "нет — бьют в БРОНЮ, потом в ЯДРО. На нуле модуль",
  "help.rule.4": "выгорает навсегда, и пустой слот от него — это",
  "help.rule.5": "единственное место, куда влезет утиль.",

  "help.list.head": "ДЕЙСТВИЯ — список справа",
  "help.list.1": "Всё, что здесь можно сделать, — строка с номером.",
  "help.list.2": "Тусклую пока нажать нельзя, и она говорит почему.",
  "help.list.3": "Запертая дверь открывает свой список; 0 — назад.",

  "help.charter.head": "ЧАРТЕРЫ — ради чего вылет",
  "help.charter.1": "Подписываются в РУБКЕ до отхода, платят, когда дрон",
  "help.charter.2": "дома. УТИЛЬ хочет кредитов в трюме. ПОДЪЁМ хочет",
  "help.charter.3": "привод, ядро и терминал в сети — он и продаёт",
  "help.charter.4": "весь корпус целиком.",

  // ------------------------------------------------------------------ финалы

  "end.dead": "СЧЁТ ПУСТ",
  "end.lost": "ДРОН ПОТЕРЯН",
  "end.won": "БУКСИР ОТЦА ТВОЙ",
  "end.sold": "КОРАБЛЬ ПРОДАН",
  "end.dead.why": "Дрона нет, и купить следующий не на что.",
  "end.won.why": "Последний корпус маршрута на буксире. Рейс окончен.",
  "end.again": "shift+R — новый забег",
  "end.go": "любая клавиша — рейс продолжается",
  "end.summary":
    "{cr} CR · " +
    "{rooms, one: # отсек, few: # отсека, many: # отсеков} · " +
    "{turns, one: # ход, few: # хода, many: # ходов} · " +
    "{kills, one: # машина, few: # машины, many: # машин} · " +
    "сгорело {burned, one: # модуль, few: # модуля, many: # модулей}",

  // ------------------------------------------------------------- экран ошибки

  "crash.title": "ЧТО-ТО СЛОМАЛОСЬ",
  "crash.seed": "сид {seed} · {voyage} · ход {turn}",
  "crash.sortie": "вылет {n}",
  "crash.hull": "корпус {n}",
  "crash.hullOf": "корпус {n}/{of}",
  "crash.report": "скопируй этот URL и пришли его",
  "crash.unknown": "неизвестная ошибка",


  // -------------------------------------------------- буксир как меню (G53)

  // Пять глаголов, по которым читается буксир. Группы, а не отсеки: ДОК,
  // ТРЮМ, СТЕНД и РУБКА — это внутренности корабля, и по ним нельзя угадать,
  // где чинят модуль (docs/tasks/G53-tug-is-a-menu.md, 1).
  "tug.group.drone": "ДРОН",
  "tug.group.repair": "ЧИНИТЬ",
  "tug.group.rig": "ЭКИПИРОВКА",
  "tug.group.sell": "ПРОДАТЬ",
  "tug.group.voyage": "КОНТРАКТЫ",
  "tug.group.jump": "СМЕНА ТОЧКИ",

  "action.pick.buy": "купить корпус ▸",
  "action.dead.undock": "вылет",
  "action.dead.clean": "лечить модуль",
  "action.dead.jump": "прыжок дальше",
  "action.pick.repair": "ремонт модуля ▸",
  "action.pick.graft": "нарастить модуль ▸ {price} CR",
  "action.pick.stow": "снять в трюм ▸",
  "action.pick.fit": "поставить из трюма ▸",
  "action.pick.sell": "продать насовсем ▸",
  "action.pick.charter": "взять чартер ▸",

  "action.one.hull": "{hull}  {price} CR",
  "action.one.module": "{module} {left}/{max}",
  "action.one.modulePriced": "{module} {left}/{max}  {price} CR",
  "action.one.held": "{module} {integrity}",
  "action.one.charter": "{charter}  {price}",

  "action.stow": "{module} {left}/{max}",
  "log.stock.buy": "{module} куплен за {price} CR. В трюме. Осталось {credits} CR.",
  "log.hold.fitted": "Из трюма поставлено: {n}.",
  "log.hold.stow": "В трюм — {module} ({integrity}/{max}), целым.",

  "why.stock.none": "На полке ничего не осталось.",
  "why.hold.full": "В трюме уже {n}. Сначала поставь что-нибудь обратно.",
  "why.hold.empty": "Трюм пуст.",
  "why.rig.whole": "В стойке всё цело.",
  "why.rig.grafted": "Наращивать больше нечего.",
  "why.rig.empty": "В стойке пусто.",
  "why.rig.last": "Последний модуль остаётся на рельсах: с пустой стойкой дрон ничего не может.",
  "why.rig.clean": "Заражённых модулей нет.",
  "why.charter.gone": "Все чартеры этого борта подписаны.",
  "why.tug.noDrone": "Дрона нет. Сначала купи корпус.",
  "why.tug.noWalk": "На буксире ходить негде — всё в списке.",

  "board.derelict": "ДЕРЕЛИКТ {hull} · {alert}",
  "board.worth": "ПОДНЯТЬ КОРПУС {up}/{of} — за него дадут {price} CR",
  "board.rack": "СТОЙКА КОРПУСОВ",
  "board.hull": "{hull}  {price} CR  {trait}",
  "board.hull.yours": "{hull}  ← на рельсах",
  "board.sorties": "вылазок {n} · дронов потеряно {lost}",
  "board.mode": "Тревоги нет, ходить негде. Всё, что можно, — в списке.",
  // ------------------------------------------------------------------ движок
  //
  // Строки, которые пишет сам движок. Русского он не знает и знать не может, —
  // он отдаёт ключ события и значения, а фраза собирается здесь
  // (`ui/logline.ts`). Тон — как у соседних строк риги: подлежащее в
  // именительном, двоеточие, факт.
  //
  // `{Actor}` — машина с прописной, `{actor}` — со строчной.

  "engine.hit.you": "Удар: {target}, урон {amount} ({hp}/{max}).",
  "engine.hit.taken": "{Actor}: попадание, урон {amount}.",
  "engine.hit.other": "{Actor} → {target}: урон {amount} ({hp}/{max}).",
  "engine.dies": "{Target} гибнет.",
  "engine.cover.you": "Ты уходишь в укрытие.",
  "engine.cover.other": "{Actor} уходит в укрытие.",

  "engine.door.open": "{door}: открыта.",
  "engine.door.breached": "{door} поддаётся с визгом.",
  "engine.door.cut.you": "Рез идёт: {door}.",
  "engine.door.cut.other": "{Actor} режет: {door}.",

  "engine.fail.airlock": "Это шлюз. < — обратно на буксир.",
  "engine.fail.attack.ally": "По своим не бьём.",
  "engine.fail.attack.away": "{Target} — не в этом отсеке.",
  "engine.fail.attack.gone": "Атаковать некого.",
  "engine.fail.attack.sight": "{Target} — не на линии огня.",
  "engine.fail.cover": "Здесь не за чем укрыться.",
  "engine.fail.door.elsewhere": "{door} — не в этом отсеке.",
  "engine.fail.door.gone": "Такой двери нет.",
  "engine.fail.door.shut": "{door}: {state}.",
  "engine.fail.door.size": "{Actor} не пролезет: {door}.",
  "engine.fail.leave.none": "Здесь нет шлюза.",
  "engine.fail.leave.other": "С корабля уходит только дрон.",
  "engine.fail.nothing": "Здесь нечего делать.",
  "engine.fail.over": "Забег окончен.",

  // -------------------------------------------------------------- схема
  //
  // Метка на коробке, висящей у шлюза. Три колонки — не место для слова
  // ни в одном из трёх языков, поэтому буксир на схеме глиф, как `d3` —
  // метка, и вот строка, которая это объясняет.

  "help.where.ship.3": "⌂ слева на схеме — твой буксир, дорога домой.",

  // обзор

  "stop.tug": "Это твой буксир, а не дереликт: исследовать тут нечего.",
  "stop.noFurther": "{hull}: дальше не пройти, {n, one: остался # отсек, few: осталось # отсека, many: осталось # отсеков}.",
};
