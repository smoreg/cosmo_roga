/**
 * Test-time tools. Kept out of the main entry point so a game bundle never
 * pulls bots and fixtures into production.
 */
export * from "./fixtures.js";
export * from "./roomfixtures.js";
export * from "./dummycontent.js";
export * from "./dummyship.js";
export * from "./bots.js";
export * from "./metrics.js";
export * from "./fuzz.js";

// The graph bots carry the grid bots' names, and a clashing star export is
// dropped in silence rather than reported — so they come out aliased, the way
// `rooms/index.ts` aliases its own half of the engine.
export {
  randomBot as randomRoomBot,
  greedyBot as greedyRoomBot,
  makeCarefulBot as makeCarefulRoomBot,
  BOTS_ROOMS,
  roomPlay,
  roomsExplored,
  type RoomBot,
  type RoomBotFactory,
  type RoomPlayOptions,
} from "./roombots.js";
