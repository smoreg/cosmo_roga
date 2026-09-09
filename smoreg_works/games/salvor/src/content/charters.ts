import type { Rng, Ship } from "@jamrog/engine";
import { CHARTER_KINDS, UPLOAD_FLAG, retrieveFlag, uploadFlag } from "./cards-derelicts.js";
import type { DerelictSpec } from "./derelicts.js";
import { t } from "../i18n.js";
import { zoneName } from "./zones.js";

/**
 * The two or three jobs on offer for one derelict (design-doc.md, "Чартеры").
 *
 * A charter is what the sortie is *for*, and it is a roll like everything else:
 * the same hull is a different trip depending on whether the tug is paying for
 * a crate out of the cryo bay or for five uninterrupted turns at a console.
 * They are taken on the HELM before the jump, because their marks have to be
 * part of the ship the generator then builds — which is why every charter with
 * a target carries the flag that puts its mark aboard.
 *
 * Nothing here reads the voyage. `doneBy` is handed the two numbers the payout
 * depends on and the ship itself, so this file stays content: the voyage owns
 * when the question is asked (on the way out through `a1`, and never on a drone
 * that died with the job finished) and what the answer is worth.
 *
 * A signed charter lives in `player.data.voyage`, which is a record that has to
 * survive being written out as JSON — so a charter is data and nothing else.
 * The test for "is it filled" is a table in this file, looked up by `id`; it
 * used to be a method on the record, which meant a voyage read back from a save
 * would have held charters that could no longer answer the question
 * (`tests/fuzz.test.ts`, `tests/persistence.test.ts`).
 */

export type CharterId = "salvage" | "retrieve" | "upload" | "neutralize";

/**
 * What a charter may ask about the run. The whole of it: credits' worth of
 * salvage the drone has brought home, and which of the ship's three systems are
 * online. `systems/voyage.ts` will have far more state than this, and a charter
 * that read it would be a charter that could not be tested without one.
 */
export interface CharterState {
  readonly loot: number;
  readonly online: readonly string[];
}

/**
 * One signed job, as plain data.
 *
 * Everything a charter is, is on this record: what it is, what it says, what it
 * pays, what it needs aboard and — for `SALVAGE` — the figure it asks for. No
 * behaviour, deliberately: see `doneBy` below.
 */
export interface Charter {
  readonly id: CharterId;
  /** The line the HELM lists it as, already in the language that is on. */
  readonly text: string;
  /** Credits on completion. `NEUTRALIZE` pays what the hull sells for. */
  readonly payout: number;
  /** The mark this charter needs aboard, and the compartment it belongs in. */
  readonly target?: { kind: string; mark: "*" | "&" };
}

/**
 * The three systems, by the names `systems/populate.ts` gives them. Three
 * strings rather than an import, for the same reason `cards.ts` describes the
 * rig instead of importing it: content that imports a system is content that
 * cannot be read without one.
 */
const SHIP_SYSTEMS: readonly string[] = ["engine", "core", "terminal"];

/**
 * A compartment's charter items, as `systems/populate.ts` keeps them.
 *
 * `taken` and `uploaded` are what the two actions leave behind: the record of
 * the errand stays in the compartment it was in, because a derelict is a place
 * the run walks back into and "already taken" has to survive a sortie
 * (design-doc.md, "Персистентный дереликт"). Positive evidence, deliberately —
 * a charter that read "the crate is no longer aboard" would count itself done
 * on a ship where the crate was never placed.
 */
interface CharterItem {
  kind: string;
  taken?: boolean;
  uploaded?: boolean;
}

function itemsAboard(ship: Ship): CharterItem[] {
  return ship.rooms.flatMap((r) => (r.data.items as CharterItem[] | undefined) ?? []);
}

/**
 * Salvage a `SALVAGE` charter asks for, by the size of the hull: a freighter is
 * twenty credits' worth, anything up to nineteen compartments is thirty-five,
 * and the father's tug is fifty (design-doc.md, "Чартеры").
 *
 * Read off the top of the spec's range rather than the ship, because the
 * charter is offered before the ship is generated — which is the whole reason
 * its marks can be aboard at all.
 */
export function salvageTarget(spec: DerelictSpec): number {
  const size = spec.rooms[1];
  if (size <= 14) return 20;
  if (size <= 19) return 35;
  return 50;
}

/** Compartments of this hull a charter may send the drone to. */
export function charterKinds(spec: DerelictSpec): string[] {
  return spec.kinds.filter((k) => CHARTER_KINDS.includes(k));
}

// ------------------------------------------------------------------ charters

