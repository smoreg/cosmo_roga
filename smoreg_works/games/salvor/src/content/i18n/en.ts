/**
 * Every word the game says, in English — and the source of every key.
 *
 * `Key` is `keyof typeof EN` (`keys.ts`), so this file decides what the other
 * two have to answer for: a row added here and forgotten in `es.ts` or `ru.ts`
 * is a compile error. Adding a line to the game is therefore always three
 * edits, in this order, and never two.
 *
 * The format is `{name}` for a value and `{n, one: …, other: …}` for a count,
 * with `#` inside a form standing for the count itself (`src/i18n.ts`). There
 * is no other syntax and no library behind it.
 *
 * Order is the order of the screen: what a compartment and its contents are
 * called, then the log, then the refusals, then the panel and the cards. Each
 * block is alphabetical inside itself so that three tables can be read side by
 * side.
 */
export const EN = {
  // ----------------------------------------------------------- compartments

  // The generator stamps the entry compartment `DOCKING`, not the catalogue
  // name, and the design doc's mock-up reads `go d1  DOCKING   open`.
  "room.docking": "DOCKING",
  "room.cargo": "CARGO BAY",
  "room.corridor": "CORRIDOR RING",
  "room.storage": "STORAGE",
  "room.maintenance": "MAINTENANCE",
  "room.hab": "HAB BLOCK",
  "room.mess": "MESS",
  "room.hydroponics": "HYDROPONICS",
  "room.med": "MED BAY",
  "room.lab": "LAB",
  "room.quarantine": "QUARANTINE",
  "room.engineering": "ENGINEERING",
  "room.workshop": "WORKSHOP",
  "room.armory": "ARMORY",
  "room.reactor": "REACTOR",
  "room.control": "CONTROL",
  "room.coreaccess": "CORE ACCESS",
  "room.lifesupport": "LIFE SUPPORT",
  "room.cryo": "CRYO",
  "room.sensors": "SENSOR BAY",
  "room.brig": "BRIG",
  "room.escapepods": "ESCAPE PODS",

  // The tug's own four, which are stations as well as compartments.
  "room.dock": "DOCK",
  "room.hold": "HOLD",
  "room.bench": "BENCH",
  "room.helm": "HELM",

  // ---------------------------------------------------------------- the rack

  "module.cutter": "CUTTER",
  "module.thrusters": "THRUSTERS",
  "module.scanner": "SCANNER",
  "module.plating": "PLATING",
  "module.cell": "CELL",
  "module.emp": "EMP",
  "module.welder": "WELDER",
  "module.laser": "LASER",
  "module.spike": "SPIKE",
  "module.emitter": "EMITTER",
  "module.baffle": "BAFFLE",

  // How a module is named inside a sentence, rather than shouted on the panel.
  "noun.cutter": "cutter",
  "noun.thrusters": "thrusters",
  "noun.scanner": "scanner",
  "noun.plating": "plating",
  "noun.cell": "power cell",
  "noun.emp": "EMP",
  "noun.welder": "welder",
  "noun.laser": "laser",
  "noun.spike": "spike",
  "noun.emitter": "emitter",
  "noun.baffle": "baffle",

  // Said once, the turn a module burns out. Each names what is now impossible.
  "burn.cutter": "Your CUTTER burns out. You are down to ramming.",
  "burn.thrusters": "Your THRUSTERS burn out. You crawl on manipulators.",
  "burn.scanner": "Your SCANNER burns out. The ship goes dark beyond this door.",
  "burn.plating": "Your PLATING burns out. Nothing stands between the next hit and your core.",
  "burn.cell": "Your CELL burns out. Bulkheads will have to be cut.",
  "burn.emp": "Your EMP burns out. The charge dies in the coil.",
  "burn.welder": "Your WELDER burns out. No more field repairs.",
  "burn.laser": "Your LASER burns out. The lens goes cloudy and dead.",
  "burn.spike": "Your SPIKE burns out. What is locked stays locked.",
  "burn.emitter": "Your EMITTER burns out. Everything is in reach again, the hard way.",
  "burn.baffle": "Your BAFFLE burns out. The ship can hear you again.",

  // ------------------------------------------------------------- the machines

  "machine.maintenance-bot": "maintenance bot",
  "machine.feral-drone": "feral drone",
  "machine.scout": "scout",
  "machine.security-unit": "security unit",
  "machine.welder-bot": "welder bot",
  "machine.hauler": "hauler",
  "machine.scrapper": "scrapper",
  "machine.arc-sentinel": "arc sentinel",
  "machine.sentry-turret": "sentry turret",
  "machine.jammer": "jammer",
  "machine.crawler": "crawler",
  "machine.bloom": "bloom",
  "machine.enforcer": "enforcer",
  "machine.ghost": "ghost",
  "machine.rival-drone": "rival drone",

  // ---------------------------------------------------------------- the hulls

  "hull.scrapper": "SCRAPPER",
  "hull.spark": "SPARK",
  "hull.ghost": "GHOST",

  "trait.scrapper": "6 slots, core 3",
  "trait.spark": "7 slots, core 4, THR 120",
  "trait.ghost": "8 slots, core 5, THR 140",

  // ------------------------------------------------------------- the derelicts

  "derelict.freighter": "freighter",
  "derelict.laboratory": "laboratory",
  "derelict.military": "military",
  "derelict.smuggler": "smuggler",
  "derelict.corsair": "corsair",
  "derelict.quarantine": "quarantine",
  "derelict.fathers-tug": "father's tug",

  "derelict.flavour": "{callsign} · {hull} · {first} · {second}",

  "flavour.freighter.0": "bulk hauler",
  "flavour.freighter.1": "fission reactor",
  "flavour.freighter.2": "ion drive",
  "flavour.freighter.3": "ore run",
  "flavour.freighter.4": "long haul",
  "flavour.laboratory.0": "research hull",
  "flavour.laboratory.1": "isotope reactor",
  "flavour.laboratory.2": "survey drive",
  "flavour.laboratory.3": "deep survey",
  "flavour.laboratory.4": "no manifest",
  "flavour.military.0": "patrol cutter",
  "flavour.military.1": "shielded reactor",
  "flavour.military.2": "military drive",
  "flavour.military.3": "border patrol",
  "flavour.military.4": "lost with all hands",
  "flavour.smuggler.0": "fast hauler",
  "flavour.smuggler.1": "stripped reactor",
  "flavour.smuggler.2": "smuggler's drive",
  "flavour.smuggler.3": "no registry",
  "flavour.smuggler.4": "three false holds",
  "flavour.corsair.0": "raider",
  "flavour.corsair.1": "overdriven reactor",
  "flavour.corsair.2": "boarding drive",
  "flavour.corsair.3": "taken by boarders",
  "flavour.corsair.4": "prize crew aboard",
  "flavour.quarantine.0": "medical transport",
  "flavour.quarantine.1": "shielded reactor",
  "flavour.quarantine.2": "long-haul drive",
  "flavour.quarantine.3": "sealed from inside",
  "flavour.quarantine.4": "no distress call",
  "flavour.fathers-tug.0": "salvage tug",
  "flavour.fathers-tug.1": "fission reactor",
  "flavour.fathers-tug.2": "ion drive",
  "flavour.fathers-tug.3": "your father's callsign",
  "flavour.fathers-tug.4": "missing eleven years",

  // --------------------------------------------------- the ship's own systems

  "system.engine": "ENGINE",
  "system.core": "CORE",
  "system.terminal": "TERMINAL",

  "system.short.engine": "engine",
  "system.short.core": "core",
  "system.short.terminal": "term",

  "thing.system.engine": "the engine",
  "thing.system.core": "the core",
  "thing.system.terminal": "the terminal",

  "log.system.online.engine": "ENGINE ONLINE. The ship notices.",
  "log.system.online.core": "CORE ONLINE. The ship notices.",
  "log.system.online.terminal": "TERMINAL ONLINE. The ship notices.",

  // ------------------------------------------------------------- the charters

  "charter.name.salvage": "SALVAGE",
  "charter.name.retrieve": "RETRIEVE",
  "charter.name.upload": "UPLOAD",
  "charter.name.neutralize": "NEUTRALIZE",

  "charter.salvage": "SALVAGE · bring home {need} CR of salvage",
  "charter.retrieve": "RETRIEVE · carry out the marked crate from the {room}",
  "charter.upload": "UPLOAD · five turns at the console in the {room}",
  "charter.neutralize": "NEUTRALIZE · engine, core and terminal online, then leave",

  // ----------------------------------------------- door verbs and door states

  "verb.go": "go",
  "verb.leave": "leave",
  "verb.key": "key",
  "verb.power": "power",
  "verb.spike": "spike",
  "verb.cut": "cut",
  "verb.weld": "weld",
  "verb.close": "close",
  // The head of a locked door's line: not a way through it but the choice
  // between the ways, which is a list of its own one level down.
  "verb.open": "open",

  // What each way through a lock costs, beside its own word in that list:
  // turns and noise, the two numbers the choice turns on.
  "cost.key": "1 turn, silent",
  "cost.power": "1 turn, noise 6",
  "cost.spike": "2 turns, noise 4",
  "cost.cut": "3 turns, noise 9",

  "state.open": "open",
  "state.closed": "closed",
  "state.locked": "locked",
  "state.sealed": "sealed",
  "state.broken": "broken",
  "state.airlock": "airlock",
  "state.out": "out",

  // ------------------------------------------------------------- small words

  "label.you": "You",
  "label.other": "the {name}",
  "label.something": "Something",
  "word.a": "a {name}",
  "word.or": "{first} or {last}",
  "word.bulkhead": "{door} bulkhead",
  "word.cr": "{n} CR",
  "word.crate": "crate",
  "word.scrap": "scrap",
  "word.derelict": "derelict",
  "word.keycard": "keycard",
  "word.module": "module",
  "word.system": "system",
  "word.theVoyage": "the voyage",
  "word.tug": "TUG",

  // What auto-explore stops for, by the noun it stops on.
  "thing.partsCrate": "a parts crate",
  "thing.scrap": "scrap",
  "thing.body": "a crew body",
  "thing.cargo": "a cargo crate",
  "thing.contraband": "a contraband crate",
  "thing.console": "a console",
  "thing.package": "a charter package",

  // ------------------------------------------------------------------- the log

  "log.opening": "The tug is tied to something dark, and the rack has one drone left on it.",
  "log.win": "The airlock closes behind you. The tug pulls away with what you took.",
  "log.death": "Core breach. The drone goes dark. The ship keeps what it takes.",

  "log.hit.module": "{source} hits your {module} ({left}/{max}).",
  "log.machine.dies": "{target} dies.",
  "log.scrap.drop": "The {machine} collapses into scrap: {module}.",

  "log.door.key": "The keycard reader blinks green. {door} slides open.",
  "log.door.power": "You dump the CELL into {door}. The lock lets go.",
  "log.door.cut.on": "You cut at {door}. {left} more {left, one: turn, other: turns} of it.",
  "log.door.cut.done": "{door} gives way with a shriek.",
  "log.door.weld.on": "You run the welder down the seam of {door}.",
  "log.door.weld.done": "{door} is welded shut. It stays that way.",
  "log.door.close": "You pull {door} shut.",
  "log.spike.on": "You work the {spike} into the {target}.",
  "log.spike.done": "The {target} gives. You are through.",

  "log.body.plain": "You go through the body: {cr} CR.",
  "log.body.key": "You go through the body: {cr} CR and a keycard.",
  "log.crate.open": "You break the {crate} open: {cr} CR into the hold.",
  "log.cargo.take": "You lever the marked crate out of its rack.",
  "log.upload.on": "The console gives it up slowly. {left} more {left, one: turn, other: turns} of it.",
  "log.upload.done": "The upload completes. Whatever it was, the tug has it.",
  "log.console.away": "You step away from the console. It starts over.",

  "log.work.break.cut": "You break off the cut.",
  "log.work.break.weld": "You break off the weld.",
  "log.work.break.splice": "You break off the splice.",
  "log.work.break.purge": "You break off the purge.",

  "log.carry.take": "{module} {left}/{max} taken. Carrying {n} of {limit}.",
  "log.carry.home": "{n} carried home, into the hold.",
  "log.salvage.graft": "You graft the {module} on. It is better than new ({left}/{max}).",
  "log.salvage.mend": "You work the scrap into your {module} ({left}/{max}).",
  "log.salvage.install": "You pull a {module} ({left}/{max}) from the wreck.",
  "log.weld": "You weld the {module} back to {left}/{max}.",
  "log.pulse": "Sensor pulse. Two doors of ship come back on the schematic.",
  "log.emp": "The coil discharges. {n, one: One machine seizes, other: # machines seize} up. {left} left.",
  "log.emitter.hit": "Your {emitter} hits {target} for {n} ({hp}/{max}).",

  "log.system.work": "You work the {tool} into the {system}. {left} more {left, one: turn, other: turns} of it.",
  "log.system.advance": "The charter pays on account:",
  "log.system.all": "All three online. Press `<` to leave through the airlock — the hull is yours.",
  "log.system.all.paid": "All three online. Press `<` to leave through the airlock — the hull is yours: +{cr} CR.",

  "log.alert.hunter": "An {hunter} wakes up in {room}.",
  "log.alert.busy": "The ship has been busy: {n} more machines aboard.",
  "log.alert.calm": "The ship stops looking for you.",

  "log.bloom.hatch": "The bloom splits. Something pulls itself out.",
  "log.bloom.strip": "You cut the bloom open: {cr} CR of biomass, and nothing to bolt on.",
  "log.bloom.dies": "The bloom sags open. Biomass, and no parts in it.",

  "log.ghost.sighted": "Something with your callsign is moving in there.",
  "log.ghost.drop": "The ghost comes apart. Your old rack is on the floor.",

  "log.rival.aboard": "A rival drone is aboard. It is not here for the salvage.",
  "log.rival.gone": "The rival breaks off and runs for its own lock.",
  "log.hull.taken": "{hull} is already on the other tug's line. Three systems for nothing.",
  "log.rival.lost": "Another tug has the ship. You have twenty turns.",
  "log.rival.jumped": "The rival's tug jumps with the ship. Your drone goes with it.",
  "log.rival.system": "The rival brings the {system} online.",
  "log.rival.drops": "The rival drops {article} {module}.",

  // The bargain (G34). Every row of it lives here, with the rest of what the
  // competitor says, rather than in the action and panel blocks it would
  // otherwise be filed under: three lines, two refusals and a gauge are one
  // mechanic, and a translator reading down this file should meet them at once.
  "action.rival.payoff": "pay off RIVAL ({price} CR)",
  "action.rival.aside": "stand aside (+{price} CR)",
  "action.rival.split": "split the sale",
  "why.rival.spent": "It has nothing left to bring up.",
  "why.rival.notHere": "The rival is not in this compartment.",
  "why.rival.dealt": "The deal on this hull is already struck.",
  "log.rival.deal.paid": "The rival takes the credits and goes. Its haul stays.",
  "log.rival.deal.sold": "The rival pays for the run of the ship:",
  "log.rival.deal.split": "You shake on half the hull. It works with you now.",
  "log.rival.raises": "The rival brings the {system} online for you.",
  "panel.deal": "DEAL  {deal}",
  "word.deal.paid": "paid off",
  "word.deal.sold": "stood aside",
  "word.deal.split": "split",

  "log.virus.caught": "The scrap carries something. {virus} in your {module}.",
  "log.virus.rot": "{virus} eats into your {module}: {left} left.",
  "log.virus.rot.burned": "{virus} finishes your {module}. The module is gone.",
  "log.virus.skim": "{virus} takes {amount} CR off the account.",
  "log.virus.skim.empty": "{virus} goes through the account. Nothing to take.",
  "log.virus.core": "{virus} reaches the core. {left} left.",
  "log.virus.twitch": "Your {module} twitches. {virus} picked where the blow lands.",
  "log.virus.moves": "The virus leaves your {from} for your {to}.",
  "log.virus.purge.on": "You run the welder over your {module}.",
  "log.virus.purge.done": "The purge takes. Your {module} is clean.",
  "log.virus.burned": "The virus goes with the burned module.",

  "log.helm.board": "The board at the HELM: {flavour}.",
  "log.charter.signed": "Signed: {charter}.",
  "log.charter.filled": "{charter} filled:",
  "log.credit": "{why} +{amount} CR. {total} CR.",
  "log.hull.bought": "A {hull} comes off the rack: {trait}. {credits} CR left.",
  "log.hull.tow": "The {hull} goes under tow:",
  "log.hull.tow.split": "The {hull} goes under tow, the sale split:",
  "log.hold.emptied": "The hold is emptied:",
  "log.hold.sell": "Sold for good — {module}:",
  "log.hold.sell.sick": "Sold for good — infected {module}:",
  "log.hold.fit": "You bolt the {module} ({integrity}) into slot {slot}.",
  "log.bench.repair": "The bench takes your {module} back to {left}/{max}.",
  "log.bench.graft": "The bench grafts your {module} up to {left}/{max}.",
  "log.bench.clean": "The bench burns the virus out of your {module}.",
  "log.jump": "The tug burns for the {hull}. {credits} CR left.",
  "log.jump.warn": "{hull}: {up} of {of} systems online. A jump leaves the hull behind.",
  "log.voyage.undock": "The clamps let go.",
  "log.voyage.home": "The airlock cycles. The tug is waiting, and the derelict is still breathing.",
  "log.voyage.won": "The tug answers on your father's callsign. You take it home. You win.",
  "log.voyage.broke": "The rack is empty and so is the account. Voyage over.",
  "log.drone.lost": "The drone stops answering. Whatever it was carrying is aboard the derelict now.",

  // -------------------------------------------------------------- the hints

  "hint.exposure": "Hits land on whatever you last used.",
  "hint.burned": "A burned module is gone. Its slot is empty now.",
  "hint.scrap": "Scrap. Take it apart for a module, or graft it onto one you have.",
  "hint.blind": "Without a scanner you see only this room. Find one.",
  "hint.keycard": "A keycard. Doors marked [ ] read it.",
  "hint.death": "Your drone is still in there. It will not be friendly.",
  "hint.objective": "One of the ship's three systems. Raise all three, leave alive, and the tug sells the whole hull.",
  "hint.payout": "Nothing is paid until the drone is back through the airlock. Die out here and the hold dies with it.",
  "hint.sold": "Hold sold for {credits} CR. Hulls cost {hullPrice}.",
  "hint.shooting": "Shooting exposes what you shot with: the answer lands on the EMITTER, the most brittle thing on the rack.",
  "hint.sell": "Sold for good: nobody sells modules back. To keep one, stow it in the hold instead.",
  "hint.training": "TRAINING. The five things this game will not tell you twice, up front:",
  "hint.virus": "Salvage can carry the ship's virus. Every hull has its own. A welder cleans any of them.",
  "strain.spasm": "SPASM",
  "strain.rot": "ROT",
  "strain.leech": "LEECH",
  "strain.leash": "LEASH",

  // ----------------------------------------------------------- the refusals

  "why.credits": "Not enough credits.",
  "why.line.none": "Nothing on that line.",
  "why.notHere": "Not from here.",
  "why.jammed": "Static. Nothing responds.",

  "why.door.notHere": "There is no such door in this compartment.",
  "why.door.notLocked": "{door} is not locked.",
  "why.door.noLock": "{door} has no lock to pick.",
  "why.door.noCut": "{door} does not need cutting.",
  "why.door.noWeld": "{door} cannot be welded.",
  "why.door.notOpen": "{door} is not open.",
  "why.door.noKeycard": "No keycard on the drone.",
  "why.door.noKeycardHere": "No lock here a keycard would open.",
  "why.door.wallsIn": "Welding {door} would seal the drone in here.",
  "why.door.state": "The {door} door is {state}.",
  "why.room.noRoute": "No route to {room}.",

  "why.module.missing": "No {module} in the rack.",
  "why.module.notInstalled": "No {module} installed.",
  "why.module.passive": "That module has no active use.",
  "why.module.whole": "The {module} is whole.",
  "why.module.grafted": "The {module} takes no more grafting.",
  "why.module.clean": "The {module} is clean.",
  "why.rig.emptySlot": "Empty slot.",
  "why.slot.empty": "Nothing in that slot.",
  "why.rack.full": "No free slot. Sell something first.",
  "why.rack.burnFirst": "No free slot. Something has to burn first.",
  "why.graft.full": "Nothing left to graft.",
  "why.repair.none": "Nothing to repair.",
  "why.breach.nothing": "Nothing to breach here.",
  "why.shoot.none": "Nothing in the line of fire.",
  "why.emp.spent": "{emp} is spent.",
  "why.emp.none": "Nothing in range.",
  "why.salvage.noRig": "Nothing to take apart.",
  "why.carry.full": "The drone can carry {n} and no more.",
  "why.salvage.none": "There is nothing to take apart here.",
  "why.biomass.none": "There is no biomass here.",

  "why.body.none": "There is nobody to search here.",
  "why.body.searched": "You have been through that one already.",
  "why.cargo.none": "There is nothing to load here.",
  "why.cargo.carrying": "You are already carrying it.",
  "why.console.none": "There is no console here.",
  "why.console.done": "That console has already given up what it had.",

  "why.system.none": "There is nothing here to bring online.",
  "why.system.up": "The {system} is already online.",
  "why.system.needs": "Needs {tools}.",

  "why.virus.none": "Nothing in the rack is infected.",
  "why.virus.clean": "That module is clean.",

  "why.tug.only": "That is a job for the tug, not for out here.",
  "why.hull.none": "No such hull on the rack.",
  "why.hold.noDrone": "There is no drone to fit it to.",
  "why.hold.none": "Nothing in the hold under that number.",
  "why.charter.none": "Nothing on the board under that number.",
  "why.charter.late": "The {hull} is already open. Nobody signs after that.",
  "why.undock.aboard": "You are already aboard.",
  "why.undock.noDrone": "There is no drone on the rails.",
  "why.undock.sold": "The {hull} is under tow. Jump to the next hull.",
  "why.undock.tow": "The {hull} is under tow.",
  "why.jump.aboard": "The tug jumps; the drone cannot.",
  "why.jump.last": "There is nothing further out. This is the last hull of the voyage.",
  "why.jump.first": "The {price} CR jump comes first.",

  // ------------------------------------------------ the numbered action list

  "action.attack": "attack {target} {hp}/{max}",
  "action.shoot": "shoot {target}",
  "action.carry": "take {module} {left}/{max}",
  "action.salvage": "salvage {module} {left}/{max}",
  "action.hide": "hide",
  "action.search": "search crew body",
  "action.strip": "strip biomass ({cr} CR)",
  "action.purge": "purge {module} (welder, {left} {left, one: turn, other: turns})",
  "action.work": "work {system}: {tool} {left}",
  "action.workBare": "work {system} ({left})",
  "action.take": "take {crate} ({cr} CR)",
  "action.takeMarked": "take the marked crate",
  "action.upload": "upload ({left} {left, one: turn, other: turns})",
  "action.buy": "buy {hull} {price} CR",
  "action.undock": "cast off → {hull}",
  "action.repair": "{module} {price} CR",
  "action.clean": "clean {module} ({price} CR)",
  "action.graft": "{module} +1 base  {price} CR",
  "action.order": "buy {module} {price} CR",
  "action.fit": "{module} {integrity}",
  "action.sell": "{module} {left}/{max}  {price} CR",
  "action.charter": "take {charter} ({price})",
  "action.jump": "jump → {hull} {price} CR",
  // The last line of a door's own list, and the only place on it the door is
  // named: one level down there is no heading to carry `d3`.
  "action.back": "back ({door})",
  // The last line of the door list (`m`). No door is named on it: none is
  // chosen yet, and the compartment is one keystroke behind it.
  "action.backRoom": "back",
  // The travel list: how far, in doors, and the compartment nothing reaches.
  "dist.doors": "{n, one: # door, other: # doors}",
  "dist.none": "no way",

  "crate.cargo": "cargo crate",
  "crate.contraband": "contraband crate",

  // ----------------------------------------------------------- what `o` says

  "stop.over": "The run is over.",
  "stop.machine": "You see {machine} in {room}.",
  "stop.hit": "Something is hitting you.",
  "stop.alert": "Alert rising.",
  "stop.thing": "Something here: {thing}.",
  "stop.explored": "{hull} explored. {back}",
  "stop.airlock.none": "There is no way back to the airlock.",
  "stop.airlock.here": "You are standing at the airlock.",
  "stop.airlock.away": "The airlock is {n} {n, one: door, other: doors} back.",
  "stop.noTarget": "No target in sight.",
  "stop.noWay": "No way through.",
  "stop.arrived": "You reach {room}.",
  "stop.shut": "The way on is shut: {door} ({state}).",

  // ------------------------------------------------------------- the panel

  "panel.turn": "turn {n}",
  "panel.sortie": "sortie {n}",
  "panel.actions": "ACTIONS",
  "panel.more": "… {n} more (↑↓)",
  "panel.room": "{room} {label}",
  "panel.doorTo": "{door} → {room}",
  "panel.roomDoors": "{room} {label}  doors {doors}",
  "panel.doorMore": "… {n} more {n, one: door, other: doors}",
  "panel.roomMore": "… {n} more here",
  "panel.letter.move": "m move",
  "panel.letter.brace": ". brace",
  "panel.letter.hide": "h hide",
  "panel.letter.leave": "< leave",
  "panel.letters.tug": "0 back  ? help",
  "panel.letters": "o explore  Tab fight  ? help",
  "panel.nextHit": "NEXT HIT LANDS ON",
  "panel.core": "CORE  {dots}",
  "panel.slot.empty": "-- empty --",
  "panel.slot.burned": "-- burned --",
  "panel.keys": "KEYS  {n}",
  "panel.alert": "ALERT {gauge}",
  "panel.hunter": "HUNTER aboard",
  "panel.rival": "RIVAL {gauge}",
  "panel.evac": "EVAC {n}",
  "panel.goal": "GOAL  NEUTRALIZE  {cr} CR",
  "panel.goal.bare": "GOAL  NEUTRALIZE",
  "panel.goal.done": "ALL THREE ONLINE  +{cr} CR",
  "panel.goal.out": "< out through the airlock",
  "panel.goal.towed": "HULL TAKEN  under tow",
  "panel.goal.work": "{mark} {system} {tool}, {left, one: # turn, other: # turns}",
  "panel.charters": "CHARTERS",
  "panel.charter.plain": "{mark} {name}",
  "panel.charter.where": "{mark} {name} · {room}",
  "panel.charter.loot": "{mark} {name} {have}/{need} CR",
  "panel.virus": "{virus} in {module}",
  "panel.credits": "CREDITS {n}",
  "panel.hold": "HOLD  {n} CR",
  "panel.droneLost": "NO DRONE ON THE RAILS",
  "panel.cheapest": "CHEAPEST HULL {n}",
  "panel.derelict": "DERELICT {hull}",
  "panel.tow": "under tow",
  "panel.quiet": "quiet",
  "panel.alertAt": "alert {n}",
  "panel.hullState": "{alert} · {up}/{of} up",

  "ship.rooms": "{n} rooms",
  "ship.seen": "{n} seen",
  "ship.scanned": "{n} scanned",
  "schematic.hidden": "» {n} {n, one: room, other: rooms}",
  "schematic.behind": "« {n} {n, one: room, other: rooms}",

  // Added with the tug-clarity pass (G40).
  "why.rack.hullFull": "The rack is full.",
  "action.hull.onRack": "{hull} — on the rack",
  "panel.contact.hit": "hit {module}",

  // The contacts block, made unmissable (G47). The bar is drawn to the panel's
  // full width around whichever of the two labels applies, so both are short by
  // obligation: what is left of the row after the label is the rule.
  "panel.contacts.here": "ENEMY IN HERE: {n}",
  "panel.contacts.near": "THROUGH THE DOOR: {n}",
  "panel.contactsMore": "… {n} more in sight",
  "danger.melee": "melee",
  "danger.door": "shoots",
  "danger.jam": "jams",
  "danger.noScrap": "no scrap",
  "danger.hunter": "hunter",
  "danger.still": "sits",
  "log.contacts.here": "In here: {list}.",
  "log.contacts.one": "{machine} {hp}, {danger}",
  "panel.head.tug": "SALVOR  tug",
  "panel.head.tugTo": "SALVOR  tug → {hull}",
  "help.where.tug.head": "WHERE YOU ARE — your own tug",
  "help.where.tug.1": "One screen, no walking: buy a drone, mend it, stow",
  "help.where.tug.2": "or sell what you will not fly, charter, cast off.",
  "help.where.ship.head": "WHERE YOU ARE — inside a derelict",
  "help.where.ship.1": "Take what pays, raise the ship's systems, then out",
  "help.where.ship.2": "through the airlock: the hold is money only once home.",
  "help.name.pick": "PICK",
  "help.key.pick": "up/down  enter does the marked line",
  "help.name.move": "MOVE",
  "ship.yourTug": "your tug",
  "ship.dockedTo": "docked to {hull}",
  "banner.ahead": "DERELICT ahead: {hull} · {rooms}",
  "banner.tug": "YOUR TUG «{callsign}» · docked to {hull}",
  "banner.derelict": "DERELICT {parts}",
  "word.unknownHull": "unknown hull",
  "log.opening.tug": "Your tug. All of it is on the list: drone, repairs, charters, cast off. Press ? any time.",
  "log.opening.voyage": "{callsign}. {hulls} hulls out; the last one is your father's tug.",

  // ---------------------------------------------------------- title and help

  "title.name": "SALVOR",
  "title.pitch.1": "You run a tug. Into the dead ship goes a drone.",
  "title.pitch.2": "It has no hit points — it has modules, and every hit",
  "title.pitch.3": "burns what you just used. Buy the next one, go again.",
  "title.keys": "1 NEW VOYAGE   2 TRAINING   3 HELP",
  "title.start": "L language · V view · any other key casts off",

  "help.page.more": "{n}/{of}   ? next page   esc closes",
  "help.page.last": "{n}/{of}   ? closes   esc closes",
  "help.title": "CONTROLS",

  "help.name.act": "ACT",
  "help.name.brace": "BRACE",
  "help.name.hide": "HIDE",
  "help.name.explore": "EXPLORE",
  "help.name.engage": "ENGAGE",
  "help.name.keycard": "KEYCARD",
  "help.name.help": "HELP",

  "help.key.act": "1-9 0  a line of the list",
  "help.key.brace": ". or space   (braces: PLATING)",
  "help.key.hide": "h   where the compartment has cover",
  "help.key.move": "m   where to walk · <   out, or towards it",
  "help.key.explore": "o   walk on; stops on anything new",
  "help.key.engage": "tab / shift+tab  shoot, or melee only",
  "help.key.scanner": "s   pulse: two doors out, loud",
  "help.key.emp": "e   stun this compartment, 2 charges",
  "help.key.welder": "w   mend the weakest module",
  "help.key.cell": "p   power a locked door or console",
  "help.key.spike": "K   breach a lock, two turns, quiet",
  "help.key.emitter": "f   shoot into the line of fire",
  "help.key.cutter": "c   cut a door, three turns, loud",
  "help.key.keycard": "a   spend a card on a lock, silent",
  "help.key.help": "?   VIEW V  LANG L  NEW shift+R  CLOSE esc",

  "help.rule.head": "EXPOSED — the one rule",
  "help.rule.1": "A blow lands on the module you just used: the one",
  "help.rule.2": "marked ◀ in the rack. With nothing exposed it hits",
  "help.rule.3": "PLATING, then CORE. At 0 a module burns out for",
  "help.rule.4": "good, and the empty slot it leaves is the only",
  "help.rule.5": "place salvage fits.",

  "help.list.head": "ACTIONS — the list on the right",
  "help.list.1": "Everything you can do here is a numbered line.",
  "help.list.2": "A dim one you cannot press yet, and it says why.",
  "help.list.3": "A locked door opens its own list; 0 goes back.",

  "help.charter.head": "CHARTERS — what a sortie is for",
  "help.charter.1": "Signed at the HELM before you cast off, paid when",
  "help.charter.2": "the drone is home. SALVAGE wants credits in the",
  "help.charter.3": "hold. NEUTRALIZE wants engine, core and terminal",
  "help.charter.4": "online — that one sells the whole hull.",

  // ------------------------------------------------------- the endings, and

  "end.dead": "THE ACCOUNT IS EMPTY",
  "end.lost": "DRONE LOST",
  "end.won": "YOUR FATHER'S TUG IS YOURS",
  "end.sold": "SHIP SOLD",
  "end.dead.why": "No drone on the rails and nothing left to buy one with.",
  "end.won.why": "The last hull of the itinerary is under tow. The voyage is over.",
  "end.again": "shift+R for a new run",
  "end.go": "any key — the voyage goes on",
  "end.summary":
    "{cr} CR · {rooms} compartments · {turns} turns · {kills} machines scrapped · " +
    "{burned} modules burned",

  // ------------------------------------------------------- the error screen

  "crash.title": "SOMETHING BROKE",
  "crash.seed": "seed {seed} · {voyage} · turn {turn}",
  "crash.sortie": "sortie {n}",
  "crash.hull": "hull {n}",
  "crash.hullOf": "hull {n}/{of}",
  "crash.report": "copy this URL and report it",
  "crash.unknown": "unknown error",


  // ------------------------------------------------ the tug as a menu (G53)

  // The five verbs the tug is read by. Groups, not compartments: DOCK, HOLD,
  // BENCH and HELM were the inside of the ship talking, and a player who has
  // never been aboard one cannot guess which of the four mends a module
  // (docs/tasks/G53-tug-is-a-menu.md, 1).
  "tug.group.drone": "DRONE",
  "tug.group.repair": "REPAIR",
  "tug.group.rig": "RIG",
  "tug.group.sell": "SELL",
  "tug.group.voyage": "CHARTERS",
  "tug.group.jump": "NEXT HULL",

  // One verb, one line: the modules it could be aimed at are the list under it.
  "action.pick.buy": "buy a hull ▸",
  // What a plain row is called on the turn it has nothing to name.
  "action.dead.undock": "cast off",
  "action.dead.clean": "clean a module",
  "action.dead.jump": "jump to the next hull",
  "action.pick.repair": "repair a module ▸",
  "action.pick.graft": "graft a module ▸ {price} CR",
  "action.pick.stow": "stow a module ▸",
  "action.pick.fit": "fit from the hold ▸",
  "action.pick.sell": "sell for good ▸",
  "action.pick.charter": "take a charter ▸",

  // A line of one of those lists. The module's state is on it because that is
  // what the choice turns on, and it is the one thing the old per-slot lines
  // never said.
  "action.one.hull": "{hull}  {price} CR",
  "action.one.module": "{module} {left}/{max}",
  "action.one.modulePriced": "{module} {left}/{max}  {price} CR",
  "action.one.held": "{module} {integrity}",
  "action.one.charter": "{charter}  {price}",

  "action.stow": "{module} {left}/{max}",
  "log.stock.buy": "{module} bought for {price} CR. In the hold. {credits} CR left.",
  "log.hold.fitted": "{n} out of the hold, onto the rails.",
  "log.hold.stow": "The hold takes the {module} ({integrity}/{max}), whole.",

  "why.stock.none": "The shelf has nothing left.",
  "why.hold.full": "The hold already holds {n}. Fit one back first.",
  "why.hold.empty": "The hold is empty.",
  "why.rig.whole": "Nothing in the rack is damaged.",
  "why.rig.grafted": "Nothing in the rack takes more grafting.",
  "why.rig.empty": "Nothing in the rack.",
  "why.rig.last": "The last module stays on the rails. A rack with nothing in it flies nowhere.",
  "why.rig.clean": "Nothing in the rack is infected.",
  "why.charter.gone": "Every charter on this board is signed.",
  "why.tug.noDrone": "No drone on the rails. Buy a hull first.",
  "why.tug.noWalk": "Nowhere to walk on the tug: it is all on the list.",

  // The board that stands where the schematic does while the drone is home.
  "board.derelict": "DERELICT {hull} · {alert}",
  "board.worth": "NEUTRALIZE {up}/{of} — the hull sells for {price} CR",
  "board.rack": "HULLS ON THE RACK",
  "board.hull": "{hull}  {price} CR  {trait}",
  "board.hull.yours": "{hull}  ← on the rails",
  "board.sorties": "sorties {n} · drones lost {lost}",
  "board.mode": "No alert here, nothing to walk to. It is all on the list.",
  // --------------------------------------------------------------- the engine
  //
  // Lines `packages/engine` writes. It composes English of its own for a game
  // with no table, and these rows are what this one says instead — the wording
  // here is the engine's, word for word, except the airlock: the engine named a
  // command, and the player has a key (`ui/logline.ts`).
  //
  // `{Actor}` is the machine with a capital, `{actor}` without: which one a
  // sentence needs is the sentence's business.

  "engine.hit.you": "You hit {target} for {amount} ({hp}/{max}).",
  "engine.hit.taken": "{Actor} hits you for {amount}.",
  "engine.hit.other": "{Actor} hits {target} for {amount} ({hp}/{max}).",
  "engine.dies": "{Target} dies.",
  "engine.cover.you": "You slip into cover.",
  "engine.cover.other": "{Actor} slips into cover.",

  "engine.door.open": "The door {door} slides open.",
  "engine.door.breached": "{door} gives way with a shriek.",
  "engine.door.cut.you": "You cut at {door}.",
  "engine.door.cut.other": "{Actor} cuts at {door}.",

  "engine.fail.airlock": "That is the airlock. Press < to go back to the tug.",
  "engine.fail.attack.ally": "You will not strike an ally.",
  "engine.fail.attack.away": "{Target} is not in this compartment.",
  "engine.fail.attack.gone": "Nothing to attack there.",
  "engine.fail.attack.sight": "{Target} is not in the line of fire.",
  "engine.fail.cover": "There is nothing to hide behind here.",
  "engine.fail.door.elsewhere": "The {door} door is not in this compartment.",
  "engine.fail.door.gone": "There is no such door.",
  "engine.fail.door.shut": "The {door} door is {state}.",
  "engine.fail.door.size": "{Actor} cannot fit through {door}.",
  "engine.fail.leave.none": "There is no airlock here.",
  "engine.fail.leave.other": "Only the drone leaves the ship.",
  "engine.fail.nothing": "Nothing to do.",
  "engine.fail.over": "The run is over.",

  // ------------------------------------------------------- the schematic
  //
  // The mark on the box hanging off the airlock. Three columns is no room
  // for a word in three languages, so the tug is a glyph like `d3` is a
  // label, and this row is where the picture gets explained.

  "help.where.ship.3": "⌂ at the left edge of the schematic is your tug.",

  // обзор

  "stop.tug": "This is your tug, not a derelict: nothing here to explore.",
  "stop.noFurther": "{hull}: no way further in, {n, one: # room, other: # rooms} left unexplored.",
} as const;
