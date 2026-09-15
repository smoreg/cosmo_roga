import type { RoomGame } from "@jamrog/engine";
import type { Key } from "../content/i18n/keys.js";
import { MAX_GRAFT, moduleBurnLine, moduleKind, moduleName, type ModuleId } from "../content/modules.js";
import { strainName, strainOf } from "../content/viruses.js";
import { t } from "../i18n.js";
import { virusOf } from "../systems/virus.js";
import { RELIC_MARK, capOf, rigOf } from "../twist/rig.js";

/**
 * What one row of the rack is, in words, for whoever is pointing at it.
 *
 * The rack is the loudest block on the panel and the least legible: `1 РЕЗАК
 * ▮▮▮▮▮▮▮ ◀` is four facts in eleven characters, and three of them are marks
 * nobody was ever told the meaning of — the arrow that says where the next blow
 * lands, the `+` the bench grafts on, the `!` a strain leaves. The owner,
 * playing the graphic view with a mouse: «наведение на модуль должно давать
 * инфо». The compartments of the map answer a hover the same way (`ui/web/
 * hex-svg.ts`, `readout`), and this is the panel's half of it.
 *
 * Not a word of it is written here. The name is the catalogue's, the numbers
 * are the ones the row already prints, what a module *does* is the line the
 * controls card prints for its key or the codex card for a relic, a burned bay
 * is the log line said the turn it burned, and a strain is named by the table
 * that owns strains. A readout that out-knew the rest of the screen would be a
 * second answer to a question already answered.
 */
export interface RackReadout {
  /** The slot and what is in it: `1 CUTTER`. */
  readonly head: string;
  /** Everything else, one statement per row. */
  readonly lines: readonly string[];
}

/**
 * What each module does, as the row that already says it.
 *
 * Seven of them are spent by a key, and the controls card words every one of
 * those — `c   cut a door, three turns, loud` — which is exactly "what it does"
 * with the key in front of it, and the key is worth having here too. The three
 * relics have codex cards, and the card's first paragraph is what the relic is.
 * The four left over are passive and have neither: a line each, and they are
 * the only new sentences this feature needed.
 *
 * A `Record` rather than a `Partial`, so a module added to the catalogue does
 * not compile until somebody has said what it does.
 */
const DOES: Record<ModuleId, Key> = {
  cutter: "help.key.cutter",
  scanner: "help.key.scanner",
  emp: "help.key.emp",
  welder: "help.key.welder",
  cell: "help.key.cell",
  spike: "help.key.spike",
  emitter: "help.key.emitter",
  thrusters: "rack.does.thrusters",
  plating: "rack.does.plating",
  laser: "rack.does.laser",
  baffle: "rack.does.baffle",
  blade: "codex.blade.what",
  shocker: "codex.shocker.what",
  lattice: "codex.lattice.what",
};

/**
 * The readout for one slot, or nothing for a bay that has never held anything:
 * `-- empty --` is the whole of what an empty bay has to say, and a plate
 * repeating it is a plate in the way.
 */
export function rackReadout(game: RoomGame, slot: number): RackReadout | undefined {
  const rig = rigOf(game.player);
  if (!rig || slot < 0 || slot >= rig.slots.length) return undefined;
  const n = slot + 1;
  const fitted = rig.slots[slot];
  if (!fitted) {
    // A bay that burned says which module it lost, in the words the log used on
    // the turn it happened — the one sentence in the game about that loss.
    const scar = rig.scars[slot];
    return scar == null
      ? undefined
      : { head: `${n} ${t("panel.slot.burned")}`, lines: [moduleBurnLine(scar)] };
  }

  const kind = moduleKind(fitted.kind);
  const lines = [
    t("rack.read.hp", { left: fitted.integrity, max: capOf(fitted) }),
    t(DOES[kind.id]),
  ];
  // What it has left to spend, for the two modules that spend anything.
  if (kind.charges !== undefined) lines.push(t("rack.read.charges", { n: fitted.charges ?? 0 }));
  const bonus = fitted.bonus ?? 0;
  if (bonus > 0) lines.push(t("rack.read.graft", { n: bonus, max: MAX_GRAFT }));
  if (rig.exposed === slot) lines.push(t("rack.read.exposed"));
  // The strain, and the key that opens the window with the cures in it: the
  // row's own `!` is the only warning a player gets, and `v` is not on it.
  const virus = virusOf(game.player);
  if (virus !== undefined && virus.slot === slot) {
    lines.push(t("rack.read.virus", { virus: strainName(strainOf(virus.strain)) }));
    lines.push(t("help.key.virus"));
  }
  const named = kind.relic ? `${moduleName(kind.id)}${RELIC_MARK}` : moduleName(kind.id);
  return { head: `${n} ${named}`, lines };
}

/** Every rack row's readout, by slot, for a view that draws them all at once. */
export function rackReadouts(game: RoomGame): Map<number, RackReadout> {
  const out = new Map<number, RackReadout>();
  const rig = rigOf(game.player);
  if (!rig) return out;
  for (let i = 0; i < rig.slots.length; i++) {
    const read = rackReadout(game, i);
    if (read !== undefined) out.set(i, read);
  }
  return out;
}