/**
 * Exported because the first hull of a voyage offers this one and nothing else:
 * the tug signs `SALVAGE 20 CR` and casts off, and that is the whole of the
 * first screen (design-doc.md, "Обучение конструкцией", 1).
 */
export function salvageCharter(spec: DerelictSpec): Charter {
  return { id: "salvage", text: t("charter.salvage", { need: salvageTarget(spec) }), payout: 20 };
}

function retrieve(kind: string): Charter {
  return {
    id: "retrieve",
    text: t("charter.retrieve", { room: zoneName(kind) }),
    payout: 25,
    target: { kind, mark: "*" },
  };
}

function upload(kind: string): Charter {
  return {
    id: "upload",
    text: t("charter.upload", { room: zoneName(kind) }),
    payout: 30,
    target: { kind, mark: "&" },
  };
}

/**
 * On every derelict, always: raise the engine, the core and the terminal, and
 * leave alive. It pays what the hull sells for, which is nothing on the father's
 * tug — that one is the end of the run rather than a sale.
 */
function neutralize(spec: DerelictSpec): Charter {
  return { id: "neutralize", text: t("charter.neutralize"), payout: spec.salePrice };
}

// ------------------------------------------------------------------- finished

/** What one kind of job counts as finished. Everything it may read is an argument. */
type Filled = (state: CharterState, ship: Ship, spec: DerelictSpec) => boolean;

/**
 * The four tests, by charter id.
 *
 * A table rather than four closures on four records, because a signed charter
 * is part of the voyage and the voyage is JSON: a closure survives neither a
 * save file nor a structured clone, and the failure would be silent — a
 * restored run whose charters simply never pay.
 *
 * The hull's own spec comes in as an argument rather than as a number on the
 * charter for the same reason: `SALVAGE` asks for a figure that is a function
 * of the class (`salvageTarget`), and a class the run is already carrying is
 * cheaper to look at than a field to keep in step with it.
 */
const FILLED: Record<CharterId, Filled> = {
  salvage: (state, _ship, spec) => state.loot >= salvageTarget(spec),
  retrieve: (_state, ship) => itemsAboard(ship).some((i) => i.kind === "charter-item" && i.taken === true),
  upload: (_state, ship) => itemsAboard(ship).some((i) => i.kind === "console" && i.uploaded === true),
  neutralize: (state) => SHIP_SYSTEMS.every((s) => state.online.includes(s)),
};

/**
 * Has this charter been filled? Asked at the airlock, on the way home.
 *
 * An id this build does not know — a record from another version, one corrupted
 * in storage — is not filled rather than a thrown turn: the worst it can cost
 * is a payout, and a crash on the way out of a derelict costs the run.
 */
export function doneBy(id: CharterId, state: CharterState, ship: Ship, spec: DerelictSpec): boolean {
  return FILLED[id]?.(state, ship, spec) ?? false;
}

/**
 * What the HELM offers for one hull: `NEUTRALIZE`, plus one or two of the
 * small jobs generated out of this hull's own compartments.
 *
 * `NEUTRALIZE` comes first because it is the one that is always there, and a
 * list whose first line moves between derelicts is a list the player has to
 * read twice. The small ones never share a compartment kind: two errands in one
 * room is one trip, and a charter that pays twice for one walk is not a choice.
 */
export function offerCharters(spec: DerelictSpec, rng: Rng): Charter[] {
  const out: Charter[] = [neutralize(spec)];
  const kinds = rng.shuffle(charterKinds(spec));
  const wanted = rng.int(1, 2);

  for (const id of rng.shuffle<CharterId>(["salvage", "retrieve", "upload"])) {
    if (out.length - 1 >= wanted) break;
    if (id === "salvage") {
      out.push(salvageCharter(spec));
      continue;
    }
    const kind = kinds.pop();
    if (kind === undefined) continue;
    out.push(id === "retrieve" ? retrieve(kind) : upload(kind));
  }
  return out;
}

/**
 * The flags the taken charters raise, to be folded into the run's flags before
 * the derelict is generated — which is at `jump`, one screen before the ship
 * exists (design-doc.md, "Чартеры").
 *
 * An upload raises two: the one the deck reads, which names the compartment,
 * and the bare one for everything that only has to know the run is uploading.
 */
export function charterFlags(charters: readonly Charter[]): string[] {
  const out: string[] = [];
  for (const charter of charters) {
    if (!charter.target) continue;
    if (charter.id === "retrieve") out.push(retrieveFlag(charter.target.kind));
    if (charter.id === "upload") out.push(uploadFlag(charter.target.kind), UPLOAD_FLAG);
  }
  return out;
}
