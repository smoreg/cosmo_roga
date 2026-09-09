/**
 * Public surface of the engine. Games import from here and nowhere deeper, so
 * internal file moves never ripple into game code.
 */

// Core data structures
export * from "./sim/grid.js";
export * from "./sim/rng.js";
export * from "./sim/level.js";
export * from "./sim/entity.js";

// Algorithms
export * from "./sim/shadowcast.js";
export * from "./sim/fov.js";
export * from "./sim/dijkstra.js";
export * from "./sim/shapes.js";
export * from "./sim/propagate.js";

// Map generation
export * from "./sim/mapgen.js";

// Turn cycle
export * from "./sim/schedule.js";
export * from "./sim/actions.js";
export * from "./sim/combat.js";
export * from "./sim/damage.js";
export * from "./sim/ai.js";
export * from "./sim/ai/behaviors.js";

// Rules as data
export * from "./sim/status.js";
export * from "./sim/effects.js";
export * from "./sim/items.js";
export * from "./sim/targeting.js";
export * from "./sim/spawn.js";

// Game shell
export * from "./sim/log.js";
export * from "./sim/twist.js";
export * from "./sim/save.js";
export * from "./sim/levelstore.js";
export * from "./sim/game.js";

// The graph world model: ships of rooms and doors, beside the grid one
export * from "./rooms/index.js";

// Content contract: what a game must provide
export * from "./content/kinds.js";
