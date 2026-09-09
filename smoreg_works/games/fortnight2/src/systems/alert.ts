import {
  key,
  spawnMonster,
  spawnSpots,
  type Game,
  type Point,
  type System,
} from "@jamrog/engine";

/**
 * Deck alert — the run's time pressure.
 *
 * The station notices you. Standing still is not free and neither is being
 * loud: both push the gauge up, and every step up wakes one more machine
 * somewhere far away that then walks towards you. This is what closes the
 * "infinite kiting is locally optimal" gap named in .claude/CLAUDE.md.
 *
 * A system, not the twist: it hooks the same turn cycle but knows nothing
 * about modules, and the twist knows nothing about it.
 */

/** Top of the gauge. Numbers below are design-doc.md, "Тревога палубы". */
const MAX_LEVEL = 5;
/** Turns between time-driven raises. Deck 1 is half as fast — it is onboarding. */
const PERIOD_DECK_1 = 80;
const PERIOD = 40;
/** At the top of the gauge reinforcements keep arriving on this period. */
const MAX_LEVEL_PERIOD = 10;
/**
 * A tile this loud anywhere on the deck raises the alert. The engine already
 * rates a fight at 9 and a step at 3 (sim/game.ts `commandNoise`), so fighting
 * is loud enough to be heard and walking is not; the game's own noisy actions
 * (scanner pulse, welding) call `makeNoise` with their own strength.
 */
const NOISE_THRESHOLD = 8;
/** ...but no more often than this, or a single fight would max the gauge. */
const NOISE_COOLDOWN = 10;
/** Reinforcements never appear closer than this to the player. */
const MIN_SPAWN_DIST = 10;

/**
 * Colours are copied from src/ui/theme.ts on purpose: src/systems must not
 * import src/ui — rules never depend on the renderer. Two hex literals are the
 * cheaper half of that trade.
 */
const WARN_FG = "#d9b56a"; // THEME.warn
const BAD_FG = "#d96a6a"; // THEME.bad
/** The gauge turns warn at this level and bad at MAX_LEVEL. */
const WARN_LEVEL = 3;

export interface AlertState {
  /** 0..MAX_LEVEL. Each step up brings one machine. */
  level: number;
  /** Player turns spent on the current deck. */
  turnsOnDeck: number;
  /** `turnsOnDeck` of the last noise-driven raise, for the cooldown. */
  lastNoiseBump: number;
}

/**
 * State lives on the player entity, not in this module: the player is what
 * carries between decks, and a module-level variable would survive a `new
 * Game` and break replay determinism.
 */
export function alertState(game: Game): AlertState {
  const data = (game.player.data ??= {});
  const existing = data.alert as AlertState | undefined;
  if (existing) return existing;
  const fresh = freshState();
  data.alert = fresh;
  return fresh;
}

function freshState(): AlertState {
  // The cooldown starts already expired, so the first loud turn on a deck counts.
  return { level: 0, turnsOnDeck: 0, lastNoiseBump: -NOISE_COOLDOWN };
}

/**
 * One step up the gauge plus one machine. Exported because the alert is also
 * something the game can provoke directly — a storylet that trips an alarm, a
 * bulkhead cut open — not only something time does.
 */
export function raiseAlert(game: Game): void {
  const st = alertState(game);
  st.level = Math.min(MAX_LEVEL, st.level + 1);
  // At MAX_LEVEL the level stops moving but the reinforcement still comes.
  reinforce(game);
}

/**
 * Wake one machine of the current depth's band, far away from the player — and
 * point it at where the player is standing. Distance is what makes the alert a
 * clock rather than an ambush; the standing order is what makes it arrive.
 */
function reinforce(game: Game): void {
  const kinds = game.content.monstersForDepth(game.depth);
  if (kinds.length === 0) return;

  const spots = freeSpots(game);
  // Nowhere far enough to put it: the deck is small or the player is cornered
  // in the only reachable part of it. Skip the reinforcement, never throw.
  if (spots.length === 0) return;

  const table: Record<string, number> = {};
  for (const k of kinds) table[k.id] = k.weight;
  const id = game.rng.weighted(table);
  const kind = kinds.find((k) => k.id === id);
  if (!kind) return;

  const spot = game.rng.pick(spots);
  const machine = spawnMonster(kind, spot);
  // The station dispatched it: it knows where you were when the alarm went off.
  // Without this a reinforcement stands still until it happens to see the drone
  // — and it spawns at least 10 tiles away, further than any machine can see —
  // so the gauge filled up while nothing ever arrived, and the deck's only
  // source of time pressure did not press.
  // Not noise: a sound made here would settle into the field on the next turn
  // and trip the alert's own noise rule, so the gauge would raise itself.
  machine.target = { ...game.player.pos };
  game.schedule.admit(machine);
  game.entities.push(machine);

  const zone = game.level.zoneAt(spot);
  const where = zone ? `in ${zone.name}` : "somewhere on the deck";
  game.log.add(`Something wakes up ${where}.`, game.schedule.time, "warn");
}

/** Reachable, walkable, far enough, and nobody standing on it. */
function freeSpots(game: Game): Point[] {
  const taken = new Set<number>();
  for (const e of game.entities) taken.add(key(e.pos.x, e.pos.y));
  return spawnSpots(game.level, game.player.pos, MIN_SPAWN_DIST).filter((p) => !taken.has(key(p.x, p.y)));
}

/** Did anything loud happen this turn, anywhere on the deck? */
function deckIsLoud(game: Game): boolean {
  let loud = false;
  game.noiseField.forEach((_x, _y, v) => {
    if (v >= NOISE_THRESHOLD) loud = true;
  });
  return loud;
}

export const ALERT: System = {
  name: "alert",

  onLevelEnter(game) {
    // Descending resets everything: a new deck has not noticed you yet.
    Object.assign(alertState(game), freshState());
  },

  afterPlayerTurn(game) {
    const st = alertState(game);
    st.turnsOnDeck++;

    const period = game.depth === 1 ? PERIOD_DECK_1 : PERIOD;
    // The two periods are one trigger, not two: at MAX_LEVEL turn 40 is both
    // due dates at once and must still cost the player exactly one machine.
    const dueByTime =
      st.turnsOnDeck % period === 0 ||
      (st.level === MAX_LEVEL && st.turnsOnDeck % MAX_LEVEL_PERIOD === 0);
    if (dueByTime) raiseAlert(game);

    if (deckIsLoud(game) && st.turnsOnDeck - st.lastNoiseBump >= NOISE_COOLDOWN) {
      st.lastNoiseBump = st.turnsOnDeck;
      raiseAlert(game);
    }
  },

  panelLines(game) {
    const level = alertState(game).level;
    const text = `ALERT ${"▮".repeat(level)}${"▯".repeat(MAX_LEVEL - level)}`;
    if (level >= MAX_LEVEL) return [{ text, fg: BAD_FG }];
    if (level >= WARN_LEVEL) return [{ text, fg: WARN_FG }];
    return [{ text }];
  },
};
