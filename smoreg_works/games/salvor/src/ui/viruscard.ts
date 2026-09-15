import type { RoomGame } from "@jamrog/engine";
import { moduleName } from "../content/modules.js";
import { strainName, strainOf, type Strain } from "../content/viruses.js";
import { t } from "../i18n.js";
import {
  BENCH_CURE_PRICE,
  CURE_TURNS,
  SPIKE_CURE_TURNS,
  nameOf,
  turnsToBeat,
  turnsToSpread,
  virusOf,
} from "../systems/virus.js";
import { findSlotAs, rigOf } from "../twist/rig.js";
import { CODEX_WIDTH, VIRUS_KEY } from "./input.js";

/**
 * The virus window: which strain is aboard, what it does with this drone's own
 * numbers, and every way to be rid of it (docs/tasks/G90-smoreg-wave.md, C2).
 *
 * The owner, after a run: «непонятно, что делают вирусы и почему их лечит
 * сварщик». The `i` card for a strain says what the strain is in general; this
 * says what it is doing *here* — which module, how long until it does it again,
 * how many turns a purge would take this rack — which is the part a static
 * card cannot know.
 *
 * Laid out like the `i` card and drawn by the same frames (`codexBox` in the
 * terminal, `card` on the page): a heading, a body already broken to
 * `CODEX_WIDTH`, a footer. Every word comes from the tables; this file only
 * decides the order and the line breaks, so the two views cannot disagree.
 */
export interface VirusCard {
  readonly heading: string;
  readonly body: readonly string[];
  readonly footer: string;
}

/** The window for the virus on this drone, or nothing when it carries none. */
export function virusCard(game: RoomGame): VirusCard | undefined {
  const rig = rigOf(game.player);
  const v = rig ? virusOf(game.player) : undefined;
  if (!rig || !v || !rig.slots[v.slot]) return undefined;

  const strain = strainOf(v.strain);
  const module = nameOf(rig, v.slot);
  const spike = moduleName("spike");
  const crawl = turnsToSpread(game, v);
  const when = [
    t("virus.card.next", { n: turnsToBeat(game, v) }),
    crawl === undefined ? t("virus.card.stays") : t("virus.card.spread", { n: crawl }),
  ];

  // The SPIKE line is marked the way the `i` card marks a module in the rack:
  // the same card tells a drone that carries one that it has the faster cure.
  const fitted = findSlotAs(rig, "spike") === null ? "" : ` ${t("codex.fitted")}`;
  const body = [
    ...wrapped(`${t("virus.card.does")} ${harm(strain, module)}`),
    ...wrapped(when.join(" ")),
    "",
    t("virus.card.cure"),
    ...bullet(t("virus.card.purge", { turns: CURE_TURNS })),
    ...bullet(t("virus.card.spike", { turns: SPIKE_CURE_TURNS, spike }) + fitted),
    ...bullet(t("virus.card.bench", { price: BENCH_CURE_PRICE })),
    ...bullet(t("virus.card.drop")),
  ];
  if (v.curing !== undefined) body.push("", ...wrapped(t("virus.card.purging", { n: v.curing.left })));

  return {
    heading: `[${VIRUS_KEY}] ${t("virus.card.title", { virus: strainName(strain), module })}`,
    body,
    footer: t("virus.card.footer"),
  };
}

/** What one beat does, as a sentence with the strain's own numbers in it. */
function harm(strain: Strain, module: string): string {
  const period = strain.period;
  const beat = strain.beat;
  switch (beat.kind) {
    case "expose":
      return t("virus.card.expose", { period, module });
    case "wear":
      return t("virus.card.wear", { period, module, points: beat.points });
    case "skim":
      return t("virus.card.skim", { period, credits: beat.credits });
    case "core":
      return t("virus.card.core", { period, points: beat.points });
  }
}

/** One way out, as a list row: a dash, and the rest hung under the text. */
function bullet(text: string): string[] {
  return wrapped(text, CODEX_WIDTH - 2).map((line, i) => (i === 0 ? `- ${line}` : `  ${line}`));
}

/** One paragraph broken on spaces, the way the `i` card breaks its own. */
export function wrapped(text: string, width = CODEX_WIDTH): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  out.push(line);
  return out;
}
